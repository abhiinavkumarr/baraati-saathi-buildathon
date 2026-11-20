// Accounts, sessions and per-user wedding listing (§3).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { getDb, type Db } from './db.ts';
import { HttpError } from './gemini.ts';
import { normalizeDraft, type WeddingDraft } from './wedding.ts';

export const authRouter = Router();

export interface SessionUser {
  id: string;
  name: string;
  contact: string;
}

/** Constant-time string comparison (hashes both inputs so length never leaks). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Normalise a phone number or email address.
 * - Phone: strip spaces, dashes, parentheses; 10 digits → +91…; keep + E.164.
 * - Email: trim + lowercase.
 * - Anything else returns null.
 */
export function normalizeContact(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 160) return null;
  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
  }
  const stripped = trimmed.replace(/[\s\-()]/g, '');
  if (/^\d{10}$/.test(stripped)) return `+91${stripped}`;
  if (/^\+[1-9]\d{7,14}$/.test(stripped)) return stripped;
  return null;
}

/** Upsert a user and issue a fresh 32-byte base64url session token. */
export async function loginUser(db: Db, rawName: unknown, rawContact: unknown): Promise<{ user: { id: string; name: string }; session: string }> {
  const name = typeof rawName === 'string' ? rawName.trim().slice(0, 100) : '';
  if (!name) throw new HttpError(400, 'Please enter your name.');
  const contact = normalizeContact(rawContact);
  if (!contact) throw new HttpError(400, 'Please enter a valid 10-digit phone number, E.164 phone (+91…), or email.');

  const rows = await db.query<{ id: string; name: string }>(
    `INSERT INTO users (name, contact)
     VALUES ($1, $2)
     ON CONFLICT (contact) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name`,
    [name, contact],
  );
  const user = rows[0];
  const session = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [session, user.id]);
  return { user, session };
}

/** Resolve the Bearer session token on a request, or null if absent/invalid. */
export async function sessionFromToken(db: Db, token: string | null): Promise<SessionUser | null> {
  if (!token || token.length < 16 || token.length > 128) return null;
  const rows = await db.query<SessionUser & Record<string, unknown>>(
    `SELECT u.id, u.name, u.contact
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

export async function sessionFromRequest(req: Request, db?: Db): Promise<SessionUser | null> {
  const header = req.header('authorization') ?? '';
  const m = header.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  return sessionFromToken(db ?? (await getDb()), m[1]);
}

export interface ListedWedding {
  slug: string;
  locked?: true;
  private: boolean;
  host_token?: string;
  couple?: string;
  first_date?: string | null;
  days?: number | null;
  city?: string;
  logo_url?: string | null;
  /** The shared read-only demo wedding, listed for every user. */
  demo?: true;
}

/** List weddings owned by `userId`. Private weddings require matching `passcode`. */
export async function listUserWeddings(db: Db, userId: string, passcode?: string): Promise<ListedWedding[]> {
  const expected = process.env.OWNER_PASSCODE || '';
  const passcodeOk = Boolean(expected && passcode && safeEqual(passcode, expected));

  const rows = await db.query<{
    id: string;
    slug: string;
    host_token: string;
    draft: WeddingDraft;
    private: boolean;
    is_demo: boolean;
  }>(
    `SELECT id, slug, host_token, draft, private, is_demo FROM weddings
      WHERE owner_user_id = $1 OR is_demo
      ORDER BY is_demo, created_at DESC`,
    [userId],
  );

  return rows.map((w) => {
    if (w.private && !passcodeOk) {
      return { slug: w.slug, locked: true, private: true };
    }
    const d = normalizeDraft(w.draft);
    const dates = d.events.map((e) => e.date).filter(Boolean).sort();
    const first = dates[0] ?? null;
    const days = first ? Math.ceil((Date.parse(first) - Date.now()) / 86_400_000) : null;
    return {
      slug: w.slug,
      host_token: w.host_token,
      couple: [d.partner1_name, d.partner2_name].filter(Boolean).join(' & ') || w.slug,
      first_date: first,
      days,
      private: w.private,
      city: d.city || '',
      logo_url: d.logo_asset_id ? `/api/assets/${d.logo_asset_id}` : null,
      ...(w.is_demo ? { demo: true as const } : {}),
    };
  });
}

authRouter.post('/login', async (req, res) => {
  const db = await getDb();
  const result = await loginUser(db, req.body?.name, req.body?.contact);
  res.json(result);
});

authRouter.get('/me/weddings', async (req, res) => {
  const db = await getDb();
  const user = await sessionFromRequest(req, db);
  if (!user) throw new HttpError(401, 'Please sign in first.');
  const passcode = req.header('x-owner-passcode') ?? undefined;
  const weddings = await listUserWeddings(db, user.id, passcode);
  res.json({ user: { id: user.id, name: user.name }, weddings });
});

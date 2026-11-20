// Act 1: card -> wedding, or create from scratch by chat / voice note.
// Stateless: the browser sends the current draft and recent turns each time.
import { Router } from 'express';
import { loadSkills } from './skills.ts';
import { recentAnnouncements } from './control.ts';
import { ALLOWED_MIME, HttpError, generateJson, toInputPart, type Attachment } from './gemini.ts';
import { draftJsonSchema, missingFields, normalizeDraft, type WeddingDraft } from './wedding.ts';
import { getDb } from './db.ts';
import { makeSlug, makeToken } from './wedding.ts';
import { latestAssets } from './design.ts';
import { sessionFromRequest, safeEqual } from './auth.ts';

interface Turn {
  role: 'host' | 'saathi';
  text: string;
}

interface IntakeResult {
  reply: string;
  draft: WeddingDraft;
  ready: boolean;
  suggested_replies: string[];
}

const intakeSchema = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'What Saathi says next, in the host\'s language. Max 3 short sentences.' },
    draft: draftJsonSchema,
    ready: { type: 'boolean' },
    suggested_replies: {
      type: 'array',
      items: { type: 'string' },
      description: 'Up to 4 short tap-to-answer replies for the host',
    },
  },
  required: ['reply', 'draft', 'ready', 'suggested_replies'],
};

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

export const intakeRouter = Router();

intakeRouter.post('/intake/turn', async (req, res) => {
  const body = req.body ?? {};
  const draft = normalizeDraft(body.draft);
  const history: Turn[] = (Array.isArray(body.history) ? body.history : [])
    .slice(-12)
    .filter((t: Turn) => t && (t.role === 'host' || t.role === 'saathi') && typeof t.text === 'string')
    .map((t: Turn) => ({ role: t.role, text: t.text.slice(0, 2000) }));
  const message = typeof body.message === 'string' ? body.message.slice(0, 4000) : '';
  const attachments: Attachment[] = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 4);

  for (const a of attachments) {
    if (!a || typeof a.data !== 'string' || !ALLOWED_MIME.test(a.mime_type ?? '')) {
      throw new HttpError(400, 'Please upload a photo (JPG/PNG), a PDF or a voice note.');
    }
    if ((a.data.length * 3) / 4 > MAX_ATTACHMENT_BYTES) {
      throw new HttpError(413, 'That file is too large. Please keep it under 12 MB.');
    }
  }
  if (!message && attachments.length === 0) throw new HttpError(400, 'Say something or attach a card.');

  const today = new Date().toISOString().slice(0, 10);
  const context = [
    `Today's date: ${today}.`,
    `Current wedding draft (JSON):\n${JSON.stringify(draft)}`,
    `Still missing for "ready": ${missingFields(draft).join(', ') || 'nothing'}.`,
    history.length
      ? `Conversation so far:\n${history.map((t) => `${t.role === 'host' ? 'Host' : 'Saathi'}: ${t.text}`).join('\n')}`
      : 'This is the start of the conversation.',
    attachments.length
      ? 'The host attached the file(s) below (a card, PDF or voice note). Extract everything from them first.'
      : '',
    message ? `Host: ${message}` : '',
    'Return the full updated draft (not a diff), your reply, whether it is ready, and suggested replies.',
  ].filter(Boolean).join('\n\n');

  const result = await generateJson<IntakeResult>({
    system: loadSkills('wedding-intake'),
    input: [{ type: 'text', text: context }, ...attachments.map(toInputPart)],
    schema: intakeSchema,
  });

  const next = normalizeDraft(result.draft);
  const missing = missingFields(next);
  res.json({
    reply: typeof result.reply === 'string' ? result.reply.slice(0, 800) : '',
    draft: next,
    missing,
    ready: missing.length === 0 && result.ready !== false,
    suggested_replies: (Array.isArray(result.suggested_replies) ? result.suggested_replies : [])
      .filter((s) => typeof s === 'string')
      .slice(0, 4),
  });
});

// Save the finished draft as a wedding. Returns the public slug and the
// host's secret dashboard token.
const HOST_SIDES = new Set(['bride', 'groom', 'planner']);

intakeRouter.post('/weddings', async (req, res) => {
  const draft = normalizeDraft(req.body?.draft);
  const missing = missingFields(draft);
  if (missing.length) throw new HttpError(400, `Still missing: ${missing.join(', ')}`);
  const db = await getDb();
  const user = await sessionFromRequest(req, db);
  const hostSide = typeof req.body?.host_side === 'string' && HOST_SIDES.has(req.body.host_side) ? req.body.host_side : null;
  const rawExp = Number(req.body?.expected_guests);
  const expectedGuests = Number.isInteger(rawExp) && rawExp > 0 && rawExp <= 50000 ? rawExp : null;
  const hashtag = typeof req.body?.hashtag === 'string' ? req.body.hashtag.trim().slice(0, 60) || null : null;

  const slug = makeSlug(draft);
  const hostToken = makeToken();
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO weddings (slug, host_token, draft, style, owner_user_id, host_side, expected_guests, hashtag)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [slug, hostToken, JSON.stringify(draft), draft.style, user?.id ?? null, hostSide, expectedGuests, hashtag],
  );

  // Optional couple photo uploaded during Create (§3).
  const photo = req.body?.couple_photo as { mime_type?: string; data?: string } | undefined;
  if (photo && typeof photo.data === 'string' && typeof photo.mime_type === 'string' && /^image\/(jpeg|png|webp)$/.test(photo.mime_type)) {
    const buf = Buffer.from(photo.data, 'base64');
    if (buf.length > 0 && buf.length <= MAX_ATTACHMENT_BYTES) {
      await db.query(
        'INSERT INTO assets (wedding_id, kind, mime_type, data, label) VALUES ($1, $2, $3, $4, $5)',
        [inserted[0].id, 'upload', photo.mime_type, buf, 'couple_photo'],
      );
    }
  }

  res.status(201).json({ slug, host_token: hostToken });
});

// Public read for the invitation page. Never returns host_token.
// Private weddings return 404 unless the request carries the matching host token (?t=).
intakeRouter.get('/weddings/:slug', async (req, res) => {
  const db = await getDb();
  const rows = await db.query<{ id: string; slug: string; host_token: string; draft: WeddingDraft; style: string; private: boolean }>(
    'SELECT id, slug, host_token, draft, style, private FROM weddings WHERE slug = $1',
    [req.params.slug],
  );
  if (!rows[0]) throw new HttpError(404, 'Wedding not found.');
  if (rows[0].private) {
    const t = typeof req.query.t === 'string' ? req.query.t : '';
    if (!t || !safeEqual(t, rows[0].host_token)) throw new HttpError(404, 'Wedding not found.');
  }
  const { id, slug, draft, style } = rows[0];
  const announcements = (await recentAnnouncements(id, 3)).map(({ text_en, text_hi, created_at }) => ({ text_en, text_hi, created_at }));
  res.json({ slug, style, draft: normalizeDraft(draft), assets: await latestAssets(id), announcements });
});

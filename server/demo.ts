// The shared, read-only demo wedding (Meera & Rohan). Every signed-in user sees
// it in "My weddings"; nobody can change it. Reads and AI previews that save
// nothing are allowed; every other write to it is refused here, in one place.
import { Router, type RequestHandler } from 'express';
import type { Db } from './db.ts';
import { getDb } from './db.ts';
import { makeSlug, makeToken, normalizeDraft } from './wedding.ts';
import { seedSamplePlanning } from './planning.ts';
import { SAMPLE_DRAFT } from '../web/src/sampleDraft.ts';

export const demoRouter = Router();

export const DEMO_READ_ONLY = "This is the demo wedding, so it's view-only. Create your own wedding to make changes.";

let demoSlugs = new Set<string>();

/** Create the demo wedding once (idempotent) and remember its slug. */
export async function ensurePlannerDemo(db: Db): Promise<{ slug: string; host_token: string }> {
  const found = await db.query<{ slug: string; host_token: string }>(
    'SELECT slug, host_token FROM weddings WHERE is_demo ORDER BY created_at LIMIT 1',
  );
  let demo = found[0];
  if (!demo) {
    const draft = normalizeDraft(SAMPLE_DRAFT);
    const slug = makeSlug(draft);
    const host_token = makeToken();
    const [w] = await db.query<{ id: string }>(
      `INSERT INTO weddings (slug, host_token, draft, style, host_side, expected_guests, hashtag, is_demo)
       VALUES ($1, $2, $3, $4, 'bride', 180, '#MeeraRohan2027', true) RETURNING id`,
      [slug, host_token, JSON.stringify(draft), draft.style],
    );
    await seedSamplePlanning(db, w.id);
    demo = { slug, host_token };
    console.log(`[demo] created the shared demo wedding ${slug}`);
  }
  demoSlugs = new Set((await db.query<{ slug: string }>('SELECT slug FROM weddings WHERE is_demo')).map((r) => r.slug));
  return demo;
}

export function isDemoSlug(slug: string): boolean {
  return demoSlugs.has(slug);
}

// POSTs on the demo that change nothing: the agent (it only proposes; /apply is
// refused), Ask your guest list (sandboxed, rolled back) and AI previews.
const DEMO_SAFE = /^\/(agent|ask|tasks\/suggest|tasks\/from-voice|guests\/import-preview|guests\/sheet-link|vendors\/read-quote|messages)$/;

/** Refuse any write to the demo wedding. Mounted before every router. */
export const demoGuard: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const m = req.path.match(/^\/api\/(host|weddings)\/([\w-]+)(\/.*)?$/);
  if (!m || !isDemoSlug(m[2])) return next();
  if (m[1] === 'host' && DEMO_SAFE.test(m[3] ?? '')) return next();
  res.status(403).json({ error: DEMO_READ_ONLY, demo: true });
};

// The demo's host token only grants reads (see demoGuard), so it can be public.
demoRouter.get('/demo', async (_req, res) => {
  res.json(await ensurePlannerDemo(await getDb()));
});

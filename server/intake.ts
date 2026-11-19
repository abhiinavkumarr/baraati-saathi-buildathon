// Act 1: card -> wedding, or create from scratch by chat / voice note.
// Stateless: the browser sends the current draft and recent turns each time.
import { Router } from 'express';
import { loadSkills } from './skills.ts';
import { ALLOWED_MIME, HttpError, generateJson, toInputPart, type Attachment } from './gemini.ts';
import { draftJsonSchema, missingFields, normalizeDraft, type WeddingDraft } from './wedding.ts';
import { getDb } from './db.ts';
import { makeSlug, makeToken } from './wedding.ts';
import { latestAssets } from './design.ts';

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
intakeRouter.post('/weddings', async (req, res) => {
  const draft = normalizeDraft(req.body?.draft);
  const missing = missingFields(draft);
  if (missing.length) throw new HttpError(400, `Still missing: ${missing.join(', ')}`);
  const db = await getDb();
  const slug = makeSlug(draft);
  const hostToken = makeToken();
  await db.query(
    'INSERT INTO weddings (slug, host_token, draft, style) VALUES ($1, $2, $3, $4)',
    [slug, hostToken, JSON.stringify(draft), draft.style],
  );
  res.status(201).json({ slug, host_token: hostToken });
});

// Public read for the invitation page. Never returns host_token.
intakeRouter.get('/weddings/:slug', async (req, res) => {
  const db = await getDb();
  const rows = await db.query<{ id: string; slug: string; draft: WeddingDraft; style: string }>(
    'SELECT id, slug, draft, style FROM weddings WHERE slug = $1',
    [req.params.slug],
  );
  if (!rows[0]) throw new HttpError(404, 'Wedding not found.');
  const { id, ...pub } = rows[0];
  res.json({ ...pub, draft: normalizeDraft(pub.draft), assets: await latestAssets(id) });
});

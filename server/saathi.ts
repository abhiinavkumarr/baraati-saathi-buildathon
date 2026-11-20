// Act 3: Saathi, the guest concierge. Text chat runs here with function calling;
// voice runs in the browser on Gemini Live with an ephemeral token whose system
// instruction and tools are locked server-side. Every tool call (text or voice)
// executes here, scoped to the wedding and the guest's own token — never to ids
// the model supplies. See .agents/skills/guest-data-guardrails/SKILL.md.
import { Router } from 'express';
import { getDb } from './db.ts';
import { loadSkills } from './skills.ts';
import { HttpError, MODELS, TEXT_MODELS, ai, withFallback } from './gemini.ts';
import { normalizeDraft, type WeddingDraft } from './wedding.ts';
import { recentAnnouncements } from './control.ts';

export const saathiRouter = Router();

interface Ctx {
  weddingId: string;
  slug: string;
  draft: WeddingDraft;
  guestToken: string; // '' if the guest hasn't RSVP'd on this device
}

export async function context(slug: string, guestToken: unknown): Promise<Ctx> {
  const db = await getDb();
  const rows = await db.query<{ id: string; draft: WeddingDraft }>('SELECT id, draft FROM weddings WHERE slug = $1', [slug]);
  if (!rows[0]) throw new HttpError(404, 'Wedding not found.');
  return {
    weddingId: rows[0].id,
    slug,
    draft: normalizeDraft(rows[0].draft),
    guestToken: typeof guestToken === 'string' ? guestToken.slice(0, 64) : '',
  };
}

// ── Tools ───────────────────────────────────────────────────────────────────

export const TOOL_DEFS = [
  {
    name: 'get_wedding_details',
    description:
      'Everything the host published for guests: each ceremony with date, start time, venue, address, dress code and notes; the city; the help contact; and the host\'s info cards (stay, parking, food, gifts, kids, pickups...). Call this before answering any factual question.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_my_rsvp',
    description: 'The current guest\'s own RSVP (status, party size, note, and extracted travel/pickup/flight/dietary plan). Only ever returns this guest\'s own answer.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'update_rsvp',
    description:
      'Change the current guest\'s own RSVP. Only call after you told the guest exactly what will change and they said yes.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['yes', 'no', 'maybe'] },
        party_size: { type: 'integer', description: 'Total people including the guest, 1-20' },
        note: { type: 'string', description: 'Optional: arrival, pickup, food or other details the guest gave' },
      },
      required: ['status'],
    },
  },
  {
    name: 'ask_host',
    description:
      'Send the guest\'s question to the host when get_wedding_details does not contain the answer. Use the guest\'s own words.',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
    },
  },
];

/** What the host published for every guest. Never includes other guests' data. */
export function publicDetails(d: WeddingDraft) {
  return {
    couple: `${d.partner1_name} & ${d.partner2_name}`,
    city: d.city,
    tradition: d.tradition,
    events: d.events,
    info: d.info,
    help_contact: d.contact_name ? `${d.contact_name}${d.contact_phone ? ` (${d.contact_phone})` : ''}` : '',
  };
}

export async function runTool(ctx: Ctx, name: string, args: Record<string, unknown>): Promise<unknown> {
  const db = await getDb();
  switch (name) {
    case 'get_wedding_details':
      return publicDetails(ctx.draft);
    case 'get_my_rsvp': {
      if (!ctx.guestToken) return { rsvp: null, hint: 'The guest has not RSVP\'d on this device yet.' };
      const rows = await db.query(
        'SELECT name, status, party_size, note, extracted FROM rsvps WHERE wedding_id = $1 AND guest_token = $2',
        [ctx.weddingId, ctx.guestToken],
      );
      return { rsvp: rows[0] ?? null };
    }
    case 'update_rsvp': {
      if (!ctx.guestToken) return { ok: false, reason: 'Ask the guest to RSVP with the form on the invitation first.' };
      const status = ['yes', 'no', 'maybe'].includes(String(args.status)) ? String(args.status) : '';
      if (!status) return { ok: false, reason: 'Invalid status.' };
      const party = Math.min(20, Math.max(1, Number.parseInt(String(args.party_size ?? ''), 10) || 0));
      const note = typeof args.note === 'string' ? args.note.slice(0, 600) : null;
      const rows = await db.query(
        `UPDATE rsvps SET status = $1,
                party_size = CASE WHEN $2::int > 0 THEN $2::int ELSE party_size END,
                note = COALESCE(NULLIF($3, ''), note), updated_at = now()
          WHERE wedding_id = $4 AND guest_token = $5 RETURNING status, party_size`,
        [status, party, note ?? '', ctx.weddingId, ctx.guestToken],
      );
      return rows[0] ? { ok: true, rsvp: rows[0] } : { ok: false, reason: 'RSVP not found.' };
    }
    case 'ask_host': {
      const q = typeof args.question === 'string' ? args.question.trim().slice(0, 500) : '';
      if (!q) return { ok: false };
      let rsvpId: string | null = null;
      if (ctx.guestToken) {
        const r = await db.query<{ id: string }>('SELECT id FROM rsvps WHERE wedding_id = $1 AND guest_token = $2', [ctx.weddingId, ctx.guestToken]);
        rsvpId = r[0]?.id ?? null;
      }
      await db.query('INSERT INTO questions (wedding_id, rsvp_id, question) VALUES ($1, $2, $3)', [ctx.weddingId, rsvpId, q]);
      return { ok: true, message: 'Sent to the host. Their answer will appear here for everyone.' };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

function systemFor(ctx: Ctx, mode: 'text' | 'voice', updates: string[] = []): string {
  const d = ctx.draft;
  return [
    loadSkills('saathi-concierge', 'guest-data-guardrails'),
    `---\nYou are Saathi for the wedding of ${d.partner1_name} & ${d.partner2_name}${d.city ? ` in ${d.city}` : ''}.`,
    `Today's date is ${new Date().toISOString().slice(0, 10)}.`,
    // Pre-fetched so most answers need a single model call. This is exactly
    // what get_wedding_details returns; it holds only what the host published.
    `Result of get_wedding_details (already fetched, no need to call it again):\n${JSON.stringify(publicDetails(d))}`,
    updates.length ? `Latest updates from the family (newest first; mention them when relevant): ${updates.join(' | ')}` : '',
    'Match the guest\'s script as well as language: Roman-script Hinglish gets a Roman-script Hinglish reply; Devanagari gets Devanagari.',
    mode === 'voice'
      ? 'You are speaking aloud. Keep each answer to one or two short sentences. Say times the way people speak them.'
      : 'You are chatting in text. Keep answers short; use the guest\'s language.',
  ].join('\n');
}

// ── Text chat ───────────────────────────────────────────────────────────────

saathiRouter.post('/saathi/:slug/chat', async (req, res) => {
  const ctx = await context(req.params.slug, req.body?.guest_token);
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
  if (!message) throw new HttpError(400, 'Ask Saathi something.');
  const history = (Array.isArray(req.body?.history) ? req.body.history : [])
    .slice(-8)
    .filter((t: { role?: string; text?: string }) => typeof t?.text === 'string')
    .map((t: { role: string; text: string }) => `${t.role === 'guest' ? 'Guest' : 'Saathi'}: ${t.text.slice(0, 600)}`)
    .join('\n');

  const tools = TOOL_DEFS.map((t) => ({ type: 'function', ...t }));
  const system = systemFor(ctx, 'text', (await recentAnnouncements(ctx.weddingId, 3)).map((a) => a.text_en));
  const used: string[] = [];
  let actions: string[] = [];

  // Chat is latency-bound: the fastest Flash first, then the usual chain.
  const chatModels = [process.env.SAATHI_CHAT_MODEL || 'gemini-3.6-flash', ...TEXT_MODELS]
    .filter((m, i, a) => a.indexOf(m) === i);
  const answer = await withFallback(chatModels, async (model) => {
    actions = [];
    let input: unknown = [{ type: 'text', text: `${history ? `Conversation so far:\n${history}\n\n` : ''}Guest: ${message}` }];
    let previous: string | undefined;
    for (let hop = 0; hop < 5; hop++) {
      const it = (await ai().interactions.create({
        model,
        system_instruction: system,
        input,
        tools,
        generation_config: { thinking_level: model.startsWith('gemini-3.6') ? 'minimal' : 'low' },
        ...(previous ? { previous_interaction_id: previous } : {}),
      } as never)) as { id: string; output_text?: string; steps?: { type: string; id?: string; name?: string; arguments?: Record<string, unknown> }[] };
      const calls = (it.steps ?? []).filter((s) => s.type === 'function_call');
      if (!calls.length) return it.output_text ?? '';
      const results = [];
      for (const c of calls) {
        used.push(c.name!);
        if (c.name === 'ask_host' || c.name === 'update_rsvp') actions.push(c.name);
        const result = await runTool(ctx, c.name!, c.arguments ?? {});
        results.push({ type: 'function_result', name: c.name, call_id: c.id, result: [{ type: 'text', text: JSON.stringify(result) }] });
      }
      input = results;
      previous = it.id;
    }
    return 'Sorry, I got a little lost. Could you ask that again?';
  });

  res.json({ reply: answer, sources: [...new Set(used)], actions });
});

// ── Voice (Gemini Live) ─────────────────────────────────────────────────────

/** Short-lived, single-use token for the browser's Live session, with the
 *  system instruction and tools locked so a visitor can't repurpose it. */
saathiRouter.post('/saathi/:slug/live-token', async (req, res) => {
  const ctx = await context(req.params.slug, req.body?.guest_token);
  const config = {
    responseModalities: ['AUDIO'],
    systemInstruction: systemFor(ctx, 'voice', (await recentAnnouncements(ctx.weddingId, 3)).map((a) => a.text_en)),
    tools: [{ functionDeclarations: TOOL_DEFS }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
  const token = await withFallback([MODELS.live], () =>
    ai().authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 15 * 60_000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
        liveConnectConstraints: { model: MODELS.live, config },
      },
    } as never),
  );
  res.json({ token: (token as { name: string }).name, model: MODELS.live, config });
});

/** Tool calls from the browser's Live session execute here, server-side. */
saathiRouter.post('/saathi/:slug/tool', async (req, res) => {
  const ctx = await context(req.params.slug, req.body?.guest_token);
  const name = String(req.body?.name ?? '');
  if (!TOOL_DEFS.some((t) => t.name === name)) throw new HttpError(400, 'Unknown tool.');
  const args = req.body?.args && typeof req.body.args === 'object' ? req.body.args : {};
  res.json({ result: await runTool(ctx, name, args) });
});

// ── Host answers a question → it becomes an info card for every guest ──────

saathiRouter.post('/host/:slug/questions/:id/answer', async (req, res) => {
  const db = await getDb();
  const rows = await db.query<{ id: string; host_token: string; draft: WeddingDraft }>(
    'SELECT id, host_token, draft FROM weddings WHERE slug = $1',
    [req.params.slug],
  );
  const w = rows[0];
  if (!w) throw new HttpError(404, 'Wedding not found.');
  if (req.body?.t !== w.host_token) throw new HttpError(403, 'Only the host can do that.');
  const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim().slice(0, 600) : '';
  if (!answer) throw new HttpError(400, 'Write an answer first.');
  const q = await db.query<{ question: string }>(
    `UPDATE questions SET answer = $1, status = 'answered' WHERE id = $2 AND wedding_id = $3 RETURNING question`,
    [answer, req.params.id, w.id],
  );
  if (!q[0]) throw new HttpError(404, 'Question not found.');
  const draft = normalizeDraft(w.draft);
  draft.info = [...draft.info, { question: q[0].question, answer }].slice(-30);
  await db.query('UPDATE weddings SET draft = $1, updated_at = now() WHERE id = $2', [JSON.stringify(draft), w.id]);
  res.json({ ok: true });
});

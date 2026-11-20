// The host's AI control room. The host types or speaks ("Haldi moved to 11,
// tell everyone"); a Gemini agent with function calling queries the guest list
// (through the AlloyDB sandbox in insights.ts) and PROPOSES changes as cards.
// Nothing changes until the host confirms a card (POST /apply).
// Instructions: .agents/skills/host-control-room/SKILL.md
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { getDb } from './db.ts';
import { loadSkills } from './skills.ts';
import { ALLOWED_MIME, HttpError, TEXT_MODELS, ai, generateJson, toInputPart, withFallback, type Attachment } from './gemini.ts';
import { hostWeddingRow, queryGuests, type QueryResult } from './insights.ts';
import { normalizeDraft, type WeddingDraft, type WeddingEvent } from './wedding.ts';

export const controlRouter = Router();

type Audience = 'all' | 'coming' | 'maybe' | 'pickup';
const AUDIENCES: Audience[] = ['all', 'coming', 'maybe', 'pickup'];
const AUDIENCE_LABEL: Record<Audience, string> = {
  all: 'Everyone who replied',
  coming: 'Guests coming (yes + maybe)',
  maybe: 'Guests who said maybe',
  pickup: 'Guests who asked for a pickup',
};

export interface Proposal {
  id: string;
  kind: 'event_change' | 'announcement' | 'info_card' | 'question_answer' | 'reminders';
  title: string;
  detail: string;
  payload: Record<string, unknown>;
}

// ── Guest rows (owner-side, parameterised; never model SQL) ──────────────────

interface GuestRow {
  id: string;
  name: string;
  phone: string | null;
  status: 'yes' | 'no' | 'maybe';
  party_size: number;
  created_at: string;
  extracted: {
    adults?: number; children?: number; arrival_date?: string; arrival_time?: string;
    arrival_mode?: string; arrival_point?: string; flight_or_train?: string;
    ticket_passengers?: number; needs_pickup?: boolean; dietary?: string;
  } | null;
}

async function guestRows(weddingId: string): Promise<GuestRow[]> {
  const db = await getDb();
  return db.query<GuestRow & Record<string, unknown>>(
    'SELECT id, name, phone, status, party_size, extracted, created_at FROM rsvps WHERE wedding_id = $1 ORDER BY created_at',
    [weddingId],
  );
}

function inAudience(g: GuestRow, a: Audience): boolean {
  if (a === 'all') return true;
  if (a === 'maybe') return g.status === 'maybe';
  if (a === 'coming') return g.status !== 'no';
  return g.status !== 'no' && Boolean(g.extracted?.needs_pickup);
}

const DIETS: [string, RegExp][] = [
  ['Jain', /jain/i],
  ['Vegan', /vegan/i],
  ['Vegetarian', /veg(etarian)?\b|shakahari/i],
  ['Allergy', /allerg|nut|gluten|lactose/i],
];

/** Numbers and chart series for the dashboard, computed without the model. */
export function computeStats(rows: GuestRow[], draft: WeddingDraft) {
  const coming = rows.filter((r) => r.status !== 'no');
  const heads = coming.reduce((n, r) => n + r.party_size, 0);
  const kids = coming.reduce((n, r) => n + (Number(r.extracted?.children) || 0), 0);
  const pickups = coming.filter((r) => r.extracted?.needs_pickup);
  const diet = new Map<string, number>();
  for (const r of coming) {
    const d = r.extracted?.dietary ?? '';
    if (!d) continue;
    const label = DIETS.find(([, re]) => re.test(d))?.[0] ?? 'Other';
    // Count households: a note like "Jain food for my mother" doesn't make the whole party Jain.
    diet.set(label, (diet.get(label) ?? 0) + 1);
  }
  const arrivals = new Map<string, { people: number; pickups: number; guests: string[] }>();
  for (const r of coming) {
    const day = r.extracted?.arrival_date;
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const a = arrivals.get(day) ?? { people: 0, pickups: 0, guests: [] };
    a.people += r.party_size;
    if (r.extracted?.needs_pickup) a.pickups += r.party_size;
    a.guests.push(r.name);
    arrivals.set(day, a);
  }
  const first = draft.events.map((e) => e.date).filter(Boolean).sort()[0];
  const daysTo = first ? Math.ceil((Date.parse(first) - Date.now()) / 86_400_000) : null;
  return {
    replied: rows.length,
    yes: rows.filter((r) => r.status === 'yes').length,
    maybe: rows.filter((r) => r.status === 'maybe').length,
    no: rows.filter((r) => r.status === 'no').length,
    heads,
    kids,
    pickups: pickups.length,
    pickup_people: pickups.reduce((n, r) => n + r.party_size, 0),
    days_to_wedding: daysTo,
    diet: [...diet].map(([label, households]) => ({ label, households })).sort((a, b) => b.households - a.households),
    arrivals: [...arrivals].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ── Tools ───────────────────────────────────────────────────────────────────

const eventFields = {
  date: { type: 'string', description: 'YYYY-MM-DD' },
  start_time: { type: 'string', description: 'HH:MM, 24-hour' },
  venue_name: { type: 'string' },
  venue_address: { type: 'string' },
  dress_code: { type: 'string' },
  notes: { type: 'string' },
};

const TOOLS = [
  {
    name: 'query_guests',
    description: 'Answer any question about the guest list (RSVPs, headcount, arrivals, pickups, food, children) from the database. Pass the question in plain words.',
    parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
  {
    name: 'propose_event_change',
    description: 'Propose changing one ceremony. Only include the fields that change. The host confirms before anything is saved.',
    parameters: {
      type: 'object',
      properties: { event_name: { type: 'string', description: 'Exact name from the schedule' }, ...eventFields },
      required: ['event_name'],
    },
  },
  {
    name: 'propose_announcement',
    description: 'Draft an update for guests, in English and in Hindi (Devanagari). Shown on the invitation, known to Saathi, and sent as personalised WhatsApp messages after the host confirms.',
    parameters: {
      type: 'object',
      properties: {
        text_en: { type: 'string' },
        text_hi: { type: 'string', description: 'Natural Hindi in Devanagari' },
        audience: { type: 'string', enum: AUDIENCES },
      },
      required: ['text_en', 'text_hi', 'audience'],
    },
  },
  {
    name: 'propose_info_card',
    description: 'Propose a standing answer that every guest\'s Saathi will use.',
    parameters: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' } }, required: ['question', 'answer'] },
  },
  {
    name: 'propose_question_answer',
    description: 'Answer one of the guests\' open questions (by id from the context). Becomes an info card for everyone.',
    parameters: { type: 'object', properties: { question_id: { type: 'string' }, answer: { type: 'string' } }, required: ['question_id', 'answer'] },
  },
  {
    name: 'propose_reminders',
    description:
      'Draft personalised WhatsApp reminders for specific guests (such as guests who said maybe or need to confirm), tailored to each guest in English/Hinglish and Hindi. The host confirms before links are prepared.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              guest_name: { type: 'string', description: 'Exact guest name from the guest list' },
              message_en: { type: 'string', description: 'Warm, personal reminder in English or Hinglish' },
              message_hi: { type: 'string', description: 'Natural Hindi in Devanagari (optional)' },
            },
            required: ['guest_name', 'message_en'],
          },
        },
      },
      required: ['items'],
    },
  },
];

const pid = () => randomBytes(6).toString('hex');
const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function findEvent(draft: WeddingDraft, name: string): WeddingEvent | undefined {
  const n = name.toLowerCase().trim();
  return draft.events.find((e) => e.name.toLowerCase() === n) ?? draft.events.find((e) => e.name.toLowerCase().includes(n) || n.includes(e.name.toLowerCase()));
}

interface Turn {
  proposals: Proposal[];
  data?: { question: string; sql: string } & QueryResult;
}

async function runTool(
  w: { id: string; draft: WeddingDraft },
  rows: GuestRow[],
  openQs: { id: string; question: string }[],
  name: string,
  args: Record<string, unknown>,
  turn: Turn,
): Promise<unknown> {
  switch (name) {
    case 'query_guests': {
      const question = str(args.question, 300);
      if (!question) return { error: 'Empty question.' };
      const db = await getDb();
      const a = await queryGuests(db, w.id, w.draft, question);
      if (!a.result) return { answer_unavailable: a.reason };
      turn.data = { question, sql: a.sql, ...a.result };
      return { row_count: a.result.rows.length, rows: a.result.rows.slice(0, 40) };
    }
    case 'propose_event_change': {
      const ev = findEvent(w.draft, str(args.event_name, 80));
      if (!ev) return { error: `No ceremony called "${str(args.event_name)}". Ceremonies: ${w.draft.events.map((e) => e.name).join(', ')}` };
      const changes: Record<string, string> = {};
      for (const k of Object.keys(eventFields)) {
        const v = str(args[k], 300);
        if (v && v !== (ev as unknown as Record<string, string>)[k]) changes[k] = v;
      }
      if (changes.date && !/^\d{4}-\d{2}-\d{2}$/.test(changes.date)) return { error: 'date must be YYYY-MM-DD' };
      if (changes.start_time && !/^\d{2}:\d{2}$/.test(changes.start_time)) return { error: 'start_time must be HH:MM' };
      if (!Object.keys(changes).length) return { error: 'Nothing would change.' };
      const before = ev as unknown as Record<string, string>;
      turn.proposals.push({
        id: pid(),
        kind: 'event_change',
        title: `Change ${ev.name}`,
        detail: Object.entries(changes).map(([k, v]) => `${k.replace('_', ' ')}: ${before[k] || '—'} → ${v}`).join('\n'),
        payload: { event_name: ev.name, changes },
      });
      return { ok: true, proposed: true };
    }
    case 'propose_announcement': {
      const audience = AUDIENCES.includes(args.audience as Audience) ? (args.audience as Audience) : 'all';
      const text_en = str(args.text_en);
      const text_hi = str(args.text_hi);
      if (!text_en) return { error: 'text_en is required.' };
      const reach = rows.filter((g) => inAudience(g, audience));
      turn.proposals.push({
        id: pid(),
        kind: 'announcement',
        title: `Announcement · ${AUDIENCE_LABEL[audience]} (${reach.length})`,
        detail: text_en,
        payload: { text_en, text_hi, audience },
      });
      return { ok: true, proposed: true, recipients: reach.length };
    }
    case 'propose_info_card': {
      const question = str(args.question, 200);
      const answer = str(args.answer);
      if (!question || !answer) return { error: 'question and answer are required.' };
      turn.proposals.push({ id: pid(), kind: 'info_card', title: `Info card: ${question}`, detail: answer, payload: { question, answer } });
      return { ok: true, proposed: true };
    }
    case 'propose_question_answer': {
      const q = openQs.find((x) => x.id === str(args.question_id, 40));
      const answer = str(args.answer);
      if (!q || !answer) return { error: 'Unknown question id or empty answer.' };
      turn.proposals.push({ id: pid(), kind: 'question_answer', title: `Answer: “${q.question}”`, detail: answer, payload: { question_id: q.id, answer } });
      return { ok: true, proposed: true };
    }
    case 'propose_reminders': {
      const raw = Array.isArray(args.items) ? args.items : [];
      const matched: { guest_name: string; message_en: string; message_hi: string }[] = [];
      for (const it of raw.slice(0, 40)) {
        if (!it || typeof it !== 'object') continue;
        const r = it as Record<string, unknown>;
        const gName = str(r.guest_name, 80);
        const message_en = str(r.message_en, 500);
        const message_hi = str(r.message_hi, 500);
        if (!gName || !message_en) continue;
        const found = rows.find((g) => g.name.toLowerCase() === gName.toLowerCase())
          ?? rows.find((g) => g.name.toLowerCase().includes(gName.toLowerCase()));
        if (found) matched.push({ guest_name: found.name, message_en, message_hi });
      }
      if (!matched.length) return { error: 'No matching guests found on the guest list.' };
      turn.proposals.push({
        id: pid(),
        kind: 'reminders',
        title: `Personalised reminders (${matched.length})`,
        detail: matched.map((m) => `${m.guest_name}: ${m.message_en}`).join('\n\n'),
        payload: { items: matched },
      });
      return { ok: true, proposed: true, recipients: matched.length };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

async function openQuestions(weddingId: string) {
  const db = await getDb();
  return db.query<{ id: string; question: string }>(
    "SELECT id, question FROM questions WHERE wedding_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 20",
    [weddingId],
  );
}

export async function recentAnnouncements(weddingId: string, limit = 5) {
  const db = await getDb();
  return db.query<{ id: string; text_en: string; text_hi: string | null; audience: Audience; created_at: string }>(
    'SELECT id, text_en, text_hi, audience, created_at FROM announcements WHERE wedding_id = $1 ORDER BY created_at DESC LIMIT $2',
    [weddingId, limit],
  );
}

// ── Agent turn ──────────────────────────────────────────────────────────────

controlRouter.post('/host/:slug/agent', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const message = str(req.body?.message, 1000);
  const audio = req.body?.audio as Attachment | undefined;
  if (audio && (typeof audio.data !== 'string' || !/^audio\//.test(audio.mime_type ?? '') || !ALLOWED_MIME.test(audio.mime_type) || audio.data.length > 11_000_000)) {
    throw new HttpError(400, 'That recording could not be used. Please try again.');
  }
  if (!message && !audio) throw new HttpError(400, 'Tell Saathi what you need.');
  const history = (Array.isArray(req.body?.history) ? req.body.history : [])
    .slice(-8)
    .filter((t: { text?: unknown }) => typeof t?.text === 'string')
    .map((t: { role: string; text: string }) => `${t.role === 'host' ? 'Host' : 'Saathi'}: ${t.text.slice(0, 500)}`)
    .join('\n');

  const [rows, openQs, ann] = await Promise.all([guestRows(w.id), openQuestions(w.id), recentAnnouncements(w.id, 3)]);
  const stats = computeStats(rows, w.draft);
  const d = w.draft;
  const system = [
    loadSkills('host-control-room', 'guest-data-guardrails'),
    `---\nWedding of ${d.partner1_name} & ${d.partner2_name}${d.city ? ` in ${d.city}` : ''}. Today is ${new Date().toISOString().slice(0, 10)}.`,
    `Schedule: ${JSON.stringify(d.events.map(({ name, date, start_time, venue_name, dress_code, notes }) => ({ name, date, start_time, venue_name, dress_code, notes })))}`,
    `Info cards guests already see: ${JSON.stringify(d.info.map((i) => i.question))}`,
    `Headline numbers: ${JSON.stringify({ replied: stats.replied, yes: stats.yes, maybe: stats.maybe, no: stats.no, expected_people: stats.heads, children: stats.kids, pickups: stats.pickups })}`,
    `Maybe guests (awaiting confirmation): ${rows.filter((g) => g.status === 'maybe').map((g) => g.name).join(', ') || 'none'}`,
    `Open guest questions (id: question): ${openQs.length ? openQs.map((q) => `${q.id}: ${q.question}`).join(' | ') : 'none'}`,
    `Recent announcements: ${ann.length ? ann.map((a) => a.text_en).join(' | ') : 'none'}`,
  ].join('\n');

  const tools = TOOLS.map((t) => ({ type: 'function', ...t }));
  let turn: Turn = { proposals: [] };
  let heard = '';
  const reply = await withFallback(TEXT_MODELS, async (model) => {
    turn = { proposals: [] };
    const first: unknown[] = [
      { type: 'text', text: `${history ? `Conversation so far:\n${history}\n\n` : ''}Host: ${message || '(voice message attached)'}` },
    ];
    if (audio) {
      first.push(toInputPart(audio));
      first.push({ type: 'text', text: 'The host spoke the request above. Begin your reply with nothing special; just act on it.' });
    }
    let input: unknown = first;
    let previous: string | undefined;
    for (let hop = 0; hop < 6; hop++) {
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
        let result: unknown;
        try {
          result = await runTool(w, rows, openQs, c.name!, c.arguments ?? {}, turn);
        } catch (e) {
          result = { error: e instanceof HttpError ? e.message : 'That step failed.' };
        }
        results.push({ type: 'function_result', name: c.name, call_id: c.id, result: [{ type: 'text', text: JSON.stringify(result) }] });
      }
      input = results;
      previous = it.id;
    }
    return 'I prepared what I could. Have a look at the cards below.';
  });

  if (audio) {
    // A transcript for the thread, so the host sees what Saathi heard.
    heard = await generateJson<{ text: string }>({
      system: 'Transcribe this short voice message exactly, in the script it was spoken in (Roman Hinglish if mixed).',
      input: [toInputPart(audio)],
      model: process.env.SAATHI_CHAT_MODEL || 'gemini-3.6-flash',
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    }).then((r) => r.text).catch(() => '');
  }

  res.json({ reply, heard, proposals: turn.proposals, data: turn.data ?? null });
});

// ── Apply a confirmed card ──────────────────────────────────────────────────

function waNumber(phone: string | null): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 ? d : '';
}

controlRouter.post('/host/:slug/apply', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const p = req.body?.proposal as { kind?: string; payload?: Record<string, unknown> } | undefined;
  const payload = p?.payload ?? {};
  const db = await getDb();
  const draft = w.draft;
  const save = (dr: WeddingDraft) =>
    db.query('UPDATE weddings SET draft = $1, updated_at = now() WHERE id = $2', [JSON.stringify(normalizeDraft(dr)), w.id]);

  switch (p?.kind) {
    case 'event_change': {
      const ev = findEvent(draft, str(payload.event_name, 80));
      if (!ev) throw new HttpError(404, 'That ceremony is no longer in the schedule.');
      const changes = (payload.changes ?? {}) as Record<string, unknown>;
      for (const k of Object.keys(eventFields)) {
        const v = str(changes[k], 300);
        if (v) (ev as unknown as Record<string, string>)[k] = v;
      }
      await save(draft);
      res.json({ ok: true, message: `${ev.name} updated. Guests and Saathi see the new details now.` });
      return;
    }
    case 'announcement': {
      const audience = AUDIENCES.includes(payload.audience as Audience) ? (payload.audience as Audience) : 'all';
      const text_en = str(payload.text_en);
      const text_hi = str(payload.text_hi);
      if (!text_en) throw new HttpError(400, 'The announcement is empty.');
      await db.query('INSERT INTO announcements (wedding_id, text_en, text_hi, audience) VALUES ($1, $2, $3, $4)', [w.id, text_en, text_hi || null, audience]);
      const invite = `${req.protocol}://${req.get('host')}/i/${w.slug}`;
      const couple = `${draft.partner1_name} & ${draft.partner2_name}`;
      const whatsapp = (await guestRows(w.id))
        .filter((g) => inAudience(g, audience))
        .map((g) => {
          const num = waNumber(g.phone);
          // Their own link: the invitation greets them by name and pre-fills their RSVP.
          const text = `Namaste ${g.name} 🙏\n\n${text_hi ? `${text_hi}\n\n` : ''}${text_en}\n\n— ${couple}\n${invite}?g=${encodeURIComponent(g.name)}`;
          return { name: g.name, phone: num ? `••••${num.slice(-4)}` : '', url: num ? `https://wa.me/${num}?text=${encodeURIComponent(text)}` : '' };
        });
      res.json({ ok: true, message: 'Published on the invitation. Saathi knows too.', whatsapp });
      return;
    }
    case 'info_card': {
      const question = str(payload.question, 200);
      const answer = str(payload.answer);
      if (!question || !answer) throw new HttpError(400, 'The info card is empty.');
      draft.info = [...draft.info.filter((i) => i.question !== question), { question, answer }].slice(-30);
      await save(draft);
      res.json({ ok: true, message: 'Saved. Every guest\'s Saathi now knows this.' });
      return;
    }
    case 'question_answer': {
      const answer = str(payload.answer);
      const q = await db.query<{ question: string }>(
        "UPDATE questions SET answer = $1, status = 'answered' WHERE id = $2 AND wedding_id = $3 RETURNING question",
        [answer, str(payload.question_id, 40), w.id],
      );
      if (!q[0] || !answer) throw new HttpError(404, 'Question not found.');
      draft.info = [...draft.info, { question: q[0].question, answer }].slice(-30);
      await save(draft);
      res.json({ ok: true, message: 'Answered. Saathi now tells every guest who asks.' });
      return;
    }
    case 'reminders': {
      const raw = Array.isArray(payload.items) ? payload.items : [];
      const rows = await guestRows(w.id);
      const invite = `${req.protocol}://${req.get('host')}/i/${w.slug}`;
      const couple = `${draft.partner1_name} & ${draft.partner2_name}`;
      const whatsapp = raw
        .map((it) => {
          const r = (it ?? {}) as Record<string, unknown>;
          const gName = str(r.guest_name, 80);
          const message_en = str(r.message_en, 500);
          const message_hi = str(r.message_hi, 500);
          const g = rows.find((x) => x.name.toLowerCase() === gName.toLowerCase());
          if (!g || !message_en) return null;
          const num = waNumber(g.phone);
          const text = `Namaste ${g.name} 🙏\n\n${message_hi ? `${message_hi}\n\n` : ''}${message_en}\n\n— ${couple}\n${invite}?g=${encodeURIComponent(g.name)}`;
          return { name: g.name, phone: num ? `••••${num.slice(-4)}` : '', url: num ? `https://wa.me/${num}?text=${encodeURIComponent(text)}` : '' };
        })
        .filter((x): x is { name: string; phone: string; url: string } => Boolean(x));
      if (!whatsapp.length) throw new HttpError(400, 'No matching guests for reminders.');
      res.json({ ok: true, message: `${whatsapp.length} personalised reminders ready to send.`, whatsapp });
      return;
    }
    default:
      throw new HttpError(400, 'Unknown action.');
  }
});

// ── Briefing: numbers, charts and three AI insights ─────────────────────────

const briefingCache = new Map<string, { at: number; value: unknown }>();

controlRouter.get('/host/:slug/briefing', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.query.t);
  const [rows, openQs] = await Promise.all([guestRows(w.id), openQuestions(w.id)]);
  const stats = computeStats(rows, w.draft);
  const key = `${w.id}:${rows.length}:${rows.map((r) => r.status + r.party_size + (r.extracted ? 1 : 0)).join('')}:${openQs.length}:${JSON.stringify(w.draft.events)}`;
  const hit = briefingCache.get(w.id);
  let insights = hit && (hit.value as { key: string }).key === key ? (hit.value as { insights: unknown }).insights : null;
  if (!insights && rows.length) {
    const r = await generateJson<{ headline: string; insights: { title: string; detail: string; prompt: string }[] }>({
      system:
        'You brief the host of an Indian wedding each morning. From the numbers, find the 3 most useful, specific, actionable observations ' +
        '(e.g. guests landing close together who can share one cab, guests still on maybe, an unanswered question, a dietary group the caterer must know). ' +
        'Food needs are counted in households (RSVPs), not people: never multiply them by party size. title: under 8 words. detail: one sentence with names and numbers from the data only. prompt: an instruction the host could give their assistant to act on it, ' +
        'in the host\'s voice (e.g. "Tell the 3 maybe guests we need final numbers by Friday"). headline: one warm sentence summarising the day. Never invent data.',
      model: process.env.SAATHI_CHAT_MODEL || 'gemini-3.6-flash',
      input: [{
        type: 'text',
        text: JSON.stringify({
          today: new Date().toISOString().slice(0, 10),
          schedule: w.draft.events.map(({ name, date, start_time, venue_name }) => ({ name, date, start_time, venue_name })),
          stats,
          maybe_guests: rows.filter((g) => g.status === 'maybe').map((g) => g.name),
          arrivals: rows.filter((g) => g.status !== 'no' && g.extracted?.arrival_date).map((g) => ({
            name: g.name, people: g.party_size, date: g.extracted!.arrival_date, time: g.extracted!.arrival_time,
            point: g.extracted!.arrival_point, mode: g.extracted!.arrival_mode,
            flight: g.extracted!.flight_or_train || undefined,
            ticket_passengers: g.extracted!.ticket_passengers || undefined,
            pickup: g.extracted!.needs_pickup,
          })),
          open_questions: openQs.map((q) => q.question),
        }),
      }],
      schema: {
        type: 'object',
        properties: {
          headline: { type: 'string' },
          insights: {
            type: 'array',
            items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' }, prompt: { type: 'string' } }, required: ['title', 'detail', 'prompt'] },
          },
        },
        required: ['headline', 'insights'],
      },
    }).catch(() => null);
    if (r) {
      insights = { headline: r.headline, items: r.insights.slice(0, 3) };
      briefingCache.set(w.id, { at: Date.now(), value: { key, insights } });
    }
  }
  res.json({ stats, briefing: insights, announcements: await recentAnnouncements(w.id, 5) });
});

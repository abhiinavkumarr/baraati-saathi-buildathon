// The host's AI control room. The host types or speaks ("Haldi moved to 11,
// tell everyone"); a Gemini agent with function calling queries the guest list
// (through the AlloyDB sandbox in insights.ts) and PROPOSES changes as cards.
// Nothing changes until the host confirms a card (POST /apply).
// Instructions: .agents/skills/host-control-room/SKILL.md
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { getDb, type Db } from './db.ts';
import { loadSkills } from './skills.ts';
import { ALLOWED_MIME, HttpError, TEXT_MODELS, ai, generateJson, toInputPart, withFallback, type Attachment } from './gemini.ts';
import { hostWeddingRow, queryGuests, type QueryResult } from './insights.ts';
import { normalizeDraft, type WeddingDraft, type WeddingEvent } from './wedding.ts';
import { computeBudget, urgency } from './planning.ts';

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
  kind:
    | 'event_change'
    | 'announcement'
    | 'info_card'
    | 'question_answer'
    | 'reminders'
    | 'tasks'
    | 'vendor'
    | 'vendor_bundle'
    | 'payment'
    | 'budget_line'
    | 'rooming'
    | 'pickups';
  title: string;
  detail: string;
  payload: Record<string, unknown>;
}

// ── Guest rows (owner-side, parameterised; never model SQL) ──────────────────

interface GuestRow {
  id: string;
  guest_token: string;
  name: string;
  phone: string | null;
  status: 'yes' | 'no' | 'maybe' | 'pending';
  party_size: number;
  group_name: string | null;
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
    'SELECT id, guest_token, name, phone, status, party_size, group_name, extracted, created_at FROM rsvps WHERE wedding_id = $1 ORDER BY created_at',
    [weddingId],
  );
}

function inAudience(g: GuestRow, a: string): boolean {
  if (a.startsWith('group:')) {
    const target = a.slice(6).trim().toLowerCase();
    return Boolean(target && (g.group_name ?? '').trim().toLowerCase() === target);
  }
  if (a === 'all') return true;
  if (a === 'maybe') return g.status === 'maybe';
  if (a === 'coming') return g.status === 'yes' || g.status === 'maybe';
  if (a === 'pickup') return (g.status === 'yes' || g.status === 'maybe') && Boolean(g.extracted?.needs_pickup);
  return true;
}

const DIETS: [string, RegExp][] = [
  ['Jain', /jain/i],
  ['Vegan', /vegan/i],
  ['Vegetarian', /veg(etarian)?\b|shakahari/i],
  ['Allergy', /allerg|nut|gluten|lactose/i],
];

/** Numbers and chart series for the dashboard, computed without the model. */
export function computeStats(rows: GuestRow[], draft: WeddingDraft) {
  const coming = rows.filter((r) => r.status === 'yes' || r.status === 'maybe');
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
    replied: rows.filter((r) => r.status !== 'pending').length,
    yes: rows.filter((r) => r.status === 'yes').length,
    maybe: rows.filter((r) => r.status === 'maybe').length,
    no: rows.filter((r) => r.status === 'no').length,
    pending: rows.filter((r) => r.status === 'pending').length,
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
    description: 'Answer any question about the guest list, tasks, vendors, budget or payments from the database. Pass the question in plain words.',
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
  {
    name: 'propose_tasks',
    description: 'Propose adding one or more wedding planning tasks to the checklist. The host confirms before saving.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              due_date: { type: 'string', description: 'YYYY-MM-DD or empty' },
              category: { type: 'string' },
              ceremony: { type: 'string' },
              priority: { type: 'string', enum: ['normal', 'high', 'critical'] },
            },
            required: ['title'],
          },
        },
      },
      required: ['tasks'],
    },
  },
  {
    name: 'propose_vendor',
    description: 'Propose adding a wedding vendor. The host confirms before saving.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        category: { type: 'string' },
        status: { type: 'string', enum: ['shortlisted', 'negotiating', 'booked', 'cancelled'] },
        quoted: { type: 'number', description: 'Quoted amount in INR' },
        who_pays: { type: 'string', enum: ['bride', 'groom', 'shared'] },
        notes: { type: 'string' },
      },
      required: ['name', 'category'],
    },
  },
  {
    name: 'propose_payment',
    description: 'Propose recording a vendor payment or upcoming instalment.',
    parameters: {
      type: 'object',
      properties: {
        vendor_name: { type: 'string' },
        label: { type: 'string' },
        amount: { type: 'number' },
        due_date: { type: 'string', description: 'YYYY-MM-DD or empty' },
        paid: { type: 'boolean' },
      },
      required: ['label', 'amount'],
    },
  },
  {
    name: 'propose_budget_line',
    description: 'Propose setting or updating the planned budget (in INR) for a category.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        planned: { type: 'number' },
      },
      required: ['category', 'planned'],
    },
  },
  {
    name: 'propose_rooming',
    description: 'Propose hotel room assignments grouping confirmed outstation guests by family/group into rooms of 2–3.',
    parameters: {
      type: 'object',
      properties: {
        rooms: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              room: { type: 'string' },
              guest_names: { type: 'array', items: { type: 'string' } },
            },
            required: ['room', 'guest_names'],
          },
        },
      },
      required: ['rooms'],
    },
  },
  {
    name: 'propose_pickups',
    description: 'Propose grouping airport/station arrivals landing within 45 min at the same point into 4-seat cabs. Drafts a guest announcement and a task to book the cabs.',
    parameters: {
      type: 'object',
      properties: {
        cabs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              time: { type: 'string', description: 'e.g. 11 Feb 2:00 PM' },
              point: { type: 'string', description: 'e.g. Jaipur airport' },
              guest_names: { type: 'array', items: { type: 'string' } },
            },
            required: ['time', 'point', 'guest_names'],
          },
        },
      },
      required: ['cabs'],
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
    case 'propose_tasks': {
      const raw = Array.isArray(args.tasks) ? args.tasks : [];
      const tasks = raw
        .slice(0, 30)
        .map((t) => {
          const r = (t ?? {}) as Record<string, unknown>;
          const title = str(r.title, 200);
          if (!title) return null;
          const due = str(r.due_date, 10);
          return {
            title,
            due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
            category: str(r.category, 60) || null,
            ceremony: str(r.ceremony, 60) || null,
            priority: ['normal', 'high', 'critical'].includes(String(r.priority)) ? String(r.priority) : 'normal',
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));
      if (!tasks.length) return { error: 'Provide at least one task with a title.' };
      turn.proposals.push({
        id: pid(),
        kind: 'tasks',
        title: `Add ${tasks.length} task${tasks.length === 1 ? '' : 's'}`,
        detail: tasks.map((t) => `• ${t.title}${t.due_date ? ` (by ${t.due_date})` : ''}`).join('\n'),
        payload: { tasks },
      });
      return { ok: true, proposed: true, count: tasks.length };
    }
    case 'propose_vendor': {
      const name = str(args.name, 120);
      const category = str(args.category, 60) || 'Other';
      if (!name) return { error: 'Vendor name is required.' };
      const status = ['shortlisted', 'negotiating', 'booked', 'cancelled'].includes(String(args.status)) ? String(args.status) : 'shortlisted';
      const quoted = args.quoted != null && Number.isFinite(Number(args.quoted)) && Number(args.quoted) >= 0 ? Number(args.quoted) : null;
      const who_pays = ['bride', 'groom', 'shared'].includes(String(args.who_pays)) ? String(args.who_pays) : null;
      const notes = str(args.notes, 600) || null;
      turn.proposals.push({
        id: pid(),
        kind: 'vendor',
        title: `Vendor: ${name} (${category})`,
        detail: [status, quoted != null ? `Quoted ₹${Math.round(quoted).toLocaleString('en-IN')}` : '', notes].filter(Boolean).join(' · '),
        payload: { name, category, status, quoted, who_pays, notes },
      });
      return { ok: true, proposed: true };
    }
    case 'propose_payment': {
      const label = str(args.label, 160);
      const amount = Number(args.amount);
      if (!label || !Number.isFinite(amount) || amount <= 0) return { error: 'Valid label and positive amount are required.' };
      const vendor_name = str(args.vendor_name, 120);
      const due = str(args.due_date, 10);
      const due_date = /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
      const paid = Boolean(args.paid);
      turn.proposals.push({
        id: pid(),
        kind: 'payment',
        title: `Payment: ₹${Math.round(amount).toLocaleString('en-IN')}`,
        detail: [vendor_name, label, due_date ? `Due ${due_date}` : '', paid ? 'Marked paid' : 'Unpaid'].filter(Boolean).join(' · '),
        payload: { vendor_name, label, amount, due_date, paid },
      });
      return { ok: true, proposed: true };
    }
    case 'propose_budget_line': {
      const category = str(args.category, 60);
      const planned = Number(args.planned);
      if (!category || !Number.isFinite(planned) || planned < 0) return { error: 'Category and non-negative planned amount required.' };
      turn.proposals.push({
        id: pid(),
        kind: 'budget_line',
        title: `Budget · ${category}`,
        detail: `Set planned budget for ${category} to ₹${Math.round(planned).toLocaleString('en-IN')}`,
        payload: { category, planned },
      });
      return { ok: true, proposed: true };
    }
    case 'propose_rooming': {
      const raw = Array.isArray(args.rooms) ? args.rooms : [];
      const rooms = raw
        .slice(0, 50)
        .map((r) => {
          const obj = (r ?? {}) as Record<string, unknown>;
          const room = str(obj.room, 60);
          const guest_names = (Array.isArray(obj.guest_names) ? obj.guest_names : []).map((n) => str(n, 80)).filter(Boolean);
          return room && guest_names.length ? { room, guest_names } : null;
        })
        .filter((x): x is { room: string; guest_names: string[] } => Boolean(x));
      if (!rooms.length) return { error: 'Provide at least one room with guest names.' };
      turn.proposals.push({
        id: pid(),
        kind: 'rooming',
        title: `Room assignments (${rooms.length} room${rooms.length === 1 ? '' : 's'})`,
        detail: rooms.map((r) => `Room ${r.room}: ${r.guest_names.join(', ')}`).join('\n'),
        payload: { rooms },
      });
      return { ok: true, proposed: true, rooms: rooms.length };
    }
    case 'propose_pickups': {
      const raw = Array.isArray(args.cabs) ? args.cabs : [];
      const cabs = raw
        .slice(0, 30)
        .map((c) => {
          const obj = (c ?? {}) as Record<string, unknown>;
          const time = str(obj.time, 60);
          const point = str(obj.point, 120);
          const guest_names = (Array.isArray(obj.guest_names) ? obj.guest_names : []).map((n) => str(n, 80)).filter(Boolean);
          return time && point && guest_names.length ? { time, point, guest_names } : null;
        })
        .filter((x): x is { time: string; point: string; guest_names: string[] } => Boolean(x));
      if (!cabs.length) return { error: 'Provide at least one cab pairing.' };
      turn.proposals.push({
        id: pid(),
        kind: 'pickups',
        title: `Pickup plan (${cabs.length} cab${cabs.length === 1 ? '' : 's'})`,
        detail: cabs.map((c, i) => `Cab ${i + 1} · ${c.time} at ${c.point}: ${c.guest_names.join(', ')}`).join('\n'),
        payload: { cabs },
      });
      return { ok: true, proposed: true, cabs: cabs.length };
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

  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const [rows, openQs, ann, tRows, vRows, bRows, pRows] = await Promise.all([
    guestRows(w.id),
    openQuestions(w.id),
    recentAnnouncements(w.id, 3),
    db.query<{ status: string; due_date: string | null }>('SELECT status, due_date FROM tasks WHERE wedding_id = $1', [w.id]),
    db.query<{ id: string; category: string; status: string; quoted: string | null }>('SELECT id, category, status, quoted FROM vendors WHERE wedding_id = $1', [w.id]),
    db.query<{ category: string; planned: string }>('SELECT category, planned FROM budget_lines WHERE wedding_id = $1', [w.id]),
    db.query<{ vendor_id: string | null; amount: string; due_date: string | null; paid_at: string | null }>('SELECT vendor_id, amount, due_date, paid_at FROM payments WHERE wedding_id = $1', [w.id]),
  ]);
  const stats = computeStats(rows, w.draft);
  const budgetSummary = computeBudget(bRows, vRows, pRows, today);
  const openTasks = tRows.filter((t) => t.status !== 'done').length;
  const overdueTasks = tRows.filter((t) => urgency(t, today) === 'overdue').length;
  const vendorsByStatus = vRows.reduce<Record<string, number>>((acc, v) => {
    acc[v.status] = (acc[v.status] ?? 0) + 1;
    return acc;
  }, {});
  const d = w.draft;
  const system = [
    loadSkills('host-control-room', 'wedding-planner', 'guest-data-guardrails'),
    `---\nWedding of ${d.partner1_name} & ${d.partner2_name}${d.city ? ` in ${d.city}` : ''}. Today is ${today}.`,
    `Schedule: ${JSON.stringify(d.events.map(({ name, date, start_time, venue_name, dress_code, notes }) => ({ name, date, start_time, venue_name, dress_code, notes })))}`,
    `Info cards guests already see: ${JSON.stringify(d.info.map((i) => i.question))}`,
    `Headline numbers: ${JSON.stringify({ replied: stats.replied, yes: stats.yes, maybe: stats.maybe, no: stats.no, pending: stats.pending, expected_people: stats.heads, children: stats.kids, pickups: stats.pickups })}`,
    `Planning numbers (INR): ${JSON.stringify({ planned: budgetSummary.total_planned, committed: budgetSummary.total_committed, paid: budgetSummary.total_paid, due_30d: budgetSummary.total_due_30d, open_tasks: openTasks, overdue_tasks: overdueTasks, vendors: vendorsByStatus })}`,
    `Maybe or pending guests: ${rows.filter((g) => g.status === 'maybe' || g.status === 'pending').map((g) => g.name).join(', ') || 'none'}`,
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

export async function applyProposal(
  db: Db,
  w: { id: string; slug: string; draft: WeddingDraft },
  p: { kind?: string; payload?: Record<string, unknown> } | undefined,
  inviteBase: string,
): Promise<{ ok: true; message: string; whatsapp?: { name: string; phone: string; url: string }[] }> {
  const payload = p?.payload ?? {};
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
      return { ok: true, message: `${ev.name} updated. Guests and Saathi see the new details now.` };
    }
    case 'announcement': {
      const rawAud = str(payload.audience, 80) || 'all';
      const audience = AUDIENCES.includes(rawAud as Audience) || rawAud.startsWith('group:') ? rawAud : 'all';
      const text_en = str(payload.text_en);
      const text_hi = str(payload.text_hi);
      if (!text_en) throw new HttpError(400, 'The announcement is empty.');
      await db.query('INSERT INTO announcements (wedding_id, text_en, text_hi, audience) VALUES ($1, $2, $3, $4)', [w.id, text_en, text_hi || null, audience]);
      const couple = `${draft.partner1_name} & ${draft.partner2_name}`;
      const rows = await db.query<GuestRow & Record<string, unknown>>(
        'SELECT id, guest_token, name, phone, status, party_size, group_name, extracted, created_at FROM rsvps WHERE wedding_id = $1 ORDER BY created_at',
        [w.id],
      );
      const whatsapp = rows
        .filter((g) => inAudience(g, audience))
        .map((g) => {
          const num = waNumber(g.phone);
          const text = `Namaste ${g.name} 🙏\n\n${text_hi ? `${text_hi}\n\n` : ''}${text_en}\n\n— ${couple}\n${inviteBase}?g=${encodeURIComponent(g.guest_token)}`;
          return { name: g.name, phone: num ? `••••${num.slice(-4)}` : '', url: num ? `https://wa.me/${num}?text=${encodeURIComponent(text)}` : '' };
        });
      return { ok: true, message: 'Published on the invitation. Saathi knows too.', whatsapp };
    }
    case 'info_card': {
      const question = str(payload.question, 200);
      const answer = str(payload.answer);
      if (!question || !answer) throw new HttpError(400, 'The info card is empty.');
      draft.info = [...draft.info.filter((i) => i.question !== question), { question, answer }].slice(-30);
      await save(draft);
      return { ok: true, message: "Saved. Every guest's Saathi now knows this." };
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
      return { ok: true, message: 'Answered. Saathi now tells every guest who asks.' };
    }
    case 'reminders': {
      const raw = Array.isArray(payload.items) ? payload.items : [];
      const rows = await db.query<GuestRow & Record<string, unknown>>(
        'SELECT id, guest_token, name, phone, status, party_size, group_name, extracted, created_at FROM rsvps WHERE wedding_id = $1 ORDER BY created_at',
        [w.id],
      );
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
          const text = `Namaste ${g.name} 🙏\n\n${message_hi ? `${message_hi}\n\n` : ''}${message_en}\n\n— ${couple}\n${inviteBase}?g=${encodeURIComponent(g.guest_token)}`;
          return { name: g.name, phone: num ? `••••${num.slice(-4)}` : '', url: num ? `https://wa.me/${num}?text=${encodeURIComponent(text)}` : '' };
        })
        .filter((x): x is { name: string; phone: string; url: string } => Boolean(x));
      if (!whatsapp.length) throw new HttpError(400, 'No matching guests for reminders.');
      return { ok: true, message: `${whatsapp.length} personalised reminders ready to send.`, whatsapp };
    }
    case 'tasks': {
      const raw = Array.isArray(payload.tasks) ? payload.tasks : [];
      let added = 0;
      for (const item of raw.slice(0, 30)) {
        const r = (item ?? {}) as Record<string, unknown>;
        const title = str(r.title, 200);
        if (!title) continue;
        const due = str(r.due_date, 10);
        const due_date = /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
        const priority = ['normal', 'high', 'critical'].includes(String(r.priority)) ? String(r.priority) : 'normal';
        await db.query(
          `INSERT INTO tasks (wedding_id, title, category, ceremony, priority, due_date, source)
           VALUES ($1, $2, $3, $4, $5, $6, 'ai')`,
          [w.id, title, str(r.category, 60) || null, str(r.ceremony, 60) || null, priority, due_date],
        );
        added++;
      }
      if (!added) throw new HttpError(400, 'No valid tasks to add.');
      return { ok: true, message: `Added ${added} task${added === 1 ? '' : 's'} to your checklist.` };
    }
    case 'vendor': {
      const name = str(payload.name, 120);
      const category = str(payload.category, 60) || 'Other';
      if (!name) throw new HttpError(400, 'Vendor name is required.');
      const status = ['shortlisted', 'negotiating', 'booked', 'cancelled'].includes(String(payload.status)) ? String(payload.status) : 'shortlisted';
      const quoted = payload.quoted != null && Number.isFinite(Number(payload.quoted)) && Number(payload.quoted) >= 0 ? Number(payload.quoted) : null;
      const who_pays = ['bride', 'groom', 'shared'].includes(String(payload.who_pays)) ? String(payload.who_pays) : null;
      await db.query(
        'INSERT INTO vendors (wedding_id, category, name, status, who_pays, quoted, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [w.id, category, name, status, who_pays, quoted, str(payload.notes, 600) || null],
      );
      return { ok: true, message: `Added vendor ${name} (${category}).` };
    }
    case 'vendor_bundle': {
      const name = str(payload.vendor_name ?? payload.name, 120);
      const category = str(payload.category, 60) || 'Other';
      if (!name) throw new HttpError(400, 'Vendor name is required.');
      const total = payload.total != null && Number.isFinite(Number(payload.total)) && Number(payload.total) >= 0 ? Number(payload.total) : null;
      const inclusions = Array.isArray(payload.inclusions) ? payload.inclusions.map((x) => str(x, 120)).filter(Boolean).join('; ') : '';
      const terms = str(payload.cancellation_terms, 300);
      const notes = [inclusions, terms ? `Cancellation: ${terms}` : ''].filter(Boolean).join(' · ').slice(0, 600) || null;
      const [v] = await db.query<{ id: string }>(
        "INSERT INTO vendors (wedding_id, category, name, status, quoted, notes) VALUES ($1, $2, $3, 'negotiating', $4, $5) RETURNING id",
        [w.id, category, name, total, notes],
      );
      const milestones = Array.isArray(payload.milestones) ? payload.milestones : [];
      let pCount = 0;
      for (const m of milestones.slice(0, 12)) {
        const obj = (m ?? {}) as Record<string, unknown>;
        const label = str(obj.label, 140) || 'Milestone payment';
        const amount = Number(obj.amount);
        const due = str(obj.due_date, 10);
        const due_date = /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
        if (Number.isFinite(amount) && amount > 0) {
          await db.query(
            'INSERT INTO payments (wedding_id, vendor_id, label, amount, due_date) VALUES ($1, $2, $3, $4, $5)',
            [w.id, v.id, label, amount, due_date],
          );
          await db.query(
            `INSERT INTO tasks (wedding_id, title, category, priority, due_date, source)
             VALUES ($1, $2, $3, 'high', $4, 'quote')`,
            [w.id, `Pay ₹${Math.round(amount).toLocaleString('en-IN')} (${label}) to ${name}`, category, due_date],
          );
          pCount++;
        }
      }
      return { ok: true, message: `Saved ${name} with ${pCount} payment milestone${pCount === 1 ? '' : 's'} and reminder tasks.` };
    }
    case 'payment': {
      const label = str(payload.label, 160);
      const amount = Number(payload.amount);
      if (!label || !Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Invalid payment.');
      const vendorName = str(payload.vendor_name, 120);
      let vendorId: string | null = null;
      if (vendorName) {
        const vs = await db.query<{ id: string }>(
          'SELECT id FROM vendors WHERE wedding_id = $1 AND lower(name) = lower($2) LIMIT 1',
          [w.id, vendorName],
        );
        vendorId = vs[0]?.id ?? null;
      }
      const due = str(payload.due_date, 10);
      const due_date = /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
      const paid_at = payload.paid ? new Date().toISOString().slice(0, 10) : null;
      await db.query(
        'INSERT INTO payments (wedding_id, vendor_id, label, amount, due_date, paid_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [w.id, vendorId, label, amount, due_date, paid_at],
      );
      return { ok: true, message: `Recorded payment of ₹${Math.round(amount).toLocaleString('en-IN')}.` };
    }
    case 'budget_line': {
      const category = str(payload.category, 60);
      const planned = Number(payload.planned);
      if (!category || !Number.isFinite(planned) || planned < 0) throw new HttpError(400, 'Invalid budget line.');
      await db.query(
        `INSERT INTO budget_lines (wedding_id, category, planned)
         VALUES ($1, $2, $3)
         ON CONFLICT (wedding_id, category) DO UPDATE SET planned = EXCLUDED.planned, updated_at = now()`,
        [w.id, category, planned],
      );
      return { ok: true, message: `Budget for ${category} set to ₹${Math.round(planned).toLocaleString('en-IN')}.` };
    }
    case 'rooming': {
      const rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
      let assigned = 0;
      for (const r of rooms.slice(0, 50)) {
        const obj = (r ?? {}) as Record<string, unknown>;
        const room = str(obj.room, 60);
        const names = (Array.isArray(obj.guest_names) ? obj.guest_names : []).map((n) => str(n, 80)).filter(Boolean);
        if (!room || !names.length) continue;
        for (const name of names) {
          const upd = await db.query<{ id: string }>(
            'UPDATE rsvps SET room = $1, updated_at = now() WHERE wedding_id = $2 AND lower(name) = lower($3) RETURNING id',
            [room, w.id, name],
          );
          assigned += upd.length;
        }
      }
      if (!assigned) throw new HttpError(400, 'No matching guests found to assign rooms.');
      return { ok: true, message: `Assigned rooms for ${assigned} guest${assigned === 1 ? '' : 's'}.` };
    }
    case 'pickups': {
      const cabs = Array.isArray(payload.cabs) ? payload.cabs : [];
      if (!cabs.length) throw new HttpError(400, 'No cabs in proposal.');
      const lines = cabs.map((c, i) => {
        const obj = (c ?? {}) as Record<string, unknown>;
        const names = (Array.isArray(obj.guest_names) ? obj.guest_names : []).map((n) => str(n, 80)).filter(Boolean);
        return `Cab ${i + 1} (${str(obj.time, 60)} · ${str(obj.point, 120)}): ${names.join(', ')}`;
      });
      const textEn = `Airport/station pickup schedule is ready!\n${lines.join('\n')}`;
      await db.query("INSERT INTO announcements (wedding_id, text_en, audience) VALUES ($1, $2, 'pickup')", [w.id, textEn]);
      await db.query(
        "INSERT INTO tasks (wedding_id, title, category, priority, source) VALUES ($1, $2, 'Transport', 'high', 'ai')",
        [w.id, `Book ${cabs.length} pickup cab${cabs.length === 1 ? '' : 's'} for outstation arrivals`],
      );
      return { ok: true, message: `Published pickup schedule and added task to book ${cabs.length} cab${cabs.length === 1 ? '' : 's'}.` };
    }
    default:
      throw new HttpError(400, 'Unknown action.');
  }
}

controlRouter.post('/host/:slug/apply', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const p = req.body?.proposal as { kind?: string; payload?: Record<string, unknown> } | undefined;
  const db = await getDb();
  const invite = `${req.protocol}://${req.get('host')}/i/${w.slug}`;
  res.json(await applyProposal(db, w, p, invite));
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

controlRouter.get('/host/:slug/announcements', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.query.t);
  const rows = await guestRows(w.id);
  const groups = [...new Set(rows.map((r) => r.group_name).filter((g): g is string => Boolean(g)))].sort();
  res.json({ announcements: await recentAnnouncements(w.id, 30), groups });
});

controlRouter.post('/host/:slug/announcements', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const text_en = str(req.body?.text_en, 1000);
  const text_hi = str(req.body?.text_hi, 1000);
  if (!text_en) throw new HttpError(400, 'Announcement text is required.');
  const rawAud = str(req.body?.audience, 80) || 'all';
  const audience = AUDIENCES.includes(rawAud as Audience) || rawAud.startsWith('group:') ? rawAud : 'all';

  const db = await getDb();
  const inserted = await db.query<{ id: string; text_en: string; text_hi: string | null; audience: string; created_at: string }>(
    'INSERT INTO announcements (wedding_id, text_en, text_hi, audience) VALUES ($1, $2, $3, $4) RETURNING id, text_en, text_hi, audience, created_at',
    [w.id, text_en, text_hi || null, audience],
  );
  const invite = `${req.protocol}://${req.get('host')}/i/${w.slug}`;
  const couple = `${w.draft.partner1_name} & ${w.draft.partner2_name}`;
  const whatsapp = (await guestRows(w.id))
    .filter((g) => inAudience(g, audience))
    .map((g) => {
      const num = waNumber(g.phone);
      const text = `Namaste ${g.name} 🙏\n\n${text_hi ? `${text_hi}\n\n` : ''}${text_en}\n\n— ${couple}\n${invite}?g=${encodeURIComponent(g.guest_token)}`;
      return { name: g.name, phone: num ? `••••${num.slice(-4)}` : '', url: num ? `https://wa.me/${num}?text=${encodeURIComponent(text)}` : '' };
    });
  res.status(201).json({ ok: true, announcement: inserted[0], whatsapp });
});

// ── Home: ranked "What needs you" + section counts (computed in code) ────────

const KEY_VENDOR_CATS = ['Venue', 'Catering', 'Photography', 'Decor', 'Makeup'];

controlRouter.get('/host/:slug/home', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.query.t);
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  const [rsvps, openQs, tasks, vendors, budgetLines, payments, assetCount] = await Promise.all([
    db.query<{ status: string; party_size: number; extracted: GuestRow['extracted'] }>(
      'SELECT status, party_size, extracted FROM rsvps WHERE wedding_id = $1',
      [w.id],
    ),
    db.query<{ id: string }>("SELECT id FROM questions WHERE wedding_id = $1 AND status = 'open'", [w.id]),
    db.query<{ status: string; due_date: string | null }>('SELECT status, due_date FROM tasks WHERE wedding_id = $1', [w.id]),
    db.query<{ category: string; status: string; quoted: string | null }>('SELECT category, status, quoted FROM vendors WHERE wedding_id = $1', [w.id]),
    db.query<{ planned: string }>('SELECT planned FROM budget_lines WHERE wedding_id = $1', [w.id]),
    db.query<{ amount: string; due_date: string | null; paid_at: string | null }>('SELECT amount, due_date, paid_at FROM payments WHERE wedding_id = $1', [w.id]),
    db.query<{ n: string }>('SELECT count(*)::text AS n FROM assets WHERE wedding_id = $1', [w.id]),
  ]);

  const toDateStr = (d: unknown): string | null => {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    const s = String(d);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  };

  const overdueTasks = tasks.filter((t) => {
    const dd = toDateStr(t.due_date);
    return t.status !== 'done' && Boolean(dd && dd < today);
  }).length;
  const openTasks = tasks.filter((t) => t.status !== 'done').length;

  const dueSoonPayments = payments.filter((p) => {
    const dd = toDateStr(p.due_date);
    return !p.paid_at && Boolean(dd && dd <= in7);
  }).length;

  const pendingRsvps = rsvps.filter((r) => r.status === 'pending').length;
  const comingRsvps = rsvps.filter((r) => r.status === 'yes' || r.status === 'maybe').length;
  const comingHeads = rsvps.filter((r) => r.status === 'yes' || r.status === 'maybe').reduce((s, r) => s + r.party_size, 0);

  const outstationNoPickup = rsvps.filter(
    (r) => r.status === 'yes' && Boolean(r.extracted?.arrival_date) && !r.extracted?.needs_pickup,
  ).length;

  const bookedCats = new Set(vendors.filter((v) => v.status === 'booked').map((v) => v.category.toLowerCase()));
  const missingCats = KEY_VENDOR_CATS.filter((c) => !bookedCats.has(c.toLowerCase()));

  const needs: { kind: string; text: string; href: string; count: number }[] = [];
  if (overdueTasks > 0) {
    needs.push({
      kind: 'overdue_tasks',
      text: `${overdueTasks} overdue task${overdueTasks === 1 ? '' : 's'}`,
      href: `/w/${w.slug}/plan/tasks`,
      count: overdueTasks,
    });
  }
  if (dueSoonPayments > 0) {
    needs.push({
      kind: 'payments_due',
      text: `${dueSoonPayments} payment${dueSoonPayments === 1 ? '' : 's'} due within 7 days`,
      href: `/w/${w.slug}/plan/budget`,
      count: dueSoonPayments,
    });
  }
  if (openQs.length > 0) {
    needs.push({
      kind: 'open_questions',
      text: `${openQs.length} guest question${openQs.length === 1 ? '' : 's'} waiting`,
      href: `/w/${w.slug}/app/info`,
      count: openQs.length,
    });
  }
  if (pendingRsvps > 0) {
    needs.push({
      kind: 'pending_rsvps',
      text: `${pendingRsvps} pending RSVP${pendingRsvps === 1 ? '' : 's'} to follow up`,
      href: `/w/${w.slug}/app/rsvps`,
      count: pendingRsvps,
    });
  }
  if (outstationNoPickup > 0) {
    needs.push({
      kind: 'outstation_pickup',
      text: `${outstationNoPickup} confirmed outstation guest${outstationNoPickup === 1 ? '' : 's'} without pickup`,
      href: `/w/${w.slug}/app/travel`,
      count: outstationNoPickup,
    });
  }
  if (missingCats.length > 0) {
    needs.push({
      kind: 'unbooked_vendors',
      text: `Still to book: ${missingCats.slice(0, 3).join(', ')}${missingCats.length > 3 ? ` +${missingCats.length - 3}` : ''}`,
      href: `/w/${w.slug}/plan/vendors`,
      count: missingCats.length,
    });
  }

  const paid = payments.filter((p) => Boolean(p.paid_at)).reduce((s, p) => s + Number(p.amount || 0), 0);
  const planned = budgetLines.reduce((s, b) => s + Number(b.planned || 0), 0);
  const committed = vendors.filter((v) => v.status === 'booked').reduce((s, v) => s + Number(v.quoted || 0), 0);
  const creations = Number(assetCount[0]?.n || 0);

  res.json({
    needs: needs.slice(0, 6),
    counts: {
      paid,
      planned,
      committed,
      open_tasks: openTasks,
      overdue_tasks: overdueTasks,
      coming: comingRsvps,
      coming_heads: comingHeads,
      pending: pendingRsvps,
      creations,
      vendors_booked: vendors.filter((v) => v.status === 'booked').length,
      vendors_total: vendors.length,
    },
  });
});

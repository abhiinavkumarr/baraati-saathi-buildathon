// "Ask your guest list": the host asks a question in plain words (English,
// Hindi or Hinglish); Gemini writes one PostgreSQL SELECT; AlloyDB runs it and
// Gemini turns the rows into a one-line answer.
//
// Model-written SQL is never trusted. It runs:
//   1. only after a static check (one SELECT, no comments, no system objects);
//   2. inside a transaction that is always rolled back;
//   3. as `saathi_reader`, a role with no privileges on any real table;
//   4. against two temporary tables holding only THIS wedding's rows, with
//      phone numbers left out entirely;
//   5. with a statement timeout and a row cap.
// So even a prompt-injected guest note can't read another wedding or change data.
import { Router } from 'express';
import { getDb, type Db } from './db.ts';
import { HttpError, generateJson } from './gemini.ts';
import { safeEqual } from './auth.ts';

const FAST_MODEL = process.env.SAATHI_CHAT_MODEL || 'gemini-3.6-flash';
import { normalizeDraft, type WeddingDraft } from './wedding.ts';

export const insightsRouter = Router();

/** What the model is told about the data. Mirrors the temp tables below. */
export const DATA_DICTIONARY = `
Table guests (one row per RSVP/guest; phone numbers are not available):
  name text, status text ('yes' | 'no' | 'maybe' | 'pending'),
  party_size int (total people in this RSVP, including the guest),
  side text ('bride' | 'groom' | 'both' | NULL), group_name text, room text,
  adults int, children int (from the guest's note; NULL if unknown),
  arrival_date date, arrival_time text ('HH:MM' 24h or NULL),
  arrival_mode text ('flight' | 'train' | 'car' | 'bus' | NULL),
  arrival_point text (e.g. 'Udaipur airport' or NULL),
  flight_or_train text (e.g. '6E 2145' or NULL), ticket_passengers int (passengers on uploaded ticket or NULL),
  needs_pickup boolean, dietary text (e.g. 'Jain', 'vegan', 'nut allergy' or NULL),
  note text (the guest's own words), responded_at timestamptz
Table events (the wedding's ceremonies):
  name text, date date, start_time text ('HH:MM'), venue_name text, venue_address text, dress_code text
Table tasks (the wedding's planning checklist):
  title text, category text, ceremony text, assignee text,
  status text ('todo' | 'doing' | 'waiting' | 'done'),
  priority text ('normal' | 'high' | 'critical'), due_date date, source text
Table vendors (wedding vendors; phone and contact_name are not available):
  id uuid, category text, name text,
  status text ('shortlisted' | 'negotiating' | 'booked' | 'cancelled'),
  who_pays text ('bride' | 'groom' | 'shared' | NULL), quoted numeric, notes text
Table payments (vendor instalments; paid_at IS NULL means unpaid/due):
  vendor_id uuid, vendor_name text, category text, label text, amount numeric, due_date date, paid_at date
`.trim();

const DENY = [
  /--|\/\*|\*\//, // comments
  /\$/, // dollar quoting and parameters
  /\b(insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|call|do|set|reset|execute|prepare|deallocate|listen|notify|unlisten|vacuum|analyze|lock|into|comment|security|refresh|import|discard|checkpoint|load)\b/i,
  /\bpg_|\binformation_schema\b|\blo_|\bdblink|current_setting|set_config|\bsaathi_reader\b/i,
  /\b(weddings|rsvps|assets|questions|public)\b/i, // the real tables
];

/** A query the static gate refused. The model gets one chance to rewrite it. */
export class SqlRejected extends HttpError {
  constructor(message: string) {
    super(422, message);
  }
}

/** Static gate for model-written SQL. Returns the statement without a trailing `;`. */
export function checkSql(raw: string): string {
  const sql = raw.trim().replace(/;\s*$/, '').trim();
  if (!sql || sql.length > 2000) throw new SqlRejected('That question needs a simpler query.');
  if (!/^(select|with)\b/i.test(sql)) throw new SqlRejected('Only read-only questions are supported.');
  if (sql.includes(';')) throw new SqlRejected('Only one query is allowed.');
  // Ignore what's inside string literals ('no onion', 'Jain') when scanning keywords.
  const code = sql.replace(/'(?:[^']|'')*'/g, "''");
  for (const re of DENY) {
    const hit = re.exec(code);
    if (hit) throw new SqlRejected(`Not allowed in the query: "${hit[0]}". Use only SELECT over guests and events.`);
  }
  return sql;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** JSON-safe cells. `date` columns arrive as midnight Dates: local midnight
 *  from `pg`, UTC midnight from PGlite. Both become plain YYYY-MM-DD. */
export function cell(v: unknown): unknown {
  if (v instanceof Date) {
    if (v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0) return v.toISOString().slice(0, 10);
    if (v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0) {
      return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    }
    return v.toISOString();
  }
  if (typeof v === 'bigint') return Number(v);
  return v;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  ms: number;
}

/** Run `sql` (already checked) against one wedding's rows only. */
export async function runScoped(db: Db, weddingId: string, draft: WeddingDraft, sql: string): Promise<QueryResult> {
  return db.sandbox(async (q) => {
    await q(`CREATE TEMP TABLE guests (
      name text, status text, party_size int, side text, group_name text, room text,
      adults int, children int,
      arrival_date date, arrival_time text, arrival_mode text, arrival_point text,
      flight_or_train text, ticket_passengers int,
      needs_pickup boolean, dietary text, note text, responded_at timestamptz) ON COMMIT DROP`);
    await q(
      `INSERT INTO guests
       SELECT name, status, party_size, NULLIF(side, ''), NULLIF(group_name, ''), NULLIF(room, ''),
              CASE WHEN extracted->>'adults' ~ '^[0-9]+$' AND (extracted->>'adults')::int > 0 THEN (extracted->>'adults')::int END,
              CASE WHEN extracted->>'children' ~ '^[0-9]+$' THEN (extracted->>'children')::int END,
              CASE WHEN extracted->>'arrival_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (extracted->>'arrival_date')::date END,
              NULLIF(extracted->>'arrival_time', ''), NULLIF(lower(extracted->>'arrival_mode'), ''),
              NULLIF(extracted->>'arrival_point', ''), NULLIF(extracted->>'flight_or_train', ''),
              CASE WHEN extracted->>'ticket_passengers' ~ '^[0-9]+$' AND (extracted->>'ticket_passengers')::int > 0 THEN (extracted->>'ticket_passengers')::int END,
              COALESCE(extracted->>'needs_pickup' = 'true', false),
              NULLIF(extracted->>'dietary', ''), NULLIF(note, ''), created_at
         FROM rsvps WHERE wedding_id = $1`,
      [weddingId],
    );
    await q(`CREATE TEMP TABLE events (
      name text, date date, start_time text, venue_name text, venue_address text, dress_code text) ON COMMIT DROP`);
    await q(
      `INSERT INTO events
       SELECT name, CASE WHEN date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN date::date END,
              NULLIF(start_time, ''), NULLIF(venue_name, ''), NULLIF(venue_address, ''), NULLIF(dress_code, '')
         FROM jsonb_to_recordset($1::jsonb)
           AS x(name text, date text, start_time text, venue_name text, venue_address text, dress_code text)`,
      [JSON.stringify(draft.events)],
    );
    await q(`CREATE TEMP TABLE tasks (
      title text, category text, ceremony text, assignee text, status text, priority text, due_date date, source text) ON COMMIT DROP`);
    await q(
      `INSERT INTO pg_temp.tasks
       SELECT title, NULLIF(category, ''), NULLIF(ceremony, ''), NULLIF(assignee, ''), status, priority, due_date, source
         FROM public.tasks WHERE wedding_id = $1`,
      [weddingId],
    );
    // Leave out vendors.phone and contact_name (§8)
    await q(`CREATE TEMP TABLE vendors (
      id uuid, category text, name text, status text, who_pays text, quoted numeric, notes text) ON COMMIT DROP`);
    await q(
      `INSERT INTO pg_temp.vendors
       SELECT id, category, name, status, who_pays, quoted, NULLIF(notes, '')
         FROM public.vendors WHERE wedding_id = $1`,
      [weddingId],
    );
    await q(`CREATE TEMP TABLE payments (
      vendor_id uuid, vendor_name text, category text, label text, amount numeric, due_date date, paid_at date) ON COMMIT DROP`);
    await q(
      `INSERT INTO pg_temp.payments
       SELECT p.vendor_id, v.name, COALESCE(v.category, 'Other'), p.label, p.amount, p.due_date, p.paid_at
         FROM public.payments p LEFT JOIN public.vendors v ON v.id = p.vendor_id
        WHERE p.wedding_id = $1`,
      [weddingId],
    );
    await q('GRANT SELECT ON pg_temp.guests, pg_temp.events, pg_temp.tasks, pg_temp.vendors, pg_temp.payments TO saathi_reader');
    try {
      await q('SET LOCAL ROLE saathi_reader');
    } catch (e) {
      // Fail closed: never run model SQL as the owner.
      console.error('[insights] cannot switch to saathi_reader', (e as Error).message);
      throw new HttpError(503, 'Guest-list questions are not available right now.');
    }
    await q("SET LOCAL statement_timeout = '4s'");
    await q('SET LOCAL search_path = pg_temp, pg_catalog');
    const t = Date.now();
    const rows = await q(`SELECT * FROM (${sql}) AS answer LIMIT 200`);
    const ms = Date.now() - t;
    const clean = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])));
    return { columns: clean[0] ? Object.keys(clean[0]) : [], rows: clean, ms };
  });
}

const SQL_SYSTEM = `You turn an Indian wedding host's question into ONE PostgreSQL SELECT.
${DATA_DICTIONARY}
Rules:
- Only SELECT (a WITH ... SELECT is fine). Only the tables guests, events, tasks, vendors and payments. No comments, no semicolon.
- "Coming" means status IN ('yes','maybe') unless the host says confirmed only (status = 'yes').
- Headcounts sum party_size. Children: sum children (NULL counts as 0).
- Match free text case-insensitively with ILIKE (dietary, arrival_point, note). Jain, vegetarian, vegan, allergies live in dietary or note.
- Resolve "the 12th", "sangeet day", "kal" against events.date. Today is ${'{TODAY}'}.
- Give columns short readable names (name, people, arrival_time). Order rows usefully.
- If the question can't be answered from these tables, return sql = "" and say why in reason: one friendly sentence for the host, with no technical words (no 'table', 'column', 'schema', 'SQL').`;

const ANSWER_SYSTEM = `You answer an Indian wedding host's question from query results.
One or two short sentences, in the language and script the host used (English, Hindi or Roman Hinglish).
Every row given already matches the question: never drop or second-guess a row, and never say "only" unless there is exactly one row. Use only the rows given. Mention names when there are five or fewer. Never mention SQL or tables.`;

async function writeSql(question: string, priorError?: { sql: string; error: string }) {
  const input = [
    {
      type: 'text',
      text:
        `Host's question: ${question}` +
        (priorError ? `\n\nYour previous SQL failed.\nSQL: ${priorError.sql}\nError: ${priorError.error}\nFix it.` : ''),
    },
  ];
  return generateJson<{ sql: string; reason: string }>({
    system: SQL_SYSTEM.replace('{TODAY}', new Date().toISOString().slice(0, 10)),
    input,
    schema: {
      type: 'object',
      properties: { sql: { type: 'string' }, reason: { type: 'string' } },
      required: ['sql', 'reason'],
    },
  });
}

export interface GuestAnswer {
  sql: string;
  /** Set when the question can't be answered from the data (no query ran). */
  reason?: string;
  result?: QueryResult;
}

/** Question → Gemini-written SQL → sandboxed run, with one repair round. */
export async function queryGuests(db: Db, weddingId: string, draft: WeddingDraft, question: string): Promise<GuestAnswer> {
  let gen = await writeSql(question);
  if (!gen.sql.trim()) return { sql: '', reason: gen.reason || "I can't answer that from the RSVPs yet." };
  let sql = '';
  for (let round = 0; round < 2; round++) {
    try {
      sql = checkSql(gen.sql);
      return { sql, result: await runScoped(db, weddingId, draft, sql) };
    } catch (e) {
      const repairable = e instanceof SqlRejected || !(e instanceof HttpError);
      if (!repairable || round === 1) {
        if (e instanceof HttpError && !(e instanceof SqlRejected)) throw e;
        console.warn('[insights] gave up on', gen.sql, (e as Error).message);
        throw new HttpError(422, 'Could not answer that one. Try rephrasing.');
      }
      // Show the model the exact reason (static check or Postgres) and let it fix the query.
      gen = await writeSql(question, { sql: gen.sql, error: String((e as Error).message).slice(0, 300) });
      if (!gen.sql.trim()) return { sql: '', reason: gen.reason || 'Could not answer that one. Try rephrasing.' };
    }
  }
  throw new HttpError(422, 'Could not answer that one. Try rephrasing.');
}

/** One or two sentences answering the question from the rows. */
export async function summarise(question: string, result: QueryResult): Promise<string> {
  const { answer } = await generateJson<{ answer: string }>({
    system: ANSWER_SYSTEM,
    model: FAST_MODEL,
    input: [
      {
        type: 'text',
        text: `Question: ${question}
Rows (${result.rows.length}${result.rows.length === 200 ? ', capped' : ''}): ${JSON.stringify(result.rows.slice(0, 60))}`,
      },
    ],
    schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
  }).catch(() => ({ answer: `${result.rows.length} result${result.rows.length === 1 ? '' : 's'}.` }));
  return answer;
}

/** The wedding, if `token` is its host token. */
export async function hostWeddingRow(slug: string, token: unknown) {
  const db = await getDb();
  const rows = await db.query<{ id: string; slug: string; host_token: string; draft: WeddingDraft }>(
    'SELECT id, slug, host_token, draft FROM weddings WHERE slug = $1',
    [slug],
  );
  const w = rows[0];
  if (!w) throw new HttpError(404, 'Wedding not found.');
  if (typeof token !== 'string' || !token || !safeEqual(token, w.host_token)) throw new HttpError(403, 'Only the host can do that.');
  return { ...w, draft: normalizeDraft(w.draft) };
}

insightsRouter.post('/host/:slug/ask', async (req, res) => {
  const db = await getDb();
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const question = typeof req.body?.question === 'string' ? req.body.question.trim().slice(0, 300) : '';
  if (!question) throw new HttpError(400, 'Ask a question about your guests.');
  const a = await queryGuests(db, w.id, w.draft, question);
  if (!a.result) {
    res.json({ answer: a.reason, sql: '', columns: [], rows: [], ms: 0, db: db.kind });
    return;
  }
  res.json({ answer: await summarise(question, a.result), sql: a.sql, ...a.result, db: db.kind });
});

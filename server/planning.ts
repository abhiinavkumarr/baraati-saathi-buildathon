// Your Wedding planning back office (§5): Guests, Vendors, Budget & Payments, Tasks, Sample Seed.
// Every query filters by the wedding resolved from the host token.
import { Router } from 'express';
import { getDb, type Db } from './db.ts';
import { HttpError } from './gemini.ts';
import { hostWeddingRow } from './insights.ts';
import { makeToken } from './wedding.ts';

export const planningRouter = Router();

export const VENDOR_CATEGORIES = [
  'Venue',
  'Catering',
  'Decor',
  'Photography',
  'Makeup',
  'Mehendi artist',
  'DJ & Music',
  'Pandit',
  'Transport',
  'Invitations',
  'Clothing',
  'Jewellery',
  'Gifts',
  'Other',
] as const;

const VENDOR_STATUSES = new Set(['shortlisted', 'negotiating', 'booked', 'cancelled']);
const WHO_PAYS = new Set(['bride', 'groom', 'shared']);
const TASK_STATUSES = new Set(['todo', 'doing', 'waiting', 'done']);
const TASK_PRIORITIES = new Set(['normal', 'high', 'critical']);
const GUEST_STATUSES = new Set(['yes', 'no', 'maybe', 'pending']);
const GUEST_SIDES = new Set(['bride', 'groom', 'both']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function toDateStr(d: unknown): string | null {
  if (!d) return null;
  if (d instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return d.toISOString().slice(0, 10);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const s = String(d).trim();
  return DATE_RE.test(s.slice(0, 10)) ? s.slice(0, 10) : null;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function maskPhone(phone: string | null | undefined): string {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 4 ? `••••${d.slice(-4)}` : '';
}

function waDigits(phone: string | null | undefined): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 ? d : '';
}

// ── Pure functions (unit-tested in tests/planning.test.ts) ───────────────────

export interface BudgetLineInput {
  category: string;
  planned: number | string;
}

export interface VendorBudgetInput {
  id: string;
  category: string;
  status: string;
  quoted: number | string | null;
}

export interface PaymentBudgetInput {
  vendor_id: string | null;
  amount: number | string;
  due_date: string | Date | null;
  paid_at: string | Date | null;
}

export interface CategoryBudget {
  category: string;
  planned: number;
  committed: number;
  paid: number;
  due_30d: number;
  over: boolean;
}

export interface BudgetSummary {
  total_planned: number;
  total_committed: number;
  total_paid: number;
  total_due_30d: number;
  categories: CategoryBudget[];
}

export function computeBudget(
  lines: BudgetLineInput[],
  vendors: VendorBudgetInput[],
  payments: PaymentBudgetInput[],
  today: string,
): BudgetSummary {
  const in30 = addDays(today, 30);
  const vendorCat = new Map<string, string>();
  for (const v of vendors) vendorCat.set(v.id, v.category || 'Other');

  const cats = new Map<string, CategoryBudget>();
  const ensure = (cat: string) => {
    const key = cat || 'Other';
    let row = cats.get(key);
    if (!row) {
      row = { category: key, planned: 0, committed: 0, paid: 0, due_30d: 0, over: false };
      cats.set(key, row);
    }
    return row;
  };

  for (const l of lines) {
    ensure(l.category).planned = Number(l.planned) || 0;
  }
  for (const v of vendors) {
    if (v.status === 'booked') {
      ensure(v.category).committed += Number(v.quoted) || 0;
    }
  }
  for (const p of payments) {
    const amt = Number(p.amount) || 0;
    const cat = p.vendor_id ? vendorCat.get(p.vendor_id) ?? 'Other' : 'Other';
    const row = ensure(cat);
    if (p.paid_at) {
      row.paid += amt;
    } else {
      const dd = toDateStr(p.due_date);
      if (dd && dd <= in30) row.due_30d += amt;
    }
  }

  const list = [...cats.values()].map((c) => ({ ...c, over: c.committed > c.planned }));
  return {
    total_planned: list.reduce((s, c) => s + c.planned, 0),
    total_committed: list.reduce((s, c) => s + c.committed, 0),
    total_paid: list.reduce((s, c) => s + c.paid, 0),
    total_due_30d: list.reduce((s, c) => s + c.due_30d, 0),
    categories: list,
  };
}

export type UrgencyBucket = 'overdue' | 'this_week' | 'later' | 'undated' | 'done';

export function urgency(task: { status: string; due_date: string | Date | null }, today: string): UrgencyBucket {
  if (task.status === 'done') return 'done';
  const dd = toDateStr(task.due_date);
  if (!dd) return 'undated';
  if (dd < today) return 'overdue';
  if (dd <= addDays(today, 7)) return 'this_week';
  return 'later';
}

// ── Scoped CRUD helpers (reused by tests and routes) ─────────────────────────

export async function listVendors(db: Db, weddingId: string) {
  const [vendors, payments] = await Promise.all([
    db.query<Record<string, unknown>>(
      'SELECT id, category, name, contact_name, phone, status, who_pays, quoted, ceremonies, notes, created_at, updated_at FROM vendors WHERE wedding_id = $1 ORDER BY category, created_at DESC',
      [weddingId],
    ),
    db.query<{ vendor_id: string | null; amount: string; paid_at: string | null }>(
      'SELECT vendor_id, amount, paid_at FROM payments WHERE wedding_id = $1',
      [weddingId],
    ),
  ]);

  const paidByVendor = new Map<string, number>();
  for (const p of payments) {
    if (p.vendor_id && p.paid_at) {
      paidByVendor.set(p.vendor_id, (paidByVendor.get(p.vendor_id) ?? 0) + (Number(p.amount) || 0));
    }
  }

  return vendors.map((v) => {
    const id = String(v.id);
    const quoted = v.quoted != null ? Number(v.quoted) : null;
    const paid = paidByVendor.get(id) ?? 0;
    const due = quoted != null ? Math.max(0, quoted - paid) : 0;
    const rawPhone = typeof v.phone === 'string' ? v.phone : '';
    const wa = waDigits(rawPhone);
    return {
      id,
      category: String(v.category),
      name: String(v.name),
      contact_name: v.contact_name ? String(v.contact_name) : '',
      phone_masked: maskPhone(rawPhone),
      tel_url: rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, '')}` : '',
      wa_url: wa ? `https://wa.me/${wa}` : '',
      status: String(v.status),
      who_pays: v.who_pays ? String(v.who_pays) : null,
      quoted,
      paid,
      due,
      ceremonies: Array.isArray(v.ceremonies) ? v.ceremonies : [],
      notes: v.notes ? String(v.notes) : '',
      created_at: v.created_at,
    };
  });
}

export async function updateVendor(db: Db, weddingId: string, id: string, body: Record<string, unknown>) {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Vendor not found.');
  const existing = await db.query<{ id: string }>('SELECT id FROM vendors WHERE id = $1 AND wedding_id = $2', [id, weddingId]);
  if (!existing[0]) throw new HttpError(404, 'Vendor not found.');

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (body.category !== undefined) {
    const c = str(body.category, 60);
    if (!c) throw new HttpError(400, 'Category is required.');
    push('category', c);
  }
  if (body.name !== undefined) {
    const n = str(body.name, 120);
    if (!n) throw new HttpError(400, 'Vendor name is required.');
    push('name', n);
  }
  if (body.contact_name !== undefined) push('contact_name', str(body.contact_name, 100) || null);
  if (body.phone !== undefined) push('phone', str(body.phone, 24).replace(/[^\d+\s-]/g, '') || null);
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !VENDOR_STATUSES.has(body.status)) throw new HttpError(400, 'Invalid status.');
    push('status', body.status);
  }
  if (body.who_pays !== undefined) {
    const wp = body.who_pays === '' || body.who_pays === null ? null : String(body.who_pays);
    if (wp && !WHO_PAYS.has(wp)) throw new HttpError(400, 'Invalid who_pays.');
    push('who_pays', wp);
  }
  if (body.quoted !== undefined) {
    const q = body.quoted === '' || body.quoted === null ? null : Number(body.quoted);
    if (q !== null && (!Number.isFinite(q) || q < 0)) throw new HttpError(400, 'Invalid quoted amount.');
    push('quoted', q);
  }
  if (body.ceremonies !== undefined) {
    const arr = Array.isArray(body.ceremonies) ? body.ceremonies.map((x) => str(x, 60)).filter(Boolean).slice(0, 12) : [];
    push('ceremonies', arr);
  }
  if (body.notes !== undefined) push('notes', str(body.notes, 600) || null);
  if (!sets.length) return { ok: true };

  params.push(id, weddingId);
  await db.query(
    `UPDATE vendors SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length - 1} AND wedding_id = $${params.length}`,
    params,
  );
  return { ok: true };
}

export async function deleteVendor(db: Db, weddingId: string, id: string) {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Vendor not found.');
  const rows = await db.query<{ id: string }>('DELETE FROM vendors WHERE id = $1 AND wedding_id = $2 RETURNING id', [id, weddingId]);
  if (!rows[0]) throw new HttpError(404, 'Vendor not found.');
  return { ok: true };
}

export async function updateTask(db: Db, weddingId: string, id: string, body: Record<string, unknown>) {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Task not found.');
  const existing = await db.query<{ id: string }>('SELECT id FROM tasks WHERE id = $1 AND wedding_id = $2', [id, weddingId]);
  if (!existing[0]) throw new HttpError(404, 'Task not found.');

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (body.title !== undefined) {
    const t = str(body.title, 200);
    if (!t) throw new HttpError(400, 'Title is required.');
    push('title', t);
  }
  if (body.category !== undefined) push('category', str(body.category, 60) || null);
  if (body.ceremony !== undefined) push('ceremony', str(body.ceremony, 60) || null);
  if (body.assignee !== undefined) push('assignee', str(body.assignee, 80) || null);
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !TASK_STATUSES.has(body.status)) throw new HttpError(400, 'Invalid task status.');
    push('status', body.status);
  }
  if (body.priority !== undefined) {
    if (typeof body.priority !== 'string' || !TASK_PRIORITIES.has(body.priority)) throw new HttpError(400, 'Invalid priority.');
    push('priority', body.priority);
  }
  if (body.due_date !== undefined) {
    const dd = body.due_date === '' || body.due_date === null ? null : toDateStr(body.due_date);
    if (body.due_date && !dd) throw new HttpError(400, 'due_date must be YYYY-MM-DD.');
    push('due_date', dd);
  }
  if (!sets.length) return { ok: true };

  params.push(id, weddingId);
  await db.query(
    `UPDATE tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length - 1} AND wedding_id = $${params.length}`,
    params,
  );
  return { ok: true };
}

export async function deleteTask(db: Db, weddingId: string, id: string) {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Task not found.');
  const rows = await db.query<{ id: string }>('DELETE FROM tasks WHERE id = $1 AND wedding_id = $2 RETURNING id', [id, weddingId]);
  if (!rows[0]) throw new HttpError(404, 'Task not found.');
  return { ok: true };
}

export async function updatePayment(db: Db, weddingId: string, id: string, body: Record<string, unknown>) {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Payment not found.');
  const existing = await db.query<{ id: string }>('SELECT id FROM payments WHERE id = $1 AND wedding_id = $2', [id, weddingId]);
  if (!existing[0]) throw new HttpError(404, 'Payment not found.');

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (body.label !== undefined) {
    const l = str(body.label, 160);
    if (!l) throw new HttpError(400, 'Label is required.');
    push('label', l);
  }
  if (body.amount !== undefined) {
    const a = Number(body.amount);
    if (!Number.isFinite(a) || a <= 0) throw new HttpError(400, 'Amount must be greater than 0.');
    push('amount', a);
  }
  if (body.due_date !== undefined) {
    const dd = body.due_date === '' || body.due_date === null ? null : toDateStr(body.due_date);
    if (body.due_date && !dd) throw new HttpError(400, 'due_date must be YYYY-MM-DD.');
    push('due_date', dd);
  }
  if (body.paid_at !== undefined) {
    const pa = body.paid_at === '' || body.paid_at === null ? null : toDateStr(body.paid_at);
    if (body.paid_at && !pa) throw new HttpError(400, 'paid_at must be YYYY-MM-DD.');
    push('paid_at', pa);
  }
  if (!sets.length) return { ok: true };

  params.push(id, weddingId);
  await db.query(
    `UPDATE payments SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length - 1} AND wedding_id = $${params.length}`,
    params,
  );
  return { ok: true };
}

export async function deletePayment(db: Db, weddingId: string, id: string) {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Payment not found.');
  const rows = await db.query<{ id: string }>('DELETE FROM payments WHERE id = $1 AND wedding_id = $2 RETURNING id', [id, weddingId]);
  if (!rows[0]) throw new HttpError(404, 'Payment not found.');
  return { ok: true };
}

// ── Guests routes (§5.1) ─────────────────────────────────────────────────────

planningRouter.get('/host/:slug/guests', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.query.t);
  const db = await getDb();
  const rows = await db.query<Record<string, unknown>>(
    `SELECT id, guest_token, name, phone, status, party_size, side, group_name, relation, room, source, note, extracted, created_at
       FROM rsvps WHERE wedding_id = $1 ORDER BY created_at DESC`,
    [w.id],
  );
  const inviteBase = `${req.protocol}://${req.get('host')}/i/${w.slug}`;
  const couple = `${w.draft.partner1_name} & ${w.draft.partner2_name}`;
  const guests = rows.map((r) => {
    const rawPhone = typeof r.phone === 'string' ? r.phone : '';
    const wa = waDigits(rawPhone);
    const personalLink = `${inviteBase}?g=${encodeURIComponent(String(r.guest_token))}`;
    const msg = `Namaste ${r.name} 🙏\nYou are warmly invited to the wedding of ${couple}!\n${personalLink}`;
    return {
      id: String(r.id),
      guest_token: String(r.guest_token),
      name: String(r.name),
      phone_masked: maskPhone(rawPhone),
      wa_url: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(msg)}` : '',
      personal_link: personalLink,
      status: String(r.status),
      party_size: Number(r.party_size) || 1,
      side: r.side ? String(r.side) : null,
      group_name: r.group_name ? String(r.group_name) : '',
      relation: r.relation ? String(r.relation) : '',
      room: r.room ? String(r.room) : '',
      source: String(r.source || 'rsvp'),
      note: r.note ? String(r.note) : '',
      extracted: r.extracted ?? null,
      created_at: r.created_at,
    };
  });
  res.json({ guests });
});

planningRouter.post('/host/:slug/guests', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const b = req.body ?? {};
  const name = str(b.name, 80);
  if (!name) throw new HttpError(400, 'Guest name is required.');
  const status = typeof b.status === 'string' && GUEST_STATUSES.has(b.status) ? b.status : 'pending';
  const party = Math.min(20, Math.max(1, Number.parseInt(String(b.party_size ?? 1), 10) || 1));
  const side = typeof b.side === 'string' && GUEST_SIDES.has(b.side) ? b.side : null;
  const groupName = str(b.group_name, 80) || null;
  const relation = str(b.relation, 80) || null;
  const room = str(b.room, 60) || null;
  const phone = str(b.phone, 20).replace(/[^\d+]/g, '') || null;
  const note = str(b.note, 600) || null;

  const db = await getDb();
  const guestToken = makeToken();
  const rows = await db.query<{ id: string }>(
    `INSERT INTO rsvps (wedding_id, guest_token, name, phone, status, party_size, side, group_name, relation, room, source, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'host', $11)
     RETURNING id`,
    [w.id, guestToken, name, phone, status, party, side, groupName, relation, room, note],
  );
  res.status(201).json({ id: rows[0].id, guest_token: guestToken });
});

planningRouter.patch('/host/:slug/guests/:id', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const id = req.params.id;
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Guest not found.');
  const db = await getDb();
  const existing = await db.query<{ id: string }>('SELECT id FROM rsvps WHERE id = $1 AND wedding_id = $2', [id, w.id]);
  if (!existing[0]) throw new HttpError(404, 'Guest not found.');

  const b = req.body ?? {};
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (b.name !== undefined) {
    const n = str(b.name, 80);
    if (!n) throw new HttpError(400, 'Guest name is required.');
    push('name', n);
  }
  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !GUEST_STATUSES.has(b.status)) throw new HttpError(400, 'Invalid status.');
    push('status', b.status);
  }
  if (b.party_size !== undefined) {
    const p = Math.min(20, Math.max(1, Number.parseInt(String(b.party_size), 10) || 1));
    push('party_size', p);
  }
  if (b.side !== undefined) {
    const s = b.side === '' || b.side === null ? null : String(b.side);
    if (s && !GUEST_SIDES.has(s)) throw new HttpError(400, 'Invalid side.');
    push('side', s);
  }
  if (b.group_name !== undefined) push('group_name', str(b.group_name, 80) || null);
  if (b.relation !== undefined) push('relation', str(b.relation, 80) || null);
  if (b.room !== undefined) push('room', str(b.room, 60) || null);
  if (b.phone !== undefined) push('phone', str(b.phone, 20).replace(/[^\d+]/g, '') || null);
  if (b.note !== undefined) push('note', str(b.note, 600) || null);

  if (sets.length) {
    params.push(id, w.id);
    await db.query(
      `UPDATE rsvps SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length - 1} AND wedding_id = $${params.length}`,
      params,
    );
  }
  res.json({ ok: true });
});

planningRouter.delete('/host/:slug/guests/:id', async (req, res) => {
  const token = req.body?.t ?? req.query.t;
  const w = await hostWeddingRow(req.params.slug, token);
  const id = req.params.id;
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Guest not found.');
  const db = await getDb();
  const rows = await db.query<{ id: string }>('DELETE FROM rsvps WHERE id = $1 AND wedding_id = $2 RETURNING id', [id, w.id]);
  if (!rows[0]) throw new HttpError(404, 'Guest not found.');
  res.json({ ok: true });
});

planningRouter.post('/host/:slug/guests/bulk-update', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x: unknown): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, 200);
  if (!ids.length) throw new HttpError(400, 'Select at least one guest.');
  const db = await getDb();
  if (req.body?.group_name !== undefined) {
    const g = str(req.body.group_name, 80) || null;
    await db.query('UPDATE rsvps SET group_name = $1, updated_at = now() WHERE wedding_id = $2 AND id = ANY($3::uuid[])', [g, w.id, ids]);
  }
  if (req.body?.side !== undefined) {
    const s = req.body.side === '' || req.body.side === null ? null : String(req.body.side);
    if (s && !GUEST_SIDES.has(s)) throw new HttpError(400, 'Invalid side.');
    await db.query('UPDATE rsvps SET side = $1, updated_at = now() WHERE wedding_id = $2 AND id = ANY($3::uuid[])', [s, w.id, ids]);
  }
  res.json({ ok: true, updated: ids.length });
});

// ── Vendors routes (§5.2) ────────────────────────────────────────────────────

planningRouter.get('/host/:slug/vendors', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.query.t);
  const db = await getDb();
  res.json({ vendors: await listVendors(db, w.id), categories: VENDOR_CATEGORIES });
});

planningRouter.post('/host/:slug/vendors', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const b = req.body ?? {};
  const category = str(b.category, 60) || 'Other';
  const name = str(b.name, 120);
  if (!name) throw new HttpError(400, 'Vendor name is required.');
  const status = typeof b.status === 'string' && VENDOR_STATUSES.has(b.status) ? b.status : 'shortlisted';
  const whoPays = typeof b.who_pays === 'string' && WHO_PAYS.has(b.who_pays) ? b.who_pays : null;
  const quoted = b.quoted === '' || b.quoted === null || b.quoted === undefined ? null : Number(b.quoted);
  if (quoted !== null && (!Number.isFinite(quoted) || quoted < 0)) throw new HttpError(400, 'Invalid quoted amount.');
  const ceremonies = Array.isArray(b.ceremonies) ? b.ceremonies.map((x: unknown) => str(x, 60)).filter(Boolean).slice(0, 12) : [];
  const phone = str(b.phone, 24).replace(/[^\d+\s-]/g, '') || null;

  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    `INSERT INTO vendors (wedding_id, category, name, contact_name, phone, status, who_pays, quoted, ceremonies, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [w.id, category, name, str(b.contact_name, 100) || null, phone, status, whoPays, quoted, ceremonies, str(b.notes, 600) || null],
  );
  res.status(201).json({ id: rows[0].id });
});

planningRouter.patch('/host/:slug/vendors/:id', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const db = await getDb();
  res.json(await updateVendor(db, w.id, req.params.id, req.body ?? {}));
});

planningRouter.delete('/host/:slug/vendors/:id', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t ?? req.query.t);
  const db = await getDb();
  res.json(await deleteVendor(db, w.id, req.params.id));
});

// ── Budget & payments routes (§5.3) ──────────────────────────────────────────

planningRouter.get('/host/:slug/budget', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.query.t);
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const [lines, vendors, payments] = await Promise.all([
    db.query<{ id: string; category: string; planned: string }>('SELECT id, category, planned FROM budget_lines WHERE wedding_id = $1 ORDER BY category', [w.id]),
    db.query<{ id: string; name: string; category: string; status: string; quoted: string | null }>('SELECT id, name, category, status, quoted FROM vendors WHERE wedding_id = $1', [w.id]),
    db.query<{ id: string; vendor_id: string | null; label: string; amount: string; due_date: string | null; paid_at: string | null }>(
      'SELECT id, vendor_id, label, amount, due_date, paid_at FROM payments WHERE wedding_id = $1 ORDER BY paid_at NULLS FIRST, due_date NULLS LAST, created_at DESC',
      [w.id],
    ),
  ]);
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const summary = computeBudget(lines, vendors, payments, today);
  res.json({
    summary,
    vendors: vendors.map((v) => ({ id: v.id, name: v.name, category: v.category, status: v.status })),
    payments: payments.map((p) => {
      const v = p.vendor_id ? vendorById.get(p.vendor_id) : undefined;
      return {
        id: p.id,
        vendor_id: p.vendor_id,
        vendor_name: v?.name ?? '',
        category: v?.category ?? 'Other',
        label: p.label,
        amount: Number(p.amount),
        due_date: toDateStr(p.due_date),
        paid_at: toDateStr(p.paid_at),
      };
    }),
  });
});

planningRouter.post('/host/:slug/budget', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const category = str(req.body?.category, 60);
  const planned = Number(req.body?.planned);
  if (!category) throw new HttpError(400, 'Category is required.');
  if (!Number.isFinite(planned) || planned < 0) throw new HttpError(400, 'Planned amount must be 0 or more.');
  const db = await getDb();
  await db.query(
    `INSERT INTO budget_lines (wedding_id, category, planned)
     VALUES ($1, $2, $3)
     ON CONFLICT (wedding_id, category) DO UPDATE SET planned = EXCLUDED.planned, updated_at = now()`,
    [w.id, category, planned],
  );
  res.json({ ok: true });
});

planningRouter.post('/host/:slug/payments', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const b = req.body ?? {};
  const label = str(b.label, 160);
  const amount = Number(b.amount);
  if (!label) throw new HttpError(400, 'Payment label is required.');
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Amount must be greater than 0.');
  const dueDate = b.due_date ? toDateStr(b.due_date) : null;
  if (b.due_date && !dueDate) throw new HttpError(400, 'due_date must be YYYY-MM-DD.');
  const paidAt = b.paid_at ? toDateStr(b.paid_at) : null;
  if (b.paid_at && !paidAt) throw new HttpError(400, 'paid_at must be YYYY-MM-DD.');

  const db = await getDb();
  let vendorId: string | null = null;
  if (b.vendor_id) {
    if (typeof b.vendor_id !== 'string' || !UUID_RE.test(b.vendor_id)) throw new HttpError(404, 'Vendor not found.');
    const v = await db.query<{ id: string }>('SELECT id FROM vendors WHERE id = $1 AND wedding_id = $2', [b.vendor_id, w.id]);
    if (!v[0]) throw new HttpError(404, 'Vendor not found.');
    vendorId = v[0].id;
  }

  const rows = await db.query<{ id: string }>(
    'INSERT INTO payments (wedding_id, vendor_id, label, amount, due_date, paid_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [w.id, vendorId, label, amount, dueDate, paidAt],
  );
  res.status(201).json({ id: rows[0].id });
});

planningRouter.patch('/host/:slug/payments/:id', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const db = await getDb();
  res.json(await updatePayment(db, w.id, req.params.id, req.body ?? {}));
});

planningRouter.delete('/host/:slug/payments/:id', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t ?? req.query.t);
  const db = await getDb();
  res.json(await deletePayment(db, w.id, req.params.id));
});

// ── Tasks routes (§5.4) ──────────────────────────────────────────────────────

planningRouter.get('/host/:slug/tasks', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.query.t);
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.query<Record<string, unknown>>(
    'SELECT id, title, category, ceremony, assignee, status, priority, due_date, source, created_at FROM tasks WHERE wedding_id = $1 ORDER BY due_date NULLS LAST, created_at DESC',
    [w.id],
  );
  const tasks = rows.map((t) => {
    const due = toDateStr(t.due_date);
    return {
      id: String(t.id),
      title: String(t.title),
      category: t.category ? String(t.category) : '',
      ceremony: t.ceremony ? String(t.ceremony) : '',
      assignee: t.assignee ? String(t.assignee) : '',
      status: String(t.status),
      priority: String(t.priority),
      due_date: due,
      source: String(t.source || 'host'),
      urgency: urgency({ status: String(t.status), due_date: due }, today),
    };
  });
  res.json({ tasks });
});

planningRouter.post('/host/:slug/tasks', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const b = req.body ?? {};
  const title = str(b.title, 200);
  if (!title) throw new HttpError(400, 'Task title is required.');
  const status = typeof b.status === 'string' && TASK_STATUSES.has(b.status) ? b.status : 'todo';
  const priority = typeof b.priority === 'string' && TASK_PRIORITIES.has(b.priority) ? b.priority : 'normal';
  const dueDate = b.due_date ? toDateStr(b.due_date) : null;
  if (b.due_date && !dueDate) throw new HttpError(400, 'due_date must be YYYY-MM-DD.');

  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    `INSERT INTO tasks (wedding_id, title, category, ceremony, assignee, status, priority, due_date, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'host') RETURNING id`,
    [w.id, title, str(b.category, 60) || null, str(b.ceremony, 60) || null, str(b.assignee, 80) || null, status, priority, dueDate],
  );
  res.status(201).json({ id: rows[0].id });
});

planningRouter.patch('/host/:slug/tasks/:id', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const db = await getDb();
  res.json(await updateTask(db, w.id, req.params.id, req.body ?? {}));
});

planningRouter.delete('/host/:slug/tasks/:id', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t ?? req.query.t);
  const db = await getDb();
  res.json(await deleteTask(db, w.id, req.params.id));
});

// ── Sample-wedding seed (§5.6) ───────────────────────────────────────────────

export async function seedSamplePlanning(db: Db, weddingId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const rel = (delta: number) => addDays(today, delta);

  // Skip if already seeded with vendors
  const existing = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM vendors WHERE wedding_id = $1', [weddingId]);
  if (Number(existing[0]?.n || 0) > 0) return { seeded: false };

  // 10 budget lines totalling ₹30,00,000 (₹30 L)
  const budgetSeed: [string, number][] = [
    ['Venue', 10_00_000],
    ['Catering', 7_50_000],
    ['Decor', 4_00_000],
    ['Photography', 2_50_000],
    ['Makeup', 1_20_000],
    ['DJ & Music', 1_30_000],
    ['Mehendi artist', 60_000],
    ['Transport', 90_000],
    ['Invitations', 80_000],
    ['Gifts', 1_20_000],
  ];
  for (const [cat, planned] of budgetSeed) {
    await db.query(
      'INSERT INTO budget_lines (wedding_id, category, planned) VALUES ($1, $2, $3) ON CONFLICT (wedding_id, category) DO NOTHING',
      [weddingId, cat, planned],
    );
  }

  // 12 vendors, mixed statuses (no real phone numbers)
  const vendorSeed: [string, string, string, string, number, string[], string][] = [
    ['Venue', 'Rambagh Courtyard & Lawns', 'booked', 'shared', 9_80_000, ['Haldi', 'Reception'], 'Includes valet and bridal suite'],
    ['Catering', 'Rajwada Royal Caterers', 'booked', 'bride', 7_80_000, ['Haldi', 'Sangeet', 'Wedding'], 'Dedicated Jain counter included'],
    ['Decor', 'Marigold & Mirror Decor', 'booked', 'bride', 3_90_000, ['Haldi', 'Sangeet', 'Wedding'], 'Fresh mogra & marigold mandap'],
    ['Photography', 'Kathakar Wedding Films', 'booked', 'shared', 2_40_000, ['Haldi', 'Sangeet', 'Wedding', 'Reception'], '2 candid + 2 cinema + drone'],
    ['Makeup', 'Naina Kapoor MUA', 'negotiating', 'bride', 1_15_000, ['Sangeet', 'Wedding'], 'Trial scheduled next week'],
    ['Mehendi artist', 'Jaipur Bridal Henna', 'booked', 'bride', 55_000, ['Mehendi & Sangeet'], 'Bridal + 4 artists for guests'],
    ['DJ & Music', 'DJ Kabir & Dhol Collective', 'booked', 'groom', 1_25_000, ['Mehendi & Sangeet', 'Baraat & Pheras'], 'Sound + LED floor + 4 dhol'],
    ['Pandit', 'Pandit Ramesh Shastri', 'booked', 'shared', 31_000, ['Baraat & Pheras'], 'Samagri list confirmed'],
    ['Transport', 'Pink City Fleet & Innova', 'negotiating', 'groom', 85_000, ['Haldi', 'Baraat & Pheras'], '4 Innovas + 1 vintage baraat car'],
    ['Invitations', 'Kagaz & Gold Press', 'shortlisted', 'bride', 75_000, [], '300 boxed sweet hampers + cards'],
    ['Clothing', 'Sabyasachi & Local Tailors', 'shortlisted', 'bride', 2_20_000, ['Wedding'], 'Final fittings due'],
    ['Gifts', 'Jaipur Blue Pottery Favours', 'negotiating', 'shared', 1_10_000, ['Reception'], '150 return gift boxes'],
  ];

  const vendorIds = new Map<string, string>();
  for (const [cat, name, status, who_pays, quoted, ceremonies, notes] of vendorSeed) {
    const r = await db.query<{ id: string }>(
      `INSERT INTO vendors (wedding_id, category, name, status, who_pays, quoted, ceremonies, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [weddingId, cat, name, status, who_pays, quoted, ceremonies, notes],
    );
    vendorIds.set(name, r[0].id);
  }

  // 8 payments: some paid, some due this week, one overdue
  const paymentSeed: [string, string, number, string, string | null][] = [
    ['Rambagh Courtyard & Lawns', 'Venue booking advance (40%)', 4_00_000, rel(-30), rel(-32)],
    ['Rambagh Courtyard & Lawns', 'Second venue instalment', 3_00_000, rel(4), null],
    ['Rajwada Royal Caterers', 'Catering token advance', 2_50_000, rel(-20), rel(-21)],
    ['Rajwada Royal Caterers', 'Menu tasting & 2nd advance', 2_00_000, rel(-3), null], // overdue!
    ['Marigold & Mirror Decor', 'Decor design advance', 1_50_000, rel(-12), rel(-12)],
    ['Kathakar Wedding Films', 'Photography booking advance', 1_00_000, rel(-15), rel(-15)],
    ['DJ Kabir & Dhol Collective', 'DJ & sound confirmation', 60_000, rel(3), null], // due this week
    ['Jaipur Bridal Henna', 'Mehendi advance', 25_000, rel(6), null], // due this week
  ];
  for (const [vName, label, amount, due, paid] of paymentSeed) {
    await db.query(
      'INSERT INTO payments (wedding_id, vendor_id, label, amount, due_date, paid_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [weddingId, vendorIds.get(vName) ?? null, label, amount, due, paid],
    );
  }

  // 14 tasks: some overdue, some this week, some done, some later
  const taskSeed: [string, string, string, string, string, string, string | null][] = [
    ['Confirm Jain menu count with Rajwada Caterers', 'Catering', 'Wedding', 'Sunita', 'todo', 'critical', rel(-4)],
    ['Pay overdue catering 2nd advance', 'Catering', 'Wedding', 'Rajesh', 'todo', 'critical', rel(-2)],
    ['Finalise bridal makeup trial with Naina Kapoor', 'Makeup', 'Wedding', 'Meera', 'doing', 'high', rel(2)],
    ['Book 4 airport pickup Innovas', 'Transport', 'Haldi', 'Rohan', 'todo', 'high', rel(3)],
    ['Share Sangeet song list with DJ Kabir', 'DJ & Music', 'Mehendi & Sangeet', 'Ananya', 'todo', 'normal', rel(5)],
    ['Send WhatsApp reminders to pending guests', 'Invitations', '', 'Meera', 'todo', 'high', rel(4)],
    ['Approve marigold mandap moodboard', 'Decor', 'Baraat & Pheras', 'Sunita', 'waiting', 'normal', rel(10)],
    ['Confirm Pandit ji samagri list', 'Pandit', 'Baraat & Pheras', 'Anil', 'done', 'normal', rel(-10)],
    ['Lock Rambagh Courtyard dates & contract', 'Venue', 'Haldi', 'Rajesh', 'done', 'critical', rel(-35)],
    ['Book candid photography team', 'Photography', 'Wedding', 'Rohan', 'done', 'high', rel(-20)],
    ['Order 150 Jaipur Blue Pottery return gifts', 'Gifts', 'Reception', 'Kavita', 'todo', 'normal', rel(18)],
    ['Arrange dhol & vintage car for Baraat', 'Transport', 'Baraat & Pheras', 'Rohan', 'todo', 'normal', rel(22)],
    ['Assign hotel rooms for outstation family', 'Venue', '', 'Sunita', 'todo', 'normal', rel(14)],
    ['Print ceremony welcome boards', 'Decor', '', 'Ananya', 'todo', 'normal', null],
  ];
  for (const [title, category, ceremony, assignee, status, priority, due] of taskSeed) {
    await db.query(
      `INSERT INTO tasks (wedding_id, title, category, ceremony, assignee, status, priority, due_date, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'host')`,
      [weddingId, title, category, ceremony || null, assignee, status, priority, due],
    );
  }

  // 1 sheet: "Sangeet song list" with 8 rows
  const cols = [
    { id: 'c1', name: 'Performer', type: 'text' },
    { id: 'c2', name: 'Song', type: 'text' },
    { id: 'c3', name: 'Side', type: 'text' },
    { id: 'c4', name: 'Duration (min)', type: 'number' },
    { id: 'c5', name: 'Track ready', type: 'check' },
  ];
  const sRows = [
    ['Bride cousins', 'London Thumakda', 'Bride', 4, true],
    ['Meera & Rohan', 'Kesariya + Raataan Lambiyan', 'Both', 5, true],
    ['Groom friends', 'Gallan Goodiyaan', 'Groom', 4, false],
    ['Parents', 'Din Shagna Da / Tenu Leke', 'Both', 3, true],
    ['Bride sisters', 'Nachde Ne Saare', 'Bride', 4, true],
    ['Kids troupe', 'Badtameez Dil', 'Both', 3, false],
    ['Chacha & Masi', 'Sadi Gali', 'Bride', 3, false],
    ['Finale flashmob', 'Kala Chashma', 'Both', 4, true],
  ].map((r, i) => ({
    id: `r${i + 1}`,
    cells: { c1: r[0], c2: r[1], c3: r[2], c4: r[3], c5: r[4] },
  }));
  await db.query(
    'INSERT INTO sheets (wedding_id, name, columns, rows) VALUES ($1, $2, $3, $4)',
    [weddingId, 'Sangeet song list', JSON.stringify(cols), JSON.stringify(sRows)],
  );

  // Seed 12 sample guests if none exist (NO phone numbers per AGENTS.md rule 3)
  const gCount = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM rsvps WHERE wedding_id = $1', [weddingId]);
  if (Number(gCount[0]?.n || 0) === 0) {
    const sampleGuests: [string, string, number, string, string, string, string, string, Record<string, unknown> | null][] = [
      ['Nani ji', 'yes', 3, 'bride', 'Close Family', 'Maternal grandmother', '201', 'Jain food please, landing 11 Feb 5:30 pm', { adults: 2, children: 1, arrival_date: '2027-02-11', arrival_time: '17:30', arrival_mode: 'flight', arrival_point: 'Jaipur airport', needs_pickup: true, dietary: 'Jain' }],
      ['Sharma Uncle & Aunty', 'yes', 2, 'bride', 'Close Family', 'Chacha ji', '202', 'Arriving 11 Feb 2 pm by flight, pickup needed', { adults: 2, children: 0, arrival_date: '2027-02-11', arrival_time: '14:00', arrival_mode: 'flight', arrival_point: 'Jaipur airport', needs_pickup: true, dietary: 'Vegetarian' }],
      ['Priya & Karan', 'yes', 2, 'bride', 'College Friends', 'Best friend', '304', 'IndiGo from Mumbai 11 Feb 1:45 pm', { adults: 2, children: 0, arrival_date: '2027-02-11', arrival_time: '13:45', arrival_mode: 'flight', arrival_point: 'Jaipur airport', flight_or_train: '6E 512', needs_pickup: true }],
      ['Malhotra Cousins', 'yes', 4, 'groom', 'Close Family', 'Cousins', '305', 'Driving from Delhi on 11 Feb evening', { adults: 4, children: 0, arrival_date: '2027-02-11', arrival_time: '19:00', arrival_mode: 'car', needs_pickup: false }],
      ['Vikram Bhaiya', 'yes', 3, 'groom', 'Close Family', 'Elder brother', '203', 'Flight 11 Feb 5:45 pm with daughter', { adults: 2, children: 1, arrival_date: '2027-02-11', arrival_time: '17:45', arrival_mode: 'flight', arrival_point: 'Jaipur airport', needs_pickup: true }],
      ['Ananya', 'yes', 1, 'bride', 'Office Friends', 'Colleague', '308', 'Vegan meals please, landing 12 Feb 10 am', { adults: 1, children: 0, arrival_date: '2027-02-12', arrival_time: '10:00', arrival_mode: 'flight', arrival_point: 'Jaipur airport', needs_pickup: false, dietary: 'Vegan' }],
      ['Aditya Verma', 'maybe', 2, 'bride', 'College Friends', 'Friend', '', 'Confirming leave by Friday', null],
      ['Kavya Nair', 'maybe', 1, 'groom', 'Office Friends', 'Manager', '', 'Trying to make it for Sangeet & Reception', null],
      ['Gupta Family', 'pending', 4, 'bride', 'Family Friends', 'Neighbours', '', '', null],
      ['Kapoor Family', 'pending', 3, 'groom', 'Family Friends', 'Dad colleague', '', '', null],
      ['Siddharth & Ritu', 'pending', 2, 'groom', 'College Friends', 'Roommate', '', '', null],
      ['Farhan', 'no', 1, 'bride', 'College Friends', 'Friend', '', 'Travelling abroad, sending all my love!', null],
    ];
    for (const [name, status, party, side, group, relation, room, note, extracted] of sampleGuests) {
      await db.query(
        `INSERT INTO rsvps (wedding_id, guest_token, name, phone, status, party_size, side, group_name, relation, room, source, note, extracted)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, 'host', $10, $11)`,
        [weddingId, makeToken(), name, status, party, side, group, relation, room || null, note || null, extracted ? JSON.stringify(extracted) : null],
      );
    }
  }

  return { seeded: true };
}

planningRouter.post('/host/:slug/seed-sample', async (req, res) => {
  const w = await hostWeddingRow(req.params.slug, req.body?.t);
  const db = await getDb();
  const r = await seedSamplePlanning(db, w.id);
  res.json({ ok: true, ...r });
});

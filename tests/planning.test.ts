// Planning CRUD scoping, computeBudget and urgency tests (§10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { openLite, schemaSql } from '../server/db.ts';
import {
  computeBudget,
  deletePayment,
  deleteRunsheetItem,
  deleteTask,
  deleteVendor,
  listVendors,
  publicRunsheet,
  seedSamplePlanning,
  updatePayment,
  updateRunsheetItem,
  updateTask,
  updateVendor,
  urgency,
} from '../server/planning.ts';
import { normalizeDraft } from '../server/wedding.ts';
import { HttpError } from '../server/gemini.ts';

const db = await openLite(schemaSql(), undefined, 'memory://planning-test');
const draft = normalizeDraft({
  partner1_name: 'Asha',
  partner2_name: 'Vikram',
  city: 'Pune',
  style: 'royal-rajasthani',
  events: [{ name: 'Wedding', date: '2027-02-20', start_time: '20:00', venue_name: 'Taj' }],
});

const [wA] = await db.query<{ id: string }>(
  'INSERT INTO weddings (slug, host_token, draft, style) VALUES ($1, $2, $3, $4) RETURNING id',
  ['wedding-a', 'tok-a', JSON.stringify(draft), draft.style],
);
const [wB] = await db.query<{ id: string }>(
  'INSERT INTO weddings (slug, host_token, draft, style) VALUES ($1, $2, $3, $4) RETURNING id',
  ['wedding-b', 'tok-b', JSON.stringify(draft), draft.style],
);

test('computeBudget calculates planned, committed, paid, due_30d and over', () => {
  const res = computeBudget(
    [
      { category: 'Venue', planned: 500000 },
      { category: 'Catering', planned: 300000 },
    ],
    [
      { id: 'v1', category: 'Venue', status: 'booked', quoted: 600000 },
      { id: 'v2', category: 'Venue', status: 'shortlisted', quoted: 900000 },
      { id: 'v3', category: 'Catering', status: 'booked', quoted: 250000 },
    ],
    [
      { vendor_id: 'v1', amount: 200000, due_date: '2026-11-01', paid_at: '2026-11-01' },
      { vendor_id: 'v1', amount: 150000, due_date: '2026-12-05', paid_at: null },
      { vendor_id: 'v3', amount: 100000, due_date: '2027-02-01', paid_at: null },
    ],
    '2026-11-20',
  );
  assert.equal(res.total_planned, 800000);
  assert.equal(res.total_committed, 850000);
  assert.equal(res.total_paid, 200000);
  assert.equal(res.total_due_30d, 150000);
  const venue = res.categories.find((c) => c.category === 'Venue')!;
  assert.equal(venue.over, true);
  const catering = res.categories.find((c) => c.category === 'Catering')!;
  assert.equal(catering.over, false);
  assert.equal(catering.due_30d, 0);
});

test('urgency buckets tasks around today', () => {
  const today = '2026-11-20';
  assert.equal(urgency({ status: 'done', due_date: '2026-11-10' }, today), 'done');
  assert.equal(urgency({ status: 'todo', due_date: null }, today), 'undated');
  assert.equal(urgency({ status: 'todo', due_date: '2026-11-19' }, today), 'overdue');
  assert.equal(urgency({ status: 'todo', due_date: '2026-11-20' }, today), 'this_week');
  assert.equal(urgency({ status: 'todo', due_date: '2026-11-27' }, today), 'this_week');
  assert.equal(urgency({ status: 'todo', due_date: '2026-11-28' }, today), 'later');
});

test('CRUD scoping: wedding B cannot read, patch or delete wedding A vendors, tasks or payments', async () => {
  const [v] = await db.query<{ id: string }>(
    "INSERT INTO vendors (wedding_id, category, name, status, quoted) VALUES ($1, 'Venue', 'Secret Venue', 'booked', 100000) RETURNING id",
    [wA.id],
  );
  const [t] = await db.query<{ id: string }>(
    "INSERT INTO tasks (wedding_id, title) VALUES ($1, 'Secret Task') RETURNING id",
    [wA.id],
  );
  const [p] = await db.query<{ id: string }>(
    "INSERT INTO payments (wedding_id, vendor_id, label, amount) VALUES ($1, $2, 'Advance', 50000) RETURNING id",
    [wA.id, v.id],
  );

  // Wedding B sees zero vendors
  assert.equal((await listVendors(db, wB.id)).length, 0);
  assert.equal((await listVendors(db, wA.id)).length, 1);

  // Patching or deleting wedding A rows as wedding B throws 404
  const expect404 = async (fn: () => Promise<unknown>) => {
    await assert.rejects(fn, (e: unknown) => e instanceof HttpError && e.status === 404);
  };
  await expect404(() => updateVendor(db, wB.id, v.id, { name: 'Hacked' }));
  await expect404(() => deleteVendor(db, wB.id, v.id));
  await expect404(() => updateTask(db, wB.id, t.id, { status: 'done' }));
  await expect404(() => deleteTask(db, wB.id, t.id));
  await expect404(() => updatePayment(db, wB.id, p.id, { paid_at: '2026-11-20' }));
  await expect404(() => deletePayment(db, wB.id, p.id));

  // Wedding A can update and delete its own rows
  await updateTask(db, wA.id, t.id, { status: 'done' });
  await updatePayment(db, wA.id, p.id, { paid_at: '2026-11-20' });
  await deletePayment(db, wA.id, p.id);
  await deleteTask(db, wA.id, t.id);
  await deleteVendor(db, wA.id, v.id);
});

test('seedSamplePlanning populates 12 vendors, 10 budget lines, 8 payments, 14 tasks, 1 sheet and guests with no phones', async () => {
  await seedSamplePlanning(db, wB.id);
  const [vc] = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM vendors WHERE wedding_id = $1', [wB.id]);
  const [bc] = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM budget_lines WHERE wedding_id = $1', [wB.id]);
  const [pc] = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM payments WHERE wedding_id = $1', [wB.id]);
  const [tc] = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM tasks WHERE wedding_id = $1', [wB.id]);
  const [sc] = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM sheets WHERE wedding_id = $1', [wB.id]);
  const [phones] = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM rsvps WHERE wedding_id = $1 AND phone IS NOT NULL', [wB.id]);
  assert.equal(Number(vc.n), 12);
  assert.equal(Number(bc.n), 10);
  assert.equal(Number(pc.n), 8);
  assert.equal(Number(tc.n), 14);
  assert.equal(Number(sc.n), 1);
  assert.equal(Number(phones.n), 0);
});

test('runsheet_items scoping and publicRunsheet visibility', async () => {
  const [r1] = await db.query<{ id: string }>(
    `INSERT INTO runsheet_items (wedding_id, date, start_time, title, place, show_to_guests)
     VALUES ($1, '2027-02-20', '16:00', 'Guest shuttle departs', 'Lobby', true) RETURNING id`,
    [wA.id],
  );
  const [r2] = await db.query<{ id: string }>(
    `INSERT INTO runsheet_items (wedding_id, date, start_time, title, place, show_to_guests)
     VALUES ($1, '2027-02-20', '14:00', 'Internal vendor load-in', 'Back gate', false) RETURNING id`,
    [wA.id],
  );

  // publicRunsheet only exposes show_to_guests=true items for that wedding
  const pubA = await publicRunsheet(db, wA.id);
  assert.equal(pubA.length, 1);
  assert.equal(pubA[0].title, 'Guest shuttle departs');
  assert.equal((await publicRunsheet(db, wB.id)).length, 0);

  // Wedding B cannot patch or delete wedding A's runsheet item
  await assert.rejects(
    () => updateRunsheetItem(db, wB.id, r1.id, { title: 'Hacked' }),
    (e: unknown) => e instanceof HttpError && e.status === 404,
  );
  await assert.rejects(
    () => deleteRunsheetItem(db, wB.id, r1.id),
    (e: unknown) => e instanceof HttpError && e.status === 404,
  );

  await updateRunsheetItem(db, wA.id, r2.id, { show_to_guests: true });
  const pubA2 = await publicRunsheet(db, wA.id);
  assert.equal(pubA2.length, 2);
  assert.equal(pubA2[0].title, 'Internal vendor load-in'); // 14:00 before 16:00

  await deleteRunsheetItem(db, wA.id, r1.id);
  await deleteRunsheetItem(db, wA.id, r2.id);
});

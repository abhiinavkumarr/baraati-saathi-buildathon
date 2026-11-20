// The control room's numbers come from code, not the model. Pin them down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyProposal, computeStats } from '../server/control.ts';
import { emptyDraft } from '../server/wedding.ts';
import { openLite, schemaSql } from '../server/db.ts';

const g = (name: string, status: 'yes' | 'no' | 'maybe', party_size: number, extracted: Record<string, unknown> | null = null) =>
  ({ id: name, name, phone: null, status, party_size, created_at: '', extracted });

const draft = {
  ...emptyDraft(),
  events: [{ name: 'Mehendi', date: '2099-02-11', start_time: '16:00', venue_name: 'x', venue_address: '', dress_code: '', notes: '' }],
};

const rows = [
  g('Nani ji', 'yes', 3, { children: 1, arrival_date: '2099-02-12', needs_pickup: true, dietary: 'Jain' }),
  g('Gupta family', 'yes', 5, { children: 2, arrival_date: '2099-02-11', dietary: 'Jain food for my mother' }),
  g('Priya', 'maybe', 2, { arrival_date: '2099-02-11', needs_pickup: true, dietary: 'nut allergy' }),
  g('Neha', 'no', 1, { needs_pickup: true, dietary: 'vegan' }),
  g('Rohan', 'yes', 1, { arrival_date: 'soon' }),
];

test('headcounts count yes + maybe only', () => {
  const s = computeStats(rows as never, draft);
  assert.deepEqual([s.replied, s.yes, s.maybe, s.no, s.heads, s.kids], [5, 3, 1, 1, 11, 3]);
});

test('pickups ignore guests who said no', () => {
  const s = computeStats(rows as never, draft);
  assert.equal(s.pickups, 2);
  assert.equal(s.pickup_people, 5);
});

test('food needs are counted per household, never multiplied by party size', () => {
  const s = computeStats(rows as never, draft);
  assert.deepEqual(s.diet, [{ label: 'Jain', households: 2 }, { label: 'Allergy', households: 1 }]);
});

test('arrivals group by valid dates, with pickups, in date order', () => {
  const s = computeStats(rows as never, draft);
  assert.deepEqual(s.arrivals.map((a) => [a.date, a.people, a.pickups]), [['2099-02-11', 7, 2], ['2099-02-12', 3, 3]]);
});

test('days to the wedding counts down to the first ceremony', () => {
  const s = computeStats([], draft);
  assert.ok(s.days_to_wedding! > 365 * 70);
  assert.equal(computeStats([], emptyDraft()).days_to_wedding, null);
});

test('applyProposal writes new planning proposal kinds scoped to this wedding only', async () => {
  const db = await openLite(schemaSql(), undefined, 'memory://control-apply-test');
  const [wA] = await db.query<{ id: string }>(
    "INSERT INTO weddings (slug, host_token, draft, style) VALUES ('wa', 'ta', $1, 'royal-rajasthani') RETURNING id",
    [JSON.stringify(draft)],
  );
  const [wB] = await db.query<{ id: string }>(
    "INSERT INTO weddings (slug, host_token, draft, style) VALUES ('wb', 'tb', $1, 'royal-rajasthani') RETURNING id",
    [JSON.stringify(draft)],
  );
  await db.query(
    "INSERT INTO rsvps (wedding_id, guest_token, name, status, party_size) VALUES ($1, 'gt-a', 'Nani ji', 'yes', 2), ($2, 'gt-b', 'Nani ji', 'yes', 2)",
    [wA.id, wB.id],
  );
  const ctxA = { id: wA.id, slug: 'wa', draft: { ...draft } };

  await applyProposal(db, ctxA, { kind: 'tasks', payload: { tasks: [{ title: 'Book mehendi', due_date: '2027-01-10', category: 'Mehendi artist', priority: 'high' }] } }, 'http://x/i/wa');
  await applyProposal(db, ctxA, { kind: 'vendor', payload: { name: 'Henna Art', category: 'Mehendi artist', status: 'booked', quoted: 25000 } }, 'http://x/i/wa');
  await applyProposal(db, ctxA, { kind: 'payment', payload: { vendor_name: 'Henna Art', label: 'Advance', amount: 10000, paid: true } }, 'http://x/i/wa');
  await applyProposal(db, ctxA, { kind: 'budget_line', payload: { category: 'Mehendi artist', planned: 30000 } }, 'http://x/i/wa');
  await applyProposal(db, ctxA, { kind: 'rooming', payload: { rooms: [{ room: '401', guest_names: ['Nani ji'] }] } }, 'http://x/i/wa');
  await applyProposal(db, ctxA, { kind: 'pickups', payload: { cabs: [{ time: '2:00 PM', point: 'Airport', guest_names: ['Nani ji'] }] } }, 'http://x/i/wa');

  // Verify wA has all rows and wB was untouched
  assert.equal((await db.query('SELECT id FROM tasks WHERE wedding_id = $1', [wA.id])).length, 2); // 1 from tasks + 1 from pickups
  assert.equal((await db.query('SELECT id FROM tasks WHERE wedding_id = $1', [wB.id])).length, 0);
  assert.equal((await db.query('SELECT id FROM vendors WHERE wedding_id = $1', [wA.id])).length, 1);
  assert.equal((await db.query('SELECT id FROM payments WHERE wedding_id = $1', [wA.id])).length, 1);
  assert.equal((await db.query('SELECT id FROM budget_lines WHERE wedding_id = $1', [wA.id])).length, 1);
  const [gA] = await db.query<{ room: string | null }>('SELECT room FROM rsvps WHERE wedding_id = $1', [wA.id]);
  const [gB] = await db.query<{ room: string | null }>('SELECT room FROM rsvps WHERE wedding_id = $1', [wB.id]);
  assert.equal(gA.room, '401');
  assert.equal(gB.room, null);
});

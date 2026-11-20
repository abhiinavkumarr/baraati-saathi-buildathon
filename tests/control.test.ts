// The control room's numbers come from code, not the model. Pin them down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../server/control.ts';
import { emptyDraft } from '../server/wedding.ts';

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

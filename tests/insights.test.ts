// The guest-list sandbox: model-written SQL must only ever see one wedding's
// rows, never phone numbers, and never change anything.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openLite, schemaSql, type Db } from '../server/db.ts';
import { checkSql, runScoped } from '../server/insights.ts';
import { emptyDraft } from '../server/wedding.ts';

let db: Db;
let mine = '';
let other = '';

before(async () => {
  db = await openLite(schemaSql(), undefined, 'memory://');
  const w = async (slug: string) =>
    (await db.query<{ id: string }>(
      `INSERT INTO weddings (slug, host_token, draft) VALUES ($1, 'tok', '{}') RETURNING id`,
      [slug],
    ))[0].id;
  mine = await w('riya-kabir');
  other = await w('someone-else');
  const rsvp = (wid: string, name: string, status: string, party: number, extracted: object | null, phone = '9876543210') =>
    db.query(
      `INSERT INTO rsvps (wedding_id, guest_token, name, phone, status, party_size, extracted)
       VALUES ($1, gen_random_uuid()::text, $2, $3, $4, $5, $6)`,
      [wid, name, phone, status, party, extracted ? JSON.stringify(extracted) : null],
    );
  await rsvp(mine, 'Nani ji', 'yes', 3, { adults: 2, children: 1, arrival_date: '2027-02-12', arrival_time: '17:40', needs_pickup: true, dietary: 'Jain', arrival_point: 'Udaipur airport' });
  await rsvp(mine, 'Aditya', 'maybe', 2, { adults: 2, children: 0, arrival_mode: 'car', needs_pickup: false, dietary: '' });
  await rsvp(mine, 'Meera', 'no', 1, null);
  await rsvp(other, 'Stranger', 'yes', 5, { needs_pickup: true });
});

const draft = () => ({
  ...emptyDraft(),
  events: [{ name: 'Sangeet', date: '2027-02-12', start_time: '19:30', venue_name: 'Lake Palace', venue_address: '', dress_code: '', notes: '' }],
});

test('answers a headcount from this wedding only', async () => {
  const r = await runScoped(db, mine, draft(), "SELECT sum(party_size) AS people FROM guests WHERE status IN ('yes','maybe')");
  assert.equal(Number(r.rows[0].people), 5); // Stranger's 5 never counted
});

test('typed columns come from the AI-extracted note', async () => {
  const r = await runScoped(db, mine, draft(), 'SELECT name, arrival_date, arrival_time FROM guests WHERE needs_pickup');
  assert.deepEqual(r.rows, [{ name: 'Nani ji', arrival_date: '2027-02-12', arrival_time: '17:40' }]);
});

test('joins guests to the ceremony schedule', async () => {
  const r = await runScoped(db, mine, draft(), 'SELECT g.name FROM guests g JOIN events e ON e.date = g.arrival_date');
  assert.deepEqual(r.rows.map((x) => x.name), ['Nani ji']);
});

test('phone numbers do not exist in the sandbox', async () => {
  await assert.rejects(runScoped(db, mine, draft(), 'SELECT phone FROM guests'), /phone/);
});

test('the real tables are unreachable even if the static check is bypassed', async () => {
  await assert.rejects(runScoped(db, mine, draft(), 'SELECT name FROM public.rsvps'), /permission denied/);
  await assert.rejects(runScoped(db, mine, draft(), 'SELECT host_token FROM public.weddings'), /permission denied/);
});

test('nothing written inside the sandbox survives', async () => {
  await runScoped(db, mine, draft(), 'SELECT 1 AS x').catch(() => {});
  const before = await db.query('SELECT count(*)::int AS n FROM rsvps');
  // The owner-side setup inserts into temp tables; all of it is rolled back.
  const tables = await db.query(`SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('guests','events') AND relpersistence = 't'`);
  assert.equal(tables[0].n, 0);
  assert.equal(before[0].n, 4);
});

test('normal queries still work after a sandbox (role is reset)', async () => {
  const r = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM weddings');
  assert.equal(r[0].n, 2);
});

test('checkSql accepts plain reads', () => {
  assert.equal(checkSql('SELECT name FROM guests;'), 'SELECT name FROM guests');
  assert.ok(checkSql("WITH c AS (SELECT * FROM guests) SELECT count(*) FROM c WHERE note ILIKE '%delete%'"));
});

test('checkSql rejects writes, stacking, comments and system objects', () => {
  for (const bad of [
    'DELETE FROM guests',
    'SELECT 1; DROP TABLE rsvps',
    'SELECT * FROM guests -- hi',
    'SELECT * FROM rsvps',
    'SELECT * FROM public.weddings',
    'SELECT pg_read_file($$/etc/passwd$$)',
    'SELECT current_setting(\'x\')',
    'SELECT * INTO hack FROM guests',
    'UPDATE guests SET name = 1',
  ]) {
    assert.throws(() => checkSql(bad), undefined, bad);
  }
});

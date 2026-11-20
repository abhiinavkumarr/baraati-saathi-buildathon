// Saathi's tools run with the wedding and guest token from the request, never
// ids the model supplies. These tests pin that scoping down.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.PGLITE_DIR = 'memory://';
delete process.env.DATABASE_URL;
const { getDb } = await import('../server/db.ts');
const { context, runTool, publicDetails, TOOL_DEFS } = await import('../server/saathi.ts');

const draft = {
  partner1_name: 'Riya', partner2_name: 'Kabir', city: 'Udaipur',
  events: [{ name: 'Sangeet', date: '2027-02-12', start_time: '19:30', venue_name: 'Lake Palace' }],
  info: [{ question: 'Parking?', answer: 'Valet at the gate' }],
  contact_name: 'Rohan', contact_phone: '+919800000000',
};

before(async () => {
  const db = await getDb();
  for (const slug of ['riya-kabir', 'other-wedding']) {
    const [w] = await db.query<{ id: string }>(
      `INSERT INTO weddings (slug, host_token, draft) VALUES ($1, 'host-secret', $2) RETURNING id`,
      [slug, JSON.stringify(draft)],
    );
    await db.query(
      `INSERT INTO rsvps (wedding_id, guest_token, name, phone, status, party_size, extracted)
       VALUES ($1, $2, $3, '9876543210', 'yes', 2, $4)`,
      [
        w.id,
        `guest-${slug}`,
        slug === 'riya-kabir' ? 'Nani ji' : 'Stranger',
        JSON.stringify({ flight_or_train: '6E 2145', arrival_date: '2027-02-12', needs_pickup: true }),
      ],
    );
  }
});

test('public details hold only what the host published', () => {
  const json = JSON.stringify(publicDetails(draft as never));
  assert.ok(json.includes('Lake Palace') && json.includes('Valet'));
  assert.ok(!json.includes('host-secret'));
  assert.ok(!json.includes('9876543210'));
});

test('a guest sees their own RSVP and extracted travel plan', async () => {
  const ctx = await context('riya-kabir', 'guest-riya-kabir');
  const r = (await runTool(ctx, 'get_my_rsvp', {})) as { rsvp: { name: string; extracted: { flight_or_train: string; needs_pickup: boolean } } };
  assert.equal(r.rsvp.name, 'Nani ji');
  assert.equal(r.rsvp.extracted.flight_or_train, '6E 2145');
  assert.equal(r.rsvp.extracted.needs_pickup, true);
});

test("another wedding's guest token reads nothing here", async () => {
  const ctx = await context('riya-kabir', 'guest-other-wedding');
  const r = (await runTool(ctx, 'get_my_rsvp', {})) as { rsvp: unknown };
  assert.equal(r.rsvp, null);
});

test('update_rsvp changes only the caller’s row and ignores injected ids', async () => {
  const ctx = await context('riya-kabir', 'guest-riya-kabir');
  const r = (await runTool(ctx, 'update_rsvp', { status: 'maybe', party_size: 4, wedding_id: 'x', guest_token: 'guest-other-wedding' })) as { ok: boolean };
  assert.equal(r.ok, true);
  const db = await getDb();
  const rows = await db.query<{ name: string; status: string; party_size: number }>('SELECT name, status, party_size FROM rsvps ORDER BY name');
  assert.deepEqual(rows, [
    { name: 'Nani ji', status: 'maybe', party_size: 4 },
    { name: 'Stranger', status: 'yes', party_size: 2 },
  ]);
});

test('update_rsvp without an RSVP on this device is refused', async () => {
  const ctx = await context('riya-kabir', '');
  const r = (await runTool(ctx, 'update_rsvp', { status: 'no' })) as { ok: boolean };
  assert.equal(r.ok, false);
});

test('ask_host files the question under this wedding', async () => {
  const ctx = await context('riya-kabir', 'guest-riya-kabir');
  await runTool(ctx, 'ask_host', { question: 'Is there a shuttle from the airport?' });
  const db = await getDb();
  const rows = await db.query<{ slug: string }>(
    'SELECT w.slug FROM questions q JOIN weddings w ON w.id = q.wedding_id',
  );
  assert.deepEqual(rows.map((r) => r.slug), ['riya-kabir']);
});

test('unknown tools are not executed', async () => {
  const ctx = await context('riya-kabir', 'guest-riya-kabir');
  assert.deepEqual(await runTool(ctx, 'drop_everything', {}), { error: 'Unknown tool drop_everything' });
  assert.deepEqual(TOOL_DEFS.map((t) => t.name).sort(), ['ask_host', 'get_my_rsvp', 'get_wedding_details', 'update_rsvp']);
});

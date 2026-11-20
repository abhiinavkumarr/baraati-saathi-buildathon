// Private-wedding import and access-control tests (§9, §10).
// Uses a synthetic fixture only — never touches .data/import/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openLite, schemaSql } from '../server/db.ts';
import { importWeddingData, mapImportSide, mapImportStatus, type ImportFileV1 } from '../server/import.ts';
import { listUserWeddings, loginUser, safeEqual } from '../server/auth.ts';

const db = await openLite(schemaSql(), undefined, 'memory://import-test');

const FIXTURE: ImportFileV1 = {
  format: 'saathi-import-v1',
  owner: { name: 'Kavita Fixture', contact: '98000 11223', only_owner: true },
  wedding: {
    bride_name: 'Tara',
    groom_name: 'Dev',
    hashtag: '#TaraDev2027',
    venue_name: 'Lakeview Palace',
    city: 'Udaipur',
    host_side: 'bride',
    expected_guests: 120,
  },
  events: [
    { name: 'Haldi', date: '2027-03-10', start_time: '10:30', venue_name: 'Courtyard', dress_code: 'Yellow' },
    { name: 'Wedding', date: '2027-03-11', start_time: '19:00', venue_name: 'Lakeview Palace' },
  ],
  venues: [{ name: 'Lakeview Palace', address: 'Lake Road, Udaipur', is_primary: true }],
  info: [{ question: 'Parking?', answer: 'Valet at main gate.' }],
  groups: [
    { name: 'Bride Family', member_refs: ['g1', 'g2'] },
    { name: 'College Crew', member_refs: ['g3'] },
  ],
  guests: [
    {
      ref: 'g1',
      name: 'Kavita Fixture',
      is_host: true,
      side: "Bride's side",
      rsvp: 'confirmed',
      room: 'Home',
      travel: null,
    },
    {
      ref: 'g2',
      name: 'Ramesh Chacha',
      is_host: false,
      side: 'Bride Family',
      rsvp: 'yes',
      room: '3005',
      travel: { arrival_date: '2027-03-09', arrival_time: '9:45', mode: 'Flight', from: 'Udaipur Airport', number: 'AI 471' },
    },
    {
      ref: 'g3',
      name: 'Nikhil Rao',
      is_host: false,
      side: 'Groom Friends',
      rsvp: 'maybe',
      room: null,
      travel: null,
    },
    {
      ref: 'g4',
      name: 'Sonia Mehta',
      is_host: false,
      side: 'Other',
      rsvp: 'unknown_status',
      room: 'Not coming',
      travel: null,
    },
  ],
  added_people: [
    { name: 'Asha Chachi', side: 'Bride', rsvp: 'yes', room: '3005', came_with_ref: 'g2', travel: null },
  ],
};

test('mapImportSide and mapImportStatus normalise cleanly', () => {
  assert.equal(mapImportSide("Bride's family"), 'bride');
  assert.equal(mapImportSide('Groom Friends'), 'groom');
  assert.equal(mapImportSide('Vendor'), null);
  assert.equal(mapImportStatus('confirmed'), 'yes');
  assert.equal(mapImportStatus('declined'), 'no');
  assert.equal(mapImportStatus('tentative'), 'maybe');
  assert.equal(mapImportStatus('???'), 'pending');
});

test('importWeddingData imports private wedding with mapped sides, statuses, rooms, travel and zero phones', async () => {
  const prev = process.env.OWNER_PASSCODE;
  process.env.OWNER_PASSCODE = 'fixture-pass-99';
  try {
    const summary = await importWeddingData(db, FIXTURE);
    assert.equal(summary.replaced, false);
    assert.equal(summary.guests_count, 3); // excludes host
    assert.equal(summary.hosts_count, 1);
    assert.equal(summary.added_people_count, 1);
    assert.equal(summary.with_travel, 1);

    // Zero phone numbers stored
    const phones = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rsvps WHERE source = 'import' AND phone IS NOT NULL",
    );
    assert.equal(Number(phones[0].n), 0);

    // Check mapped guest fields
    const guests = await db.query<{ name: string; side: string | null; status: string; room: string | null; group_name: string | null; extracted: Record<string, unknown> | null }>(
      "SELECT name, side, status, room, group_name, extracted FROM rsvps WHERE source = 'import' ORDER BY name",
    );
    const chacha = guests.find((g) => g.name === 'Ramesh Chacha')!;
    assert.equal(chacha.side, 'bride');
    assert.equal(chacha.status, 'yes');
    assert.equal(chacha.room, '3005');
    assert.equal(chacha.group_name, 'Bride Family');
    assert.equal(chacha.extracted?.arrival_time, '09:45');
    assert.equal(chacha.extracted?.arrival_point, 'Udaipur Airport');

    const sonia = guests.find((g) => g.name === 'Sonia Mehta')!;
    assert.equal(sonia.side, null);
    assert.equal(sonia.status, 'pending');
    assert.equal(sonia.room, 'Not coming');

    const chachi = guests.find((g) => g.name === 'Asha Chachi')!;
    assert.equal(chachi.group_name, 'Bride Family');

    // Only owner can list it (and requires passcode)
    const owner = await loginUser(db, 'Kavita Fixture', '+919800011223');
    const stranger = await loginUser(db, 'Stranger', 'stranger@example.com');

    assert.equal((await listUserWeddings(db, stranger.user.id, 'fixture-pass-99')).length, 0);

    const lockedList = await listUserWeddings(db, owner.user.id);
    assert.equal(lockedList.length, 1);
    assert.equal(lockedList[0].locked, true);
    assert.equal(lockedList[0].host_token, undefined);

    const unlockedList = await listUserWeddings(db, owner.user.id, 'fixture-pass-99');
    assert.equal(unlockedList.length, 1);
    assert.equal(unlockedList[0].locked, undefined);
    assert.ok(unlockedList[0].host_token);

    // Public invite check: private wedding requires matching host_token
    const [wRow] = await db.query<{ slug: string; host_token: string; private: boolean }>(
      'SELECT slug, host_token, private FROM weddings WHERE slug = $1',
      [summary.slug],
    );
    assert.equal(wRow.private, true);
    assert.equal(safeEqual('wrong', wRow.host_token), false);
    assert.equal(safeEqual(unlockedList[0].host_token!, wRow.host_token), true);

    // Idempotent re-import replaces the previous wedding
    const again = await importWeddingData(db, FIXTURE);
    assert.equal(again.replaced, true);
    const allForOwner = await listUserWeddings(db, owner.user.id, 'fixture-pass-99');
    assert.equal(allForOwner.length, 1);
  } finally {
    if (prev === undefined) delete process.env.OWNER_PASSCODE;
    else process.env.OWNER_PASSCODE = prev;
  }
});

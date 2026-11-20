// Accounts, sessions, per-user wedding scoping and private-wedding passcode tests (§10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { openLite, schemaSql } from '../server/db.ts';
import { listUserWeddings, loginUser, normalizeContact, sessionFromToken } from '../server/auth.ts';
import { normalizeDraft } from '../server/wedding.ts';

const db = await openLite(schemaSql(), undefined, 'memory://auth-test');

const sampleDraft = normalizeDraft({
  partner1_name: 'Asha',
  partner2_name: 'Vikram',
  city: 'Pune',
  style: 'royal-rajasthani',
  events: [{ name: 'Wedding', date: '2027-02-20', start_time: '20:00', venue_name: 'Taj' }],
});

test('normalizeContact handles Indian phones, E.164 and emails, rejects junk', () => {
  assert.equal(normalizeContact('98765 43210'), '+919876543210');
  assert.equal(normalizeContact('98765-43210'), '+919876543210');
  assert.equal(normalizeContact('+91 98765 43210'), '+919876543210');
  assert.equal(normalizeContact('+1 (415) 555-0199'), '+14155550199');
  assert.equal(normalizeContact('  Meera@Example.COM  '), 'meera@example.com');
  assert.equal(normalizeContact('12345'), null);
  assert.equal(normalizeContact('not-an-email'), null);
  assert.equal(normalizeContact(''), null);
});

test('two phone formats map to the exact same user', async () => {
  const a = await loginUser(db, 'Ananya', '98765 43210');
  const b = await loginUser(db, 'Ananya Sharma', '+91 9876543210');
  assert.equal(a.user.id, b.user.id);
  assert.notEqual(a.session, b.session);
  const resolved = await sessionFromToken(db, b.session);
  assert.equal(resolved?.id, a.user.id);
  assert.equal(resolved?.name, 'Ananya Sharma');
});

test('user B never sees user A weddings', async () => {
  const userA = await loginUser(db, 'Host A', 'hosta@example.com');
  const userB = await loginUser(db, 'Host B', 'hostb@example.com');

  await db.query(
    'INSERT INTO weddings (slug, host_token, draft, style, owner_user_id) VALUES ($1, $2, $3, $4, $5)',
    ['asha-vikram-1111', 'tok-a', JSON.stringify(sampleDraft), sampleDraft.style, userA.user.id],
  );

  const listA = await listUserWeddings(db, userA.user.id);
  const listB = await listUserWeddings(db, userB.user.id);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].slug, 'asha-vikram-1111');
  assert.equal(listA[0].host_token, 'tok-a');
  assert.equal(listB.length, 0);
});

test('private wedding returns locked without passcode and unlocks with OWNER_PASSCODE', async () => {
  const prev = process.env.OWNER_PASSCODE;
  process.env.OWNER_PASSCODE = 'secret-pass-42';
  try {
    const owner = await loginUser(db, 'Private Owner', 'priv@example.com');
    await db.query(
      'INSERT INTO weddings (slug, host_token, draft, style, owner_user_id, private) VALUES ($1, $2, $3, $4, $5, true)',
      ['priv-wedding-2222', 'tok-priv', JSON.stringify(sampleDraft), sampleDraft.style, owner.user.id],
    );

    const locked = await listUserWeddings(db, owner.user.id);
    assert.equal(locked.length, 1);
    assert.equal(locked[0].slug, 'priv-wedding-2222');
    assert.equal(locked[0].locked, true);
    assert.equal(locked[0].host_token, undefined);

    const wrong = await listUserWeddings(db, owner.user.id, 'wrong-pass');
    assert.equal(wrong[0].locked, true);
    assert.equal(wrong[0].host_token, undefined);

    const unlocked = await listUserWeddings(db, owner.user.id, 'secret-pass-42');
    assert.equal(unlocked[0].locked, undefined);
    assert.equal(unlocked[0].host_token, 'tok-priv');
    assert.equal(unlocked[0].couple, 'Asha & Vikram');
  } finally {
    if (prev === undefined) delete process.env.OWNER_PASSCODE;
    else process.env.OWNER_PASSCODE = prev;
  }
});

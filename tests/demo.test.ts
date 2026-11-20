// The shared demo wedding: created once, listed for every user, and read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { openLite, schemaSql } from '../server/db.ts';
import { listUserWeddings, loginUser } from '../server/auth.ts';
import { DEMO_READ_ONLY, demoGuard, ensurePlannerDemo, isDemoSlug } from '../server/demo.ts';

const db = await openLite(schemaSql(), undefined, 'memory://demo-test');

/** Run demoGuard on a fake request; returns 'next' or the refusal status. */
function guard(method: string, path: string): { passed: boolean; status?: number; body?: { error?: string } } {
  let passed = false;
  const out: { passed: boolean; status?: number; body?: { error?: string } } = { passed };
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: { error?: string }) {
      out.body = body;
      return this;
    },
  } as unknown as Response;
  demoGuard({ method, path } as Request, res, () => {
    passed = true;
  });
  out.passed = passed;
  return out;
}

test('the demo wedding is created once, with sample planning data', async () => {
  const a = await ensurePlannerDemo(db);
  const b = await ensurePlannerDemo(db);
  assert.equal(a.slug, b.slug, 'idempotent');
  assert.ok(isDemoSlug(a.slug));
  const [{ n }] = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM rsvps r JOIN weddings w ON w.id = r.wedding_id WHERE w.slug = $1',
    [a.slug],
  );
  assert.ok(n > 0, 'seeded guests');
});

test('every user sees the demo, marked demo, after their own weddings', async () => {
  const demo = await ensurePlannerDemo(db);
  const { user } = await loginUser(db, 'Someone New', 'new.person@example.com');
  const list = await listUserWeddings(db, user.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].slug, demo.slug);
  assert.equal(list[0].demo, true);
  assert.equal(list[0].couple, 'Meera & Rohan');
});

test('demo is read-only: writes refused, reads and AI previews allowed', async () => {
  const { slug } = await ensurePlannerDemo(db);
  for (const [method, path] of [
    ['POST', `/api/host/${slug}/guests`],
    ['PATCH', `/api/host/${slug}/tasks/abc`],
    ['DELETE', `/api/host/${slug}/vendors/abc`],
    ['POST', `/api/host/${slug}/apply`],
    ['POST', `/api/host/${slug}/sheets/suggest`],
    ['POST', `/api/weddings/${slug}/logo`],
    ['POST', `/api/weddings/${slug}/rsvp`],
  ]) {
    const r = guard(method, path);
    assert.equal(r.passed, false, `${method} ${path} should be refused`);
    assert.equal(r.status, 403);
    assert.equal(r.body?.error, DEMO_READ_ONLY);
  }
  for (const [method, path] of [
    ['GET', `/api/host/${slug}/guests`],
    ['POST', `/api/host/${slug}/agent`],
    ['POST', `/api/host/${slug}/ask`],
    ['POST', `/api/host/${slug}/tasks/suggest`],
    ['POST', '/api/host/some-other-wedding/guests'],
    ['POST', '/api/weddings'],
  ]) {
    assert.equal(guard(method, path).passed, true, `${method} ${path} should pass`);
  }
});

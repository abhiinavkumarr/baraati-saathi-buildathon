// Demo-day check: runs every flow against a deployed server with real Gemini
// calls and prints a pass/fail line with timings for each.
// Usage: node --import tsx scripts/smoke.ts [baseUrl] [cardImage]
// Needs a printed-card photo; make one with scripts/make-test-card.ts.
import { readFileSync, existsSync } from 'node:fs';

const base = (process.argv[2] ?? 'https://baraati-saathi-570792946314.asia-south1.run.app').replace(/\/$/, '');
const cardPath = process.argv[3] ?? '.data/probe/test-card.jpg';
const results: string[] = [];

async function step<T>(name: string, fn: () => Promise<T>, slowSecs: number): Promise<T | undefined> {
  const t = Date.now();
  try {
    const out = await fn();
    const s = (Date.now() - t) / 1000;
    results.push(`${s > slowSecs ? 'SLOW' : 'PASS'}  ${name.padEnd(36)} ${s.toFixed(1)}s`);
    return out;
  } catch (e) {
    results.push(`FAIL  ${name.padEnd(36)} ${((Date.now() - t) / 1000).toFixed(1)}s  ${(e as Error).message.slice(0, 160)}`);
    return undefined;
  }
}

async function call(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j)}`);
  return j;
}

const health = await step('health (AlloyDB?)', async () => {
  const h = await call('GET', '/api/health');
  if (h.db !== 'alloydb') throw new Error(`db is ${h.db}: ${h.db_note ?? ''}`);
  return h;
}, 2);

const intake = existsSync(cardPath)
  ? await step('Act 1: read a card photo', async () => {
      const r = await call('POST', '/api/intake/turn', {
        draft: {}, history: [], message: '',
        attachments: [{ mime_type: 'image/jpeg', data: readFileSync(cardPath).toString('base64') }],
      });
      if (!r.draft?.partner1_name || !r.draft.events?.length) throw new Error('no names/events extracted');
      return r;
    }, 25)
  : (results.push(`SKIP  Act 1 card (no ${cardPath})`), undefined);

const draft = intake?.draft?.events?.length
  ? { ...intake.draft, style: intake.draft.style || 'royal-rajasthani' }
  : JSON.parse(readFileSync('.data/intake.json', 'utf8')).draft;

// Act 1-3 checks
const w = await step('save wedding', () => call('POST', '/api/weddings', { draft }), 3);
if (w) {
  await Promise.all([
    step('Act 2: card art (Nano Banana)', () => call('POST', `/api/weddings/${w.slug}/art`, { host_token: w.host_token, kind: 'card_art' }), 40),
    step('Act 2: music (Lyria)', () => call('POST', `/api/weddings/${w.slug}/music`, { host_token: w.host_token }), 40),
  ]);
  await step('invitation page', async () => {
    const r = await fetch(`${base}/i/${w.slug}`);
    if (!r.ok) throw new Error(String(r.status));
  }, 3);
  const rsvp = await step('RSVP with a Hinglish note', () => call('POST', `/api/weddings/${w.slug}/rsvp`, {
    name: 'Nani ji', status: 'yes', party_size: 3,
    note: 'Beti aur pote ke saath aa rahi hoon, shaadi se ek din pehle shaam 6 baje airport pahunchenge, pickup chahiye. Jain khana.',
  }), 12);
  await step('Act 3: Saathi text chat', async () => {
    const r = await call('POST', `/api/saathi/${w.slug}/chat`, { message: 'Shaadi kab aur kahan hai?', history: [], guest_token: rsvp?.guest_token });
    if (!r.reply) throw new Error('empty reply');
  }, 12);
  await step('Act 3: Live voice token', () => call('POST', `/api/saathi/${w.slug}/live-token`, { guest_token: rsvp?.guest_token }), 5);
  await new Promise((r) => setTimeout(r, 8000));
  await step('RSVP note extracted by Gemini', async () => {
    const h = await call('GET', `/api/host/${w.slug}?t=${w.host_token}`);
    if (!h.rsvps[0]?.extracted) throw new Error('not extracted yet');
  }, 2);
  await step('Ask your guest list (AlloyDB)', async () => {
    await call('POST', `/api/host/${w.slug}/ask`, { t: w.host_token, question: 'Who needs a pickup and when?' });
  }, 15);
}

// Wedding Planner checks (PLANNER_SPEC.md §11)
const login = await step('Planner: login', async () => {
  const r = await call('POST', '/api/login', { name: 'Smoke Host', contact: `smoke-${Date.now()}@baraati.demo` });
  if (!r.session || !r.user?.id) throw new Error('no session returned');
  return r as { session: string; user: { id: string; name: string } };
}, 3);

if (login) {
  const bearer = { Authorization: `Bearer ${login.session}` };
  const pw = await step('Planner: create 2-day wedding', async () => {
    const r = await call('POST', '/api/weddings', {
      host_side: 'bride',
      expected_guests: 150,
      hashtag: '#MeeraRohanSmoke',
      draft: {
        partner1_name: 'Meera',
        partner2_name: 'Rohan',
        city: 'Jaipur',
        style: 'royal-rajasthani',
        events: [
          { name: 'Haldi', date: '2027-04-10', start_time: '10:00', venue_name: 'Courtyard', venue_address: 'Jaipur', dress_code: 'Yellow', notes: '' },
          { name: 'Wedding', date: '2027-04-11', start_time: '20:00', venue_name: 'Rambagh', venue_address: 'Jaipur', dress_code: 'Ethnic', notes: '' },
        ],
      },
    }, bearer);
    if (!r.slug || !r.host_token) throw new Error('missing slug or token');
    return r as { slug: string; host_token: string };
  }, 3);

  if (pw) {
    const auth = { t: pw.host_token };
    await step('Planner: add guest', async () => {
      const r = await call('POST', `/api/host/${pw.slug}/guests`, { ...auth, name: 'Chacha ji', side: 'bride', group_name: 'Family', party_size: 2 });
      if (!r.id) throw new Error('no guest id');
    }, 3);

    await step('Planner: vendor + payment + budget', async () => {
      const v = await call('POST', `/api/host/${pw.slug}/vendors`, { ...auth, category: 'Catering', name: 'Royal Caterers', status: 'booked', quoted: 200000 });
      const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      await call('POST', `/api/host/${pw.slug}/payments`, { ...auth, vendor_id: v.id, label: 'Advance due soon', amount: 50000, due_date: due });
      await call('POST', `/api/host/${pw.slug}/budget`, { ...auth, category: 'Catering', planned: 250000 });
      const b = await call('GET', `/api/host/${pw.slug}/budget?t=${encodeURIComponent(pw.host_token)}`);
      if (b.summary?.total_committed !== 200000 || b.summary?.total_due_30d !== 50000) {
        throw new Error(`unexpected budget totals: ${JSON.stringify(b.summary)}`);
      }
    }, 5);

    await step('Planner: add task', async () => {
      const t = await call('POST', `/api/host/${pw.slug}/tasks`, { ...auth, title: 'Confirm menu', category: 'Catering', priority: 'high' });
      if (!t.id) throw new Error('no task id');
    }, 3);

    await step('Planner: make-my-checklist + apply', async () => {
      const s = await call('POST', `/api/host/${pw.slug}/tasks/suggest`, auth);
      if (!Array.isArray(s.tasks) || s.tasks.length < 5) throw new Error('too few suggested tasks');
      const a = await call('POST', `/api/host/${pw.slug}/apply`, { ...auth, proposal: { kind: 'tasks', payload: { tasks: s.tasks.slice(0, 3) } } });
      if (!a.ok) throw new Error('apply failed');
    }, 30);

    await step('Planner: edit event -> invite sees it', async () => {
      await call('PATCH', `/api/host/${pw.slug}/events`, {
        ...auth,
        events: [
          { name: 'Haldi', date: '2027-04-10', start_time: '11:30', venue_name: 'Poolside Lawn', venue_address: 'Jaipur', dress_code: 'Yellow', notes: '' },
          { name: 'Wedding', date: '2027-04-11', start_time: '20:00', venue_name: 'Rambagh', venue_address: 'Jaipur', dress_code: 'Ethnic', notes: '' },
        ],
      });
      const pub = await call('GET', `/api/weddings/${pw.slug}`);
      if (pub.draft?.events?.[0]?.start_time !== '11:30') throw new Error('updated time not reflected on invite');
    }, 3);

    await step('Planner: publish announcement', async () => {
      const a = await call('POST', `/api/host/${pw.slug}/announcements`, { ...auth, text_en: 'Haldi moved to Poolside Lawn!', audience: 'all' });
      if (!a.ok) throw new Error('announcement failed');
    }, 3);

    await step('Planner: logo generator', async () => {
      const l = await call('POST', `/api/weddings/${pw.slug}/logo`, { ...auth, style: 'classic' });
      if (!Array.isArray(l.logos) || !l.logos.length) throw new Error('no logos generated');
    }, 45);

    await step('Planner: WhatsApp message writer', async () => {
      const m = await call('POST', `/api/host/${pw.slug}/messages`, { ...auth, kind: 'invite', language: 'Hinglish', tone: 'warm' });
      if (!Array.isArray(m.variants) || !m.variants.length) throw new Error('no message variants');
    }, 20);

    await step('Planner: agent payment query', async () => {
      const ag = await call('POST', `/api/host/${pw.slug}/agent`, { ...auth, message: 'Is hafte kya pay karna hai?' });
      if (!ag.reply) throw new Error('empty agent reply');
    }, 25);

    await step('Planner: /api/me/weddings lists it', async () => {
      const me = await call('GET', '/api/me/weddings', undefined, bearer);
      if (!me.weddings?.some((x: { slug: string }) => x.slug === pw.slug)) throw new Error('wedding not listed');
    }, 3);
  }
}

console.log(`\n${base}  (models: ${JSON.stringify(health?.models ?? {})})`);
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);

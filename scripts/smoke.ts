// Demo-day check: runs every flow against a deployed server with real Gemini
// calls and prints a pass/fail line with timings for each.
// Usage: node --import tsx scripts/smoke.ts [baseUrl] [cardImage]
// Needs a printed-card photo; make one with scripts/make-test-card.ts.
import { readFileSync, existsSync } from 'node:fs';

const base = process.argv[2] ?? 'https://baraati-saathi-570792946314.asia-south1.run.app';
const cardPath = process.argv[3] ?? '.data/probe/test-card.jpg';
const results: string[] = [];

async function step<T>(name: string, fn: () => Promise<T>, slowSecs: number): Promise<T | undefined> {
  const t = Date.now();
  try {
    const out = await fn();
    const s = (Date.now() - t) / 1000;
    results.push(`${s > slowSecs ? 'SLOW' : 'PASS'}  ${name.padEnd(34)} ${s.toFixed(1)}s`);
    return out;
  } catch (e) {
    results.push(`FAIL  ${name.padEnd(34)} ${((Date.now() - t) / 1000).toFixed(1)}s  ${(e as Error).message.slice(0, 160)}`);
    return undefined;
  }
}

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
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
  }), 3);
  await step('Act 3: Saathi text chat', async () => {
    const r = await call('POST', `/api/saathi/${w.slug}/chat`, { message: 'Shaadi kab aur kahan hai?', history: [], guest_token: rsvp?.guest_token });
    if (!r.reply) throw new Error('empty reply');
    console.log('  Saathi:', r.reply);
  }, 12);
  await step('Act 3: Live voice token', () => call('POST', `/api/saathi/${w.slug}/live-token`, { guest_token: rsvp?.guest_token }), 5);
  await new Promise((r) => setTimeout(r, 8000)); // note extraction runs in the background
  await step('RSVP note extracted by Gemini', async () => {
    const h = await call('GET', `/api/host/${w.slug}?t=${w.host_token}`);
    const x = h.rsvps[0]?.extracted;
    if (!x) throw new Error('not extracted yet');
    console.log('  extracted:', JSON.stringify(x));
  }, 2);
  await step('Ask your guest list (AlloyDB)', async () => {
    const r = await call('POST', `/api/host/${w.slug}/ask`, { t: w.host_token, question: 'Who needs a pickup and when?' });
    console.log('  Ask:', r.answer, `(${r.db}, ${r.ms} ms)`);
  }, 15);
  console.log(`\n  studio    ${base}/studio/${w.slug}?t=${w.host_token}\n  invite    ${base}/i/${w.slug}\n  dashboard ${base}/h/${w.slug}?t=${w.host_token}`);
}

console.log(`\n${base}  (models: ${JSON.stringify(health?.models ?? {})})`);
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);

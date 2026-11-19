// End-to-end smoke test against a running server: save a draft, generate art
// and music, RSVP with a free-text note, then read the host dashboard.
// Usage: node --import tsx scripts/e2e.ts [baseUrl] [draft.json]
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:8080';
const draft = JSON.parse(readFileSync(process.argv[3] ?? '.data/intake.json', 'utf8')).draft;

async function call(method: string, path: string, body?: unknown) {
  const t = Date.now();
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  console.log(`${r.status} ${method} ${path.split('?')[0]}  ${((Date.now() - t) / 1000).toFixed(1)}s`);
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j;
}

const { slug, host_token } = await call('POST', '/api/weddings', { draft });
console.log('slug', slug, '\nstudio', `${base}/studio/${slug}?t=${host_token}`);
const [art, music] = await Promise.all([
  call('POST', `/api/weddings/${slug}/art`, { host_token, kind: 'card_art' }),
  call('POST', `/api/weddings/${slug}/music`, { host_token }),
]);
console.log('art model', art.model, 'music', music.id);
await call('POST', `/api/weddings/${slug}/rsvp`, {
  name: 'Nani ji', status: 'yes', party_size: 3,
  note: 'Main apni beti aur pote ke saath aa rahi hoon. 12 tareekh ko shaam 5:40 baje Udaipur airport pahunchenge, pickup chahiye. Jain khana please.',
});
await call('POST', `/api/weddings/${slug}/rsvp`, { name: 'Aditya', status: 'maybe', party_size: 2, note: 'Driving down from Jaipur with my wife' });
await new Promise((r) => setTimeout(r, 12000)); // note extraction runs in the background
const host = await call('GET', `/api/host/${slug}?t=${host_token}`);
for (const r of host.rsvps) console.log(' -', r.name, r.status, JSON.stringify(r.extracted));
console.log('host', `${base}/h/${slug}?t=${host_token}`);

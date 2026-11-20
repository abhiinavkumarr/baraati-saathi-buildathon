// Tries the host control room against a running server.
// Usage: node --import tsx scripts/agent-test.ts <baseUrl> <slug> <hostToken> [--apply]
const [base, slug, t] = process.argv.slice(2);
const apply = process.argv.includes('--apply');

async function call(path: string, body?: unknown) {
  const s = Date.now();
  const r = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j)}`);
  return { ...j, secs: ((Date.now() - s) / 1000).toFixed(1) };
}

const b = await call(`/api/host/${slug}/briefing?t=${t}`);
console.log(`BRIEFING (${b.secs}s)`, JSON.stringify(b.briefing, null, 1), '\nstats', JSON.stringify(b.stats));

for (const message of [
  'Haldi ko 11 baje se 12 baje kar do aur sabko bata do',
  'Dog wale sawaal ka jawab do: pets allowed nahi hain, sorry',
  'Who is landing at the airport and needs a pickup?',
  'Tell everyone who needs a pickup that the shuttle leaves from Arrivals Gate 2',
]) {
  const r = await call(`/api/host/${slug}/agent`, { t, message, history: [] });
  console.log(`\n> ${message}  (${r.secs}s)\n${r.reply}`);
  if (r.data) console.log('  data:', r.data.rows.length, 'rows', JSON.stringify(r.data.rows).slice(0, 200));
  for (const p of r.proposals) {
    console.log(`  [${p.kind}] ${p.title}\n    ${p.detail.replace(/\n/g, '\n    ')}${p.payload.text_hi ? `\n    hi: ${p.payload.text_hi}` : ''}`);
    if (apply) {
      const a = await call(`/api/host/${slug}/apply`, { t, proposal: p });
      console.log('    applied:', a.message, a.whatsapp ? `${a.whatsapp.length} WhatsApp` : '');
    }
  }
}

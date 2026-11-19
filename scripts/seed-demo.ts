// Seed the demo wedding on a running server (local or Cloud Run): a complete
// Riya & Kabir wedding with info cards, AI artwork, music, and a few RSVPs.
// Prints the Studio, invite and dashboard links. Takes ~40 s (art + music).
// Usage: node --import tsx scripts/seed-demo.ts https://<service>.run.app
const base = (process.argv[2] ?? 'http://localhost:8080').replace(/\/$/, '');

const draft = {
  partner1_name: 'Riya',
  partner2_name: 'Kabir',
  partner1_family: 'Malhotra family',
  partner2_family: 'Sethi family',
  invite_line: 'Mr & Mrs Malhotra request the pleasure of your company',
  city: 'Udaipur',
  tradition: 'Punjabi',
  language: 'hinglish',
  style: 'royal-rajasthani',
  events: [
    { name: 'Mehendi', date: '2027-02-11', start_time: '16:00', venue_name: 'The Leela Palace', venue_address: 'Lake Pichola, Udaipur', dress_code: 'Shades of green', notes: 'Mehendi artists from 3 pm' },
    { name: 'Haldi', date: '2027-02-12', start_time: '11:00', venue_name: 'The Oberoi Udaivilas, Lawn 2', venue_address: 'Haridasji Ki Magri, Udaipur', dress_code: 'Yellow, clothes you can get messy', notes: 'Moved from 10 am to 11 am' },
    { name: 'Sangeet', date: '2027-02-12', start_time: '19:00', venue_name: 'The Oberoi Udaivilas', venue_address: 'Haridasji Ki Magri, Udaipur', dress_code: 'Indo-western glam', notes: '' },
    { name: 'Baraat & Pheras', date: '2027-02-13', start_time: '18:00', venue_name: 'The Oberoi Udaivilas', venue_address: 'Haridasji Ki Magri, Udaipur', dress_code: 'Traditional', notes: 'Baraat leaves the main gate at 6 pm sharp' },
  ],
  info: [
    { question: 'Is there an airport pickup?', answer: 'Yes. Shuttles leave Udaipur airport every hour from 2 pm to 10 pm on 11 and 12 Feb. Add your flight in your RSVP note.' },
    { question: 'Where do guests stay?', answer: 'All outstation guests stay at The Oberoi Udaivilas. Room numbers are shared at check-in.' },
    { question: 'Can kids come?', answer: 'Of course! There is a supervised kids corner at the Sangeet.' },
    { question: 'Gifts?', answer: 'Your blessings are enough. No boxed gifts, please.' },
  ],
  contact_name: 'Aman (Riya\'s brother)',
  contact_phone: '',
};

async function call(method: string, path: string, body?: unknown) {
  const t = Date.now();
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  console.log(`${r.status} ${method} ${path.split('?')[0]}  ${((Date.now() - t) / 1000).toFixed(1)}s`);
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j;
}

const health = await call('GET', '/api/health');
console.log('db:', health.db, health.db_note ?? '');
const { slug, host_token } = await call('POST', '/api/weddings', { draft });
await Promise.all([
  call('POST', `/api/weddings/${slug}/art`, { host_token, kind: 'card_art' }),
  call('POST', `/api/weddings/${slug}/music`, { host_token }),
]);
for (const r of [
  { name: 'Nani ji', status: 'yes', party_size: 3, note: 'Main apni beti aur pote ke saath aa rahi hoon. 12 tareekh ko shaam 5:40 baje Udaipur airport pahunchenge, pickup chahiye. Jain khana please.' },
  { name: 'Aditya', status: 'maybe', party_size: 2, note: 'Driving down from Jaipur with my wife' },
  { name: 'Meera Aunty', status: 'yes', party_size: 4, note: 'Family of four, two kids aged 6 and 9. Train reaches Udaipur City 7 am on the 12th.' },
]) await call('POST', `/api/weddings/${slug}/rsvp`, r);

console.log(`\nStudio:    ${base}/studio/${slug}?t=${host_token}`);
console.log(`Invite:    ${base}/i/${slug}`);
console.log(`Dashboard: ${base}/h/${slug}?t=${host_token}`);

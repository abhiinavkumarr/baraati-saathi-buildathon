// Seed the demo wedding on a running server (local or Cloud Run): a complete
// Riya & Kabir wedding with info cards, AI artwork, music, 18 RSVPs (with sides
// and groups, no phone numbers), planning data (vendors, budget, payments, tasks,
// sheet) and two open questions.
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
  contact_name: "Aman (Riya's brother)",
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
const { slug, host_token } = await call('POST', '/api/weddings', { draft, host_side: 'bride', expected_guests: 180, hashtag: '#RiyaKabir2027' });
await Promise.all([
  call('POST', `/api/weddings/${slug}/art`, { host_token, kind: 'card_art' }),
  call('POST', `/api/weddings/${slug}/music`, { host_token }),
  call('POST', `/api/weddings/${slug}/event-art`, { host_token }),
]);

// A realistic guest list: arrivals over three days, airport and station
// pickups, food needs, children, a few maybes and regrets. No phone numbers,
// so no real person is ever messaged from the demo.
const guests: [string, 'yes' | 'maybe' | 'no', number, string, 'bride' | 'groom', string][] = [
  ['Nani ji', 'yes', 3, 'Main apni beti aur pote ke saath aa rahi hoon. 12 tareekh ko shaam 5:40 baje Udaipur airport pahunchenge, pickup chahiye. Jain khana please.', 'bride', 'Close Family'],
  ['Meera Aunty', 'yes', 4, 'Family of four, two kids aged 6 and 9. Train reaches Udaipur City station 7 am on the 12th, need a pickup.', 'bride', 'Close Family'],
  ['Aditya', 'maybe', 2, 'Driving down from Jaipur with my wife', 'groom', 'College Friends'],
  ['Priya & Karan', 'yes', 2, 'Landing 11 Feb 1:30 pm, IndiGo from Mumbai. Pickup would be lovely. Karan has a nut allergy.', 'bride', 'College Friends'],
  ['Sharma Uncle', 'yes', 2, 'Hum dono 11 ko dopahar 2 baje airport aayenge. Pickup chahiye. Shakahari khana.', 'bride', 'Family Friends'],
  ['Rohan', 'yes', 1, 'Flight lands 11 Feb 2:15 pm from Delhi, will need a cab to the hotel', 'groom', 'College Friends'],
  ['Kavya', 'maybe', 1, 'Trying to get leave, will confirm by next week', 'bride', 'Office Friends'],
  ['Gupta family', 'yes', 5, '3 adults and 2 kids (4 and 7). Arriving by car from Ahmedabad on the 11th evening. Jain food for my mother.', 'groom', 'Family Friends'],
  ['Ananya', 'yes', 1, 'Coming solo! Landing 12 Feb 10 am. Vegan please.', 'bride', 'Office Friends'],
  ['Vikram Bhaiya', 'yes', 3, 'With wife and daughter (5). Flight lands 12 Feb 5:50 pm, pickup chahiye', 'groom', 'Close Family'],
  ['Dadi ji', 'yes', 2, 'Main aur mera beta. 11 tareekh subah 9 baje Udaipur City station, pickup please. Jain.', 'groom', 'Close Family'],
  ['Neha', 'no', 1, 'So sorry, exams that week. Sending all my love!', 'bride', 'College Friends'],
  ['Arjun', 'maybe', 2, 'Might come for the Sangeet and Pheras only', 'groom', 'Office Friends'],
  ['Sethi cousins', 'yes', 4, 'Four of us driving from Delhi, reaching 11 Feb night. Vegetarian x2.', 'groom', 'Close Family'],
  ['Mrs. Kapoor', 'yes', 2, 'Arriving 12 Feb 11:30 am by flight with my husband. Need wheelchair assistance at the airport and a pickup.', 'bride', 'Family Friends'],
  ['Farhan', 'no', 1, 'Will be abroad, many congratulations!', 'groom', 'College Friends'],
  ['Simran', 'yes', 2, 'With my husband, landing 12 Feb 5:30 pm from Bangalore. Pickup please.', 'bride', 'Office Friends'],
  ['Tanvi', 'yes', 1, 'Train to Udaipur City 12th morning 6:30', 'bride', 'College Friends'],
];

const metaByName = new Map(guests.map(([name, , , , side, group_name]) => [name, { side, group_name }]));
for (const [name, status, party_size, note] of guests) {
  await call('POST', `/api/weddings/${slug}/rsvp`, { name, status, party_size, note });
}

const listed = await call('GET', `/api/host/${slug}/guests?t=${encodeURIComponent(host_token)}`);
for (const g of listed.guests ?? []) {
  const meta = metaByName.get(g.name);
  if (meta) {
    await call('PATCH', `/api/host/${slug}/guests/${g.id}`, { t: host_token, side: meta.side, group_name: meta.group_name });
  }
}

await call('POST', `/api/host/${slug}/seed-sample`, { t: host_token });

// Two questions the schedule can't answer, so the host's inbox isn't empty.
for (const q of ['Can I bring my dog to the Mehendi?', 'Will there be a mehendi artist for guests too?']) {
  await call('POST', `/api/saathi/${slug}/chat`, { message: q, history: [] });
}
console.log('Waiting for Gemini to read the RSVP notes…');
await new Promise((r) => setTimeout(r, 25000));

console.log(`\nDEMO_SLUG=${slug}`);
console.log(`Studio:    ${base}/w/${slug}/studio/invitation?t=${host_token}`);
console.log(`Invite:    ${base}/i/${slug}`);
console.log(`Dashboard: ${base}/w/${slug}?t=${host_token}`);

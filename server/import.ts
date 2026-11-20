// Core importer for format `saathi-import-v1` (§9). Never logs names or phones.
import type { Db } from './db.ts';
import { normalizeContact } from './auth.ts';
import { HttpError } from './gemini.ts';
import { makeSlug, makeToken, normalizeDraft } from './wedding.ts';

export interface ImportTravel {
  arrival_date?: string | null;
  arrival_time?: string | null;
  departure_date?: string | null;
  departure_time?: string | null;
  mode?: string | null;
  from?: string | null;
  number?: string | null;
}

export interface ImportFileV1 {
  format: 'saathi-import-v1';
  owner: { name: string; contact: string; only_owner?: boolean };
  wedding: {
    bride_name: string;
    groom_name: string;
    hashtag?: string;
    venue_name?: string;
    city?: string;
    host_side?: string;
    expected_guests?: number;
  };
  days?: { date: string; ceremonies: string }[];
  events?: {
    name: string;
    date?: string;
    start_time?: string;
    end_time?: string;
    venue_name?: string;
    venue_address?: string;
    dress_code?: string;
    notes?: string;
  }[];
  venues?: { name: string; address?: string; maps_url?: string; is_primary?: boolean }[];
  info?: { question: string; answer: string }[];
  groups?: { name: string; member_refs: string[] }[];
  guests?: {
    ref?: string;
    name: string;
    is_host?: boolean;
    side?: string | null;
    rsvp?: string | null;
    room?: string | null;
    travel?: ImportTravel | null;
  }[];
  added_people?: {
    name: string;
    side?: string | null;
    rsvp?: string | null;
    room?: string | null;
    came_with_ref?: string | null;
    travel?: ImportTravel | null;
  }[];
}

export function mapImportSide(raw: unknown): 'bride' | 'groom' | null {
  if (typeof raw !== 'string') return null;
  const s = raw.toLowerCase();
  if (s.includes('bride')) return 'bride';
  if (s.includes('groom')) return 'groom';
  return null;
}

export function mapImportStatus(raw: unknown): 'yes' | 'no' | 'maybe' | 'pending' {
  if (typeof raw !== 'string') return 'pending';
  const s = raw.trim().toLowerCase();
  if (s === 'yes' || s === 'attending' || s === 'confirmed' || s === 'coming') return 'yes';
  if (s === 'no' || s === 'declined' || s === 'not coming' || s === "can't come") return 'no';
  if (s === 'maybe' || s === 'tentative') return 'maybe';
  return 'pending';
}

function normTime(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function mapTravel(t: ImportTravel | null | undefined): Record<string, unknown> | null {
  if (!t || typeof t !== 'object') return null;
  const extracted: Record<string, unknown> = {};
  if (t.arrival_date && /^\d{4}-\d{2}-\d{2}/.test(t.arrival_date)) extracted.arrival_date = t.arrival_date.slice(0, 10);
  const at = normTime(t.arrival_time);
  if (at) extracted.arrival_time = at;
  if (t.mode) extracted.arrival_mode = String(t.mode).trim().toLowerCase();
  if (t.number) extracted.flight_or_train = String(t.number).trim().slice(0, 60);
  if (t.from) extracted.arrival_point = String(t.from).trim().slice(0, 120);
  if (t.departure_date && /^\d{4}-\d{2}-\d{2}/.test(t.departure_date)) extracted.departure_date = t.departure_date.slice(0, 10);
  const dt = normTime(t.departure_time);
  if (dt) extracted.departure_time = dt;
  return Object.keys(extracted).length ? extracted : null;
}

export interface ImportSummary {
  slug: string;
  replaced: boolean;
  events_count: number;
  info_count: number;
  guests_count: number;
  hosts_count: number;
  added_people_count: number;
  with_rooms: number;
  with_travel: number;
}

export async function importWeddingData(db: Db, data: ImportFileV1): Promise<ImportSummary> {
  if (!data || data.format !== 'saathi-import-v1') {
    throw new HttpError(400, 'Expected format "saathi-import-v1".');
  }
  const ownerName = (data.owner?.name ?? '').trim().slice(0, 100);
  const ownerContact = normalizeContact(data.owner?.contact);
  if (!ownerName || !ownerContact) {
    throw new HttpError(400, 'Invalid owner name or contact in import file.');
  }

  const [owner] = await db.query<{ id: string }>(
    `INSERT INTO users (name, contact)
     VALUES ($1, $2)
     ON CONFLICT (contact) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [ownerName, ownerContact],
  );

  const w = data.wedding;
  const hashtag = (w.hashtag || '').trim() || null;

  // Idempotent: replace existing private wedding with same hashtag & owner
  let replaced = false;
  if (hashtag) {
    const del = await db.query<{ id: string }>(
      'DELETE FROM weddings WHERE owner_user_id = $1 AND hashtag = $2 AND private = true RETURNING id',
      [owner.id, hashtag],
    );
    replaced = del.length > 0;
  }

  const primaryVenue = data.venues?.find((v) => v.is_primary) ?? data.venues?.[0];
  const venueAddrByName = new Map<string, string>();
  for (const v of data.venues ?? []) {
    if (v.name && v.address) venueAddrByName.set(v.name.toLowerCase(), v.address);
  }

  const events = (data.events ?? []).map((ev) => ({
    name: ev.name,
    date: ev.date ?? '',
    start_time: normTime(ev.start_time),
    venue_name: ev.venue_name || w.venue_name || primaryVenue?.name || '',
    venue_address:
      ev.venue_address ||
      (ev.venue_name ? venueAddrByName.get(ev.venue_name.toLowerCase()) : '') ||
      primaryVenue?.address ||
      w.city ||
      '',
    dress_code: ev.dress_code || '',
    notes: ev.notes || '',
  }));

  const info = [...(data.info ?? [])];
  for (const v of data.venues ?? []) {
    if (v.maps_url && !info.some((i) => i.question.toLowerCase().includes(v.name.toLowerCase()))) {
      info.push({ question: `Directions to ${v.name}`, answer: `${v.address ? `${v.address} · ` : ''}${v.maps_url}` });
    }
  }

  const draft = normalizeDraft({
    partner1_name: w.bride_name,
    partner2_name: w.groom_name,
    city: w.city || '',
    style: 'royal-rajasthani',
    events,
    info,
    contact_name: ownerName,
    contact_phone: '',
  });

  const slug = makeSlug(draft);
  const hostToken = makeToken();
  const hostSide = ['bride', 'groom', 'planner'].includes(String(w.host_side)) ? w.host_side : null;
  const expectedGuests = Number.isInteger(w.expected_guests) && (w.expected_guests ?? 0) > 0 ? w.expected_guests : null;

  const [created] = await db.query<{ id: string }>(
    `INSERT INTO weddings (slug, host_token, draft, style, owner_user_id, host_side, expected_guests, hashtag, private)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     RETURNING id`,
    [slug, hostToken, JSON.stringify(draft), draft.style, owner.id, hostSide, expectedGuests, hashtag],
  );

  // Build ref → first group_name map
  const groupByRef = new Map<string, string>();
  for (const grp of data.groups ?? []) {
    for (const ref of grp.member_refs ?? []) {
      if (ref && !groupByRef.has(ref)) groupByRef.set(ref, grp.name);
    }
  }

  let guestsCount = 0;
  let hostsCount = 0;
  let addedCount = 0;
  let withRooms = 0;
  let withTravel = 0;

  for (const g of data.guests ?? []) {
    const name = (g.name ?? '').trim().slice(0, 80);
    if (!name) continue;
    const status = mapImportStatus(g.rsvp);
    const side = mapImportSide(g.side);
    const room = g.room != null ? String(g.room).trim().slice(0, 60) || null : null;
    const groupName = (g.ref ? groupByRef.get(g.ref) : null) ?? null;
    const extracted = mapTravel(g.travel);
    const relation = g.is_host ? 'Host' : null;
    if (g.is_host) hostsCount++;
    else guestsCount++;
    if (room) withRooms++;
    if (extracted) withTravel++;

    await db.query(
      `INSERT INTO rsvps (wedding_id, guest_token, name, phone, status, party_size, side, group_name, relation, room, source, extracted)
       VALUES ($1, $2, $3, NULL, $4, 1, $5, $6, $7, $8, 'import', $9)`,
      [created.id, makeToken(), name, status, side, groupName, relation, room, extracted ? JSON.stringify(extracted) : null],
    );
  }

  for (const a of data.added_people ?? []) {
    const name = (a.name ?? '').trim().slice(0, 80);
    if (!name) continue;
    const status = mapImportStatus(a.rsvp);
    const side = mapImportSide(a.side);
    const room = a.room != null ? String(a.room).trim().slice(0, 60) || null : null;
    const groupName = (a.came_with_ref ? groupByRef.get(a.came_with_ref) : null) ?? null;
    const extracted = mapTravel(a.travel);
    addedCount++;
    if (room) withRooms++;
    if (extracted) withTravel++;

    await db.query(
      `INSERT INTO rsvps (wedding_id, guest_token, name, phone, status, party_size, side, group_name, relation, room, source, extracted)
       VALUES ($1, $2, $3, NULL, $4, 1, $5, $6, 'Plus one', $7, 'import', $8)`,
      [created.id, makeToken(), name, status, side, groupName, room, extracted ? JSON.stringify(extracted) : null],
    );
  }

  return {
    slug,
    replaced,
    events_count: draft.events.length,
    info_count: draft.info.length,
    guests_count: guestsCount,
    hosts_count: hostsCount,
    added_people_count: addedCount,
    with_rooms: withRooms,
    with_travel: withTravel,
  };
}

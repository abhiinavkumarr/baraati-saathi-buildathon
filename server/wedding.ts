// The structured wedding record shared by intake, card design and Saathi.
import { randomBytes } from 'node:crypto';

export const STYLES = [
  'royal-rajasthani',
  'south-indian-temple',
  'bengali-alpana',
  'punjabi-phulkari',
  'minimal-pastel',
  'modern-floral',
] as const;

export interface WeddingEvent {
  name: string;
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM, 24h
  venue_name: string;
  venue_address: string;
  dress_code: string;
  notes: string;
}

export interface InfoItem {
  question: string;
  answer: string;
}

export interface WeddingDraft {
  partner1_name: string;
  partner2_name: string;
  partner1_family: string;
  partner2_family: string;
  invite_line: string; // e.g. "Mr & Mrs Sharma request the pleasure of your company"
  city: string;
  tradition: string;
  language: string; // en | hi | hinglish
  style: string;
  events: WeddingEvent[];
  info: InfoItem[];
  contact_name: string;
  contact_phone: string;
  logo_asset_id?: string;
}

export function emptyDraft(): WeddingDraft {
  return {
    partner1_name: '',
    partner2_name: '',
    partner1_family: '',
    partner2_family: '',
    invite_line: '',
    city: '',
    tradition: '',
    language: '',
    style: '',
    events: [],
    info: [],
    contact_name: '',
    contact_phone: '',
  };
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Coerce anything (model output, client input) into a well-formed draft. */
export function normalizeDraft(input: unknown): WeddingDraft {
  const d = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const events = Array.isArray(d.events) ? d.events : [];
  const info = Array.isArray(d.info) ? d.info : [];
  return {
    partner1_name: str(d.partner1_name, 60),
    partner2_name: str(d.partner2_name, 60),
    partner1_family: str(d.partner1_family, 120),
    partner2_family: str(d.partner2_family, 120),
    invite_line: str(d.invite_line, 300),
    city: str(d.city, 80),
    tradition: str(d.tradition, 80),
    language: str(d.language, 20),
    style: str(d.style, 200),
    events: events.slice(0, 12).map((e) => {
      const x = (e ?? {}) as Record<string, unknown>;
      const date = str(x.date, 10);
      const time = str(x.start_time, 5);
      return {
        name: str(x.name, 80),
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
        start_time: /^\d{2}:\d{2}$/.test(time) ? time : '',
        venue_name: str(x.venue_name, 120),
        venue_address: str(x.venue_address, 300),
        dress_code: str(x.dress_code, 120),
        notes: str(x.notes, 300),
      };
    }).filter((e) => e.name),
    info: info.slice(0, 30).map((i) => {
      const x = (i ?? {}) as Record<string, unknown>;
      return { question: str(x.question, 200), answer: str(x.answer, 600) };
    }).filter((i) => i.question && i.answer),
    contact_name: str(d.contact_name, 80),
    contact_phone: str(d.contact_phone, 20),
    ...(typeof d.logo_asset_id === 'string' && /^[0-9a-f-]{36}$/i.test(d.logo_asset_id) ? { logo_asset_id: d.logo_asset_id } : {}),
  };
}

/** Same rule the intake skill uses to decide "ready". */
export function missingFields(d: WeddingDraft): string[] {
  const missing: string[] = [];
  if (!d.partner1_name || !d.partner2_name) missing.push('couple_names');
  if (!d.events.some((e) => e.date && e.venue_name)) missing.push('ceremony_with_date_and_venue');
  if (!d.style) missing.push('style');
  return missing;
}

/** JSON Schema for Gemini structured output. Unknown values are empty strings. */
const eventSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Ceremony name, e.g. Haldi, Sangeet, Pheras' },
    date: { type: 'string', description: 'YYYY-MM-DD, or empty if unknown' },
    start_time: { type: 'string', description: 'HH:MM 24-hour, or empty if unknown' },
    venue_name: { type: 'string' },
    venue_address: { type: 'string' },
    dress_code: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['name', 'date', 'start_time', 'venue_name', 'venue_address', 'dress_code', 'notes'],
};

export const draftJsonSchema = {
  type: 'object',
  properties: {
    partner1_name: { type: 'string', description: 'First partner first name' },
    partner2_name: { type: 'string', description: 'Second partner first name' },
    partner1_family: { type: 'string' },
    partner2_family: { type: 'string' },
    invite_line: { type: 'string', description: 'Who is inviting, as written on the card' },
    city: { type: 'string' },
    tradition: { type: 'string', description: 'e.g. Punjabi, Marwari, Tamil, Bengali, mixed' },
    language: { type: 'string', description: 'en, hi or hinglish: the language the host uses' },
    style: { type: 'string', description: `One of ${STYLES.join(', ')}, or the host's own description` },
    events: { type: 'array', items: eventSchema },
    info: {
      type: 'array',
      items: {
        type: 'object',
        properties: { question: { type: 'string' }, answer: { type: 'string' } },
        required: ['question', 'answer'],
      },
    },
    contact_name: { type: 'string' },
    contact_phone: { type: 'string' },
  },
  required: [
    'partner1_name', 'partner2_name', 'partner1_family', 'partner2_family', 'invite_line',
    'city', 'tradition', 'language', 'style', 'events', 'info', 'contact_name', 'contact_phone',
  ],
};

export function makeSlug(d: WeddingDraft): string {
  const clean = (s: string) =>
    s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 16);
  const names = [clean(d.partner1_name), clean(d.partner2_name)].filter(Boolean).join('-') || 'wedding';
  return `${names}-${randomBytes(4).toString('hex')}`;
}

export function makeToken(): string {
  return randomBytes(18).toString('base64url');
}

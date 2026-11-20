// Act 2: card artwork (Nano Banana), couple illustration, invitation music (Lyria),
// RSVP, and the host dashboard.
import { Router } from 'express';
import { getDb } from './db.ts';
import { loadSkills } from './skills.ts';
import { ALLOWED_MIME, HttpError, generateImage, generateJson, generateMusic, type Attachment } from './gemini.ts';
import { makeToken, normalizeDraft, type WeddingDraft } from './wedding.ts';
import QRCode from 'qrcode';

export const designRouter = Router();

interface WeddingRow {
  id: string;
  slug: string;
  host_token: string;
  draft: WeddingDraft;
}

async function wedding(slug: string): Promise<WeddingRow> {
  const db = await getDb();
  const rows = await db.query<WeddingRow & Record<string, unknown>>(
    'SELECT id, slug, host_token, draft FROM weddings WHERE slug = $1',
    [slug],
  );
  if (!rows[0]) throw new HttpError(404, 'Wedding not found.');
  return { ...rows[0], draft: normalizeDraft(rows[0].draft) };
}

async function hostWedding(slug: string, token: unknown): Promise<WeddingRow> {
  const w = await wedding(slug);
  if (typeof token !== 'string' || token !== w.host_token) throw new HttpError(403, 'Only the host can do that.');
  return w;
}

// Motifs per style; mirrors .agents/skills/card-designer/SKILL.md.
const MOTIFS: Record<string, string> = {
  'royal-rajasthani': 'jharokha arches, elephants, peacocks, mirror work; maroon, gold and ivory',
  'south-indian-temple': 'gopuram silhouettes, brass lamps, jasmine garlands and banana leaves; temple red, turmeric and gold',
  'bengali-alpana': 'white alpana rice-paste patterns, conch shells, red-bordered sari texture; red and white',
  'punjabi-phulkari': 'phulkari embroidery, marigolds, dhol; magenta, saffron and mustard',
  'minimal-pastel': 'fine-line florals with lots of white space; blush, sage and cream',
  'modern-floral': 'watercolour peonies and roses with gold foil accents; ivory, dusty rose and gold',
};

const MUSIC: Record<string, string> = {
  'royal-rajasthani': 'shehnai melody over dholak and soft sarangi, regal and joyful',
  'south-indian-temple': 'nadaswaram melody with thavil rhythm, auspicious and bright',
  'bengali-alpana': 'gentle flute and esraj with light dhol and conch accents',
  'punjabi-phulkari': 'shehnai with energetic dhol bhangra groove, festive',
  'minimal-pastel': 'soft sitar and tabla, intimate and elegant',
  'modern-floral': 'soft strings and santoor with light percussion, romantic',
};

function artBrief(d: WeddingDraft): string {
  const motifs = MOTIFS[d.style] ?? `${d.style}; translate this into fitting Indian wedding motifs and palette`;
  return [
    `Create the background artwork for an Indian wedding invitation card.`,
    `Style: ${d.style || 'royal-rajasthani'} (${motifs}).`,
    d.tradition ? `Tradition: ${d.tradition}.` : '',
    d.city ? `Let subtle elements of ${d.city} inspire the scene.` : '',
    `Portrait 9:16, ornate border, rich but limited palette, print-quality detail, soft lighting.`,
    `Leave a calm, empty, uncluttered centre panel for typography.`,
    `Absolutely no text, letters, numbers, script, watermark or signature anywhere.`,
  ].filter(Boolean).join(' ');
}

async function saveAsset(weddingId: string, kind: string, mime: string, base64: string, prompt: string, label: string | null = null) {
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    'INSERT INTO assets (wedding_id, kind, mime_type, data, prompt, label) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [weddingId, kind, mime, Buffer.from(base64, 'base64'), prompt, label],
  );
  return rows[0].id;
}

// Per-ceremony scenes; mirrors the table in .agents/skills/card-designer/SKILL.md.
const CEREMONY: [RegExp, string][] = [
  [/haldi|pithi|gaye holud|nalangu/i, 'turmeric haldi ceremony: brass bowls of turmeric paste, marigold garlands and petals, bright sunlit yellow and saffron'],
  [/mehendi|mehndi/i, 'mehendi ceremony: intricate henna patterns, cones of henna, green leaves, mogra flowers, emerald and gold'],
  [/sangeet|garba|cocktail|music/i, 'sangeet night: dhol drums, strings of fairy lights, marigold toran, dancing silhouettes far away, deep jewel tones at night'],
  [/phera|wedding|lagna|vivah|muhurtham|biye|baraat|shaadi/i, 'wedding ceremony: a decorated mandap with the sacred fire, marigold and rose garlands, red and gold silk drapes'],
  [/reception|dinner|party/i, 'grand reception: crystal chandeliers, floral arches of roses, candlelight, ivory and champagne gold'],
  [/tilak|roka|sagai|engagement|ring/i, 'engagement ceremony: rings on a silk cushion, thali with diyas and rice, roses, soft pink and gold'],
];

function ceremonyBrief(d: WeddingDraft, eventName: string): string {
  const scene = CEREMONY.find(([re]) => re.test(eventName))?.[1] ?? `${eventName}, an Indian wedding celebration with flowers, diyas and festive drapes`;
  return [
    `A painterly still-life illustration for the "${eventName}" of an Indian wedding: ${scene}.`,
    `Match the invitation's ${d.style || 'royal-rajasthani'} style (${MOTIFS[d.style] ?? 'rich festive Indian palette'}).`,
    'Landscape 4:3, no people\'s faces, soft cinematic lighting, shallow depth of field, elegant and premium.',
    'Absolutely no text, letters, numbers, script, watermark or signature anywhere.',
  ].join(' ');
}

// Art for every ceremony, three at a time. Each failure is skipped, not fatal.
designRouter.post('/weddings/:slug/event-art', async (req, res) => {
  const w = await hostWedding(req.params.slug, req.body?.host_token);
  const system = loadSkills('card-designer');
  const events = w.draft.events.slice(0, 6);
  const made: string[] = [];
  for (let i = 0; i < events.length; i += 3) {
    await Promise.all(events.slice(i, i + 3).map(async (e) => {
      try {
        const brief = ceremonyBrief(w.draft, e.name);
        const img = await generateImage({ system, input: brief, aspect_ratio: '4:3' });
        await saveAsset(w.id, 'event_art', img.mime_type, img.data, brief, e.name);
        made.push(e.name);
      } catch (err) {
        console.warn('[event-art]', e.name, (err as Error).message);
      }
    }));
  }
  if (!made.length) throw new HttpError(502, 'Ceremony artwork could not be made. Please retry.');
  res.json({ made });
});

designRouter.post('/weddings/:slug/art', async (req, res) => {
  const w = await hostWedding(req.params.slug, req.body?.host_token);
  const kind = req.body?.kind === 'couple_art' ? 'couple_art' : 'card_art';
  const system = loadSkills('card-designer');

  if (kind === 'card_art') {
    const brief = artBrief(w.draft);
    const img = await generateImage({ system, input: brief, aspect_ratio: '9:16' });
    const id = await saveAsset(w.id, 'card_art', img.mime_type, img.data, brief);
    res.json({ id, kind, model: img.model });
    return;
  }

  const photo = req.body?.photo as Attachment | undefined;
  if (!photo || typeof photo.data !== 'string' || !/^image\//.test(photo.mime_type ?? '') || !ALLOWED_MIME.test(photo.mime_type)) {
    throw new HttpError(400, 'Please upload a photo of the couple (JPG or PNG).');
  }
  const brief =
    `Redraw this couple as a ${w.draft.style || 'royal-rajasthani'} style wedding illustration ` +
    `(for royal-rajasthani: a Mughal-Rajput miniature painting). Keep their faces recognisable and respectful, ` +
    `in traditional wedding attire, same skin tone, soft background matching the card. Square. No text.`;
  const img = await generateImage({
    system,
    input: [{ type: 'text', text: brief }, { type: 'image', data: photo.data, mime_type: photo.mime_type }],
    aspect_ratio: '1:1',
  });
  const id = await saveAsset(w.id, 'couple_art', img.mime_type, img.data, brief);
  res.json({ id, kind, model: img.model });
});

designRouter.post('/weddings/:slug/music', async (req, res) => {
  const w = await hostWedding(req.params.slug, req.body?.host_token);
  const prompt =
    `Instrumental only, no vocals. A warm, celebratory, loopable 30-second Indian wedding invitation theme: ` +
    `${MUSIC[w.draft.style] ?? 'shehnai and dholak, joyful'}${w.draft.tradition ? `, fitting a ${w.draft.tradition} wedding` : ''}.`;
  const audio = await generateMusic(prompt);
  const id = await saveAsset(w.id, 'music', audio.mime_type, audio.data, prompt);
  res.json({ id });
});

designRouter.get('/assets/:id', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new HttpError(404, 'Not found.');
  const db = await getDb();
  const rows = await db.query<{ mime_type: string; data: Buffer | Uint8Array }>(
    // couple_art and uploads are only served through the invitation, never listed.
    'SELECT mime_type, data FROM assets WHERE id = $1',
    [req.params.id],
  );
  if (!rows[0]) throw new HttpError(404, 'Not found.');
  res.set('Content-Type', rows[0].mime_type);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(rows[0].data));
});

/** Latest asset of each kind (and per ceremony), for the invitation page. */
export async function latestAssets(weddingId: string) {
  const db = await getDb();
  const rows = await db.query<{ id: string; kind: string; label: string | null }>(
    `SELECT DISTINCT ON (kind, coalesce(label, '')) id, kind, label FROM assets
      WHERE wedding_id = $1 AND kind IN ('card_art', 'couple_art', 'music', 'event_art')
      ORDER BY kind, coalesce(label, ''), created_at DESC`,
    [weddingId],
  );
  const out: Partial<Record<'card_art' | 'couple_art' | 'music', string>> & { events?: Record<string, string> } = {};
  for (const r of rows) {
    if (r.kind === 'event_art') (out.events ??= {})[r.label ?? ''] = r.id;
    else out[r.kind as 'card_art' | 'couple_art' | 'music'] = r.id;
  }
  return out;
}

designRouter.get('/qr', async (req, res) => {
  const url = String(req.query.url ?? '');
  if (!/^https?:\/\//.test(url) || url.length > 500) throw new HttpError(400, 'Bad URL.');
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#1f1226', light: '#ffffff' } });
  res.set('Content-Type', 'image/svg+xml').send(svg);
});

// ── RSVP ──────────────────────────────────────────────────────────────────

const extractSchema = {
  type: 'object',
  properties: {
    adults: { type: 'integer' },
    children: { type: 'integer' },
    arrival_date: { type: 'string', description: 'YYYY-MM-DD or empty' },
    arrival_time: { type: 'string', description: 'HH:MM 24h or empty' },
    arrival_mode: { type: 'string', description: 'flight, train, car, bus, or empty' },
    arrival_point: { type: 'string', description: 'e.g. Udaipur airport, or empty' },
    needs_pickup: { type: 'boolean' },
    dietary: { type: 'string', description: 'e.g. Jain, vegan, nut allergy, or empty' },
    other: { type: 'string', description: 'Anything else the host should know, or empty' },
  },
  required: ['adults', 'children', 'arrival_date', 'arrival_time', 'arrival_mode', 'arrival_point', 'needs_pickup', 'dietary', 'other'],
};

// Structure the guest's free-text note with Gemini (structured output). A next
// step is moving this into AlloyDB AI's AI.EXTRACT() so it runs in SQL.
async function extractNote(rsvpId: string, note: string, partySize: number, d: WeddingDraft) {
  try {
    const schedule = d.events.map((e) => `${e.name}: ${e.date}`).join('; ');
    const extracted = await generateJson<Record<string, unknown>>({
      system:
        'You extract logistics from an Indian wedding guest\'s RSVP note (English, Hindi or Hinglish). ' +
        'Only use what the note says; unknown values are empty strings, 0, or false. ' +
        'Resolve partial dates ("12th", "12 tareekh", "the day before the sangeet") against the wedding schedule.',
      input: [{ type: 'text', text: `Wedding schedule: ${schedule}. Party size given: ${partySize}. Note: ${note}` }],
      schema: extractSchema,
    });
    const db = await getDb();
    await db.query('UPDATE rsvps SET extracted = $1, updated_at = now() WHERE id = $2', [JSON.stringify(extracted), rsvpId]);
  } catch (e) {
    console.warn('[rsvp] note extraction failed', (e as Error).message);
  }
}

designRouter.post('/weddings/:slug/rsvp', async (req, res) => {
  const w = await wedding(req.params.slug);
  const b = req.body ?? {};
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
  const status = ['yes', 'no', 'maybe'].includes(b.status) ? b.status : '';
  if (!name || !status) throw new HttpError(400, 'Please add your name and choose an answer.');
  const phone = typeof b.phone === 'string' ? b.phone.replace(/[^\d+]/g, '').slice(0, 16) : '';
  const party = Math.min(20, Math.max(1, Number.parseInt(b.party_size, 10) || 1));
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 600) : '';
  const db = await getDb();

  // A guest who already RSVP'd on this device updates their own row only.
  if (typeof b.guest_token === 'string' && b.guest_token) {
    const rows = await db.query<{ id: string }>(
      `UPDATE rsvps SET name = $1, phone = $2, status = $3, party_size = $4, note = $5, updated_at = now()
        WHERE wedding_id = $6 AND guest_token = $7 RETURNING id`,
      [name, phone, status, party, note, w.id, b.guest_token],
    );
    if (rows[0]) {
      if (note) void extractNote(rows[0].id, note, party, w.draft);
      res.json({ guest_token: b.guest_token });
      return;
    }
  }
  const token = makeToken();
  const rows = await db.query<{ id: string }>(
    `INSERT INTO rsvps (wedding_id, guest_token, name, phone, status, party_size, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [w.id, token, name, phone, status, party, note],
  );
  if (note) void extractNote(rows[0].id, note, party, w.draft);
  res.status(201).json({ guest_token: token });
});

// ── Host dashboard ────────────────────────────────────────────────────────

designRouter.get('/host/:slug', async (req, res) => {
  const w = await hostWedding(req.params.slug, req.query.t);
  const db = await getDb();
  const rsvps = await db.query(
    `SELECT id, name, status, party_size, note, extracted, created_at,
            CASE WHEN phone <> '' THEN '••••' || right(phone, 4) ELSE '' END AS phone_masked
       FROM rsvps WHERE wedding_id = $1 ORDER BY created_at DESC`,
    [w.id],
  );
  const questions = await db.query(
    `SELECT id, question, answer, status, created_at FROM questions
      WHERE wedding_id = $1 ORDER BY status, created_at DESC LIMIT 100`,
    [w.id],
  );
  res.json({ slug: w.slug, draft: w.draft, assets: await latestAssets(w.id), rsvps, questions });
});

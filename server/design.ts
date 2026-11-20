// Act 2: card artwork (Nano Banana), couple illustration, invitation music (Lyria),
// RSVP, and the host dashboard.
import { Router } from 'express';
import { getDb } from './db.ts';
import { loadSkills } from './skills.ts';
import { ALLOWED_MIME, HttpError, generateImage, generateJson, generateMusic, toInputPart, type Attachment } from './gemini.ts';
import { makeToken, normalizeDraft, type WeddingDraft } from './wedding.ts';
import { publicDetails } from './saathi.ts';
import { safeEqual } from './auth.ts';
import QRCode from 'qrcode';

export const designRouter = Router();

interface WeddingRow {
  id: string;
  slug: string;
  host_token: string;
  draft: WeddingDraft;
  private: boolean;
}

async function wedding(slug: string): Promise<WeddingRow> {
  const db = await getDb();
  const rows = await db.query<WeddingRow & Record<string, unknown>>(
    'SELECT id, slug, host_token, draft, private FROM weddings WHERE slug = $1',
    [slug],
  );
  if (!rows[0]) throw new HttpError(404, 'Wedding not found.');
  return { ...rows[0], draft: normalizeDraft(rows[0].draft) };
}

async function publicWedding(slug: string, hostToken?: unknown): Promise<WeddingRow> {
  const w = await wedding(slug);
  if (w.private) {
    if (typeof hostToken !== 'string' || !hostToken || !safeEqual(hostToken, w.host_token)) {
      throw new HttpError(404, 'Wedding not found.');
    }
  }
  return w;
}

async function hostWedding(slug: string, token: unknown): Promise<WeddingRow> {
  const w = await wedding(slug);
  if (typeof token !== 'string' || !token || !safeEqual(token, w.host_token)) throw new HttpError(403, 'Only the host can do that.');
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

// Art for every ceremony (or one ceremony if `event_name` is given), three at a time.
designRouter.post('/weddings/:slug/event-art', async (req, res) => {
  const w = await hostWedding(req.params.slug, req.body?.host_token);
  const system = loadSkills('card-designer');
  const only = typeof req.body?.event_name === 'string' ? req.body.event_name.trim() : '';
  const events = only
    ? w.draft.events.filter((e) => e.name.toLowerCase() === only.toLowerCase()).slice(0, 1)
    : w.draft.events.slice(0, 6);
  if (!events.length) throw new HttpError(404, 'Ceremony not found.');
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

// Add or replace the couple photo shown on the invitation (no AI involved).
designRouter.post('/weddings/:slug/couple-photo', async (req, res) => {
  const w = await hostWedding(req.params.slug, req.body?.host_token);
  const photo = req.body?.photo as Attachment | undefined;
  if (!photo || typeof photo.data !== 'string' || !/^image\/(png|jpeg|webp)$/.test(photo.mime_type ?? '') || photo.data.length > 15_000_000) {
    throw new HttpError(400, 'Please choose a JPG, PNG or WebP photo under 10 MB.');
  }
  const id = await saveAsset(w.id, 'upload', photo.mime_type, photo.data, 'couple photo (host upload)', 'couple_photo');
  res.status(201).json({ id });
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

  let photo = req.body?.photo as Attachment | undefined;
  if (photo) {
    if (typeof photo.data !== 'string' || !/^image\/(png|jpeg|webp)$/.test(photo.mime_type ?? '') || photo.data.length > 15_000_000) {
      throw new HttpError(400, 'Please upload a photo of the couple (JPG or PNG).');
    }
    // A photo added here is also the couple photo on the invitation.
    await saveAsset(w.id, 'upload', photo.mime_type, photo.data, 'couple photo (host upload)', 'couple_photo');
  } else if (req.body?.use_saved_photo === true) {
    const db = await getDb();
    const saved = await db.query<{ mime_type: string; data: Buffer | Uint8Array }>(
      `SELECT mime_type, data FROM assets WHERE wedding_id = $1 AND kind = 'upload' AND label = 'couple_photo'
        ORDER BY created_at DESC LIMIT 1`,
      [w.id],
    );
    if (saved[0]) photo = { mime_type: saved[0].mime_type, data: Buffer.from(saved[0].data).toString('base64') };
  }
  if (!photo) throw new HttpError(400, 'Please upload a photo of the couple (JPG or PNG).');
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

designRouter.post('/weddings/:slug/teaser', async (req, res) => {
  const w = await hostWedding(req.params.slug, req.body?.t ?? req.body?.host_token);
  const mime = typeof req.body?.mime_type === 'string' && /^video\/(webm|mp4)/.test(req.body.mime_type) ? req.body.mime_type : 'video/webm';
  const data = typeof req.body?.data === 'string' ? req.body.data : '';
  if (!data || (data.length * 3) / 4 > 25 * 1024 * 1024) throw new HttpError(400, 'Teaser video is empty or too large (max 25 MB).');
  const id = await saveAsset(w.id, 'teaser', mime, data, 'canvas-teaser', 'teaser');
  res.status(201).json({ id, url: `/api/assets/${id}` });
});

// ── AI Studio: Logo / monogram (§7) ─────────────────────────────────────────

const LOGO_STYLES: Record<string, string> = {
  classic: 'gold-foil intertwined initials inside an ornate circular mandala crest',
  floral: 'elegant serif initials entwined with delicate marigold and jasmine blossoms',
  modern: 'minimalist fine-line geometric monogram with refined luxury typography',
};

designRouter.post('/weddings/:slug/logo', async (req, res) => {
  const w = await hostWedding(req.params.slug, req.body?.t ?? req.body?.host_token);
  const styleKey = typeof req.body?.style === 'string' && LOGO_STYLES[req.body.style] ? req.body.style : 'classic';
  const i1 = (w.draft.partner1_name || 'A').trim()[0]?.toUpperCase() || 'A';
  const i2 = (w.draft.partner2_name || 'B').trim()[0]?.toUpperCase() || 'B';
  const initials = `${i1} & ${i2}`;
  const palette = MOTIFS[w.draft.style] ?? 'deep maroon, warm gold and ivory';
  const system = loadSkills('card-designer');

  const variants = [
    'symmetrical crest composition',
    'graceful emblem with subtle ornamental flourish',
    'clean editorial seal with balanced spacing',
  ];

  const made = (
    await Promise.all(
      variants.map(async (v) => {
        try {
          const prompt = [
            `Design an Indian wedding monogram logo featuring the initials "${initials}".`,
            `Style: ${LOGO_STYLES[styleKey]}, ${v}.`,
            `Palette inspired by: ${palette}.`,
            `Centered square 1:1 composition on a solid, plain warm cream background (#FBF7F1) with generous margin.`,
            `Only the letters "${initials}" — no other words, dates, watermarks or extra text.`,
          ].join(' ');
          const img = await generateImage({ system, input: prompt, aspect_ratio: '1:1' });
          const id = await saveAsset(w.id, 'logo', img.mime_type, img.data, prompt, styleKey);
          return { id, style: styleKey, url: `/api/assets/${id}` };
        } catch (err) {
          console.warn('[logo]', (err as Error).message);
          return null;
        }
      }),
    )
  ).filter((x): x is { id: string; style: string; url: string } => Boolean(x));

  if (!made.length) throw new HttpError(502, 'Could not generate logos right now. Please retry.');
  res.json({ logos: made });
});

designRouter.get('/host/:slug/logos', async (req, res) => {
  const w = await hostWedding(req.params.slug, req.query.t);
  const db = await getDb();
  const rows = await db.query<{ id: string; label: string | null; created_at: string }>(
    "SELECT id, label, created_at FROM assets WHERE wedding_id = $1 AND kind = 'logo' ORDER BY created_at DESC LIMIT 24",
    [w.id],
  );
  res.json({
    selected_logo_id: w.draft.logo_asset_id ?? null,
    logos: rows.map((r) => ({ id: r.id, style: r.label || 'classic', url: `/api/assets/${r.id}`, created_at: r.created_at })),
  });
});

designRouter.post('/host/:slug/logo/select', async (req, res) => {
  const w = await hostWedding(req.params.slug, req.body?.t);
  const assetId = typeof req.body?.asset_id === 'string' ? req.body.asset_id.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) throw new HttpError(400, 'Invalid logo id.');
  const db = await getDb();
  const found = await db.query<{ id: string }>(
    "SELECT id FROM assets WHERE id = $1 AND wedding_id = $2 AND kind = 'logo'",
    [assetId, w.id],
  );
  if (!found[0]) throw new HttpError(404, 'Logo not found.');
  const next = normalizeDraft({ ...w.draft, logo_asset_id: assetId });
  await db.query('UPDATE weddings SET draft = $1, updated_at = now() WHERE id = $2', [JSON.stringify(next), w.id]);
  res.json({ ok: true, logo_asset_id: assetId });
});

// ── AI Studio: WhatsApp message writer (§7) ─────────────────────────────────

const MSG_KINDS = new Set(['invite', 'save-the-date', 'reminder', 'thank-you', 'announcement']);
const MSG_LANGS = new Set(['English', 'Hindi', 'Hinglish']);
const MSG_TONES = new Set(['formal', 'warm', 'shayari', 'filmi', 'funny']);

designRouter.post('/host/:slug/messages', async (req, res) => {
  const w = await hostWedding(req.params.slug, req.body?.t);
  const kind = typeof req.body?.kind === 'string' && MSG_KINDS.has(req.body.kind) ? req.body.kind : 'invite';
  const language = typeof req.body?.language === 'string' && MSG_LANGS.has(req.body.language) ? req.body.language : 'Hinglish';
  const tone = typeof req.body?.tone === 'string' && MSG_TONES.has(req.body.tone) ? req.body.tone : 'warm';
  const extra = typeof req.body?.extra === 'string' ? req.body.extra.trim().slice(0, 300) : '';

  const inviteUrl = `${req.protocol}://${req.get('host')}/i/${w.slug}`;
  const pub = publicDetails(w.draft);

  const result = await generateJson<{ variants: { text: string }[] }>({
    system:
      'You write warm, shareable WhatsApp messages for an Indian wedding host. ' +
      'Return exactly 3 distinct variants. Each variant MUST:\n' +
      '- include the placeholder {name} for the guest\'s name;\n' +
      '- stay strictly under 580 characters;\n' +
      '- include the wedding date(s), main venue, and the exact invitation URL provided;\n' +
      '- match the requested message kind, language (use Devanagari for Hindi, Roman script for Hinglish), and tone.\n' +
      'Use only the wedding details provided. Never invent details.',
    input: [
      {
        type: 'text',
        text: JSON.stringify({
          kind,
          language,
          tone,
          extra_note: extra || undefined,
          invitation_url: inviteUrl,
          wedding: pub,
        }),
      },
    ],
    schema: {
      type: 'object',
      properties: {
        variants: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      },
      required: ['variants'],
    },
  });

  const variants = (Array.isArray(result.variants) ? result.variants : [])
    .slice(0, 3)
    .map((v) => ({ text: String(v?.text ?? '').trim().slice(0, 600) }))
    .filter((v) => v.text);
  if (!variants.length) throw new HttpError(502, 'Could not write messages right now. Please retry.');
  res.json({ variants });
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
      WHERE wedding_id = $1
        AND (kind IN ('card_art', 'couple_art', 'music', 'event_art') OR (kind = 'upload' AND label = 'couple_photo'))
      ORDER BY kind, coalesce(label, ''), created_at DESC`,
    [weddingId],
  );
  const out: Partial<Record<'card_art' | 'couple_art' | 'music' | 'couple_photo', string>> & { events?: Record<string, string> } = {};
  for (const r of rows) {
    if (r.kind === 'event_art') (out.events ??= {})[r.label ?? ''] = r.id;
    else if (r.kind === 'upload') out.couple_photo = r.id;
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
    flight_or_train: { type: 'string', description: 'Flight or train number/name from ticket or note, e.g. 6E 2145, or empty' },
    ticket_passengers: { type: 'integer', description: 'Number of passengers on an uploaded ticket, or 0 if no ticket' },
    needs_pickup: { type: 'boolean' },
    dietary: { type: 'string', description: 'e.g. Jain, vegan, nut allergy, or empty' },
    other: { type: 'string', description: 'Anything else the host should know, or empty' },
  },
  required: [
    'adults', 'children', 'arrival_date', 'arrival_time', 'arrival_mode',
    'arrival_point', 'flight_or_train', 'ticket_passengers', 'needs_pickup', 'dietary', 'other',
  ],
};

// Structure the guest's free-text note and optional travel ticket with Gemini
// (structured output). A next step is moving this into AlloyDB AI's AI.EXTRACT().
async function extractRsvpLogistics(
  rsvpId: string,
  note: string,
  partySize: number,
  d: WeddingDraft,
  ticket?: Attachment,
): Promise<Record<string, unknown> | null> {
  try {
    const schedule = d.events.map((e) => `${e.name}: ${e.date}`).join('; ');
    const parts: unknown[] = [{
      type: 'text',
      text:
        `Wedding schedule: ${schedule}. Party size given: ${partySize}. Note: ${note || '(none)'}` +
        (ticket ? '\nA travel ticket or boarding pass is attached. Extract arrival date, time, mode, airport/station, flight_or_train number, and ticket_passengers count.' : ''),
    }];
    if (ticket) parts.push(toInputPart(ticket));
    const extracted = await generateJson<Record<string, unknown>>({
      system:
        'You extract logistics from an Indian wedding guest\'s RSVP note (English, Hindi or Hinglish) and any attached travel ticket/boarding pass. ' +
        'Only use what the note or ticket says; unknown values are empty strings, 0, or false. ' +
        'Resolve partial dates ("12th", "12 tareekh", "the day before the sangeet") against the wedding schedule.',
      input: parts,
      schema: extractSchema,
    });
    const db = await getDb();
    await db.query('UPDATE rsvps SET extracted = $1, updated_at = now() WHERE id = $2', [JSON.stringify(extracted), rsvpId]);
    return extracted;
  } catch (e) {
    console.warn('[rsvp] logistics extraction failed', (e as Error).message);
    return null;
  }
}

designRouter.post('/weddings/:slug/rsvp', async (req, res) => {
  const w = await publicWedding(req.params.slug, req.body?.t ?? req.query.t);
  const b = req.body ?? {};
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
  const status = ['yes', 'no', 'maybe'].includes(b.status) ? b.status : '';
  if (!name || !status) throw new HttpError(400, 'Please add your name and choose an answer.');
  const phone = typeof b.phone === 'string' ? b.phone.replace(/[^\d+]/g, '').slice(0, 16) : '';
  const party = Math.min(20, Math.max(1, Number.parseInt(b.party_size, 10) || 1));
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 600) : '';
  const rawTicket = b.ticket as Attachment | undefined;
  let ticket: Attachment | undefined;
  if (rawTicket) {
    if (
      typeof rawTicket.data !== 'string' ||
      !/^(image\/|application\/pdf$)/.test(rawTicket.mime_type ?? '') ||
      !ALLOWED_MIME.test(rawTicket.mime_type) ||
      rawTicket.data.length > 15_000_000
    ) {
      throw new HttpError(400, 'Please upload a valid ticket image (JPG/PNG) or PDF under 10 MB.');
    }
    ticket = rawTicket;
  }
  const db = await getDb();

  // A guest who already RSVP'd on this device updates their own row only.
  if (typeof b.guest_token === 'string' && b.guest_token) {
    const rows = await db.query<{ id: string }>(
      `UPDATE rsvps SET name = $1, phone = $2, status = $3, party_size = $4, note = $5, updated_at = now()
        WHERE wedding_id = $6 AND guest_token = $7 RETURNING id`,
      [name, phone, status, party, note, w.id, b.guest_token],
    );
    if (rows[0]) {
      const extracted = note || ticket ? await extractRsvpLogistics(rows[0].id, note, party, w.draft, ticket) : null;
      res.json({ guest_token: b.guest_token, extracted });
      return;
    }
  }
  const token = makeToken();
  const rows = await db.query<{ id: string }>(
    `INSERT INTO rsvps (wedding_id, guest_token, name, phone, status, party_size, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [w.id, token, name, phone, status, party, note],
  );
  const extracted = note || ticket ? await extractRsvpLogistics(rows[0].id, note, party, w.draft, ticket) : null;
  res.status(201).json({ guest_token: token, extracted });
});

designRouter.get('/weddings/:slug/my-plan', async (req, res) => {
  const w = await publicWedding(req.params.slug, req.query.t);
  const guestToken = typeof req.query.guest_token === 'string' ? req.query.guest_token.slice(0, 64) : '';
  if (!guestToken) {
    res.json({ rsvp: null });
    return;
  }
  const db = await getDb();
  const rows = await db.query(
    'SELECT name, status, party_size, note, extracted, updated_at FROM rsvps WHERE wedding_id = $1 AND guest_token = $2',
    [w.id, guestToken],
  );
  res.json({ rsvp: rows[0] ?? null });
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

// Thin wrapper over the Gemini Interactions API (@google/genai).
import { GoogleGenAI } from '@google/genai';

export const MODELS = {
  text: process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash',
  image: process.env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1',
  music: process.env.GEMINI_MUSIC_MODEL || 'lyria-3-clip-preview',
  live: process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live',
};

let client: GoogleGenAI | null = null;
export function ai(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new HttpError(503, 'GEMINI_API_KEY is not set on the server.');
  }
  // The Interactions API's text/image/document/audio input parts are v1beta.
  client ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: 'v1beta',
    // Fail fast so the fallback model gets a turn instead of hanging the UI.
    httpOptions: { timeout: Number(process.env.GEMINI_TIMEOUT_MS) || 75_000 },
  });
  return client;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** A file the user attached: card photo, PDF, or a recorded voice note. */
export interface Attachment {
  mime_type: string;
  data: string; // base64, no data: prefix
}

export const ALLOWED_MIME = /^(image\/(png|jpeg|webp|heic)|application\/pdf|audio\/(webm|ogg|mp4|mpeg|wav))$/;

export function toInputPart(a: Attachment) {
  const type = a.mime_type.startsWith('image/')
    ? 'image'
    : a.mime_type === 'application/pdf'
      ? 'document'
      : 'audio';
  return { type, data: a.data, mime_type: a.mime_type } as const;
}

/** Text models to try in order when one is overloaded. */
export const TEXT_MODELS = [
  MODELS.text,
  ...(process.env.GEMINI_TEXT_FALLBACKS || 'gemini-3.6-flash,gemini-4-hydrogen').split(','),
].map((m) => m.trim()).filter((m, i, a) => m && a.indexOf(m) === i);

function isTransient(e: unknown): boolean {
  const s = String((e as { status?: number })?.status ?? '') + ' ' + String((e as Error)?.message ?? '');
  return /\b(429|500|503|504)\b|high demand|overloaded|unavailable|RESOURCE_EXHAUSTED|DEADLINE|timed? ?out|abort|ETIMEDOUT|ECONNRESET|fetch failed/i.test(s);
}

/**
 * Run `call` on each model in turn; on an overload / rate-limit error, retry once
 * after a short pause, then move to the next model. Demo-day insurance.
 */
export async function withFallback<T>(models: string[], call: (model: string) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await call(model);
      } catch (e) {
        last = e;
        // A Free-tier quota of zero never clears: say so instead of retrying.
        if (/Free Tier|limit: 0/i.test(String((e as Error)?.message))) {
          console.error(`[gemini] ${model} not available on this key's tier`);
          throw new HttpError(402, `${model} needs a paid Gemini API tier. Link billing to the API key's project in AI Studio.`);
        }
        if (!isTransient(e)) throw e;
        // A timeout already cost us the full wait: go straight to the next model.
        if (/timed? ?out|abort|ETIMEDOUT/i.test(String((e as Error)?.message))) break;
        console.warn(`[gemini] ${model} busy (attempt ${attempt + 1}); ${attempt ? 'falling back' : 'retrying'}`);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }
  console.error('[gemini] all models busy', last);
  throw new HttpError(503, 'Saathi is very busy right now. Please try again in a moment.');
}

export const IMAGE_MODELS = [MODELS.image, 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image']
  .filter((m, i, a) => a.indexOf(m) === i);

/** Generate one image (Nano Banana). Returns base64 PNG/JPEG data. */
export async function generateImage(opts: {
  system?: string;
  input: unknown[] | string;
  aspect_ratio?: string;
}): Promise<{ data: string; mime_type: string; model: string }> {
  let used = '';
  const r = (await withFallback(IMAGE_MODELS, (model) => {
    used = model;
    return ai().interactions.create({
      model,
      ...(opts.system ? { system_instruction: opts.system } : {}),
      input: opts.input,
      response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: opts.aspect_ratio ?? '9:16' },
    } as never);
  })) as { output_image?: { data?: string; mime_type?: string } };
  if (!r.output_image?.data) throw new HttpError(502, 'No image came back. Please try again.');
  return { data: r.output_image.data, mime_type: r.output_image.mime_type || 'image/png', model: used };
}

/** Generate a short instrumental clip (Lyria). Returns base64 audio. */
export async function generateMusic(prompt: string): Promise<{ data: string; mime_type: string }> {
  const r = (await withFallback([MODELS.music], (model) =>
    ai().interactions.create({ model, input: prompt } as never),
  )) as { output_audio?: { data?: string; mime_type?: string } };
  if (!r.output_audio?.data) throw new HttpError(502, 'No music came back. Please try again.');
  return { data: r.output_audio.data, mime_type: r.output_audio.mime_type || 'audio/mpeg' };
}

/** Structured JSON from a text model. */
export async function generateJson<T>(opts: {
  system: string;
  input: unknown[];
  schema: object;
  model?: string;
}): Promise<T> {
  // The SDK's input types lag the docs; the shapes below follow the
  // Interactions API reference (text / image / document / audio parts).
  const interaction = await withFallback(opts.model ? [opts.model] : TEXT_MODELS, (model) =>
    ai().interactions.create({
      model,
      system_instruction: opts.system,
      input: opts.input,
      // Low thinking keeps chat turns fast; extraction doesn't need deep reasoning.
      generation_config: { thinking_level: model.startsWith('gemini-3.6') ? 'minimal' : 'low' },
      response_format: { type: 'text', mime_type: 'application/json', schema: opts.schema },
    } as never),
  );
  const text = (interaction as { output_text?: string }).output_text ?? '';
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, 'The model returned an unreadable answer. Please try again.');
  }
}

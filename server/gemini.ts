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
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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

/** Structured JSON from a text model. */
export async function generateJson<T>(opts: {
  system: string;
  input: unknown[];
  schema: object;
  model?: string;
}): Promise<T> {
  // The SDK's input types lag the docs; the shapes below follow the
  // Interactions API reference (text / image / document / audio parts).
  const interaction = await ai().interactions.create({
    model: opts.model ?? MODELS.text,
    system_instruction: opts.system,
    input: opts.input,
    response_format: { type: 'text', mime_type: 'application/json', schema: opts.schema },
  } as never);
  const text = (interaction as { output_text?: string }).output_text ?? '';
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, 'The model returned an unreadable answer. Please try again.');
  }
}

// Quick availability + latency probe for every model the demo depends on.
// Usage: node --env-file=.env --import tsx scripts/probe-models.ts [text|image|music|all]
import { writeFileSync, mkdirSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, apiVersion: 'v1beta' });
const which = process.argv[2] ?? 'all';
mkdirSync('.data/probe', { recursive: true });

async function time<T>(label: string, fn: () => Promise<T>) {
  const t = Date.now();
  try {
    const r = await fn();
    console.log(`OK   ${label}  ${((Date.now() - t) / 1000).toFixed(1)}s`);
    return r;
  } catch (e) {
    console.log(`FAIL ${label}  ${((Date.now() - t) / 1000).toFixed(1)}s  ${String((e as Error).message).slice(0, 200)}`);
  }
}

if (which === 'text' || which === 'all') {
  for (const [model, level] of [['gemini-3.8-flash', 'low'], ['gemini-3.6-flash', 'minimal'], ['gemini-4-hydrogen', 'low']]) {
    await time(`${model} (${level})`, () =>
      ai.interactions.create({
        model,
        input: 'Reply with JSON {"ok":true,"city":"Udaipur"}',
        generation_config: { thinking_level: level },
        response_format: { type: 'text', mime_type: 'application/json', schema: { type: 'object', properties: { ok: { type: 'boolean' }, city: { type: 'string' } }, required: ['ok', 'city'] } },
      } as never).then((r) => console.log('     ', (r as { output_text?: string }).output_text)),
    );
  }
}

if (which === 'image' || which === 'all') {
  for (const model of ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image']) {
    await time(model, async () => {
      const r = (await ai.interactions.create({
        model,
        input: 'Ornate royal Rajasthani wedding card background, jharokha arches, peacocks, maroon and gold, empty uncluttered centre panel, no text, no letters',
        response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '9:16' },
      } as never)) as { output_image?: { data?: string } };
      if (!r.output_image?.data) throw new Error('no image returned');
      writeFileSync(`.data/probe/${model}.jpg`, Buffer.from(r.output_image.data, 'base64'));
    });
  }
}

if (which === 'music' || which === 'all') {
  await time('lyria-3-clip-preview', async () => {
    const r = (await ai.interactions.create({
      model: 'lyria-3-clip-preview',
      input: 'Instrumental, no vocals. Warm celebratory Indian wedding music: shehnai melody over soft dholak, loopable, 30 seconds.',
    } as never)) as { output_audio?: { data?: string; mime_type?: string } };
    if (!r.output_audio?.data) throw new Error('no audio returned');
    writeFileSync('.data/probe/lyria.mp3', Buffer.from(r.output_audio.data, 'base64'));
    console.log('      audio mime:', r.output_audio.mime_type);
  });
}

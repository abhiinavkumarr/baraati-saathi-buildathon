// Exercises the exact browser voice path without a microphone: fetch the
// ephemeral token from our server, connect to Gemini Live with it, send a
// question as text, and print the spoken answer's transcript + audio size.
// Usage: node --import tsx scripts/live-test.ts <baseUrl> <slug> "<question>"
import { GoogleGenAI, type LiveServerMessage } from '@google/genai';

const [base = 'http://localhost:8080', slug, question = 'Haldi kab hai?'] = process.argv.slice(2);
const t0 = Date.now();
const tok = await (await fetch(`${base}/api/saathi/${slug}/live-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
if (!tok.token) throw new Error(JSON.stringify(tok));
console.log(`token ${((Date.now() - t0) / 1000).toFixed(1)}s, model ${tok.model}`);

const ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: 'v1beta' } });
let audioBytes = 0;
let said = '';
let firstAudio = 0;
const done = new Promise<void>((resolve) => {
  void ai.live
    .connect({
      model: tok.model,
      config: tok.config,
      callbacks: {
        onopen: () => console.log('open'),
        onerror: (e) => console.log('error', e.message),
        onclose: (e) => {
          console.log('close', e.code, e.reason);
          resolve();
        },
        onmessage: async (m: LiveServerMessage) => {
          for (const p of m.serverContent?.modelTurn?.parts ?? []) {
            if (p.inlineData?.data) {
              if (!firstAudio) firstAudio = Date.now();
              audioBytes += (p.inlineData.data.length * 3) / 4;
            }
          }
          if (m.serverContent?.outputTranscription?.text) said += m.serverContent.outputTranscription.text;
          if (m.toolCall) {
            const functionResponses = [];
            for (const fc of m.toolCall.functionCalls ?? []) {
              console.log('tool', fc.name, JSON.stringify(fc.args));
              const r = await (await fetch(`${base}/api/saathi/${slug}/tool`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fc.name, args: fc.args ?? {} }) })).json();
              functionResponses.push({ id: fc.id, name: fc.name, response: { result: r.result } });
            }
            session.sendToolResponse({ functionResponses });
          }
          if (m.serverContent?.turnComplete) {
            console.log(`answer: "${said.trim()}"`);
            console.log(`first audio after ${((firstAudio - sent) / 1000).toFixed(1)}s, ${(audioBytes / 48000).toFixed(1)}s of speech`);
            session.close();
          }
        },
      },
    })
    .then((s) => {
      session = s;
      sent = Date.now();
      s.sendRealtimeInput({ text: question });
    });
});
let session: Awaited<ReturnType<typeof ai.live.connect>>;
let sent = 0;
await done;

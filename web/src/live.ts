// Gemini Live voice session in the browser: mic → 16 kHz PCM → Live API,
// 24 kHz PCM audio back → speakers. Tool calls are relayed to our server, which
// runs them scoped to this wedding and guest.
import { GoogleGenAI, type LiveServerMessage, type Session } from '@google/genai';

export interface LiveHandlers {
  onState: (s: 'connecting' | 'listening' | 'speaking' | 'closed' | 'error', detail?: string) => void;
  onTranscript: (who: 'guest' | 'saathi', text: string, final: boolean) => void;
  onTool: (name: string) => void;
}

// AudioWorklet that forwards mic frames to the main thread.
const WORKLET = `
class Mic extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('mic', Mic);`;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function startLive(slug: string, guestToken: string, h: LiveHandlers): Promise<() => void> {
  h.onState('connecting');
  const tokenRes = await fetch(`/api/saathi/${slug}/live-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guest_token: guestToken }),
  });
  const tok = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tok.error || 'Could not start voice.');

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  // Playback (24 kHz from the model)
  const out = new AudioContext({ sampleRate: 24000 });
  let playAt = 0;
  const playing = new Set<AudioBufferSourceNode>();
  function play(b64: string) {
    const bin = atob(b64);
    const pcm = new Int16Array(bin.length / 2);
    for (let i = 0; i < pcm.length; i++) {
      const lo = bin.charCodeAt(i * 2);
      const hi = bin.charCodeAt(i * 2 + 1);
      pcm[i] = (hi << 8) | lo;
    }
    const buf = out.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = out.createBufferSource();
    src.buffer = buf;
    src.connect(out.destination);
    playAt = Math.max(playAt, out.currentTime + 0.03);
    src.start(playAt);
    playAt += buf.duration;
    playing.add(src);
    h.onState('speaking');
    src.onended = () => {
      playing.delete(src);
      if (playing.size === 0) h.onState('listening');
    };
  }
  function stopPlayback() {
    for (const s of playing) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    playing.clear();
    playAt = 0;
  }

  let closed = false;
  let guestText = '';
  let saathiText = '';

  const ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: 'v1beta' } });
  const session: Session = await ai.live.connect({
    model: tok.model,
    config: tok.config,
    callbacks: {
      onopen: () => h.onState('listening'),
      onerror: (e: ErrorEvent) => h.onState('error', e.message),
      onclose: (e: CloseEvent) => {
        if (!closed) h.onState(e.code === 1000 ? 'closed' : 'error', e.reason);
      },
      onmessage: async (m: LiveServerMessage) => {
        const sc = m.serverContent;
        if (sc?.interrupted) stopPlayback();
        for (const p of sc?.modelTurn?.parts ?? []) if (p.inlineData?.data) play(p.inlineData.data);
        if (sc?.inputTranscription?.text) {
          guestText += sc.inputTranscription.text;
          h.onTranscript('guest', guestText, false);
        }
        if (sc?.outputTranscription?.text) {
          if (guestText) {
            h.onTranscript('guest', guestText, true);
            guestText = '';
          }
          saathiText += sc.outputTranscription.text;
          h.onTranscript('saathi', saathiText, false);
        }
        if (sc?.turnComplete) {
          if (saathiText) h.onTranscript('saathi', saathiText, true);
          saathiText = '';
          guestText = '';
        }
        if (m.toolCall?.functionCalls?.length) {
          const functionResponses = [];
          for (const fc of m.toolCall.functionCalls) {
            h.onTool(fc.name ?? '');
            const r = await fetch(`/api/saathi/${slug}/tool`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: fc.name, args: fc.args ?? {}, guest_token: guestToken }),
            });
            const j = await r.json().catch(() => ({ result: { error: 'tool failed' } }));
            functionResponses.push({ id: fc.id, name: fc.name, response: { result: j.result ?? j } });
          }
          session.sendToolResponse({ functionResponses });
        }
      },
    },
  });

  // Mic capture at 16 kHz (the browser resamples the device input).
  const inCtx = new AudioContext({ sampleRate: 16000 });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await inCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const src = inCtx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(inCtx, 'mic');
  let pending: Float32Array[] = [];
  let pendingLen = 0;
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (closed) return;
    pending.push(e.data);
    pendingLen += e.data.length;
    if (pendingLen < 1600) return; // ~100 ms per send
    const pcm = new Int16Array(pendingLen);
    let o = 0;
    for (const f of pending) for (let i = 0; i < f.length; i++) pcm[o++] = Math.max(-1, Math.min(1, f[i])) * 0x7fff;
    pending = [];
    pendingLen = 0;
    session.sendRealtimeInput({ audio: { data: toBase64(new Uint8Array(pcm.buffer)), mimeType: 'audio/pcm;rate=16000' } });
  };
  src.connect(node);

  // A short spoken greeting so the guest knows Saathi is listening.
  session.sendRealtimeInput({ text: 'The guest just opened voice. Greet them warmly in one short sentence, in Hindi and English, and ask how you can help.' });

  return () => {
    closed = true;
    try {
      session.close();
    } catch {
      /* ignore */
    }
    stopPlayback();
    stream.getTracks().forEach((t) => t.stop());
    void inCtx.close();
    void out.close();
    h.onState('closed');
  };
}

import { useEffect, useRef, useState } from 'react';
import { post } from './api.ts';
import { storage } from './format.ts';
// The Live SDK is large; load it only when the guest taps the mic.
const startLive = async (...a: Parameters<typeof import('./live.ts').startLive>) => (await import('./live.ts')).startLive(...a);

interface Msg {
  role: 'guest' | 'saathi';
  text: string;
  note?: string;
  live?: boolean; // still being transcribed
}

type VoiceState = 'off' | 'connecting' | 'listening' | 'speaking' | 'error';

const SUGGESTIONS = ['Haldi kab hai?', 'What should I wear to the sangeet?', 'Is there an airport pickup?', 'Can I bring my kids?'];

export function Saathi({ slug, coupleNames }: { slug: string; coupleNames: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'saathi', text: `Namaste! I'm Saathi, ${coupleNames}'s wedding helper. Ask me anything — type, or tap the mic and speak in Hindi or English.` },
  ]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState<VoiceState>('off');
  const [voiceErr, setVoiceErr] = useState('');
  const stopRef = useRef<(() => void) | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const guestToken = () => storage(`guest:${slug}`) ?? '';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' }); // never return the Promise
  }, [msgs, busy]);
  useEffect(() => () => stopRef.current?.(), []);
  // Keyboard and screen-reader users land in the composer on open and back on
  // the button on close.
  useEffect(() => {
    // Not on touch screens: focusing would pop the keyboard over voice users.
    if (open && matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
    else if (wasOpen.current) fabRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  function close() {
    stopRef.current?.();
    stopRef.current = null;
    setVoice('off');
    setOpen(false);
  }

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    const history = msgs.slice(1).map(({ role, text }) => ({ role, text }));
    setMsgs((m) => [...m, { role: 'guest', text: q.trim() }]);
    setText('');
    setBusy(true);
    try {
      const r = await post<{ reply: string; actions: string[] }>(`/api/saathi/${slug}/chat`, {
        message: q.trim(),
        history,
        guest_token: guestToken(),
      });
      const note = r.actions.includes('ask_host') ? 'Sent to the host' : r.actions.includes('update_rsvp') ? 'RSVP updated' : undefined;
      setMsgs((m) => [...m, { role: 'saathi', text: r.reply, note }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'saathi', text: e instanceof Error ? e.message : 'Sorry, something went wrong.' }]);
    } finally {
      setBusy(false);
    }
  }

  // Live transcripts stream in; update the last bubble of that speaker while it's live.
  function upsert(role: 'guest' | 'saathi', t: string, final: boolean, note?: string) {
    setMsgs((m) => {
      const last = m[m.length - 1];
      if (last && last.role === role && last.live) {
        return [...m.slice(0, -1), { ...last, text: t, live: !final, note: note ?? last.note }];
      }
      return [...m, { role, text: t, live: !final, note }];
    });
  }

  async function toggleVoice() {
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
      setVoice('off');
      return;
    }
    setVoiceErr('');
    try {
      stopRef.current = await startLive(slug, guestToken(), {
        onState: (s, detail) => {
          if (s === 'closed') setVoice('off');
          else if (s === 'error') {
            setVoice('error');
            setVoiceErr(detail || 'Voice disconnected. Tap the mic to try again.');
            stopRef.current = null;
          } else setVoice(s);
        },
        onTranscript: (who, t, final) => upsert(who, t, final),
        onTool: (name) => {
          if (name === 'ask_host') upsert('saathi', '…', false, 'Sent to the host');
        },
      });
    } catch (e) {
      setVoice('error');
      setVoiceErr(e instanceof Error ? e.message : 'Microphone unavailable.');
    }
  }

  if (!open) {
    return (
      <button ref={fabRef} className="saathi-fab" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="saathi-dot" aria-hidden /> Ask Saathi
      </button>
    );
  }

  return (
    <div className="saathi-panel" role="dialog" aria-label="Ask Saathi" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <header>
        <div>
          <b>Saathi</b>
          <span aria-live="polite">{voice === 'off' ? 'Wedding helper · Hindi & English' : voice === 'connecting' ? 'Connecting…' : voice === 'speaking' ? 'Speaking…' : voice === 'listening' ? 'Listening — just speak' : 'Voice error'}</span>
        </div>
        <button className="x" aria-label="Close Saathi" onClick={close}>×</button>
      </header>

      {/* A live log: every reply, typed or spoken, also appears as text (captions for voice). */}
      <div className="saathi-msgs" role="log" aria-live="polite" aria-label="Conversation with Saathi">
        {msgs.map((m, i) => (
          <div key={i} className={`s-bubble ${m.role} ${m.live ? 'live' : ''}`}>
            {m.text}
            {m.note && <span className="s-note">✓ {m.note}</span>}
          </div>
        ))}
        {busy && <div className="s-bubble saathi live" aria-label="Saathi is typing">…</div>}
        <div ref={endRef} />
      </div>

      {msgs.length <= 1 && (
        <div className="s-chips">
          {SUGGESTIONS.map((s) => <button key={s} onClick={() => void ask(s)}>{s}</button>)}
        </div>
      )}
      {voiceErr && <p className="s-err" role="alert">{voiceErr}</p>}

      <form className="s-composer" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        <button type="button" className={`s-mic ${voice}`} onClick={() => void toggleVoice()} aria-label={voice === 'off' || voice === 'error' ? 'Talk to Saathi by voice' : 'Stop voice'} aria-pressed={voice !== 'off' && voice !== 'error'}>
          {voice === 'off' || voice === 'error' ? '🎙️' : '■'}
        </button>
        <input ref={inputRef} aria-label="Your question for Saathi" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your question…" disabled={busy} />
        <button className="s-send" disabled={busy || !text.trim()}>Ask</button>
      </form>
    </div>
  );
}

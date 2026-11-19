import { useEffect, useRef, useState } from 'react';
import { navigate } from '../App.tsx';
import { fileToAttachment, post, type Attachment, type IntakeResponse, type WeddingDraft } from '../api.ts';

interface Turn {
  role: 'host' | 'saathi';
  text: string;
  files?: string[];
}

const EMPTY: WeddingDraft = {
  partner1_name: '', partner2_name: '', partner1_family: '', partner2_family: '', invite_line: '',
  city: '', tradition: '', language: '', style: '', events: [], info: [], contact_name: '', contact_phone: '',
};

const OPENERS = {
  card: 'Upload a photo or PDF of your wedding card, or a WhatsApp forward. I\'ll read every ceremony, date and venue from it.',
  scratch: 'Namaste! Let\'s make your wedding card together. Who is getting married? Aap Hindi mein bhi bol sakte hain.',
};

export function Create() {
  const [mode, setMode] = useState<'card' | 'scratch' | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState<WeddingDraft>(EMPTY);
  const [ready, setReady] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [turns, busy]);

  function start(m: 'card' | 'scratch') {
    setMode(m);
    setTurns([{ role: 'saathi', text: OPENERS[m] }]);
    if (m === 'card') setTimeout(() => fileInput.current?.click(), 50);
  }

  async function send(message: string, attachments: Attachment[] = pending) {
    if (busy || (!message.trim() && attachments.length === 0)) return;
    const hostTurn: Turn = { role: 'host', text: message.trim(), files: attachments.map((a) => a.name || a.mime_type) };
    const history = turns.map(({ role, text }) => ({ role, text }));
    setTurns((t) => [...t, hostTurn]);
    setText('');
    setPending([]);
    setSuggestions([]);
    setError('');
    setBusy(true);
    try {
      const r = await post<IntakeResponse>('/api/intake/turn', {
        draft,
        history,
        message: message.trim(),
        attachments: attachments.map(({ mime_type, data }) => ({ mime_type, data })),
      });
      setDraft(r.draft);
      setReady(r.ready);
      setSuggestions(r.suggested_replies);
      setTurns((t) => [...t, { role: 'saathi', text: r.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const atts = await Promise.all([...files].slice(0, 4).map((f) => fileToAttachment(f, f.name)));
    // A card upload on its own is a complete turn: send it straight away.
    if (!text.trim()) void send('', atts);
    else setPending(atts);
  }

  async function toggleMic() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType.split(';')[0] || 'audio/webm' });
        void send(text, [...pending, await fileToAttachment(blob, 'Voice note')]);
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError('Microphone permission was blocked. You can type instead.');
    }
  }

  async function design() {
    setBusy(true);
    setError('');
    try {
      const r = await post<{ slug: string; host_token: string }>('/api/weddings', { draft });
      try {
        localStorage.setItem(`host:${r.slug}`, r.host_token);
      } catch {
        /* storage blocked; the host link is still shown later */
      }
      navigate(`/i/${r.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the wedding.');
      setBusy(false);
    }
  }

  return (
    <main className="create">
      <header className="brand">
        <span className="wordmark"><b>B</b>ARAATI</span> <span className="tag">Saathi</span>
      </header>

      <input
        ref={fileInput}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {!mode ? (
        <section className="choose">
          <h1 className="display">Your wedding, ready to share in minutes.</h1>
          <p className="muted">Start from the card you already have, or tell Saathi about your wedding and we'll design one.</p>
          <div className="choices">
            <button className="choice" onClick={() => start('card')}>
              <span className="icon" aria-hidden>📜</span>
              <b>I have a card</b>
              <span>Upload a photo, PDF or WhatsApp forward</span>
            </button>
            <button className="choice" onClick={() => start('scratch')}>
              <span className="icon" aria-hidden>✨</span>
              <b>Create one from scratch</b>
              <span>Chat or speak, in English or Hindi</span>
            </button>
          </div>
        </section>
      ) : (
        <section className="workspace">
          <div className="chat">
            <div className="turns">
              {turns.map((t, i) => (
                <div key={i} className={`bubble ${t.role}`}>
                  {t.files?.length ? <div className="files">📎 {t.files.join(', ')}</div> : null}
                  {t.text}
                </div>
              ))}
              {busy && <div className="bubble saathi typing">Saathi is reading…</div>}
              <div ref={endRef} />
            </div>

            {error && <p className="error">{error}</p>}

            {suggestions.length > 0 && !busy && (
              <div className="chips">
                {suggestions.map((s) => (
                  <button key={s} className="chip" onClick={() => void send(s, [])}>{s}</button>
                ))}
              </div>
            )}

            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
            >
              <button type="button" className="icon-btn" title="Attach card" onClick={() => fileInput.current?.click()}>📎</button>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={pending.length ? `${pending.length} file(s) attached — add a note or send` : 'Type, or tap the mic and speak…'}
                disabled={busy}
              />
              <button type="button" className={`icon-btn ${recording ? 'rec' : ''}`} title="Voice note" onClick={() => void toggleMic()}>
                {recording ? '■' : '🎙️'}
              </button>
              <button type="submit" className="send" disabled={busy}>Send</button>
            </form>
          </div>

          <aside className="preview">
            <p className="eyebrow">Your wedding</p>
            <h2 className="display couple">
              {draft.partner1_name || '—'} <span className="amp">&amp;</span> {draft.partner2_name || '—'}
            </h2>
            <p className="muted small">
              {[draft.city, draft.tradition, draft.style].filter(Boolean).join(' · ') || 'Details appear here as Saathi learns them.'}
            </p>
            {draft.invite_line && <p className="invite-line">{draft.invite_line}</p>}
            <ol className="events">
              {draft.events.map((e, i) => (
                <li key={i}>
                  <b>{e.name}</b>
                  <span>{[fmtDate(e.date), e.start_time].filter(Boolean).join(' · ') || 'date to confirm'}</span>
                  <span className="muted">{e.venue_name || 'venue to confirm'}</span>
                </li>
              ))}
            </ol>
            <button className="primary" disabled={!ready || busy} onClick={() => void design()}>
              {ready ? 'Design my invitation →' : 'A few details to go'}
            </button>
          </aside>
        </section>
      )}
    </main>
  );
}

function fmtDate(iso: string) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

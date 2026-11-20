import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { navigate } from '../App.tsx';
import { fileToAttachment, post, type Attachment, type IntakeResponse, type WeddingDraft } from '../api.ts';
import { fmtDate as fmtD } from '../format.ts';
import { ornamentUrl, themeFor } from '../themes.ts';

interface Turn {
  role: 'host' | 'saathi';
  text: string;
  files?: string[];
}

const EMPTY: WeddingDraft = {
  partner1_name: '', partner2_name: '', partner1_family: '', partner2_family: '', invite_line: '',
  city: '', tradition: '', language: '', style: '', events: [], info: [], contact_name: '', contact_phone: '',
};

const STYLE_TILES: [string, string, string][] = [
  ['royal-rajasthani', 'Royal Rajasthani', 'Arches, peacocks, maroon and gold'],
  ['south-indian-temple', 'South Indian temple', 'Gopurams, brass lamps, jasmine'],
  ['bengali-alpana', 'Bengali alpana', 'Rice-paste patterns, red and white'],
  ['punjabi-phulkari', 'Punjabi phulkari', 'Embroidery, marigolds, magenta'],
  ['minimal-pastel', 'Minimal pastel', 'Fine-line florals, blush and sage'],
  ['modern-floral', 'Modern floral', 'Watercolour roses, gold foil'],
];

const OPENERS = {
  card: 'Upload a photo or PDF of your wedding card, or a WhatsApp forward. I\'ll read every ceremony, date and venue from it.',
  scratch: 'Namaste! Let\'s make your wedding card together. Who is getting married? Aap Hindi mein bhi bol sakte hain.',
};

export function Create({
  embedded = false,
  onCreated,
  onDraftReady,
}: {
  embedded?: boolean;
  onCreated?: (slug: string, hostToken: string) => void;
  onDraftReady?: (draft: WeddingDraft) => void;
} = {}) {
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
  const [demo, setDemo] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((h) => setDemo(h.demo ?? null)).catch(() => {});
  }, []);

  // Braces matter: newer browsers return a Promise from scrollIntoView, and
  // React would call that as this effect's cleanup and crash the page.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

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
    if (onDraftReady) {
      onDraftReady(draft);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await post<{ slug: string; host_token: string }>('/api/weddings', { draft });
      try {
        localStorage.setItem(`host:${r.slug}`, r.host_token);
      } catch {
        /* storage blocked; the host link is still shown later */
      }
      if (onCreated) {
        setBusy(false);
        onCreated(r.slug, r.host_token);
      } else {
        navigate(`/studio/${r.slug}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the wedding.');
      setBusy(false);
    }
  }

  return (
    <main className="create">
      {!embedded && (
        <header className="brand">
          <span className="wordmark">Baraati</span> <span className="tag">Saathi</span>
        </header>
      )}

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
        <section className="landing">
          <div className="land-hero">
            <div className="land-copy">
              <span className="chip land-chip"><span className="dot" aria-hidden /> AI for Indian weddings</span>
              <h1 className="display">From a wedding card to a <span className="serif grad-text">voice concierge</span>, in minutes.</h1>
              <p className="lead">Upload your card or just talk. Saathi designs a living invitation, answers every guest in Hindi or English, and runs your guest list for you.</p>
              {demo && <a className="btn btn-ghost" href={`/i/${demo}`} target="_blank" rel="noreferrer">See a live invitation ↗</a>}
            </div>
            <div className="land-phone-wrap">
              <div className="land-phone" aria-hidden={!demo}>
                {demo ? <iframe title="A sample invitation" src={`/i/${demo}?preview=1`} tabIndex={-1} /> : <span className="land-orn" />}
              </div>
            </div>
          </div>
          <ol className="land-steps">
            <li><span className="step-num" aria-hidden>1</span><b>1 · Card → wedding</b><span>Gemini reads your printed card, PDF or voice note.</span></li>
            <li><span className="step-num" aria-hidden>2</span><b>2 · A living invitation</b><span>Nano Banana art for every ceremony, Lyria music.</span></li>
            <li><span className="step-num" aria-hidden>3</span><b>3 · Saathi for guests</b><span>Answers in Hindi by voice, on Gemini Live.</span></li>
            <li><span className="step-num" aria-hidden>4</span><b>4 · Your control room</b><span>Ask, update and message guests in one line.</span></li>
          </ol>
          <h2 className="land-start h2">Start your <span className="serif">wedding</span></h2>
          <div className="choices">
            <button className="choice card card-hover" onClick={() => start('card')}>
              <span className="icon" aria-hidden>📜</span>
              <b>I have a card</b>
              <span>Upload a photo, PDF or WhatsApp forward</span>
            </button>
            <button className="choice card card-hover" onClick={() => start('scratch')}>
              <span className="icon" aria-hidden>✨</span>
              <b>Create one from scratch</b>
              <span>Chat or speak, in English or Hindi</span>
            </button>
          </div>
        </section>
      ) : (
        <section className="workspace">
          <div className="chat">
            <div className="turns" role="log" aria-live="polite" aria-label="Conversation with Saathi">
              {turns.map((t, i) => (
                <div key={i} className={`bubble ${t.role}`}>
                  {t.files?.length ? <div className="files"><span aria-hidden>📎 </span><span className="sr-only">Attached: </span>{t.files.join(', ')}</div> : null}
                  {t.text || null}
                </div>
              ))}
              {busy && <div className="bubble saathi typing">Saathi is reading…</div>}
              <div ref={endRef} />
            </div>

            {error && <p className="error" role="alert">{error}</p>}

            {!busy && !draft.style && draft.partner1_name && draft.events.length > 0 && (
              <div className="style-tiles" role="group" aria-label="Pick a style">
                {STYLE_TILES.map(([id, label, sub]) => (
                  <button key={id} className="style-tile" onClick={() => void send(label, [])}>
                    <span className="st-swatch" style={{ background: `${ornamentUrl(id)} center / 60px` }} aria-hidden />
                    <b>{label}</b>
                    <small>{sub}</small>
                  </button>
                ))}
              </div>
            )}

            {suggestions.length > 0 && !busy && !(!draft.style && draft.partner1_name && draft.events.length > 0) && (
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
              <button type="button" className="icon-btn" title="Attach card" aria-label="Attach a card photo or PDF" onClick={() => fileInput.current?.click()}>📎</button>
              <input
                aria-label="Message to Saathi"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={pending.length ? `${pending.length} file(s) attached — add a note or send` : 'Type, or tap the mic and speak…'}
                disabled={busy}
              />
              <button type="button" className={`icon-btn ${recording ? 'rec' : ''}`} title="Voice note" aria-label={recording ? 'Stop recording and send' : 'Record a voice note'} aria-pressed={recording} onClick={() => void toggleMic()}>
                {recording ? '■' : '🎙️'}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>Send</button>
            </form>
          </div>

          <aside className="preview card" aria-label="Your invitation so far">
            <p className="eyebrow">Your invitation, live</p>
            <LiveCard draft={draft} />
            <ul className="checklist" aria-label="What Saathi still needs">
              <Check ok={Boolean(draft.partner1_name && draft.partner2_name)} label="Couple" />
              <Check ok={draft.events.some((e) => e.date)} label={`Ceremonies${draft.events.length ? ` · ${draft.events.length}` : ''}`} />
              <Check ok={draft.events.some((e) => e.date && e.venue_name)} label="Dates & venues" />
              <Check ok={Boolean(draft.style)} label="Style" />
            </ul>
            <button className="btn btn-cta login-full" disabled={!ready || busy} onClick={() => void design()}>
              {ready ? 'Design my invitation →' : 'A few details to go'}
            </button>
          </aside>
        </section>
      )}
    </main>
  );
}

const fmtDate = (iso: string) => fmtD(iso, { weekday: 'short', day: 'numeric', month: 'short' });

function Check({ ok, label }: { ok: boolean; label: string }) {
  return <li className={ok ? 'ok' : ''}><span aria-hidden>{ok ? '✓' : '○'}</span> {label}<span className="sr-only">{ok ? ' done' : ' still needed'}</span></li>;
}

/** A miniature of the guest's invitation, re-themed as soon as a style is chosen. */
function LiveCard({ draft }: { draft: WeddingDraft }) {
  const t = themeFor(draft.style);
  const vars = { '--i-bg': t.bg, '--i-panel': t.panel, '--i-ink': t.ink, '--i-accent': t.accent, '--i-soft': t.soft, '--i-art': ornamentUrl(draft.style) } as CSSProperties;
  const dates = [...new Set(draft.events.map((e) => e.date).filter(Boolean))].sort();
  const range = dates.length > 1 ? `${fmtDate(dates[0])} – ${fmtDate(dates.at(-1)!)}` : dates[0] ? fmtDate(dates[0]) : '';
  return (
    <div className={`livecard ${draft.style ? 'styled' : ''}`} style={vars}>
      <div className="lc-panel">
        {draft.invite_line && <p className="lc-line">{draft.invite_line}</p>}
        <p className="lc-names">
          <span>{draft.partner1_name || '·····'}</span> <i>&amp;</i> <span>{draft.partner2_name || '·····'}</span>
        </p>
        {(draft.partner1_family || draft.partner2_family) && <p className="lc-fam">{[draft.partner1_family, draft.partner2_family].filter(Boolean).join(' · ')}</p>}
        <p className="lc-date">{[range, draft.city].filter(Boolean).join(' · ') || 'Dates and city appear here'}</p>
      </div>
      <ol className="lc-events">
        {draft.events.map((e, i) => (
          <li key={e.name + i} style={{ animationDelay: `${i * 70}ms` }}>
            <b>{e.name}</b>
            <span>{[fmtDate(e.date), e.start_time].filter(Boolean).join(' · ') || 'date to confirm'}</span>
            <span className="lc-venue">{e.venue_name || 'venue to confirm'}</span>
          </li>
        ))}
        {!draft.events.length && <li className="lc-empty">Ceremonies appear here as Saathi learns them.</li>}
      </ol>
    </div>
  );
}


// The host's AI control room: briefing, live numbers, and an agent the host can
// type or speak to. The agent proposes changes as cards; nothing changes until
// the host taps Publish.
import { useEffect, useRef, useState } from 'react';
import { fileToAttachment, post, type Attachment, type WeddingDraft } from '../api.ts';
import { fmtDate, fmtTime } from '../format.ts';
import { Rich } from '../rich.tsx';
import '../control.css';

interface Rsvp {
  id: string;
  name: string;
  status: 'yes' | 'no' | 'maybe';
  party_size: number;
  note: string | null;
  phone_masked: string;
  created_at: string;
  extracted: {
    adults?: number; children?: number; arrival_date?: string; arrival_time?: string;
    arrival_mode?: string; arrival_point?: string; needs_pickup?: boolean; dietary?: string; other?: string;
  } | null;
}
interface Question { id: string; question: string; answer: string | null; status: 'open' | 'answered'; created_at: string }
interface HostData { slug: string; draft: WeddingDraft; rsvps: Rsvp[]; questions: Question[] }

interface Stats {
  replied: number; yes: number; maybe: number; no: number; heads: number; kids: number;
  pickups: number; pickup_people: number; days_to_wedding: number | null;
  diet: { label: string; households: number }[];
  arrivals: { date: string; people: number; pickups: number; guests: string[] }[];
}
interface Briefing {
  stats: Stats;
  briefing: { headline: string; items: { title: string; detail: string; prompt: string }[] } | null;
  announcements: { id: string; text_en: string; text_hi: string | null; audience: string; created_at: string }[];
}
interface Proposal { id: string; kind: 'event_change' | 'announcement' | 'info_card' | 'question_answer'; title: string; detail: string; payload: Record<string, unknown> }
interface QueryData { question: string; sql: string; columns: string[]; rows: Record<string, unknown>[]; ms: number }
interface Msg { role: 'host' | 'saathi'; text: string; voice?: boolean; proposals?: Proposal[]; data?: QueryData | null }

export function Host({ slug }: { slug: string }) {
  const token = new URLSearchParams(location.search).get('t') ?? '';
  const [data, setData] = useState<HostData | null>(null);
  const [brief, setBrief] = useState<Briefing | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null); // prompt pushed into the control room

  const sig = data ? `${data.rsvps.length}:${data.rsvps.map((r) => r.status + (r.extracted ? 1 : 0)).join('')}:${data.questions.filter((q) => q.status === 'open').length}` : '';

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/host/${slug}?t=${encodeURIComponent(token)}`)
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          if (alive) { setData(j); setError(''); }
        })
        .catch((e) => alive && setError(e.message));
    void load();
    const t = setInterval(load, 3000); // live during the demo
    return () => { alive = false; clearInterval(t); };
  }, [slug, token]);

  // Briefing + charts: refetch when the RSVPs or questions change.
  const refreshBrief = () =>
    fetch(`/api/host/${slug}/briefing?t=${encodeURIComponent(token)}`).then((r) => (r.ok ? r.json() : null)).then((j) => j && setBrief(j)).catch(() => {});
  useEffect(() => {
    if (sig) void refreshBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (error && !data) return <main className="shell"><h1 className="display">Control room</h1><p className="error">{error}</p></main>;
  if (!data) return <main className="shell muted">Loading…</main>;

  const d = data.draft;
  const s = brief?.stats;
  const open = data.questions.filter((q) => q.status === 'open');

  return (
    <main className="cr">
      <header className="cr-top">
        <div className="cr-brand">
          <span className="wordmark"><b>B</b>ARAATI</span> <span className="tag">Saathi</span>
        </div>
        <nav className="cr-links" aria-label="Wedding pages">
          <a href={`/i/${slug}`} target="_blank" rel="noreferrer">Invitation ↗</a>
          <a href={`/studio/${slug}?t=${encodeURIComponent(token)}`}>Studio</a>
          <span className="live"><span className="live-dot" aria-hidden>●</span> Live</span>
        </nav>
      </header>

      <section className="cr-hero">
        <div>
          <p className="eyebrow">Control room</p>
          <h1 className="display">{d.partner1_name} <span className="amp">&amp;</span> {d.partner2_name}</h1>
          <p className="muted">
            {[d.city, s?.days_to_wedding != null && s.days_to_wedding >= 0 ? `${s.days_to_wedding} days to go` : '', `${d.events.length} ceremonies`].filter(Boolean).join(' · ')}
          </p>
        </div>
        {brief?.briefing?.headline && <p className="cr-headline">“{brief.briefing.headline}”</p>}
      </section>

      <div className="cr-stats">
        <Stat n={s?.yes ?? data.rsvps.filter((r) => r.status === 'yes').length} label="Coming" />
        <Stat n={s?.maybe ?? 0} label="Maybe" />
        <Stat n={s?.heads ?? 0} label="Expected people" accent />
        <Stat n={s?.kids ?? 0} label="Children" />
        <Stat n={s?.pickups ?? 0} label="Need pickup" sub={s?.pickup_people ? `${s.pickup_people} people` : undefined} />
        <Stat n={open.length} label="Questions for you" warn={open.length > 0} />
      </div>

      <div className="cr-grid">
        <ControlRoom slug={slug} token={token} push={pending} onPushed={() => setPending(null)} onChange={() => void refreshBrief()} />

        <aside className="cr-side">
          <section className="cr-card brief" aria-labelledby="brief-h">
            <h2 id="brief-h"><span className="spark" aria-hidden>✦</span> Today's briefing</h2>
            {!brief?.briefing && <p className="muted small">{data.rsvps.length ? 'Saathi is reading your RSVPs…' : 'Your briefing appears once guests start replying.'}</p>}
            <ul className="brief-list">
              {brief?.briefing?.items.map((it) => (
                <li key={it.title}>
                  <b>{it.title}</b>
                  <span>{it.detail}</span>
                  <button className="brief-do" onClick={() => setPending(it.prompt)}>Ask Saathi to do it →</button>
                </li>
              ))}
            </ul>
          </section>

          {s && s.arrivals.length > 0 && (
            <section className="cr-card" aria-labelledby="arr-h">
              <h2 id="arr-h">Arrivals</h2>
              <Arrivals arrivals={s.arrivals} events={d.events} />
            </section>
          )}

          {s && s.diet.length > 0 && (
            <section className="cr-card" aria-labelledby="diet-h">
              <h2 id="diet-h">Food needs</h2>
              <Bars items={s.diet.map((x) => ({ label: x.label, value: x.households }))} unit="households" />
            </section>
          )}

          {brief && brief.announcements.length > 0 && (
            <section className="cr-card" aria-labelledby="ann-h">
              <h2 id="ann-h">Published updates</h2>
              <ul className="ann-list">
                {brief.announcements.map((a) => (
                  <li key={a.id}><span>{a.text_en}</span><small>{audienceLabel(a.audience)} · {ago(a.created_at)}</small></li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      <div className="cr-lower">
        <section className="cr-card" aria-labelledby="rsvp-h">
          <h2 id="rsvp-h">RSVPs <span className="count">{data.rsvps.length}</span></h2>
          {data.rsvps.length === 0 && <p className="muted">Share the invitation. RSVPs appear here the moment guests answer.</p>}
          <ul className="rsvp-list">
            {data.rsvps.map((r) => (
              <li key={r.id} className={`rsvp-row ${r.status}`}>
                <div>
                  <b>{r.name}</b> <span className="muted small">{r.phone_masked}</span>
                  <div className="badges">
                    <span className={`badge ${r.status}`}>{r.status === 'yes' ? 'Coming' : r.status === 'maybe' ? 'Maybe' : "Can't come"}</span>
                    {r.status !== 'no' && <span className="badge">{r.party_size} {r.party_size === 1 ? 'person' : 'people'}</span>}
                    {r.extracted?.needs_pickup && <span className="badge ai">Pickup{r.extracted.arrival_point ? ` · ${r.extracted.arrival_point}` : ''}</span>}
                    {r.extracted?.arrival_date && <span className="badge ai">Arrives {fmtDate(r.extracted.arrival_date, { day: 'numeric', month: 'short' })}{r.extracted.arrival_time ? ` ${fmtTime(r.extracted.arrival_time)}` : ''}</span>}
                    {r.extracted?.children ? <span className="badge ai">{r.extracted.children} {r.extracted.children === 1 ? 'child' : 'children'}</span> : null}
                    {r.extracted?.dietary && <span className="badge ai">{r.extracted.dietary}</span>}
                  </div>
                  {r.note && <p className="note">“{r.note}”</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="cr-card" aria-labelledby="q-h">
          <h2 id="q-h">Questions Saathi couldn't answer <span className="count">{open.length}</span></h2>
          {open.length === 0 && <p className="muted">None right now. Saathi answers guests from your schedule, info cards and updates.</p>}
          <ul className="q-list">
            {open.map((q) => (
              <li key={q.id}>
                <span>{q.question}</span>
                <button className="brief-do" onClick={() => setPending(`Answer the guest question "${q.question}": `)}>Answer with Saathi →</button>
              </li>
            ))}
          </ul>
          {data.questions.some((q) => q.status === 'answered') && (
            <p className="q-done">{data.questions.filter((q) => q.status === 'answered').length} answered. Saathi now tells every guest.</p>
          )}
        </section>
      </div>
    </main>
  );
}

// ── The agent ───────────────────────────────────────────────────────────────

const STARTERS = [
  'Haldi moved to 12 noon. Tell everyone.',
  'Who lands on the Sangeet day and needs a pickup?',
  'Kitne log Jain khana khayenge?',
  'Remind the maybe guests to confirm by Friday',
];

function ControlRoom({ slug, token, push, onPushed, onChange }: {
  slug: string; token: string; push: string | null; onPushed: () => void; onChange: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [msgs, busy]);

  useEffect(() => {
    if (!push) return;
    onPushed();
    if (push.endsWith(': ')) {
      setText(push);
      inputRef.current?.focus();
    } else void send(push);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [push]);

  async function send(message: string, audio?: Attachment) {
    if (busy || (!message.trim() && !audio)) return;
    const history = msgs.map(({ role, text }) => ({ role, text }));
    setMsgs((m) => [...m, { role: 'host', text: message.trim() || '🎙️ Voice message…', voice: Boolean(audio) }]);
    setText('');
    setErr('');
    setBusy(true);
    try {
      const r = await post<{ reply: string; heard: string; proposals: Proposal[]; data: QueryData | null }>(`/api/host/${slug}/agent`, {
        t: token, message: message.trim(), history, audio,
      });
      setMsgs((m) => {
        const next = [...m];
        if (audio && r.heard) next[next.length - 1] = { ...next[next.length - 1], text: r.heard };
        return [...next, { role: 'saathi', text: r.reply, proposals: r.proposals, data: r.data }];
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Saathi could not do that.');
    } finally {
      setBusy(false);
    }
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
        const a = await fileToAttachment(blob);
        void send(text, { mime_type: a.mime_type, data: a.data });
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setErr('Microphone permission was blocked. You can type instead.');
    }
  }

  // Short starters; the briefing's longer suggestions live on its own cards.
  const chips = msgs.length ? STARTERS.slice(0, 2) : STARTERS;

  return (
    <section className="room" aria-labelledby="room-h">
      <header className="room-head">
        <div>
          <h2 id="room-h">Ask Saathi to run your wedding</h2>
          <p>Type or speak, in Hindi or English. Saathi checks your guest list, drafts changes and updates. You approve.</p>
        </div>
        <span className="room-models" aria-hidden>Gemini · AlloyDB</span>
      </header>

      <div className="room-thread" role="log" aria-live="polite" aria-label="Conversation with Saathi">
        {msgs.length === 0 && (
          <div className="room-empty">
            <p>Try one of these, or say anything.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`rm ${m.role}`}>
            <div className="rm-bubble">{m.voice && <span className="rm-voice" aria-label="Spoken">🎙️ </span>}{m.role === 'saathi' ? <Rich text={m.text} /> : m.text}</div>
            {m.data && <DataCard d={m.data} />}
            {m.proposals?.map((p) => <ProposalCard key={p.id} p={p} slug={slug} token={token} onApplied={onChange} />)}
          </div>
        ))}
        {busy && (
          <div className="rm saathi">
            <div className="rm-bubble working"><span className="dots" aria-hidden><i /><i /><i /></span> <Progress /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {err && <p className="room-err" role="alert">{err}</p>}

      {!busy && (
        <div className="room-chips">
          {chips.map((c) => <button key={c} onClick={() => void send(c)}>{c}</button>)}
        </div>
      )}

      <form className="room-composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <button type="button" className={`room-mic ${recording ? 'rec' : ''}`} onClick={() => void toggleMic()} aria-pressed={recording} aria-label={recording ? 'Stop and send' : 'Speak to Saathi'}>
          {recording ? '■' : '🎙️'}
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          aria-label="Tell Saathi what you need"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }}
          placeholder={recording ? 'Listening… tap ■ when done' : 'e.g. "Sangeet 30 minute late hai, sabko bata do"'}
          disabled={busy}
        />
        <button className="room-send" disabled={busy || !text.trim()}>Send</button>
      </form>
    </section>
  );
}

/** What Saathi is doing, while the agent works (Gemini calls take a few seconds each). */
function Progress() {
  const steps = ['Understanding your request…', 'Checking your guest list in AlloyDB…', 'Drafting changes for you to approve…', 'Writing it in English and Hindi…'];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 3200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <span>{steps[i]}</span>;
}

function DataCard({ d }: { d: QueryData }) {
  const cols = d.columns.filter((c) => c !== 'note');
  return (
    <div className="rm-data">
      {d.rows.length > 0 && cols.length > 0 && (
        <div className="ask-table-wrap">
          <table className="ask-table">
            <thead><tr>{cols.map((c) => <th key={c} scope="col">{c.replace(/_/g, ' ')}</th>)}</tr></thead>
            <tbody>
              {d.rows.slice(0, 30).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{fmtCell(r[c])}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      )}
      <details className="ask-sql">
        <summary>{d.rows.length} row{d.rows.length === 1 ? '' : 's'} · AlloyDB · {d.ms} ms · read-only sandbox</summary>
        <pre>{d.sql}</pre>
      </details>
    </div>
  );
}

const KIND: Record<Proposal['kind'], { icon: string; label: string; cta: string }> = {
  event_change: { icon: '🗓️', label: 'Schedule change', cta: 'Update schedule' },
  announcement: { icon: '📣', label: 'Update for guests', cta: 'Publish' },
  info_card: { icon: '💡', label: 'Info card', cta: 'Save' },
  question_answer: { icon: '💬', label: 'Answer a guest', cta: 'Send answer' },
};

function ProposalCard({ p, slug, token, onApplied }: { p: Proposal; slug: string; token: string; onApplied: () => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'dismissed'>('idle');
  const [msg, setMsg] = useState('');
  const [wa, setWa] = useState<{ name: string; phone: string; url: string }[]>([]);
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const k = KIND[p.kind];
  const hi = typeof p.payload.text_hi === 'string' ? p.payload.text_hi : '';

  async function apply() {
    setState('busy');
    try {
      const r = await post<{ message: string; whatsapp?: typeof wa }>(`/api/host/${slug}/apply`, { t: token, proposal: p });
      setMsg(r.message);
      setWa(r.whatsapp ?? []);
      setState('done');
      onApplied();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not apply.');
      setState('idle');
    }
  }

  if (state === 'dismissed') return <div className="pc dismissed">Dismissed: {p.title}</div>;
  return (
    <div className={`pc ${p.kind} ${state}`}>
      <div className="pc-head">
        <span className="pc-icon" aria-hidden>{k.icon}</span>
        <div>
          <small>{k.label}</small>
          <b>{p.title}</b>
        </div>
        {p.kind === 'announcement' && hi && (
          <div className="pc-lang" role="group" aria-label="Language">
            <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
            <button aria-pressed={lang === 'hi'} onClick={() => setLang('hi')}>हिं</button>
          </div>
        )}
      </div>
      <p className="pc-body" lang={lang === 'hi' && hi ? 'hi' : undefined}>{lang === 'hi' && hi ? hi : p.detail}</p>
      {state !== 'done' ? (
        <div className="pc-actions">
          <button className="pc-go" disabled={state === 'busy'} onClick={() => void apply()}>{state === 'busy' ? 'Applying…' : k.cta}</button>
          <button className="pc-skip" disabled={state === 'busy'} onClick={() => setState('dismissed')}>Dismiss</button>
          {msg && <span className="error" role="alert">{msg}</span>}
        </div>
      ) : (
        <div className="pc-done" role="status">
          <span>✓ {msg}</span>
          {wa.length > 0 && (
            <details className="pc-wa" open={wa.length <= 6}>
              <summary>Personalised WhatsApp messages · {wa.filter((x) => x.url).length} ready</summary>
              <ul>
                {wa.map((x) => (
                  <li key={x.name}>
                    <span>{x.name} <small>{x.phone || 'no phone'}</small></span>
                    {x.url ? <a href={x.url} target="_blank" rel="noreferrer">Send ↗</a> : <small className="muted">sees it on the invitation</small>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ── Charts (plain SVG/CSS, no library) ──────────────────────────────────────

function Arrivals({ arrivals, events }: { arrivals: Stats['arrivals']; events: WeddingDraft['events'] }) {
  const max = Math.max(...arrivals.map((a) => a.people), 1);
  return (
    <div className="arr" role="img" aria-label={arrivals.map((a) => `${a.date}: ${a.people} people, ${a.pickups} need pickup`).join('; ')}>
      {arrivals.map((a) => {
        const ev = events.filter((e) => e.date === a.date).map((e) => e.name).join(' · ');
        return (
          <div key={a.date} className="arr-col" title={a.guests.join(', ')}>
            <span className="arr-n">{a.people}</span>
            <div className="arr-bar" style={{ height: `${(a.people / max) * 100}%` }}>
              {a.pickups > 0 && <div className="arr-pick" style={{ height: `${(a.pickups / a.people) * 100}%` }} />}
            </div>
            <span className="arr-d">{fmtDate(a.date, { day: 'numeric', month: 'short' })}</span>
            {ev && <span className="arr-e">{ev}</span>}
          </div>
        );
      })}
      <p className="arr-key"><i className="k1" /> arriving <i className="k2" /> need pickup</p>
    </div>
  );
}

function Bars({ items, unit }: { items: { label: string; value: number }[]; unit: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="hbars">
      {items.map((i) => (
        <li key={i.label}>
          <span className="hb-l">{i.label}</span>
          <span className="hb-track"><span className="hb-fill" style={{ width: `${(i.value / max) * 100}%` }} /></span>
          <span className="hb-v">{i.value} <small>{unit}</small></span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ n, label, accent, warn, sub }: { n: number; label: string; accent?: boolean; warn?: boolean; sub?: string }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''} ${warn ? 'warn' : ''}`}>
      <b>{n}</b>
      <span>{label}{sub ? <em> · {sub}</em> : null}</span>
    </div>
  );
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

const audienceLabel = (a: string) => ({ all: 'Everyone', coming: 'Coming guests', maybe: 'Maybe guests', pickup: 'Pickup guests' })[a] ?? a;

function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

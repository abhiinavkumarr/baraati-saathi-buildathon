import { useEffect, useRef, useState } from 'react';
import { fileToAttachment, post, type Attachment } from '../../api.ts';
import { Rich } from '../../rich.tsx';
import type { Msg, Proposal, QueryData } from './types.ts';
import '../../control.css';

const STARTERS = [
  'Haldi moved to 12 noon. Tell everyone.',
  'Who lands on the Sangeet day and needs a pickup?',
  'Kitne log Jain khana khayenge?',
  'Remind the maybe guests to confirm by Friday',
];

export function ControlRoom({
  slug,
  token,
  push,
  onPushed,
  onChange,
  compact = false,
}: {
  slug: string;
  token: string;
  push: string | null;
  onPushed: () => void;
  onChange: () => void;
  compact?: boolean;
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
        t: token,
        message: message.trim(),
        history,
        audio,
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

  const chips = msgs.length ? STARTERS.slice(0, 2) : STARTERS;

  return (
    <section className={`room ${compact ? 'room-compact' : ''}`} aria-labelledby={compact ? undefined : 'room-h'}>
      {!compact && (
        <header className="room-head">
          <div>
            <h2 id="room-h">Ask Saathi to run your <span className="serif">wedding</span></h2>
            <p>Type or speak, in Hindi or English. Saathi checks your guest list, drafts changes and updates. You approve.</p>
          </div>
          <span className="badge ai" aria-hidden>✦ Gemini · AlloyDB</span>
        </header>
      )}

      <div className="room-thread" role="log" aria-live="polite" aria-label="Conversation with Saathi">
        {msgs.length === 0 && (
          <div className="room-empty">
            <p>Try one of these, or say anything.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`rm ${m.role}`}>
            <div className="rm-bubble">
              {m.voice && <span className="rm-voice" aria-label="Spoken">🎙️ </span>}
              {m.role === 'saathi' ? <Rich text={m.text} /> : m.text}
            </div>
            {m.data && <DataCard d={m.data} />}
            {m.proposals?.map((p) => (
              <ProposalCard key={p.id} p={p} slug={slug} token={token} onApplied={onChange} />
            ))}
          </div>
        ))}
        {busy && (
          <div className="rm saathi">
            <div className="rm-bubble working">
              <span className="dots" aria-hidden><i /><i /><i /></span> <Progress />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {err && <p className="room-err" role="alert">{err}</p>}

      {!busy && (
        <div className="room-chips">
          {chips.map((c) => (
            <button className="chip" key={c} onClick={() => void send(c)}>{c}</button>
          ))}
        </div>
      )}

      <form className="room-composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <button
          type="button"
          className={`icon-btn ${recording ? 'rec' : ''}`}
          onClick={() => void toggleMic()}
          aria-pressed={recording}
          aria-label={recording ? 'Stop and send' : 'Speak to Saathi'}
        >
          {recording ? '■' : '🎙️'}
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          aria-label="Tell Saathi what you need"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          placeholder={recording ? 'Listening… tap ■ when done' : 'e.g. "Sangeet 30 minute late hai, sabko bata do"'}
          disabled={busy}
        />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </section>
  );
}

/** What Saathi is doing, while the agent works (Gemini calls take a few seconds each). */
export function Progress() {
  const steps = [
    'Understanding your request…',
    'Checking your wedding data in AlloyDB…',
    'Drafting changes for you to approve…',
    'Writing it in English and Hindi…',
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 3200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <span>{steps[i]}</span>;
}

export function DataCard({ d }: { d: QueryData }) {
  const cols = d.columns.filter((c) => c !== 'note');
  return (
    <div className="rm-data">
      {d.rows.length > 0 && cols.length > 0 && (
        <div className="ask-table-wrap">
          <table className="ask-table">
            <thead>
              <tr>{cols.map((c) => <th key={c} scope="col">{c.replace(/_/g, ' ')}</th>)}</tr>
            </thead>
            <tbody>
              {d.rows.slice(0, 30).map((r, i) => (
                <tr key={i}>{cols.map((c) => <td key={c}>{fmtCell(r[c])}</td>)}</tr>
              ))}
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
  reminders: { icon: '💌', label: 'Guest reminders', cta: 'Prepare WhatsApp links' },
  tasks: { icon: '✅', label: 'Checklist tasks', cta: 'Add tasks' },
  vendor: { icon: '🤝', label: 'New vendor', cta: 'Add vendor' },
  vendor_bundle: { icon: '📄', label: 'Vendor quote', cta: 'Save vendor & schedule' },
  payment: { icon: '💳', label: 'Payment', cta: 'Record payment' },
  budget_line: { icon: '📊', label: 'Budget line', cta: 'Update budget' },
  rooming: { icon: '🏨', label: 'Room assignments', cta: 'Assign rooms' },
  pickups: { icon: '🚗', label: 'Airport pickups', cta: 'Publish & add task' },
};

export function ProposalCard({
  p,
  slug,
  token,
  onApplied,
}: {
  p: Proposal;
  slug: string;
  token: string;
  onApplied: () => void;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'dismissed'>('idle');
  const [msg, setMsg] = useState('');
  const [wa, setWa] = useState<{ name: string; phone: string; url: string }[]>([]);
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const k = KIND[p.kind] ?? { icon: '✦', label: p.kind, cta: 'Apply' };
  const reminderItems =
    p.kind === 'reminders' && Array.isArray(p.payload.items)
      ? (p.payload.items as { guest_name: string; message_en: string; message_hi?: string }[])
      : [];
  const hi =
    typeof p.payload.text_hi === 'string'
      ? p.payload.text_hi
      : reminderItems.some((r) => r.message_hi)
        ? reminderItems.map((r) => `${r.guest_name}: ${r.message_hi || r.message_en}`).join('\n\n')
        : '';

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
          <span className="badge ai">✦ {k.label}</span>
          <b>{p.title}</b>
        </div>
        {(p.kind === 'announcement' || p.kind === 'reminders') && hi && (
          <div className="pc-lang" role="group" aria-label="Language">
            <button className={`chip ${lang === 'en' ? 'on' : ''}`} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
            <button className={`chip ${lang === 'hi' ? 'on' : ''}`} aria-pressed={lang === 'hi'} onClick={() => setLang('hi')}>हिं</button>
          </div>
        )}
      </div>
      <p className="pc-body" lang={lang === 'hi' && hi ? 'hi' : undefined}>{lang === 'hi' && hi ? hi : p.detail}</p>
      {state !== 'done' ? (
        <div className="pc-actions">
          <button className="btn btn-ghost btn-sm" disabled={state === 'busy'} onClick={() => setState('dismissed')}>Dismiss</button>
          <button className="btn btn-cta btn-sm" disabled={state === 'busy'} onClick={() => void apply()}>{state === 'busy' ? 'Applying…' : k.cta}</button>
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

function fmtCell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

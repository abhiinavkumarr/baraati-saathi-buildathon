import { useEffect, useState } from 'react';
import { post, type WeddingDraft } from '../api.ts';

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

export function Host({ slug }: { slug: string }) {
  const token = new URLSearchParams(location.search).get('t') ?? '';
  const [data, setData] = useState<HostData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/host/${slug}?t=${encodeURIComponent(token)}`)
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          if (alive) {
            setData(j);
            setError('');
          }
        })
        .catch((e) => alive && setError(e.message));
    void load();
    const t = setInterval(load, 3000); // live during the demo
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [slug, token]);

  if (error && !data) return <main className="shell"><h1 className="display">Dashboard</h1><p className="error">{error}</p></main>;
  if (!data) return <main className="shell muted">Loading…</main>;

  const yes = data.rsvps.filter((r) => r.status === 'yes');
  const maybe = data.rsvps.filter((r) => r.status === 'maybe');
  const no = data.rsvps.filter((r) => r.status === 'no');
  const heads = [...yes, ...maybe].reduce((n, r) => n + r.party_size, 0);
  const pickups = data.rsvps.filter((r) => r.status !== 'no' && r.extracted?.needs_pickup);
  const open = data.questions.filter((q) => q.status === 'open');

  return (
    <main className="host">
      <header className="brand">
        <span className="wordmark"><b>B</b>ARAATI</span> <span className="tag">Saathi</span>
        <span className="live">● Live</span>
      </header>
      <h1 className="display couple">{data.draft.partner1_name} <span className="amp">&amp;</span> {data.draft.partner2_name}</h1>

      <div className="stats">
        <Stat n={yes.length} label="Coming" />
        <Stat n={maybe.length} label="Maybe" />
        <Stat n={no.length} label="Can't come" />
        <Stat n={heads} label="Expected people" accent />
        <Stat n={pickups.length} label="Need pickup" />
        <Stat n={open.length} label="Questions for you" />
      </div>

      <div className="host-grid">
        <section className="card-box">
          <h2>RSVPs</h2>
          {data.rsvps.length === 0 && <p className="muted">Share the link. RSVPs appear here the moment guests answer.</p>}
          <ul className="rsvp-list">
            {data.rsvps.map((r) => (
              <li key={r.id} className={`rsvp-row ${r.status}`}>
                <div>
                  <b>{r.name}</b> <span className="muted small">{r.phone_masked}</span>
                  <div className="badges">
                    <span className={`badge ${r.status}`}>{r.status === 'yes' ? 'Coming' : r.status === 'maybe' ? 'Maybe' : "Can't come"}</span>
                    {r.status !== 'no' && <span className="badge">{r.party_size} {r.party_size === 1 ? 'person' : 'people'}</span>}
                    {r.extracted?.needs_pickup && <span className="badge ai">Pickup{r.extracted.arrival_point ? ` · ${r.extracted.arrival_point}` : ''}</span>}
                    {r.extracted?.arrival_time && <span className="badge ai">Arrives {r.extracted.arrival_date} {r.extracted.arrival_time}</span>}
                    {r.extracted?.children ? <span className="badge ai">{r.extracted.children} {r.extracted.children === 1 ? 'child' : 'children'}</span> : null}
                    {r.extracted?.dietary && <span className="badge ai">{r.extracted.dietary}</span>}
                  </div>
                  {r.note && <p className="note">“{r.note}”</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card-box">
          <h2>Questions Saathi couldn't answer</h2>
          {open.length === 0 && <p className="muted">None yet. Saathi answers guests from your schedule and info.</p>}
          <ul className="q-list">
            {open.map((q) => <QuestionRow key={q.id} slug={slug} token={token} q={q} />)}
          </ul>
          {data.questions.some((q) => q.status === 'answered') && (
            <p className="q-done">
              {data.questions.filter((q) => q.status === 'answered').length} answered — Saathi now tells every guest.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function QuestionRow({ slug, token, q }: { slug: string; token: string; q: Question }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <li>
      <span>{q.question}</span>
      <form
        className="q-answer"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr('');
          try {
            await post(`/api/host/${slug}/questions/${q.id}/answer`, { t: token, answer });
          } catch (x) {
            setErr(x instanceof Error ? x.message : 'Could not save.');
            setBusy(false);
          }
        }}
      >
        <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer for all guests" disabled={busy} />
        <button disabled={busy || !answer.trim()}>Answer</button>
      </form>
      {err && <span className="error">{err}</span>}
    </li>
  );
}

function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

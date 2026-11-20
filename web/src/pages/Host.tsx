// The host's AI control room: briefing, live numbers, and an agent the host can
// type or speak to. The agent proposes changes as cards; nothing changes until
// the host taps Publish.
import { useEffect, useState } from 'react';
import { type WeddingDraft } from '../api.ts';
import { fmtDate, fmtTime } from '../format.ts';
import { ControlRoom } from '../components/agent/ControlRoom.tsx';
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
    arrival_mode?: string; arrival_point?: string; flight_or_train?: string;
    ticket_passengers?: number; needs_pickup?: boolean; dietary?: string; other?: string;
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

export function Host({
  slug,
  tokenOverride,
  embedded = false,
}: {
  slug: string;
  tokenOverride?: string;
  embedded?: boolean;
  onOpenStudio?: () => void;
}) {
  const token = tokenOverride ?? new URLSearchParams(location.search).get('t') ?? '';
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
      {!embedded && (
        <header className="cr-top">
          <div className="cr-brand">
            <span className="wordmark">Baraati</span> <span className="tag">Saathi</span>
          </div>
          <nav className="cr-links" aria-label="Wedding pages">
            <a className="btn btn-ghost btn-sm" href={`/i/${slug}`} target="_blank" rel="noreferrer">Invitation ↗</a>
            <a className="btn btn-outline btn-sm" href={`/studio/${slug}?t=${encodeURIComponent(token)}`}>Studio</a>
            <span className="live"><span className="live-dot" aria-hidden>●</span> Live</span>
          </nav>
        </header>
      )}

      <section className="cr-hero panel-ink">
        <div>
          <p className="eyebrow">Control room</p>
          <h1 className="display">{d.partner1_name} <span className="amp serif">&amp;</span> {d.partner2_name}</h1>
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
                  <button className="brief-do btn btn-white btn-sm" onClick={() => setPending(it.prompt)}>Ask Saathi to do it →</button>
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
                    {r.extracted?.flight_or_train && <span className="badge ai">✈️ {r.extracted.flight_or_train}</span>}
                    {r.extracted?.ticket_passengers && r.extracted.ticket_passengers > 0 && r.extracted.ticket_passengers !== r.party_size ? (
                      <span className="badge warn">Ticket: {r.extracted.ticket_passengers} vs RSVP: {r.party_size}</span>
                    ) : null}
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
                <button className="btn btn-ghost btn-sm" onClick={() => setPending(`Answer the guest question "${q.question}": `)}>Answer with Saathi →</button>
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
      <b className="num">{n}</b>
      <span>{label}{sub ? <em> · {sub}</em> : null}</span>
    </div>
  );
}

const audienceLabel = (a: string) => ({ all: 'Everyone', coming: 'Coming guests', maybe: 'Maybe guests', pickup: 'Pickup guests' })[a] ?? a;

function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

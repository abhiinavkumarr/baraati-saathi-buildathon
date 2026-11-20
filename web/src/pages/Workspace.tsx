import { useEffect, useMemo, useState } from 'react';
import { type WeddingDraft } from '../api.ts';
import { fmtDate, fmtTime } from '../format.ts';
import { Create } from './Create.tsx';
import { Host } from './Host.tsx';
import { Studio } from './Studio.tsx';
import { createSampleWedding, type ActiveWedding, type UserSession } from './Login.tsx';
import '../workspace.css';

type Tab = 'overview' | 'invitations' | 'guests' | 'ceremonies' | 'logistics' | 'planning';

interface RsvpRow {
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

interface HostSnapshot {
  slug: string;
  draft: WeddingDraft;
  rsvps: RsvpRow[];
}

interface TaskItem {
  id: string;
  title: string;
  category: string;
  done: boolean;
}

interface BudgetItem {
  id: string;
  category: string;
  allocated: number; // in INR
  paid: number; // in INR
}

const DEFAULT_TASKS: TaskItem[] = [
  { id: 't1', title: 'Finalise ceremony schedule & venues', category: 'Schedule', done: true },
  { id: 't2', title: 'Generate wedding invitation card & music in Studio', category: 'Invitations', done: false },
  { id: 't3', title: 'Share personalised WhatsApp invites with both families', category: 'Invitations', done: false },
  { id: 't4', title: 'Confirm Jain & special dietary counts with caterer', category: 'Catering', done: false },
  { id: 't5', title: 'Assign airport & station pickup cabs from RSVPs', category: 'Logistics', done: false },
  { id: 't6', title: 'Remind maybe guests 7 days before Haldi', category: 'Guests', done: false },
  { id: 't7', title: 'Confirm hotel rooming list for outstation relatives', category: 'Hospitality', done: false },
];

const DEFAULT_BUDGET: BudgetItem[] = [
  { id: 'b1', category: 'Venue & Hospitality', allocated: 1800000, paid: 600000 },
  { id: 'b2', category: 'Catering & Mithai', allocated: 1200000, paid: 300000 },
  { id: 'b3', category: 'Decor & Mandap', allocated: 750000, paid: 200000 },
  { id: 'b4', category: 'Photography & Film', allocated: 450000, paid: 150000 },
  { id: 'b5', category: 'Travel & Pickups', allocated: 250000, paid: 50000 },
  { id: 'b6', category: 'Invitations & Gifting', allocated: 150000, paid: 50000 },
];

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Control Room', icon: '✦' },
  { id: 'invitations', label: 'Invitations & Send', icon: '💌' },
  { id: 'guests', label: 'Guests & RSVPs', icon: '👥' },
  { id: 'ceremonies', label: 'Ceremonies', icon: '🗓️' },
  { id: 'logistics', label: 'Logistics & Travel', icon: '✈️' },
  { id: 'planning', label: 'Checklist & Budget', icon: '📋' },
];

function loadActiveWedding(): ActiveWedding | null {
  try {
    const raw = localStorage.getItem('saathi:active_wedding');
    if (raw) {
      const parsed = JSON.parse(raw) as ActiveWedding;
      if (parsed?.slug && parsed?.host_token) return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function Workspace({
  session,
  initialWedding,
  onLogout,
}: {
  session: UserSession;
  initialWedding?: ActiveWedding | null;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [active, setActive] = useState<ActiveWedding | null>(() => initialWedding ?? loadActiveWedding());
  const [inviteMode, setInviteMode] = useState<'studio' | 'create'>(() => (active ? 'studio' : 'create'));
  const [snapshot, setSnapshot] = useState<HostSnapshot | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectUrl, setConnectUrl] = useState('');
  const [connectErr, setConnectErr] = useState('');

  useEffect(() => {
    if (!active) {
      setSnapshot(null);
      return;
    }
    let alive = true;
    const load = () =>
      fetch(`/api/host/${active.slug}?t=${encodeURIComponent(active.host_token)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: HostSnapshot | null) => {
          if (alive && j) setSnapshot(j);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [active]);

  function selectWedding(w: ActiveWedding) {
    setActive(w);
    setInviteMode('studio');
    try {
      localStorage.setItem(`host:${w.slug}`, w.host_token);
      localStorage.setItem('saathi:active_wedding', JSON.stringify(w));
    } catch {
      /* ignore */
    }
  }

  async function launchSample() {
    setSampleBusy(true);
    try {
      const w = await createSampleWedding();
      selectWedding(w);
    } finally {
      setSampleBusy(false);
    }
  }

  function connectExisting(e: React.FormEvent) {
    e.preventDefault();
    setConnectErr('');
    try {
      const u = new URL(connectUrl.trim(), location.origin);
      const m = u.pathname.match(/^\/(h|studio)\/([\w-]+)/);
      const t = u.searchParams.get('t') ?? '';
      if (!m || !t) {
        setConnectErr('Paste a full host link like /h/slug?t=token');
        return;
      }
      selectWedding({ slug: m[2], host_token: t });
      setConnectUrl('');
      setConnectOpen(false);
    } catch {
      setConnectErr('Could not read that link.');
    }
  }

  const coupleTitle = snapshot
    ? `${snapshot.draft.partner1_name} & ${snapshot.draft.partner2_name}`
    : active ? active.slug : 'No wedding selected';

  return (
    <div className="ws">
      <header className="ws-top">
        <div className="ws-top-inner">
          <div className="ws-brand">
            <span className="wordmark"><b>B</b>ARAATI</span> <span className="tag">Saathi</span>
            {active && (
              <span className="ws-wedding-pill" title={active.slug}>
                {coupleTitle}
              </span>
            )}
          </div>
          <div className="ws-user">
            <button type="button" className="ws-link-btn" onClick={() => setConnectOpen((v) => !v)}>
              {active ? 'Switch wedding' : 'Connect host link'}
            </button>
            {active && (
              <a className="ws-link-btn" href={`/i/${active.slug}`} target="_blank" rel="noreferrer">
                Guest view ↗
              </a>
            )}
            <span className="ws-user-pill">{session.name} · {session.role}</span>
            <button type="button" className="ws-signout" onClick={onLogout}>Sign out</button>
          </div>
        </div>

        {connectOpen && (
          <form className="ws-connect" onSubmit={connectExisting}>
            <input
              type="url"
              aria-label="Paste an existing host dashboard link"
              placeholder="Paste host link (e.g. https://…/h/riya-kabir-...?t=...)"
              value={connectUrl}
              onChange={(e) => setConnectUrl(e.target.value)}
            />
            <button type="submit" className="pill solid">Connect</button>
            <button type="button" className="pill" onClick={() => { setTab('invitations'); setInviteMode('create'); setConnectOpen(false); }}>
              + New wedding
            </button>
            {connectErr && <span className="error">{connectErr}</span>}
          </form>
        )}

        <nav className="ws-tabs" role="tablist" aria-label="Wedding planning tools">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              className={`ws-tab ${tab === t.id ? 'on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span aria-hidden>{t.icon}</span> {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="ws-body" role="tabpanel">
        {tab === 'overview' && (
          active ? (
            <Host
              slug={active.slug}
              tokenOverride={active.host_token}
              embedded
              onOpenStudio={() => { setTab('invitations'); setInviteMode('studio'); }}
            />
          ) : (
            <EmptyWedding
              busy={sampleBusy}
              onCreate={() => { setTab('invitations'); setInviteMode('create'); }}
              onSample={() => void launchSample()}
            />
          )
        )}

        {tab === 'invitations' && (
          <section className="ws-section">
            <div className="ws-subbar">
              <div>
                <h1 className="display ws-h1">Invitations &amp; Card Studio</h1>
                <p className="muted">Create a wedding from a card photo, PDF, voice note or chat — then generate art, music and send invites.</p>
              </div>
              {active && (
                <div className="ws-toggle" role="group" aria-label="Invitation view">
                  <button type="button" className={inviteMode === 'studio' ? 'on' : ''} onClick={() => setInviteMode('studio')}>
                    Card Studio &amp; Send
                  </button>
                  <button type="button" className={inviteMode === 'create' ? 'on' : ''} onClick={() => setInviteMode('create')}>
                    + Create New Wedding
                  </button>
                </div>
              )}
            </div>
            {inviteMode === 'studio' && active ? (
              <Studio
                slug={active.slug}
                tokenOverride={active.host_token}
                embedded
                onOpenDashboard={() => setTab('overview')}
              />
            ) : (
              <Create
                embedded
                onCreated={(slug, host_token) => {
                  selectWedding({ slug, host_token });
                }}
              />
            )}
          </section>
        )}

        {tab === 'guests' && (
          active && snapshot ? (
            <GuestsTab slug={active.slug} snapshot={snapshot} onAskAi={() => setTab('overview')} />
          ) : (
            <EmptyWedding
              busy={sampleBusy}
              onCreate={() => { setTab('invitations'); setInviteMode('create'); }}
              onSample={() => void launchSample()}
            />
          )
        )}

        {tab === 'ceremonies' && (
          active && snapshot ? (
            <CeremoniesTab draft={snapshot.draft} onEditWithAi={() => setTab('overview')} />
          ) : (
            <EmptyWedding
              busy={sampleBusy}
              onCreate={() => { setTab('invitations'); setInviteMode('create'); }}
              onSample={() => void launchSample()}
            />
          )
        )}

        {tab === 'logistics' && (
          active && snapshot ? (
            <LogisticsTab slug={active.slug} snapshot={snapshot} onOpenAi={() => setTab('overview')} />
          ) : (
            <EmptyWedding
              busy={sampleBusy}
              onCreate={() => { setTab('invitations'); setInviteMode('create'); }}
              onSample={() => void launchSample()}
            />
          )
        )}

        {tab === 'planning' && (
          <PlanningTab storageKey={active?.slug ?? 'default'} />
        )}
      </div>
    </div>
  );
}

function EmptyWedding({ busy, onCreate, onSample }: { busy: boolean; onCreate: () => void; onSample: () => void }) {
  return (
    <section className="ws-empty">
      <p className="eyebrow">Get started</p>
      <h1 className="display">Set up your wedding workspace</h1>
      <p className="muted">
        Upload an existing wedding card, speak or chat to build your ceremonies, or jump in with a
        ready-to-explore sample wedding.
      </p>
      <div className="ws-empty-actions">
        <button type="button" className="login-primary" onClick={onCreate}>
          Create wedding with AI (Card / Voice / Chat)
        </button>
        <button type="button" className="login-secondary" disabled={busy} onClick={onSample}>
          {busy ? 'Creating sample workspace…' : 'Start with Sample Wedding (Meera & Rohan)'}
        </button>
      </div>
    </section>
  );
}

function GuestsTab({ slug, snapshot, onAskAi }: { slug: string; snapshot: HostSnapshot; onAskAi: () => void }) {
  const [filter, setFilter] = useState<'all' | 'yes' | 'maybe' | 'no' | 'pickup'>('all');
  const [pasteNames, setPasteNames] = useState('');
  const [links, setLinks] = useState<{ name: string; url: string; wa: string }[]>([]);

  const filtered = useMemo(() => {
    return snapshot.rsvps.filter((r) => {
      if (filter === 'all') return true;
      if (filter === 'pickup') return r.status !== 'no' && Boolean(r.extracted?.needs_pickup);
      return r.status === filter;
    });
  }, [snapshot.rsvps, filter]);

  function makePersonalLinks(e: React.FormEvent) {
    e.preventDefault();
    const names = pasteNames
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
    const couple = `${snapshot.draft.partner1_name} & ${snapshot.draft.partner2_name}`;
    setLinks(names.map((name) => {
      const url = `${location.origin}/i/${slug}?g=${encodeURIComponent(name)}`;
      const msg = `Namaste ${name} 🙏\n\n${couple} joyfully invite you to celebrate their wedding! Open your personalised invitation & RSVP here:\n${url}`;
      return { name, url, wa: `https://wa.me/?text=${encodeURIComponent(msg)}` };
    }));
  }

  return (
    <section className="ws-section">
      <div className="ws-subbar">
        <div>
          <h1 className="display ws-h1">Guests &amp; RSVPs</h1>
          <p className="muted">Track responses, spot ticket mismatches, and send personalised “naam likhe huve” invite links.</p>
        </div>
        <button type="button" className="pill solid" onClick={onAskAi}>Ask Saathi AI about guests →</button>
      </div>

      <div className="ws-two-col">
        <div className="cr-card">
          <div className="ws-filter-bar" role="group" aria-label="Filter guests">
            {([['all', 'All'], ['yes', 'Coming'], ['maybe', 'Maybe'], ['no', "Can't come"], ['pickup', 'Needs pickup']] as const).map(([k, label]) => (
              <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <p className="muted">No guests match this filter yet. Share the invitation link to collect RSVPs.</p>
          ) : (
            <ul className="rsvp-list">
              {filtered.map((r) => (
                <li key={r.id} className={`rsvp-row ${r.status}`}>
                  <b>{r.name}</b> <span className="muted small">{r.phone_masked}</span>
                  <div className="badges">
                    <span className={`badge ${r.status}`}>{r.status === 'yes' ? 'Coming' : r.status === 'maybe' ? 'Maybe' : "Can't come"}</span>
                    {r.status !== 'no' && <span className="badge">{r.party_size} {r.party_size === 1 ? 'person' : 'people'}</span>}
                    {r.extracted?.flight_or_train && <span className="badge ai">✈️ {r.extracted.flight_or_train}</span>}
                    {r.extracted?.ticket_passengers && r.extracted.ticket_passengers > 0 && r.extracted.ticket_passengers !== r.party_size ? (
                      <span className="badge warn">Ticket: {r.extracted.ticket_passengers} vs RSVP: {r.party_size}</span>
                    ) : null}
                    {r.extracted?.needs_pickup && <span className="badge ai">Pickup{r.extracted.arrival_point ? ` · ${r.extracted.arrival_point}` : ''}</span>}
                    {r.extracted?.dietary && <span className="badge ai">{r.extracted.dietary}</span>}
                  </div>
                  {r.note && <p className="note">“{r.note}”</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="cr-card">
          <h2>Personalised Invite Links</h2>
          <p className="muted small">Paste family or friend names (one per line or comma-separated) to create personal greeting links.</p>
          <form onSubmit={makePersonalLinks} className="ws-stack">
            <textarea
              rows={4}
              aria-label="Guest names"
              placeholder={'Nani ji\nSharma Uncle & Family\nPriya & Arjun'}
              value={pasteNames}
              onChange={(e) => setPasteNames(e.target.value)}
            />
            <button type="submit" className="pill solid" disabled={!pasteNames.trim()}>Generate personal links</button>
          </form>
          {links.length > 0 && (
            <ul className="ws-link-list">
              {links.map((l) => (
                <li key={l.name}>
                  <span><b>{l.name}</b></span>
                  <div className="ws-link-actions">
                    <a href={l.url} target="_blank" rel="noreferrer">Open ↗</a>
                    <a href={l.wa} target="_blank" rel="noreferrer" className="wa">WhatsApp ↗</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function CeremoniesTab({ draft, onEditWithAi }: { draft: WeddingDraft; onEditWithAi: () => void }) {
  const sorted = [...draft.events].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.start_time || '').localeCompare(b.start_time || ''));
  return (
    <section className="ws-section">
      <div className="ws-subbar">
        <div>
          <h1 className="display ws-h1">Ceremonies &amp; Schedule</h1>
          <p className="muted">{draft.events.length} ceremonies planned{draft.city ? ` in ${draft.city}` : ''}. Use the AI Control Room to reschedule and notify guests.</p>
        </div>
        <button type="button" className="pill solid" onClick={onEditWithAi}>Edit schedule with Saathi →</button>
      </div>
      <div className="ws-cards">
        {sorted.map((ev, i) => (
          <article key={ev.name + i} className="cr-card ws-ev-card">
            <p className="eyebrow">{ev.date ? fmtDate(ev.date, { weekday: 'short', day: 'numeric', month: 'long' }) : 'Date TBD'}{ev.start_time ? ` · ${fmtTime(ev.start_time)}` : ''}</p>
            <h3>{ev.name}</h3>
            {ev.venue_name && <p><b>{ev.venue_name}</b>{ev.venue_address ? ` — ${ev.venue_address}` : ''}</p>}
            {ev.dress_code && <p className="muted small">Dress code: {ev.dress_code}</p>}
            {ev.notes && <p className="muted small">{ev.notes}</p>}
            {ev.venue_address && (
              <a
                className="ws-map-link"
                target="_blank"
                rel="noreferrer"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ev.venue_name} ${ev.venue_address}`)}`}
              >
                Open in Google Maps ↗
              </a>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function LogisticsTab({ slug, snapshot, onOpenAi }: { slug: string; snapshot: HostSnapshot; onOpenAi: () => void }) {
  const coming = snapshot.rsvps.filter((r) => r.status !== 'no');
  const arrivals = coming.filter((r) => r.extracted?.arrival_date || r.extracted?.flight_or_train || r.extracted?.needs_pickup);
  const dietary = coming.filter((r) => r.extracted?.dietary);

  return (
    <section className="ws-section">
      <div className="ws-subbar">
        <div>
          <h1 className="display ws-h1">Logistics, Travel &amp; Catering</h1>
          <p className="muted">Automatically populated from guest RSVP notes and uploaded flight/train tickets.</p>
        </div>
        <div className="ws-link-actions">
          <a className="pill" href={`/i/${slug}`} target="_blank" rel="noreferrer">Test ticket upload as guest ↗</a>
          <button type="button" className="pill solid" onClick={onOpenAi}>Plan pickups with Saathi →</button>
        </div>
      </div>

      <div className="cr-card" style={{ marginBottom: 18 }}>
        <h2>Arrivals &amp; Airport/Station Pickups ({arrivals.length})</h2>
        {arrivals.length === 0 ? (
          <p className="muted">No arrival or ticket details yet. Guests can upload flight/train tickets or mention arrival times when they RSVP.</p>
        ) : (
          <div className="ask-table-wrap">
            <table className="ask-table">
              <thead>
                <tr>
                  <th scope="col">Guest</th>
                  <th scope="col">People</th>
                  <th scope="col">Arrival</th>
                  <th scope="col">Flight / Train</th>
                  <th scope="col">Point</th>
                  <th scope="col">Pickup</th>
                </tr>
              </thead>
              <tbody>
                {arrivals.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.name}</b></td>
                    <td>
                      {r.party_size}
                      {r.extracted?.ticket_passengers && r.extracted.ticket_passengers !== r.party_size
                        ? ` (ticket: ${r.extracted.ticket_passengers})`
                        : ''}
                    </td>
                    <td>
                      {r.extracted?.arrival_date ? fmtDate(r.extracted.arrival_date, { day: 'numeric', month: 'short' }) : '—'}
                      {r.extracted?.arrival_time ? ` ${fmtTime(r.extracted.arrival_time)}` : ''}
                    </td>
                    <td>{r.extracted?.flight_or_train || r.extracted?.arrival_mode || '—'}</td>
                    <td>{r.extracted?.arrival_point || '—'}</td>
                    <td>{r.extracted?.needs_pickup ? 'Needed' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cr-card">
        <h2>Dietary &amp; Catering Notes ({dietary.length} households)</h2>
        {dietary.length === 0 ? (
          <p className="muted">No special dietary notes recorded yet.</p>
        ) : (
          <ul className="ws-link-list">
            {dietary.map((r) => (
              <li key={r.id}>
                <span><b>{r.name}</b> ({r.party_size} {r.party_size === 1 ? 'person' : 'people'})</span>
                <span className="badge ai">{r.extracted?.dietary}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PlanningTab({ storageKey }: { storageKey: string }) {
  const [tasks, setTasks] = useState<TaskItem[]>(() => {
    try {
      const saved = localStorage.getItem(`saathi:tasks:${storageKey}`);
      if (saved) return JSON.parse(saved) as TaskItem[];
    } catch { /* ignore */ }
    return DEFAULT_TASKS;
  });
  const [budget, setBudget] = useState<BudgetItem[]>(() => {
    try {
      const saved = localStorage.getItem(`saathi:budget:${storageKey}`);
      if (saved) return JSON.parse(saved) as BudgetItem[];
    } catch { /* ignore */ }
    return DEFAULT_BUDGET;
  });
  const [newTask, setNewTask] = useState('');
  const [newCat, setNewCat] = useState('');
  const [newAlloc, setNewAlloc] = useState('');

  useEffect(() => {
    try { localStorage.setItem(`saathi:tasks:${storageKey}`, JSON.stringify(tasks)); } catch { /* ignore */ }
  }, [tasks, storageKey]);
  useEffect(() => {
    try { localStorage.setItem(`saathi:budget:${storageKey}`, JSON.stringify(budget)); } catch { /* ignore */ }
  }, [budget, storageKey]);

  const doneCount = tasks.filter((t) => t.done).length;
  const totalAlloc = budget.reduce((s, b) => s + b.allocated, 0);
  const totalPaid = budget.reduce((s, b) => s + b.paid, 0);
  const fmtInr = (n: number) => `₹${(n / 100000).toFixed(1)}L`;

  function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.trim()) return;
    setTasks((t) => [{ id: String(Date.now()), title: newTask.trim(), category: 'Custom', done: false }, ...t]);
    setNewTask('');
  }

  function addBudget(e: React.FormEvent) {
    e.preventDefault();
    const alloc = Math.max(0, Number(newAlloc) || 0) * 100000;
    if (!newCat.trim() || !alloc) return;
    setBudget((b) => [...b, { id: String(Date.now()), category: newCat.trim(), allocated: alloc, paid: 0 }]);
    setNewCat('');
    setNewAlloc('');
  }

  return (
    <section className="ws-section">
      <div className="ws-subbar">
        <div>
          <h1 className="display ws-h1">Checklist &amp; Budget</h1>
          <p className="muted">Keep family tasks and vendor payments organised in one workspace.</p>
        </div>
      </div>

      <div className="ws-two-col">
        <div className="cr-card">
          <h2>Wedding Checklist <span className="count">{doneCount}/{tasks.length}</span></h2>
          <form onSubmit={addTask} className="ws-inline-form">
            <input
              type="text"
              aria-label="New task"
              placeholder="Add a wedding task…"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
            />
            <button type="submit" className="pill solid">Add</button>
          </form>
          <ul className="ws-tasks">
            {tasks.map((t) => (
              <li key={t.id} className={t.done ? 'done' : ''}>
                <label>
                  <input
                    type="checkbox"
                    checked={t.done}
                    onChange={() => setTasks((list) => list.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
                  />
                  <span>{t.title}</span>
                </label>
                <span className="badge">{t.category}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="cr-card">
          <h2>Budget Tracker</h2>
          <div className="ws-budget-sum">
            <div><small>Allocated</small><b>{fmtInr(totalAlloc)}</b></div>
            <div><small>Paid</small><b>{fmtInr(totalPaid)}</b></div>
            <div><small>Remaining</small><b>{fmtInr(Math.max(0, totalAlloc - totalPaid))}</b></div>
          </div>
          <ul className="ws-budget-list">
            {budget.map((b) => {
              const pct = b.allocated ? Math.min(100, Math.round((b.paid / b.allocated) * 100)) : 0;
              return (
                <li key={b.id}>
                  <div className="ws-budget-row">
                    <b>{b.category}</b>
                    <span>{fmtInr(b.paid)} / {fmtInr(b.allocated)}</span>
                  </div>
                  <div className="ws-bar"><span style={{ width: `${pct}%` }} /></div>
                  <div className="ws-budget-edit">
                    <label>
                      Paid (₹ Lakhs):
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={Number((b.paid / 100000).toFixed(2))}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value) || 0) * 100000;
                          setBudget((list) => list.map((x) => (x.id === b.id ? { ...x, paid: v } : x)));
                        }}
                      />
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
          <form onSubmit={addBudget} className="ws-inline-form">
            <input type="text" aria-label="Category" placeholder="Category (e.g. DJ / Sangeet)" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
            <input type="number" step="0.5" min="0.5" aria-label="Budget in Lakhs" placeholder="₹ Lakhs" value={newAlloc} onChange={(e) => setNewAlloc(e.target.value)} style={{ maxWidth: 100 }} />
            <button type="submit" className="pill solid">Add</button>
          </form>
        </div>
      </div>
    </section>
  );
}

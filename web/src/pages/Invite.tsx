import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { fileToAttachment, post, type Attachment, type WeddingDraft } from '../api.ts';
import { ornamentUrl, themeFor } from '../themes.ts';
import { fmtDate, fmtTime, storage } from '../format.ts';
import { Saathi } from '../Saathi.tsx';

export interface PublicWedding {
  slug: string;
  draft: WeddingDraft;
  assets: { card_art?: string; couple_art?: string; music?: string; events?: Record<string, string> };
  announcements?: { text_en: string; text_hi: string | null; created_at: string }[];
  day_schedule?: { date: string; start_time: string; end_time: string; title: string; place: string }[];
}

export function useWedding(slug: string, pollMs = 0) {
  const [w, setW] = useState<PublicWedding | null>(null);
  const [error, setError] = useState('');
  const hostT = new URLSearchParams(location.search).get('t') ?? '';
  useEffect(() => {
    let alive = true;
    const url = `/api/weddings/${slug}${hostT ? `?t=${encodeURIComponent(hostT)}` : ''}`;
    const load = () =>
      fetch(url)
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || 'Not found');
          if (alive) setW(j);
        })
        .catch((e) => alive && setError(e.message));
    void load();
    const t = pollMs ? setInterval(load, pollMs) : undefined;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [slug, pollMs, hostT]);
  return { w, error };
}

export function Invite({ slug }: { slug: string }) {
  const preview = new URLSearchParams(location.search).has('preview');
  // In the host's preview, keep checking so new artwork appears as it's made.
  const { w, error } = useWedding(slug, preview ? 4000 : 0);
  const [open, setOpen] = useState(preview);
  const [gate, setGate] = useState<'closed' | 'opening' | 'gone'>(preview ? 'gone' : 'closed');
  const [playing, setPlaying] = useState(false);
  // Personal links carry either a guest_token (?g=<token>) or a plain guest name (?g=Nani%20ji).
  const rawG = (new URLSearchParams(location.search).get('g') ?? '').trim().slice(0, 64);
  const [resolvedGuestName, setResolvedGuestName] = useState('');
  const [resolvedToken, setResolvedToken] = useState('');
  useEffect(() => {
    if (!rawG) return;
    // Try resolving as a guest_token first via my-plan; fallback to plain name.
    let alive = true;
    fetch(`/api/weddings/${slug}/my-plan?guest_token=${encodeURIComponent(rawG)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { rsvp?: { name: string } | null } | null) => {
        if (!alive) return;
        if (j?.rsvp?.name) {
          setResolvedGuestName(j.rsvp.name);
          setResolvedToken(rawG);
          storage(`guest:${slug}`, rawG);
        } else {
          setResolvedGuestName(rawG.slice(0, 40));
        }
      })
      .catch(() => alive && setResolvedGuestName(rawG.slice(0, 40)));
    return () => {
      alive = false;
    };
  }, [slug, rawG]);
  const guestName = resolvedGuestName || (rawG.length <= 20 && !/[_-]/.test(rawG) ? rawG : '');
  const audio = useRef<HTMLAudioElement | null>(null);

  const musicUrl = w?.assets.music ? `/api/assets/${w.assets.music}` : '';
  useEffect(() => {
    if (!musicUrl) return;
    const a = new Audio(musicUrl);
    a.loop = true;
    a.volume = 0.55;
    audio.current = a;
    return () => a.pause();
  }, [musicUrl]);

  function toggleMusic(force?: boolean) {
    const a = audio.current;
    if (!a) return;
    const next = force ?? a.paused;
    if (next) void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else {
      a.pause();
      setPlaying(false);
    }
  }

  if (error) return <main className="shell"><h1 className="display">Invitation not found</h1><p className="muted">{error}</p></main>;
  if (!w) return <main className="invite-loading">Opening your invitation…</main>;

  const d = w.draft;
  const t = themeFor(d.style);
  const art = w.assets.card_art ? `url(/api/assets/${w.assets.card_art})` : ornamentUrl(d.style);
  const vars = {
    '--i-bg': t.bg, '--i-panel': t.panel, '--i-ink': t.ink, '--i-accent': t.accent, '--i-soft': t.soft,
    '--i-display': t.display, '--i-art': art,
    // The built-in ornament is a small tile that repeats; AI artwork fills the screen.
    '--i-art-size': w.assets.card_art ? 'cover' : '120px',
  } as CSSProperties;
  const dates = [...new Set(d.events.map((e) => e.date).filter(Boolean))].sort();
  const dateLine = dates.length > 1
    ? `${fmtDate(dates[0], { day: 'numeric', month: 'long' })} – ${fmtDate(dates.at(-1)!, { day: 'numeric', month: 'long', year: 'numeric' })}`
    : dates[0] ? fmtDate(dates[0], { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  return (
    <div className={`invite ${open ? 'is-open' : ''}`} style={vars}>
      {gate !== 'gone' && (
        <button
          className={`gate ${gate}`}
          aria-label={`Open the wedding invitation of ${d.partner1_name} and ${d.partner2_name}`}
          disabled={gate === 'opening'}
          onClick={() => {
            setGate('opening');
            setOpen(true);
            toggleMusic(true);
            setTimeout(() => setGate('gone'), 1500);
          }}
        >
          {/* Two doors, each showing its half of the artwork, swing open. */}
          <span className="door left"><span className="door-art" /></span>
          <span className="door right"><span className="door-art" /></span>
          <span className="gate-card">
            <span className="gate-eyebrow">{guestName ? `${guestName}, you're invited` : "You're invited"}</span>
            <span className="gate-names">{d.partner1_name} <i>&amp;</i> {d.partner2_name}</span>
            <span className="gate-cta">Tap to open</span>
          </span>
        </button>
      )}
      {open && !preview && <Petals colors={[t.accent, '#f4a300', '#e8476b', '#fff3d6']} />}

      <section className="hero">
        <div className="hero-art" />
        <div className="hero-panel reveal in">
          {d.logo_asset_id && (
            <img
              src={`/api/assets/${d.logo_asset_id}`}
              alt={`${d.partner1_name} and ${d.partner2_name} monogram`}
              style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 12px', display: 'block', border: '1.5px solid var(--i-accent)' }}
            />
          )}
          {guestName && <p className="dear">Dear {guestName},</p>}
          {d.invite_line && <p className="invite-line">{d.invite_line}</p>}
          <p className="eyebrow-i">Together with their families</p>
          <h1 className="names">
            <span>{d.partner1_name}</span>
            <i className="amp">&amp;</i>
            <span>{d.partner2_name}</span>
          </h1>
          {(d.partner1_family || d.partner2_family) && (
            <p className="families">{[d.partner1_family, d.partner2_family].filter(Boolean).join(' · ')}</p>
          )}
          <p className="date-line">{dateLine}</p>
          {d.city && <p className="city">{d.city}</p>}
          <Countdown events={d.events} />
        </div>
        <span className="scroll-hint" aria-hidden>Scroll</span>
      </section>

      {w.assets.couple_art && (
        <section className="couple-art reveal">
          <img src={`/api/assets/${w.assets.couple_art}`} alt={`${d.partner1_name} and ${d.partner2_name}`} />
        </section>
      )}

      {w.announcements?.[0] && <Update a={w.announcements[0]} />}

      <section className="schedule">
        <h2 className="section-title reveal">The celebrations</h2>
        {days(d.events).map(([date, evs], di) => (
          <div key={date || di} className="day">
            {date && (
              <p className="day-label reveal">
                <span>Day {di + 1}</span> {fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            )}
            {evs.map((e, i) => {
              const artId = w.assets.events?.[e.name];
              return (
                <article key={e.name + i} className={`event reveal ${artId ? 'has-art' : ''}`} style={{ transitionDelay: `${(i % 3) * 90}ms` }}>
                  {artId && (
                    <div className="event-art" style={{ backgroundImage: `url(/api/assets/${artId})` }} role="img" aria-label={`Artwork for the ${e.name}`} />
                  )}
                  <div className="event-body">
                    <p className="event-date">{e.start_time ? fmtTime(e.start_time) : 'Time to be announced'}</p>
                    <h3>{e.name}</h3>
                    {e.venue_name && <p className="venue">{e.venue_name}</p>}
                    {e.dress_code && <p className="dress">Dress code: {e.dress_code}</p>}
                    <div className="event-links">
                      {e.venue_address && (
                        <a className="btn btn-outline btn-sm" target="_blank" rel="noreferrer" aria-label={`Directions to ${e.venue_name || e.name} (opens Google Maps)`}
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${e.venue_name} ${e.venue_address}`)}`}>
                          Directions
                        </a>
                      )}
                      {e.date && (
                        <a className="btn btn-outline btn-sm" href={icsUrl(e, `${d.partner1_name} & ${d.partner2_name}`)} download={`${e.name}.ics`} aria-label={`Add the ${e.name} to your calendar`}>
                          Add to calendar
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
            {(() => {
              const items = (w.day_schedule ?? []).filter((s) => s.date === date);
              if (!items.length) return null;
              return (
                <div className="day-schedule reveal in">
                  <p className="day-schedule-title">Day schedule</p>
                  <ul className="day-schedule-list">
                    {items.map((item, idx) => (
                      <li key={item.title + idx}>
                        <span className="ds-time">
                          {item.start_time ? fmtTime(item.start_time) : 'TBD'}
                          {item.end_time ? ` – ${fmtTime(item.end_time)}` : ''}
                        </span>
                        <div>
                          <b>{item.title}</b>
                          {item.place && <span className="ds-place"> · {item.place}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </div>
        ))}
      </section>

      <Rsvp slug={slug} disabled={preview} guestName={guestName} initialToken={resolvedToken} />
      {open && <Saathi slug={slug} coupleNames={`${d.partner1_name} & ${d.partner2_name}`} />}

      {musicUrl && (
        <button className="music-btn" onClick={() => toggleMusic()} aria-label={playing ? 'Pause music' : 'Play music'}>
          {playing ? '❚❚' : '♪'}
        </button>
      )}
      <RevealOnScroll />
    </div>
  );
}

interface ExtractedLogistics {
  adults?: number;
  children?: number;
  arrival_date?: string;
  arrival_time?: string;
  arrival_mode?: string;
  arrival_point?: string;
  flight_or_train?: string;
  ticket_passengers?: number;
  needs_pickup?: boolean;
  dietary?: string;
  other?: string;
}

interface MyPlan {
  name: string;
  status: 'yes' | 'no' | 'maybe' | 'pending';
  party_size: number;
  note: string | null;
  extracted: ExtractedLogistics | null;
}

function Rsvp({ slug, disabled, guestName = '', initialToken = '' }: { slug: string; disabled: boolean; guestName?: string; initialToken?: string }) {
  const tokenKey = `guest:${slug}`;
  const [token, setToken] = useState(() => initialToken || storage(tokenKey) || '');
  const [status, setStatus] = useState<'yes' | 'no' | 'maybe' | ''>('');
  const [name, setName] = useState(guestName);
  const [phone, setPhone] = useState('');
  const [party, setParty] = useState(1);
  const [note, setNote] = useState('');
  const [ticket, setTicket] = useState<{ name: string; attachment: Attachment } | null>(null);
  const [plan, setPlan] = useState<MyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialToken && initialToken !== token) setToken(initialToken);
  }, [initialToken, token]);

  useEffect(() => {
    if (guestName && !name) setName(guestName);
  }, [guestName, name]);

  useEffect(() => {
    if (!token || disabled) return;
    let alive = true;
    fetch(`/api/weddings/${slug}/my-plan?guest_token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { rsvp?: MyPlan | null } | null) => {
        if (!alive || !j?.rsvp) return;
        setPlan(j.rsvp);
        if (j.rsvp.status !== 'pending') {
          setStatus((s) => s || (j.rsvp!.status as 'yes' | 'no' | 'maybe'));
          setDone(true);
        }
        setName((n) => n || j.rsvp!.name);
        setParty(j.rsvp!.party_size || 1);
        setNote((nt) => nt || j.rsvp!.note || '');
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [slug, token, disabled]);

  const notePlaceholder = useMemo(
    () => (status === 'no' ? 'Leave a message for the couple (optional)' : 'e.g. "Coming with mom and 2 kids, landing 6 pm on the 20th, need pickup"'),
    [status],
  );

  async function onPickTicket(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Ticket file must be under 10 MB.');
      return;
    }
    setError('');
    const attachment = await fileToAttachment(file, file.name);
    setTicket({ name: file.name, attachment });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setBusy(true);
    setError('');
    try {
      const r = await post<{ guest_token: string; extracted?: ExtractedLogistics | null }>(`/api/weddings/${slug}/rsvp`, {
        name, phone, status, party_size: party, note, guest_token: token, ticket: ticket?.attachment,
      });
      storage(tokenKey, r.guest_token);
      setToken(r.guest_token);
      setPlan({ name, status: status as 'yes' | 'no' | 'maybe', party_size: party, note: note || null, extracted: r.extracted ?? null });
      setTicket(null);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your RSVP.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const ex = plan?.extracted;
    const statusLabel = plan?.status === 'yes'
      ? `Joyfully attending · ${plan.party_size} ${plan.party_size === 1 ? 'person' : 'people'}`
      : plan?.status === 'maybe'
        ? `Not sure yet · ${plan.party_size} ${plan.party_size === 1 ? 'person' : 'people'}`
        : plan?.status === 'no' ? "Can't make it" : 'Your RSVP has reached the family.';
    const hasDetails = Boolean(ex && (ex.flight_or_train || ex.arrival_date || ex.arrival_point || ex.needs_pickup || ex.dietary));
    return (
      <section className="rsvp reveal in" aria-live="polite">
        <h2 className="section-title">{plan?.name ? `${plan.name}'s plan` : 'Thank you!'} <span aria-hidden>🙏</span></h2>
        <div className="my-plan">
          <p className="my-plan-status">{statusLabel}</p>
          {hasDetails && ex && (
            <ul className="my-plan-list">
              {ex.flight_or_train && <li><b>Travel:</b> {ex.flight_or_train}{ex.arrival_mode ? ` (${ex.arrival_mode})` : ''}</li>}
              {ex.arrival_date && (
                <li>
                  <b>Arrival:</b> {fmtDate(ex.arrival_date, { day: 'numeric', month: 'short' })}
                  {ex.arrival_time ? ` at ${fmtTime(ex.arrival_time)}` : ''}
                  {ex.arrival_point ? ` · ${ex.arrival_point}` : ''}
                </li>
              )}
              {ex.needs_pickup && <li><b>Pickup:</b> Requested from {ex.arrival_point || 'arrival point'}</li>}
              {ex.dietary && <li><b>Food:</b> {ex.dietary}</li>}
            </ul>
          )}
          {ex?.ticket_passengers && plan && ex.ticket_passengers > 0 && ex.ticket_passengers !== plan.party_size ? (
            <p className="my-plan-warn">Note: your ticket shows {ex.ticket_passengers} passengers, while your RSVP lists {plan.party_size}.</p>
          ) : null}
          <p className="my-plan-hint">Ask Saathi below anytime about ceremonies, dress codes, or your pickup.</p>
          <div className="after-rsvp">
            <button className="btn btn-outline btn-sm" onClick={() => setDone(false)}>Update RSVP / ticket</button>
            <a className="btn btn-primary btn-sm" href="https://baraati.co.in" target="_blank" rel="noreferrer">Get the Baraati app</a>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rsvp reveal">
      <h2 className="section-title">Will you join us?</h2>
      <form onSubmit={submit}>
        <div className="rsvp-choices" role="group" aria-label="Your answer">
          {([['yes', 'Joyfully yes'], ['maybe', 'Not sure yet'], ['no', "Can't make it"]] as const).map(([v, label]) => (
            <button type="button" key={v} className={`rsvp-choice ${status === v ? 'on' : ''}`} aria-pressed={status === v} onClick={() => setStatus(v)}>
              {label}
            </button>
          ))}
        </div>
        {status && (
          <div className="rsvp-fields">
            <input required aria-label="Your name" autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <input aria-label="Phone (optional)" autoComplete="tel" type="tel" placeholder="Phone (optional, for updates)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            {status !== 'no' && (
              <label className="party">
                People coming
                <input type="number" min={1} max={20} value={party} onChange={(e) => setParty(Number(e.target.value) || 1)} />
              </label>
            )}
            <textarea rows={3} aria-label={status === 'no' ? 'Message for the couple' : 'Anything the family should know: who is coming, arrival, food'} placeholder={notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
            {status !== 'no' && (
              <div className="rsvp-ticket">
                <label className="ticket-btn">
                  <span>{ticket ? `📎 ${ticket.name}` : '🎫 Upload flight or train ticket (optional)'}</span>
                  <input type="file" accept="image/*,application/pdf" onChange={(e) => void onPickTicket(e)} hidden />
                </label>
                {ticket ? (
                  <button type="button" className="ticket-clear" onClick={() => setTicket(null)} aria-label="Remove ticket">Remove</button>
                ) : (
                  <small>Saathi reads only arrival time &amp; flight/train number for pickup.</small>
                )}
              </div>
            )}
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn btn-cta rsvp-send" disabled={busy || disabled}>
              {disabled ? 'RSVP (preview)' : busy ? 'Sending…' : 'Send RSVP'}
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

/** Adds `.in` to `.reveal` elements as they scroll into view. */
function RevealOnScroll() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
      { threshold: 0.15 },
    );
    const observe = () => document.querySelectorAll('.reveal:not(.in)').forEach((el) => io.observe(el));
    observe();
    const mo = new MutationObserver(observe);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);
  return null;
}

/** The family's latest update, published from the host's control room. */
function Update({ a }: { a: { text_en: string; text_hi: string | null; created_at: string } }) {
  const [hi, setHi] = useState(false);
  const when = new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <section className="update reveal" aria-labelledby="update-h">
      <div className="update-card glass">
        <div className="update-top">
          <span id="update-h"><span aria-hidden>📣 </span>Update from the family</span>
          {a.text_hi && (
            <button className="chip" onClick={() => setHi(!hi)} aria-label={hi ? 'Show in English' : 'हिंदी में देखें'}>{hi ? 'EN' : 'हिं'}</button>
          )}
        </div>
        <p lang={hi ? 'hi' : undefined}>{hi && a.text_hi ? a.text_hi : a.text_en}</p>
        <small>{when}</small>
      </div>
    </section>
  );
}

type Ev = WeddingDraft['events'][number];

/** Ceremonies grouped by day, in date order (undated ones last). */
function days(events: Ev[]): [string, Ev[]][] {
  const map = new Map<string, Ev[]>();
  for (const e of [...events].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.start_time || '').localeCompare(b.start_time || ''))) {
    map.set(e.date, [...(map.get(e.date) ?? []), e]);
  }
  return [...map];
}

function icsUrl(e: Ev, couple: string): string {
  const stamp = (e.date + (e.start_time ? `T${e.start_time.replace(':', '')}00` : '')).replace(/-/g, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Baraati Saathi//EN', 'BEGIN:VEVENT',
    `UID:${stamp}-${e.name.replace(/\W/g, '')}@saathi.baraati.co.in`,
    e.start_time ? `DTSTART;TZID=Asia/Kolkata:${stamp}` : `DTSTART;VALUE=DATE:${stamp}`,
    e.start_time ? 'DURATION:PT3H' : 'DURATION:P1D',
    `SUMMARY:${e.name} · ${couple}`,
    `LOCATION:${[e.venue_name, e.venue_address].filter(Boolean).join(', ')}`,
    e.dress_code ? `DESCRIPTION:Dress code: ${e.dress_code}` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}

/** Days, hours, minutes and seconds to the first ceremony (IST). */
function Countdown({ events }: { events: Ev[] }) {
  const first = [...events].filter((e) => e.date).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time))[0];
  const target = first ? Date.parse(`${first.date}T${first.start_time || '10:00'}:00+05:30`) : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!Number.isFinite(target) || target < now) return null;
  const s = Math.floor((target - now) / 1000);
  const parts: [number, string][] = [[Math.floor(s / 86400), 'days'], [Math.floor(s / 3600) % 24, 'hours'], [Math.floor(s / 60) % 60, 'min'], [s % 60, 'sec']];
  return (
    <div className="countdown" role="timer" aria-label={`${parts[0][0]} days to go`}>
      {parts.map(([n, l]) => (
        <span key={l}><b>{String(n).padStart(2, '0')}</b><small>{l}</small></span>
      ))}
    </div>
  );
}

/** Marigold and rose petals drifting down once the doors open. */
function Petals({ colors }: { colors: string[] }) {
  const petals = useMemo(
    () => Array.from({ length: 26 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 2.5,
      dur: 5 + Math.random() * 4,
      size: 9 + Math.random() * 10,
      sway: (Math.random() * 2 - 1) * 60,
      spin: Math.random() * 720 - 360,
      color: colors[i % colors.length],
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return (
    <div className="petals" aria-hidden>
      {petals.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`, width: p.size, height: p.size * 1.4, background: p.color,
            animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`,
            ['--sway' as string]: `${p.sway}px`, ['--spin' as string]: `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}


import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { post, type WeddingDraft } from '../api.ts';
import { ornamentUrl, themeFor } from '../themes.ts';
import { fmtDate, fmtTime, storage } from '../format.ts';
import { Saathi } from '../Saathi.tsx';

export interface PublicWedding {
  slug: string;
  draft: WeddingDraft;
  assets: { card_art?: string; couple_art?: string; music?: string };
}

export function useWedding(slug: string, pollMs = 0) {
  const [w, setW] = useState<PublicWedding | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/weddings/${slug}`)
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
  }, [slug, pollMs]);
  return { w, error };
}

export function Invite({ slug }: { slug: string }) {
  const preview = new URLSearchParams(location.search).has('preview');
  // In the host's preview, keep checking so new artwork appears as it's made.
  const { w, error } = useWedding(slug, preview ? 4000 : 0);
  const [open, setOpen] = useState(preview);
  const [playing, setPlaying] = useState(false);
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
      {!open && (
        <button
          className="gate"
          onClick={() => {
            setOpen(true);
            toggleMusic(true);
          }}
        >
          <span className="gate-art" />
          <span className="gate-card">
            <span className="gate-eyebrow">You're invited</span>
            <span className="gate-names">{d.partner1_name} <i>&amp;</i> {d.partner2_name}</span>
            <span className="gate-cta">Tap to open</span>
          </span>
        </button>
      )}

      <section className="hero">
        <div className="hero-art" />
        <div className="hero-panel reveal in">
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
        </div>
        <span className="scroll-hint">Scroll</span>
      </section>

      {w.assets.couple_art && (
        <section className="couple-art reveal">
          <img src={`/api/assets/${w.assets.couple_art}`} alt={`${d.partner1_name} and ${d.partner2_name}`} />
        </section>
      )}

      <section className="schedule">
        <h2 className="section-title reveal">The celebrations</h2>
        {d.events.map((e, i) => (
          <article key={i} className="event reveal" style={{ transitionDelay: `${(i % 3) * 80}ms` }}>
            <p className="event-date">{fmtDate(e.date)}{e.start_time ? ` · ${fmtTime(e.start_time)}` : ''}</p>
            <h3>{e.name}</h3>
            {e.venue_name && <p className="venue">{e.venue_name}</p>}
            {e.venue_address && (
              <a className="map" target="_blank" rel="noreferrer"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${e.venue_name} ${e.venue_address}`)}`}>
                Directions
              </a>
            )}
            {e.dress_code && <p className="dress">Dress code: {e.dress_code}</p>}
          </article>
        ))}
      </section>

      <Rsvp slug={slug} disabled={preview} />
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

function Rsvp({ slug, disabled }: { slug: string; disabled: boolean }) {
  const tokenKey = `guest:${slug}`;
  const [token, setToken] = useState(() => storage(tokenKey) ?? '');
  const [status, setStatus] = useState<'yes' | 'no' | 'maybe' | ''>('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [party, setParty] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(Boolean(token));
  const [error, setError] = useState('');

  const notePlaceholder = useMemo(
    () => (status === 'no' ? 'Leave a message for the couple (optional)' : 'e.g. "Coming with mom and 2 kids, landing 6 pm on the 20th, need pickup"'),
    [status],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setBusy(true);
    setError('');
    try {
      const r = await post<{ guest_token: string }>(`/api/weddings/${slug}/rsvp`, {
        name, phone, status, party_size: party, note, guest_token: token,
      });
      storage(tokenKey, r.guest_token);
      setToken(r.guest_token);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your RSVP.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="rsvp reveal in">
        <h2 className="section-title">Thank you! 🙏</h2>
        <p>Your RSVP has reached the family.</p>
        <div className="after-rsvp">
          <button className="pill" onClick={() => setDone(false)}>Change my answer</button>
          <a className="pill solid" href="https://baraati.co.in" target="_blank" rel="noreferrer">Get the Baraati app</a>
        </div>
      </section>
    );
  }

  return (
    <section className="rsvp reveal">
      <h2 className="section-title">Will you join us?</h2>
      <form onSubmit={submit}>
        <div className="rsvp-choices">
          {([['yes', 'Joyfully yes'], ['maybe', 'Not sure yet'], ['no', "Can't make it"]] as const).map(([v, label]) => (
            <button type="button" key={v} className={`rsvp-choice ${status === v ? 'on' : ''}`} onClick={() => setStatus(v)}>
              {label}
            </button>
          ))}
        </div>
        {status && (
          <div className="rsvp-fields">
            <input required placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <input placeholder="Phone (optional, for updates)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            {status !== 'no' && (
              <label className="party">
                People coming
                <input type="number" min={1} max={20} value={party} onChange={(e) => setParty(Number(e.target.value) || 1)} />
              </label>
            )}
            <textarea rows={3} placeholder={notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
            {error && <p className="error">{error}</p>}
            <button className="rsvp-send" disabled={busy || disabled}>
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

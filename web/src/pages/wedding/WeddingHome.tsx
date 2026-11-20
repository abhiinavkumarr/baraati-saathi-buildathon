import { useCallback, useEffect, useState } from 'react';
import { fmtInr, fmtInrFull, type WeddingDraft } from '../../api.ts';
import { navigate } from '../../App.tsx';
import { askSaathi, useWedding } from '../../WeddingContext.tsx';
import { fmtDate } from '../../format.ts';

interface HomeData {
  needs: { kind: string; text: string; href: string; count: number }[];
  counts: {
    paid: number;
    planned: number;
    committed: number;
    open_tasks: number;
    overdue_tasks: number;
    coming: number;
    coming_heads: number;
    pending: number;
    creations: number;
    vendors_booked: number;
    vendors_total: number;
  };
}

interface BriefingData {
  briefing: { headline: string; items: { title: string; detail: string; prompt: string }[] } | null;
}

export function WeddingHome({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [draft, setDraft] = useState<WeddingDraft | null>(null);
  const [home, setHome] = useState<HomeData | null>(null);
  const [briefing, setBriefing] = useState<BriefingData['briefing']>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [hRes, homeRes] = await Promise.all([
        fetch(`/api/host/${slug}?t=${encodeURIComponent(token)}`),
        fetch(`/api/host/${slug}/home?t=${encodeURIComponent(token)}`),
      ]);
      if (!hRes.ok) {
        const j = await hRes.json().catch(() => ({}));
        throw new Error(j.error || 'Could not load wedding.');
      }
      const hJson = await hRes.json();
      setDraft(hJson.draft);
      if (homeRes.ok) setHome(await homeRes.json());
      setError('');

      fetch(`/api/host/${slug}/briefing?t=${encodeURIComponent(token)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: BriefingData | null) => {
          if (b?.briefing) setBriefing(b.briefing);
        })
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load wedding.');
    }
  }, [slug, token]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener('saathi:changed', onChanged);
    return () => window.removeEventListener('saathi:changed', onChanged);
  }, [load]);

  if (!token) {
    return (
      <div className="card">
        <span className="badge bad">Access required</span>
        <p className="muted">We could not find a host session for this wedding.</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/weddings')}>
          Back to My weddings
        </button>
      </div>
    );
  }

  if (error && !draft) {
    return (
      <div className="card" role="alert">
        <span className="badge bad">Error</span>
        <p>{error}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>Retry</button>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="pl-home-stack">
        <div className="card pl-skeleton" style={{ height: 180 }} />
        <div className="pl-grid-3">
          <div className="card pl-skeleton" />
          <div className="card pl-skeleton" />
          <div className="card pl-skeleton" />
        </div>
      </div>
    );
  }

  const dates = [...new Set(draft.events.map((e) => e.date).filter(Boolean))].sort();
  const range =
    dates.length > 1
      ? `${fmtDate(dates[0], { day: 'numeric', month: 'short' })} – ${fmtDate(dates[dates.length - 1], { day: 'numeric', month: 'short', year: 'numeric' })}`
      : dates[0]
        ? fmtDate(dates[0], { day: 'numeric', month: 'short', year: 'numeric' })
        : 'Dates to confirm';
  const daysTo = dates[0] ? Math.ceil((Date.parse(dates[0]) - Date.now()) / 86_400_000) : null;
  const c = home?.counts;

  return (
    <div className="pl-home-stack">
      <section className="panel-ink pl-hero">
        <div>
          <p className="eyebrow" style={{ color: 'rgba(255,255,255,0.65)' }}>Wedding home</p>
          <h1 className="display">
            {draft.partner1_name} <span className="serif" style={{ color: 'var(--saffron)' }}>&amp;</span> {draft.partner2_name}
          </h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            {[range, draft.city, `${draft.events.length} ceremonies`].filter(Boolean).join(' · ')}
          </p>
        </div>
        {daysTo != null && daysTo >= 0 && (
          <div className="pl-hero-days">
            <span className="num">{daysTo}</span>
            <span className="muted small">days to go</span>
          </div>
        )}
      </section>

      <div className="pl-home-grid">
        <section className="card" aria-labelledby="needs-h">
          <p className="eyebrow">Action items</p>
          <h2 id="needs-h" className="h3" style={{ margin: '0 0 14px' }}>What needs you</h2>
          {!home ? (
            <p className="muted small">Checking your wedding…</p>
          ) : home.needs.length === 0 ? (
            <p className="muted small">Everything looks on track right now.</p>
          ) : (
            <ul className="pl-needs-list">
              {home.needs.map((n) => (
                <li key={n.kind}>
                  <button type="button" className="pl-need-row" onClick={() => navigate(n.href)}>
                    <span>{n.text}</span>
                    <span className="pl-need-arrow" aria-hidden>→</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="brief-home-h">
          <p className="eyebrow">Daily digest</p>
          <h2 id="brief-home-h" className="h3" style={{ margin: '0 0 14px' }}>
            <span className="badge ai" style={{ marginRight: 8 }}>✦ Saathi</span>
            Today&apos;s briefing
          </h2>
          {!briefing ? (
            <p className="muted small">Your AI briefing appears as guests RSVP and your plan fills in.</p>
          ) : (
            <>
              <p className="small" style={{ margin: '0 0 12px', color: 'var(--ink-2)' }}>“{briefing.headline}”</p>
              <div className="pl-brief-cards">
                {briefing.items.map((it) => (
                  <div key={it.title} className="panel-peach pl-brief-item">
                    <b>{it.title}</b>
                    <p className="small">{it.detail}</p>
                    <button
                      type="button"
                      className="btn btn-white btn-sm"
                      onClick={() => askSaathi(it.prompt)}
                    >
                      Ask Saathi to do it →
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <section aria-label="Wedding sections" className="pl-grid-3">
        <button type="button" className="card card-hover pl-sec-card" onClick={() => navigate(`/w/${slug}/plan/guests`)}>
          <p className="eyebrow">Back office</p>
          <h2 className="h3">Your <span className="serif">Wedding</span></h2>
          <p className="pl-sec-metric" title={c ? `${fmtInrFull(c.paid)} of ${fmtInrFull(c.planned)} paid` : undefined}>
            {c ? `${fmtInr(c.paid)} of ${fmtInr(c.planned)} paid · ${c.open_tasks} tasks open` : 'Guests, vendors, budget & tasks'}
          </p>
          <span className="pl-sec-link">Open planning →</span>
        </button>

        <button type="button" className="card card-hover pl-sec-card" onClick={() => navigate(`/w/${slug}/app/invite`)}>
          <p className="eyebrow">Guest experience</p>
          <h2 className="h3">Baraati <span className="serif">App</span></h2>
          <p className="pl-sec-metric">
            {c ? `${c.coming} coming · ${c.pending} pending` : 'Invitation, RSVPs, events & travel'}
          </p>
          <span className="pl-sec-link">Manage guest app →</span>
        </button>

        <button type="button" className="card card-hover pl-sec-card" onClick={() => navigate(`/w/${slug}/studio/invitation`)}>
          <p className="eyebrow">Google AI</p>
          <h2 className="h3">AI <span className="serif">Studio</span></h2>
          <p className="pl-sec-metric">
            {c ? `${c.creations} creation${c.creations === 1 ? '' : 's'}` : 'Invitation art, logo, WhatsApp & song'}
          </p>
          <span className="pl-sec-link">Open studio →</span>
        </button>
      </section>
    </div>
  );
}

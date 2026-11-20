import { useEffect, useState, type CSSProperties } from 'react';
import { ornamentUrl, TEMPLATE_STYLES, themeFor } from '../themes.ts';
import { fmtDate } from '../format.ts';
import type { PublicWedding } from './Invite.tsx';
import '../planner.css';

/**
 * Public gallery of invitation styles, shown with the sample wedding. Picking
 * one opens the full sample invitation in that style (/i/<demo>?style=<id>).
 */
export function Templates() {
  const [demo, setDemo] = useState('');
  const [w, setW] = useState<PublicWedding | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const h = await (await fetch('/api/health')).json();
        if (!h.demo) throw new Error('No sample wedding is set up.');
        setDemo(h.demo);
        const r = await fetch(`/api/weddings/${h.demo}`);
        if (!r.ok) throw new Error('The sample wedding could not be loaded.');
        setW(await r.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load the styles.');
      }
    })();
  }, []);

  const d = w?.draft;
  const dates = d ? [...new Set(d.events.map((e) => e.date).filter(Boolean))].sort() : [];
  const dateLine = dates.length
    ? dates.length > 1
      ? `${fmtDate(dates[0], { day: 'numeric', month: 'short' })} – ${fmtDate(dates.at(-1)!, { day: 'numeric', month: 'short', year: 'numeric' })}`
      : fmtDate(dates[0], { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="pl-page">
      <header className="topbar">
        <div className="pl-top-inner">
          <a className="brand" href="/" style={{ marginBottom: 0, textDecoration: 'none', color: 'inherit' }}>
            <span className="wordmark">Baraati</span> <span className="tag">Saathi</span>
          </a>
          <a className="btn btn-ghost btn-sm" href="/">Plan your wedding →</a>
        </div>
      </header>
      <main className="pl-container">
        <p className="eyebrow">Invitation styles</p>
        <h1 className="h2">Pick a style, open the <span className="serif grad-text">whole invitation</span></h1>
        <p className="muted" style={{ maxWidth: 640, margin: '6px 0 26px' }}>
          Every Baraati invitation is a living page: doors that open, the schedule, directions, RSVP and Saathi, the voice
          concierge. Here is the sample wedding{d ? ` of ${d.partner1_name} & ${d.partner2_name}` : ''} in each style.
        </p>
        {error && <div className="card card-sm pl-err-box" role="alert"><span className="badge bad">Error</span><p>{error}</p></div>}
        <ul className="tpl-grid">
          {TEMPLATE_STYLES.map((s) => {
            const t = themeFor(s.id);
            const own = d?.style === s.id && w?.assets.card_art;
            const vars = {
              '--tpl-bg': t.bg,
              '--tpl-art': own ? `url(/api/assets/${w!.assets.card_art})` : ornamentUrl(s.id),
              '--tpl-art-size': own ? 'cover' : '90px',
              '--tpl-panel': t.panel,
              '--tpl-ink': t.ink,
              '--tpl-accent': t.accent,
              '--tpl-soft': t.soft,
              '--tpl-display': t.display,
            } as CSSProperties;
            return (
              <li key={s.id}>
                <a className="tpl-card" href={demo ? `/i/${demo}?style=${s.id}` : undefined} aria-label={`Open the sample invitation in the ${s.label} style`} style={vars}>
                  <span className="tpl-preview" aria-hidden>
                    <span className="tpl-panel">
                      <span className="tpl-eyebrow">Together with their families</span>
                      <span className="tpl-names">{d?.partner1_name ?? 'Riya'} <i>&amp;</i> {d?.partner2_name ?? 'Kabir'}</span>
                      <span className="tpl-date">{dateLine}</span>
                      {d?.city && <span className="tpl-city">{d.city}</span>}
                    </span>
                  </span>
                  <span className="tpl-meta">
                    <b>{s.label}</b>
                    <span className="muted small">{s.sub}</span>
                    {own && <span className="badge ai" style={{ alignSelf: 'flex-start' }}>✦ With Nano Banana artwork</span>}
                    <span className="tpl-open">Open invitation →</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { post } from '../../../api.ts';
import { useWedding } from '../../../WeddingContext.tsx';

interface LogoItem {
  id: string;
  style: string;
  url: string;
}

const STYLES = [
  { id: 'classic', label: 'Classic', desc: 'Gold-foil initials in a mandala ring' },
  { id: 'floral', label: 'Floral', desc: 'Initials entwined with marigold & jasmine' },
  { id: 'modern', label: 'Modern', desc: 'Minimal fine-line monogram' },
] as const;

export function LogoTab({ slug }: { slug: string }) {
  const { getTokenForSlug, refreshWeddings } = useWedding();
  const token = getTokenForSlug(slug);
  const [style, setStyle] = useState<'classic' | 'floral' | 'modern'>('classic');
  const [logos, setLogos] = useState<LogoItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/host/${slug}/logos?t=${encodeURIComponent(token)}`);
    if (r.ok) {
      const j = await r.json();
      setLogos(j.logos ?? []);
      setSelectedId(j.selected_logo_id ?? null);
    }
  }, [slug, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const r = await post<{ logos: LogoItem[] }>(`/api/weddings/${slug}/logo`, { t: token, style });
      setLogos((prev) => [...r.logos, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate logos.');
    } finally {
      setBusy(false);
    }
  }

  async function selectLogo(id: string) {
    setSelecting(id);
    setError('');
    try {
      await post(`/api/host/${slug}/logo/select`, { t: token, asset_id: id });
      setSelectedId(id);
      await refreshWeddings();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not select logo.');
    } finally {
      setSelecting('');
    }
  }

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">AI Studio</p>
          <h1 className="h2">Wedding <span className="serif">monogram</span></h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Generate 3 custom monogram logos with Nano Banana. The chosen one appears in your top bar, My weddings, and invitation.
          </p>
        </div>
      </div>

      {error && <div className="card card-sm pl-err-box" role="alert"><span className="badge bad">Error</span><p>{error}</p></div>}

      <section className="card card-sm">
        <div className="pl-grid-3" role="group" aria-label="Logo style">
          {STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`card-sm pl-logo-style-btn ${style === s.id ? 'on' : ''}`}
              aria-pressed={style === s.id}
              onClick={() => setStyle(s.id)}
            >
              <b>{s.label} {style === s.id ? '✓' : ''}</b>
              <span className="muted tiny">{s.desc}</span>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-cta" disabled={busy} onClick={() => void generate()}>
            {busy ? 'Generating 3 logos…' : '✦ Generate 3 logos'}
          </button>
          {busy && <span className="badge ai">✦ Nano Banana working (~20s)</span>}
        </div>
      </section>

      {logos.length > 0 && (
        <section>
          <h2 className="eyebrow" style={{ marginBottom: 12 }}>Generated logos ({logos.length})</h2>
          <div className="pl-grid-3">
            {logos.map((l) => {
              const isSelected = selectedId === l.id;
              return (
                <article key={l.id} className={`card card-sm pl-logo-card ${isSelected ? 'selected' : ''}`}>
                  <img src={l.url} alt={`Wedding logo (${l.style})`} className="pl-logo-preview" />
                  <div className="pl-logo-actions">
                    <span className="badge">{l.style}</span>
                    {isSelected ? (
                      <span className="badge ok">✓ Active logo</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={selecting === l.id}
                        onClick={() => void selectLogo(l.id)}
                      >
                        {selecting === l.id ? 'Saving…' : 'Use this one'}
                      </button>
                    )}
                    <a className="btn btn-ghost btn-sm" href={l.url} download={`${slug}-logo-${l.style}.jpg`}>
                      Download
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { post } from '../../../api.ts';
import { askSaathi, notifySaathiChanged, useWedding } from '../../../WeddingContext.tsx';

interface AnnouncementRow {
  id: string;
  text_en: string;
  text_hi: string | null;
  audience: string;
  created_at: string;
}

interface WaItem {
  name: string;
  phone: string;
  url: string;
}

export function AnnouncementsTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [list, setList] = useState<AnnouncementRow[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [textEn, setTextEn] = useState('');
  const [textHi, setTextHi] = useState('');
  const [audience, setAudience] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [waLinks, setWaLinks] = useState<WaItem[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/host/${slug}/announcements?t=${encodeURIComponent(token)}`);
    if (r.ok) {
      const j = await r.json();
      setList(j.announcements ?? []);
      setGroups(j.groups ?? []);
    }
    setLoading(false);
  }, [slug, token]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener('saathi:changed', onChanged);
    return () => window.removeEventListener('saathi:changed', onChanged);
  }, [load]);

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!textEn.trim()) return;
    setBusy(true);
    setError('');
    try {
      const r = await post<{ whatsapp: WaItem[] }>(`/api/host/${slug}/announcements`, {
        t: token,
        text_en: textEn.trim(),
        text_hi: textHi.trim(),
        audience,
      });
      setWaLinks(r.whatsapp ?? []);
      setTextEn('');
      setTextHi('');
      await load();
      notifySaathiChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish announcement.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">Baraati App</p>
          <h1 className="h2">Guest <span className="serif">announcements</span></h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Published updates appear on the invitation banner and are known to Saathi.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => askSaathi('Draft a bilingual announcement in English and Hindi for our guests: ')}
        >
          ✦ Ask Saathi to write it
        </button>
      </div>

      {error && <div className="card card-sm pl-err-box" role="alert"><span className="badge bad">Error</span><p>{error}</p></div>}

      <div className="pl-home-grid">
        <section className="card">
          <p className="eyebrow">Broadcast</p>
          <h2 className="h3" style={{ margin: '0 0 12px' }}>New announcement</h2>
          <form className="pl-form-stack" style={{ marginTop: 0 }} onSubmit={(e) => void publish(e)}>
            <label>
              Audience
              <select value={audience} onChange={(e) => setAudience(e.target.value)}>
                <option value="all">Everyone</option>
                <option value="coming">Coming guests (yes + maybe)</option>
                <option value="maybe">Maybe guests</option>
                <option value="pickup">Guests needing pickup</option>
                {groups.map((g) => (
                  <option key={g} value={`group:${g}`}>Group: {g}</option>
                ))}
              </select>
            </label>
            <label>
              Message in English *
              <textarea
                rows={3}
                required
                placeholder="e.g. Haldi starts at 11:30 AM at Rambagh Courtyard. Yellow attire!"
                value={textEn}
                onChange={(e) => setTextEn(e.target.value)}
              />
            </label>
            <label>
              Hindi translation <span className="muted">(optional)</span>
              <textarea
                rows={2}
                lang="hi"
                placeholder="हल्दी सुबह 11:30 बजे रामबाग कोर्टयार्ड में शुरू होगी।"
                value={textHi}
                onChange={(e) => setTextHi(e.target.value)}
              />
            </label>
            <button type="submit" className="btn btn-cta" disabled={busy || !textEn.trim()}>
              {busy ? 'Publishing…' : 'Publish announcement'}
            </button>
          </form>

          {waLinks.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <span className="badge ok">✓ Published · {waLinks.length} recipients</span>
              <ul className="pl-pay-list" style={{ marginTop: 10, maxHeight: 260, overflowY: 'auto' }}>
                {waLinks.map((x) => (
                  <li key={x.name}>
                    <span><b>{x.name}</b> <small className="muted">{x.phone || 'no phone'}</small></span>
                    {x.url ? (
                      <a className="btn btn-outline btn-sm" href={x.url} target="_blank" rel="noreferrer">Send WhatsApp ↗</a>
                    ) : (
                      <span className="muted tiny">sees it on the invitation</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card">
          <p className="eyebrow">History</p>
          <h2 className="h3" style={{ margin: '0 0 12px' }}>Published updates ({list.length})</h2>
          {loading ? (
            <div className="pl-skeleton" />
          ) : list.length === 0 ? (
            <p className="muted small">No announcements published yet.</p>
          ) : (
            <ul className="pl-pay-list">
              {list.map((a) => (
                <li key={a.id} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                  <div className="pl-badges-inline">
                    <span className="badge">{a.audience.startsWith('group:') ? a.audience.slice(6) : a.audience}</span>
                    <span className="muted tiny">
                      {new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="small" style={{ margin: 0 }}>{a.text_en}</p>
                  {a.text_hi && <p className="muted small" lang="hi" style={{ margin: 0 }}>{a.text_hi}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

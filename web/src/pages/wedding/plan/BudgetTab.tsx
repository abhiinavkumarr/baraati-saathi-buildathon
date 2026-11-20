import { useCallback, useEffect, useState } from 'react';
import { del, fmtInr, fmtInrFull, patch, post } from '../../../api.ts';
import { useWedding } from '../../../WeddingContext.tsx';
import { fmtDate } from '../../../format.ts';

interface CategoryRow {
  category: string;
  planned: number;
  committed: number;
  paid: number;
  due_30d: number;
  over: boolean;
}

interface PaymentItem {
  id: string;
  vendor_id: string | null;
  vendor_name: string;
  category: string;
  label: string;
  amount: number;
  due_date: string | null;
  paid_at: string | null;
}

interface BudgetResponse {
  summary: {
    total_planned: number;
    total_committed: number;
    total_paid: number;
    total_due_30d: number;
    categories: CategoryRow[];
  };
  vendors: { id: string; name: string; category: string }[];
  payments: PaymentItem[];
}

export function BudgetTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [data, setData] = useState<BudgetResponse | null>(null);
  const [error, setError] = useState('');
  const [plannedDrafts, setPlannedDrafts] = useState<Record<string, string>>({});

  // New payment form
  const [payLabel, setPayLabel] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payVendor, setPayVendor] = useState('');
  const [payDue, setPayDue] = useState('');
  const [savingPay, setSavingPay] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/host/${slug}/budget?t=${encodeURIComponent(token)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load budget.');
      setData(j);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load budget.');
    }
  }, [slug, token]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener('saathi:changed', onChanged);
    return () => window.removeEventListener('saathi:changed', onChanged);
  }, [load]);

  async function savePlanned(category: string, val: string) {
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0) return;
    await post(`/api/host/${slug}/budget`, { t: token, category, planned: num });
    setPlannedDrafts((m) => {
      const next = { ...m };
      delete next[category];
      return next;
    });
    await load();
  }

  async function markPaid(p: PaymentItem) {
    const today = new Date().toISOString().slice(0, 10);
    await patch(`/api/host/${slug}/payments/${p.id}`, { t: token, paid_at: today });
    await load();
  }

  async function removePayment(p: PaymentItem) {
    if (!window.confirm(`Delete payment "${p.label}"?`)) return;
    await del(`/api/host/${slug}/payments/${p.id}`, { t: token });
    await load();
  }

  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payLabel.trim() || !Number(payAmount)) return;
    setSavingPay(true);
    try {
      await post(`/api/host/${slug}/payments`, {
        t: token,
        label: payLabel.trim(),
        amount: Number(payAmount),
        vendor_id: payVendor || null,
        due_date: payDue || null,
      });
      setPayLabel('');
      setPayAmount('');
      setPayVendor('');
      setPayDue('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add payment.');
    } finally {
      setSavingPay(false);
    }
  }

  if (!data && !error) return <div className="card pl-skeleton" />;

  const s = data?.summary;
  const upcoming = (data?.payments ?? []).filter((p) => !p.paid_at);
  const paidList = (data?.payments ?? []).filter((p) => Boolean(p.paid_at));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">Your Wedding</p>
          <h1 className="h2">Budget &amp; <span className="serif">payments</span></h1>
        </div>
      </div>

      {error && <div className="card card-sm pl-err-box" role="alert"><span className="badge bad">Error</span><p>{error}</p></div>}

      {s && (
        <div className="pl-grid-3" style={{ marginBottom: 22 }}>
          <div className="card card-sm pl-stat-tile" title={fmtInrFull(s.total_planned)}>
            <p className="eyebrow">Planned</p>
            <b className="num pl-stat-big">{fmtInr(s.total_planned)}</b>
            <span className="muted tiny">Across {s.categories.length} categories</span>
          </div>
          <div className="card card-sm pl-stat-tile" title={fmtInrFull(s.total_committed)}>
            <p className="eyebrow">Committed</p>
            <b className="num pl-stat-big grad-text">{fmtInr(s.total_committed)}</b>
            <span className="muted tiny">Booked vendor quotes</span>
          </div>
          <div className="card card-sm pl-stat-tile" title={fmtInrFull(s.total_paid)}>
            <p className="eyebrow">Paid so far</p>
            <b className="num pl-stat-big">{fmtInr(s.total_paid)}</b>
            <span className="muted tiny">Due in 30d: {fmtInr(s.total_due_30d)}</span>
          </div>
        </div>
      )}

      <div className="pl-home-grid">
        <section className="card">
          <p className="eyebrow">Breakdown</p>
          <h2 className="h3" style={{ margin: '0 0 14px' }}>By category</h2>
          <ul className="pl-cat-list">
            {(s?.categories ?? []).map((c) => {
              const pct = c.planned > 0 ? Math.min(100, Math.round((c.committed / c.planned) * 100)) : c.committed > 0 ? 100 : 0;
              const draftVal = plannedDrafts[c.category] ?? String(c.planned);
              return (
                <li key={c.category}>
                  <div className="pl-cat-row">
                    <div>
                      <b>{c.category}</b>
                      {c.over && <span className="badge bad" style={{ marginLeft: 8 }}>Over</span>}
                    </div>
                    <div className="pl-cat-nums small" title={`Committed ${fmtInrFull(c.committed)} · Paid ${fmtInrFull(c.paid)}`}>
                      <span className="num">{fmtInr(c.committed)}</span>
                      <span className="muted"> / </span>
                      <input
                        type="number"
                        min={0}
                        aria-label={`Planned budget for ${c.category}`}
                        className="pl-inline-num"
                        value={draftVal}
                        onChange={(e) => setPlannedDrafts((m) => ({ ...m, [c.category]: e.target.value }))}
                        onBlur={() => {
                          if (plannedDrafts[c.category] !== undefined && Number(plannedDrafts[c.category]) !== c.planned) {
                            void savePlanned(c.category, plannedDrafts[c.category]);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void savePlanned(c.category, draftVal);
                        }}
                      />
                    </div>
                  </div>
                  <div className="pl-bar">
                    <span style={{ width: `${pct}%`, background: c.over ? 'var(--bad)' : 'var(--grad-saffron)' }} />
                  </div>
                  <div className="muted tiny" style={{ marginTop: 4 }}>
                    Paid {fmtInr(c.paid)}{c.due_30d > 0 ? ` · Due in 30d: ${fmtInr(c.due_30d)}` : ''}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card">
          <p className="eyebrow">Schedule</p>
          <h2 className="h3" style={{ margin: '0 0 14px' }}>Upcoming payments</h2>

          <form className="pl-pay-form" onSubmit={(e) => void addPayment(e)}>
            <input
              type="text"
              required
              aria-label="Payment description"
              placeholder="e.g. Decor 2nd instalment"
              value={payLabel}
              onChange={(e) => setPayLabel(e.target.value)}
            />
            <div className="pl-form-row">
              <input
                type="number"
                required
                min={1}
                aria-label="Amount in rupees"
                placeholder="Amount (₹)"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
              <input
                type="date"
                aria-label="Due date"
                value={payDue}
                onChange={(e) => setPayDue(e.target.value)}
              />
            </div>
            <div className="pl-pay-row">
              <select aria-label="Vendor" value={payVendor} onChange={(e) => setPayVendor(e.target.value)}>
                <option value="">Link to vendor (optional)</option>
                {(data?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name} ({v.category})</option>)}
              </select>
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingPay}>
                {savingPay ? 'Adding…' : '+ Add'}
              </button>
            </div>
          </form>

          {upcoming.length === 0 ? (
            <p className="muted small">No unpaid instalments scheduled.</p>
          ) : (
            <ul className="pl-pay-list">
              {upcoming.map((p) => {
                const overdue = Boolean(p.due_date && p.due_date < today);
                return (
                  <li key={p.id}>
                    <div>
                      <b>{p.label}</b>
                      <div className="muted tiny">
                        {[p.vendor_name, p.due_date ? `Due ${fmtDate(p.due_date, { day: 'numeric', month: 'short' })}` : 'No due date'].filter(Boolean).join(' · ')}
                        {overdue && <span className="badge bad" style={{ marginLeft: 6 }}>Overdue</span>}
                      </div>
                    </div>
                    <div className="pl-pay-right">
                      <b className="num" title={fmtInrFull(p.amount)}>{fmtInr(p.amount)}</b>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => void markPaid(p)}>Mark paid</button>
                      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete ${p.label}`} onClick={() => void removePayment(p)}>✕</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {paidList.length > 0 && (
            <details style={{ marginTop: 18 }}>
              <summary className="small muted" style={{ cursor: 'pointer', fontWeight: 600 }}>
                Paid history ({paidList.length})
              </summary>
              <ul className="pl-pay-list" style={{ marginTop: 8 }}>
                {paidList.map((p) => (
                  <li key={p.id}>
                    <div>
                      <span>{p.label}</span>
                      <div className="muted tiny">{[p.vendor_name, p.paid_at ? `Paid ${fmtDate(p.paid_at, { day: 'numeric', month: 'short' })}` : ''].filter(Boolean).join(' · ')}</div>
                    </div>
                    <b className="num" style={{ color: 'var(--ok)' }} title={fmtInrFull(p.amount)}>{fmtInr(p.amount)}</b>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { del, fmtInr, fmtInrFull, patch, post } from '../../../api.ts';
import { useWedding } from '../../../WeddingContext.tsx';

interface VendorItem {
  id: string;
  category: string;
  name: string;
  contact_name: string;
  phone_masked: string;
  tel_url: string;
  wa_url: string;
  status: 'shortlisted' | 'negotiating' | 'booked' | 'cancelled';
  who_pays: 'bride' | 'groom' | 'shared' | null;
  quoted: number | null;
  paid: number;
  due: number;
  ceremonies: string[];
  notes: string;
}

const KEY_CATS = ['Venue', 'Catering', 'Photography', 'Decor', 'Makeup'];
const ALL_CATS = [
  'Venue', 'Catering', 'Decor', 'Photography', 'Makeup', 'Mehendi artist',
  'DJ & Music', 'Pandit', 'Transport', 'Invitations', 'Clothing', 'Jewellery', 'Gifts', 'Other',
];

const STATUS_BADGE: Record<VendorItem['status'], { cls: string; label: string }> = {
  shortlisted: { cls: '', label: 'Shortlisted' },
  negotiating: { cls: 'warn', label: 'Negotiating' },
  booked: { cls: 'ok', label: 'Booked' },
  cancelled: { cls: 'bad', label: 'Cancelled' },
};

const EMPTY_VENDOR = {
  category: 'Venue',
  name: '',
  contact_name: '',
  phone: '',
  status: 'shortlisted' as VendorItem['status'],
  who_pays: '' as '' | 'bride' | 'groom' | 'shared',
  quoted: '',
  notes: '',
};

export function VendorsTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [vendors, setVendors] = useState<VendorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<VendorItem | null>(null);
  const [form, setForm] = useState(EMPTY_VENDOR);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/host/${slug}/vendors?t=${encodeURIComponent(token)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load vendors.');
      setVendors(j.vendors ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load vendors.');
    } finally {
      setLoading(false);
    }
  }, [slug, token]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener('saathi:changed', onChanged);
    return () => window.removeEventListener('saathi:changed', onChanged);
  }, [load]);

  const missingKey = useMemo(() => {
    const booked = new Set(vendors.filter((v) => v.status === 'booked').map((v) => v.category.toLowerCase()));
    return KEY_CATS.filter((c) => !booked.has(c.toLowerCase()));
  }, [vendors]);

  const filtered = useMemo(
    () => (statusFilter === 'all' ? vendors : vendors.filter((v) => v.status === statusFilter)),
    [vendors, statusFilter],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, VendorItem[]>();
    for (const v of filtered) {
      map.set(v.category, [...(map.get(v.category) ?? []), v]);
    }
    return [...map.entries()];
  }, [filtered]);

  function openAdd(cat?: string) {
    setEditing(null);
    setForm({ ...EMPTY_VENDOR, category: cat || 'Venue' });
    setSheetOpen(true);
  }

  function openEdit(v: VendorItem) {
    setEditing(v);
    setForm({
      category: v.category,
      name: v.name,
      contact_name: v.contact_name,
      phone: '',
      status: v.status,
      who_pays: v.who_pays || '',
      quoted: v.quoted != null ? String(v.quoted) : '',
      notes: v.notes,
    });
    setSheetOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        t: token,
        category: form.category,
        name: form.name.trim(),
        contact_name: form.contact_name.trim(),
        status: form.status,
        who_pays: form.who_pays || null,
        quoted: form.quoted.trim() ? Number(form.quoted) : null,
        notes: form.notes.trim(),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      };
      if (editing) await patch(`/api/host/${slug}/vendors/${editing.id}`, payload);
      else await post(`/api/host/${slug}/vendors`, payload);
      setSheetOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save vendor.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(v: VendorItem) {
    if (!window.confirm(`Delete vendor "${v.name}"?`)) return;
    await del(`/api/host/${slug}/vendors/${v.id}`, { t: token });
    await load();
  }

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">Your Wedding</p>
          <h1 className="h2">Wedding <span className="serif">vendors</span></h1>
          {missingKey.length > 0 && (
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              Still to book: <b>{missingKey.join(', ')}</b>
            </p>
          )}
        </div>
        <button type="button" className="btn btn-cta btn-sm" onClick={() => openAdd()}>+ Add vendor</button>
      </div>

      {error && <div className="card card-sm pl-err-box" role="alert"><span className="badge bad">Error</span><p>{error}</p></div>}

      <div className="pl-chip-row" style={{ marginBottom: 18 }} role="group" aria-label="Vendor pipeline filter">
        {(['all', 'shortlisted', 'negotiating', 'booked', 'cancelled'] as const).map((st) => (
          <button
            key={st}
            type="button"
            className={`chip ${statusFilter === st ? 'on' : ''}`}
            aria-pressed={statusFilter === st}
            onClick={() => setStatusFilter(st)}
          >
            {st === 'all' ? `All (${vendors.length})` : `${STATUS_BADGE[st].label} (${vendors.filter((v) => v.status === st).length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card pl-skeleton" />
      ) : grouped.length === 0 ? (
        <div className="card pl-empty-card">
          <span className="pl-empty-orb" aria-hidden>🤝</span>
          <h3>No vendors yet</h3>
          <p className="muted small">Track venues, caterers, photographers, decor and quotes in one place.</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => openAdd()}>+ Add vendor</button>
        </div>
      ) : (
        <div className="pl-vendor-groups">
          {grouped.map(([cat, items]) => (
            <section key={cat}>
              <h2 className="eyebrow" style={{ marginBottom: 10 }}>{cat} · {items.length}</h2>
              <div className="pl-grid-cards">
                {items.map((v) => {
                  const st = STATUS_BADGE[v.status];
                  return (
                    <article key={v.id} className="card card-sm pl-vendor-card">
                      <div className="pl-vc-top">
                        <div>
                          <h3 style={{ margin: 0 }}>{v.name}</h3>
                          {v.contact_name && <p className="muted tiny" style={{ margin: '2px 0 0' }}>{v.contact_name}</p>}
                        </div>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                      </div>

                      <div className="pl-vc-money">
                        <div title={v.quoted != null ? fmtInrFull(v.quoted) : undefined}>
                          <small className="muted tiny">Quote</small>
                          <b className="num">{v.quoted != null ? fmtInr(v.quoted) : '—'}</b>
                        </div>
                        <div title={fmtInrFull(v.paid)}>
                          <small className="muted tiny">Paid</small>
                          <b className="num" style={{ color: 'var(--ok)' }}>{fmtInr(v.paid)}</b>
                        </div>
                        <div title={fmtInrFull(v.due)}>
                          <small className="muted tiny">Due</small>
                          <b className="num">{fmtInr(v.due)}</b>
                        </div>
                      </div>

                      {v.notes && <p className="muted small" style={{ margin: '8px 0 0' }}>{v.notes}</p>}

                      <div className="pl-vc-foot">
                        <div className="pl-row-btns">
                          {v.tel_url && <a className="btn btn-outline btn-sm" href={v.tel_url}>Call {v.phone_masked}</a>}
                          {v.wa_url && <a className="btn btn-outline btn-sm" href={v.wa_url} target="_blank" rel="noreferrer">WhatsApp ↗</a>}
                        </div>
                        <div className="pl-row-btns">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(v)}>Edit</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(v)}>Delete</button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {sheetOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setSheetOpen(false)} aria-hidden />
          <aside className="saathi-drawer open" aria-label={editing ? 'Edit vendor' : 'Add vendor'}>
            <header className="drawer-head">
              <h2>{editing ? 'Edit vendor' : 'Add vendor'}</h2>
              <button type="button" className="icon-btn" onClick={() => setSheetOpen(false)} aria-label="Close">✕</button>
            </header>
            <form className="pl-sheet-form" onSubmit={(e) => void save(e)}>
              <label>
                Category
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {ALL_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>
                Vendor name *
                <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kathakar Wedding Films" />
              </label>
              <div className="pl-form-row">
                <label>
                  Status
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as VendorItem['status'] })}>
                    <option value="shortlisted">Shortlisted</option>
                    <option value="negotiating">Negotiating</option>
                    <option value="booked">Booked</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
                <label>
                  Quoted (₹)
                  <input type="number" min={0} value={form.quoted} onChange={(e) => setForm({ ...form, quoted: e.target.value })} placeholder="e.g. 250000" />
                </label>
              </div>
              <div className="pl-form-row">
                <label>
                  Who pays
                  <select value={form.who_pays} onChange={(e) => setForm({ ...form, who_pays: e.target.value as typeof form.who_pays })}>
                    <option value="">Unspecified</option>
                    <option value="bride">Bride&apos;s side</option>
                    <option value="groom">Groom&apos;s side</option>
                    <option value="shared">Shared</option>
                  </select>
                </label>
                <label>
                  Contact person
                  <input type="text" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} placeholder="e.g. Rahul" />
                </label>
              </div>
              <label>
                Phone <span className="muted">(optional)</span>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder={editing?.phone_masked ? `Current: ${editing.phone_masked}` : '+91 98765 43210'} />
              </label>
              <label>
                Notes
                <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Inclusions, deliverables, terms…" />
              </label>
              <div className="pl-wizard-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setSheetOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-cta" disabled={saving}>{saving ? 'Saving…' : 'Save vendor'}</button>
              </div>
            </form>
          </aside>
        </>
      )}
    </div>
  );
}

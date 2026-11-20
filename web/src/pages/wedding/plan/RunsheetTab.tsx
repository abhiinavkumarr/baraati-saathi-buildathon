import { useCallback, useEffect, useMemo, useState } from 'react';
import { del, patch, post, type WeddingEvent } from '../../../api.ts';
import { useWedding } from '../../../WeddingContext.tsx';
import { fmtDate, fmtTime } from '../../../format.ts';

interface RunsheetItem {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  title: string;
  place: string;
  vendor_id: string | null;
  vendor_name: string;
  show_to_guests: boolean;
  notes: string;
}

interface VendorOpt {
  id: string;
  name: string;
  category: string;
}

const EMPTY_FORM = {
  date: '',
  start_time: '',
  end_time: '',
  title: '',
  place: '',
  vendor_id: '',
  show_to_guests: false,
  notes: '',
};

export function RunsheetTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [items, setItems] = useState<RunsheetItem[]>([]);
  const [events, setEvents] = useState<WeddingEvent[]>([]);
  const [vendors, setVendors] = useState<VendorOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<RunsheetItem | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/host/${slug}/runsheet?t=${encodeURIComponent(token)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load run sheet.');
      setItems(j.items ?? []);
      setEvents(j.events ?? []);
      setVendors(j.vendors ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load run sheet.');
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

  const timelineDays = useMemo(() => {
    const dates = new Set<string>();
    for (const ev of events) if (ev.date) dates.add(ev.date);
    for (const it of items) if (it.date) dates.add(it.date);
    return [...dates].sort().map((date) => {
      type Entry =
        | { kind: 'ceremony'; time: string; ev: WeddingEvent }
        | { kind: 'item'; time: string; it: RunsheetItem };
      const entries: Entry[] = [
        ...events.filter((e) => e.date === date).map((ev): Entry => ({ kind: 'ceremony', time: ev.start_time || '99:99', ev })),
        ...items.filter((i) => i.date === date).map((it): Entry => ({ kind: 'item', time: it.start_time || '99:99', it })),
      ];
      entries.sort((a, b) => a.time.localeCompare(b.time));
      return { date, entries };
    });
  }, [events, items]);

  function openAdd(defaultDate?: string) {
    setEditing(null);
    const firstDate = defaultDate || events.map((e) => e.date).filter(Boolean).sort()[0] || new Date().toISOString().slice(0, 10);
    setForm({ ...EMPTY_FORM, date: firstDate });
    setSheetOpen(true);
  }

  function openEdit(it: RunsheetItem) {
    setEditing(it);
    setForm({
      date: it.date,
      start_time: it.start_time,
      end_time: it.end_time,
      title: it.title,
      place: it.place,
      vendor_id: it.vendor_id || '',
      show_to_guests: it.show_to_guests,
      notes: it.notes,
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
        date: form.date,
        start_time: form.start_time,
        end_time: form.end_time,
        title: form.title.trim(),
        place: form.place.trim(),
        vendor_id: form.vendor_id || null,
        show_to_guests: form.show_to_guests,
        notes: form.notes.trim(),
      };
      if (editing) await patch(`/api/host/${slug}/runsheet/${editing.id}`, payload);
      else await post(`/api/host/${slug}/runsheet`, payload);
      setSheetOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save run sheet item.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleGuestVisible(it: RunsheetItem) {
    await patch(`/api/host/${slug}/runsheet/${it.id}`, { t: token, show_to_guests: !it.show_to_guests });
    await load();
  }

  async function remove(it: RunsheetItem) {
    if (!window.confirm(`Remove "${it.title}" from run sheet?`)) return;
    await del(`/api/host/${slug}/runsheet/${it.id}`, { t: token });
    await load();
  }

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">Your Wedding</p>
          <h1 className="h2">Wedding <span className="serif">run sheet</span></h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Minute-by-minute schedule per day alongside ceremonies. Toggle “Guest visible” to show items on the public invitation.
          </p>
        </div>
        <button type="button" className="btn btn-cta btn-sm" onClick={() => openAdd()}>+ Add item</button>
      </div>

      {error && <div className="card card-sm pl-err-box" role="alert"><span className="badge bad">Error</span><p>{error}</p></div>}

      {loading ? (
        <div className="card pl-skeleton" />
      ) : timelineDays.length === 0 ? (
        <div className="card pl-empty-card">
          <span className="pl-empty-orb" aria-hidden>🕒</span>
          <h3>No run sheet items yet</h3>
          <p className="muted small">Add vendor call times, baraat assembly, sound checks, or airport shuttle slots.</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => openAdd()}>+ Add item</button>
        </div>
      ) : (
        <div className="pl-card-stack">
          {timelineDays.map((day, di) => (
            <section key={day.date} className="card card-sm">
              <div className="pl-head" style={{ marginBottom: 12 }}>
                <div>
                  <p className="eyebrow">Day {di + 1}</p>
                  <h2 className="h3" style={{ margin: 0 }}>{fmtDate(day.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
                </div>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => openAdd(day.date)}>+ Add to Day {di + 1}</button>
              </div>

              <ol className="pl-timeline">
                {day.entries.map((entry, idx) =>
                  entry.kind === 'ceremony' ? (
                    <li key={`c-${entry.ev.name}-${idx}`} className="pl-tl-row pl-tl-ceremony">
                      <span className="pl-tl-time">{entry.ev.start_time ? fmtTime(entry.ev.start_time) : 'TBD'}</span>
                      <div className="pl-tl-body">
                        <div className="pl-badges-inline">
                          <b>{entry.ev.name}</b>
                          <span className="badge ai">Ceremony</span>
                        </div>
                        {entry.ev.venue_name && <p className="muted tiny" style={{ margin: '2px 0 0' }}>{entry.ev.venue_name}</p>}
                      </div>
                    </li>
                  ) : (
                    <li key={entry.it.id} className="pl-tl-row">
                      <span className="pl-tl-time">
                        {entry.it.start_time ? fmtTime(entry.it.start_time) : 'TBD'}
                        {entry.it.end_time ? ` – ${fmtTime(entry.it.end_time)}` : ''}
                      </span>
                      <div className="pl-tl-body">
                        <div className="pl-badges-inline">
                          <b>{entry.it.title}</b>
                          {entry.it.vendor_name && <span className="badge">{entry.it.vendor_name}</span>}
                          {entry.it.show_to_guests && <span className="badge ok">Guest visible</span>}
                        </div>
                        {(entry.it.place || entry.it.notes) && (
                          <p className="muted tiny" style={{ margin: '2px 0 0' }}>
                            {[entry.it.place, entry.it.notes].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                      <div className="pl-row-btns">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggleGuestVisible(entry.it)}>
                          {entry.it.show_to_guests ? 'Hide from guests' : 'Show to guests'}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(entry.it)}>Edit</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(entry.it)}>Delete</button>
                      </div>
                    </li>
                  ),
                )}
              </ol>
            </section>
          ))}
        </div>
      )}

      {sheetOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setSheetOpen(false)} aria-hidden />
          <aside className="saathi-drawer open" aria-label={editing ? 'Edit run sheet item' : 'Add run sheet item'}>
            <header className="drawer-head">
              <h2>{editing ? 'Edit item' : 'Add run sheet item'}</h2>
              <button type="button" className="icon-btn" onClick={() => setSheetOpen(false)} aria-label="Close">✕</button>
            </header>
            <form className="pl-sheet-form" onSubmit={(e) => void save(e)}>
              <label>
                Title *
                <input type="text" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Sound check & DJ setup" />
              </label>
              <label>
                Date *
                <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </label>
              <div className="pl-form-row">
                <label>
                  Start time
                  <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                </label>
                <label>
                  End time
                  <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
                </label>
              </div>
              <label>
                Place / location
                <input type="text" value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="e.g. Rambagh Main Gate" />
              </label>
              <label>
                Vendor <span className="muted">(optional)</span>
                <select value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}>
                  <option value="">None</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.category})</option>)}
                </select>
              </label>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <input type="checkbox" checked={form.show_to_guests} onChange={(e) => setForm({ ...form, show_to_guests: e.target.checked })} style={{ width: 18, height: 18 }} />
                <span>Show to guests on the invitation &ldquo;Day schedule&rdquo;</span>
              </label>
              <label>
                Notes
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Point of contact, setup notes…" />
              </label>
              <div className="pl-wizard-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setSheetOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-cta" disabled={saving}>{saving ? 'Saving…' : 'Save item'}</button>
              </div>
            </form>
          </aside>
        </>
      )}
    </div>
  );
}

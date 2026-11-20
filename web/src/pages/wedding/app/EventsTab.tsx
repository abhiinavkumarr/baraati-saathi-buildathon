import { useCallback, useEffect, useState } from 'react';
import { patch, post, type WeddingDraft, type WeddingEvent } from '../../../api.ts';
import { notifySaathiChanged, useWedding } from '../../../WeddingContext.tsx';

const EMPTY_EVENT: WeddingEvent = {
  name: '',
  date: '',
  start_time: '18:00',
  venue_name: '',
  venue_address: '',
  dress_code: '',
  notes: '',
};

export function EventsTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [events, setEvents] = useState<WeddingEvent[]>([]);
  const [artMap, setArtMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenName, setRegenName] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/host/${slug}?t=${encodeURIComponent(token)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load events.');
      const d = j.draft as WeddingDraft;
      setEvents(d.events ?? []);
      setArtMap(j.assets?.events ?? {});
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load events.');
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

  function updateField(idx: number, key: keyof WeddingEvent, val: string) {
    setEvents((prev) => prev.map((e, i) => (i === idx ? { ...e, [key]: val } : e)));
  }

  function addEvent() {
    setEvents((prev) => [...prev, { ...EMPTY_EVENT, name: 'New ceremony' }]);
  }

  function removeEvent(idx: number) {
    if (events.length <= 1) return;
    if (!window.confirm(`Remove "${events[idx].name}"?`)) return;
    setEvents((prev) => prev.filter((_, i) => i !== idx));
  }

  async function saveAll() {
    setSaving(true);
    setMsg('');
    setError('');
    try {
      const r = await patch<{ events: WeddingEvent[] }>(`/api/host/${slug}/events`, { t: token, events });
      setEvents(r.events);
      setMsg('Saved! Your invitation and Saathi concierge now show these timings.');
      notifySaathiChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save events.');
    } finally {
      setSaving(false);
    }
  }

  async function regenerateArt(eventName: string) {
    setRegenName(eventName);
    setError('');
    try {
      await post(`/api/weddings/${slug}/event-art`, { host_token: token, event_name: eventName });
      await load();
      notifySaathiChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not regenerate ceremony art.');
    } finally {
      setRegenName('');
    }
  }

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">Baraati App</p>
          <h1 className="h2">Ceremonies &amp; <span className="serif">events</span></h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Changes update your public invitation and Saathi concierge immediately.
          </p>
        </div>
        <div className="pl-actions-row">
          <button type="button" className="btn btn-outline btn-sm" onClick={addEvent}>+ Add ceremony</button>
          <button type="button" className="btn btn-cta btn-sm" disabled={saving} onClick={() => void saveAll()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {error && <div className="card card-sm pl-err-box" role="alert"><span className="badge bad">Error</span><p>{error}</p></div>}
      {msg && <div className="card card-sm" role="status"><span className="badge ok">✓ Saved</span> <span className="small">{msg}</span></div>}

      {loading ? (
        <div className="card pl-skeleton" />
      ) : (
        <div className="pl-card-stack">
          {events.map((ev, idx) => {
            const artId = artMap[ev.name];
            return (
              <article key={idx} className="card card-sm pl-event-edit-card">
                <div className="pl-ev-art-col">
                  {artId ? (
                    <img src={`/api/assets/${artId}`} alt={`Artwork for ${ev.name}`} className="pl-ev-art-img" />
                  ) : (
                    <div className="pl-ev-art-placeholder">No ceremony art yet</div>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={regenName === ev.name || !ev.name.trim()}
                    onClick={() => void regenerateArt(ev.name)}
                  >
                    {regenName === ev.name ? 'Generating…' : artId ? 'Regenerate art' : '✦ Generate art'}
                  </button>
                </div>

                <div className="pl-ev-fields">
                  <div className="pl-form-row">
                    <label>
                      Ceremony name *
                      <input type="text" value={ev.name} onChange={(e) => updateField(idx, 'name', e.target.value)} />
                    </label>
                    <label>
                      Dress code
                      <input type="text" value={ev.dress_code} onChange={(e) => updateField(idx, 'dress_code', e.target.value)} placeholder="e.g. Shades of yellow" />
                    </label>
                  </div>
                  <div className="pl-form-row">
                    <label>
                      Date
                      <input type="date" value={ev.date} onChange={(e) => updateField(idx, 'date', e.target.value)} />
                    </label>
                    <label>
                      Start time
                      <input type="time" value={ev.start_time} onChange={(e) => updateField(idx, 'start_time', e.target.value)} />
                    </label>
                  </div>
                  <div className="pl-form-row">
                    <label>
                      Venue name
                      <input type="text" value={ev.venue_name} onChange={(e) => updateField(idx, 'venue_name', e.target.value)} />
                    </label>
                    <label>
                      Address
                      <input type="text" value={ev.venue_address} onChange={(e) => updateField(idx, 'venue_address', e.target.value)} />
                    </label>
                  </div>
                  <label>
                    Notes for guests
                    <input type="text" value={ev.notes} onChange={(e) => updateField(idx, 'notes', e.target.value)} placeholder="Parking, shuttle, lunch details…" />
                  </label>
                  {events.length > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeEvent(idx)}>
                        Remove ceremony
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

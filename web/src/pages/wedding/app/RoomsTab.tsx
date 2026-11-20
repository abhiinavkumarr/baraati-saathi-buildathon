import { useCallback, useEffect, useMemo, useState } from 'react';
import { patch } from '../../../api.ts';
import { askSaathi, useWedding } from '../../../WeddingContext.tsx';
import type { GuestItem } from '../plan/GuestsTab.tsx';

export function RoomsTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [guests, setGuests] = useState<GuestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'room' | 'name'>('room');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedId, setSavedId] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/host/${slug}/guests?t=${encodeURIComponent(token)}`);
    if (r.ok) {
      const j = await r.json();
      setGuests((j.guests ?? []).filter((g: GuestItem) => g.status !== 'no'));
    }
    setLoading(false);
  }, [slug, token]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener('saathi:changed', onChanged);
    return () => window.removeEventListener('saathi:changed', onChanged);
  }, [load]);

  const sorted = useMemo(() => {
    return [...guests].sort((a, b) => {
      if (sortBy === 'room') {
        const ra = a.room || 'zzzz';
        const rb = b.room || 'zzzz';
        return ra.localeCompare(rb) || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
  }, [guests, sortBy]);

  async function saveRoom(g: GuestItem, val: string) {
    const clean = val.trim();
    if (clean === g.room) return;
    await patch(`/api/host/${slug}/guests/${g.id}`, { t: token, room: clean });
    setSavedId(g.id);
    setTimeout(() => setSavedId(''), 1500);
    await load();
  }

  const assignedCount = guests.filter((g) => Boolean(g.room)).length;

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">Baraati App</p>
          <h1 className="h2">Hotel <span className="serif">rooms</span></h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {assignedCount} of {guests.length} attending households assigned a room.
          </p>
        </div>
        <div className="pl-actions-row">
          <div className="pl-chip-row" role="group" aria-label="Sort rooms">
            <button type="button" className={`chip ${sortBy === 'room' ? 'on' : ''}`} onClick={() => setSortBy('room')}>Sort by room</button>
            <button type="button" className={`chip ${sortBy === 'name' ? 'on' : ''}`} onClick={() => setSortBy('name')}>Sort by name</button>
          </div>
          <button
            type="button"
            className="btn btn-cta btn-sm"
            onClick={() => askSaathi('Propose hotel rooming assignments grouping confirmed outstation guests by family/group into rooms of 2-3')}
          >
            ✦ Propose rooming
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card pl-skeleton" />
      ) : (
        <section className="card pl-table-card">
          <table className="pl-table">
            <thead>
              <tr>
                <th scope="col">Guest</th>
                <th scope="col">Group / Side</th>
                <th scope="col">Party</th>
                <th scope="col">Room</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((g) => {
                const val = drafts[g.id] ?? g.room;
                return (
                  <tr key={g.id}>
                    <td><b>{g.name}</b></td>
                    <td>
                      <div className="pl-badges-inline">
                        {g.group_name && <span className="badge">{g.group_name}</span>}
                        {g.side && <span className="badge">{g.side}</span>}
                      </div>
                    </td>
                    <td className="num">{g.party_size}</td>
                    <td style={{ minWidth: 110 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="text"
                          aria-label={`Room for ${g.name}`}
                          className="pl-cell-input"
                          style={{ minWidth: 92 }}
                          placeholder="e.g. 304"
                          value={val}
                          onChange={(e) => setDrafts((m) => ({ ...m, [g.id]: e.target.value }))}
                          onBlur={() => void saveRoom(g, val)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveRoom(g, val);
                          }}
                        />
                        {savedId === g.id && <span className="badge ok">✓</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

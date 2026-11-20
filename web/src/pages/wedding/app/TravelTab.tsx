import { useCallback, useEffect, useMemo, useState } from 'react';
import { askSaathi, useWedding } from '../../../WeddingContext.tsx';
import { fmtDate, fmtTime } from '../../../format.ts';
import type { GuestItem } from '../plan/GuestsTab.tsx';

interface ArrivalGuest extends GuestItem {
  extracted: {
    arrival_date?: string;
    arrival_time?: string;
    arrival_mode?: string;
    flight_or_train?: string;
    arrival_point?: string;
    needs_pickup?: boolean;
  };
}

export function TravelTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [guests, setGuests] = useState<ArrivalGuest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/host/${slug}/guests?t=${encodeURIComponent(token)}`);
    if (r.ok) {
      const j = await r.json();
      const rows = (j.guests ?? []) as GuestItem[];
      const withTravel = rows.filter(
        (g): g is ArrivalGuest =>
          g.status !== 'no' && Boolean(g.extracted && (g.extracted.arrival_date || g.extracted.arrival_point || g.extracted.needs_pickup)),
      );
      withTravel.sort((a, b) =>
        `${a.extracted.arrival_date || '9999'} ${a.extracted.arrival_time || '99:99'}`.localeCompare(
          `${b.extracted.arrival_date || '9999'} ${b.extracted.arrival_time || '99:99'}`,
        ),
      );
      setGuests(withTravel);
    }
    setLoading(false);
  }, [slug, token]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener('saathi:changed', onChanged);
    return () => window.removeEventListener('saathi:changed', onChanged);
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, { people: number; pickups: number }>();
    for (const g of guests) {
      const d = g.extracted.arrival_date;
      if (!d) continue;
      const cur = map.get(d) ?? { people: 0, pickups: 0 };
      cur.people += g.party_size;
      if (g.extracted.needs_pickup) cur.pickups += g.party_size;
      map.set(d, cur);
    }
    return [...map].sort(([a], [b]) => a.localeCompare(b));
  }, [guests]);

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Name', 'People', 'Date', 'Time', 'Mode', 'Flight/Train', 'Point', 'Pickup'].join(','),
      ...guests.map((g) =>
        [
          g.name,
          g.party_size,
          g.extracted.arrival_date ?? '',
          g.extracted.arrival_time ?? '',
          g.extracted.arrival_mode ?? '',
          g.extracted.flight_or_train ?? '',
          g.extracted.arrival_point ?? '',
          g.extracted.needs_pickup ? 'Yes' : 'No',
        ]
          .map(esc)
          .join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-arrivals.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const maxPeople = Math.max(...byDay.map(([, v]) => v.people), 1);

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">Baraati App</p>
          <h1 className="h2">Travel &amp; <span className="serif">pickups</span></h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {guests.length} arrivals tracked · {guests.filter((g) => g.extracted.needs_pickup).length} need pickup
          </p>
        </div>
        <div className="pl-actions-row">
          <button type="button" className="btn btn-outline btn-sm" onClick={exportCsv}>Export CSV</button>
          <button
            type="button"
            className="btn btn-cta btn-sm"
            onClick={() => askSaathi('Pair all guests who need airport or station pickups landing at the same point within 45 minutes into 4-seat cabs')}
          >
            ✦ Pair arrivals into cabs
          </button>
        </div>
      </div>

      {byDay.length > 0 && (
        <section className="card card-sm">
          <p className="eyebrow">Arrivals by day</p>
          <ul className="hbars">
            {byDay.map(([date, v]) => (
              <li key={date}>
                <span className="hb-l">{fmtDate(date, { day: 'numeric', month: 'short' })}</span>
                <span className="hb-track">
                  <span className="hb-fill" style={{ width: `${(v.people / maxPeople) * 100}%` }} />
                </span>
                <span className="hb-v">{v.people} <small>people ({v.pickups} pickup)</small></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading ? (
        <div className="card pl-skeleton" />
      ) : guests.length === 0 ? (
        <div className="card pl-empty-card">
          <span className="pl-empty-orb" aria-hidden>✈️</span>
          <h3>No travel details yet</h3>
          <p className="muted small">When guests share flight or train details in their RSVP, arrivals appear here automatically.</p>
        </div>
      ) : (
        <section className="card pl-table-card" tabIndex={0} aria-label="Guest arrivals table">
          <table className="pl-table">
            <thead>
              <tr>
                <th scope="col">Guest</th>
                <th scope="col">Date</th>
                <th scope="col">Time</th>
                <th scope="col">Mode / No.</th>
                <th scope="col">From / Point</th>
                <th scope="col">Pickup</th>
              </tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr key={g.id}>
                  <td><b>{g.name}</b> <span className="muted tiny">({g.party_size})</span></td>
                  <td>{g.extracted.arrival_date ? fmtDate(g.extracted.arrival_date, { day: 'numeric', month: 'short' }) : '—'}</td>
                  <td>{g.extracted.arrival_time ? fmtTime(g.extracted.arrival_time) : '—'}</td>
                  <td>{[g.extracted.arrival_mode, g.extracted.flight_or_train].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{g.extracted.arrival_point || '—'}</td>
                  <td>{g.extracted.needs_pickup ? <span className="badge ai">Pickup</span> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

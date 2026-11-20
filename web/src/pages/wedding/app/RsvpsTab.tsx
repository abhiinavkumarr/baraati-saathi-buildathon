import { useCallback, useEffect, useMemo, useState } from 'react';
import { askSaathi, useWedding } from '../../../WeddingContext.tsx';
import { fmtDate, fmtTime } from '../../../format.ts';
import type { GuestItem } from '../plan/GuestsTab.tsx';

const DIETS: [string, RegExp][] = [
  ['Jain', /jain/i],
  ['Vegan', /vegan/i],
  ['Vegetarian', /veg(etarian)?\b|shakahari/i],
  ['Allergy', /allerg|nut|gluten|lactose/i],
];

const STATUS_BADGE: Record<GuestItem['status'], { cls: string; label: string }> = {
  yes: { cls: 'ok', label: 'Coming' },
  maybe: { cls: 'warn', label: 'Maybe' },
  no: { cls: 'bad', label: "Can't come" },
  pending: { cls: '', label: 'Pending' },
};

export function RsvpsTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [guests, setGuests] = useState<GuestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | GuestItem['status']>('all');

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/host/${slug}/guests?t=${encodeURIComponent(token)}`);
    if (r.ok) {
      const j = await r.json();
      setGuests(j.guests ?? []);
    }
    setLoading(false);
  }, [slug, token]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener('saathi:changed', onChanged);
    return () => window.removeEventListener('saathi:changed', onChanged);
  }, [load]);

  const counts = useMemo(() => {
    const by = (st: GuestItem['status']) => guests.filter((g) => g.status === st);
    const heads = (arr: GuestItem[]) => arr.reduce((s, g) => s + g.party_size, 0);
    const yes = by('yes');
    const maybe = by('maybe');
    const no = by('no');
    const pending = by('pending');
    return {
      yes: yes.length, yesHeads: heads(yes),
      maybe: maybe.length, maybeHeads: heads(maybe),
      no: no.length,
      pending: pending.length, pendingHeads: heads(pending),
    };
  }, [guests]);

  const dietBars = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of guests) {
      if (g.status !== 'yes' && g.status !== 'maybe') continue;
      const d = g.extracted?.dietary ?? '';
      if (!d) continue;
      const label = DIETS.find(([, re]) => re.test(d))?.[0] ?? 'Other';
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    return [...map].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [guests]);

  const partyBars = useMemo(() => {
    const buckets: [string, number][] = [
      ['Solo (1)', 0],
      ['Couple (2)', 0],
      ['Family (3–4)', 0],
      ['Group (5+)', 0],
    ];
    for (const g of guests) {
      if (g.status === 'no') continue;
      if (g.party_size <= 1) buckets[0][1]++;
      else if (g.party_size === 2) buckets[1][1]++;
      else if (g.party_size <= 4) buckets[2][1]++;
      else buckets[3][1]++;
    }
    return buckets.map(([label, value]) => ({ label, value })).filter((x) => x.value > 0);
  }, [guests]);

  const visible = filter === 'all' ? guests : guests.filter((g) => g.status === filter);

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">Baraati App</p>
          <h1 className="h2">Guest <span className="serif">RSVPs</span></h1>
        </div>
        <button
          type="button"
          className="btn btn-cta btn-sm"
          onClick={() => askSaathi("Remind everyone who hasn't replied")}
        >
          ✦ Remind the pending ones
        </button>
      </div>

      <div className="pl-stats-4">
        <div className="card card-sm pl-stat-tile">
          <p className="eyebrow">Attending</p>
          <b className="num pl-stat-big grad-text">{counts.yesHeads}</b>
          <span className="muted tiny">{counts.yes} households confirmed</span>
        </div>
        <div className="card card-sm pl-stat-tile">
          <p className="eyebrow">Maybe</p>
          <b className="num pl-stat-big">{counts.maybe}</b>
          <span className="muted tiny">{counts.maybeHeads} expected heads</span>
        </div>
        <div className="card card-sm pl-stat-tile">
          <p className="eyebrow">Pending</p>
          <b className="num pl-stat-big">{counts.pending}</b>
          <span className="muted tiny">{counts.pendingHeads} heads awaiting reply</span>
        </div>
        <div className="card card-sm pl-stat-tile">
          <p className="eyebrow">Can&apos;t come</p>
          <b className="num pl-stat-big">{counts.no}</b>
          <span className="muted tiny">Regrets</span>
        </div>
      </div>

      {(dietBars.length > 0 || partyBars.length > 0) && (
        <div className="pl-home-grid">
          {dietBars.length > 0 && (
            <section className="card card-sm">
              <p className="eyebrow">Catering</p>
              <h2 className="h3" style={{ margin: '0 0 12px' }}>Food needs</h2>
              <HBarList items={dietBars} unit="households" />
            </section>
          )}
          {partyBars.length > 0 && (
            <section className="card card-sm">
              <p className="eyebrow">Households</p>
              <h2 className="h3" style={{ margin: '0 0 12px' }}>Party sizes</h2>
              <HBarList items={partyBars} unit="parties" />
            </section>
          )}
        </div>
      )}

      <div className="pl-chip-row" role="group" aria-label="Filter RSVPs by status">
        {(['all', 'yes', 'maybe', 'pending', 'no'] as const).map((st) => (
          <button
            key={st}
            type="button"
            className={`chip ${filter === st ? 'on' : ''}`}
            aria-pressed={filter === st}
            onClick={() => setFilter(st)}
          >
            {st === 'all' ? `All (${guests.length})` : STATUS_BADGE[st].label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card pl-skeleton" />
      ) : (
        <section className="card card-sm">
          <ul className="pl-pay-list">
            {visible.map((g) => {
              const st = STATUS_BADGE[g.status];
              return (
                <li key={g.id}>
                  <div style={{ flex: 1 }}>
                    <div className="pl-badges-inline">
                      <b>{g.name}</b>
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                      {g.status !== 'no' && <span className="badge">{g.party_size} {g.party_size === 1 ? 'person' : 'people'}</span>}
                      {g.extracted?.dietary && <span className="badge ai">{g.extracted.dietary}</span>}
                      {g.extracted?.needs_pickup && <span className="badge ai">Pickup</span>}
                      {g.extracted?.arrival_date && (
                        <span className="badge ai">
                          Arrives {fmtDate(g.extracted.arrival_date, { day: 'numeric', month: 'short' })}
                          {g.extracted.arrival_time ? ` ${fmtTime(g.extracted.arrival_time)}` : ''}
                        </span>
                      )}
                    </div>
                    {g.note && <p className="muted small" style={{ margin: '4px 0 0' }}>“{g.note}”</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function HBarList({ items, unit }: { items: { label: string; value: number }[]; unit: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="hbars">
      {items.map((i) => (
        <li key={i.label}>
          <span className="hb-l">{i.label}</span>
          <span className="hb-track">
            <span className="hb-fill" style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
          <span className="hb-v">{i.value} <small>{unit}</small></span>
        </li>
      ))}
    </ul>
  );
}

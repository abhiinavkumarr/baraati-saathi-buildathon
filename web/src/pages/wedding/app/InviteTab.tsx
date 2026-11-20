import { useCallback, useEffect, useState } from 'react';
import { useWedding } from '../../../WeddingContext.tsx';
import type { GuestItem } from '../plan/GuestsTab.tsx';

export function InviteTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [guests, setGuests] = useState<GuestItem[]>([]);
  const [copied, setCopied] = useState('');
  const [frameKey, setFrameKey] = useState(0);

  const inviteUrl = `${location.origin}/i/${slug}`;
  const previewSrc = `/i/${slug}?preview=1${token ? `&t=${encodeURIComponent(token)}` : ''}`;

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/host/${slug}/guests?t=${encodeURIComponent(token)}`);
    if (r.ok) {
      const j = await r.json();
      setGuests(j.guests ?? []);
    }
  }, [slug, token]);

  useEffect(() => {
    void load();
    const onChanged = () => {
      void load();
      setFrameKey((k) => k + 1);
    };
    window.addEventListener('saathi:changed', onChanged);
    return () => window.removeEventListener('saathi:changed', onChanged);
  }, [load]);

  function copy(text: string, id: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(''), 1800);
    });
  }

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">Baraati App</p>
          <h1 className="h2">Living <span className="serif">invitation</span></h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Preview what guests see, copy the share link or QR, and send personalised links.
          </p>
        </div>
        <div className="pl-actions-row">
          <a className="btn btn-outline btn-sm" href={`/i/${slug}${token ? `?t=${encodeURIComponent(token)}` : ''}`} target="_blank" rel="noreferrer">
            Open as a guest ↗
          </a>
          <button type="button" className="btn btn-cta btn-sm" onClick={() => copy(inviteUrl, 'main')}>
            {copied === 'main' ? 'Link copied ✓' : 'Copy invite link'}
          </button>
        </div>
      </div>

      <div className="pl-invite-grid">
        <div className="card pl-phone-col">
          <div className="land-phone" style={{ margin: '0 auto' }}>
            <iframe key={frameKey} title="Live invitation preview" src={previewSrc} />
          </div>
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setFrameKey((k) => k + 1)}>
            Refresh preview
          </button>
        </div>

        <div className="pl-card-stack">
          <section className="card card-sm">
            <p className="eyebrow">Share</p>
            <h2 className="h3" style={{ margin: '0 0 12px' }}>Link &amp; QR code</h2>
            <div className="pl-qr-row">
              <img
                src={`/api/qr?url=${encodeURIComponent(inviteUrl)}`}
                alt="QR code for wedding invitation"
                className="pl-qr-img"
              />
              <div style={{ flex: 1, minWidth: 180 }}>
                <input type="text" readOnly value={inviteUrl} aria-label="Public invitation link" />
                <div className="pl-row-btns" style={{ marginTop: 10 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => copy(inviteUrl, 'box')}>
                    {copied === 'box' ? 'Copied ✓' : 'Copy link'}
                  </button>
                  <a
                    className="btn btn-outline btn-sm"
                    href={`/api/qr?url=${encodeURIComponent(inviteUrl)}`}
                    download={`${slug}-qr.svg`}
                  >
                    Download QR
                  </a>
                </div>
              </div>
            </div>
          </section>

          <section className="card card-sm">
            <p className="eyebrow">Personalised invites</p>
            <h2 className="h3" style={{ margin: '0 0 8px' }}>Personal guest links ({guests.length})</h2>
            <p className="muted small" style={{ margin: '0 0 12px' }}>
              Each link greets the guest by name and pre-fills their RSVP.
            </p>
            {guests.length === 0 ? (
              <p className="muted small">Add guests in Your Wedding → Guests to generate personal links.</p>
            ) : (
              <ul className="pl-pay-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {guests.slice(0, 40).map((g) => (
                  <li key={g.id}>
                    <div>
                      <b>{g.name}</b>
                      <div className="muted tiny">{[g.group_name, g.status].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="pl-row-btns">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(g.personal_link, g.id)}>
                        {copied === g.id ? 'Copied ✓' : 'Copy link'}
                      </button>
                      {g.wa_url && (
                        <a className="btn btn-outline btn-sm" href={g.wa_url} target="_blank" rel="noreferrer">
                          WhatsApp ↗
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="card card-sm">
        <p className="eyebrow">More in the Baraati app</p>
        <div className="pl-more-grid">
          {[
            ['🪪', 'Govt IDs', 'Collect check-in IDs securely in the Baraati mobile app.'],
            ['🎲', 'Wedding Games', 'Trivia, bingo and leaderboards for your baraatis.'],
            ['📸', 'Photo Drive', 'Shared guest photo stream sorted by ceremony.'],
            ['📖', 'Wedding Album', 'Curated keepsake album after the celebrations.'],
          ].map(([icon, title, desc]) => (
            <div key={title} className="pl-more-tile">
              <span aria-hidden style={{ fontSize: 22 }}>{icon}</span>
              <b>{title}</b>
              <p className="muted tiny" style={{ margin: 0 }}>{desc}</p>
              <span className="badge" style={{ marginTop: 6 }}>Available in the Baraati app</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

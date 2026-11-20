import { useEffect, useRef, useState } from 'react';
import { fileToAttachment, post } from '../api.ts';
import { renderCard } from '../card.ts';
import { storage } from '../format.ts';
import { useWedding } from './Invite.tsx';

type Job = 'idle' | 'working' | 'done' | 'failed';

export function Studio({
  slug,
  tokenOverride,
  embedded = false,
  onOpenDashboard,
}: {
  slug: string;
  tokenOverride?: string;
  embedded?: boolean;
  onOpenDashboard?: () => void;
}) {
  const hostToken = tokenOverride ?? storage(`host:${slug}`) ?? new URLSearchParams(location.search).get('t') ?? '';
  const { w } = useWedding(slug, 5000);
  const [art, setArt] = useState<Job>('idle');
  const [music, setMusic] = useState<Job>('idle');
  const [couple, setCouple] = useState<Job>('idle');
  const [events, setEvents] = useState<Job>('idle');
  const [msg, setMsg] = useState('');
  const [frame, setFrame] = useState(0); // bump to reload the preview iframe
  const started = useRef(false);
  const photoInput = useRef<HTMLInputElement>(null);

  const inviteUrl = `${location.origin}/i/${slug}`;
  const hostUrl = `${location.origin}/h/${slug}?t=${encodeURIComponent(hostToken)}`;

  async function run(kind: 'art' | 'music' | 'couple' | 'events', set: (j: Job) => void, photo?: unknown) {
    set('working');
    try {
      if (kind === 'music') await post(`/api/weddings/${slug}/music`, { host_token: hostToken });
      else if (kind === 'events') await post(`/api/weddings/${slug}/event-art`, { host_token: hostToken });
      else await post(`/api/weddings/${slug}/art`, { host_token: hostToken, kind: kind === 'couple' ? 'couple_art' : 'card_art', photo });
      set('done');
      setFrame((f) => f + 1);
    } catch (e) {
      set('failed');
      setMsg(e instanceof Error ? e.message : 'Generation failed.');
    }
  }

  // First visit: make the artwork and the music in parallel.
  useEffect(() => {
    if (!w || started.current || !hostToken) return;
    started.current = true;
    if (!w.assets.card_art) void run('art', setArt);
    else setArt('done');
    if (!w.assets.music) void run('music', setMusic);
    else setMusic('done');
    if (w.assets.couple_art) setCouple('done');
    if (!w.assets.events || !Object.keys(w.assets.events).length) void run('events', setEvents);
    else setEvents('done');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, hostToken]);

  async function download() {
    if (!w) return;
    const blob = await renderCard(w.draft, w.assets.card_art ? `/api/assets/${w.assets.card_art}` : undefined);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${w.draft.partner1_name}-${w.draft.partner2_name}-invitation.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!hostToken) {
    return <main className="shell"><h1 className="display">Host link needed</h1><p className="muted">Open this page from the device you created the wedding on, or use your host link.</p></main>;
  }
  if (!w) return <main className="shell muted">Loading…</main>;

  const d = w.draft;
  const waText = encodeURIComponent(`${d.partner1_name} & ${d.partner2_name} would love you to join their wedding 💐\nOpen your invitation and RSVP: ${inviteUrl}`);

  return (
    <main className="studio">
      {!embedded && (
        <header className="brand">
          <span className="wordmark">Baraati</span> <span className="tag">Saathi</span>
        </header>
      )}

      <div className="studio-grid">
        <section className="studio-side">
          <p className="eyebrow">Your invitation</p>
          <h1 className="display couple">{d.partner1_name} <span className="amp">&amp;</span> {d.partner2_name}</h1>

          <ul className="jobs">
            <JobRow label="Card artwork" sub="Nano Banana" state={art} onRetry={() => void run('art', setArt)} />
            <JobRow label="Invitation music" sub="Lyria" state={music} onRetry={() => void run('music', setMusic)} />
            <JobRow label="Ceremony art" sub={`Nano Banana · one scene per ceremony (${w.draft.events.length})`} state={events} onRetry={() => void run('events', setEvents)} />
            <JobRow
              label="Couple illustration"
              sub="optional · from your photo"
              state={couple}
              idleLabel="Add photo"
              onRetry={() => photoInput.current?.click()}
            />
          </ul>
          <input
            ref={photoInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void run('couple', setCouple, await fileToAttachment(f));
            }}
          />
          {msg && <p className="error" role="alert">{msg}</p>}

          <div className="share card">
            <img className="qr" src={`/api/qr?url=${encodeURIComponent(inviteUrl)}`} alt="QR code for the invitation" />
            <div className="share-actions">
              <a className="btn btn-cta btn-sm" href={`https://wa.me/?text=${waText}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
              <CopyButton text={inviteUrl} />
              <button className="btn btn-outline btn-sm" onClick={() => void download()}>Download card</button>
              {onOpenDashboard ? (
                <button className="btn btn-outline btn-sm" onClick={onOpenDashboard}>Control room →</button>
              ) : (
                <a className="btn btn-outline btn-sm" href={hostUrl}>Guest dashboard →</a>
              )}
            </div>
          </div>
          <p className="muted small">Guests open the link in any browser and RSVP. No app needed.</p>
        </section>

        <section className="phone-wrap">
          <div className="phone">
            <iframe key={frame} title="Invitation preview" src={`/i/${slug}?preview=1`} />
          </div>
          <a className="muted small" href={`/i/${slug}`} target="_blank" rel="noreferrer">Open as a guest ↗</a>
        </section>
      </div>
    </main>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-ghost btn-sm"
      aria-live="polite"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          prompt('Copy this link', text);
        }
      }}
    >
      {copied ? 'Copied ✓' : 'Copy link'}
    </button>
  );
}

function JobRow({ label, sub, state, onRetry, idleLabel = 'Retry' }: {
  label: string; sub: string; state: Job; onRetry: () => void; idleLabel?: string;
}) {
  return (
    <li className={`job card-sm ${state}`}>
      <div className="job-row-top">
        <span className="dot" aria-hidden />
        <span className="job-text"><b>{label}</b><span>{sub}</span></span>
        {state === 'working' && <span className="badge ai" role="status">✦ Creating…</span>}
        {state === 'done' && <span className="badge ok">Ready</span>}
        {state === 'failed' && <button className="btn btn-ghost btn-sm" onClick={onRetry}>Retry</button>}
        {state === 'idle' && <button className="btn btn-ghost btn-sm" onClick={onRetry}>{idleLabel}</button>}
      </div>
      {state === 'working' && <div className="job-bar" aria-hidden><span /></div>}
    </li>
  );
}

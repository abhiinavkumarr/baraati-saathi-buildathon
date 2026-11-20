import { useEffect, useRef, useState } from 'react';
import { fileToAttachment, post } from '../api.ts';
import { renderCard } from '../card.ts';
import { storage } from '../format.ts';
import { useWedding } from './Invite.tsx';
import { useWedding as useWeddingList } from '../WeddingContext.tsx';
import { ornamentUrl, TEMPLATE_STYLES } from '../themes.ts';

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
  // The shared demo is view-only: show what exists, don't start generating.
  const isDemo = Boolean(useWeddingList().getWeddingBySlug(slug)?.demo);
  const [art, setArt] = useState<Job>('idle');
  const [music, setMusic] = useState<Job>('idle');
  const [couple, setCouple] = useState<Job>('idle');
  const [events, setEvents] = useState<Job>('idle');
  const [msg, setMsg] = useState('');
  const [frame, setFrame] = useState(0); // bump to reload the preview iframe
  const [previewStyle, setPreviewStyle] = useState(''); // '' = the wedding's own style
  const started = useRef(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const photoOnlyInput = useRef<HTMLInputElement>(null);

  // Save (or replace) the couple photo shown on the invitation, without making art.
  async function savePhoto(f: File) {
    try {
      await post(`/api/weddings/${slug}/couple-photo`, { host_token: hostToken, photo: await fileToAttachment(f) });
      setFrame((n) => n + 1);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save the photo.');
    }
  }

  const inviteUrl = `${location.origin}/i/${slug}`;
  const hostUrl = `${location.origin}/h/${slug}?t=${encodeURIComponent(hostToken)}`;

  async function run(kind: 'art' | 'music' | 'couple' | 'events', set: (j: Job) => void, photo?: unknown) {
    set('working');
    try {
      if (kind === 'music') await post(`/api/weddings/${slug}/music`, { host_token: hostToken });
      else if (kind === 'events') await post(`/api/weddings/${slug}/event-art`, { host_token: hostToken });
      else if (kind === 'couple') await post(`/api/weddings/${slug}/art`, { host_token: hostToken, kind: 'couple_art', ...(photo ? { photo } : { use_saved_photo: true }) });
      else await post(`/api/weddings/${slug}/art`, { host_token: hostToken, kind: 'card_art' });
      set('done');
      setFrame((f) => f + 1);
    } catch (e) {
      set('failed');
      setMsg(e instanceof Error ? e.message : 'Generation failed.');
    }
  }

  // Nothing is generated automatically: the host creates the invitation here,
  // on purpose. On load, just reflect what already exists.
  useEffect(() => {
    if (!w || started.current) return;
    started.current = true;
    setArt(w.assets.card_art ? 'done' : 'idle');
    setMusic(w.assets.music ? 'done' : 'idle');
    setEvents(w.assets.events && Object.keys(w.assets.events).length ? 'done' : 'idle');
    if (w.assets.couple_art) setCouple('done');
  }, [w]);

  /** Save the chosen style (if it changed), then make everything in parallel. */
  async function createInvitation(alsoMusic: boolean) {
    if (!w) return;
    setMsg('');
    if (previewStyle && previewStyle !== w.draft.style) {
      try {
        await post(`/api/host/${slug}/style`, { t: hostToken, style: previewStyle });
        w.draft.style = previewStyle;
        setPreviewStyle('');
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'Could not save the style.');
        return;
      }
    }
    await Promise.all([
      run('art', setArt),
      run('events', setEvents),
      ...(alsoMusic ? [run('music', setMusic)] : []),
      ...(w.assets.couple_photo && !w.assets.couple_art ? [run('couple', setCouple)] : []),
    ]);
  }

  async function download() {
    if (!w) return;
    const blob = await renderCard(w.draft, w.assets.card_art ? `/api/assets/${w.assets.card_art}` : undefined);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${w.draft.partner1_name}-${w.draft.partner2_name}-invitation.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const Wrap = embedded ? 'div' : 'main';

  if (!hostToken) {
    return <Wrap className="shell"><h1 className="display">Host link needed</h1><p className="muted">Open this page from the device you created the wedding on, or use your host link.</p></Wrap>;
  }
  if (!w) return <Wrap className="shell muted">Loading…</Wrap>;

  const d = w.draft;
  const working = [art, music, events, couple].includes('working');
  const created = Boolean(w.assets.card_art || w.assets.music || (w.assets.events && Object.keys(w.assets.events).length)) || working;
  const chosen = previewStyle || d.style;
  const waText = encodeURIComponent(`${d.partner1_name} & ${d.partner2_name} would love you to join their wedding 💐\nOpen your invitation and RSVP: ${inviteUrl}`);

  return (
    <Wrap className="studio">
      {!embedded && (
        <header className="brand">
          <span className="wordmark">Baraati</span> <span className="tag">Saathi</span>
        </header>
      )}

      <div className="studio-grid">
        <section className="studio-side">
          <p className="eyebrow">Your invitation</p>
          <h1 className="display couple">{d.partner1_name} <span className="amp">&amp;</span> {d.partner2_name}</h1>

          <input
            ref={photoOnlyInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void savePhoto(f);
            }}
          />
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
          {!created && !isDemo ? (
            <div className="studio-create">
              <p className="muted">Create your living invitation with Google AI. Pick a style and Saathi makes the card art, a scene for each ceremony and the music. You can preview every style on the right first.</p>
              <span className="pl-field-label">1 · Pick a style</span>
              <div className="style-tiles" style={{ padding: 0 }} role="group" aria-label="Pick an invitation style">
                {TEMPLATE_STYLES.map((s) => (
                  <button key={s.id} type="button" className={`style-tile ${chosen === s.id ? 'selected' : ''}`} aria-pressed={chosen === s.id}
                    onClick={() => setPreviewStyle(s.id === d.style ? '' : s.id)}>
                    <span className="st-swatch" style={{ background: `${ornamentUrl(s.id)} center / 60px` }} aria-hidden />
                    <b>{s.label} {chosen === s.id ? '✓' : ''}</b>
                    <small>{s.sub}</small>
                  </button>
                ))}
              </div>
              <span className="pl-field-label">2 · Couple photo <span className="muted">(optional)</span></span>
              <p className="muted small" style={{ margin: 0 }}>
                {w.assets.couple_photo ? 'Your photo is on the invitation; Nano Banana will also paint an illustration from it. ' : 'Shown on the invitation, and painted as an illustration. '}
                <button type="button" className="linkish" onClick={() => photoOnlyInput.current?.click()}>{w.assets.couple_photo ? 'Change photo' : 'Add a photo'}</button>
              </p>
              <span className="pl-field-label">3 · Create</span>
              <ul className="studio-make muted small">
                <li>Card artwork · Nano Banana</li>
                <li>{d.events.length} ceremony scene{d.events.length === 1 ? '' : 's'} · Nano Banana</li>
                <li>Invitation music · Lyria</li>
                {w.assets.couple_photo && <li>Couple illustration · Nano Banana</li>}
              </ul>
              <button type="button" className="btn btn-cta" onClick={() => void createInvitation(true)}>✦ Create invitation</button>
              {msg && <p className="error" role="alert">{msg}</p>}
            </div>
          ) : (
          <>
          <ul className="jobs">
            <JobRow label="Card artwork" sub="Nano Banana" state={art} onRetry={() => void run('art', setArt)} />
            <JobRow label="Invitation music" sub="Lyria" state={music} onRetry={() => void run('music', setMusic)} />
            <JobRow label="Ceremony art" sub={`Nano Banana · one scene per ceremony (${w.draft.events.length})`} state={events} onRetry={() => void run('events', setEvents)} />
            <JobRow
              label="Couple illustration"
              sub={w.assets.couple_photo ? 'Nano Banana · from your couple photo' : 'optional · from your photo'}
              state={couple}
              idleLabel={w.assets.couple_photo ? 'Make it' : 'Add photo'}
              onRetry={() => (w.assets.couple_photo ? void run('couple', setCouple) : photoInput.current?.click())}
            />
          </ul>
          {w.assets.couple_photo ? (
            <p className="muted small" style={{ margin: '-4px 0 8px' }}>
              Your couple photo is on the invitation.{' '}
              <button type="button" className="linkish" onClick={() => photoOnlyInput.current?.click()}>Change photo</button>
            </p>
          ) : (
            <p className="muted small" style={{ margin: '-4px 0 8px' }}>
              <button type="button" className="linkish" onClick={() => photoOnlyInput.current?.click()}>Add a couple photo</button> to show it on the invitation.
            </p>
          )}
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

          <div className="card card-sm studio-styles">
            <b>Invitation styles</b>
            <p className="muted small">Preview your invitation in each style. AI artwork is made for your chosen style, so other styles show their built-in patterns.</p>
            <div className="pl-chip-row" role="group" aria-label="Preview the invitation in a style">
              {TEMPLATE_STYLES.map((s) => {
                const on = (previewStyle || d.style) === s.id;
                return (
                  <button key={s.id} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on}
                    onClick={() => setPreviewStyle(s.id === d.style ? '' : s.id)}>
                    {s.label}{s.id === d.style ? ' · yours' : ''}
                  </button>
                );
              })}
            </div>
            {previewStyle && previewStyle !== d.style && !isDemo && (
              <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={working}
                onClick={() => void createInvitation(false)}>
                Use {TEMPLATE_STYLES.find((s) => s.id === previewStyle)?.label} and remake the art
              </button>
            )}
            <a className="small" href="/templates" target="_blank" rel="noreferrer">See all styles side by side ↗</a>
          </div>
          </>
          )}
        </section>

        <section className="phone-wrap">
          <div className="phone">
            <iframe key={`${frame}-${previewStyle}`} title="Invitation preview" src={`/i/${slug}?preview=1${previewStyle ? `&style=${previewStyle}` : ''}`} />
          </div>
          <a className="muted small" href={`/i/${slug}`} target="_blank" rel="noreferrer">Open as a guest ↗</a>
        </section>
      </div>
    </Wrap>
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

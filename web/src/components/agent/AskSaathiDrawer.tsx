import { useEffect, useState } from 'react';
import { ControlRoom } from './ControlRoom.tsx';
import { notifySaathiChanged } from '../../WeddingContext.tsx';

export function AskSaathiDrawer({ slug, token }: { slug: string; token: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const onAsk = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      setOpen(true);
      if (prompt) setPending(prompt);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('saathi:ask', onAsk);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('saathi:ask', onAsk);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!token) return null;

  return (
    <>
      <button
        type="button"
        className="saathi-fab"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? 'Close Ask Saathi' : 'Open Ask Saathi'}
      >
        <span className="saathi-fab-orb" aria-hidden>✦</span>
        <span className="saathi-fab-label">Ask Saathi</span>
      </button>

      {open && (
        <div className="drawer-backdrop" onClick={() => setOpen(false)} aria-hidden />
      )}

      <aside
        className={`saathi-drawer ${open ? 'open' : ''}`}
        aria-label="Ask Saathi"
        aria-hidden={!open}
      >
        <header className="drawer-head">
          <div className="drawer-title">
            <span className="saathi-avatar" aria-hidden>✦</span>
            <div>
              <h2>Ask Saathi</h2>
              <span className="badge ai">✦ Gemini · AlloyDB</span>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setOpen(false)}
            aria-label="Close Ask Saathi drawer"
          >
            ✕
          </button>
        </header>
        <div className="drawer-body">
          <ControlRoom
            slug={slug}
            token={token}
            push={pending}
            onPushed={() => setPending(null)}
            onChange={() => notifySaathiChanged()}
            compact
          />
        </div>
      </aside>
    </>
  );
}

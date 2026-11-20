import { useEffect, useRef, useState } from 'react';
import { ControlRoom } from './ControlRoom.tsx';
import { notifySaathiChanged } from '../../WeddingContext.tsx';

export function AskSaathiDrawer({ slug, token }: { slug: string; token: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = () => {
    setOpen(false);
    // Return focus before aria-hidden/inert takes effect so focus never remains inside hidden drawer.
    fabRef.current?.focus();
  };

  useEffect(() => {
    if (drawerRef.current) {
      drawerRef.current.inert = !open;
    }
  }, [open]);

  useEffect(() => {
    const onAsk = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      setOpen(true);
      if (prompt) setPending(prompt);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) closeDrawer();
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
        ref={fabRef}
        type="button"
        className="pl-saathi-fab"
        onClick={() => (open ? closeDrawer() : setOpen(true))}
        aria-expanded={open}
        aria-label={open ? 'Close Ask Saathi' : 'Open Ask Saathi'}
      >
        <span className="pl-saathi-fab-orb" aria-hidden>✦</span>
        <span className="pl-saathi-fab-label">Ask Saathi</span>
      </button>

      {open && (
        <div className="drawer-backdrop" onClick={closeDrawer} aria-hidden />
      )}

      <aside
        ref={drawerRef}
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
            onClick={closeDrawer}
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

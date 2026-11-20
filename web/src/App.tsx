import { useEffect, useState } from 'react';
import { Invite } from './pages/Invite.tsx';
import { Studio } from './pages/Studio.tsx';
import { Host } from './pages/Host.tsx';
import { Login, type ActiveWedding, type UserSession } from './pages/Login.tsx';
import { Workspace } from './pages/Workspace.tsx';

// Minimal path router; the app has only a handful of pages.
export function navigate(path: string) {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function readSession(): UserSession | null {
  try {
    const raw = localStorage.getItem('saathi:session');
    if (raw) {
      const s = JSON.parse(raw) as UserSession;
      if (s?.name) return s;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function App() {
  const [path, setPath] = useState(location.pathname);
  const [session, setSession] = useState<UserSession | null>(() => readSession());
  const [initialWedding, setInitialWedding] = useState<ActiveWedding | null>(null);

  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  const m = path.match(/^\/(i|studio|h)\/([\w-]+)/);
  if (m?.[1] === 'i') return <Invite slug={m[2]} />;
  if (m?.[1] === 'studio') return <Studio slug={m[2]} />;
  if (m?.[1] === 'h') return <Host slug={m[2]} />;

  if (!session) {
    return (
      <Login
        onLogin={(s, w) => {
          try {
            localStorage.setItem('saathi:session', JSON.stringify(s));
          } catch {
            /* ignore */
          }
          if (w) setInitialWedding(w);
          setSession(s);
        }}
      />
    );
  }

  return (
    <Workspace
      session={session}
      initialWedding={initialWedding}
      onLogout={() => {
        try {
          localStorage.removeItem('saathi:session');
        } catch {
          /* ignore */
        }
        setSession(null);
      }}
    />
  );
}

import { useEffect, useState } from 'react';
import { Create } from './pages/Create.tsx';
import { Invite } from './pages/Invite.tsx';
import { Studio } from './pages/Studio.tsx';
import { Host } from './pages/Host.tsx';

// Minimal path router; the app has only a handful of pages.
export function navigate(path: string) {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  const m = path.match(/^\/(i|studio|h)\/([\w-]+)/);
  if (m?.[1] === 'i') return <Invite slug={m[2]} />;
  if (m?.[1] === 'studio') return <Studio slug={m[2]} />;
  if (m?.[1] === 'h') return <Host slug={m[2]} />;
  return <Create />;
}

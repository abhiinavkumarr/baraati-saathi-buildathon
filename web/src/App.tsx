import { useEffect, useState } from 'react';
import { Create } from './pages/Create.tsx';

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

  const invite = path.match(/^\/i\/([\w-]+)/);
  if (invite) return <Placeholder title="Invitation" note={`Animated invite for ${invite[1]} — Act 2, coming next.`} />;
  return <Create />;
}

function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <main className="shell">
      <h1 className="display">{title}</h1>
      <p className="muted">{note}</p>
    </main>
  );
}

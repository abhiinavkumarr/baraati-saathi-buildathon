import { useEffect, useState } from 'react';
import { Invite } from './pages/Invite.tsx';
import { Studio } from './pages/Studio.tsx';
import { Login } from './pages/Login.tsx';
import { MyWeddings } from './pages/MyWeddings.tsx';
import { NewWedding } from './pages/NewWedding.tsx';
import { WeddingShell, type SectionKey } from './pages/wedding/WeddingShell.tsx';
import { WeddingHome } from './pages/wedding/WeddingHome.tsx';
import { WeddingProvider, useWedding } from './WeddingContext.tsx';

// Minimal path router; the app has only a handful of pages.
export function navigate(path: string) {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function RouterView() {
  const [path, setPath] = useState(location.pathname);
  const { session, getTokenForSlug } = useWedding();

  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  // Public invitation (unchanged)
  const invMatch = path.match(/^\/i\/([\w-]+)/);
  if (invMatch) return <Invite slug={invMatch[1]} />;

  // Legacy /h/:slug and /studio/:slug redirects → /w/:slug (preserve ?t=)
  const legacyMatch = path.match(/^\/(h|studio)\/([\w-]+)/);
  if (legacyMatch) {
    const kind = legacyMatch[1];
    const slug = legacyMatch[2];
    const t = new URLSearchParams(location.search).get('t');
    if (t) {
      try {
        localStorage.setItem(`host:${slug}`, t);
      } catch {
        /* ignore */
      }
    }
    const dest = kind === 'studio' ? `/w/${slug}/studio/invitation` : `/w/${slug}`;
    const full = t ? `${dest}?t=${encodeURIComponent(t)}` : dest;
    history.replaceState(null, '', full);
    setPath(dest);
    return null;
  }

  // Wedding routes: /w/:slug, /w/:slug/plan/:tab, /w/:slug/app/:tab, /w/:slug/studio/:tab
  const wMatch = path.match(/^\/w\/([\w-]+)(?:\/(plan|app|studio)(?:\/([\w-]+))?)?/);
  if (wMatch) {
    const slug = wMatch[1];
    const section = (wMatch[2] as SectionKey | undefined) ?? 'home';
    const tab = wMatch[3] ?? (section === 'plan' ? 'guests' : section === 'app' ? 'invite' : section === 'studio' ? 'invitation' : undefined);
    const qsToken = new URLSearchParams(location.search).get('t');
    if (qsToken) {
      try {
        localStorage.setItem(`host:${slug}`, qsToken);
      } catch {
        /* ignore */
      }
    }
    const token = getTokenForSlug(slug);
    if (!session && !token) {
      return <Login />;
    }

    let content = <WeddingHome slug={slug} />;
    if (section === 'studio' && tab === 'invitation') {
      content = <Studio slug={slug} tokenOverride={token} embedded />;
    } else if (section !== 'home') {
      content = (
        <section className="card">
          <p className="eyebrow">{section === 'plan' ? 'Your Wedding' : section === 'app' ? 'Baraati App' : 'AI Studio'}</p>
          <h1 className="h2" style={{ margin: '0 0 8px' }}>{tab}</h1>
          <p className="muted">Coming right up in the next step.</p>
        </section>
      );
    }

    return (
      <WeddingShell slug={slug} section={section} tab={tab}>
        {content}
      </WeddingShell>
    );
  }

  if (!session) {
    return <Login />;
  }

  if (path === '/new') return <NewWedding />;
  if (path === '/weddings') return <MyWeddings />;

  // Logged-in user at "/" goes to My weddings
  return <MyWeddings />;
}

export function App() {
  return (
    <WeddingProvider>
      <RouterView />
    </WeddingProvider>
  );
}

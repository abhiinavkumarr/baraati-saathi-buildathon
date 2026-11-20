import { useEffect, useState } from 'react';
import { Invite } from './pages/Invite.tsx';
import { Templates } from './pages/Templates.tsx';
import { Studio } from './pages/Studio.tsx';
import { Login } from './pages/Login.tsx';
import { MyWeddings } from './pages/MyWeddings.tsx';
import { NewWedding } from './pages/NewWedding.tsx';
import { WeddingShell, type SectionKey } from './pages/wedding/WeddingShell.tsx';
import { WeddingHome } from './pages/wedding/WeddingHome.tsx';
import { GuestsTab } from './pages/wedding/plan/GuestsTab.tsx';
import { VendorsTab } from './pages/wedding/plan/VendorsTab.tsx';
import { BudgetTab } from './pages/wedding/plan/BudgetTab.tsx';
import { TasksTab } from './pages/wedding/plan/TasksTab.tsx';
import { SheetsTab } from './pages/wedding/plan/SheetsTab.tsx';
import { RunsheetTab } from './pages/wedding/plan/RunsheetTab.tsx';
import { InviteTab } from './pages/wedding/app/InviteTab.tsx';
import { RsvpsTab } from './pages/wedding/app/RsvpsTab.tsx';
import { EventsTab } from './pages/wedding/app/EventsTab.tsx';
import { InfoTab } from './pages/wedding/app/InfoTab.tsx';
import { AnnouncementsTab } from './pages/wedding/app/AnnouncementsTab.tsx';
import { RoomsTab } from './pages/wedding/app/RoomsTab.tsx';
import { TravelTab } from './pages/wedding/app/TravelTab.tsx';
import { LogoTab } from './pages/wedding/studio/LogoTab.tsx';
import { MessagesTab } from './pages/wedding/studio/MessagesTab.tsx';
import { TeaserTab } from './pages/wedding/studio/TeaserTab.tsx';
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

  if (path === '/templates') return <Templates />;

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
    if (section === 'plan') {
      if (tab === 'guests') content = <GuestsTab slug={slug} />;
      else if (tab === 'vendors') content = <VendorsTab slug={slug} />;
      else if (tab === 'budget') content = <BudgetTab slug={slug} />;
      else if (tab === 'tasks') content = <TasksTab slug={slug} />;
      else if (tab === 'sheets') content = <SheetsTab slug={slug} />;
      else if (tab === 'runsheet') content = <RunsheetTab slug={slug} />;
      else {
        content = (
          <section className="card">
            <p className="eyebrow">Your Wedding</p>
            <h1 className="h2" style={{ margin: '0 0 8px' }}>{tab}</h1>
            <p className="muted">Choose a planning tab above.</p>
          </section>
        );
      }
    } else if (section === 'app') {
      if (tab === 'invite') content = <InviteTab slug={slug} />;
      else if (tab === 'rsvps') content = <RsvpsTab slug={slug} />;
      else if (tab === 'events') content = <EventsTab slug={slug} />;
      else if (tab === 'info') content = <InfoTab slug={slug} />;
      else if (tab === 'announcements') content = <AnnouncementsTab slug={slug} />;
      else if (tab === 'rooms') content = <RoomsTab slug={slug} />;
      else if (tab === 'travel') content = <TravelTab slug={slug} />;
    } else if (section === 'studio') {
      if (tab === 'invitation') content = <Studio slug={slug} tokenOverride={token} embedded />;
      else if (tab === 'logo') content = <LogoTab slug={slug} />;
      else if (tab === 'messages') content = <MessagesTab slug={slug} />;
      else if (tab === 'teaser') content = <TeaserTab slug={slug} />;
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

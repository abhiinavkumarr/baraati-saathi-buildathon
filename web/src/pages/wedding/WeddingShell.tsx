import type { ReactNode } from 'react';
import { navigate } from '../../App.tsx';
import { useWedding } from '../../WeddingContext.tsx';
import { AskSaathiDrawer } from '../../components/agent/AskSaathiDrawer.tsx';
import '../../planner.css';

export type SectionKey = 'home' | 'plan' | 'app' | 'studio';

const SUB_TABS: Record<Exclude<SectionKey, 'home'>, { id: string; label: string }[]> = {
  plan: [
    { id: 'guests', label: 'Guests' },
    { id: 'vendors', label: 'Vendors' },
    { id: 'budget', label: 'Budget' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'sheets', label: 'Sheets' },
    { id: 'runsheet', label: 'Run sheet' },
  ],
  app: [
    { id: 'invite', label: 'Invitation' },
    { id: 'rsvps', label: 'RSVPs' },
    { id: 'events', label: 'Events' },
    { id: 'info', label: 'Info' },
    { id: 'announcements', label: 'Announcements' },
    { id: 'rooms', label: 'Rooms' },
    { id: 'travel', label: 'Travel' },
  ],
  studio: [
    { id: 'invitation', label: 'Invitation' },
    { id: 'logo', label: 'Logo' },
    { id: 'messages', label: 'Messages' },
    { id: 'teaser', label: 'Song & teaser' },
  ],
};

export function WeddingShell({
  slug,
  section,
  tab,
  children,
}: {
  slug: string;
  section: SectionKey;
  tab?: string;
  children: ReactNode;
}) {
  const { session, weddings, getWeddingBySlug, getTokenForSlug, logout } = useWedding();
  const wedding = getWeddingBySlug(slug);
  const token = getTokenForSlug(slug);
  const couple = wedding?.couple || slug;
  const initials = couple
    .split('&')
    .map((s) => s.trim()[0])
    .filter(Boolean)
    .join('')
    .toUpperCase() || '✦';

  const unlockedWeddings = weddings.filter((w) => !w.locked);

  return (
    <div className="pl-shell">
      <header className="topbar">
        <div className="pl-shell-top">
          <div className="pl-shell-left">
            <button
              type="button"
              className="pl-couple-btn"
              onClick={() => navigate(`/w/${slug}`)}
              aria-label={`Go to ${couple} wedding home`}
            >
              {wedding?.logo_url ? (
                <img src={wedding.logo_url} alt="" className="pl-top-logo" />
              ) : (
                <span className="pl-top-initials" aria-hidden>{initials}</span>
              )}
              <span className="pl-top-couple">{couple}</span>
            </button>

            {unlockedWeddings.length > 1 ? (
              <label className="pl-switcher-wrap">
                <span className="sr-only">Switch wedding</span>
                <select
                  className="pl-switcher"
                  value={slug}
                  onChange={(e) => {
                    if (e.target.value === '__all__') navigate('/weddings');
                    else navigate(`/w/${e.target.value}`);
                  }}
                >
                  {unlockedWeddings.map((w) => (
                    <option key={w.slug} value={w.slug}>{w.couple}</option>
                  ))}
                  <option value="__all__">All weddings…</option>
                </select>
              </label>
            ) : (
              <button type="button" className="chip pl-all-chip" onClick={() => navigate('/weddings')}>
                All weddings
              </button>
            )}
          </div>

          <nav className="tabs pl-section-tabs" role="tablist" aria-label="Wedding sections">
            <button
              type="button"
              role="tab"
              aria-selected={section === 'plan'}
              onClick={() => navigate(`/w/${slug}/plan/guests`)}
            >
              Your Wedding
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === 'app'}
              onClick={() => navigate(`/w/${slug}/app/invite`)}
            >
              Baraati App
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === 'studio'}
              onClick={() => navigate(`/w/${slug}/studio/invitation`)}
            >
              AI Studio
            </button>
          </nav>

          <div className="pl-user-bar">
            {session?.user.name && <span className="pl-user-name muted small">{session.user.name}</span>}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                logout();
                navigate('/');
              }}
            >
              Sign out
            </button>
          </div>
        </div>

        {section !== 'home' && (
          <nav className="pl-subtabs-bar" aria-label="Section pages">
            <div className="pl-subtabs-inner">
              {SUB_TABS[section].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`chip ${tab === t.id ? 'on' : ''}`}
                  aria-current={tab === t.id ? 'page' : undefined}
                  onClick={() => navigate(`/w/${slug}/${section}/${t.id}`)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </nav>
        )}
      </header>

      <main className="pl-main">{children}</main>

      <AskSaathiDrawer slug={slug} token={token} />
    </div>
  );
}

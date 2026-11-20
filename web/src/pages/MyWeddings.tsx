import { useEffect, useState } from 'react';
import { navigate } from '../App.tsx';
import { useWedding } from '../WeddingContext.tsx';
import { fmtDate } from '../format.ts';
import '../planner.css';
import { PlusIcon } from '../components/icons.tsx';

export function MyWeddings() {
  const { session, weddings, loading, error, setPasscode, refreshWeddings, logout } = useWedding();
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({});
  const [unlockErr, setUnlockErr] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    if (!loading && session && weddings.length === 0 && !error) {
      navigate('/new');
    }
  }, [loading, session, weddings.length, error]);

  async function unlock(slug: string, e: React.FormEvent) {
    e.preventDefault();
    const code = (codeInputs[slug] || '').trim();
    if (!code) return;
    setUnlocking(true);
    setUnlockErr('');
    setPasscode(code);
    const updated = await refreshWeddings(code);
    const target = updated.find((w) => w.slug === slug);
    setUnlocking(false);
    if (!target || target.locked) {
      setUnlockErr('That passcode did not match.');
    } else {
      navigate(`/w/${slug}`);
    }
  }

  return (
    <div className="pl-page">
      <header className="topbar">
        <div className="pl-top-inner">
          <div className="brand" style={{ marginBottom: 0 }}>
            <span className="wordmark">Baraati</span> <span className="tag">Saathi</span>
          </div>
          <div className="pl-user-bar">
            <span className="muted small">{session?.user.name}</span>
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
      </header>

      <main className="pl-container">
        <div className="pl-head">
          <div>
            <p className="eyebrow">Your workspace</p>
            <h1 className="h2">My <span className="serif grad-text">weddings</span></h1>
          </div>
          <button type="button" className="btn btn-cta" onClick={() => navigate('/new')}>
            + Create a wedding
          </button>
        </div>

        {error && (
          <div className="card card-sm pl-err-box" role="alert">
            <span className="badge bad">Error</span>
            <p>{error}</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refreshWeddings()}>Retry</button>
          </div>
        )}

        {loading ? (
          <div className="pl-grid-cards">
            <div className="card pl-skeleton" />
            <div className="card pl-skeleton" />
          </div>
        ) : (
          <div className="pl-grid-cards">
            {weddings.map((w) =>
              w.locked ? (
                <article key={w.slug} className="card pl-wedding-card pl-locked-card">
                  <div className="pl-w-top">
                    <span className="pl-logo-fallback" aria-hidden>🔒</span>
                    <span className="badge warn">Private wedding</span>
                  </div>
                  <h2 className="h3">Protected wedding</h2>
                  <p className="muted small">Enter your owner passcode to unlock this wedding.</p>
                  <form className="pl-unlock-form" onSubmit={(e) => void unlock(w.slug, e)}>
                    <label className="sr-only" htmlFor={`pass-${w.slug}`}>Owner passcode</label>
                    <input
                      id={`pass-${w.slug}`}
                      type="password"
                      placeholder="Passcode"
                      value={codeInputs[w.slug] || ''}
                      onChange={(e) => setCodeInputs((m) => ({ ...m, [w.slug]: e.target.value }))}
                    />
                    <button type="submit" className="btn btn-primary btn-sm" disabled={unlocking}>
                      {unlocking ? 'Checking…' : 'Unlock'}
                    </button>
                  </form>
                  {unlockErr && <p className="small" style={{ color: 'var(--bad)', margin: '8px 0 0' }} role="alert">{unlockErr}</p>}
                </article>
              ) : (
                <button
                  key={w.slug}
                  type="button"
                  className="card card-hover pl-wedding-card"
                  onClick={() => navigate(`/w/${w.slug}`)}
                >
                  <div className="pl-w-top">
                    {w.logo_url ? (
                      <img src={w.logo_url} alt="" className="pl-logo-img" />
                    ) : (
                      <span className="pl-logo-fallback" aria-hidden>
                        {(w.couple || 'W').split('&').map((s) => s.trim()[0]).filter(Boolean).join('') || '✦'}
                      </span>
                    )}
                    {w.private && <span className="badge">Private</span>}
                    {w.demo && <span className="badge ai">Demo · view only</span>}
                  </div>
                  <h2 className="h3">{w.couple}</h2>
                  <p className="muted small">
                    {[
                      w.first_date ? fmtDate(w.first_date, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Dates TBD',
                      w.city || '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {w.days != null && w.days >= 0 && (
                    <div className="pl-w-days">
                      <span className="num">{w.days}</span>
                      <span className="muted tiny">days to go</span>
                    </div>
                  )}
                </button>
              ),
            )}

            <button
              type="button"
              className="card card-hover pl-wedding-card pl-new-card"
              onClick={() => navigate('/new')}
            >
              <span className="pl-new-plus" aria-hidden><PlusIcon size={22} /></span>
              <h2 className="h3">Create a wedding</h2>
              <p className="muted small">Set up your couple details, venue and ceremonies in 3 steps, or upload a card.</p>
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

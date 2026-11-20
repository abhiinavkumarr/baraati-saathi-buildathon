import { useState } from 'react';
import { post, type StoredSession, type WeddingDraft } from '../api.ts';
import { navigate } from '../App.tsx';
import { useWedding } from '../WeddingContext.tsx';
import '../workspace.css';

export interface UserSession {
  name: string;
  contact: string;
  role: 'Couple' | 'Family Host' | 'Wedding Planner';
}

export interface ActiveWedding {
  slug: string;
  host_token: string;
}

export { SAMPLE_DRAFT } from '../sampleDraft.ts';
import { SAMPLE_DRAFT } from '../sampleDraft.ts';

export async function createSampleWedding(sessionToken?: string): Promise<ActiveWedding> {
  const r = await post<ActiveWedding>(
    '/api/weddings',
    {
      draft: SAMPLE_DRAFT,
      host_side: 'bride',
      expected_guests: 180,
      hashtag: '#MeeraRohan2027',
    },
    sessionToken,
  );
  await post(`/api/host/${r.slug}/seed-sample`, { t: r.host_token }, sessionToken).catch(() => {});
  return r;
}

export function Login() {
  const { setSession, refreshWeddings } = useWedding();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function enter(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const s = await post<StoredSession>('/api/login', { name: name.trim(), contact: contact.trim() });
      setSession(s);
      const list = await refreshWeddings(undefined, s);
      navigate(list.length === 0 ? '/new' : '/weddings');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-wrap">
        <section className="login-intro">
          <div className="brand">
            <span className="wordmark">Baraati</span> <span className="tag">Saathi</span>
          </div>
          <p className="eyebrow">AI Wedding Planner</p>
          <h1 className="display">Your wedding&apos;s <span className="serif grad-text">Saathi</span></h1>
          <p className="lead login-lead">
            Plan guests, vendors, budget and tasks in one place, run your living invitation and
            voice concierge, and create art and messages with Google AI.
          </p>
          <ul className="login-highlights">
            <li><span><b>Your Wedding:</b> Guests, vendors, budget, payments, tasks and sheets in one back office.</span></li>
            <li><span><b>Baraati App:</b> Living invitation, RSVPs, bilingual announcements, rooms and travel pickups.</span></li>
            <li><span><b>AI Studio &amp; Ask Saathi:</b> Card art, logos, WhatsApp drafts, and an AI agent you approve.</span></li>
          </ul>
          <p className="login-guest-link">
            Every account opens with Meera &amp; Rohan&apos;s demo wedding and a guided tour of the Google AI inside.
          </p>
        </section>

        <div className="login-card-wrap">
          <section className="card glass login-card" aria-labelledby="login-h">
            <span className="badge ai">✦ No password needed</span>
            <h2 id="login-h">Sign in to your weddings</h2>
            <p className="muted small">Enter your name and phone number or email to see your weddings or start a new one.</p>

            <form onSubmit={(e) => void enter(e)} className="login-form">
              <label>
                Your name
                <input
                  type="text"
                  autoComplete="name"
                  required
                  placeholder="e.g. Ananya Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>

              <label>
                Phone or email
                <input
                  type="text"
                  required
                  placeholder="e.g. 98765 43210 or ananya@email.com"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
              </label>

              {error && <p className="error" role="alert">{error}</p>}

              <button type="submit" className="btn btn-cta login-full" disabled={busy}>
                {busy ? 'Signing in…' : 'Continue →'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}

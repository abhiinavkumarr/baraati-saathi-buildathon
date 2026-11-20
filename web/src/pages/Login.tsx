import { useEffect, useState } from 'react';
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

export const SAMPLE_DRAFT: WeddingDraft = {
  partner1_name: 'Meera',
  partner2_name: 'Rohan',
  partner1_family: 'Daughter of Sunita & Rajesh Verma',
  partner2_family: 'Son of Kavita & Anil Malhotra',
  invite_line: 'With the blessings of our elders, we joyfully invite you to celebrate our union.',
  city: 'Jaipur',
  tradition: 'North Indian',
  language: 'English & Hindi',
  style: 'royal-rajasthani',
  events: [
    {
      name: 'Haldi',
      date: '2027-02-11',
      start_time: '11:00',
      venue_name: 'Rambagh Courtyard',
      venue_address: 'Bhawani Singh Road, Jaipur',
      dress_code: 'Shades of yellow & marigold',
      notes: 'Followed by traditional Rajasthani lunch.',
    },
    {
      name: 'Mehendi & Sangeet',
      date: '2027-02-11',
      start_time: '18:30',
      venue_name: 'Jaigarh Lawns',
      venue_address: 'Amer Road, Jaipur',
      dress_code: 'Festive Indo-Western',
      notes: 'Family performances start at 8:00 PM.',
    },
    {
      name: 'Baraat & Pheras',
      date: '2027-02-12',
      start_time: '17:00',
      venue_name: 'City Palace Gardens',
      venue_address: 'Tulsi Marg, Jaipur',
      dress_code: 'Traditional Indian ethnic',
      notes: 'Baraat assembly at the main gate at 5:00 PM.',
    },
    {
      name: 'Reception',
      date: '2027-02-13',
      start_time: '19:30',
      venue_name: 'Sawai Man Mahal',
      venue_address: 'Bhawani Singh Road, Jaipur',
      dress_code: 'Formal Indian or Western',
      notes: 'Valet parking available at the main porch.',
    },
  ],
  info: [
    { question: 'Is there airport pickup?', answer: 'Yes — share your flight details in the RSVP and our hospitality desk will arrange a cab.' },
    { question: 'Is Jain food available?', answer: 'Yes, a dedicated Jain counter is arranged at every ceremony.' },
    { question: 'Is parking available?', answer: 'Complimentary valet parking is available at all venues.' },
  ],
  contact_name: 'Rohan Malhotra',
  contact_phone: '',
};

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
  return r;
}

export function Login() {
  const { setSession, refreshWeddings } = useWedding();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demoSlug, setDemoSlug] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((h) => setDemoSlug(h.demo ?? null)).catch(() => {});
  }, []);

  async function enter(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const s = await post<StoredSession>('/api/login', { name: name.trim(), contact: contact.trim() });
      setSession(s);
      navigate('/weddings');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
      setBusy(false);
    }
  }

  async function enterSample() {
    setBusy(true);
    setError('');
    try {
      const rand = Math.random().toString(36).slice(2, 8);
      const s = await post<StoredSession>('/api/login', {
        name: name.trim() || 'Meera & Rohan',
        contact: `sample-${rand}@baraati.demo`,
      });
      setSession(s);
      const w = await createSampleWedding(s.session);
      await refreshWeddings();
      navigate(`/w/${w.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create sample wedding.');
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
          {demoSlug && (
            <p className="login-guest-link">
              Want to see the guest view first? <a href={`/i/${demoSlug}`} target="_blank" rel="noreferrer">Open sample guest invitation ↗</a>
            </p>
          )}
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
              <button type="button" className="btn btn-outline login-full" disabled={busy} onClick={() => void enterSample()}>
                {busy ? 'Setting up sample wedding…' : 'Try the sample wedding'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}

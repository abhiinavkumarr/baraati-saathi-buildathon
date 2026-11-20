import { useEffect, useState } from 'react';
import { post, type WeddingDraft } from '../api.ts';
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

const SAMPLE_DRAFT: WeddingDraft = {
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

const ROLES: UserSession['role'][] = ['Couple', 'Family Host', 'Wedding Planner'];

export async function createSampleWedding(): Promise<ActiveWedding> {
  const r = await post<ActiveWedding>('/api/weddings', { draft: SAMPLE_DRAFT });
  try {
    localStorage.setItem(`host:${r.slug}`, r.host_token);
    localStorage.setItem('saathi:active_wedding', JSON.stringify(r));
  } catch {
    /* ignore storage errors */
  }
  return r;
}

export function Login({ onLogin }: { onLogin: (session: UserSession, wedding?: ActiveWedding) => void }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<UserSession['role']>('Couple');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demoSlug, setDemoSlug] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((h) => setDemoSlug(h.demo ?? null)).catch(() => {});
  }, []);

  function enter(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = name.trim() || 'Wedding Host';
    onLogin({ name: cleanName, contact: contact.trim(), role });
  }

  async function enterSample() {
    setBusy(true);
    setError('');
    try {
      const w = await createSampleWedding();
      onLogin({ name: name.trim() || 'Meera & Rohan', contact: contact.trim(), role }, w);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create sample workspace.');
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
          <p className="eyebrow">AI Wedding Planning Workspace</p>
          <h1 className="display">Plan the whole <span className="serif grad-text">shaadi</span> in one place.</h1>
          <p className="lead login-lead">
            From your first ceremony schedule and AI-designed invitations to RSVPs, travel tickets,
            guest voice concierge, checklist and budget — powered by Gemini and AlloyDB.
          </p>
          <ul className="login-highlights">
            <li><span><b>AI Control Room:</b> Update ceremonies, query your guest list, and draft Hindi + English WhatsApp reminders.</span></li>
            <li><span><b>Invitation Studio:</b> Turn a card photo or chat into moving regional art (Nano Banana) and music (Lyria).</span></li>
            <li><span><b>Guest Logistics:</b> Parse flight/train tickets from RSVPs, track pickups, dietary needs, and checklist &amp; budget.</span></li>
          </ul>
          {demoSlug && (
            <p className="login-guest-link">
              Want to see the guest view first? <a href={`/i/${demoSlug}`} target="_blank" rel="noreferrer">Open sample guest invitation ↗</a>
            </p>
          )}
        </section>

        <div className="login-card-wrap">
          <section className="card glass login-card" aria-labelledby="login-h">
            <span className="badge warn">Hackathon Preview · No password needed</span>
            <h2 id="login-h">Sign in to your workspace</h2>
            <p className="muted small">Enter a name to jump straight in. Phone OTP &amp; Google Sign-In will be added for production.</p>

            <form onSubmit={enter} className="login-form">
              <label>
                Your name
                <input
                  type="text"
                  autoComplete="name"
                  placeholder="e.g. Ananya Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>

              <label>
                Phone or email <span className="muted">(optional)</span>
                <input
                  type="text"
                  placeholder="e.g. +91 98765 43210 or ananya@email.com"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
              </label>

              <div className="login-roles" role="group" aria-label="Your role">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`chip ${role === r ? 'on' : ''}`}
                    aria-pressed={role === r}
                    onClick={() => setRole(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {error && <p className="error" role="alert">{error}</p>}

              <button type="submit" className="btn btn-cta login-full" disabled={busy}>
                Enter Wedding Workspace →
              </button>
              <button type="button" className="btn btn-outline login-full" disabled={busy} onClick={() => void enterSample()}>
                {busy ? 'Setting up sample wedding…' : 'Launch with Sample Wedding (Meera & Rohan)'}
              </button>
            </form>

            <p className="login-auth-note">
              Authentication is intentionally skipped for this hackathon demo so you can explore every tool in one click.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

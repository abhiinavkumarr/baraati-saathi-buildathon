import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { post } from '../api.ts';
import { navigate } from '../App.tsx';
import { askSaathi, useWedding } from '../WeddingContext.tsx';

/**
 * Step-by-step tour of where Google's models and tools are used, shown inside
 * the shared demo wedding. Each step opens the page it talks about, outlines
 * the feature, and (where it saves nothing) offers a live "Try it" call.
 */

type Demo = 'agent' | 'ask' | 'import' | 'checklist' | 'messages' | 'art' | 'music' | 'live' | 'skills';

interface Step {
  title: string;
  tags: string[];
  /** Path under /w/:slug ('' = wedding home). */
  where: string;
  /** Button or heading to outline: [selector, text it contains]. */
  target?: [string, string];
  body: ReactNode;
  demo?: Demo;
  demoLabel?: string;
}

const STEPS: Step[] = [
  {
    title: 'How Baraati Saathi uses Google AI',
    tags: ['Gemini', 'Gemini Live', 'Nano Banana', 'Lyria', 'Agent Skills', 'Google AI Studio', 'Google Antigravity', 'Google Cloud'],
    where: '',
    body: (
      <>
        <p>This tour walks through Meera &amp; Rohan&apos;s demo wedding and stops wherever a Google model or tool does the work.</p>
        <ul>
          <li><b>Gemini</b> plans, reads, writes and answers (via the Gemini API&apos;s Interactions API).</li>
          <li><b>Gemini Live</b> is the guests&apos; Hindi/English voice concierge.</li>
          <li><b>Nano Banana</b> paints the invitation, ceremony scenes and logo; <b>Lyria</b> composes the music.</li>
          <li>Everything runs on <b>Google Cloud</b>: Cloud Run and AlloyDB.</li>
        </ul>
        <p className="muted">Where a step says <b>Try it live</b>, the call goes to Gemini right now. The demo saves nothing.</p>
      </>
    ),
  },
  {
    title: "Today's briefing",
    tags: ['Gemini'],
    where: '',
    target: ['h2, h3', 'briefing'],
    body: <p>Gemini reads the wedding&apos;s live numbers (RSVPs, dues, overdue tasks, arrivals with no cab) and writes the host a short morning briefing with the next three things to do.</p>,
  },
  {
    title: 'Ask Saathi, the planning agent',
    tags: ['Gemini function calling', 'Agent Skills'],
    where: '',
    target: ['button', 'Ask Saathi'],
    body: (
      <p>
        One agent on every page, by text or voice. Gemini chooses among 12 tools (look up guests, budget, tasks; propose reminders,
        rooming, cab pairs, payments) guided by the <code>host-control-room</code> Agent Skill. It only <b>proposes</b> cards;
        nothing changes until the host taps Apply.
      </p>
    ),
    demo: 'agent',
    demoLabel: 'Ask: “How much do we still owe vendors?”',
  },
  {
    title: 'Ask your guest list',
    tags: ['Gemini text-to-SQL', 'AlloyDB'],
    where: '/app/rsvps',
    body: (
      <p>
        Plain-English questions become SQL written by Gemini. It runs on AlloyDB as a no-privilege database role, over a temporary
        copy of this one wedding&apos;s data, inside a transaction that is always rolled back. Phone numbers are never in that copy.
      </p>
    ),
    demo: 'ask',
    demoLabel: 'Ask: “How many people are coming from each side?”',
  },
  {
    title: 'Import a guest list from anything',
    tags: ['Gemini multimodal'],
    where: '/plan/guests',
    target: ['button', 'Import list'],
    body: (
      <p>
        Excel and Google Sheets are mapped in the browser. A messy WhatsApp paste, a photo of a handwritten list or a voice note
        goes to Gemini, which returns households, side, group and party size. Phone numbers are stripped before Gemini sees anything.
      </p>
    ),
    demo: 'import',
    demoLabel: 'Read a messy WhatsApp list',
  },
  {
    title: 'Make my checklist · Speak tasks',
    tags: ['Gemini', 'Agent Skills', 'Gemini audio'],
    where: '/plan/tasks',
    target: ['button', 'Make my checklist'],
    body: (
      <p>
        Gemini works backwards from each ceremony date to a dated checklist, using the <code>wedding-planner</code> Agent Skill.
        With <b>Speak tasks</b> the host says “Book the DJ by 10 Jan, ask Riya to finalise the menu” and Gemini hears the audio
        directly and returns dated tasks with an owner.
      </p>
    ),
    demo: 'checklist',
    demoLabel: 'Draft a checklist for this wedding',
  },
  {
    title: 'Vendor quote reader',
    tags: ['Gemini vision'],
    where: '/plan/vendors',
    body: <p>Drop a vendor&apos;s quote (PDF or a photo). Gemini pulls out the vendor, category, total, payment milestones and cancellation terms, and proposes the vendor, its payments and follow-up tasks for the host to approve.</p>,
  },
  {
    title: 'Sheets by voice',
    tags: ['Gemini audio', 'Structured output'],
    where: '/plan/sheets',
    target: ['button', 'Speak'],
    body: <p>Say “Sangeet song list with dancers and song length” and Gemini designs the columns and starter rows of a spreadsheet the family can edit together.</p>,
  },
  {
    title: 'Invitation art, ceremony scenes and logo',
    tags: ['Nano Banana'],
    where: '/studio/invitation',
    body: (
      <p>
        Nano Banana paints the card in the chosen regional style, a scene for each ceremony, a monogram logo, and (from the couple&apos;s
        photo) a miniature-style illustration. The art below was made for the Riya &amp; Kabir sample invitation.
      </p>
    ),
    demo: 'art',
    demoLabel: 'Show Nano Banana art',
  },
  {
    title: 'Invitation music and video teaser',
    tags: ['Lyria'],
    where: '/studio/teaser',
    body: <p>Lyria composes a 30-second instrumental theme to match the style (shehnai and dholak for Rajasthani, nadaswaram for a temple wedding). The teaser turns the art and music into a short video in the browser.</p>,
    demo: 'music',
    demoLabel: 'Play the Lyria theme',
  },
  {
    title: 'WhatsApp message writer',
    tags: ['Gemini'],
    where: '/studio/messages',
    body: <p>Invites, reminders and thank-yous in English, Hindi or Hinglish, warm, formal, filmi or shayari, written from the wedding&apos;s real details. Each guest then gets a personal link.</p>,
    demo: 'messages',
    demoLabel: 'Write a Hinglish shayari invite',
  },
  {
    title: 'Announcements in English and Hindi',
    tags: ['Gemini'],
    where: '/app/announcements',
    body: <p>The host types or says one update (“Haldi moves to 11 am”); the agent writes it in English and Devanagari Hindi and picks the audience, all guests, only those coming, or those who need a pickup.</p>,
  },
  {
    title: 'Saathi, the guests’ voice concierge',
    tags: ['Gemini Live', 'Function calling'],
    where: '/app/invite',
    body: (
      <p>
        On the invitation, guests ask by voice in Hindi or English: “Mehendi kab hai?”, “Is there Jain food?”, “Send a cab for my
        flight”. Gemini Live answers in real time and calls tools on the server to look things up, RSVP or log a pickup. Each
        session uses a short-lived, single-use token, so the API key never reaches the phone.
      </p>
    ),
    demo: 'live',
    demoLabel: 'Open the guest invitation',
  },
  {
    title: 'Under the hood',
    tags: ['Agent Skills', 'Google AI Studio', 'Google Antigravity', 'Cloud Run', 'AlloyDB', 'Secret Manager'],
    where: '',
    body: (
      <ul>
        <li><b>Agent Skills</b>: six <code>SKILL.md</code> files the agents load at runtime (below).</li>
        <li><b>Google AI Studio</b>: the Gemini API key and model testing.</li>
        <li><b>Google Antigravity</b>: the IDE the product was built in, with Gemini as the coding agent.</li>
        <li><b>Google Cloud</b>: Cloud Run in Mumbai (asia-south1), AlloyDB for PostgreSQL, Secret Manager for keys, Cloud Build.</li>
      </ul>
    ),
    demo: 'skills',
    demoLabel: 'List the Agent Skills',
  },
];

const SAMPLE_PASTE = `Sharma ji family (4) - ladki wale
Rohan + Priya college frnds 98765 43210
Nani ji, Mama ji & Mami ji - bride side
Office: Kavya, Arjun, Neha
Gupta uncle (2) groom side`;

const SEEN_KEY = 'saathi:tour-seen';

export function startGoogleAiTour() {
  window.dispatchEvent(new CustomEvent('saathi:tour'));
}

export function GoogleAiTour({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem(SEEN_KEY);
    } catch {
      return false;
    }
  });
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReactNode>(null);
  const panel = useRef<HTMLDivElement>(null);
  const step = STEPS[i];

  const close = useCallback(() => {
    setOpen(false);
    document.querySelectorAll('.tour-hl').forEach((e) => e.classList.remove('tour-hl'));
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onStart = () => {
      setI(0);
      setOpen(true);
    };
    window.addEventListener('saathi:tour', onStart);
    return () => window.removeEventListener('saathi:tour', onStart);
  }, []);

  // Go to the step's page and outline the feature it describes.
  useEffect(() => {
    if (!open) return;
    setResult(null);
    const path = `/w/${slug}${step.where}`;
    if (location.pathname !== path) navigate(path);
    const timer = window.setTimeout(() => {
      document.querySelectorAll('.tour-hl').forEach((e) => e.classList.remove('tour-hl'));
      if (!step.target) return;
      const [sel, text] = step.target;
      const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.toLowerCase().includes(text.toLowerCase()));
      if (el) {
        el.classList.add('tour-hl');
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 450);
    panel.current?.querySelector('h2')?.focus();
    return () => window.clearTimeout(timer);
  }, [open, i, slug, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  async function runDemo(kind: Demo) {
    setBusy(true);
    setResult(null);
    try {
      if (kind === 'agent') {
        askSaathi('How much do we still owe vendors, and what is due this week?');
        setResult(<p className="muted">Ask Saathi opened on the right with the question. Gemini is choosing its tools…</p>);
      } else if (kind === 'ask') {
        const r = await post<{ answer: string; sql: string; db: string; rows: unknown[] }>(`/api/host/${slug}/ask`, {
          t: token,
          question: 'How many people are coming from the bride side and the groom side?',
        });
        setResult(
          <>
            <p>{r.answer}</p>
            {r.sql && (
              <details>
                <summary>SQL Gemini wrote (ran on {r.db === 'alloydb' ? 'AlloyDB' : r.db})</summary>
                <pre>{r.sql}</pre>
              </details>
            )}
          </>,
        );
      } else if (kind === 'import') {
        const r = await post<{ guests: { name: string; party_size: number; side: string; group_name: string }[] }>(
          `/api/host/${slug}/guests/import-preview`,
          { t: token, text: SAMPLE_PASTE },
        );
        setResult(
          <>
            <pre className="tour-quote">{SAMPLE_PASTE}</pre>
            <p className="small">Gemini read it as (the phone number was removed before sending):</p>
            <ul>{r.guests.map((g) => <li key={g.name}><b>{g.name}</b> · {g.party_size} · {g.side || 'side?'}{g.group_name ? ` · ${g.group_name}` : ''}</li>)}</ul>
          </>,
        );
      } else if (kind === 'checklist') {
        const r = await post<{ tasks: { title: string; due_date: string | null; ceremony: string }[] }>(`/api/host/${slug}/tasks/suggest`, { t: token });
        setResult(
          <ul>
            {r.tasks.slice(0, 7).map((t) => <li key={t.title}><b>{t.due_date ?? 'Anytime'}</b> · {t.title}{t.ceremony ? ` (${t.ceremony})` : ''}</li>)}
            {r.tasks.length > 7 && <li className="muted">…and {r.tasks.length - 7} more</li>}
          </ul>,
        );
      } else if (kind === 'messages') {
        const r = await post<{ variants: { text: string }[] }>(`/api/host/${slug}/messages`, { t: token, kind: 'invite', language: 'Hinglish', tone: 'shayari' });
        setResult(<pre className="tour-quote">{r.variants[0]?.text}</pre>);
      } else if (kind === 'art' || kind === 'music') {
        const h = await (await fetch('/api/health')).json();
        const w = await (await fetch(`/api/weddings/${h.demo}`)).json();
        const a = w.assets ?? {};
        if (kind === 'art') {
          const ids: [string, string][] = [
            ...(a.card_art ? [['Card artwork', a.card_art] as [string, string]] : []),
            ...Object.entries((a.events ?? {}) as Record<string, string>).slice(0, 3),
          ];
          setResult(
            ids.length ? (
              <div className="tour-art">
                {ids.map(([label, id]) => (
                  <figure key={id}><img src={`/api/assets/${id}`} alt={`Nano Banana art: ${label}`} /><figcaption>{label}</figcaption></figure>
                ))}
              </div>
            ) : <p className="muted">No artwork has been generated on the sample invitation yet.</p>,
          );
        } else {
          setResult(a.music ? <audio controls autoPlay src={`/api/assets/${a.music}`} /> : <p className="muted">No Lyria theme on the sample invitation yet.</p>);
        }
      } else if (kind === 'live') {
        window.open(`/i/${slug}`, '_blank', 'noopener');
        setResult(<p className="muted">The invitation opened in a new tab. Open it, tap <b>Ask Saathi</b>, then the mic, and ask in Hindi or English.</p>);
      } else if (kind === 'skills') {
        const h = await (await fetch('/api/health')).json();
        setResult(<div className="tour-tags">{(h.skills as string[]).map((s) => <code key={s}>{s}</code>)}</div>);
      }
    } catch (e) {
      setResult(<p className="tour-err">{e instanceof Error ? e.message : 'That did not work just now.'}</p>);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="tour-launch" onClick={() => setOpen(true)}>
        ✦ Google AI tour
      </button>
    );
  }

  return (
    <div className="tour" ref={panel} role="dialog" aria-modal="false" aria-labelledby="tour-title">
      <div className="tour-top">
        <span className="tour-count">Google AI tour · {i + 1} / {STEPS.length}</span>
        <button type="button" className="tour-x" aria-label="Close the tour" onClick={close}>✕</button>
      </div>
      <h2 id="tour-title" tabIndex={-1}>{step.title}</h2>
      <div className="tour-tags">{step.tags.map((t) => <span key={t} className="tour-tag">{t}</span>)}</div>
      <div className="tour-body">{step.body}</div>
      {step.demo && (
        <div className="tour-demo">
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => void runDemo(step.demo!)}>
            {busy ? 'Working…' : `▶ Try it live · ${step.demoLabel}`}
          </button>
          <div className="tour-result" aria-live="polite">{result}</div>
        </div>
      )}
      <div className="tour-progress" aria-hidden>
        {STEPS.map((_, n) => <span key={n} className={n === i ? 'on' : n < i ? 'done' : ''} />)}
      </div>
      <div className="tour-nav">
        <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => setI(i - 1)}>← Back</button>
        {i < STEPS.length - 1 ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setI(i + 1)}>Next →</button>
        ) : (
          <button type="button" className="btn btn-cta btn-sm" onClick={close}>Finish tour</button>
        )}
      </div>
    </div>
  );
}

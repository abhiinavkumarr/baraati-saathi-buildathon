import { useCallback, useEffect, useMemo, useState } from 'react';
import { post } from '../../../api.ts';
import { useWedding } from '../../../WeddingContext.tsx';
import type { GuestItem } from '../plan/GuestsTab.tsx';

const KINDS = [
  ['invite', 'Wedding invite'],
  ['save-the-date', 'Save the date'],
  ['reminder', 'RSVP reminder'],
  ['thank-you', 'Thank you'],
  ['announcement', 'Announcement'],
] as const;

const LANGUAGES = ['Hinglish', 'English', 'Hindi'] as const;
const TONES = ['warm', 'formal', 'shayari', 'filmi', 'funny'] as const;

export function MessagesTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [kind, setKind] = useState<string>('invite');
  const [language, setLanguage] = useState<string>('Hinglish');
  const [tone, setTone] = useState<string>('warm');
  const [extra, setExtra] = useState('');
  const [variants, setVariants] = useState<{ text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const [sendIdx, setSendIdx] = useState<number | null>(null);
  const [guests, setGuests] = useState<GuestItem[]>([]);
  const [groupFilter, setGroupFilter] = useState('all');

  const loadGuests = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/host/${slug}/guests?t=${encodeURIComponent(token)}`);
    if (r.ok) {
      const j = await r.json();
      setGuests(j.guests ?? []);
    }
  }, [slug, token]);

  useEffect(() => {
    void loadGuests();
  }, [loadGuests]);

  const groups = useMemo(() => [...new Set(guests.map((g) => g.group_name).filter(Boolean))].sort(), [guests]);
  const targetGuests = useMemo(
    () => (groupFilter === 'all' ? guests : guests.filter((g) => g.group_name === groupFilter)),
    [guests, groupFilter],
  );

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSendIdx(null);
    try {
      const r = await post<{ variants: { text: string }[] }>(`/api/host/${slug}/messages`, {
        t: token,
        kind,
        language,
        tone,
        extra: extra.trim(),
      });
      setVariants(r.variants ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write messages.');
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string, idx: number) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1800);
    });
  }

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">AI Studio</p>
          <h1 className="h2">WhatsApp <span className="serif">message writer</span></h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Gemini writes 3 ready-to-send variants with your venue, dates and invite link — without ever seeing guest phone numbers.
          </p>
        </div>
      </div>

      {error && <div className="card card-sm pl-err-box" role="alert"><span className="badge bad">Error</span><p>{error}</p></div>}

      <form className="card card-sm pl-form-stack" style={{ marginTop: 0 }} onSubmit={(e) => void generate(e)}>
        <div>
          <span className="pl-field-label">Message type</span>
          <div className="pl-chip-row" role="group" aria-label="Message type">
            {KINDS.map(([id, label]) => (
              <button key={id} type="button" className={`chip ${kind === id ? 'on' : ''}`} aria-pressed={kind === id} onClick={() => setKind(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="pl-form-row">
          <div>
            <span className="pl-field-label">Language</span>
            <div className="pl-chip-row" role="group" aria-label="Language">
              {LANGUAGES.map((l) => (
                <button key={l} type="button" className={`chip ${language === l ? 'on' : ''}`} aria-pressed={language === l} onClick={() => setLanguage(l)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="pl-field-label">Tone</span>
            <div className="pl-chip-row" role="group" aria-label="Tone">
              {TONES.map((t) => (
                <button key={t} type="button" className={`chip ${tone === t ? 'on' : ''}`} aria-pressed={tone === t} onClick={() => setTone(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label>
          Anything extra to mention <span className="muted">(optional)</span>
          <input
            type="text"
            placeholder="e.g. Mention yellow dress code for Haldi and RSVP by Sunday"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          />
        </label>

        <div>
          <button type="submit" className="btn btn-cta" disabled={busy}>
            {busy ? 'Writing 3 variants…' : '✦ Write 3 WhatsApp messages'}
          </button>
        </div>
      </form>

      {variants.length > 0 && (
        <div className="pl-grid-3">
          {variants.map((v, idx) => (
            <article key={idx} className="card card-sm pl-msg-card">
              <div className="pl-vc-top">
                <span className="badge ai">✦ Option {idx + 1}</span>
                <span className="muted tiny">{v.text.length} chars</span>
              </div>
              <p className="small pl-msg-body" lang={language === 'Hindi' ? 'hi' : undefined}>{v.text}</p>
              <div className="pl-row-btns" style={{ marginTop: 'auto' }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => copy(v.text, idx)}>
                  {copiedIdx === idx ? 'Copied ✓' : 'Copy'}
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setSendIdx(sendIdx === idx ? null : idx)}>
                  Send to guests…
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {sendIdx !== null && variants[sendIdx] && (
        <section className="card card-sm">
          <div className="pl-head" style={{ marginBottom: 12 }}>
            <div>
              <p className="eyebrow">Personalised send</p>
              <h2 className="h3" style={{ margin: 0 }}>Option {sendIdx + 1} — pick guests</h2>
            </div>
            {groups.length > 0 && (
              <div className="pl-chip-row">
                <button type="button" className={`chip ${groupFilter === 'all' ? 'on' : ''}`} onClick={() => setGroupFilter('all')}>All ({guests.length})</button>
                {groups.map((g) => (
                  <button key={g} type="button" className={`chip ${groupFilter === g ? 'on' : ''}`} onClick={() => setGroupFilter(g)}>{g}</button>
                ))}
              </div>
            )}
          </div>
          <ul className="pl-pay-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {targetGuests.map((g) => {
              const filled = variants[sendIdx].text.replace(/\{name\}/gi, g.name);
              const waHref = g.wa_url
                ? `${g.wa_url.split('?')[0]}?text=${encodeURIComponent(filled)}`
                : `https://wa.me/?text=${encodeURIComponent(filled)}`;
              return (
                <li key={g.id}>
                  <div>
                    <b>{g.name}</b> <small className="muted">{g.phone_masked || 'open WhatsApp & pick contact'}</small>
                  </div>
                  <div className="pl-row-btns">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard.writeText(filled)}>
                      Copy
                    </button>
                    <a className="btn btn-outline btn-sm" href={waHref} target="_blank" rel="noreferrer">
                      WhatsApp ↗
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

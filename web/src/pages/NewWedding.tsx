import { useState } from 'react';
import { fileToAttachment, post, type Attachment, type WeddingDraft } from '../api.ts';
import { navigate } from '../App.tsx';
import { useWedding } from '../WeddingContext.tsx';
import { ornamentUrl } from '../themes.ts';
import { Create } from './Create.tsx';
import '../planner.css';

const INDIAN_CITIES = [
  'Mumbai', 'Delhi', 'New Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune',
  'Jaipur', 'Udaipur', 'Jodhpur', 'Jaisalmer', 'Ahmedabad', 'Surat', 'Vadodara', 'Goa',
  'Chandigarh', 'Amritsar', 'Ludhiana', 'Lucknow', 'Kanpur', 'Agra', 'Varanasi', 'Noida',
  'Gurugram', 'Indore', 'Bhopal', 'Nagpur', 'Nashik', 'Kochi', 'Thiruvananthapuram',
  'Coimbatore', 'Mysuru', 'Mangaluru', 'Visakhapatnam', 'Patna', 'Ranchi', 'Bhubaneswar',
  'Guwahati', 'Dehradun', 'Mussoorie', 'Shimla', 'Rishikesh', 'Jim Corbett',
];

const CEREMONY_PRESETS = ['Mehendi', 'Haldi', 'Sangeet', 'Baraat', 'Varmala', 'Wedding', 'Reception'] as const;

const DEFAULT_TIMES: Record<string, string> = {
  Mehendi: '15:00',
  Haldi: '10:00',
  Sangeet: '19:00',
  Baraat: '18:00',
  Varmala: '20:00',
  Wedding: '21:00',
  Reception: '19:30',
};

const STYLE_TILES: [string, string, string][] = [
  ['royal-rajasthani', 'Royal Rajasthani', 'Arches, peacocks, maroon and gold'],
  ['south-indian-temple', 'South Indian temple', 'Gopurams, brass lamps, jasmine'],
  ['bengali-alpana', 'Bengali alpana', 'Rice-paste patterns, red and white'],
  ['punjabi-phulkari', 'Punjabi phulkari', 'Embroidery, marigolds, magenta'],
  ['minimal-pastel', 'Minimal pastel', 'Fine-line florals, blush and sage'],
  ['modern-floral', 'Modern floral', 'Watercolour roses, gold foil'],
];

interface DayPlan {
  date: string;
  ceremonies: string[];
  customInput: string;
}

function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

function addDaysIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function NewWedding() {
  const { session, refreshWeddings } = useWedding();
  const [intakeMode, setIntakeMode] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: couple
  const [bride, setBride] = useState('');
  const [groom, setGroom] = useState('');
  const [hostSide, setHostSide] = useState<'bride' | 'groom' | 'planner' | ''>('');
  const [couplePhoto, setCouplePhoto] = useState<Attachment | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');

  // Step 2: venue & guests
  const [venueName, setVenueName] = useState('');
  const [city, setCity] = useState('');
  const [expectedGuests, setExpectedGuests] = useState('');

  // Step 3: days & style
  const [days, setDays] = useState<DayPlan[]>([
    { date: '', ceremonies: ['Wedding'], customInput: '' },
    { date: '', ceremonies: ['Reception'], customInput: '' },
  ]);
  const [style, setStyle] = useState('royal-rajasthani');
  const [extraDraft, setExtraDraft] = useState<Partial<WeddingDraft> | null>(null);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const today = todayIso();

  function applyIntakeDraft(d: WeddingDraft) {
    setBride(titleCase(d.partner1_name));
    setGroom(titleCase(d.partner2_name));
    setCity(d.city || '');
    const firstVenue = d.events.find((e) => e.venue_name)?.venue_name || '';
    setVenueName(firstVenue);
    if (d.style && STYLE_TILES.some(([id]) => id === d.style)) setStyle(d.style);

    // Group intake events by date (up to 4 days)
    const byDate = new Map<string, string[]>();
    for (const ev of d.events) {
      const key = ev.date || '';
      const arr = byDate.get(key) ?? [];
      if (!arr.includes(ev.name)) arr.push(ev.name);
      byDate.set(key, arr);
    }
    const builtDays: DayPlan[] = [...byDate.entries()]
      .sort(([a], [b]) => (a && b ? a.localeCompare(b) : a ? -1 : 1))
      .slice(0, 4)
      .map(([date, ceremonies]) => ({ date, ceremonies, customInput: '' }));
    if (builtDays.length > 0) setDays(builtDays);
    setExtraDraft(d);
    setIntakeMode(false);
    setStep(1);
    setError('');
  }

  async function onPhotoChange(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    const att = await fileToAttachment(f, f.name);
    setCouplePhoto(att);
    setPhotoPreview(`data:${att.mime_type};base64,${att.data}`);
  }

  function updateDayDate(idx: number, val: string) {
    setDays((prev) => {
      const next = prev.map((d) => ({ ...d }));
      next[idx].date = val;
      if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
        // Fill empty later days with consecutive dates
        let cursor = val;
        for (let j = idx + 1; j < next.length; j++) {
          cursor = addDaysIso(cursor, 1);
          if (!next[j].date) next[j].date = cursor;
        }
      }
      return next;
    });
  }

  function toggleCeremony(idx: number, name: string) {
    setDays((prev) =>
      prev.map((d, i) => {
        if (i !== idx) return d;
        const has = d.ceremonies.includes(name);
        return {
          ...d,
          ceremonies: has ? d.ceremonies.filter((c) => c !== name) : [...d.ceremonies, name],
        };
      }),
    );
  }

  function addCustomCeremony(idx: number) {
    setDays((prev) =>
      prev.map((d, i) => {
        if (i !== idx) return d;
        const clean = titleCase(d.customInput);
        if (!clean || d.ceremonies.includes(clean)) return { ...d, customInput: '' };
        return { ...d, ceremonies: [...d.ceremonies, clean], customInput: '' };
      }),
    );
  }

  function addDay() {
    if (days.length >= 4) return;
    const lastDate = days[days.length - 1]?.date;
    const nextDate = lastDate && /^\d{4}-\d{2}-\d{2}$/.test(lastDate) ? addDaysIso(lastDate, 1) : '';
    setDays((prev) => [...prev, { date: nextDate, ceremonies: [], customInput: '' }]);
  }

  function removeDay(idx: number) {
    if (days.length <= 1) return;
    setDays((prev) => prev.filter((_, i) => i !== idx));
  }

  function validateStep1(): boolean {
    if (!bride.trim() || !groom.trim()) {
      setError("Please enter both the bride's and groom's names.");
      return false;
    }
    if (!hostSide) {
      setError('Please pick which side you are on.');
      return false;
    }
    setError('');
    return true;
  }

  function validateStep2(): boolean {
    if (!venueName.trim()) {
      setError('Please enter a venue name.');
      return false;
    }
    if (!city.trim()) {
      setError('Please enter a city.');
      return false;
    }
    if (expectedGuests.trim() && !/^\d+$/.test(expectedGuests.trim())) {
      setError('Expected guests must be a whole number.');
      return false;
    }
    setError('');
    return true;
  }

  function validateStep3(): boolean {
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (!d.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
        setError(`Day ${i + 1} needs a date.`);
        return false;
      }
      if (d.date < today) {
        setError(`Day ${i + 1} cannot be in the past.`);
        return false;
      }
      if (i > 0 && d.date <= days[i - 1].date) {
        setError(`Day ${i + 1} must be after Day ${i}.`);
        return false;
      }
      if (d.ceremonies.length === 0) {
        setError(`Pick at least one ceremony for Day ${i + 1}.`);
        return false;
      }
    }
    setError('');
    return true;
  }

  async function submit() {
    if (!validateStep3()) return;
    setBusy(true);
    setError('');
    const cleanBride = titleCase(bride);
    const cleanGroom = titleCase(groom);
    const firstYear = days[0].date.slice(0, 4);
    const cleanWord = (s: string) => s.replace(/[^A-Za-z0-9]/g, '');
    const hashtag = `#${cleanWord(cleanBride)}${cleanWord(cleanGroom)}${firstYear}`;

    const events = days.flatMap((d) =>
      d.ceremonies.map((name) => {
        const existing = extraDraft?.events?.find((e) => e.name.toLowerCase() === name.toLowerCase());
        return {
          name,
          date: d.date,
          start_time: existing?.start_time || DEFAULT_TIMES[name] || '18:00',
          venue_name: existing?.venue_name || venueName.trim(),
          venue_address: existing?.venue_address || city.trim(),
          dress_code: existing?.dress_code || '',
          notes: existing?.notes || '',
        };
      }),
    );

    const draft: WeddingDraft = {
      partner1_name: cleanBride,
      partner2_name: cleanGroom,
      partner1_family: extraDraft?.partner1_family || '',
      partner2_family: extraDraft?.partner2_family || '',
      invite_line: extraDraft?.invite_line || '',
      city: city.trim(),
      tradition: extraDraft?.tradition || '',
      language: extraDraft?.language || 'en',
      style,
      events,
      info: extraDraft?.info || [],
      contact_name: extraDraft?.contact_name || session?.user.name || '',
      contact_phone: '',
    };

    try {
      const r = await post<{ slug: string; host_token: string }>('/api/weddings', {
        draft,
        host_side: hostSide,
        expected_guests: expectedGuests.trim() ? Number(expectedGuests.trim()) : undefined,
        hashtag,
        ...(couplePhoto ? { couple_photo: { mime_type: couplePhoto.mime_type, data: couplePhoto.data } } : {}),
      });
      await refreshWeddings();
      navigate(`/w/${r.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the wedding.');
      setBusy(false);
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
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/weddings')}>
              ← My weddings
            </button>
          </div>
        </div>
      </header>

      <main className="pl-container pl-narrow">
        <div className="pl-create-head">
          <div>
            <p className="eyebrow">New wedding</p>
            <h1 className="h2">Create your <span className="serif grad-text">wedding</span></h1>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setIntakeMode((v) => !v)}
          >
            {intakeMode ? '← Back to 3-step form' : '✦ Start from your wedding card or a voice note'}
          </button>
        </div>

        {intakeMode ? (
          <div className="pl-intake-wrap">
            <p className="muted small" style={{ marginBottom: 12 }}>
              Upload a card photo, PDF or speak to Saathi. When it&apos;s ready, we&apos;ll pre-fill the form for you to review.
            </p>
            <Create embedded onDraftReady={applyIntakeDraft} />
          </div>
        ) : (
          <section className="card pl-wizard">
            <div className="pl-progress" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={3} aria-label={`Step ${step} of 3`}>
              <div className="pl-progress-fill" style={{ width: `${(step / 3) * 100}%` }} />
            </div>
            <p className="eyebrow" style={{ marginTop: 14 }}>Step {step} of 3 · {step === 1 ? 'The couple' : step === 2 ? 'Venue & guests' : 'Wedding days & style'}</p>

            {step === 1 && (
              <div className="pl-form-stack">
                <div className="pl-form-row">
                  <label>
                    Bride&apos;s name *
                    <input
                      type="text"
                      required
                      placeholder="e.g. Meera"
                      value={bride}
                      onChange={(e) => setBride(e.target.value)}
                      onBlur={() => setBride(titleCase(bride))}
                    />
                  </label>
                  <label>
                    Groom&apos;s name *
                    <input
                      type="text"
                      required
                      placeholder="e.g. Rohan"
                      value={groom}
                      onChange={(e) => setGroom(e.target.value)}
                      onBlur={() => setGroom(titleCase(groom))}
                    />
                  </label>
                </div>

                <div>
                  <span className="pl-field-label">You are *</span>
                  <div className="pl-chip-row" role="group" aria-label="You are">
                    {(
                      [
                        ['bride', "Bride's side"],
                        ['groom', "Groom's side"],
                        ['planner', 'Wedding planner'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`chip ${hostSide === id ? 'on' : ''}`}
                        aria-pressed={hostSide === id}
                        onClick={() => setHostSide(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="couple-photo-input">Couple photo <span className="muted">(optional)</span></label>
                  <div className="pl-photo-row">
                    <input
                      id="couple-photo-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => void onPhotoChange(e.target.files)}
                    />
                    {photoPreview && <img src={photoPreview} alt="Couple preview" className="pl-photo-thumb" />}
                  </div>
                </div>

                {error && <p className="small" style={{ color: 'var(--bad)' }} role="alert">{error}</p>}

                <div className="pl-wizard-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      if (validateStep1()) setStep(2);
                    }}
                  >
                    Next: Venue &amp; guests →
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="pl-form-stack">
                <label>
                  Primary venue name *
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rambagh Palace"
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                  />
                </label>

                <div className="pl-form-row">
                  <label>
                    City *
                    <input
                      type="text"
                      list="indian-cities"
                      required
                      placeholder="e.g. Jaipur"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                    />
                    <datalist id="indian-cities">
                      {INDIAN_CITIES.map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </label>
                  <label>
                    <span>Expected guests <span className="muted">(optional)</span></span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="e.g. 200"
                      value={expectedGuests}
                      onChange={(e) => setExpectedGuests(e.target.value.replace(/[^\d]/g, ''))}
                    />
                  </label>
                </div>

                {error && <p className="small" style={{ color: 'var(--bad)' }} role="alert">{error}</p>}

                <div className="pl-wizard-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>← Back</button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      if (validateStep2()) setStep(3);
                    }}
                  >
                    Next: Wedding days →
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="pl-form-stack">
                <div className="pl-days-list">
                  {days.map((d, idx) => {
                    const prevDate = idx > 0 ? days[idx - 1].date : '';
                    const minDate = prevDate && /^\d{4}-\d{2}-\d{2}$/.test(prevDate) ? addDaysIso(prevDate, 1) : today;
                    const customCeremonies = d.ceremonies.filter((c) => !(CEREMONY_PRESETS as readonly string[]).includes(c));
                    return (
                      <div key={idx} className="card-sm pl-day-box">
                        <div className="pl-day-head">
                          <b>Day {idx + 1}</b>
                          {days.length > 1 && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeDay(idx)}>
                              Remove
                            </button>
                          )}
                        </div>
                        <label>
                          Date *
                          <input
                            type="date"
                            min={minDate}
                            value={d.date}
                            onChange={(e) => updateDayDate(idx, e.target.value)}
                          />
                        </label>
                        <div className="pl-chip-row" role="group" aria-label={`Day ${idx + 1} ceremonies`}>
                          {CEREMONY_PRESETS.map((c) => {
                            const on = d.ceremonies.includes(c);
                            return (
                              <button
                                key={c}
                                type="button"
                                className={`chip ${on ? 'on' : ''}`}
                                aria-pressed={on}
                                onClick={() => toggleCeremony(idx, c)}
                              >
                                {c}
                              </button>
                            );
                          })}
                          {customCeremonies.map((c) => (
                            <button
                              key={c}
                              type="button"
                              className="chip on"
                              aria-pressed={true}
                              onClick={() => toggleCeremony(idx, c)}
                            >
                              {c} ×
                            </button>
                          ))}
                        </div>
                        <div className="pl-custom-cer">
                          <input
                            type="text"
                            aria-label={`Add custom ceremony for Day ${idx + 1}`}
                            placeholder="+ Custom ceremony (e.g. Cocktail)"
                            value={d.customInput}
                            onChange={(e) =>
                              setDays((prev) => prev.map((x, i) => (i === idx ? { ...x, customInput: e.target.value } : x)))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addCustomCeremony(idx);
                              }
                            }}
                          />
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => addCustomCeremony(idx)}>
                            + Custom
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {days.length < 4 && (
                  <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={addDay}>
                    + Add day
                  </button>
                )}

                <div>
                  <span className="pl-field-label">Card style</span>
                  <div className="style-tiles" style={{ padding: 0 }} role="group" aria-label="Pick a card style">
                    {STYLE_TILES.map(([id, label, sub]) => (
                      <button
                        key={id}
                        type="button"
                        className={`style-tile ${style === id ? 'selected' : ''}`}
                        aria-pressed={style === id}
                        onClick={() => setStyle(id)}
                      >
                        <span className="st-swatch" style={{ background: `${ornamentUrl(id)} center / 60px` }} aria-hidden />
                        <b>{label} {style === id ? '✓' : ''}</b>
                        <small>{sub}</small>
                      </button>
                    ))}
                  </div>
                </div>

                {error && <p className="small" style={{ color: 'var(--bad)' }} role="alert">{error}</p>}

                <div className="pl-wizard-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>← Back</button>
                  <button type="button" className="btn btn-cta" disabled={busy} onClick={() => void submit()}>
                    {busy ? 'Creating wedding…' : 'Create wedding →'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

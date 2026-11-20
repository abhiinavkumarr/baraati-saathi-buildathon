import { useCallback, useEffect, useState } from 'react';
import { patch, post, type WeddingDraft } from '../../../api.ts';
import { askSaathi, notifySaathiChanged, useWedding } from '../../../WeddingContext.tsx';

interface QuestionRow {
  id: string;
  question: string;
  answer: string | null;
  status: 'open' | 'answered';
  created_at: string;
}

export function InfoTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [info, setInfo] = useState<{ question: string; answer: string }[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/host/${slug}?t=${encodeURIComponent(token)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load info.');
      setInfo((j.draft as WeddingDraft).info ?? []);
      setQuestions(j.questions ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load info.');
    } finally {
      setLoading(false);
    }
  }, [slug, token]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener('saathi:changed', onChanged);
    return () => window.removeEventListener('saathi:changed', onChanged);
  }, [load]);

  async function saveInfo(next: { question: string; answer: string }[]) {
    const r = await patch<{ info: { question: string; answer: string }[] }>(`/api/host/${slug}/info`, { t: token, info: next });
    setInfo(r.info);
    notifySaathiChanged();
  }

  async function addInfoCard(e: React.FormEvent) {
    e.preventDefault();
    if (!newQ.trim() || !newA.trim()) return;
    await saveInfo([...info, { question: newQ.trim(), answer: newA.trim() }]);
    setNewQ('');
    setNewA('');
  }

  async function removeInfoCard(idx: number) {
    await saveInfo(info.filter((_, i) => i !== idx));
  }

  async function answerQuestion(q: QuestionRow) {
    const ans = (answers[q.id] || '').trim();
    if (!ans) return;
    setBusyId(q.id);
    try {
      await post(`/api/host/${slug}/questions/${q.id}/answer`, { t: token, answer: ans });
      setAnswers((m) => {
        const next = { ...m };
        delete next[q.id];
        return next;
      });
      await load();
      notifySaathiChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save answer.');
    } finally {
      setBusyId('');
    }
  }

  const openQs = questions.filter((q) => q.status === 'open');
  const answeredQs = questions.filter((q) => q.status === 'answered');

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">Baraati App</p>
          <h1 className="h2">Info cards &amp; <span className="serif">questions</span></h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Every info card here is used by Saathi to answer guests automatically.
          </p>
        </div>
      </div>

      {error && <div className="card card-sm pl-err-box" role="alert"><span className="badge bad">Error</span><p>{error}</p></div>}

      {loading ? (
        <div className="card pl-skeleton" />
      ) : (
        <div className="pl-home-grid">
          <section className="card">
            <p className="eyebrow">Guest inbox</p>
            <h2 className="h3" style={{ margin: '0 0 12px' }}>
              Questions Saathi couldn&apos;t answer <span className="badge">{openQs.length}</span>
            </h2>
            {openQs.length === 0 ? (
              <p className="muted small">No open questions right now.</p>
            ) : (
              <ul className="pl-card-stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {openQs.map((q) => (
                  <li key={q.id} className="card-sm" style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}>
                    <b style={{ display: 'block', marginBottom: 8 }}>“{q.question}”</b>
                    <div className="pl-form-stack" style={{ gap: 8, marginTop: 0 }}>
                      <input
                        type="text"
                        aria-label={`Answer to ${q.question}`}
                        placeholder="Type your answer (becomes an info card)…"
                        value={answers[q.id] || ''}
                        onChange={(e) => setAnswers((m) => ({ ...m, [q.id]: e.target.value }))}
                      />
                      <div className="pl-row-btns">
                        <button
                          type="button"
                          className="btn btn-cta btn-sm"
                          disabled={busyId === q.id || !(answers[q.id] || '').trim()}
                          onClick={() => void answerQuestion(q)}
                        >
                          {busyId === q.id ? 'Saving…' : 'Save answer'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => askSaathi(`Answer the guest question "${q.question}": `)}
                        >
                          Answer with Saathi →
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {answeredQs.length > 0 && (
              <p className="muted tiny" style={{ marginTop: 14 }}>
                {answeredQs.length} question{answeredQs.length === 1 ? '' : 's'} already answered and added to Saathi.
              </p>
            )}
          </section>

          <section className="card">
            <p className="eyebrow">Knowledge base</p>
            <h2 className="h3" style={{ margin: '0 0 12px' }}>Info cards ({info.length})</h2>
            <form className="pl-pay-form" onSubmit={(e) => void addInfoCard(e)}>
              <input
                type="text"
                required
                aria-label="Info card question"
                placeholder="Question, e.g. Is parking available?"
                value={newQ}
                onChange={(e) => setNewQ(e.target.value)}
              />
              <textarea
                rows={2}
                required
                aria-label="Info card answer"
                placeholder="Answer guests will see and Saathi will share…"
                value={newA}
                onChange={(e) => setNewA(e.target.value)}
              />
              <button type="submit" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }}>
                + Add info card
              </button>
            </form>

            <ul className="pl-pay-list">
              {info.map((item, i) => (
                <li key={item.question + i}>
                  <div style={{ flex: 1 }}>
                    <b>{item.question}</b>
                    <p className="muted small" style={{ margin: '4px 0 0' }}>{item.answer}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`Delete info card ${item.question}`}
                    onClick={() => void removeInfoCard(i)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

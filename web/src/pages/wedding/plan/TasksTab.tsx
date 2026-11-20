import { useCallback, useEffect, useMemo, useState } from 'react';
import { del, patch, post, type Attachment } from '../../../api.ts';
import { useWedding } from '../../../WeddingContext.tsx';
import { fmtDate } from '../../../format.ts';
import { MicButton } from '../../../components/MicButton.tsx';

interface TaskItem {
  id: string;
  title: string;
  category: string;
  ceremony: string;
  assignee: string;
  status: 'todo' | 'doing' | 'waiting' | 'done';
  priority: 'normal' | 'high' | 'critical';
  due_date: string | null;
  source: string;
  urgency: 'overdue' | 'this_week' | 'later' | 'undated' | 'done';
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/** Parse quick-add text like "Book mehendi artist by 5 Jan" into { title, due_date }. */
function parseQuickAdd(raw: string): { title: string; due_date: string | null } {
  const m = raw.match(/\b(?:by|on|due)\s+(\d{1,2})\s+([a-zA-Z]{3,9})(?:\s+(\d{4}))?\s*$/i);
  if (!m) return { title: raw.trim(), due_date: null };
  const day = Number(m[1]);
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon === undefined || day < 1 || day > 31) return { title: raw.trim(), due_date: null };
  const now = new Date();
  let year = m[3] ? Number(m[3]) : now.getFullYear();
  const candidate = new Date(Date.UTC(year, mon, day));
  if (!m[3] && candidate.getTime() < now.getTime() - 86_400_000) {
    year += 1;
  }
  const iso = new Date(Date.UTC(year, mon, day)).toISOString().slice(0, 10);
  const title = raw.slice(0, m.index).trim() || raw.trim();
  return { title, due_date: iso };
}

const BUCKETS: { key: TaskItem['urgency']; label: string; cls: string }[] = [
  { key: 'overdue', label: 'Overdue', cls: 'bad' },
  { key: 'this_week', label: 'This week', cls: 'warn' },
  { key: 'later', label: 'Later', cls: '' },
  { key: 'undated', label: 'Undated', cls: '' },
  { key: 'done', label: 'Done', cls: 'ok' },
];

export function TasksTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [quick, setQuick] = useState('');
  const [quickPriority, setQuickPriority] = useState<TaskItem['priority']>('normal');
  const [quickAssignee, setQuickAssignee] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [ceremonyFilter, setCeremonyFilter] = useState('all');

  // AI "Make my checklist" (§5.4)
  const [aiBusy, setAiBusy] = useState(false);
  const [suggested, setSuggested] = useState<{ title: string; due_date: string | null; category: string; ceremony: string; assignee?: string; priority: 'normal' | 'high' | 'critical'; checked: boolean }[]>([]);
  const [applyingAi, setApplyingAi] = useState(false);
  // Where the suggestions came from: the AI checklist or a voice note.
  const [heard, setHeard] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);

  async function tasksFromVoice(audio: Attachment) {
    setVoiceBusy(true);
    setError('');
    try {
      const r = await post<{ heard: string; tasks: { title: string; due_date: string | null; category: string; ceremony: string; assignee: string; priority: 'normal' | 'high' | 'critical' }[] }>(
        `/api/host/${slug}/tasks/from-voice`,
        { t: token, audio },
      );
      if (!r.tasks?.length) throw new Error(r.heard ? `Heard “${r.heard}”, but no to-dos in it. Try again?` : 'No to-dos heard. Try again?');
      setHeard(r.heard || '');
      setSuggested(r.tasks.map((t) => ({ ...t, checked: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not understand the voice note.');
    } finally {
      setVoiceBusy(false);
    }
  }

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/host/${slug}/tasks?t=${encodeURIComponent(token)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load tasks.');
      setTasks(j.tasks ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tasks.');
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

  const assignees = useMemo(() => [...new Set(tasks.map((t) => t.assignee).filter(Boolean))].sort(), [tasks]);
  const ceremonies = useMemo(() => [...new Set(tasks.map((t) => t.ceremony).filter(Boolean))].sort(), [tasks]);

  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        if (assigneeFilter !== 'all' && t.assignee !== assigneeFilter) return false;
        if (ceremonyFilter !== 'all' && t.ceremony !== ceremonyFilter) return false;
        return true;
      }),
    [tasks, assigneeFilter, ceremonyFilter],
  );

  async function addQuick(e: React.FormEvent) {
    e.preventDefault();
    if (!quick.trim()) return;
    const { title, due_date } = parseQuickAdd(quick);
    await post(`/api/host/${slug}/tasks`, {
      t: token,
      title,
      due_date,
      priority: quickPriority,
      assignee: quickAssignee.trim() || null,
    });
    setQuick('');
    setQuickAssignee('');
    await load();
  }

  async function setStatus(t: TaskItem, status: TaskItem['status']) {
    await patch(`/api/host/${slug}/tasks/${t.id}`, { t: token, status });
    await load();
  }

  async function remove(t: TaskItem) {
    if (!window.confirm(`Delete task "${t.title}"?`)) return;
    await del(`/api/host/${slug}/tasks/${t.id}`, { t: token });
    await load();
  }

  async function suggestChecklist() {
    setAiBusy(true);
    setError('');
    try {
      const r = await post<{ tasks: { title: string; due_date: string | null; category: string; ceremony: string; priority: 'normal' | 'high' | 'critical' }[] }>(
        `/api/host/${slug}/tasks/suggest`,
        { t: token },
      );
      setHeard(null);
      setSuggested((r.tasks ?? []).map((t) => ({ ...t, checked: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate checklist.');
    } finally {
      setAiBusy(false);
    }
  }

  async function applySuggested() {
    const picked = suggested.filter((t) => t.checked);
    if (!picked.length) return;
    setApplyingAi(true);
    try {
      await post(`/api/host/${slug}/apply`, {
        t: token,
        proposal: {
          kind: 'tasks',
          payload: { tasks: picked.map(({ title, due_date, category, ceremony, assignee, priority }) => ({ title, due_date, category, ceremony, assignee, priority })) },
        },
      });
      setSuggested([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add suggested tasks.');
    } finally {
      setApplyingAi(false);
    }
  }

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">Your Wedding</p>
          <h1 className="h2">Wedding <span className="serif">tasks</span></h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {tasks.filter((t) => t.status !== 'done').length} open · {tasks.filter((t) => t.urgency === 'overdue').length} overdue
          </p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" disabled={aiBusy} onClick={() => void suggestChecklist()}>
          {aiBusy ? 'Building checklist…' : '✦ Make my checklist'}
        </button>
      </div>

      {suggested.length > 0 && (
        <section className="card card-sm pl-proposal-panel">
          <div className="pl-vc-top" style={{ marginBottom: 10 }}>
            <div>
              <span className="badge ai">{heard !== null ? '🎙️ From your voice note' : '✦ Saathi suggests'}</span>
              <h2 className="h3" style={{ margin: '4px 0 0' }}>
                {heard !== null ? 'Tasks you asked for' : 'Dated wedding checklist'} ({suggested.filter((s) => s.checked).length} selected)
              </h2>
              {heard && <p className="muted small" style={{ margin: '4px 0 0' }}>Heard: “{heard}”</p>}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSuggested([])}>Dismiss</button>
          </div>
          <ul className="pl-task-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {suggested.map((t, i) => (
              <li key={i}>
                <label className="pl-task-main" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={t.checked}
                    onChange={(e) => setSuggested((prev) => prev.map((x, idx) => (idx === i ? { ...x, checked: e.target.checked } : x)))}
                  />
                  <div>
                    <span className="pl-task-title">{t.title}</span>
                    <div className="pl-badges-inline" style={{ marginTop: 2 }}>
                      {t.category && <span className="badge">{t.category}</span>}
                      {t.ceremony && <span className="badge">{t.ceremony}</span>}
                      {t.assignee && <span className="badge">{t.assignee}</span>}
                      {t.priority !== 'normal' && <span className={`badge ${t.priority === 'critical' ? 'bad' : 'warn'}`}>{t.priority}</span>}
                      {t.due_date && <span className="muted tiny">{fmtDate(t.due_date, { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                    </div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
          <div className="pl-wizard-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSuggested([])}>Dismiss</button>
            <button type="button" className="btn btn-cta btn-sm" disabled={applyingAi || !suggested.some((s) => s.checked)} onClick={() => void applySuggested()}>
              {applyingAi ? 'Adding…' : `Add ${suggested.filter((s) => s.checked).length} tasks`}
            </button>
          </div>
        </section>
      )}

      {error && <div className="card card-sm pl-err-box" role="alert"><span className="badge bad">Error</span><p>{error}</p></div>}

      <form className="card card-sm pl-quick-task" onSubmit={(e) => void addQuick(e)}>
        <div className="pl-quick-row">
          <input
            type="text"
            aria-label="Quick add task"
            placeholder='Add a task, e.g. "Book mehendi artist by 5 Jan"'
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
          />
          <input
            type="text"
            aria-label="Assignee (optional)"
            placeholder="Assignee"
            className="pl-quick-who"
            value={quickAssignee}
            onChange={(e) => setQuickAssignee(e.target.value)}
          />
          <button type="submit" className="btn btn-cta btn-sm" disabled={!quick.trim()}>Add task</button>
          <MicButton text="Speak tasks" label="Say your tasks (e.g. “Book the DJ by 10 Jan, ask Riya to finalise the menu”)" busy={voiceBusy} onAudio={tasksFromVoice} />
        </div>
        <div className="pl-chip-row" role="group" aria-label="Priority">
          {(['normal', 'high', 'critical'] as const).map((pr) => (
            <button
              key={pr}
              type="button"
              className={`chip ${quickPriority === pr ? 'on' : ''}`}
              aria-pressed={quickPriority === pr}
              onClick={() => setQuickPriority(pr)}
            >
              Priority: {pr}
            </button>
          ))}
        </div>
      </form>

      {(assignees.length > 0 || ceremonies.length > 0) && (
        <div className="pl-filter-groups" style={{ marginBottom: 18 }}>
          {assignees.length > 0 && (
            <div className="pl-chip-row" role="group" aria-label="Filter by assignee">
              <button type="button" className={`chip ${assigneeFilter === 'all' ? 'on' : ''}`} aria-pressed={assigneeFilter === 'all'} onClick={() => setAssigneeFilter('all')}>
                All owners
              </button>
              {assignees.map((a) => (
                <button key={a} type="button" className={`chip ${assigneeFilter === a ? 'on' : ''}`} aria-pressed={assigneeFilter === a} onClick={() => setAssigneeFilter(a)}>
                  {a}
                </button>
              ))}
            </div>
          )}
          {ceremonies.length > 0 && (
            <div className="pl-chip-row" role="group" aria-label="Filter by ceremony">
              <button type="button" className={`chip ${ceremonyFilter === 'all' ? 'on' : ''}`} aria-pressed={ceremonyFilter === 'all'} onClick={() => setCeremonyFilter('all')}>
                All ceremonies
              </button>
              {ceremonies.map((c) => (
                <button key={c} type="button" className={`chip ${ceremonyFilter === c ? 'on' : ''}`} aria-pressed={ceremonyFilter === c} onClick={() => setCeremonyFilter(c)}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="card pl-skeleton" />
      ) : (
        <div className="pl-task-groups">
          {BUCKETS.map((b) => {
            const items = filtered.filter((t) => t.urgency === b.key);
            if (!items.length) return null;
            return (
              <section key={b.key} className="card card-sm">
                <div className="pl-tg-head">
                  <span className={`badge ${b.cls}`}>{b.label}</span>
                  <span className="muted tiny">{items.length}</span>
                </div>
                <ul className="pl-task-list">
                  {items.map((t) => (
                    <li key={t.id} className={t.status === 'done' ? 'done' : ''}>
                      <div className="pl-task-main">
                        <input
                          type="checkbox"
                          aria-label={`Mark "${t.title}" done`}
                          checked={t.status === 'done'}
                          onChange={(e) => void setStatus(t, e.target.checked ? 'done' : 'todo')}
                        />
                        <div>
                          <span className="pl-task-title">{t.title}</span>
                          <div className="pl-badges-inline" style={{ marginTop: 4 }}>
                            {t.priority !== 'normal' && <span className={`badge ${t.priority === 'critical' ? 'bad' : 'warn'}`}>{t.priority}</span>}
                            {t.ceremony && <span className="badge">{t.ceremony}</span>}
                            {t.assignee && <span className="badge">{t.assignee}</span>}
                            {t.source === 'ai' && <span className="badge ai">✦ Saathi</span>}
                            {t.due_date && <span className="muted tiny">{fmtDate(t.due_date, { day: 'numeric', month: 'short' })}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="pl-task-right">
                        <select
                          aria-label={`Status for ${t.title}`}
                          value={t.status}
                          onChange={(e) => void setStatus(t, e.target.value as TaskItem['status'])}
                        >
                          <option value="todo">To do</option>
                          <option value="doing">Doing</option>
                          <option value="waiting">Waiting</option>
                          <option value="done">Done</option>
                        </select>
                        <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete ${t.title}`} onClick={() => void remove(t)}>✕</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { del, patch, post } from '../../../api.ts';
import { useWedding } from '../../../WeddingContext.tsx';

interface SheetCol {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'check';
}

interface SheetRow {
  id: string;
  cells: Record<string, string | number | boolean>;
}

interface SheetDoc {
  id: string;
  name: string;
  columns: SheetCol[];
  rows: SheetRow[];
  updated_at: string;
}

export function SheetsTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [sheets, setSheets] = useState<SheetDoc[]>([]);
  const [activeId, setActiveId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState('');
  const saveTimer = useRef<number | null>(null);
  const csvInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/host/${slug}/sheets?t=${encodeURIComponent(token)}`);
    if (r.ok) {
      const j = await r.json();
      const list = (j.sheets ?? []) as SheetDoc[];
      setSheets(list);
      setActiveId((prev) => (prev && list.some((s) => s.id === prev) ? prev : list[0]?.id ?? ''));
    }
    setLoading(false);
  }, [slug, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = sheets.find((s) => s.id === activeId) ?? null;

  function scheduleSave(updated: SheetDoc) {
    setSheets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setSaving('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await patch(`/api/host/${slug}/sheets/${updated.id}`, {
          t: token,
          name: updated.name,
          columns: updated.columns,
          rows: updated.rows,
        });
        setSaving('saved');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Autosave failed.');
        setSaving('idle');
      }
    }, 800);
  }

  async function createSheet() {
    const r = await post<{ sheet: SheetDoc }>(`/api/host/${slug}/sheets`, { t: token, name: `Sheet ${sheets.length + 1}` });
    setSheets((prev) => [r.sheet, ...prev]);
    setActiveId(r.sheet.id);
  }

  async function deleteSheet(s: SheetDoc) {
    if (!window.confirm(`Delete sheet "${s.name}"?`)) return;
    await del(`/api/host/${slug}/sheets/${s.id}`, { t: token });
    const next = sheets.filter((x) => x.id !== s.id);
    setSheets(next);
    setActiveId(next[0]?.id ?? '');
  }

  async function generateSheet(e: React.FormEvent) {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    setError('');
    try {
      const r = await post<{ sheet: SheetDoc }>(`/api/host/${slug}/sheets/suggest`, { t: token, prompt: aiPrompt.trim() });
      setSheets((prev) => [r.sheet, ...prev]);
      setActiveId(r.sheet.id);
      setAiPrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create sheet.');
    } finally {
      setAiBusy(false);
    }
  }

  function updateCell(rowIdx: number, colId: string, val: string | number | boolean) {
    if (!active) return;
    const rows = active.rows.map((r, i) => (i === rowIdx ? { ...r, cells: { ...r.cells, [colId]: val } } : r));
    scheduleSave({ ...active, rows });
  }

  function addRow() {
    if (!active || active.rows.length >= 500) return;
    const cells: Record<string, string | number | boolean> = {};
    for (const c of active.columns) cells[c.id] = c.type === 'check' ? false : '';
    scheduleSave({ ...active, rows: [...active.rows, { id: `r${Date.now()}`, cells }] });
  }

  function removeRow(idx: number) {
    if (!active) return;
    scheduleSave({ ...active, rows: active.rows.filter((_, i) => i !== idx) });
  }

  function addColumn() {
    if (!active || active.columns.length >= 30) return;
    const name = window.prompt('Column name', 'New column');
    if (!name?.trim()) return;
    const type = (window.prompt('Column type: text, number, date, or check', 'text') || 'text').trim().toLowerCase();
    const colType: SheetCol['type'] = ['text', 'number', 'date', 'check'].includes(type) ? (type as SheetCol['type']) : 'text';
    const id = `c${Date.now()}`;
    const columns = [...active.columns, { id, name: name.trim().slice(0, 60), type: colType }];
    const rows = active.rows.map((r) => ({ ...r, cells: { ...r.cells, [id]: colType === 'check' ? false : '' } }));
    scheduleSave({ ...active, columns, rows });
  }

  function exportCsv() {
    if (!active) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      active.columns.map((c) => esc(c.name)).join(','),
      ...active.rows.map((r) => active.columns.map((c) => esc(r.cells[c.id])).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active.name.replace(/\W+/g, '-').toLowerCase() || 'sheet'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importCsv(file: File | undefined) {
    if (!file || !active) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (!lines.length) return;
      const parseLine = (l: string) => l.split(',').map((x) => x.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
      const headers = parseLine(lines[0]).slice(0, 30);
      const columns: SheetCol[] = headers.map((name, i) => ({ id: `c${i + 1}`, name: name || `Col ${i + 1}`, type: 'text' }));
      const rows: SheetRow[] = lines.slice(1, 501).map((line, ri) => {
        const vals = parseLine(line);
        const cells: Record<string, string | number | boolean> = {};
        columns.forEach((c, ci) => { cells[c.id] = vals[ci] ?? ''; });
        return { id: `r${ri + 1}`, cells };
      });
      scheduleSave({ ...active, columns, rows });
    };
    reader.readAsText(file);
  }

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">Your Wedding</p>
          <h1 className="h2">Planning <span className="serif">sheets</span></h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Track song lists, shopping lists, return gifts or anything else — autosaved as you type.
          </p>
        </div>
        <button type="button" className="btn btn-cta btn-sm" onClick={() => void createSheet()}>+ New sheet</button>
      </div>

      <form className="card card-sm pl-quick-row" onSubmit={(e) => void generateSheet(e)}>
        <input
          type="text"
          aria-label="Ask Saathi to make a sheet"
          placeholder='✦ Make a sheet for… e.g. "Mehendi shopping list" or "Return gifts for 40 families"'
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={aiBusy || !aiPrompt.trim()}>
          {aiBusy ? 'Building…' : '✦ Make sheet'}
        </button>
      </form>

      {error && <div className="card card-sm pl-err-box" role="alert"><span className="badge bad">Error</span><p>{error}</p></div>}

      {loading ? (
        <div className="card pl-skeleton" />
      ) : (
        <div className="pl-sheets-layout">
          <aside className="card card-sm pl-sheet-list" aria-label="Your sheets">
            <p className="eyebrow">Sheets ({sheets.length})</p>
            {sheets.map((s) => (
              <div key={s.id} className={`pl-sheet-item ${s.id === activeId ? 'on' : ''}`}>
                <button type="button" className="pl-sheet-pick" onClick={() => setActiveId(s.id)}>
                  <b>{s.name}</b>
                  <span className="muted tiny">{s.rows.length} rows</span>
                </button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete ${s.name}`} onClick={() => void deleteSheet(s)}>✕</button>
              </div>
            ))}
          </aside>

          {active ? (
            <section className="card card-sm pl-sheet-main">
              <div className="pl-sheet-bar">
                <input
                  type="text"
                  aria-label="Sheet name"
                  className="pl-sheet-title-input"
                  value={active.name}
                  onChange={(e) => scheduleSave({ ...active, name: e.target.value })}
                />
                <div className="pl-row-btns">
                  <span className="muted tiny">{saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved ✓' : ''}</span>
                  <button type="button" className="btn btn-outline btn-sm" onClick={addColumn}>+ Column</button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={addRow}>+ Row</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => csvInput.current?.click()}>Import CSV</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv}>Export CSV</button>
                  <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => { importCsv(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
              </div>

              <div className="pl-grid-wrap">
                <table className="pl-grid-table" role="grid" aria-label={active.name}>
                  <thead>
                    <tr role="row" aria-rowindex={1}>
                      <th scope="col" style={{ width: 36 }}>#</th>
                      {active.columns.map((c, ci) => (
                        <th key={c.id} scope="col" aria-colindex={ci + 2}>{c.name}</th>
                      ))}
                      <th scope="col" style={{ width: 40 }}><span className="sr-only">Delete</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.rows.map((r, ri) => (
                      <tr key={r.id} role="row" aria-rowindex={ri + 2}>
                        <td className="muted tiny">{ri + 1}</td>
                        {active.columns.map((c, ci) => (
                          <td key={c.id} role="gridcell" aria-colindex={ci + 2}>
                            {c.type === 'check' ? (
                              <input
                                type="checkbox"
                                aria-label={`${c.name} row ${ri + 1}`}
                                checked={Boolean(r.cells[c.id])}
                                onChange={(e) => updateCell(ri, c.id, e.target.checked)}
                              />
                            ) : (
                              <input
                                type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                                aria-label={`${c.name} row ${ri + 1}`}
                                className="pl-cell-input"
                                value={String(r.cells[c.id] ?? '')}
                                onChange={(e) => updateCell(ri, c.id, c.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
                              />
                            )}
                          </td>
                        ))}
                        <td>
                          <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete row ${ri + 1}`} onClick={() => removeRow(ri)}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {active.columns.some((c) => c.type === 'number') && (
                    <tfoot>
                      <tr>
                        <td className="muted tiny">Sum</td>
                        {active.columns.map((c) => (
                          <td key={c.id} className="num small">
                            {c.type === 'number'
                              ? active.rows.reduce((s, r) => s + (Number(r.cells[c.id]) || 0), 0).toLocaleString('en-IN')
                              : ''}
                          </td>
                        ))}
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>
          ) : (
            <div className="card pl-empty-card">
              <h3>No sheets yet</h3>
              <p className="muted small">Create a blank sheet or ask Saathi to generate one above.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { del, fileToAttachment, patch, post, type Attachment } from '../../../api.ts';
import { useWedding } from '../../../WeddingContext.tsx';
import { fmtDate, fmtTime } from '../../../format.ts';
import { MicButton } from '../../../components/MicButton.tsx';
import { mapGuestTable, readCsvText, readSpreadsheetFile, SPREADSHEET_ACCEPT, tableToText, type ImportGuest } from '../../../guestSheet.ts';

export interface GuestItem {
  id: string;
  guest_token: string;
  name: string;
  phone_masked: string;
  wa_url: string;
  personal_link: string;
  status: 'yes' | 'no' | 'maybe' | 'pending';
  party_size: number;
  side: 'bride' | 'groom' | 'both' | null;
  group_name: string;
  relation: string;
  room: string;
  source: string;
  note: string;
  extracted: {
    arrival_date?: string;
    arrival_time?: string;
    arrival_point?: string;
    needs_pickup?: boolean;
    dietary?: string;
  } | null;
}

const STATUS_BADGE: Record<GuestItem['status'], { cls: string; label: string }> = {
  yes: { cls: 'ok', label: 'Coming' },
  maybe: { cls: 'warn', label: 'Maybe' },
  no: { cls: 'bad', label: "Can't come" },
  pending: { cls: '', label: 'Pending' },
};

const EMPTY_FORM = {
  name: '',
  party_size: '1',
  status: 'pending' as GuestItem['status'],
  side: '' as '' | 'bride' | 'groom' | 'both',
  group_name: '',
  relation: '',
  room: '',
  phone: '',
  note: '',
};

export function GuestsTab({ slug }: { slug: string }) {
  const { getTokenForSlug } = useWedding();
  const token = getTokenForSlug(slug);
  const [guests, setGuests] = useState<GuestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [sideFilter, setSideFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkGroup, setBulkGroup] = useState('');
  const [bulkSide, setBulkSide] = useState('');

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<GuestItem | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState('');

  // AI guest import (§5.1)
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importImage, setImportImage] = useState<Attachment | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [previewRows, setPreviewRows] = useState<ImportGuest[]>([]);
  const [sheetLink, setSheetLink] = useState('');
  const [importNote, setImportNote] = useState('');
  const [flash, setFlash] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/host/${slug}/guests?t=${encodeURIComponent(token)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load guests.');
      setGuests(j.guests ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load guests.');
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

  const groups = useMemo(
    () => [...new Set(guests.map((g) => g.group_name).filter(Boolean))].sort(),
    [guests],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return guests.filter((g) => {
      if (sideFilter !== 'all' && (g.side || 'none') !== sideFilter) return false;
      if (groupFilter !== 'all' && (g.group_name || '') !== groupFilter) return false;
      if (statusFilter !== 'all' && g.status !== statusFilter) return false;
      if (needle) {
        const hay = `${g.name} ${g.group_name} ${g.relation} ${g.room} ${g.note}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [guests, q, sideFilter, groupFilter, statusFilter]);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setSheetOpen(true);
  }

  function openEdit(g: GuestItem) {
    setEditing(g);
    setForm({
      name: g.name,
      party_size: String(g.party_size),
      status: g.status,
      side: g.side || '',
      group_name: g.group_name,
      relation: g.relation,
      room: g.room,
      phone: '',
      note: g.note,
    });
    setSheetOpen(true);
  }

  async function saveGuest(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        t: token,
        name: form.name.trim(),
        party_size: Number(form.party_size) || 1,
        status: form.status,
        side: form.side || null,
        group_name: form.group_name.trim(),
        relation: form.relation.trim(),
        room: form.room.trim(),
        note: form.note.trim(),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      };
      if (editing) {
        await patch(`/api/host/${slug}/guests/${editing.id}`, payload);
      } else {
        await post(`/api/host/${slug}/guests`, payload);
      }
      setSheetOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save guest.');
    } finally {
      setSaving(false);
    }
  }

  async function removeGuest(g: GuestItem) {
    if (!window.confirm(`Remove ${g.name} from your guest list?`)) return;
    await del(`/api/host/${slug}/guests/${g.id}`, { t: token });
    setSelected((s) => {
      const next = new Set(s);
      next.delete(g.id);
      return next;
    });
    await load();
  }

  async function applyBulk(kind: 'group' | 'side') {
    const ids = [...selected];
    if (!ids.length) return;
    if (kind === 'group') {
      await post(`/api/host/${slug}/guests/bulk-update`, { t: token, ids, group_name: bulkGroup.trim() });
      setBulkGroup('');
    } else if (bulkSide) {
      await post(`/api/host/${slug}/guests/bulk-update`, { t: token, ids, side: bulkSide });
      setBulkSide('');
    }
    setSelected(new Set());
    await load();
  }

  function exportCsv() {
    const header = ['Name', 'Side', 'Group', 'Relation', 'Party size', 'Status', 'Room', 'Arrival', 'Note'];
    const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      header.join(','),
      ...filtered.map((g) =>
        [
          g.name,
          g.side ?? '',
          g.group_name,
          g.relation,
          g.party_size,
          g.status,
          g.room,
          g.extracted?.arrival_date ? `${g.extracted.arrival_date} ${g.extracted.arrival_time || ''}`.trim() : '',
          g.note,
        ]
          .map(esc)
          .join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}-guests.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyLink(g: GuestItem) {
    void navigator.clipboard.writeText(g.personal_link).then(() => {
      setCopiedId(g.id);
      setTimeout(() => setCopiedId(''), 1800);
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** AI path: pasted text, a photo/PDF, a voice note, or a sheet we couldn't map. */
  async function runImportPreview(input: { text?: string; image?: Attachment; audio?: Attachment } = { text: importText, image: importImage ?? undefined }) {
    setImportBusy(true);
    setError('');
    try {
      const r = await post<{ guests: ImportGuest[] }>(`/api/host/${slug}/guests/import-preview`, { t: token, ...input });
      const rows = r.guests ?? [];
      if (!rows.length) throw new Error('Saathi could not find any guest names in that. Try another way.');
      setPreviewRows(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not parse guest list.');
    } finally {
      setImportBusy(false);
    }
  }

  /** Spreadsheet path: map columns by their headers, in the browser. */
  async function loadTable(table: unknown[][], source: string) {
    const mapped = mapGuestTable(table);
    if (mapped && mapped.length) {
      setPreviewRows(mapped);
      setImportNote(`${mapped.length} guests read from ${source}. Columns were matched by their headings; nothing was sent to the AI.`);
      return;
    }
    if (mapped) throw new Error(`No guest rows found in ${source}.`);
    // No recognisable "Name" column: let Saathi read it (the server strips phone numbers first).
    setImportNote(`The columns in ${source} weren't recognised, so Saathi read the sheet (phone numbers removed first).`);
    await runImportPreview({ text: tableToText(table) });
  }

  async function onSpreadsheet(file: File | undefined) {
    if (!file) return;
    setImportBusy(true);
    setError('');
    setImportNote('');
    try {
      await loadTable(await readSpreadsheetFile(file), file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file. Save it as .xlsx or .csv and try again.');
    } finally {
      setImportBusy(false);
    }
  }

  async function fetchSheetLink(e: React.FormEvent) {
    e.preventDefault();
    if (!sheetLink.trim()) return;
    setImportBusy(true);
    setError('');
    setImportNote('');
    try {
      const r = await post<{ csv: string }>(`/api/host/${slug}/guests/sheet-link`, { t: token, url: sheetLink.trim() });
      await loadTable(await readCsvText(r.csv), 'your Google Sheet');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that Google Sheet.');
    } finally {
      setImportBusy(false);
    }
  }

  async function commitImport() {
    const rows = previewRows.filter((r) => r.name.trim());
    if (!rows.length) return;
    setImportBusy(true);
    try {
      const r = await post<{ added: number; skipped: number }>(`/api/host/${slug}/guests/bulk`, { t: token, guests: rows });
      setPreviewRows([]);
      setImportText('');
      setImportImage(null);
      setSheetLink('');
      setImportNote('');
      setImportOpen(false);
      setFlash(`Added ${r.added} guest${r.added === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} already on your list were skipped` : ''}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import guests.');
    } finally {
      setImportBusy(false);
    }
  }

  const totalHeads = filtered.filter((g) => g.status !== 'no').reduce((s, g) => s + g.party_size, 0);

  return (
    <div className="pl-section">
      <div className="pl-head">
        <div>
          <p className="eyebrow">Your Wedding</p>
          <h1 className="h2">Guest <span className="serif">list</span></h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {filtered.length} households · {totalHeads} expected people
          </p>
        </div>
        <div className="pl-actions-row">
          <button type="button" className="btn btn-outline btn-sm" aria-expanded={importOpen} onClick={() => setImportOpen((v) => !v)}>
            ⇪ Import list
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={exportCsv}>Export CSV</button>
          <button type="button" className="btn btn-cta btn-sm" onClick={openAdd}>+ Add guest</button>
        </div>
      </div>

      {importOpen && (
        <section className="card card-sm pl-proposal-panel">
          <div className="pl-vc-top" style={{ marginBottom: 8 }}>
            <div>
              <span className="badge ai">✦ Import guests</span>
              <h2 className="h3" style={{ margin: '4px 0 0' }}>Bring in your guest list</h2>
              <p className="muted tiny" style={{ margin: '2px 0 0' }}>
                From Excel, Google Sheets, a photo, WhatsApp text or your voice. Phone numbers are never sent to the AI.
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImportOpen(false)}>Close</button>
          </div>
          {previewRows.length === 0 ? (
            <div className="pl-form-stack" style={{ marginTop: 8, gap: 12 }}>
              <div className="pl-import-grid">
                <div className="pl-import-opt">
                  <b>Excel or CSV file</b>
                  <span className="muted tiny">.xlsx, .xls or .csv, with a header row</span>
                  <button type="button" className="btn btn-outline btn-sm" disabled={importBusy} onClick={() => fileInput.current?.click()}>
                    Choose file
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    hidden
                    accept={SPREADSHEET_ACCEPT}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      void onSpreadsheet(f);
                    }}
                  />
                </div>
                <form className="pl-import-opt" onSubmit={(e) => void fetchSheetLink(e)}>
                  <b>Google Sheets link</b>
                  <span className="muted tiny">Share it as “Anyone with the link”</span>
                  <div className="pl-inline-form">
                    <input
                      type="url"
                      aria-label="Google Sheets link"
                      placeholder="https://docs.google.com/spreadsheets/d/…"
                      value={sheetLink}
                      onChange={(e) => setSheetLink(e.target.value)}
                    />
                    <button type="submit" className="btn btn-outline btn-sm" disabled={importBusy || !sheetLink.trim()}>Fetch</button>
                  </div>
                </form>
                <div className="pl-import-opt">
                  <b>Photo or PDF of a list</b>
                  <span className="muted tiny">Handwritten lists work too</span>
                  <button type="button" className="btn btn-outline btn-sm" disabled={importBusy} onClick={() => photoInput.current?.click()}>
                    Choose photo
                  </button>
                  <input
                    ref={photoInput}
                    type="file"
                    hidden
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      setImportNote('');
                      const image = await fileToAttachment(f, f.name);
                      setImportImage(image);
                      await runImportPreview({ image });
                    }}
                  />
                </div>
                <div className="pl-import-opt">
                  <b>Say the names</b>
                  <span className="muted tiny">Hindi, English or Hinglish</span>
                  <MicButton
                    text="Record names"
                    label="Record guest names"
                    busy={importBusy}
                    onAudio={async (audio) => {
                      setImportNote('');
                      await runImportPreview({ audio });
                    }}
                  />
                </div>
              </div>
              <textarea
                rows={3}
                aria-label="Paste a guest list from WhatsApp or anywhere"
                placeholder={'Or paste lines from WhatsApp, e.g.\nSharma family (4) - Bride side\nRohan & Priya - College friends'}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <div className="pl-row-btns" style={{ justifyContent: 'space-between' }}>
                <span className="muted small" role="status">{importBusy ? 'Reading your list…' : ''}</span>
                <button
                  type="button"
                  className="btn btn-cta btn-sm"
                  disabled={importBusy || !importText.trim()}
                  onClick={() => void runImportPreview({ text: importText })}
                >
                  {importBusy ? 'Reading list…' : 'Preview pasted list →'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              {importNote && <p className="muted small" style={{ margin: '0 0 6px' }}>{importNote}</p>}
              <p className="small" style={{ margin: '0 0 8px' }}>Review and edit before adding ({previewRows.length} guests):</p>
              <div style={{ maxHeight: 320, overflowY: 'auto' }} tabIndex={0} role="region" aria-label="Guests to import">
                <table className="pl-table">
                  <thead>
                    <tr><th>Name</th><th>Party</th><th>Side</th><th>Group</th><th>RSVP</th><th><span className="sr-only">Remove</span></th></tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, idx) => (
                      <tr key={idx}>
                        <td>
                          <input type="text" aria-label={`Name, row ${idx + 1}`} className="pl-cell-input" value={row.name} onChange={(e) => setPreviewRows((p) => p.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))} />
                          {row.phone && <span className="muted tiny">📱 ••{row.phone.slice(-4)}</span>}
                        </td>
                        <td style={{ width: 70 }}><input type="number" aria-label={`Party size, row ${idx + 1}`} min={1} max={20} className="pl-cell-input" value={row.party_size} onChange={(e) => setPreviewRows((p) => p.map((r, i) => (i === idx ? { ...r, party_size: Number(e.target.value) || 1 } : r)))} /></td>
                        <td>
                          <select aria-label={`Side, row ${idx + 1}`} className="pl-cell-input" value={row.side} onChange={(e) => setPreviewRows((p) => p.map((r, i) => (i === idx ? { ...r, side: e.target.value } : r)))}>
                            <option value="">—</option><option value="bride">Bride</option><option value="groom">Groom</option><option value="both">Both</option>
                          </select>
                        </td>
                        <td><input type="text" aria-label={`Group, row ${idx + 1}`} className="pl-cell-input" value={row.group_name} onChange={(e) => setPreviewRows((p) => p.map((r, i) => (i === idx ? { ...r, group_name: e.target.value } : r)))} /></td>
                        <td>
                          <select aria-label={`RSVP, row ${idx + 1}`} className="pl-cell-input" value={row.status || 'pending'} onChange={(e) => setPreviewRows((p) => p.map((r, i) => (i === idx ? { ...r, status: e.target.value } : r)))}>
                            <option value="pending">Pending</option><option value="yes">Coming</option><option value="maybe">Maybe</option><option value="no">Can&apos;t come</option>
                          </select>
                        </td>
                        <td><button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${row.name || `row ${idx + 1}`}`} onClick={() => setPreviewRows((p) => p.filter((_, i) => i !== idx))}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pl-wizard-actions" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPreviewRows([]); setImportNote(''); }}>← Back</button>
                <button type="button" className="btn btn-cta btn-sm" disabled={importBusy} onClick={() => void commitImport()}>
                  {importBusy ? 'Adding…' : `Add ${previewRows.length} guests`}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {error && <div className="card card-sm pl-err-box" role="alert"><span className="badge bad">Error</span><p>{error}</p></div>}
      {flash && !error && (
        <div className="card card-sm pl-err-box" role="status">
          <span className="badge ok">Done</span><p>{flash}</p>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Dismiss" onClick={() => setFlash('')}>✕</button>
        </div>
      )}

      <section className="card card-sm pl-filters-card">
        <input
          type="text"
          aria-label="Search guests"
          placeholder="Search by name, group, relation or room…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="pl-filter-groups">
          <div className="pl-chip-row" role="group" aria-label="Filter by status">
            {(['all', 'yes', 'maybe', 'pending', 'no'] as const).map((st) => (
              <button
                key={st}
                type="button"
                className={`chip ${statusFilter === st ? 'on' : ''}`}
                aria-pressed={statusFilter === st}
                onClick={() => setStatusFilter(st)}
              >
                {st === 'all' ? 'All statuses' : STATUS_BADGE[st].label}
              </button>
            ))}
          </div>
          <div className="pl-chip-row" role="group" aria-label="Filter by side">
            {(['all', 'bride', 'groom', 'both'] as const).map((sd) => (
              <button
                key={sd}
                type="button"
                className={`chip ${sideFilter === sd ? 'on' : ''}`}
                aria-pressed={sideFilter === sd}
                onClick={() => setSideFilter(sd)}
              >
                {sd === 'all' ? 'All sides' : sd === 'bride' ? 'Bride' : sd === 'groom' ? 'Groom' : 'Both'}
              </button>
            ))}
          </div>
          {groups.length > 0 && (
            <div className="pl-chip-row" role="group" aria-label="Filter by group">
              <button type="button" className={`chip ${groupFilter === 'all' ? 'on' : ''}`} aria-pressed={groupFilter === 'all'} onClick={() => setGroupFilter('all')}>
                All groups
              </button>
              {groups.map((grp) => (
                <button key={grp} type="button" className={`chip ${groupFilter === grp ? 'on' : ''}`} aria-pressed={groupFilter === grp} onClick={() => setGroupFilter(grp)}>
                  {grp}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {selected.size > 0 && (
        <div className="card card-sm pl-bulk-bar">
          <b>{selected.size} selected</b>
          <div className="pl-bulk-controls">
            <input
              type="text"
              aria-label="Group name for selected guests"
              placeholder="Set group…"
              value={bulkGroup}
              onChange={(e) => setBulkGroup(e.target.value)}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void applyBulk('group')}>Set group</button>
            <select aria-label="Side for selected guests" value={bulkSide} onChange={(e) => setBulkSide(e.target.value)}>
              <option value="">Set side…</option>
              <option value="bride">Bride</option>
              <option value="groom">Groom</option>
              <option value="both">Both</option>
            </select>
            <button type="button" className="btn btn-outline btn-sm" disabled={!bulkSide} onClick={() => void applyBulk('side')}>Apply side</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card pl-skeleton" />
      ) : filtered.length === 0 ? (
        <div className="card pl-empty-card">
          <span className="pl-empty-orb" aria-hidden>💌</span>
          <h3>No guests match</h3>
          <p className="muted small">Add guests manually or share your invitation link so RSVPs appear here automatically.</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>+ Add guest</button>
        </div>
      ) : (
        <>
          <div className="card pl-table-card pl-desktop-only" tabIndex={0} role="region" aria-label="Guest list table">
            <table className="pl-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all visible guests"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((g) => g.id)) : new Set())}
                    />
                  </th>
                  <th scope="col">Guest</th>
                  <th scope="col">Side / Group</th>
                  <th scope="col">Party</th>
                  <th scope="col">Status</th>
                  <th scope="col">Room</th>
                  <th scope="col">Arrival</th>
                  <th scope="col" className="pl-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => {
                  const st = STATUS_BADGE[g.status];
                  return (
                    <tr key={g.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${g.name}`}
                          checked={selected.has(g.id)}
                          onChange={() => toggleOne(g.id)}
                        />
                      </td>
                      <td>
                        <b>{g.name}</b>
                        {g.relation && <div className="muted tiny">{g.relation}</div>}
                        {g.phone_masked && <div className="muted tiny">{g.phone_masked}</div>}
                      </td>
                      <td>
                        <div className="pl-badges-inline">
                          {g.side && <span className="badge">{g.side}</span>}
                          {g.group_name && <span className="badge">{g.group_name}</span>}
                        </div>
                      </td>
                      <td className="num">{g.party_size}</td>
                      <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                      <td>{g.room || <span className="muted">—</span>}</td>
                      <td className="small">
                        {g.extracted?.arrival_date
                          ? `${fmtDate(g.extracted.arrival_date, { day: 'numeric', month: 'short' })}${g.extracted.arrival_time ? ` ${fmtTime(g.extracted.arrival_time)}` : ''}`
                          : <span className="muted">—</span>}
                      </td>
                      <td className="pl-right">
                        <div className="pl-row-btns">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyLink(g)}>
                            {copiedId === g.id ? 'Copied' : 'Invite link'}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(g)}>Edit</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeGuest(g)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pl-mobile-only pl-card-stack">
            {filtered.map((g) => {
              const st = STATUS_BADGE[g.status];
              return (
                <article key={g.id} className="card card-sm pl-guest-mobile">
                  <div className="pl-gm-top">
                    <label className="pl-gm-check">
                      <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleOne(g.id)} />
                      <b>{g.name}</b>
                    </label>
                    <span className={`badge ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="pl-badges-inline">
                    <span className="badge">{g.party_size} {g.party_size === 1 ? 'person' : 'people'}</span>
                    {g.side && <span className="badge">{g.side}</span>}
                    {g.group_name && <span className="badge">{g.group_name}</span>}
                    {g.room && <span className="badge">Room {g.room}</span>}
                  </div>
                  {g.extracted?.arrival_date && (
                    <p className="muted tiny" style={{ margin: '6px 0 0' }}>
                      Arrives {fmtDate(g.extracted.arrival_date, { day: 'numeric', month: 'short' })}
                      {g.extracted.arrival_time ? ` ${fmtTime(g.extracted.arrival_time)}` : ''}
                    </p>
                  )}
                  <div className="pl-row-btns" style={{ marginTop: 10 }}>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => copyLink(g)}>
                      {copiedId === g.id ? 'Copied ✓' : 'Copy link'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(g)}>Edit</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeGuest(g)}>Delete</button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {sheetOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setSheetOpen(false)} aria-hidden />
          <aside className="saathi-drawer open" aria-label={editing ? 'Edit guest' : 'Add guest'}>
            <header className="drawer-head">
              <h2>{editing ? 'Edit guest' : 'Add guest'}</h2>
              <button type="button" className="icon-btn" onClick={() => setSheetOpen(false)} aria-label="Close">✕</button>
            </header>
            <form className="pl-sheet-form" onSubmit={(e) => void saveGuest(e)}>
              <label>
                Full name *
                <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sharma Family" />
              </label>
              <div className="pl-form-row">
                <label>
                  Party size
                  <input type="number" min={1} max={20} value={form.party_size} onChange={(e) => setForm({ ...form, party_size: e.target.value })} />
                </label>
                <label>
                  Status
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as GuestItem['status'] })}>
                    <option value="pending">Pending</option>
                    <option value="yes">Coming</option>
                    <option value="maybe">Maybe</option>
                    <option value="no">Can&apos;t come</option>
                  </select>
                </label>
              </div>
              <div className="pl-form-row">
                <label>
                  Side
                  <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as typeof form.side })}>
                    <option value="">Unspecified</option>
                    <option value="bride">Bride</option>
                    <option value="groom">Groom</option>
                    <option value="both">Both</option>
                  </select>
                </label>
                <label>
                  Group
                  <input type="text" value={form.group_name} onChange={(e) => setForm({ ...form, group_name: e.target.value })} placeholder="e.g. Close Family" />
                </label>
              </div>
              <div className="pl-form-row">
                <label>
                  Relation
                  <input type="text" value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })} placeholder="e.g. Chacha ji" />
                </label>
                <label>
                  Room
                  <input type="text" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="e.g. 204" />
                </label>
              </div>
              <label>
                Phone <span className="muted">(optional, only for WhatsApp links)</span>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder={editing?.phone_masked ? `Current: ${editing.phone_masked}` : '+91 98765 43210'} />
              </label>
              <label>
                Notes
                <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Dietary needs, arrival info…" />
              </label>
              <div className="pl-wizard-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setSheetOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-cta" disabled={saving}>{saving ? 'Saving…' : 'Save guest'}</button>
              </div>
            </form>
          </aside>
        </>
      )}
    </div>
  );
}

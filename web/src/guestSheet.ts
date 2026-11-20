// Read a guest list from Excel / CSV / Google Sheets and map its columns.
// Mapping is done here, in the browser, by header names: phone numbers in
// the file never go to a model. Only an unrecognisable sheet falls back to
// Gemini, and then the server strips phone numbers first.

export interface ImportGuest {
  name: string;
  party_size: number;
  side: string; // 'bride' | 'groom' | 'both' | ''
  group_name: string;
  relation: string;
  status?: string; // 'yes' | 'no' | 'maybe' | 'pending'
  room?: string;
  note?: string;
  phone?: string;
}

type Field = 'name' | 'first' | 'last' | 'party' | 'adults' | 'kids' | 'side' | 'group' | 'relation' | 'phone' | 'status' | 'room' | 'note';

// Checked in this order; earlier fields win a column. Keys are lowercase letters only.
const SYNONYMS: [Field, string[]][] = [
  ['first', ['firstname', 'first', 'givenname']],
  ['last', ['lastname', 'surname', 'last', 'familyname']],
  ['name', ['name', 'names', 'guestname', 'guest', 'guests', 'fullname', 'invitee', 'inviteename', 'family', 'household', 'naam', 'guestfamily', 'nameofguest', 'guestnames']],
  ['party', ['partysize', 'party', 'pax', 'count', 'people', 'members', 'noofguests', 'numberofguests', 'guestcount', 'headcount', 'persons', 'noofpeople', 'noofpersons', 'totalguests', 'total', 'familymembers', 'noofmembers', 'size', 'noofpax']],
  ['adults', ['adults', 'adult', 'noofadults']],
  ['kids', ['kids', 'children', 'child', 'noofkids', 'noofchildren']],
  ['side', ['side', 'whichside', 'brideorgroom', 'bridegroom', 'brideside', 'groomside', 'guestof']],
  ['group', ['group', 'groupname', 'category', 'circle', 'tag', 'type', 'list']],
  ['relation', ['relation', 'relationship', 'rishta', 'relationwith', 'relationtocouple', 'howknown']],
  ['phone', ['phone', 'phonenumber', 'phoneno', 'mobile', 'mobilenumber', 'mobileno', 'mob', 'contact', 'contactnumber', 'contactno', 'whatsapp', 'whatsappnumber', 'whatsappno', 'cell', 'number', 'tel']],
  ['status', ['rsvp', 'rsvpstatus', 'status', 'attending', 'coming', 'confirmed', 'response', 'confirmation']],
  ['room', ['room', 'roomno', 'roomnumber', 'hotelroom', 'accommodation']],
  ['note', ['notes', 'note', 'remarks', 'remark', 'comments', 'comment', 'dietary', 'food', 'meal', 'diet']],
];

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** Which column holds which field, or null if no name column is recognisable. */
export function detectColumns(header: string[]): Partial<Record<Field, number>> | null {
  const keys = header.map(norm);
  const found: Partial<Record<Field, number>> = {};
  const taken = new Set<number>();
  // Pass 1: exact header matches. Pass 2: headers that contain a synonym of
  // 5+ letters (e.g. "Guest name (as on card)"), longest synonym first.
  for (const exact of [true, false]) {
    for (const [field, words] of SYNONYMS) {
      if (found[field] !== undefined) continue;
      const sorted = exact ? words : [...words].filter((w) => w.length >= 5).sort((a, b) => b.length - a.length);
      for (const w of sorted) {
        const idx = keys.findIndex((k, i) => !taken.has(i) && k && (exact ? k === w : k.includes(w)));
        if (idx >= 0) {
          found[field] = idx;
          taken.add(idx);
          break;
        }
      }
    }
  }
  if (found.name === undefined && found.first === undefined) {
    // A lone "Family name" column is the household name, not a surname.
    if (found.last === undefined) return null;
    found.name = found.last;
    delete found.last;
  }
  return found;
}

export function normSide(v: unknown): string {
  const s = String(v ?? '').toLowerCase();
  if (/both|common|mutual|dono/.test(s)) return 'both';
  if (/bride|girl|ladki|dulhan|vadhu|^b$/.test(s)) return 'bride';
  if (/groom|boy|ladka|dulha|var\b|^g$/.test(s)) return 'groom';
  return '';
}

export function normStatus(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return 'pending';
  if (/^(no|n|not coming|declined?|regrets?|can'?t come|cannot come|nahi)$/.test(s)) return 'no';
  if (/^(maybe|tentative|not sure|shayad)$/.test(s)) return 'maybe';
  if (/^(yes|y|coming|attending|confirmed|accepted|haan|ha|✓|✔|true|1)$/.test(s)) return 'yes';
  return 'pending';
}

const int = (v: unknown) => Number.parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);

/**
 * Turn a sheet (array of rows) into guests. Returns null when no header row
 * with a name column is found in the first 10 rows.
 */
export function mapGuestTable(table: unknown[][]): ImportGuest[] | null {
  const rows = table.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []));
  // The header is the row (in the first 10) that matches the most fields. A
  // one-cell row ("Wedding guest list 2027") only counts if it says exactly "Name".
  let headerAt = -1;
  let cols: Partial<Record<Field, number>> | null = null;
  let best = 0;
  const nameWords = SYNONYMS.find(([f]) => f === 'name')?.[1] ?? [];
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].filter(Boolean);
    if (!cells.length || (cells.length === 1 && !nameWords.includes(norm(cells[0])))) continue;
    const found = detectColumns(rows[i]);
    const score = found ? Object.keys(found).length : 0;
    if (score > best) {
      best = score;
      cols = found;
      headerAt = i;
    }
  }
  if (!cols) return null;
  const c = cols;
  const cell = (r: string[], f: Field) => (c[f] !== undefined ? r[c[f] as number] ?? '' : '');
  const out: ImportGuest[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    const name = (cell(r, 'name') || [cell(r, 'first'), cell(r, 'last')].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
    if (!name || /^(total|grand total|sum)$/i.test(name)) continue;
    let party = int(cell(r, 'party'));
    if (!party) {
      const adults = int(cell(r, 'adults')) || 0;
      const kids = int(cell(r, 'kids')) || 0;
      party = adults + kids;
    }
    const phoneRaw = cell(r, 'phone').replace(/[^\d+]/g, '');
    out.push({
      name: name.slice(0, 80),
      party_size: Math.min(20, Math.max(1, party || 1)),
      side: normSide(cell(r, 'side')),
      group_name: cell(r, 'group').slice(0, 80),
      relation: cell(r, 'relation').slice(0, 80),
      status: normStatus(cell(r, 'status')),
      room: cell(r, 'room').slice(0, 60),
      note: cell(r, 'note').slice(0, 600),
      phone: phoneRaw.replace(/\D/g, '').length >= 10 ? phoneRaw : '',
    });
  }
  return out;
}

/** A sheet as plain text for the AI fallback (the server strips phones). */
export function tableToText(table: unknown[][]): string {
  return table
    .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()).filter(Boolean).join(' | ') : ''))
    .filter(Boolean)
    .join('\n')
    .slice(0, 30_000);
}

type SheetJs = typeof import('xlsx');
let xlsx: Promise<SheetJs> | null = null;
const loadXlsx = () => (xlsx ??= import('xlsx'));

function firstSheetRows(X: SheetJs, wb: import('xlsx').WorkBook): unknown[][] {
  for (const name of wb.SheetNames) {
    const rows = X.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    if (rows.some((r) => r.some((c) => String(c).trim()))) return rows;
  }
  return [];
}

/** Read the first non-empty sheet of an .xlsx / .xls / .ods / .csv file. */
export async function readSpreadsheetFile(file: File): Promise<unknown[][]> {
  const X = await loadXlsx();
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  const wb = isCsv ? X.read(await file.text(), { type: 'string' }) : X.read(await file.arrayBuffer(), { type: 'array' });
  return firstSheetRows(X, wb);
}

/** Parse CSV text (e.g. a Google Sheet export) into rows. */
export async function readCsvText(csv: string): Promise<unknown[][]> {
  const X = await loadXlsx();
  return firstSheetRows(X, X.read(csv, { type: 'string' }));
}

export const SPREADSHEET_ACCEPT =
  '.csv,.xlsx,.xls,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet';

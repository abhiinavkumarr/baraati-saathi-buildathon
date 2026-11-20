export interface WeddingEvent {
  name: string;
  date: string;
  start_time: string;
  venue_name: string;
  venue_address: string;
  dress_code: string;
  notes: string;
}

export interface WeddingDraft {
  partner1_name: string;
  partner2_name: string;
  partner1_family: string;
  partner2_family: string;
  invite_line: string;
  city: string;
  tradition: string;
  language: string;
  style: string;
  events: WeddingEvent[];
  info: { question: string; answer: string }[];
  contact_name: string;
  contact_phone: string;
  logo_asset_id?: string;
}

export interface Attachment {
  mime_type: string;
  data: string;
  name?: string;
}

export interface IntakeResponse {
  reply: string;
  draft: WeddingDraft;
  missing: string[];
  ready: boolean;
  suggested_replies: string[];
}

export interface StoredSession {
  session: string;
  user: { id: string; name: string };
}

const SESSION_KEY = 'saathi:session';

export function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.session === 'string' && parsed.session && parsed.user?.id && parsed.user?.name) {
      return { session: parsed.session, user: { id: parsed.user.id, name: parsed.user.name } };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveStoredSession(s: StoredSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function clearStoredSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function authHeaders(extra?: Record<string, string>, sessionToken?: string): Record<string, string> {
  const token = sessionToken ?? readStoredSession()?.session;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra ?? {}),
  };
}

export async function apiJson<T>(url: string, init: RequestInit = {}, sessionToken?: string): Promise<T> {
  const headers = authHeaders(init.headers as Record<string, string> | undefined, sessionToken);
  const res = await fetch(url, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export async function post<T>(url: string, body: unknown, sessionToken?: string): Promise<T> {
  return apiJson<T>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    sessionToken,
  );
}

export async function patch<T>(url: string, body: unknown, sessionToken?: string): Promise<T> {
  return apiJson<T>(
    url,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    sessionToken,
  );
}

export async function del<T>(url: string, body?: unknown, sessionToken?: string): Promise<T> {
  return apiJson<T>(
    url,
    {
      method: 'DELETE',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    sessionToken,
  );
}

export function fileToAttachment(file: Blob, name?: string): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve({ mime_type: file.type || 'application/octet-stream', data: s.slice(s.indexOf(',') + 1), name });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Indian rupee compact formatting: ₹4.5 L, ₹1.2 Cr, or ₹25,000. */
export function fmtInr(amount: number): string {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(abs >= 10_00_00_000 ? 1 : 2).replace(/\.?0+$/, '')} Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(abs >= 10_00_000 ? 1 : 2).replace(/\.?0+$/, '')} L`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export function fmtInrFull(amount: number): string {
  const n = Number(amount) || 0;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

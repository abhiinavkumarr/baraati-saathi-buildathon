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

export async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
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

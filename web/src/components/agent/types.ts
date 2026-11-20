export interface Proposal {
  id: string;
  kind:
    | 'event_change'
    | 'announcement'
    | 'info_card'
    | 'question_answer'
    | 'reminders'
    | 'tasks'
    | 'vendor'
    | 'vendor_bundle'
    | 'payment'
    | 'budget_line'
    | 'rooming'
    | 'pickups';
  title: string;
  detail: string;
  payload: Record<string, unknown>;
}

export interface QueryData {
  question: string;
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  ms: number;
}

export interface Msg {
  role: 'host' | 'saathi';
  text: string;
  voice?: boolean;
  proposals?: Proposal[];
  data?: QueryData | null;
}

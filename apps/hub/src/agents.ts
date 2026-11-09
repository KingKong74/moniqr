/** The slice of the agent API the hub uses. Every call carries the hub's API token. */

export const RUN_KINDS = ['morning_brief', 'test'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export interface Brief {
  id: number;
  kind: string;
  body_md: string;
  summary: string;
  created_at: string;
}

export interface RunSummary {
  id: number;
  agent: string;
  trigger: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  queued_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
}

export interface CalendarEvent {
  id?: string;
  calendarId?: string;
  calendar: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  response?: string;
}

export interface CalendarData {
  status: 'connected' | 'disconnected' | 'error';
  events: CalendarEvent[];
}

export interface EmailFinding {
  id: number;
  message_id: string;
  thread_id: string;
  category: 'bill' | 'commitment' | 'reply';
  sender: string;
  subject: string;
  received_at: string;
  summary: string;
  evidence: string;
  deadline_text: string;
  missing_details: string[];
  status: 'new' | 'reviewed' | 'dismissed';
}

export interface FindingsData {
  items: EmailFinding[];
  total: number;
  scan: null | {
    run_id: number;
    run_status: 'queued' | 'running' | 'done' | 'failed';
    status: 'scanning' | 'completed' | 'partial' | 'failed' | null;
    updated_at: string | null;
    last_success_at: string | null;
    failures: number | null;
  };
}

export interface ActionProposal {
  id: number;
  finding_id: number | null;
  kind: 'manual' | 'calendar_create';
  title: string;
  detail: string;
  revision: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expires_at: string | null;
  decided_at: string | null;
  execution_status: string;
  execution_mode: 'record_only' | 'enabled';
  proposed_action: {
    instructions: string;
    calendar: null | { title: string; start: string | null; end: string | null; timeZone: string; location: string };
    target_calendar: string | null;
    missing_details: string[];
  } | null;
  source_snapshot: { subject?: string; sender?: string; evidence?: string; deadline_text?: string; thread_id?: string; missing_details?: string[] };
  blocked_reasons: string[];
  can_approve: boolean;
  can_prepare?: boolean;
  can_execute?: boolean;
  can_undo?: boolean;
  calendar_event_id?: string | null;
  calendar_target_id?: string | null;
  execution_error?: string | null;
  executed_at?: string | null;
}
export interface ActionsData { items: ActionProposal[]; total: number; pending: number; calendar_write_ready?: boolean; target_calendar?: string | null; }

export class AgentApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface AgentsClient {
  actions(): Promise<ActionsData>;
  actionDetail(id: number): Promise<{ action: ActionProposal; events: { id: number; revision: number; event_type: string; actor: string; created_at: string }[] }>;
  decideAction(id: number, decision: 'approved' | 'rejected', revision: number): Promise<ActionProposal | void>;
  calendarAction?(id: number, operation: 'prepare' | 'execute' | 'undo', revision: number): Promise<ActionProposal>;
  findings(): Promise<FindingsData>;
  setFindingStatus(id: number, status: EmailFinding['status']): Promise<void>;
  calendar(): Promise<CalendarData>;
  latestBrief(): Promise<Brief | null>;
  recentRuns(limit: number): Promise<RunSummary[]>;
  queueRun(kind: RunKind): Promise<void>;
}

export function agentsClient(baseUrl: string, token: string): AgentsClient {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(path.startsWith('/actions/') && method === 'POST' ? 60_000 : path === '/calendar' ? 30_000 : 5000),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({})) as { error?: string };
      throw new AgentApiError(res.status, error.error ?? `Agent API ${method} ${path} returned ${res.status}`);
    }
    return (await res.json()) as T;
  };

  return {
    actions: () => call<ActionsData>('GET', '/actions'),
    actionDetail: (id) => call('GET', `/actions/${id}`),
    decideAction: async (id, decision, revision) => (await call<{ action: ActionProposal }>('POST', `/actions/${id}/decision`, { decision, revision })).action,
    calendarAction: async (id, operation, revision) => (await call<{ action: ActionProposal }>('POST', `/actions/${id}/${operation}`, { revision })).action,
    findings: () => call<FindingsData>('GET', '/findings'),
    setFindingStatus: async (id, status) => { await call('PATCH', `/findings/${id}`, { status }); },
    calendar: () => call<CalendarData>('GET', '/calendar'),
    latestBrief: async () => (await call<{ brief: Brief | null }>('GET', '/briefs/latest')).brief,
    recentRuns: async (limit) => (await call<{ runs: RunSummary[] }>('GET', `/runs?limit=${limit}`)).runs,
    queueRun: async (kind) => {
      await call('POST', '/agents/ea/run', { kind });
    },
  };
}

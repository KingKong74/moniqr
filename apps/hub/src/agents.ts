/** The slice of the agent API the hub uses. Every call carries the hub's API token. */

export const RUN_KINDS = ['morning_brief', 'afternoon_brief', 'test'] as const;
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
  /** The worker agent that first saved it; null when the EA did. */
  found_by?: string | null;
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
  origin?: 'ea' | 'owner';
  proposed_action: {
    instructions: string;
    calendar: null | { type?: 'event' | 'reminder'; title: string; start: string | null; end: string | null; timeZone: string; location: string };
    target_calendar: string | null;
    missing_details: string[];
  } | null;
  source_snapshot: { demo?: boolean; subject?: string; sender?: string; evidence?: string; deadline_text?: string; thread_id?: string; missing_details?: string[] };
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
export interface ActionsData { items: ActionProposal[]; total: number; pending: number; demo_pending?: number; calendar_write_ready?: boolean; target_calendar?: string | null; }

/** Brisbane wall-clock fields; a reminder is all-day, an event needs both times. */
export interface CalendarEntryInput {
  type: 'event' | 'reminder'; title: string; date: string; start_time?: string; end_time?: string; location?: string;
}

export class AgentApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface BacklogStep { t: string; done: boolean }
export interface BacklogItem {
  id: number; title: string; notes: string;
  status: 'backlog' | 'next' | 'doing' | 'done'; priority: 'low' | 'normal' | 'high';
  steps: BacklogStep[]; position: number; created_at: string; updated_at: string;
}
/** A new item, or the fields to change on one. place moves it to the top or bottom of its status. */
export type BacklogWrite = Partial<Pick<BacklogItem, 'title' | 'notes' | 'status' | 'priority' | 'steps'>> & { place?: 'top' | 'bottom' };
export interface BriefSettings {
  timezone: string;
  schedules: {
    kind: string; cron: string; enabled: boolean; timezone: string; next_run_at: string | null; last_run_at: string | null;
    /** The latest finished run of this kind, scheduled or manual. */
    last_run: {
      id: number; trigger: string; status: 'done' | 'failed'; queued_at: string; finished_at: string | null; error: string | null;
      email_status: 'scanning' | 'completed' | 'partial' | 'failed' | null; email_searches: number | null;
      email_read: number | null; email_failures: number | null; has_brief: boolean;
    } | null;
    active_run: { id: number; trigger: string; status: 'queued' | 'running'; queued_at: string } | null;
    last_success_at: string | null;
  }[];
}
export interface BriefSettingsInput {
  morning: string; afternoon: string; morning_enabled: boolean; afternoon_enabled: boolean;
}

/** A console turn: Bailey's are `user`, earlier replies are `moniqr`. */
export interface ChatMessage { role: 'user' | 'moniqr'; text: string }
export interface ChatStatus {
  id: number; status: 'queued' | 'running' | 'done' | 'failed'; started_at: string | null;
  reply: string | null; tools: string[]; error: string | null;
}

export interface Checkin { id: number; mood: number; energy: number | null; note: string; created_at: string; updated_at: string }
export interface DailyPick { items: { kind: string; text: string; sub: string }[]; created_at: string }
export type CheckinWrite = Partial<Pick<Checkin, 'mood' | 'energy' | 'note'>>;

/** The workforce: agents Bailey manages that work for the EA. */
export interface WorkerTool { label: string; detail: string; level: 'read' | 'write'; google?: boolean; requires?: string }
export interface WorkforceAgent {
  id: number; slug: string; name: string; role: 'worker'; description: string; instructions_md: string;
  tools: string[]; enabled: boolean; created_at: string; updated_at: string;
  reports?: number; active?: number;
  last_run?: { id: number; status: RunSummary['status']; trigger: string; queued_at: string; finished_at: string | null; error: string | null } | null;
}
export interface AgentChange {
  id: number; run_id: number; kind: 'create' | 'update' | 'pause' | 'resume'; change: Record<string, unknown>; reason: string;
  status: 'pending' | 'approved' | 'rejected'; created_at: string; decided_at: string | null;
  agent_slug: string | null; agent_name: string | null; current_description: string | null; current_instructions: string | null; current_tools: string[] | null;
}
export interface Workforce { agents: WorkforceAgent[]; changes: AgentChange[]; tools: Record<string, WorkerTool> }
export interface WorkforceDetail {
  agent: WorkforceAgent;
  runs: { id: number; trigger: string; status: RunSummary['status']; task: string | null; parent_run_id: number | null; queued_at: string; finished_at: string | null; duration_ms: number | null; error: string | null }[];
  reports: { id: number; run_id: number; body_md: string; summary: string; created_at: string; html?: string }[];
  schedules: AgentSchedule[];
}
export interface AgentSchedule {
  id: number; cron: string; timezone: string; task: string; enabled: boolean; next_run_at: string | null; last_run_at: string | null;
  last_run: { id: number; status: RunSummary['status']; queued_at: string } | null;
}
export type AgentScheduleWrite = Partial<Pick<AgentSchedule, 'cron' | 'task' | 'enabled'>>;
export type WorkforceAgentWrite = Partial<Pick<WorkforceAgent, 'slug' | 'name' | 'description' | 'instructions_md' | 'tools' | 'enabled'>>;

export interface AgentsClient {
  workforce?(): Promise<Workforce>;
  workforceAgent?(slug: string): Promise<WorkforceDetail>;
  saveWorkforceAgent?(agent: WorkforceAgentWrite, slug?: string): Promise<{ agent: WorkforceAgent }>;
  queueWorkforceTask?(slug: string, task: string): Promise<{ run: { id: number } }>;
  addAgentSchedule?(slug: string, schedule: AgentScheduleWrite): Promise<{ schedule: AgentSchedule }>;
  updateAgentSchedule?(id: number, patch: AgentScheduleWrite): Promise<{ schedule: AgentSchedule }>;
  deleteAgentSchedule?(id: number): Promise<{ id: number; deleted: true }>;
  decideAgentChange?(id: number, decision: 'approved' | 'rejected'): Promise<{ id: number; status: string; agent: WorkforceAgent | null }>;
  /** Queue a read-only console reply. 409 while the last message is still being answered. */
  chat?(messages: ChatMessage[]): Promise<{ id: number }>;
  chatStatus?(id: number): Promise<ChatStatus>;
  backlog?(): Promise<{ items: BacklogItem[] }>;
  saveBacklog?(item: BacklogWrite, id?: number): Promise<{ item: BacklogItem }>;
  checkins?(): Promise<{ items: Checkin[] }>;
  dailyPick?(): Promise<DailyPick | null>;
  saveCheckin?(item: CheckinWrite, id?: number): Promise<{ item: Checkin }>;
  settings?(): Promise<BriefSettings>;
  saveSettings?(settings: BriefSettingsInput): Promise<BriefSettings>;
  actions(): Promise<ActionsData>;
  actionDetail(id: number): Promise<{ action: ActionProposal; events: { id: number; revision: number; event_type: string; actor: string; created_at: string }[] }>;
  decideAction(id: number, decision: 'approved' | 'rejected', revision: number): Promise<ActionProposal | void>;
  calendarAction?(id: number, operation: 'prepare' | 'execute' | 'undo', revision: number): Promise<ActionProposal>;
  findings(): Promise<FindingsData>;
  addFindingToCalendar?(id: number, entry: CalendarEntryInput): Promise<ActionProposal>;
  setFindingStatus(id: number, status: EmailFinding['status']): Promise<void>;
  calendar(): Promise<CalendarData>;
  latestBrief(): Promise<Brief | null>;
  recentRuns(limit: number): Promise<RunSummary[]>;
  /** existing is true when a run of this kind was already queued or running and no new one started. */
  queueRun(kind: RunKind): Promise<{ existing: boolean } | void>;
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
      signal: AbortSignal.timeout(path.match(/^\/(actions|findings)\/\d+\/(decision|prepare|execute|undo|calendar)$/) && method === 'POST' ? 60_000 : path === '/calendar' ? 30_000 : 5000),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({})) as { error?: string; issues?: { message?: string }[] };
      // A validation failure names its first problem, so the page can say what to fix.
      const issue = error.issues?.[0]?.message;
      throw new AgentApiError(res.status, issue ? `${error.error ?? 'Invalid request'}: ${issue}` : error.error ?? `Agent API ${method} ${path} returned ${res.status}`);
    }
    return (await res.json()) as T;
  };

  return {
    workforce: () => call('GET', '/workforce'),
    workforceAgent: (slug) => call('GET', `/workforce/agents/${encodeURIComponent(slug)}`),
    saveWorkforceAgent: (agent, slug) => call(slug ? 'PATCH' : 'POST', slug ? `/workforce/agents/${encodeURIComponent(slug)}` : '/workforce/agents', agent),
    queueWorkforceTask: (slug, task) => call('POST', `/workforce/agents/${encodeURIComponent(slug)}/tasks`, { task }),
    addAgentSchedule: (slug, schedule) => call('POST', `/workforce/agents/${encodeURIComponent(slug)}/schedules`, schedule),
    updateAgentSchedule: (id, patch) => call('PATCH', `/workforce/schedules/${id}`, patch),
    deleteAgentSchedule: (id) => call('DELETE', `/workforce/schedules/${id}`),
    decideAgentChange: (id, decision) => call('POST', `/workforce/changes/${id}/decision`, { decision }),
    chat: async (messages) => ({ id: (await call<{ run: { id: number } }>('POST', '/chat', { messages })).run.id }),
    chatStatus: (id) => call('GET', `/chat/${id}`),
    backlog: () => call('GET', '/backlog'),
    saveBacklog: (item, id) => call(id ? 'PATCH' : 'POST', id ? `/backlog/${id}` : '/backlog', item),
    checkins: () => call('GET', '/checkins'),
    dailyPick: async () => (await call<{ pick: DailyPick | null }>('GET', '/daily-pick')).pick,
    saveCheckin: (item, id) => call(id ? 'PATCH' : 'POST', id ? `/checkins/${id}` : '/checkins', item),
    settings: () => call('GET', '/settings'),
    saveSettings: (settings) => call('PUT', '/settings', settings),
    actions: () => call<ActionsData>('GET', '/actions'),
    actionDetail: (id) => call('GET', `/actions/${id}`),
    decideAction: async (id, decision, revision) => (await call<{ action: ActionProposal }>('POST', `/actions/${id}/decision`, { decision, revision })).action,
    calendarAction: async (id, operation, revision) => (await call<{ action: ActionProposal }>('POST', `/actions/${id}/${operation}`, { revision })).action,
    findings: () => call<FindingsData>('GET', '/findings'),
    addFindingToCalendar: async (id, entry) => (await call<{ action: ActionProposal }>('POST', `/findings/${id}/calendar`, entry)).action,
    setFindingStatus: async (id, status) => { await call('PATCH', `/findings/${id}`, { status }); },
    calendar: () => call<CalendarData>('GET', '/calendar'),
    latestBrief: async () => (await call<{ brief: Brief | null }>('GET', '/briefs/latest')).brief,
    recentRuns: async (limit) => (await call<{ runs: RunSummary[] }>('GET', `/runs?limit=${limit}`)).runs,
    queueRun: async (kind) => ({ existing: (await call<{ existing?: boolean }>('POST', '/agents/ea/run', { kind })).existing === true }),
  };
}

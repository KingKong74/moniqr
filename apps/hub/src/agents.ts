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

export interface AgentsClient {
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
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Agent API ${method} ${path} returned ${res.status}`);
    return (await res.json()) as T;
  };

  return {
    latestBrief: async () => (await call<{ brief: Brief | null }>('GET', '/briefs/latest')).brief,
    recentRuns: async (limit) => (await call<{ runs: RunSummary[] }>('GET', `/runs?limit=${limit}`)).runs,
    queueRun: async (kind) => {
      await call('POST', '/agents/ea/run', { kind });
    },
  };
}

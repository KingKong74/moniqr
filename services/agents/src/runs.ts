import type { Pool } from './db.js';
import { withTransaction } from './db.js';
import { hashToken, newToken, safeEqual } from './tokens.js';

export type Trigger = 'schedule' | 'manual' | 'inbox';
export type RunStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Run {
  id: number;
  agent_id: number;
  trigger: Trigger;
  kind: string;
  status: RunStatus;
  schedule_id: number | null;
  queued_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: number | null;
  error: string | null;
  result: unknown;
}

export interface AgentRow {
  id: number;
  slug: string;
  name: string;
  role: string;
  instructions_path: string;
}

export interface ClaimedRun {
  run: Run;
  agent: AgentRow;
  /** Plain run token. Only the hash is stored; this is the one chance to read it. */
  runToken: string;
}

const RUN_COLUMNS = `id, agent_id, trigger, kind, status, schedule_id, queued_at, started_at,
  finished_at, duration_ms, error, result`;

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

export async function queueRun(
  pool: Pool,
  opts: { agentSlug: string; trigger: Trigger; kind: string; scheduleId?: number },
): Promise<Run> {
  const { rows } = await pool.query<Run>(
    `INSERT INTO runs (agent_id, trigger, kind, schedule_id)
     SELECT id, $2, $3, $4 FROM agents WHERE slug = $1 AND enabled
     RETURNING ${RUN_COLUMNS}`,
    [opts.agentSlug, opts.trigger, opts.kind, opts.scheduleId ?? null],
  );
  const run = rows[0];
  if (!run) throw new NotFoundError(`No enabled agent called "${opts.agentSlug}"`);
  return run;
}

/**
 * Claims the oldest queued run for the runner. Before claiming, any run that has
 * been "running" for longer than `staleAfterMs` is marked failed, so a crashed
 * runner can't leave a run stuck for ever.
 */
export async function claimNextRun(pool: Pool, staleAfterMs: number): Promise<ClaimedRun | null> {
  await pool.query(
    `UPDATE runs SET status = 'failed', finished_at = now(), run_token_hash = NULL,
       error = 'Runner stopped reporting; marked failed as stale'
     WHERE status = 'running' AND started_at < now() - make_interval(secs => $1)`,
    [staleAfterMs / 1000],
  );
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `SELECT id FROM runs WHERE status = 'queued'
       ORDER BY queued_at, id FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    const next = rows[0];
    if (!next) return null;
    const runToken = newToken();
    const updated = await client.query<Run>(
      `UPDATE runs SET status = 'running', started_at = now(), run_token_hash = $2
       WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
      [next.id, hashToken(runToken)],
    );
    const run = updated.rows[0]!;
    const agent = await client.query<AgentRow>(
      'SELECT id, slug, name, role, instructions_path FROM agents WHERE id = $1',
      [run.agent_id],
    );
    return { run, agent: agent.rows[0]!, runToken };
  });
}

/** True when `token` is the live token for a running run. */
export async function checkRunToken(pool: Pool, runId: number, token: string): Promise<boolean> {
  const { rows } = await pool.query<{ run_token_hash: string | null }>(
    `SELECT run_token_hash FROM runs WHERE id = $1 AND status = 'running'`,
    [runId],
  );
  const stored = rows[0]?.run_token_hash;
  return Boolean(stored && safeEqual(stored, hashToken(token)));
}

export async function finishRun(
  pool: Pool,
  runId: number,
  outcome: { status: 'done' | 'failed'; error?: string; result?: unknown },
): Promise<Run> {
  return withTransaction(pool, async (client) => {
    const current = await client.query<{ status: RunStatus }>(
      'SELECT status FROM runs WHERE id = $1 FOR UPDATE',
      [runId],
    );
    const status = current.rows[0]?.status;
    if (!status) throw new NotFoundError(`Run ${runId} not found`);
    if (status !== 'running') throw new ConflictError(`Run ${runId} is ${status}, not running`);

    let finalStatus = outcome.status;
    let error = outcome.error ?? null;
    if (finalStatus === 'done') {
      const briefs = await client.query('SELECT 1 FROM briefs WHERE run_id = $1', [runId]);
      if (briefs.rowCount === 0) {
        finalStatus = 'failed';
        error = 'Run ended without writing a brief';
      }
    }
    const { rows } = await client.query<Run>(
      `UPDATE runs SET status = $2, error = $3, result = $4, finished_at = now(),
         duration_ms = (extract(epoch FROM now() - started_at) * 1000)::int,
         run_token_hash = NULL
       WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
      [runId, finalStatus, error, outcome.result === undefined ? null : JSON.stringify(outcome.result)],
    );
    return rows[0]!;
  });
}

export interface Brief {
  id: number;
  run_id: number;
  kind: string;
  body_md: string;
  summary: string;
  delivered: Record<string, unknown>;
  created_at: Date;
}

export async function writeBrief(
  pool: Pool,
  runId: number,
  brief: { body_md: string; summary: string },
): Promise<Brief> {
  return withTransaction(pool, async (client) => {
    const run = await client.query<{ kind: string }>(
      `SELECT kind FROM runs WHERE id = $1 AND status = 'running' FOR UPDATE`,
      [runId],
    );
    const kind = run.rows[0]?.kind;
    if (!kind) throw new NotFoundError(`Run ${runId} is not running`);
    const existing = await client.query('SELECT 1 FROM briefs WHERE run_id = $1', [runId]);
    if (existing.rowCount) throw new ConflictError('This run has already written its brief');
    const { rows } = await client.query<Brief>(
      `INSERT INTO briefs (run_id, kind, body_md, summary) VALUES ($1, $2, $3, $4)
       RETURNING id, run_id, kind, body_md, summary, delivered, created_at`,
      [runId, kind, brief.body_md, brief.summary],
    );
    return rows[0]!;
  });
}

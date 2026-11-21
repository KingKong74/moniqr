import type { Pool } from './db.js';
import { withTransaction } from './db.js';
import { hashToken, newToken, safeEqual } from './tokens.js';

export type Trigger = 'schedule' | 'manual' | 'inbox' | 'delegated';
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
  /** What the run was asked: the conversation, for a chat run. */
  input: unknown;
}

/** A console conversation turn. Bailey writes `user` turns; `moniqr` turns are earlier replies. */
export interface ChatMessage { role: 'user' | 'moniqr'; text: string }

export interface AgentRow {
  id: number;
  slug: string;
  name: string;
  role: string;
  /** The EA's instructions live in the repo; a worker's live in the database. */
  instructions_path: string | null;
  instructions_md: string | null;
  /** A worker's ticked read-only tools. Empty for the EA, whose tools are fixed in code. */
  tools: string[];
}

export interface ClaimedRun {
  run: Run;
  agent: AgentRow;
  /** Plain run token. Only the hash is stored; this is the one chance to read it. */
  runToken: string;
}

const RUN_COLUMNS = `id, agent_id, trigger, kind, status, schedule_id, queued_at, started_at,
  finished_at, duration_ms, error, result, input`;

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

export async function queueRun(
  pool: Pool,
  opts: { agentSlug: string; trigger: Trigger; kind: string; scheduleId?: number; reuseActive?: boolean; input?: unknown },
): Promise<Run & { existing?: boolean }> {
  return withTransaction(pool, async (client) => {
    // Locking the agent serialises concurrent requests, so two clicks cannot both queue a run.
    const agent = (await client.query<{ id: number }>('SELECT id FROM agents WHERE slug = $1 AND enabled FOR UPDATE', [opts.agentSlug])).rows[0];
    if (!agent) throw new NotFoundError(`No enabled agent called "${opts.agentSlug}"`);
    if (opts.reuseActive) {
      const active = (await client.query<Run>(
        `SELECT ${RUN_COLUMNS} FROM runs WHERE agent_id = $1 AND kind = $2 AND status IN ('queued', 'running')
         ORDER BY id LIMIT 1`, [agent.id, opts.kind])).rows[0];
      if (active) return { ...active, existing: true };
    }
    const { rows } = await client.query<Run>(
      `INSERT INTO runs (agent_id, trigger, kind, schedule_id, input) VALUES ($1, $2, $3, $4, $5) RETURNING ${RUN_COLUMNS}`,
      [agent.id, opts.trigger, opts.kind, opts.scheduleId ?? null, opts.input === undefined ? null : JSON.stringify(opts.input)],
    );
    return rows[0]!;
  });
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
      // Bailey is waiting on a chat reply, so it goes ahead of queued briefs.
      `SELECT id FROM runs WHERE status = 'queued'
       ORDER BY (kind = 'chat') DESC, queued_at, id FOR UPDATE SKIP LOCKED LIMIT 1`,
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
      'SELECT id, slug, name, role, instructions_path, instructions_md, tools FROM agents WHERE id = $1',
      [run.agent_id],
    );
    return { run, agent: agent.rows[0]!, runToken };
  });
}

/**
 * True when `token` is the live token for a running run. With `write`, a chat run is refused:
 * the console is read-only, whatever tools its Codex process was given.
 */
export async function checkRunToken(
  pool: Pool, runId: number, token: string,
  opts: { write?: boolean; worker?: boolean; tool?: string } = {},
): Promise<boolean> {
  const { rows } = await pool.query<{ run_token_hash: string | null; kind: string; role: string; tools: string[] }>(
    `SELECT r.run_token_hash, r.kind, a.role, a.tools FROM runs r JOIN agents a ON a.id = r.agent_id
     WHERE r.id = $1 AND r.status = 'running'`,
    [runId],
  );
  const row = rows[0];
  if (!row?.run_token_hash || !safeEqual(row.run_token_hash, hashToken(token))) return false;
  // A worker's token only reaches its own report and the reads ticked for it, never the EA's writes.
  const worker = row.role === 'worker';
  if (opts.worker) return worker && row.kind === 'task';
  if (worker) return !opts.write && opts.tool !== undefined && row.tools.includes(opts.tool);
  if (opts.write && row.kind === 'chat') return false;
  return true;
}

export async function finishRun(
  pool: Pool,
  runId: number,
  outcome: { status: 'done' | 'failed'; error?: string; result?: unknown },
): Promise<Run> {
  return withTransaction(pool, async (client) => {
    const current = await client.query<{ status: RunStatus; kind: string }>(
      'SELECT status, kind FROM runs WHERE id = $1 FOR UPDATE',
      [runId],
    );
    const status = current.rows[0]?.status;
    const kind = current.rows[0]?.kind;
    if (!status) throw new NotFoundError(`Run ${runId} not found`);
    if (status !== 'running') throw new ConflictError(`Run ${runId} is ${status}, not running`);

    let finalStatus = outcome.status;
    let error = outcome.error ?? null;
    if (finalStatus === 'done' && kind === 'chat') {
      // A chat run's only output is its reply.
      const reply = (outcome.result as { result?: unknown } | undefined)?.result;
      if (typeof reply !== 'string' || !reply.trim()) {
        finalStatus = 'failed';
        error = 'Chat ended without a reply';
      }
    } else if (finalStatus === 'done' && kind === 'task') {
      // A worker's task is done only once it has filed its report.
      const reports = await client.query('SELECT 1 FROM reports WHERE run_id = $1', [runId]);
      if (reports.rowCount === 0) {
        finalStatus = 'failed';
        error = 'Task ended without filing a report';
      }
    } else if (finalStatus === 'done') {
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

export const DAILY_PICK_KINDS = ['Quote', 'Small challenge', 'Word of the day', 'Question to sit with', 'Did you know'] as const;
export interface DailyPick { kind: (typeof DAILY_PICK_KINDS)[number]; text: string; sub: string }

/** The newest daily pick a brief saved, with when it was written. */
export async function latestDailyPick(pool: Pool): Promise<{ items: DailyPick[]; created_at: Date } | null> {
  const { rows } = await pool.query(`SELECT daily_pick AS items, created_at FROM briefs
    WHERE daily_pick IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1`);
  return rows[0] ?? null;
}

export async function writeBrief(
  pool: Pool,
  runId: number,
  brief: { body_md: string; summary: string; daily_pick?: DailyPick[] },
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
      `INSERT INTO briefs (run_id, kind, body_md, summary, daily_pick) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, run_id, kind, body_md, summary, delivered, created_at`,
      [runId, kind, brief.body_md, brief.summary, brief.daily_pick?.length ? JSON.stringify(brief.daily_pick) : null],
    );
    return rows[0]!;
  });
}

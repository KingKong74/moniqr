import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Pool } from '../db.js';
import {
  checkRunToken,
  claimNextRun,
  ConflictError,
  finishRun,
  NotFoundError,
  queueRun,
  writeBrief,
} from '../runs.js';
import { nextFireAfter } from '../scheduler.js';
import { bearer, safeEqual } from '../tokens.js';

function isValidCron(cron: string): boolean {
  try {
    nextFireAfter(cron, 'Australia/Brisbane', new Date());
    return cron.trim().split(/\s+/).length === 5;
  } catch {
    return false;
  }
}

export const RUN_KINDS = ['morning_brief', 'weekly_lookahead', 'test'] as const;

export interface AppOptions {
  pool: Pool;
  /** Token the hub uses. */
  apiToken: string;
  /** Token the runner uses to claim and finish runs. */
  runnerToken: string;
  /** Runs left "running" longer than this are failed on the next claim. */
  staleRunMs: number;
}

const idParam = z.coerce.number().int().positive();
const limitQuery = z.coerce.number().int().min(1).max(100).default(20);

export function createApp(opts: AppOptions) {
  const { pool } = opts;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  const requireToken = (expected: string) => (req: Request, res: Response, next: NextFunction) => {
    const token = bearer(req.header('authorization'));
    if (!token || !safeEqual(token, expected)) {
      res.status(401).json({ error: 'Unauthorised' });
      return;
    }
    next();
  };
  const hub = requireToken(opts.apiToken);
  const runner = requireToken(opts.runnerToken);

  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  // --- Hub: read state and trigger runs ---

  app.post('/agents/:slug/run', hub, async (req, res) => {
    const body = z.object({ kind: z.enum(RUN_KINDS).default('morning_brief') }).parse(req.body ?? {});
    const run = await queueRun(pool, { agentSlug: String(req.params.slug), trigger: 'manual', kind: body.kind });
    res.status(202).json({ run });
  });

  app.get('/runs', hub, async (req, res) => {
    const limit = limitQuery.parse(req.query.limit);
    const { rows } = await pool.query(
      `SELECT r.id, a.slug AS agent, r.trigger, r.kind, r.status, r.queued_at, r.started_at,
              r.finished_at, r.duration_ms, r.error
       FROM runs r JOIN agents a ON a.id = r.agent_id
       ORDER BY r.queued_at DESC, r.id DESC LIMIT $1`,
      [limit],
    );
    res.json({ runs: rows });
  });

  app.get('/runs/:id', hub, async (req, res) => {
    const id = idParam.parse(req.params.id);
    const { rows } = await pool.query(
      `SELECT r.id, a.slug AS agent, r.trigger, r.kind, r.status, r.queued_at, r.started_at,
              r.finished_at, r.duration_ms, r.error, r.result
       FROM runs r JOIN agents a ON a.id = r.agent_id WHERE r.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundError(`Run ${id} not found`);
    res.json({ run: rows[0] });
  });

  app.get('/briefs', hub, async (req, res) => {
    const limit = limitQuery.parse(req.query.limit);
    const { rows } = await pool.query(
      `SELECT id, run_id, kind, body_md, summary, delivered, created_at
       FROM briefs ORDER BY created_at DESC, id DESC LIMIT $1`,
      [limit],
    );
    res.json({ briefs: rows });
  });

  app.get('/briefs/latest', hub, async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, run_id, kind, body_md, summary, delivered, created_at
       FROM briefs ORDER BY created_at DESC, id DESC LIMIT 1`,
    );
    res.json({ brief: rows[0] ?? null });
  });

  app.get('/schedules', hub, async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT s.id, a.slug AS agent, s.kind, s.cron, s.timezone, s.enabled, s.next_run_at, s.last_run_at
       FROM schedules s JOIN agents a ON a.id = s.agent_id ORDER BY s.id`,
    );
    res.json({ schedules: rows });
  });

  app.patch('/schedules/:id', hub, async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        enabled: z.boolean().optional(),
        cron: z
          .string()
          .refine((c) => isValidCron(c), 'Not a valid cron expression')
          .optional(),
      })
      .refine((b) => b.enabled !== undefined || b.cron !== undefined, 'Send enabled, cron or both')
      .parse(req.body ?? {});
    // Clearing next_run_at lets the scheduler pick the next slot, so a change never fires a run straight away.
    const { rows } = await pool.query(
      `UPDATE schedules SET enabled = coalesce($2, enabled), cron = coalesce($3, cron), next_run_at = NULL
       WHERE id = $1 RETURNING id, kind, cron, timezone, enabled`,
      [id, body.enabled ?? null, body.cron ?? null],
    );
    if (!rows[0]) throw new NotFoundError(`Schedule ${id} not found`);
    res.json({ schedule: rows[0] });
  });

  // --- Runner: claim and finish runs ---

  app.post('/runner/claim', runner, async (_req, res) => {
    const claimed = await claimNextRun(pool, opts.staleRunMs);
    if (!claimed) {
      res.status(204).end();
      return;
    }
    res.json(claimed);
  });

  app.post('/runner/runs/:id/finish', runner, async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        status: z.enum(['done', 'failed']),
        error: z.string().max(4000).optional(),
        result: z.unknown().optional(),
      })
      .parse(req.body);
    const run = await finishRun(pool, id, body);
    res.json({ run });
  });

  // --- MCP server: writes scoped to one running run ---

  app.post('/runs/:id/brief', async (req, res) => {
    const id = idParam.parse(req.params.id);
    const token = bearer(req.header('authorization'));
    if (!token || !(await checkRunToken(pool, id, token))) {
      res.status(401).json({ error: 'Unauthorised' });
      return;
    }
    const body = z
      .object({
        body_md: z.string().trim().min(1).max(20_000),
        summary: z.string().trim().min(1).max(300),
      })
      .parse(req.body);
    const brief = await writeBrief(pool, id, body);
    res.status(201).json({ brief });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', issues: err.issues });
    } else if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
    } else if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
    } else if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'Malformed JSON' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return app;
}

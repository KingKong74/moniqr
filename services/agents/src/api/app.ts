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
import { findingInput, scanInput, listFindings, saveFinding, saveScan } from '../findings.js';
import { proposalInput, decisionInput, proposeAction, listActions, getAction, decideAction, prepareCalendarAction, addFindingToCalendar, ownerCalendarInput } from '../actions.js';
import type { CalendarWriter } from '../calendar-writer.js';
import { executeCalendarAction } from '../calendar-executor.js';
import { backlogInput, backlogPatch, createBacklogItem, updateBacklogItem, briefSettingsInput, listBacklog, briefSettings, saveBriefSettings,
  checkinInput, checkinPatch, listCheckins, createCheckin, updateCheckin } from '../personal.js';
import { adminContext } from '../brief-context.js';

function isValidCron(cron: string): boolean {
  try {
    nextFireAfter(cron, 'Australia/Brisbane', new Date());
    return cron.trim().split(/\s+/).length === 5;
  } catch {
    return false;
  }
}

export const RUN_KINDS = ['morning_brief', 'afternoon_brief', 'weekly_lookahead', 'test'] as const;

export interface AppOptions {
  pool: Pool;
  /** Token the hub uses. */
  apiToken: string;
  /** Token the runner uses to claim and finish runs. */
  runnerToken: string;
  /** Runs left "running" longer than this are failed on the next claim. */
  staleRunMs: number;
  calendar?: { listEvents(start: Date, end: Date): Promise<unknown[]> } | null;
  actionCalendarId?: string;
  calendarWriter?: CalendarWriter | null;
}

/** The console conversation, oldest first, ending with Bailey's new message. */
export const chatInput = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'moniqr']), text: z.string().trim().min(1).max(4000) }).strict())
    .min(1).max(30)
    .refine((m) => m.at(-1)?.role === 'user', 'The last message must be yours')
    .refine((m) => m.reduce((n, x) => n + x.text.length, 0) <= 24_000, 'The conversation is too long; clear it and start again'),
}).strict();

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

  app.get('/backlog', hub, async (_req, res) => { res.json(await listBacklog(pool)); });
  app.post('/backlog', hub, async (req, res) => {
    res.status(201).json({ item: await createBacklogItem(pool, backlogInput.parse(req.body)) });
  });
  app.patch('/backlog/:id', hub, async (req, res) => {
    const item = await updateBacklogItem(pool, idParam.parse(req.params.id), backlogPatch.parse(req.body));
    if (!item) throw new NotFoundError('Backlog item not found.');
    res.json({ item });
  });
  app.get('/checkins', hub, async (_req, res) => { res.json(await listCheckins(pool)); });
  app.post('/checkins', hub, async (req, res) => {
    res.status(201).json({ item: await createCheckin(pool, checkinInput.parse(req.body)) });
  });
  app.patch('/checkins/:id', hub, async (req, res) => {
    const item = await updateCheckin(pool, idParam.parse(req.params.id), checkinPatch.parse(req.body));
    if (!item) throw new NotFoundError('Check-in not found.');
    res.json({ item });
  });
  app.get('/settings', hub, async (_req, res) => { res.json(await briefSettings(pool)); });
  app.put('/settings', hub, async (req, res) => { res.json(await saveBriefSettings(pool, briefSettingsInput.parse(req.body))); });

  const revisionBody = z.object({ revision: z.number().int().positive() }).strict();
  app.get('/actions', hub, async (_req, res) => { res.json(await listActions(pool, false, opts.actionCalendarId, !!opts.calendarWriter)); });
  app.get('/actions/:id', hub, async (req, res) => { res.json(await getAction(pool, idParam.parse(req.params.id), opts.actionCalendarId, !!opts.calendarWriter)); });
  app.post('/actions/:id/decision', hub, async (req, res) => {
    let action = await decideAction(pool, idParam.parse(req.params.id), decisionInput.parse(req.body), opts.actionCalendarId, !!opts.calendarWriter);
    if (action.status === 'approved' && action.kind === 'calendar_create' && action.execution_mode === 'enabled' && opts.calendarWriter) {
      action = await executeCalendarAction(pool, opts.calendarWriter, action.id, action.revision);
      calendarCache = undefined;
    }
    res.json({ action });
  });
  app.post('/actions/:id/prepare', hub, async (req, res) => {
    const { revision } = revisionBody.parse(req.body);
    res.json({ action: await prepareCalendarAction(pool, idParam.parse(req.params.id), revision,
      opts.actionCalendarId ?? '', !!opts.calendarWriter) });
  });
  for (const operation of ['execute','undo'] as const) app.post(`/actions/:id/${operation}`, hub, async (req, res) => {
    if (!opts.calendarWriter) throw new ConflictError('Connect calendar write access first.');
    const { revision } = revisionBody.parse(req.body);
    const action = await executeCalendarAction(pool, opts.calendarWriter, idParam.parse(req.params.id), revision, operation === 'undo');
    calendarCache = undefined;
    res.json({ action });
  });

  app.get('/findings', hub, async (_req, res) => {
    res.json(await listFindings(pool));
  });

  app.patch('/findings/:id', hub, async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z.object({ status: z.enum(['new', 'reviewed', 'dismissed']) }).strict().parse(req.body);
    const { rows } = await pool.query(
      `UPDATE email_findings SET status=$2, decided_at=CASE WHEN $2='new' THEN NULL ELSE now() END
       WHERE id=$1 RETURNING *`, [id, body.status],
    );
    if (!rows[0]) throw new NotFoundError(`Finding ${id} not found`);
    res.json({ finding: rows[0] });
  });

  // Bailey's own "Add to calendar" from the inbox. The hub token is the owner; run tokens cannot reach this.
  app.post('/findings/:id/calendar', hub, async (req, res) => {
    const id = idParam.parse(req.params.id);
    const input = ownerCalendarInput.parse(req.body);
    if (!opts.calendarWriter || opts.actionCalendarId?.trim() !== opts.calendarWriter.calendarId) throw new ConflictError('Connect calendar write access first.');
    const row = await addFindingToCalendar(pool, id, input, opts.calendarWriter.calendarId);
    const action = await executeCalendarAction(pool, opts.calendarWriter, row.id, row.revision);
    calendarCache = undefined;
    res.json({ action });
  });

  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  // --- Hub: read state and trigger runs ---

  app.post('/agents/:slug/run', hub, async (req, res) => {
    const body = z.object({ kind: z.enum(RUN_KINDS).default('morning_brief') }).parse(req.body ?? {});
    // A rerun while the same kind is queued or running returns that run instead of starting another.
    const { existing, ...run } = await queueRun(pool, { agentSlug: String(req.params.slug), trigger: 'manual', kind: body.kind, reuseActive: true });
    res.status(existing ? 200 : 202).json({ run, existing: !!existing });
  });

  // --- Hub: the moniqr console. A chat is a read-only EA run whose reply is the run result. ---

  app.post('/chat', hub, async (req, res) => {
    const { messages } = chatInput.parse(req.body);
    const run = await queueRun(pool, { agentSlug: 'ea', trigger: 'manual', kind: 'chat', reuseActive: true, input: { messages } });
    if (run.existing) throw new ConflictError('moniqr is still answering your last message.');
    res.status(202).json({ run: { id: run.id, status: run.status } });
  });

  app.get('/chat/:id', hub, async (req, res) => {
    const id = idParam.parse(req.params.id);
    const { rows } = await pool.query<{ status: string; error: string | null; result: { result?: unknown; tools_used?: unknown } | null; started_at: Date | null }>(
      `SELECT status, error, result, started_at FROM runs WHERE id = $1 AND kind = 'chat'`, [id]);
    const run = rows[0];
    if (!run) throw new NotFoundError(`Chat ${id} not found`);
    const reply = run.status === 'done' && typeof run.result?.result === 'string' ? run.result.result : null;
    const tools = Array.isArray(run.result?.tools_used) ? run.result.tools_used.filter((t): t is string => typeof t === 'string') : [];
    res.json({ id, status: run.status, started_at: run.started_at, reply, tools, error: run.status === 'failed' ? run.error : null });
  });

  // Cache the current Brisbane week: HQ polls every five seconds.
  let calendarCache: { week: string; expires: number; events: unknown[] } | undefined;
  let calendarPending: Promise<unknown[]> | undefined;
  app.get('/calendar', hub, async (_req, res) => {
    if (!opts.calendar) {
      res.json({ status: 'disconnected', events: [] });
      return;
    }
    const local = new Date(Date.now() + 10 * 3_600_000);
    const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
      - ((local.getUTCDay() + 6) % 7) * 86_400_000 - 10 * 3_600_000);
    const week = start.toISOString();
    try {
      if (!calendarCache || calendarCache.week !== week || calendarCache.expires < Date.now()) {
        // Three weeks from this Monday: the dashboard's week plus at least 14 days ahead for the brief.
        calendarPending ??= opts.calendar.listEvents(start, new Date(start.getTime() + 21 * 86_400_000));
        try {
          const events = await calendarPending;
          calendarCache = { week, events, expires: Date.now() + 60_000 };
        } finally {
          calendarPending = undefined;
        }
      }
      res.json({ status: 'connected', events: calendarCache.events });
    } catch (err) {
      console.error('[calendar]', err);
      res.status(502).json({ error: 'Calendar unavailable' });
    }
  });

  app.get('/runs', hub, async (req, res) => {
    const limit = limitQuery.parse(req.query.limit);
    const { rows } = await pool.query(
      `SELECT r.id, a.slug AS agent, r.trigger, r.kind, r.status, r.queued_at, r.started_at,
              r.finished_at, r.duration_ms, r.error
       FROM runs r JOIN agents a ON a.id = r.agent_id
       WHERE r.kind <> 'chat'
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

  app.get('/runs/:id/actions', async (req, res) => {
    const id = idParam.parse(req.params.id);
    const token = bearer(req.header('authorization'));
    if (!token || !(await checkRunToken(pool, id, token))) return void res.status(401).json({ error: 'Unauthorised' });
    res.json(await listActions(pool, true, opts.actionCalendarId, !!opts.calendarWriter));
  });

  app.get('/runs/:id/admin-context', async (req, res) => {
    const id = idParam.parse(req.params.id);
    const token = bearer(req.header('authorization'));
    if (!token || !(await checkRunToken(pool, id, token))) return void res.status(401).json({ error: 'Unauthorised' });
    res.json(await adminContext(pool, { actionCalendarId: opts.actionCalendarId, calendarWriteReady: !!opts.calendarWriter }));
  });

  app.post('/runs/:id/actions', async (req, res) => {
    const id = idParam.parse(req.params.id);
    const token = bearer(req.header('authorization'));
    if (!token || !(await checkRunToken(pool, id, token, { write: true }))) return void res.status(401).json({ error: 'Unauthorised' });
    const action = await proposeAction(pool, id, proposalInput.parse(req.body), opts.actionCalendarId, !!opts.calendarWriter);
    res.status(201).json({ action });
  });

  app.post('/runs/:id/findings', async (req, res) => {
    const id = idParam.parse(req.params.id);
    const token = bearer(req.header('authorization'));
    if (!token || !(await checkRunToken(pool, id, token, { write: true }))) return void res.status(401).json({ error: 'Unauthorised' });
    const finding = await saveFinding(pool, id, findingInput.parse(req.body));
    res.status(201).json({ finding });
  });

  app.post('/runs/:id/email-scan', async (req, res) => {
    const id = idParam.parse(req.params.id);
    const token = bearer(req.header('authorization'));
    if (!token || !(await checkRunToken(pool, id, token, { write: true }))) return void res.status(401).json({ error: 'Unauthorised' });
    await saveScan(pool, id, scanInput.parse(req.body));
    res.json({ ok: true });
  });

  app.post('/runs/:id/brief', async (req, res) => {
    const id = idParam.parse(req.params.id);
    const token = bearer(req.header('authorization'));
    if (!token || !(await checkRunToken(pool, id, token, { write: true }))) {
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

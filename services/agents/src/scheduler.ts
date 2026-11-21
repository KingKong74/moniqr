import { CronExpressionParser } from 'cron-parser';
import type { Pool } from './db.js';
import { withTransaction } from './db.js';

interface ScheduleRow {
  id: number;
  agent_id: number;
  kind: string;
  cron: string;
  timezone: string;
  next_run_at: Date | null;
  task: string | null;
}

/** The shortest gap, in minutes, between a cron's next `count` fire times. */
export function minGapMinutes(cron: string, timezone: string, count = 30, from = new Date()): number {
  const it = CronExpressionParser.parse(cron, { tz: timezone, currentDate: from });
  let prev = it.next().toDate().getTime();
  let gap = Infinity;
  for (let i = 1; i < count; i++) {
    const t = it.next().toDate().getTime();
    gap = Math.min(gap, (t - prev) / 60_000);
    prev = t;
  }
  return gap;
}

export function nextFireAfter(cron: string, timezone: string, after: Date): Date {
  return CronExpressionParser.parse(cron, { tz: timezone, currentDate: after }).next().toDate();
}

/**
 * One scheduler pass. Enabled schedules with no next_run_at get one (so switching a
 * schedule on never fires it straight away). Schedules that are due queue one run
 * and move on to their next time; missed slots while the service was down collapse
 * into a single run. Returns the ids of runs queued.
 */
export async function tick(pool: Pool, now = new Date()): Promise<number[]> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<ScheduleRow>(
      `SELECT s.id, s.agent_id, s.kind, s.cron, s.timezone, s.next_run_at, s.task
       FROM schedules s JOIN agents a ON a.id = s.agent_id
       WHERE s.enabled AND a.enabled AND (s.next_run_at IS NULL OR s.next_run_at <= $1)
       FOR UPDATE OF s SKIP LOCKED`,
      [now],
    );
    const queued: number[] = [];
    for (const s of rows) {
      const next = nextFireAfter(s.cron, s.timezone, now);
      if (s.next_run_at === null) {
        await client.query('UPDATE schedules SET next_run_at = $2 WHERE id = $1', [s.id, next]);
        continue;
      }
      // A standing task still queued or running from its last slot is not queued again.
      if (s.kind === 'task') {
        const busy = await client.query(`SELECT 1 FROM runs WHERE schedule_id = $1 AND status IN ('queued', 'running') LIMIT 1`, [s.id]);
        if (busy.rowCount) {
          await client.query('UPDATE schedules SET next_run_at = $2 WHERE id = $1', [s.id, next]);
          continue;
        }
      }
      const input = s.kind === 'task' ? JSON.stringify({ task: s.task, from: 'schedule' }) : null;
      const run = await client.query<{ id: number }>(
        `INSERT INTO runs (agent_id, trigger, kind, schedule_id, input) VALUES ($1, 'schedule', $2, $3, $4) RETURNING id`,
        [s.agent_id, s.kind, s.id, input],
      );
      await client.query('UPDATE schedules SET next_run_at = $2, last_run_at = $3 WHERE id = $1', [
        s.id,
        next,
        now,
      ]);
      queued.push(run.rows[0]!.id);
    }
    return queued;
  });
}

export function startScheduler(pool: Pool, intervalMs = 30_000): () => void {
  let stopped = false;
  const loop = async () => {
    if (stopped) return;
    try {
      const queued = await tick(pool);
      if (queued.length) console.log(`[scheduler] queued runs ${queued.join(', ')}`);
    } catch (err) {
      console.error('[scheduler] tick failed', err);
    }
  };
  void loop();
  const timer = setInterval(() => void loop(), intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

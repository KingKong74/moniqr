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
      `SELECT s.id, s.agent_id, s.kind, s.cron, s.timezone, s.next_run_at
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
      const run = await client.query<{ id: number }>(
        `INSERT INTO runs (agent_id, trigger, kind, schedule_id) VALUES ($1, 'schedule', $2, $3) RETURNING id`,
        [s.agent_id, s.kind, s.id],
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

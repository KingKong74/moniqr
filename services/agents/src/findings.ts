import { z } from 'zod';
import { withTransaction, type Pool } from './db.js';
import { NotFoundError } from './runs.js';

const messageId = z.string().regex(/^[A-Za-z0-9_-]+$/).max(128);
export const findingInput = z.object({
  message_id: messageId,
  thread_id: messageId,
  category: z.enum(['bill', 'commitment', 'reply']),
  sender: z.string().max(1000),
  subject: z.string().min(1).max(1000),
  received_at: z.string().datetime({ offset: true }),
  summary: z.string().trim().min(1).max(1000),
  evidence: z.string().trim().min(1).max(2000),
  deadline_text: z.string().trim().max(300).default(''),
  missing_details: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
}).strict();

export const scanInput = z.object({
  status: z.enum(['scanning', 'completed', 'partial', 'failed']),
  searches: z.number().int().min(0).max(1000),
  messages_read: z.number().int().min(0).max(1000),
  failures: z.number().int().min(0).max(1000),
}).strict();

/** Lock against finishRun: a write cannot slip in after its run has ended. */
async function forRunningRun<T>(pool: Pool, runId: number, write: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(pool, async (client) => {
    const run = await client.query("SELECT id FROM runs WHERE id = $1 AND status = 'running' FOR UPDATE", [runId]);
    if (!run.rowCount) throw new NotFoundError(`Run ${runId} is not running`);
    return write(client);
  });
}

export function saveFinding(pool: Pool, runId: number, input: z.infer<typeof findingInput>) {
  return forRunningRun(pool, runId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO email_findings (message_id, thread_id, category, sender, subject, received_at,
         summary, evidence, deadline_text, missing_details, first_run_id, last_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$11)
       ON CONFLICT (message_id, category) DO UPDATE SET
         summary = EXCLUDED.summary, evidence = EXCLUDED.evidence,
         deadline_text = EXCLUDED.deadline_text, missing_details = EXCLUDED.missing_details,
         last_run_id = EXCLUDED.last_run_id, updated_at = now()
       WHERE email_findings.last_run_id <= EXCLUDED.last_run_id
       RETURNING *`,
      [input.message_id, input.thread_id, input.category, input.sender, input.subject, input.received_at,
        input.summary, input.evidence, input.deadline_text, JSON.stringify(input.missing_details), runId],
    );
    // An older concurrent run may observe the same source after a newer run saved it.
    return rows[0] ?? (await client.query('SELECT * FROM email_findings WHERE message_id = $1 AND category = $2',
      [input.message_id, input.category])).rows[0];
  });
}

export function saveScan(pool: Pool, runId: number, input: z.infer<typeof scanInput>) {
  return forRunningRun(pool, runId, async (client) => {
    await client.query(
      `INSERT INTO email_scans (run_id,status,searches,messages_read,failures) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (run_id) DO UPDATE SET status=EXCLUDED.status, searches=EXCLUDED.searches,
         messages_read=EXCLUDED.messages_read, failures=EXCLUDED.failures, updated_at=now()`,
      [runId, input.status, input.searches, input.messages_read, input.failures],
    );
  });
}

export async function listFindings(pool: Pool) {
  const [items, scans, count] = await Promise.all([
    pool.query(`SELECT * FROM email_findings
      ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END, received_at DESC, id DESC LIMIT 200`),
    pool.query(`SELECT r.id AS run_id, r.status AS run_status, r.queued_at, r.finished_at,
        s.status, s.searches, s.messages_read, s.failures, s.updated_at,
        (SELECT max(s2.updated_at) FROM email_scans s2 JOIN runs r2 ON r2.id=s2.run_id
         WHERE s2.status='completed' AND r2.status='done') AS last_success_at
      FROM runs r LEFT JOIN email_scans s ON s.run_id=r.id
      WHERE r.kind IN ('morning_brief','weekly_lookahead') ORDER BY r.id DESC LIMIT 1`),
    pool.query('SELECT count(*)::int AS total FROM email_findings'),
  ]);
  return { items: items.rows, scan: scans.rows[0] ?? null, total: count.rows[0].total };
}

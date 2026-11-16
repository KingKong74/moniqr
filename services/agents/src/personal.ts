import { z } from 'zod';
import type { Pool } from './db.js';
import { withTransaction } from './db.js';
import { nextFireAfter } from './scheduler.js';

export const backlogInput = z.object({
  title: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(10000).default(''),
  status: z.enum(['backlog', 'next', 'doing', 'done']).default('backlog'),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
}).strict();
export const briefSettingsInput = z.object({
  morning: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  afternoon: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  morning_enabled: z.boolean(),
  afternoon_enabled: z.boolean(),
}).strict().refine(b => b.morning < b.afternoon, 'The afternoon brief must be later than the morning brief.');
export async function listBacklog(pool: Pool) {
  const { rows } = await pool.query(`SELECT * FROM backlog_items ORDER BY (status='done'),
    CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at DESC, id DESC`);
  return { items: rows };
}
export async function briefSettings(pool: Pool) {
  const { rows } = await pool.query(`SELECT s.kind, s.cron, s.enabled, s.timezone, s.next_run_at, s.last_run_at
    FROM schedules s JOIN agents a ON a.id=s.agent_id WHERE a.slug='ea'
    AND s.kind IN ('morning_brief','afternoon_brief') ORDER BY s.kind DESC`);
  return { timezone: 'Australia/Brisbane', schedules: rows };
}
export async function saveBriefSettings(pool: Pool, body: z.infer<typeof briefSettingsInput>) {
  await withTransaction(pool, async client => {
    for (const slot of ['morning', 'afternoon'] as const) {
      const [hour, minute] = body[slot].split(':').map(Number);
      const cron = `${minute} ${hour} * * *`;
      const enabled = body[`${slot}_enabled`];
      await client.query(`INSERT INTO schedules (agent_id,kind,cron,timezone,enabled,next_run_at)
        SELECT id,$1,$2,'Australia/Brisbane',$3,$4 FROM agents WHERE slug='ea'
        ON CONFLICT (agent_id,kind) DO UPDATE SET cron=excluded.cron,timezone=excluded.timezone,
        enabled=excluded.enabled,next_run_at=excluded.next_run_at`,
      [`${slot}_brief`, cron, enabled, enabled ? nextFireAfter(cron, 'Australia/Brisbane', new Date()) : null]);
    }
  });
  return briefSettings(pool);
}

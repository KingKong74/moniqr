import { z } from 'zod';
import type { Pool } from './db.js';
import { withTransaction } from './db.js';
import { nextFireAfter } from './scheduler.js';

const backlogStep = z.object({ t: z.string().trim().min(1).max(240), done: z.boolean() }).strict();
const backlogFields = {
  title: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(10000),
  status: z.enum(['backlog', 'next', 'doing', 'done']),
  priority: z.enum(['low', 'normal', 'high']),
  steps: z.array(backlogStep).max(50),
};
export const backlogInput = z.object({
  title: backlogFields.title,
  notes: backlogFields.notes.default(''),
  status: backlogFields.status.default('backlog'),
  priority: backlogFields.priority.default('normal'),
  steps: backlogFields.steps.default([]),
}).strict();
/** A change to one item. Only the fields sent change; place moves it to the top or bottom of its status. */
export const backlogPatch = z.object({
  title: backlogFields.title.optional(),
  notes: backlogFields.notes.optional(),
  status: backlogFields.status.optional(),
  priority: backlogFields.priority.optional(),
  steps: backlogFields.steps.optional(),
  place: z.enum(['top', 'bottom']).optional(),
}).strict();
export const briefSettingsInput = z.object({
  morning: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  afternoon: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  morning_enabled: z.boolean(),
  afternoon_enabled: z.boolean(),
}).strict().refine(b => b.morning < b.afternoon, 'The afternoon brief must be later than the morning brief.');

/** Doing first, then Next, Backlog and Done; within a status, in the owner's order. */
export async function listBacklog(pool: Pool) {
  const { rows } = await pool.query(`SELECT * FROM backlog_items ORDER BY
    CASE status WHEN 'doing' THEN 0 WHEN 'next' THEN 1 WHEN 'backlog' THEN 2 ELSE 3 END, position, id`);
  return { items: rows };
}

/** New items go to the bottom of their status. */
export async function createBacklogItem(pool: Pool, b: z.infer<typeof backlogInput>) {
  const { rows } = await pool.query(`INSERT INTO backlog_items (title,notes,status,priority,steps,position)
    VALUES ($1,$2,$3,$4,$5,(SELECT coalesce(max(position), 0) + 1 FROM backlog_items)) RETURNING *`,
    [b.title, b.notes, b.status, b.priority, JSON.stringify(b.steps)]);
  return rows[0];
}

/** Returns null when the item does not exist. */
export async function updateBacklogItem(pool: Pool, id: number, p: z.infer<typeof backlogPatch>) {
  const { rows } = await pool.query(`UPDATE backlog_items SET
      title = coalesce($2, title), notes = coalesce($3, notes), status = coalesce($4, status),
      priority = coalesce($5, priority), steps = coalesce($6::jsonb, steps),
      position = CASE $7::text
        WHEN 'top' THEN (SELECT coalesce(min(position), 0) - 1 FROM backlog_items)
        WHEN 'bottom' THEN (SELECT coalesce(max(position), 0) + 1 FROM backlog_items)
        ELSE position END,
      updated_at = now()
    WHERE id = $1 RETURNING *`,
    [id, p.title ?? null, p.notes ?? null, p.status ?? null, p.priority ?? null,
      p.steps ? JSON.stringify(p.steps) : null, p.place ?? null]);
  return rows[0] ?? null;
}
/** What the latest run of a kind actually did, so a missed or partial brief is visible. */
const LAST_RUN = `LEFT JOIN LATERAL (
    SELECT r.id, r.trigger, r.status, r.queued_at, r.started_at, r.finished_at, left(r.error, 300) AS error,
      sc.status AS email_status, sc.searches AS email_searches, sc.messages_read AS email_read, sc.failures AS email_failures,
      EXISTS (SELECT 1 FROM briefs b WHERE b.run_id = r.id) AS has_brief
    FROM runs r LEFT JOIN email_scans sc ON sc.run_id = r.id
    WHERE r.agent_id = s.agent_id AND r.kind = s.kind AND r.status IN ('done', 'failed')
    ORDER BY r.id DESC LIMIT 1) last ON true
  LEFT JOIN LATERAL (
    SELECT r.id, r.trigger, r.status, r.queued_at FROM runs r
    WHERE r.agent_id = s.agent_id AND r.kind = s.kind AND r.status IN ('queued', 'running')
    ORDER BY r.id LIMIT 1) active ON true
  LEFT JOIN LATERAL (
    SELECT max(r.finished_at) AS at FROM runs r
    WHERE r.agent_id = s.agent_id AND r.kind = s.kind AND r.status = 'done') ok ON true`;

export async function briefSettings(pool: Pool) {
  const { rows } = await pool.query(`SELECT s.kind, s.cron, s.enabled, s.timezone, s.next_run_at, s.last_run_at,
      to_jsonb(last) AS last_run, CASE WHEN active.id IS NULL THEN NULL ELSE to_jsonb(active) END AS active_run,
      ok.at AS last_success_at
    FROM schedules s JOIN agents a ON a.id=s.agent_id ${LAST_RUN}
    WHERE a.slug='ea' AND s.kind IN ('morning_brief','afternoon_brief') ORDER BY s.kind DESC`);
  return { timezone: 'Australia/Brisbane', schedules: rows.map((r) => ({ ...r, last_run: r.last_run?.id ? r.last_run : null })) };
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

// "How are you feeling?" check-ins: mood and energy on a 0-4 scale, plus an optional note.
const scale = z.number().int().min(0).max(4);
export const checkinInput = z.object({
  mood: scale,
  energy: scale.nullable().default(null),
  note: z.string().trim().max(2000).default(''),
}).strict();
export const checkinPatch = z.object({
  mood: scale.optional(),
  energy: scale.nullable().optional(),
  note: z.string().trim().max(2000).optional(),
}).strict();

/** Check-ins from the last `days` days, newest first. */
export async function listCheckins(pool: Pool, days = 30) {
  const { rows } = await pool.query(`SELECT id, mood, energy, note, created_at, updated_at FROM checkins
    WHERE created_at >= now() - make_interval(days => $1) ORDER BY created_at DESC, id DESC LIMIT 500`, [days]);
  return { items: rows };
}

export async function createCheckin(pool: Pool, c: z.infer<typeof checkinInput>) {
  const { rows } = await pool.query(`INSERT INTO checkins (mood, energy, note) VALUES ($1,$2,$3)
    RETURNING id, mood, energy, note, created_at, updated_at`, [c.mood, c.energy, c.note]);
  return rows[0];
}

/** Returns null when the check-in does not exist. Energy can be cleared with null. */
export async function updateCheckin(pool: Pool, id: number, p: z.infer<typeof checkinPatch>) {
  const { rows } = await pool.query(`UPDATE checkins SET mood = coalesce($2, mood),
      energy = CASE WHEN $3::boolean THEN $4::smallint ELSE energy END, note = coalesce($5, note), updated_at = now()
    WHERE id = $1 RETURNING id, mood, energy, note, created_at, updated_at`,
    [id, p.mood ?? null, p.energy !== undefined, p.energy ?? null, p.note ?? null]);
  return rows[0] ?? null;
}

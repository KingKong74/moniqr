/** Proposal decisions remain separate from server-only calendar execution.
 * A future executor MUST refuse record_only approvals, including old approved rows.
 * Enabling execution changes reviewed content and requires a fresh owner decision.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { withTransaction, type Pool } from './db.js';
import { ConflictError, NotFoundError } from './runs.js';

const brisbaneTime = z.string().datetime({ offset: true }).refine((s) =>
  s.endsWith('+10:00') && Number.isFinite(Date.parse(s)) &&
  new Date(Date.parse(s) + 10 * 3_600_000).toISOString().slice(0, 19) === s.slice(0, 19),
{ message: 'Use a real date/time in Brisbane (+10:00).' });
export const proposalShape = {
  finding_id: z.number().int().positive(),
  kind: z.enum(['manual', 'calendar_create']),
  title: z.string().trim().min(1).max(300),
  detail: z.string().trim().min(1).max(2000).describe('Why this matters and why Bailey should review it'),
  instructions: z.string().trim().max(2000).default('').describe('Manual action Bailey would carry out; never an executed action'),
  calendar: z.object({
    title: z.string().trim().min(1).max(200),
    start: brisbaneTime.nullable().default(null),
    end: brisbaneTime.nullable().default(null),
    timeZone: z.literal('Australia/Brisbane').default('Australia/Brisbane'),
    location: z.string().trim().max(500).default(''),
  }).strict().nullable().default(null),
  missing_details: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
};
export const proposalInput = z.object(proposalShape).strict().superRefine((v, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (v.kind === 'manual' && (!v.instructions || v.calendar)) fail('Manual proposals need instructions and no calendar payload.');
  if (v.kind === 'calendar_create' && (!v.calendar || v.instructions)) fail('Calendar proposals need a calendar payload and no manual instructions.');
  if (v.calendar?.start && v.calendar.end && Date.parse(v.calendar.end) <= Date.parse(v.calendar.start)) {
    fail('Calendar end must be after start.');
  }
});
export const decisionInput = z.object({
  decision: z.enum(['approved', 'rejected']), revision: z.number().int().positive(),
}).strict();

type Proposal = z.infer<typeof proposalInput>;
export function sourceSnapshot(f: Record<string, any>) {
  return { message_id: f.message_id, thread_id: f.thread_id, sender: f.sender, subject: f.subject,
    received_at: f.received_at, evidence: f.evidence, deadline_text: f.deadline_text, missing_details: f.missing_details };
}
export const stableJson = (value: unknown): string => {
  const sort = (v: any): any => v && typeof v === 'object'
    ? Array.isArray(v) ? v.map(sort) : Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
};
const reviewHash = (kind: string, title: string, detail: string, payload: unknown, source: unknown, mode: string) =>
  createHash('sha256').update(stableJson({ kind, title, detail, payload, source, execution_mode: mode })).digest('hex');
export interface ActionRow {
  id: number; finding_id: number | null; run_id: number; kind: Proposal['kind']; title: string; detail: string;
  proposed_action: { instructions: string; calendar: Proposal['calendar']; target_calendar: string | null; missing_details: string[] };
  source_snapshot: Record<string, any>; payload_hash: string; revision: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired'; execution_status: string; execution_mode: string;
  expires_at: Date | null; decided_at: Date | null; updated_at: Date;
  calendar_event_id?: string | null; calendar_target_id?: string | null; execution_error?: string | null; executed_at?: Date | null;
}

export async function audit(client: PoolClient, row: ActionRow, event: string, actor: string, runId: number | null = null) {
  await client.query(`INSERT INTO approval_events (approval_id,revision,event_type,actor,run_id,snapshot)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [row.id, row.revision, event, actor, runId, JSON.stringify(row)]);
}

/** One atomic statement: expiry cannot leave its audit event behind. */
async function expire(client: PoolClient) {
  await client.query(`WITH expired AS (
    UPDATE approvals SET status='expired', updated_at=now()
    WHERE status IN ('pending','approved') AND expires_at <= now() AND execution_status='not_requested'
    RETURNING *
  ) INSERT INTO approval_events (approval_id,revision,event_type,actor,snapshot)
    SELECT id,revision,'expired','system',to_jsonb(expired) FROM expired`);
}

export function actionView(row: ActionRow, findingStatus?: string, configuredTarget?: string | null, executionEnabled = false) {
  const demo = row.source_snapshot?.demo === true;
  const rawMissing = row.proposed_action?.missing_details;
  const missing: string[] = Array.isArray(rawMissing) ? rawMissing.filter((v): v is string => typeof v === 'string') : [];
  if (demo) missing.push('Demo request — preview only. It cannot create a Google event.');
  else if (!row.finding_id || !row.payload_hash) missing.push('This legacy suggestion has no verified finding; it cannot be approved.');
  if (findingStatus === 'dismissed') missing.push('The source finding was dismissed.');
  if (row.kind === 'calendar_create') {
    if (row.execution_mode === 'enabled' && !executionEnabled) missing.push('Connect calendar write access before approval.');
    const calendar = row.proposed_action?.calendar;
    if (!row.proposed_action?.target_calendar) missing.push('Choose the target calendar before approval.');
    else if (configuredTarget !== undefined && row.proposed_action.target_calendar !== configuredTarget) missing.push('The target calendar changed; this proposal needs to be refreshed.');
    if (!calendar?.start || !calendar.end) missing.push('Exact start and end times are required.');
    if (calendar?.start && Date.parse(calendar.start) <= Date.now()) missing.push('The proposed start time has passed.');
  }
  return { ...row, blocked_reasons: [...new Set(missing)], can_approve: row.status === 'pending' && missing.length === 0,
    can_prepare: !demo && row.kind === 'calendar_create' && row.execution_mode === 'record_only' && executionEnabled &&
      ['pending', 'approved'].includes(row.status) && row.execution_status === 'not_requested',
    can_execute: !demo && row.kind === 'calendar_create' && row.execution_mode === 'enabled' && row.status === 'approved' && executionEnabled &&
      ['not_requested', 'failed', 'uncertain', 'executing'].includes(row.execution_status),
    can_undo: !demo && ['succeeded','undo_uncertain'].includes(row.execution_status) && executionEnabled };
}

export async function proposeAction(pool: Pool, runId: number, input: Proposal, targetCalendar?: string, executionEnabled = false) {
  await withTransaction(pool, expire);
  return withTransaction(pool, async (client) => {
    const run = await client.query("SELECT id FROM runs WHERE id=$1 AND status='running' FOR UPDATE", [runId]);
    if (!run.rowCount) throw new NotFoundError('Run is no longer running.');
    const found = await client.query('SELECT * FROM email_findings WHERE id=$1 FOR UPDATE', [input.finding_id]);
    const f = found.rows[0];
    if (!f) throw new NotFoundError('Source finding not found.');
    if (f.status === 'dismissed') throw new ConflictError('This source finding was dismissed; do not re-propose it.');
    // Broker permits only findings it saved in this run; enforce that at the API too.
    if (f.last_run_id !== runId) throw new ConflictError('Save this source finding in the current run before proposing an action.');
    const source = sourceSnapshot(f);
    const missing = input.kind === 'calendar_create'
      ? [...new Set([...input.missing_details, ...f.missing_details])].sort() : [...new Set(input.missing_details)].sort();
    const payload = { instructions: input.instructions, calendar: input.calendar,
      target_calendar: input.kind === 'calendar_create' ? targetCalendar?.trim() || null : null, missing_details: missing };
    const mode = input.kind === 'calendar_create' && executionEnabled ? 'enabled' : 'record_only';
    const hash = reviewHash(input.kind, input.title, input.detail, payload, source, mode);
    const legacyHash = createHash('sha256').update(JSON.stringify({ kind: input.kind, title: input.title,
      detail: input.detail, payload, source, execution_mode: mode })).digest('hex');
    const old = (await client.query<ActionRow>('SELECT * FROM approvals WHERE finding_id=$1 AND kind=$2 FOR UPDATE',
      [input.finding_id, input.kind])).rows[0];
    if (old?.execution_status === 'not_requested' && old.expires_at && old.expires_at.getTime() <= Date.now()) return actionView({ ...old, status: 'expired' }, f.status);
    // Terminal decisions never reopen on a scan. A repeat must not extend the expiry either.
    if (old && (old.payload_hash === hash || old.payload_hash === legacyHash || old.status === 'rejected' || old.status === 'expired')) return actionView(old, f.status, targetCalendar?.trim() || null, executionEnabled);
    if (old && !['not_requested','failed'].includes(old.execution_status)) throw new ConflictError('An executing or uncertain action cannot be revised.');
    const expiresAt = new Date(Math.min(Date.now() + 7 * 86_400_000,
      input.calendar?.start ? Date.parse(input.calendar.start) : Infinity));
    if (expiresAt.getTime() <= Date.now()) throw new ConflictError('The proposed calendar time has already passed.');
    let row: ActionRow;
    if (old) {
      row = (await client.query<ActionRow>(`UPDATE approvals SET title=$2,detail=$3,proposed_action=$4::jsonb,
        source_snapshot=$5::jsonb,payload_hash=$6,revision=revision+1,run_id=$7,status='pending',decided_at=NULL,
        expires_at=$8,updated_at=now(),execution_mode=$9,execution_status='not_requested',execution_error=NULL,
        calendar_event_id=NULL,calendar_target_id=NULL
        WHERE id=$1 RETURNING *`, [old.id, input.title, input.detail, JSON.stringify(payload), JSON.stringify(source), hash, runId, expiresAt, mode])).rows[0]!;
    } else {
      row = (await client.query<ActionRow>(`INSERT INTO approvals
        (run_id,finding_id,kind,title,detail,proposed_action,source_snapshot,payload_hash,expires_at,risk,execution_mode)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,'medium',$10) RETURNING *`,
        [runId, input.finding_id, input.kind, input.title, input.detail, JSON.stringify(payload), JSON.stringify(source), hash, expiresAt, mode])).rows[0]!;
    }
    await audit(client, row, old ? 'revised' : 'proposed', 'ea', runId);
    return actionView(row, f.status, targetCalendar?.trim() || null, executionEnabled);
  });
}

/** Explicit owner operation: old decisions never turn into executable approvals. */
export async function prepareCalendarAction(pool: Pool, id: number, revision: number, target: string, ready: boolean) {
  if (!ready) throw new ConflictError('Connect calendar write access first.');
  return withTransaction(pool, async (client) => {
    const identity = (await client.query('SELECT finding_id FROM approvals WHERE id=$1', [id])).rows[0];
    if (!identity) throw new NotFoundError('Action not found.');
    const f = (await client.query('SELECT * FROM email_findings WHERE id=$1 FOR UPDATE', [identity.finding_id])).rows[0];
    const row = (await client.query<ActionRow>('SELECT * FROM approvals WHERE id=$1 FOR UPDATE', [id])).rows[0]!;
    if (row.source_snapshot?.demo === true) throw new ConflictError('Demo requests cannot be enabled for creation.');
    if (row.revision !== revision) throw new ConflictError('The proposal changed. Reload it.');
    if (row.kind !== 'calendar_create' || !['pending','approved'].includes(row.status) || row.execution_status !== 'not_requested' ||
      !f || f.status === 'dismissed' || !row.expires_at || row.expires_at.getTime() <= Date.now()) throw new ConflictError('This proposal cannot be prepared for creation.');
    if (stableJson(sourceSnapshot(f)) !== stableJson(row.source_snapshot)) throw new ConflictError('The source changed. Scan it again before preparing this proposal.');
    if (row.execution_mode === 'enabled') return actionView(row, f.status, target, true);
    const payload = { ...row.proposed_action, target_calendar: target };
    const hash = reviewHash(row.kind, row.title, row.detail, payload, row.source_snapshot, 'enabled');
    const updated = (await client.query<ActionRow>(`UPDATE approvals SET proposed_action=$2::jsonb,payload_hash=$3,
      execution_mode='enabled',revision=revision+1,status='pending',decided_at=NULL,updated_at=now()
      WHERE id=$1 RETURNING *`, [id, JSON.stringify(payload), hash])).rows[0]!;
    await audit(client, updated, 'enabled_for_review', 'owner');
    return actionView(updated, f.status, target, true);
  });
}

export async function listActions(pool: Pool, pendingOnly = false, targetCalendar?: string, executionEnabled = false) {
  return withTransaction(pool, async (client) => {
    await expire(client);
    const { rows } = await client.query<ActionRow & { finding_status: string }>(`SELECT a.*, f.status AS finding_status
      FROM approvals a LEFT JOIN email_findings f ON f.id=a.finding_id
      ${pendingOnly ? "WHERE a.status='pending' AND (a.source_snapshot->>'demo') IS DISTINCT FROM 'true'" : ''}
      ORDER BY (a.status='pending') DESC, a.created_at DESC, a.id DESC LIMIT ${pendingOnly ? 30 : 200}`);
    const counts = (await client.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='pending')::int AS pending,
      count(*) FILTER (WHERE status='pending' AND source_snapshot->>'demo'='true')::int AS demo_pending FROM approvals
      ${pendingOnly ? "WHERE (source_snapshot->>'demo') IS DISTINCT FROM 'true'" : ''}`)).rows[0];
    return { items: rows.map(row => actionView(row, row.finding_status, targetCalendar?.trim() || null, executionEnabled)), calendar_write_ready: executionEnabled, target_calendar: targetCalendar || null, ...counts };
  });
}

export async function getAction(pool: Pool, id: number, targetCalendar?: string, executionEnabled = false) {
  return withTransaction(pool, async (client) => {
    await expire(client);
    const row = (await client.query<ActionRow & { finding_status: string }>(`SELECT a.*,f.status AS finding_status
      FROM approvals a LEFT JOIN email_findings f ON f.id=a.finding_id WHERE a.id=$1`, [id])).rows[0];
    if (!row) throw new NotFoundError('Action not found.');
    const events = (await client.query(`SELECT id,revision,event_type,actor,created_at
      FROM approval_events WHERE approval_id=$1 ORDER BY id`, [id])).rows;
    return { action: actionView(row, row.finding_status, targetCalendar?.trim() || null, executionEnabled), events };
  });
}

export async function decideAction(pool: Pool, id: number, decision: z.infer<typeof decisionInput>, targetCalendar?: string, executionEnabled = false) {
  await withTransaction(pool, expire);
  return withTransaction(pool, async (client) => {
    const identity = (await client.query('SELECT finding_id FROM approvals WHERE id=$1', [id])).rows[0];
    if (!identity) throw new NotFoundError('Action not found.');
    // Match the proposer lock order: source first, then action, to avoid a decision/re-scan deadlock.
    const source = (await client.query('SELECT status FROM email_findings WHERE id=$1 FOR UPDATE', [identity.finding_id])).rows[0];
    const row = (await client.query<ActionRow>('SELECT * FROM approvals WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row) throw new NotFoundError('Action not found.');
    if (row.revision !== decision.revision) throw new ConflictError('This proposal changed. Reload and review the latest details.');
    const elapsed = row.expires_at && row.expires_at.getTime() <= Date.now();
    if (row.status === decision.decision && (row.status === 'rejected' || !elapsed || ['succeeded','undone','undo_uncertain'].includes(row.execution_status))) return actionView(row, source?.status, targetCalendar?.trim() || null, executionEnabled); // Idempotent retry.
    if (elapsed) throw new ConflictError('This action expired; it cannot be decided.');
    if (row.status !== 'pending') throw new ConflictError(`This action is ${row.status}; its decision cannot be changed.`);
    const view = actionView(row, source?.status, targetCalendar?.trim() || null, executionEnabled);
    if (decision.decision === 'approved') {
      if (!view.can_approve) throw new ConflictError(view.blocked_reasons.join(' '));
      if (row.kind === 'calendar_create' && row.proposed_action.target_calendar !== (targetCalendar?.trim() || null)) {
        throw new ConflictError('The configured target calendar changed. Generate and review a new proposal.');
      }
    }
    const updated = (await client.query<ActionRow>(`UPDATE approvals SET status=$2,decided_at=now(),updated_at=now()
      WHERE id=$1 RETURNING *`, [id, decision.decision])).rows[0]!;
    await audit(client, updated, decision.decision, 'owner');
    return actionView(updated, source?.status, targetCalendar?.trim() || null, executionEnabled);
  });
}

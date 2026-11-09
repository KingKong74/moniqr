/** Owner-only execution. Database locks serialise each source/action across network
 * calls. A stable provider ID survives a process crash or transaction rollback.
 * An uncertain insert is ONLY reconciled; a 404 never authorises another insert.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from './db.js';
import type { PoolClient } from 'pg';
import { actionView, audit, sourceSnapshot, stableJson, type ActionRow } from './actions.js';
import { ConflictError, NotFoundError } from './runs.js';
import { CalendarProviderError, eventId, matchesEvent, type CalendarWriter, type EventSpec } from './calendar-writer.js';

/** A session lock survives our deliberate commit of the write-start marker. It
 * disappears on connection loss, leaving the durable marker for reconciliation.
 */
async function withExecutionLock<T>(pool: Pool, id: number, work: (client: PoolClient, durable: () => Promise<void>) => Promise<T>): Promise<T> {
  const client = await pool.connect(); let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(6846,$1)', [id]); locked = true;
    await client.query('BEGIN');
    const result = await work(client, async () => { await client.query('COMMIT'); await client.query('BEGIN'); });
    await client.query('COMMIT'); return result;
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; }
  finally {
    let releaseError: Error | undefined;
    try { if (locked) await client.query('SELECT pg_advisory_unlock(6846,$1)', [id]); }
    catch (err) { releaseError = err instanceof Error ? err : new Error('Could not release execution lock.'); }
    client.release(releaseError);
  }
}

export async function executeCalendarAction(pool: Pool, writer: CalendarWriter, id: number, revision: number, undo = false) {
  return withExecutionLock(pool, id, async (client, durable) => {
    const identity = (await client.query('SELECT finding_id FROM approvals WHERE id=$1', [id])).rows[0];
    if (!identity) throw new NotFoundError('Action not found.');
    const f = (await client.query('SELECT * FROM email_findings WHERE id=$1 FOR UPDATE', [identity.finding_id])).rows[0];
    let row = (await client.query<ActionRow>('SELECT * FROM approvals WHERE id=$1 FOR UPDATE', [id])).rows[0]!;
    if (row.revision !== revision) throw new ConflictError('The proposal changed. Reload and review it.');
    if (row.kind !== 'calendar_create' || row.status !== 'approved' || row.execution_mode !== 'enabled') throw new ConflictError('This is not an approved executable calendar proposal.');
    if (row.proposed_action.target_calendar !== writer.calendarId || row.calendar_target_id && row.calendar_target_id !== writer.calendarId) throw new ConflictError('The target calendar changed. A fresh review is required.');
    const cal = row.proposed_action.calendar;
    if (!cal?.start || !cal.end || row.proposed_action.missing_details.length) throw new ConflictError('Calendar details are incomplete.');
    await client.query("INSERT INTO notes (key,value) VALUES ('calendar_instance_id',$1) ON CONFLICT (key) DO NOTHING", [randomUUID()]);
    const instance = (await client.query("SELECT value FROM notes WHERE key='calendar_instance_id'")).rows[0].value;
    const spec: EventSpec = {
      id: eventId(instance, id, revision), title: cal.title, start: cal.start, end: cal.end, location: cal.location,
      tags: { moniqrInstance: instance, moniqrAction: String(id), moniqrRevision: String(revision), moniqrHash: row.payload_hash },
    };
    if (row.calendar_event_id && row.calendar_event_id !== spec.id) throw new ConflictError('The event identity does not match this proposal.');
    const finish = async (state: string, error: string | null = null) => {
      row = (await client.query<ActionRow>(`UPDATE approvals SET execution_status=$2,execution_error=$3,
        calendar_event_id=$4,calendar_target_id=$5,executed_at=CASE WHEN $2='succeeded' THEN now() ELSE executed_at END,
        updated_at=now() WHERE id=$1 RETURNING *`, [id, state, error, spec.id, writer.calendarId])).rows[0]!;
      await audit(client, row, state, undo ? 'owner' : 'system');
      return actionView(row, f?.status, writer.calendarId, true);
    };
    if (!undo && ['succeeded','undone','undo_uncertain'].includes(row.execution_status)) return actionView(row, f?.status, writer.calendarId, true);
    if (undo && row.execution_status === 'undone') return actionView(row, f?.status, writer.calendarId, true);
    if (undo && !['succeeded','undo_uncertain'].includes(row.execution_status)) throw new ConflictError('Only a confirmed Moniqr event can be undone.');
    let existing;
    try { existing = await writer.get(spec.id); }
    catch { return finish(undo ? 'undo_uncertain' : ['uncertain','executing'].includes(row.execution_status) ? 'uncertain' : 'failed', 'Google could not be checked. No new write was attempted.'); }
    if (existing && !matchesEvent(existing, spec)) return finish(undo ? 'undo_uncertain' : 'uncertain', 'The Google event differs or lacks Moniqr ownership tags. No write or deletion was attempted.');
    if (undo) {
      if (!existing) return finish('undone');
      row = (await client.query<ActionRow>("UPDATE approvals SET execution_status='undo_uncertain',updated_at=now() WHERE id=$1 RETURNING *", [id])).rows[0]!;
      await audit(client, row, 'undo_started', 'owner');
      await durable();
      try { await writer.remove(existing); return finish('undone'); }
      catch (err) { return finish('undo_uncertain', err instanceof Error ? err.message : 'Google did not confirm undo.'); }
    }
    if (existing) return finish('succeeded'); // Reconcile even if the source/approval expired after the original request.
    if (['uncertain','executing'].includes(row.execution_status)) return finish('uncertain', 'No event is visible yet. A previous insert was not confirmed; no replacement was created.');
    if (!f || f.status === 'dismissed' || stableJson(sourceSnapshot(f)) !== stableJson(row.source_snapshot)) {
      return finish('failed', 'The source changed or was dismissed. Generate and review a fresh proposal.');
    }
    if (!row.expires_at || row.expires_at.getTime() <= Date.now() || Date.parse(cal.start) <= Date.now()) return finish('failed', 'The approval or proposed time expired. No event was created.');
    row = (await client.query<ActionRow>(`UPDATE approvals SET execution_status='executing',
      calendar_event_id=$2,calendar_target_id=$3,updated_at=now() WHERE id=$1 RETURNING *`,
      [id, spec.id, writer.calendarId])).rows[0]!;
    await audit(client, row, 'execution_started', 'system');
    await durable();
    // Reacquire in source/action order after committing the durable marker.
    const fresh = (await client.query('SELECT * FROM email_findings WHERE id=$1 FOR UPDATE', [row.finding_id])).rows[0];
    const current = (await client.query<ActionRow>('SELECT * FROM approvals WHERE id=$1 FOR UPDATE', [id])).rows[0]!;
    if (current.revision !== revision || current.status !== 'approved' || current.execution_mode !== 'enabled' ||
      !fresh || fresh.status === 'dismissed' || stableJson(sourceSnapshot(fresh)) !== stableJson(row.source_snapshot) ||
      !current.expires_at || current.expires_at.getTime() <= Date.now()) return finish('failed', 'The approval or source changed before the write. No event was created.');
    try {
      const created = await writer.create(spec);
      if (!matchesEvent(created, spec)) return finish('uncertain', 'Google returned an unexpected event. Check the result before taking further action.');
      return finish('succeeded');
    } catch (err) {
      // A conflict or a lost reply can mean Google already created the event.
      if (!(err instanceof CalendarProviderError) || err.status === null || err.status === 409 || err.status >= 500) {
        try { const found = await writer.get(spec.id); if (found && matchesEvent(found, spec)) return finish('succeeded'); } catch {}
        return finish('uncertain', 'Google did not confirm creation. Use Check result; no duplicate will be inserted.');
      }
      return finish('failed', err.message);
    }
  });
}

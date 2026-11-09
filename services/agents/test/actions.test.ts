import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from '../src/db.js';
import { decideAction, proposalInput, proposeAction, listActions, prepareCalendarAction } from '../src/actions.js';
import { API_TOKEN, RUNNER_TOKEN, freshDatabase, skipReason, startApp } from './helpers.js';

const source = {
  message_id: 'message1', thread_id: 'thread1', category: 'commitment', sender: 'Roster <roster@example.com>',
  subject: 'Confirm next shift', received_at: '2026-11-08T09:00:00+10:00',
  summary: 'Confirm the shift', evidence: 'Please confirm your next shift.', deadline_text: '', missing_details: [],
};
const manual = { finding_id: 1, kind: 'manual', title: 'Confirm the shift', detail: 'The roster asks for confirmation.',
  instructions: 'Check the roster and reply yourself.', missing_details: [] };
const tomorrow = (hours: number) => new Date(Date.now() + 86_400_000 + hours * 3_600_000 + 10 * 3_600_000)
  .toISOString().replace('Z', '+10:00');
const calendar = { finding_id: 1, kind: 'calendar_create', title: 'Add the confirmed shift', detail: 'Review the source times.',
  calendar: { title: 'Shift', start: tomorrow(0), end: tomorrow(4), timeZone: 'Australia/Brisbane', location: 'Store' } };

test('proposal schemas accept only supported local-review types and strict Brisbane calendar details', () => {
  assert.ok(proposalInput.safeParse(manual).success);
  assert.ok(proposalInput.safeParse(calendar).success);
  for (const invalid of [
    { ...manual, kind: 'send_email' }, { ...manual, instructions: '' }, { ...manual, execution_mode: 'enabled' },
    { ...calendar, instructions: 'also send this' },
    { ...calendar, calendar: { ...calendar.calendar, attendees: ['stranger@example.com'] } },
    { ...calendar, calendar: { ...calendar.calendar, target_calendar: 'arbitrary' } },
    { ...calendar, calendar: { ...calendar.calendar, start: '2026-02-30T09:00:00+10:00' } },
    { ...calendar, calendar: { ...calendar.calendar, start: '2026-11-09T09:00:00Z' } },
    { ...calendar, calendar: { ...calendar.calendar, end: calendar.calendar.start } },
  ]) assert.equal(proposalInput.safeParse(invalid).success, false, JSON.stringify(invalid));
  assert.ok(proposalInput.safeParse({ ...calendar, calendar: { title: 'Shift', start: null, end: null }, missing_details: ['Exact date'] }).success);
});

describe('action review', { skip: skipReason }, () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let api: Awaited<ReturnType<typeof startApp>>;
  let run: { run: { id: number }; runToken: string };
  let action: any;
  const propose = (body: unknown) => api.call('POST', `/runs/${run.run.id}/actions`, run.runToken, body);
  const decide = (id: number, decision: string, revision: number) => api.call('POST', `/actions/${id}/decision`, API_TOKEN, { decision, revision });
  before(async () => {
    ({ pool, drop } = await freshDatabase());
    api = await startApp(pool, 60_000, 'owner-calendar');
    await api.call('POST', '/agents/ea/run', API_TOKEN, { kind: 'morning_brief' });
    run = (await api.call('POST', '/runner/claim', RUNNER_TOKEN)).body;
    assert.equal((await api.call('POST', `/runs/${run.run.id}/findings`, run.runToken, source)).status, 201);
  });
  after(async () => { await api.close(); await drop(); });

  test('separates hub decisions from run-scoped proposal and read tools', async () => {
    assert.equal((await api.call('GET', '/actions')).status, 401);
    assert.equal((await api.call('GET', '/actions', RUNNER_TOKEN)).status, 401);
    assert.equal((await api.call('GET', `/runs/${run.run.id}/actions`, API_TOKEN)).status, 401);
    assert.equal((await api.call('GET', `/runs/${run.run.id}/actions`, run.runToken)).status, 200);
    assert.equal((await api.call('GET', `/runs/${run.run.id + 1}/actions`, run.runToken)).status, 401);
    assert.equal((await api.call('POST', `/runs/${run.run.id}/actions`, API_TOKEN, manual)).status, 401);
    assert.equal((await propose({ ...manual, finding_id: 9999 })).status, 404);
    assert.equal((await propose({ ...manual, status: 'approved' })).status, 400);
    assert.equal((await propose({ ...manual, kind: 'pay_bill' })).status, 400);
    assert.equal((await api.call('POST', '/actions/1/decision', run.runToken, { decision: 'approved', revision: 1 })).status, 401);
    assert.equal((await api.call('GET', '/actions/99999', API_TOKEN)).status, 404);
  });

  test('concurrent proposals deduplicate; same content preserves revision and expiry', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => propose(manual)));
    for (const r of results) assert.equal(r.status, 201);
    assert.equal(new Set(results.map(r => r.body.action.id)).size, 1);
    action = results[0]!.body.action;
    const again = (await propose(manual)).body.action;
    assert.equal(again.revision, 1);
    assert.equal(again.expires_at, action.expires_at);
    const detail = (await api.call('GET', `/actions/${action.id}`, API_TOKEN)).body;
    assert.equal(detail.events.length, 1);
    assert.equal(detail.events[0].actor, 'ea');
    assert.equal(detail.action.source_snapshot.evidence, source.evidence);
    assert.equal(detail.action.execution_mode, 'record_only');
  });

  test('approval is atomic and idempotent, and does not enqueue execution', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => decide(action.id, 'approved', 1)));
    for (const r of results) assert.equal(r.status, 200);
    const detail = (await api.call('GET', `/actions/${action.id}`, API_TOKEN)).body;
    assert.equal(detail.action.status, 'approved');
    assert.equal(detail.action.execution_status, 'not_requested');
    assert.equal(detail.action.execution_mode, 'record_only');
    assert.equal(detail.events.filter((e: any) => e.event_type === 'approved').length, 1);
    assert.equal((await decide(action.id, 'rejected', 1)).status, 409);
  });

  test('changing reviewed payload invalidates approval and rejects stale decisions', async () => {
    const revised = (await propose({ ...manual, instructions: 'Check the new roster before replying yourself.' })).body.action;
    assert.equal(revised.id, action.id);
    assert.equal(revised.revision, 2);
    assert.equal(revised.status, 'pending');
    assert.equal(revised.decided_at, null);
    assert.equal((await decide(action.id, 'approved', 1)).status, 409);
    const oldApproval = (await pool.query("SELECT snapshot FROM approval_events WHERE approval_id=$1 AND event_type='approved'", [action.id])).rows[0];
    assert.equal(oldApproval.snapshot.proposed_action.instructions, manual.instructions, 'immutable approved snapshot');
    assert.equal((await decide(action.id, 'rejected', 2)).status, 200);
    const repeat = (await propose({ ...manual, instructions: 'Something different again' })).body.action;
    assert.equal(repeat.status, 'rejected');
    assert.equal(repeat.revision, 2, 'rejected work never resurfaces through a scan');
    assert.equal((await decide(action.id, 'approved', 2)).status, 409);
  });

  test('calendar proposals use server-selected destination and remain record-only after approval', async () => {
    const r = await propose(calendar);
    assert.equal(r.status, 201);
    const c = r.body.action;
    assert.equal(c.proposed_action.target_calendar, 'owner-calendar');
    assert.equal(c.can_approve, true);
    await assert.rejects(decideAction(pool, c.id, { decision: 'approved', revision: 1 }, 'different-calendar'), /target calendar changed/);
    assert.equal((await decide(c.id, 'approved', c.revision)).status, 200);
    const saved = (await api.call('GET', `/actions/${c.id}`, API_TOKEN)).body.action;
    assert.equal(saved.status, 'approved');
    assert.equal(saved.execution_status, 'not_requested');
    assert.equal(saved.execution_mode, 'record_only');
  });

  test('missing details and dismissed sources cannot be approved', async () => {
    const missing = (await propose({ ...calendar, calendar: { title: 'Shift', start: null, end: null }, missing_details: ['Exact date'] })).body.action;
    assert.equal(missing.status, 'pending');
    assert.equal(missing.can_approve, false);
    assert.equal((await decide(missing.id, 'approved', missing.revision)).status, 409);
    const noDestination = await proposeAction(pool, run.run.id, proposalInput.parse(calendar));
    assert.equal(noDestination.proposed_action.target_calendar, null);
    assert.equal(noDestination.can_approve, false);
    const blocked = (await propose(calendar)).body.action;
    await api.call('PATCH', '/findings/1', API_TOKEN, { status: 'dismissed' });
    assert.equal((await decide(blocked.id, 'approved', blocked.revision)).status, 409);
    assert.equal((await propose(calendar)).status, 409);
    await api.call('PATCH', '/findings/1', API_TOKEN, { status: 'new' });
  });

  test('expired actions stay expired with one audit event and cannot be decided or reopened', async () => {
    const c = (await propose(calendar)).body.action;
    await pool.query("UPDATE approvals SET expires_at=now()-interval '1 second' WHERE id=$1", [c.id]);
    const listings = await Promise.all(Array.from({ length: 4 }, () => api.call('GET', '/actions', API_TOKEN)));
    for (const listing of listings) assert.equal(listing.body.items.find((i: any) => i.id === c.id).status, 'expired');
    assert.equal((await decide(c.id, 'approved', c.revision)).status, 409);
    assert.equal((await decide(c.id, 'rejected', c.revision)).status, 409);
    assert.equal((await propose({ ...calendar, title: 'Try again' })).body.action.status, 'expired');
    const detail = (await api.call('GET', `/actions/${c.id}`, API_TOKEN)).body;
    assert.equal(detail.events.filter((e: any) => e.event_type === 'expired').length, 1);
  });

  test('other runs must save their own finding first; run access ends with the run', async () => {
    await api.call('POST', '/agents/ea/run', API_TOKEN, { kind: 'morning_brief' });
    const second = (await api.call('POST', '/runner/claim', RUNNER_TOKEN)).body;
    assert.equal((await api.call('POST', `/runs/${second.run.id}/actions`, second.runToken, manual)).status, 409);
    await api.call('POST', `/runs/${run.run.id}/brief`, run.runToken, { body_md: 'Pending decisions reviewed.', summary: 'Decisions only.' });
    await api.call('POST', `/runner/runs/${run.run.id}/finish`, RUNNER_TOKEN, { status: 'done' });
    assert.equal((await propose(manual)).status, 401);
    assert.equal((await api.call('GET', `/runs/${run.run.id}/actions`, run.runToken)).status, 401);
    assert.equal((await api.call('GET', '/actions', API_TOKEN)).body.total, 2, 'no duplicate proposals');
  });

  test('opposing decisions race atomically and a rejected decision remains idempotent after its expiry', async () => {
    await api.call('POST', '/agents/ea/run', API_TOKEN, { kind: 'morning_brief' });
    const next = (await api.call('POST', '/runner/claim', RUNNER_TOKEN)).body;
    const finding = (await api.call('POST', `/runs/${next.run.id}/findings`, next.runToken,
      { ...source, message_id: 'message2', thread_id: 'thread2' })).body.finding;
    const action = (await api.call('POST', `/runs/${next.run.id}/actions`, next.runToken,
      { ...manual, finding_id: finding.id })).body.action;
    const outcomes = await Promise.all([decide(action.id, 'approved', 1), decide(action.id, 'rejected', 1)]);
    assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409]);
    const history = (await api.call('GET', `/actions/${action.id}`, API_TOKEN)).body;
    assert.equal(history.events.filter((e: any) => ['approved', 'rejected'].includes(e.event_type)).length, 1);
    // Make a separate rejection so the idempotency case does not depend on who won the race.
    const secondFinding = (await api.call('POST', `/runs/${next.run.id}/findings`, next.runToken,
      { ...source, message_id: 'message3', thread_id: 'thread3' })).body.finding;
    const rejected = (await api.call('POST', `/runs/${next.run.id}/actions`, next.runToken,
      { ...manual, finding_id: secondFinding.id })).body.action;
    assert.equal((await decide(rejected.id, 'rejected', 1)).status, 200);
    await pool.query("UPDATE approvals SET expires_at=now()-interval '1 day' WHERE id=$1", [rejected.id]);
    assert.equal((await decide(rejected.id, 'rejected', 1)).status, 200);
  });
  test('demo requests are non-executable, excluded from EA context, and dismissible', async () => {
    const existingRun=(await pool.query('SELECT id FROM runs ORDER BY id LIMIT 1')).rows[0].id;
    const row=(await pool.query(`INSERT INTO approvals (run_id,title,detail,kind,source_snapshot,proposed_action)
      VALUES ($1,'Demo: Study','Preview only','calendar_create','{"demo":true}', $2::jsonb) RETURNING id`,
      [existingRun,JSON.stringify({instructions:'',calendar:calendar.calendar,target_calendar:'owner-calendar',missing_details:[]})])).rows[0];
    const shown=(await listActions(pool,false,'owner-calendar',true)).items.find(i=>i.id===row.id)!;
    assert.equal(shown.can_approve,false);assert.equal(shown.can_prepare,false);assert.equal(shown.can_execute,false);
    await assert.rejects(prepareCalendarAction(pool,row.id,1,'owner-calendar',true),/Demo requests/);
    assert.ok(!(await listActions(pool,true)).items.some(i=>i.id===row.id));
    assert.equal((await decide(row.id,'approved',1)).status,409);
    assert.equal((await decide(row.id,'rejected',1)).status,200);
  });

});

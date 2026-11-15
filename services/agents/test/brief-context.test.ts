import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from '../src/db.js';
import { outcomeMeaning } from '../src/brief-context.js';
import { SourceLedger, sourcesFooter, withFooter } from '../src/mcp/sources.js';
import { API_TOKEN, RUNNER_TOKEN, freshDatabase, skipReason, startApp } from './helpers.js';

test('the sources footer reports what the broker saw, including failures and unread sources', () => {
  const ledger = new SourceLedger();
  let footer = sourcesFooter(ledger, false, null);
  assert.match(footer, /Calendar and email: not connected/);
  assert.match(footer, /Findings and decisions: not read in this run/);
  assert.match(footer, /Finance: not connected/);

  ledger.record(ledger.calendar, true, new Date('2026-11-15T20:05:00Z'));
  ledger.record(ledger.admin, false);
  footer = sourcesFooter(ledger, true, { status: 'partial', searches: 4, messages_read: 3, failures: 1 });
  assert.match(footer, /Calendar: read Mon 16 Nov.*6:05am/);
  assert.match(footer, /Email: \*\*partial\*\*, 4 searches, 3 read, 1 failed/);
  assert.match(footer, /Findings and decisions: \*\*unavailable\*\*/);

  assert.match(sourcesFooter(new SourceLedger(), true, { status: 'failed', searches: 0, messages_read: 0, failures: 0 }), /Email: not searched/);
  const failedCalendar = new SourceLedger();
  failedCalendar.record(failedCalendar.calendar, false);
  assert.match(sourcesFooter(failedCalendar, true, null), /Calendar: \*\*unavailable\*\*/);
});

test('the footer is always kept, even when the brief is at the length limit', () => {
  const footer = sourcesFooter(new SourceLedger(), false, null);
  const out = withFooter('x'.repeat(20_000), footer);
  assert.ok(out.length <= 20_000);
  assert.ok(out.endsWith(footer));
  assert.equal(withFooter('Brief\n', footer), `Brief\n\n${footer}`);
});

test('only a succeeded calendar write reads as created', () => {
  assert.match(outcomeMeaning('calendar_create', 'enabled', 'approved', 'succeeded'), /^Confirmed: moniqr created/);
  for (const state of ['failed', 'uncertain', 'executing', 'not_requested']) {
    assert.doesNotMatch(outcomeMeaning('calendar_create', 'enabled', 'approved', state), /created this event/, state);
  }
  assert.match(outcomeMeaning('calendar_create', 'record_only', 'approved', 'not_requested'), /record only; no event/);
  assert.match(outcomeMeaning('manual', 'record_only', 'approved', 'not_requested'), /not evidence it was done/);
});

describe('daily admin context', { skip: skipReason }, () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let api: Awaited<ReturnType<typeof startApp>>;
  let run: { run: { id: number }; runToken: string };
  const finding = (id: string, category: string) => ({
    message_id: id, thread_id: `thread-${id}`, category, sender: 'Biller <bills@example.com>', subject: `Subject ${id}`,
    received_at: '2026-11-14T09:00:00+10:00', summary: `Summary ${id}`, evidence: 'Amount due $42 by Friday.',
    deadline_text: 'by Friday', missing_details: [],
  });

  before(async () => {
    ({ pool, drop } = await freshDatabase());
    api = await startApp(pool, 60_000, 'owner-calendar');
    await api.call('POST', '/agents/ea/run', API_TOKEN, { kind: 'morning_brief' });
    run = (await api.call('POST', '/runner/claim', RUNNER_TOKEN)).body;
  });
  after(async () => { await api.close(); await drop(); });

  test('is run-token scoped', async () => {
    const path = `/runs/${run.run.id}/admin-context`;
    assert.equal((await api.call('GET', path)).status, 401);
    assert.equal((await api.call('GET', path, API_TOKEN)).status, 401);
    assert.equal((await api.call('GET', `/runs/${run.run.id + 1}/admin-context`, run.runToken)).status, 401);
    const empty = (await api.call('GET', path, run.runToken)).body;
    assert.equal(empty.email_scan.status, 'never');
    assert.equal(empty.open_findings.total, 0);
    assert.equal(empty.pending_decisions.total, 0);
    assert.deepEqual(empty.recent_outcomes, []);
    assert.equal(empty.calendar_writes, 'not connected');
  });

  test('separates mentioned, proposed and confirmed items and hides dismissed findings', async () => {
    const save = async (body: unknown) => (await api.call('POST', `/runs/${run.run.id}/findings`, run.runToken, body)).body.finding;
    const bill = await save(finding('bill1', 'bill'));
    const commitment = await save(finding('shift1', 'commitment'));
    const dismissed = await save(finding('spam1', 'reply'));
    await api.call('PATCH', `/findings/${dismissed.id}`, API_TOKEN, { status: 'dismissed' });
    const proposal = (await api.call('POST', `/runs/${run.run.id}/actions`, run.runToken, {
      finding_id: bill.id, kind: 'manual', title: 'Pay the bill', detail: 'Due Friday.', instructions: 'Pay it yourself.',
    })).body.action;
    const done = (await api.call('POST', `/runs/${run.run.id}/actions`, run.runToken, {
      finding_id: commitment.id, kind: 'manual', title: 'Confirm the shift', detail: 'Roster asks.', instructions: 'Reply yourself.',
    })).body.action;
    assert.equal((await api.call('POST', `/actions/${done.id}/decision`, API_TOKEN, { decision: 'approved', revision: done.revision })).status, 200);
    // A succeeded calendar outcome, as the executor records it.
    const { rows: [created] } = await pool.query(`INSERT INTO approvals (run_id, finding_id, kind, title, detail, proposed_action,
        source_snapshot, payload_hash, status, decided_at, execution_mode, execution_status, executed_at, calendar_event_id)
      VALUES ($1, $2, 'calendar_create', 'Shift', 'd', '{"calendar":{"title":"Shift"}}', '{}', 'h', 'approved', now(),
        'enabled', 'succeeded', now(), 'evt1') RETURNING id`, [run.run.id, commitment.id]);

    const ctx = (await api.call('GET', `/runs/${run.run.id}/admin-context`, run.runToken)).body;
    assert.equal(ctx.open_findings.total, 2, 'dismissed findings are left out');
    const items = Object.fromEntries(ctx.open_findings.items.map((f: any) => [f.category, f]));
    assert.match(items.bill.payment, /cannot see whether it is paid/);
    assert.equal(items.commitment.confirmed, false);
    assert.equal(items.bill.source_link, 'https://mail.google.com/mail/u/0/#all/thread-bill1');
    assert.deepEqual(ctx.pending_decisions.items.map((a: any) => a.id), [proposal.id]);
    assert.match(ctx.pending_decisions.items[0].meaning, /Proposed only/);
    const outcomes = Object.fromEntries(ctx.recent_outcomes.map((o: any) => [o.id, o]));
    assert.equal(outcomes[created.id].confirmed_created, true);
    assert.equal(outcomes[done.id].confirmed_created, false);
    assert.match(outcomes[done.id].meaning, /not evidence it was done/);
  });
});

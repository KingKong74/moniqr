import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from '../src/db.js';
import { API_TOKEN, RUNNER_TOKEN, freshDatabase, skipReason, startApp } from './helpers.js';

describe('brief run status and safe reruns', { skip: skipReason }, () => {
  let pool: Pool, drop: () => Promise<void>, api: Awaited<ReturnType<typeof startApp>>;
  before(async () => { ({ pool, drop } = await freshDatabase()); api = await startApp(pool); });
  after(async () => { await api.close(); await drop(); });
  const settings = async () => Object.fromEntries(
    (await api.call('GET', '/settings', API_TOKEN)).body.schedules.map((s: any) => [s.kind, s]));

  test('a rerun of a queued or running kind returns that run instead of starting another', async () => {
    const clicks = await Promise.all(Array.from({ length: 5 }, () => api.call('POST', '/agents/ea/run', API_TOKEN, { kind: 'morning_brief' })));
    const ids = new Set(clicks.map((c) => c.body.run.id));
    assert.equal(ids.size, 1, 'concurrent clicks queue one run');
    assert.equal(clicks.filter((c) => c.status === 202).length, 1);
    assert.ok(clicks.filter((c) => c.status === 200).every((c) => c.body.existing === true));
    assert.equal((await settings()).morning_brief.active_run.status, 'queued');

    const claimed = (await api.call('POST', '/runner/claim', RUNNER_TOKEN)).body;
    const whileRunning = await api.call('POST', '/agents/ea/run', API_TOKEN, { kind: 'morning_brief' });
    assert.equal(whileRunning.body.run.id, claimed.run.id, 'a running brief is not doubled');
    const other = await api.call('POST', '/agents/ea/run', API_TOKEN, { kind: 'afternoon_brief' });
    assert.equal(other.status, 202, 'a different kind may still start');

    // Partial email reads and a missing brief are reported, not hidden.
    await api.call('POST', `/runs/${claimed.run.id}/email-scan`, claimed.runToken, { status: 'partial', searches: 3, messages_read: 2, failures: 1 });
    await api.call('POST', `/runner/runs/${claimed.run.id}/finish`, RUNNER_TOKEN, { status: 'done' });
    const morning = (await settings()).morning_brief;
    assert.equal(morning.active_run, null);
    assert.equal(morning.last_run.id, claimed.run.id);
    assert.equal(morning.last_run.status, 'failed', 'a run without a brief is a failure');
    assert.match(morning.last_run.error, /without writing a brief/);
    assert.equal(morning.last_run.email_status, 'partial');
    assert.equal(morning.last_run.email_failures, 1);
    assert.equal(morning.last_run.has_brief, false);
    assert.equal(morning.last_success_at, null);

    const rerun = await api.call('POST', '/agents/ea/run', API_TOKEN, { kind: 'morning_brief' });
    assert.equal(rerun.status, 202, 'after it finishes, a rerun queues a fresh run');
    assert.notEqual(rerun.body.run.id, claimed.run.id);
  });

  test('a successful run records its brief and success time', async () => {
    await pool.query("UPDATE runs SET status='failed', finished_at=now() WHERE status IN ('queued','running')");
    await api.call('POST', '/agents/ea/run', API_TOKEN, { kind: 'afternoon_brief' });
    const run = (await api.call('POST', '/runner/claim', RUNNER_TOKEN)).body;
    await api.call('POST', `/runs/${run.run.id}/brief`, run.runToken, { body_md: 'Afternoon.', summary: 'Afternoon.' });
    await api.call('POST', `/runner/runs/${run.run.id}/finish`, RUNNER_TOKEN, { status: 'done' });
    const afternoon = (await settings()).afternoon_brief;
    assert.equal(afternoon.last_run.status, 'done');
    assert.equal(afternoon.last_run.has_brief, true);
    assert.equal(afternoon.last_run.email_status, null, 'no email scan is shown as none, not as complete');
    assert.ok(afternoon.last_success_at);
  });
});

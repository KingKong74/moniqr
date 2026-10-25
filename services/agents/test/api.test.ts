import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { API_TOKEN, RUNNER_TOKEN, freshDatabase, skipReason, startApp } from './helpers.js';

describe('agent API', { skip: skipReason }, () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let api: Awaited<ReturnType<typeof startApp>>;

  before(async () => {
    ({ pool, drop } = await freshDatabase());
    api = await startApp(pool);
  });
  after(async () => {
    await api.close();
    await drop();
  });

  const queueAndClaim = async (kind = 'test') => {
    const queued = await api.call('POST', '/agents/ea/run', API_TOKEN, { kind });
    assert.equal(queued.status, 202);
    const claimed = await api.call('POST', '/runner/claim', RUNNER_TOKEN);
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.run.id, queued.body.run.id);
    return claimed.body as { run: { id: number }; agent: { slug: string }; runToken: string };
  };

  test('seeds the EA with two disabled schedules, and migrating again is a no-op', async () => {
    const schedules = await api.call('GET', '/schedules', API_TOKEN);
    assert.deepEqual(
      schedules.body.schedules.map((s: any) => [s.agent, s.kind, s.enabled]),
      [
        ['ea', 'morning_brief', false],
        ['ea', 'weekly_lookahead', false],
      ],
    );
    assert.deepEqual(await migrate(pool), []);
  });

  test('keeps hub, runner and run tokens apart', async () => {
    assert.equal((await api.call('GET', '/runs')).status, 401);
    assert.equal((await api.call('GET', '/runs', 'wrong')).status, 401);
    assert.equal((await api.call('GET', '/runs', RUNNER_TOKEN)).status, 401);
    assert.equal((await api.call('POST', '/runner/claim', API_TOKEN)).status, 401);
    assert.equal((await api.call('GET', '/health')).status, 200);
  });

  test('rejects unknown agents and run kinds', async () => {
    assert.equal((await api.call('POST', '/agents/nobody/run', API_TOKEN, {})).status, 404);
    assert.equal((await api.call('POST', '/agents/ea/run', API_TOKEN, { kind: 'pay_bills' })).status, 400);
  });

  test('a run goes queued → running → done with exactly one brief', async () => {
    const claimed = await queueAndClaim();
    assert.equal(claimed.agent.slug, 'ea');
    assert.ok(claimed.runToken.length >= 40);
    assert.equal((await api.call('POST', '/runner/claim', RUNNER_TOKEN)).status, 204, 'queue now empty');

    const brief = { body_md: '# Test\n\nAll good.', summary: 'All good.' };
    const runPath = `/runs/${claimed.run.id}/brief`;
    assert.equal((await api.call('POST', runPath, 'not-the-token', brief)).status, 401);
    assert.equal((await api.call('POST', runPath, API_TOKEN, brief)).status, 401, 'hub token cannot write as a run');
    assert.equal((await api.call('POST', runPath, claimed.runToken, { body_md: '', summary: 'x' })).status, 400);
    assert.equal((await api.call('POST', runPath, claimed.runToken, brief)).status, 201);
    assert.equal((await api.call('POST', runPath, claimed.runToken, brief)).status, 409, 'one brief per run');

    const finished = await api.call('POST', `/runner/runs/${claimed.run.id}/finish`, RUNNER_TOKEN, {
      status: 'done',
      result: { num_turns: 2 },
    });
    assert.equal(finished.status, 200);
    assert.equal(finished.body.run.status, 'done');
    assert.ok(finished.body.run.duration_ms >= 0);

    assert.equal((await api.call('POST', runPath, claimed.runToken, brief)).status, 401, 'token dies with the run');
    assert.equal(
      (await api.call('POST', `/runner/runs/${claimed.run.id}/finish`, RUNNER_TOKEN, { status: 'done' })).status,
      409,
    );

    const latest = await api.call('GET', '/briefs/latest', API_TOKEN);
    assert.equal(latest.body.brief.run_id, claimed.run.id);
    assert.equal(latest.body.brief.kind, 'test');
    assert.equal(latest.body.brief.summary, 'All good.');
  });

  test('a run that ends "done" without a brief is recorded as failed', async () => {
    const claimed = await queueAndClaim();
    const finished = await api.call('POST', `/runner/runs/${claimed.run.id}/finish`, RUNNER_TOKEN, { status: 'done' });
    assert.equal(finished.body.run.status, 'failed');
    assert.equal(finished.body.run.error, 'Run ended without writing a brief');
  });

  test('a run stuck in "running" is failed as stale on the next claim', async () => {
    const claimed = await queueAndClaim();
    await pool.query(`UPDATE runs SET started_at = now() - interval '2 hours' WHERE id = $1`, [claimed.run.id]);
    assert.equal((await api.call('POST', '/runner/claim', RUNNER_TOKEN)).status, 204);
    const run = await api.call('GET', `/runs/${claimed.run.id}`, API_TOKEN);
    assert.equal(run.body.run.status, 'failed');
    assert.match(run.body.run.error, /stale/);
  });

  test('lists runs newest first', async () => {
    const runs = await api.call('GET', '/runs?limit=2', API_TOKEN);
    assert.equal(runs.body.runs.length, 2);
    assert.ok(runs.body.runs[0].id > runs.body.runs[1].id);
    assert.equal((await api.call('GET', '/runs?limit=500', API_TOKEN)).status, 400);
  });
});

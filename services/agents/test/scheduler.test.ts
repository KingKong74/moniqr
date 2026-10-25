import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from '../src/db.js';
import { nextFireAfter, tick } from '../src/scheduler.js';
import { freshDatabase, skipReason } from './helpers.js';

describe('scheduler', { skip: skipReason }, () => {
  let pool: Pool;
  let drop: () => Promise<void>;

  before(async () => ({ pool, drop } = await freshDatabase()));
  after(async () => drop());

  const morning = async () =>
    (await pool.query(`SELECT * FROM schedules WHERE kind = 'morning_brief'`)).rows[0];
  const scheduledRuns = async () =>
    Number((await pool.query(`SELECT count(*) FROM runs WHERE trigger = 'schedule'`)).rows[0].count);

  test('reads cron times in Brisbane time', () => {
    // 6:30am Tuesday 27 Oct in Brisbane is 8:30pm Monday 26 Oct UTC.
    const next = nextFireAfter('30 6 * * *', 'Australia/Brisbane', new Date('2026-10-26T12:00:00Z'));
    assert.equal(next.toISOString(), '2026-10-26T20:30:00.000Z');
  });

  test('disabled schedules never queue runs', async () => {
    assert.deepEqual(await tick(pool, new Date('2026-10-26T21:00:00Z')), []);
    assert.equal((await morning()).next_run_at, null);
  });

  test('switching a schedule on sets its next time without firing straight away', async () => {
    await pool.query(`UPDATE schedules SET enabled = true WHERE kind = 'morning_brief'`);
    assert.deepEqual(await tick(pool, new Date('2026-10-26T21:00:00Z')), []);
    assert.equal((await morning()).next_run_at.toISOString(), '2026-10-27T20:30:00.000Z');
  });

  test('a due schedule queues one run and moves on, even after missed days', async () => {
    const threeDaysLate = new Date('2026-10-30T22:00:00Z');
    const queued = await tick(pool, threeDaysLate);
    assert.equal(queued.length, 1);
    const run = (await pool.query('SELECT * FROM runs WHERE id = $1', [queued[0]])).rows[0];
    assert.equal(run.kind, 'morning_brief');
    assert.equal(run.status, 'queued');
    const s = await morning();
    assert.equal(s.next_run_at.toISOString(), '2026-10-31T20:30:00.000Z');
    assert.equal(s.last_run_at.toISOString(), threeDaysLate.toISOString());
    assert.deepEqual(await tick(pool, threeDaysLate), [], 'not queued twice');
  });

  test('a disabled agent stops its schedules', async () => {
    await pool.query(`UPDATE agents SET enabled = false WHERE slug = 'ea'`);
    const before = await scheduledRuns();
    assert.deepEqual(await tick(pool, new Date('2026-11-05T22:00:00Z')), []);
    assert.equal(await scheduledRuns(), before);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from '../src/db.js';
import { adminContext } from '../src/brief-context.js';
import { tick } from '../src/scheduler.js';
import { buildPrompt } from '../src/runner/run.js';
import { API_TOKEN, RUNNER_TOKEN, freshDatabase, skipReason, startApp } from './helpers.js';

describe('personal backlog and brief settings', { skip: skipReason }, () => {
  let pool: Pool, drop: () => Promise<void>, api: Awaited<ReturnType<typeof startApp>>;
  before(async () => { ({ pool, drop } = await freshDatabase()); api = await startApp(pool); });
  after(async () => { await api.close(); await drop(); });
  test('only the owner can read or change backlog and settings', async () => {
    for (const token of [undefined, RUNNER_TOKEN]) {
      for (const path of ['/backlog', '/settings']) assert.equal((await api.call('GET', path, token)).status, 401);
      assert.equal((await api.call('POST', '/backlog', token, { title: 'No' })).status, 401);
      assert.equal((await api.call('PATCH', '/backlog/1', token, { title: 'No' })).status, 401);
      assert.equal((await api.call('PUT', '/settings', token, {})).status, 401);
    }
  });
  test('seeds chatbot as a task; validates, persists and completes items; EA sees open tasks', async () => {
    const initial = await api.call('GET', '/backlog', API_TOKEN);
    assert.match(initial.body.items[0].title, /chatbot/);
    assert.equal((await api.call('POST', '/backlog', API_TOKEN, { title: '  ' })).status, 400);
    const created = await api.call('POST', '/backlog', API_TOKEN, { title: 'Study plan', notes: 'CA exam', priority: 'high' });
    assert.equal(created.status, 201);
    const item = created.body.item;
    assert.equal(item.status, 'backlog');
    let context = await adminContext(pool);
    assert.ok(context.personal_backlog.items.some(i => i.id === item.id && i.notes === 'CA exam'));
    assert.equal((await api.call('PATCH', `/backlog/${item.id}`, API_TOKEN, { title: item.title, notes: item.notes, status: 'done', priority: 'high' })).status, 200);
    context = await adminContext(pool);
    assert.ok(!context.personal_backlog.items.some(i => i.id === item.id));
    assert.equal((await api.call('GET', '/backlog', API_TOKEN)).body.items.find((i: any) => i.id === item.id).status, 'done');
    assert.equal((await api.call('PATCH', '/backlog/99999', API_TOKEN, { title: 'Missing' })).status, 404);
  });
  test('items keep steps, take partial changes and can be moved to the top or bottom of their status', async () => {
    const add = async (title: string, extra = {}) => (await api.call('POST', '/backlog', API_TOKEN, { title, status: 'next', ...extra })).body.item;
    const a = await add('Order A', { steps: [{ t: 'First', done: false }] });
    const b = await add('Order B');
    assert.deepEqual(a.steps, [{ t: 'First', done: false }]);
    const nextIds = async () => (await api.call('GET', '/backlog', API_TOKEN)).body.items.filter((i: any) => i.status === 'next').map((i: any) => i.id);
    assert.deepEqual((await nextIds()).slice(-2), [a.id, b.id]);
    let r = await api.call('PATCH', `/backlog/${b.id}`, API_TOKEN, { place: 'top' });
    assert.equal(r.status, 200);
    assert.equal(r.body.item.title, 'Order B');
    assert.equal((await nextIds())[0], b.id);
    r = await api.call('PATCH', `/backlog/${a.id}`, API_TOKEN, { steps: [{ t: 'First', done: true }, { t: 'Second', done: false }] });
    assert.equal(r.body.item.notes, '');
    assert.equal(r.body.item.status, 'next');
    const context = await adminContext(pool);
    const seen = context.personal_backlog.items.find((i: any) => i.id === a.id);
    assert.equal(seen.next_step, 'Second');
    assert.equal(seen.steps_done, 1);
    assert.equal((await api.call('PATCH', `/backlog/${a.id}`, API_TOKEN, { steps: [{ t: '', done: false }] })).status, 400);
    assert.equal((await api.call('PATCH', `/backlog/${a.id}`, API_TOKEN, { place: 'middle' })).status, 400);
    assert.equal((await api.call('PATCH', `/backlog/${a.id}`, API_TOKEN, { steps: Array.from({ length: 51 }, () => ({ t: 'x', done: false })) })).status, 400);
  });
  test('both daily schedules run at the Brisbane times, once per slot', async () => {
    await tick(pool, new Date('2026-11-16T18:00:00Z'));
    let queued = await tick(pool, new Date('2026-11-16T21:00:00Z'));
    assert.equal(queued.length, 1);
    assert.equal((await pool.query('SELECT kind FROM runs WHERE id=$1', queued)).rows[0].kind, 'morning_brief');
    queued = await tick(pool, new Date('2026-11-17T06:30:00Z'));
    assert.equal(queued.length, 1);
    assert.equal((await pool.query('SELECT kind FROM runs WHERE id=$1', queued)).rows[0].kind, 'afternoon_brief');
    assert.deepEqual(await tick(pool, new Date('2026-11-17T06:30:00Z')), []);
  });
  test('settings reject bad times and apply future runs atomically without queuing', async () => {
    const input = { morning: '06:45', afternoon: '16:30', morning_enabled: true, afternoon_enabled: false };
    for (const bad of [{...input, morning:'25:00'}, {...input, afternoon:'06:30'}, {...input, morning_enabled:'true'}]) {
      assert.equal((await api.call('PUT', '/settings', API_TOKEN, bad)).status, 400);
    }
    const beforeCount = (await pool.query('SELECT count(*) FROM runs')).rows[0].count;
    const saved = await api.call('PUT', '/settings', API_TOKEN, input);
    assert.equal(saved.status, 200);
    const settings = (await api.call('GET', '/settings', API_TOKEN)).body;
    assert.equal(settings.timezone, 'Australia/Brisbane');
    const morning = settings.schedules.find((s: any) => s.kind === 'morning_brief');
    const afternoon = settings.schedules.find((s: any) => s.kind === 'afternoon_brief');
    assert.equal(morning.cron, '45 6 * * *');
    assert.ok(Date.parse(morning.next_run_at) > Date.now());
    assert.equal(afternoon.enabled, false);
    assert.equal(afternoon.next_run_at, null);
    assert.equal((await pool.query('SELECT count(*) FROM runs')).rows[0].count, beforeCount);
    assert.equal((await pool.query("SELECT enabled FROM schedules WHERE kind='weekly_lookahead'")).rows[0].enabled, false);
  });
});

test('afternoon brief has its own preparation instructions and personal backlog context', () => {
  const prompt = buildPrompt({ run: { id: 1, kind: 'afternoon_brief' } } as any, new Date('2026-11-17T06:30:00Z'), {google:true});
  assert.match(prompt, /afternoon brief/);
  assert.match(prompt, /preparation for tomorrow/);
  assert.match(prompt, /personal_backlog/);
  assert.match(prompt, /get_events/);
});

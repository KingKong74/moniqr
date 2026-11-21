import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from '../src/db.js';
import { claimNextRun, finishRun, queueRun } from '../src/runs.js';
import { API_TOKEN, freshDatabase, skipReason, startApp } from './helpers.js';

describe('workforce', { skip: skipReason }, () => {
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

  const researcher = {
    slug: 'researcher', name: 'Research Analyst', description: 'Looks things up in email and the calendar',
    instructions_md: '# Research Analyst\n\nAnswer the question asked.', tools: ['search_email', 'read_email', 'search_email'],
  };

  /** Claim an EA run of `kind` and return its token, leaving it running. */
  const eaRun = async (kind = 'test') => {
    await queueRun(pool, { agentSlug: 'ea', trigger: 'manual', kind, input: kind === 'chat' ? { messages: [{ role: 'user', text: 'hi' }] } : undefined });
    const claimed = await claimNextRun(pool, 60_000);
    assert.equal(claimed?.agent.slug, 'ea');
    return claimed;
  };
  const cleanup = (id: number) => finishRun(pool, id, { status: 'failed', error: 'test cleanup' });

  test('Bailey creates, lists and edits a worker from the hub', async () => {
    const created = await api.call('POST', '/workforce/agents', API_TOKEN, researcher);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.agent.role, 'worker');
    assert.deepEqual(created.body.agent.tools, ['read_email', 'search_email'], 'tools are deduplicated and sorted');

    const list = await api.call('GET', '/workforce', API_TOKEN);
    assert.deepEqual(list.body.agents.map((a: { slug: string }) => a.slug), ['researcher'], 'the EA is not in the workforce list');
    assert.ok(list.body.tools.get_events, 'the hub gets the tool catalogue');

    const edited = await api.call('PATCH', '/workforce/agents/researcher', API_TOKEN, { description: 'Digs into questions', tools: ['get_daily_admin'] });
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.body.agent.tools, ['get_daily_admin']);
    assert.equal((await api.call('POST', '/workforce/agents', API_TOKEN, researcher)).status, 409, 'slugs are unique');
  });

  test('the hub cannot create an agent with an outward tool, the EA slug or no instructions, or edit the EA', async () => {
    for (const bad of [
      { ...researcher, slug: 'sender', tools: ['send_email'] },
      { ...researcher, slug: 'ea' },
      { ...researcher, slug: 'empty', instructions_md: '  ' },
      { ...researcher, slug: 'Bad Slug' },
      { ...researcher, slug: 'extra', role: 'ea' },
    ]) assert.equal((await api.call('POST', '/workforce/agents', API_TOKEN, bad)).status, 400, JSON.stringify(bad));
    assert.equal((await api.call('PATCH', '/workforce/agents/ea', API_TOKEN, { name: 'x' })).status, 404);
    assert.equal((await api.call('GET', '/workforce', 'wrong-token')).status, 401);
  });

  test('Bailey hands a task to a worker; a paused worker takes none', async () => {
    const queued = await api.call('POST', '/workforce/agents/researcher/tasks', API_TOKEN, { task: 'Find the next council rates notice' });
    assert.equal(queued.status, 202);
    const claimed = await claimNextRun(pool, 60_000);
    assert.equal(claimed?.agent.slug, 'researcher');
    assert.equal(claimed.run.kind, 'task');
    assert.equal(claimed.run.trigger, 'manual');
    assert.deepEqual(claimed.run.input, { task: 'Find the next council rates notice', from: 'bailey' });
    assert.ok(claimed.agent.instructions_md?.includes('Research Analyst'));

    await api.call('PATCH', '/workforce/agents/researcher', API_TOKEN, { enabled: false });
    assert.equal((await api.call('POST', '/workforce/agents/researcher/tasks', API_TOKEN, { task: 'x' })).status, 409);
    await api.call('PATCH', '/workforce/agents/researcher', API_TOKEN, { enabled: true });

    // The worker files one report; that and nothing else completes the task.
    const token = claimed.runToken;
    const report = await api.call('POST', `/runs/${claimed.run.id}/report`, token, { body_md: '# Rates\n\nDue 30 Nov.', summary: 'Rates due 30 Nov.' });
    assert.equal(report.status, 201, JSON.stringify(report.body));
    assert.equal((await api.call('POST', `/runs/${claimed.run.id}/report`, token, { body_md: 'again', summary: 'again' })).status, 409);
    assert.equal((await finishRun(pool, claimed.run.id, { status: 'done' })).status, 'done');

    const detail = await api.call('GET', '/workforce/agents/researcher', API_TOKEN);
    assert.equal(detail.body.reports[0].summary, 'Rates due 30 Nov.');
    assert.equal(detail.body.runs[0].task, 'Find the next council rates notice');
  });

  test("a worker's token reaches its report and ticked reads only, never the EA's writes or roster", async () => {
    await api.call('POST', '/workforce/agents/researcher/tasks', API_TOKEN, { task: 'Anything' });
    const claimed = (await claimNextRun(pool, 60_000))!;
    const token = claimed.runToken;
    for (const [path, body] of [['brief', { body_md: 'x', summary: 'x' }], ['findings', {}], ['actions', {}], ['email-scan', {}],
      ['tasks', { agent: 'researcher', task: 'loop' }], ['agent-changes', { kind: 'pause', slug: 'researcher', reason: 'x' }]] as const) {
      assert.equal((await api.call('POST', `/runs/${claimed.run.id}/${path}`, token, body)).status, 401, path);
    }
    for (const path of ['actions', 'agents', 'agent-reports']) {
      assert.equal((await api.call('GET', `/runs/${claimed.run.id}/${path}`, token)).status, 401, path);
    }
    assert.equal((await api.call('GET', `/runs/${claimed.run.id}/admin-context`, token)).status, 200, 'get_daily_admin is ticked');
    await api.call('PATCH', '/workforce/agents/researcher', API_TOKEN, { tools: [] });
    assert.equal((await api.call('GET', `/runs/${claimed.run.id}/admin-context`, token)).status, 401, 'unticking takes effect at once');
    const run = await finishRun(pool, claimed.run.id, { status: 'done', result: { result: 'I forgot to report' } });
    assert.equal(run.status, 'failed');
    assert.equal(run.error, 'Task ended without filing a report');
  });

  test('the EA hands out at most three tasks per run, reads the roster and reports, and the console can only read', async () => {
    const claimed = (await eaRun())!;
    const token = claimed.runToken;
    for (let i = 1; i <= 3; i++) {
      assert.equal((await api.call('POST', `/runs/${claimed.run.id}/tasks`, token, { agent: 'researcher', task: `Task ${i}` })).status, 202);
    }
    assert.equal((await api.call('POST', `/runs/${claimed.run.id}/tasks`, token, { agent: 'researcher', task: 'Task 4' })).status, 409);
    assert.equal((await api.call('POST', `/runs/${claimed.run.id}/tasks`, token, { agent: 'ea', task: 'Recurse' })).status, 404, 'the EA cannot task itself');
    const roster = await api.call('GET', `/runs/${claimed.run.id}/agents`, token);
    assert.equal(roster.body.agents[0].active_tasks, 3);
    assert.equal(roster.body.agents[0].instructions_md, undefined, 'the EA sees descriptions, not instructions');
    const reports = await api.call('GET', `/runs/${claimed.run.id}/agent-reports`, token);
    assert.equal(reports.body.reports[0].summary, 'Rates due 30 Nov.');
    assert.equal(reports.body.failed_tasks[0].error, 'Task ended without filing a report');
    await cleanup(claimed.run.id);

    const delegated = (await claimNextRun(pool, 60_000))!;
    assert.equal(delegated.run.trigger, 'delegated');
    assert.deepEqual(delegated.run.input, { task: 'Task 1', from: 'ea' });
    await cleanup(delegated.run.id);
    for (let i = 0; i < 2; i++) await cleanup((await claimNextRun(pool, 60_000))!.run.id);

    const chat = (await eaRun('chat'))!;
    assert.equal((await api.call('GET', `/runs/${chat.run.id}/agents`, chat.runToken)).status, 200);
    assert.equal((await api.call('POST', `/runs/${chat.run.id}/tasks`, chat.runToken, { agent: 'researcher', task: 'x' })).status, 401);
    assert.equal((await api.call('POST', `/runs/${chat.run.id}/agent-changes`, chat.runToken, { kind: 'pause', slug: 'researcher', reason: 'x' })).status, 401);
    await cleanup(chat.run.id);
  });

  test('changes the EA asks for wait for Bailey, and only approval applies them', async () => {
    const claimed = (await eaRun())!;
    const ask = (body: unknown) => api.call('POST', `/runs/${claimed.run.id}/agent-changes`, claimed.runToken, body);
    const create = await ask({ kind: 'create', reason: 'Bills keep arriving', agent: {
      slug: 'bills', name: 'Bills Clerk', description: 'Tracks bills', instructions_md: 'Find bills.', tools: ['search_email', 'read_email'] } });
    assert.equal(create.status, 201, JSON.stringify(create.body));
    assert.equal((await ask({ kind: 'create', reason: 'x', agent: { slug: 'payer', name: 'Payer', instructions_md: 'Pay.', tools: ['pay_bill'] } })).status, 400,
      'the EA cannot ask for an outward tool');
    const update = await ask({ kind: 'update', slug: 'researcher', reason: 'Needs the calendar', fields: { tools: ['get_events'] } });
    assert.equal(update.status, 201);
    assert.equal((await ask({ kind: 'update', slug: 'researcher', reason: 'again', fields: { name: 'x' } })).status, 409, 'one pending change per agent and kind');
    const pause = await ask({ kind: 'pause', slug: 'researcher', reason: 'Idle' });
    assert.equal(pause.status, 201);
    assert.equal((await ask({ kind: 'resume', slug: 'researcher', reason: 'x' })).status, 409, 'at most three per run, and it is not paused anyway');
    await cleanup(claimed.run.id);

    // Nothing has changed yet.
    let list = await api.call('GET', '/workforce', API_TOKEN);
    assert.deepEqual(list.body.agents.map((a: { slug: string }) => a.slug), ['researcher']);
    assert.equal(list.body.changes.length, 3);
    assert.equal(list.body.agents[0].enabled, true);

    const decide = (id: number, decision: string) => api.call('POST', `/workforce/changes/${id}/decision`, API_TOKEN, { decision });
    const approved = await decide(create.body.change.id, 'approved');
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.agent.slug, 'bills');
    assert.equal((await decide(create.body.change.id, 'approved')).status, 409, 'a change is decided once');
    assert.equal((await decide(update.body.change.id, 'rejected')).status, 200);
    assert.equal((await decide(pause.body.change.id, 'approved')).status, 200);

    list = await api.call('GET', '/workforce', API_TOKEN);
    const bySlug = Object.fromEntries(list.body.agents.map((a: { slug: string }) => [a.slug, a]));
    assert.deepEqual(bySlug.bills.tools, ['read_email', 'search_email']);
    assert.equal(bySlug.researcher.enabled, false, 'the approved pause applied');
    assert.deepEqual(bySlug.researcher.tools, [], 'the rejected update did not');
    assert.equal(list.body.changes.length, 0);
    const history = await api.call('GET', '/workforce/changes', API_TOKEN);
    assert.deepEqual(history.body.changes.map((c: { status: string }) => c.status).sort(), ['approved', 'approved', 'rejected']);
  });
});

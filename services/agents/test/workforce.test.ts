import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from '../src/db.js';
import { claimNextRun, finishRun, queueRun } from '../src/runs.js';
import { tick } from '../src/scheduler.js';
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

  test('standing tasks: Bailey schedules a worker, the scheduler hands it the task, and a busy slot is skipped', async () => {
    await api.call('PATCH', '/workforce/agents/researcher', API_TOKEN, { enabled: true });
    const bad = async (body: unknown) => (await api.call('POST', '/workforce/agents/researcher/schedules', API_TOKEN, body)).status;
    assert.equal(await bad({ cron: '* * * * *', task: 'Spam' }), 400, 'more often than hourly is refused');
    assert.equal(await bad({ cron: '*/30 9 * * *', task: 'Spam' }), 400, 'half-hourly bursts are refused');
    assert.equal(await bad({ cron: '0 7 * *', task: 'x' }), 400);
    assert.equal(await bad({ cron: 'nonsense here a b c', task: 'x' }), 400);
    assert.equal(await bad({ cron: '0 7 * * *', task: '' }), 400);
    assert.equal((await api.call('POST', '/workforce/agents/ea/schedules', API_TOKEN, { cron: '0 7 * * *', task: 'x' })).status, 404, 'not the EA');

    const created = await api.call('POST', '/workforce/agents/researcher/schedules', API_TOKEN, { cron: '0 7 * * 1-5', task: 'Check for new bills' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.schedule.id;
    assert.ok(created.body.schedule.next_run_at, 'an enabled schedule is timed from now');
    let detail = await api.call('GET', '/workforce/agents/researcher', API_TOKEN);
    assert.equal(detail.body.schedules[0].task, 'Check for new bills');
    assert.equal((await api.call('GET', '/workforce', API_TOKEN)).body.agents.find((a: any) => a.slug === 'researcher').schedules, 1);

    // Make it due and tick: one task run, carrying the schedule's text.
    await pool.query(`UPDATE schedules SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    const [runId] = await tick(pool);
    const run = (await pool.query('SELECT trigger, kind, input, schedule_id FROM runs WHERE id = $1', [runId])).rows[0];
    assert.deepEqual(run, { trigger: 'schedule', kind: 'task', input: { task: 'Check for new bills', from: 'schedule' }, schedule_id: id });
    // Due again while that run is still queued: skipped, but moved on.
    await pool.query(`UPDATE schedules SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    assert.deepEqual(await tick(pool), []);
    assert.ok((await pool.query('SELECT next_run_at > now() AS later FROM schedules WHERE id = $1', [id])).rows[0].later);

    // The first run reports; the next scheduled run sees that report.
    const first = (await claimNextRun(pool, 60_000))!;
    assert.equal(first.run.id, runId);
    assert.equal(first.previousReport, undefined);
    await api.call('POST', `/runs/${first.run.id}/report`, first.runToken, { body_md: 'Two bills: water and power.', summary: 'Two bills.' });
    await finishRun(pool, first.run.id, { status: 'done' });
    await pool.query(`UPDATE schedules SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    await tick(pool);
    const second = (await claimNextRun(pool, 60_000))!;
    assert.equal(second.previousReport?.body_md, 'Two bills: water and power.');
    await cleanup(second.run.id);

    // A paused agent's schedules don't fire; switching a schedule off clears its next time.
    await api.call('PATCH', '/workforce/agents/researcher', API_TOKEN, { enabled: false });
    await pool.query(`UPDATE schedules SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    assert.deepEqual(await tick(pool), []);
    await api.call('PATCH', '/workforce/agents/researcher', API_TOKEN, { enabled: true });
    const off = await api.call('PATCH', `/workforce/schedules/${id}`, API_TOKEN, { enabled: false });
    assert.equal(off.body.schedule.next_run_at, null);
    const on = await api.call('PATCH', `/workforce/schedules/${id}`, API_TOKEN, { enabled: true, cron: '30 18 * * 0' });
    assert.ok(Date.parse(on.body.schedule.next_run_at) > Date.now(), 'switching back on never fires straight away');

    // Removing it keeps the runs it made. EA schedules can't be touched through these routes.
    assert.equal((await api.call('DELETE', `/workforce/schedules/${id}`, API_TOKEN)).status, 200);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM runs WHERE id IN ($1, $2)', [first.run.id, second.run.id])).rows[0].n, 2);
    const eaSchedule = (await pool.query(`SELECT s.id FROM schedules s JOIN agents a ON a.id = s.agent_id WHERE a.slug = 'ea' LIMIT 1`)).rows[0].id;
    assert.equal((await api.call('DELETE', `/workforce/schedules/${eaSchedule}`, API_TOKEN)).status, 404);
    assert.equal((await api.call('PATCH', `/workforce/schedules/${eaSchedule}`, API_TOKEN, { enabled: false })).status, 404);
  });

  test('the EA can ask for a schedule, and only approval adds it', async () => {
    const claimed = (await eaRun())!;
    const ask = (body: unknown) => api.call('POST', `/runs/${claimed.run.id}/agent-changes`, claimed.runToken, body);
    assert.equal((await ask({ kind: 'schedule', slug: 'researcher', reason: 'x', schedule: { cron: '* * * * *', task: 'x' } })).status, 400);
    const asked = await ask({ kind: 'schedule', slug: 'researcher', reason: 'Bills arrive weekly', schedule: { cron: '0 8 * * 1', task: 'List bills due this week' } });
    assert.equal(asked.status, 201, JSON.stringify(asked.body));
    const roster = await api.call('GET', `/runs/${claimed.run.id}/agents`, claimed.runToken);
    assert.equal(roster.body.pending_changes[0].schedule.task, 'List bills due this week');
    await cleanup(claimed.run.id);
    let detail = await api.call('GET', '/workforce/agents/researcher', API_TOKEN);
    assert.equal(detail.body.schedules.length, 0, 'nothing until Bailey approves');
    assert.equal((await api.call('POST', `/workforce/changes/${asked.body.change.id}/decision`, API_TOKEN, { decision: 'approved' })).status, 200);
    detail = await api.call('GET', '/workforce/agents/researcher', API_TOKEN);
    assert.deepEqual(detail.body.schedules.map((s: any) => [s.cron, s.task, s.enabled]), [['0 8 * * 1', 'List bills due this week', true]]);
  });

  test('a worker granted save_email_finding saves findings to the Inbox, credited to it, and nothing else of the EA\'s', async () => {
    const needsRead = await api.call('POST', '/workforce/agents', API_TOKEN, { ...researcher, slug: 'clerk', name: 'Bills Clerk', tools: ['search_email', 'save_email_finding'] });
    assert.equal(needsRead.status, 400, 'saving findings needs Email read');
    assert.match(JSON.stringify(needsRead.body), /Save email findings needs Email read/);
    const created = await api.call('POST', '/workforce/agents', API_TOKEN, { ...researcher, slug: 'clerk', name: 'Bills Clerk', tools: ['read_email', 'save_email_finding', 'search_email'] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal((await api.call('PATCH', '/workforce/agents/clerk', API_TOKEN, { tools: ['save_email_finding'] })).status, 400);

    await api.call('POST', '/workforce/agents/clerk/tasks', API_TOKEN, { task: 'Find bills' });
    const claimed = (await claimNextRun(pool, 60_000))!;
    assert.equal(claimed.agent.slug, 'clerk');
    const finding = {
      message_id: 'msg-clerk-1', thread_id: 'thr-1', category: 'bill', sender: 'Urban Utilities <bills@example.com>', subject: 'Your water bill',
      received_at: '2026-11-20T09:00:00+10:00', summary: 'Water bill $351.49 due 5 Dec', evidence: 'Amount due $351.49', deadline_text: 'Due 5 December 2026',
    };
    const saved = await api.call('POST', `/runs/${claimed.run.id}/findings`, claimed.runToken, finding);
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    for (const [path, body] of [['brief', { body_md: 'x', summary: 'x' }], ['actions', {}], ['email-scan', { status: 'completed', searches: 1, messages_read: 1, failures: 0 }]] as const) {
      assert.equal((await api.call('POST', `/runs/${claimed.run.id}/${path}`, claimed.runToken, body)).status, 401, path);
    }
    const inbox = await api.call('GET', '/findings', API_TOKEN);
    const row = inbox.body.items.find((f: { message_id: string }) => f.message_id === 'msg-clerk-1');
    assert.equal(row.found_by, 'Bills Clerk');
    assert.equal(row.status, 'new', 'it waits for Bailey like any finding');

    // Ungranting takes effect at once, mid-run.
    await api.call('PATCH', '/workforce/agents/clerk', API_TOKEN, { tools: ['read_email', 'search_email'] });
    assert.equal((await api.call('POST', `/runs/${claimed.run.id}/findings`, claimed.runToken, { ...finding, message_id: 'msg-clerk-2' })).status, 401);
    await cleanup(claimed.run.id);
  });

  test('proposals: a granted worker drafts replies and suggests purchases that wait for Bailey and never execute', async () => {
    assert.equal((await api.call('POST', '/workforce/agents', API_TOKEN, { ...researcher, slug: 'helper2', name: 'Helper', tools: ['read_email', 'draft_email_reply'] })).status, 400,
      'drafting needs saving findings');
    const created = await api.call('POST', '/workforce/agents', API_TOKEN, { ...researcher, slug: 'concierge', name: 'Concierge',
      tools: ['draft_email_reply', 'propose_purchase', 'read_email', 'save_email_finding'] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await api.call('POST', '/workforce/agents/concierge/tasks', API_TOKEN, { task: 'Handle the plumber email' });
    const claimed = (await claimNextRun(pool, 60_000))!;
    const call = (path: string, body: unknown) => api.call('POST', `/runs/${claimed.run.id}/${path}`, claimed.runToken, body);
    const finding = await call('findings', {
      message_id: 'msg-plumber', thread_id: 'thr-plumber', category: 'reply', sender: '"Joe Plumbing" <joe@example.com>', subject: 'Can we come Tuesday?',
      received_at: '2026-11-20T09:00:00+10:00', summary: 'Plumber asks to come Tuesday 9am', evidence: 'Can we come Tuesday at 9am?',
    });
    assert.equal(finding.status, 201);
    const fid = finding.body.finding.id;

    const draft = await call('proposals', { kind: 'email_reply', finding_id: fid, body: 'Tuesday 9am works. Thanks, Bailey', note: 'Check you are home Tuesday.',
      to: 'attacker@evil.example' });
    assert.equal(draft.status, 400, 'the agent cannot choose the recipient');
    const ok = await call('proposals', { kind: 'email_reply', finding_id: fid, body: 'Tuesday 9am works. Thanks, Bailey', note: 'Check you are home Tuesday.' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const reply = ok.body.action;
    assert.equal(reply.kind, 'email_reply');
    assert.equal(reply.title, 'Reply to Joe Plumbing');
    assert.deepEqual(reply.proposed_action, { to: '"Joe Plumbing" <joe@example.com>', subject: 'Re: Can we come Tuesday?', body: 'Tuesday 9am works. Thanks, Bailey', note: 'Check you are home Tuesday.' });
    assert.equal(reply.execution_mode, 'record_only');
    assert.equal(reply.can_approve, true);
    // A second draft revises the pending one rather than adding another.
    const revised = await call('proposals', { kind: 'email_reply', finding_id: fid, body: 'Tuesday 9am is fine.' });
    assert.equal(revised.body.action.id, reply.id);
    assert.equal(revised.body.action.revision, 2);

    for (const bad of [
      { kind: 'purchase', item: 'Filter', merchant: 'Bunnings', url: 'http://bunnings.com.au/x', price: 20, reason: 'x' },
      { kind: 'purchase', item: 'Filter', merchant: 'Bunnings', url: 'https://user:pw@bunnings.com.au/x', price: 20, reason: 'x' },
      { kind: 'purchase', item: 'TV', merchant: 'JB', url: 'https://jbhifi.com.au/tv', price: 9000, reason: 'x' },
    ]) assert.equal((await call('proposals', bad)).status, 400, JSON.stringify(bad));
    const buy = await call('proposals', { kind: 'purchase', item: 'Tap washer kit', merchant: 'Bunnings', url: 'https://www.bunnings.com.au/tap-washers', price: 12.5, quantity: 2, reason: 'The plumber said to have spares.' });
    assert.equal(buy.status, 201, JSON.stringify(buy.body));
    assert.equal(buy.body.action.title, 'Buy 2 × Tap washer kit');
    assert.equal(buy.body.action.proposed_action.domain, 'bunnings.com.au');
    assert.equal(buy.body.action.proposed_action.total, 25);
    assert.equal(buy.body.action.can_approve, true, 'a purchase needs no finding');
    assert.equal((await call('proposals', { kind: 'purchase', item: 'Tap washer kit', merchant: 'Bunnings', url: 'https://www.bunnings.com.au/tap-washers', price: 12.5, quantity: 2, reason: 'again' })).body.action.id,
      buy.body.action.id, 'the same pending item is not suggested twice');
    for (const i of [1, 2]) assert.equal((await call('proposals', { kind: 'purchase', item: `Thing ${i}`, merchant: 'Shop', url: `https://shop.example/${i}`, price: 5, reason: 'x' })).status, 201);
    assert.equal((await call('proposals', { kind: 'purchase', item: 'Thing 4', merchant: 'Shop', url: 'https://shop.example/4', price: 5, reason: 'x' })).status, 409, 'three per run');

    const list = await api.call('GET', '/actions', API_TOKEN);
    const mine = list.body.items.filter((a: any) => a.proposed_by === 'Concierge');
    assert.equal(mine.length, 4);
    // Approving records the decision only; nothing can execute it.
    const decided = await api.call('POST', `/actions/${buy.body.action.id}/decision`, API_TOKEN, { decision: 'approved', revision: 1 });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.action.execution_status, 'not_requested');
    assert.equal(decided.body.action.can_execute, false);
    assert.equal((await api.call('POST', `/actions/${buy.body.action.id}/execute`, API_TOKEN, { revision: 1 })).status >= 400, true);

    // Without the grant, the same token is refused.
    await api.call('PATCH', '/workforce/agents/concierge', API_TOKEN, { tools: ['read_email', 'save_email_finding'] });
    assert.equal((await call('proposals', { kind: 'purchase', item: 'More', merchant: 'Shop', url: 'https://shop.example/5', price: 5, reason: 'x' })).status, 401);
    assert.equal((await call('proposals', { kind: 'email_reply', finding_id: fid, body: 'x' })).status, 401);
    await cleanup(claimed.run.id);
  });

  test('the console cannot draft or suggest, and the EA can', async () => {
    const chat = (await eaRun('chat'))!;
    assert.equal((await api.call('POST', `/runs/${chat.run.id}/proposals`, chat.runToken,
      { kind: 'purchase', item: 'x', merchant: 'x', url: 'https://x.example/', price: 1, reason: 'x' })).status, 401);
    await cleanup(chat.run.id);
    const ea = (await eaRun())!;
    const r = await api.call('POST', `/runs/${ea.run.id}/proposals`, ea.runToken, { kind: 'purchase', item: 'Printer ink', merchant: 'Officeworks', url: 'https://www.officeworks.com.au/ink', price: 39, reason: 'Low ink warning email' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.action.origin, 'ea');
    await cleanup(ea.run.id);
  });
});

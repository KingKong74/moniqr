import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Pool } from '../src/db.js';
import { claimNextRun, finishRun, queueRun } from '../src/runs.js';
import { createAgent, queueTask } from '../src/workforce.js';
import { allowedTools, buildPrompt, chatMessages, codexArgs, codexConfig, executeRun, parseCodexResult, initialiseCodexAuth } from '../src/runner/run.js';
import { freshDatabase, skipReason, startApp } from './helpers.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const testHome = await mkdtemp(path.join(tmpdir(), 'moniqr-codex-test-'));
const catalogPath = path.join(testHome, 'models.json');
await writeFile(catalogPath, JSON.stringify({ models: [{ shell_type: 'disabled', apply_patch_tool_type: null, experimental_supported_tools: [], tool_mode: 'direct', supports_search_tool: false }] }));
after(() => rm(testHome, { recursive: true, force: true }));

test('Codex has no native execution, file edits, web, apps or ambient project instructions', () => {
  const config = codexConfig({ command: 'node', args: ['server.js'], env: { RUN_TOKEN: 'secret' } }, { google: false }, catalogPath);
  for (const setting of ['shell_tool = false', 'view_image = false', 'web_search = "disabled"',
    'sandbox_mode = "read-only"', 'approval_policy = "never"', 'project_doc_max_bytes = 0', 'apps = false', 'plugins = false']) assert.ok(config.includes(setting), setting);
  assert.ok(config.includes('enabled_tools = ["write_brief","get_daily_admin","list_action_proposals","list_agents","get_agent_reports","delegate_task","propose_agent_change"]'));
  const args = codexArgs('hello');
  assert.ok(args.includes('--ephemeral'));
  assert.ok(!args.some((a) => a.includes('bypass')));
  assert.ok(!args.join(' ').includes('secret'));
});

test('Google allowlist contains reads and local brief/finding writes only', () => {
  assert.deepEqual(allowedTools({ google: false }), ['mcp__agents__write_brief', 'mcp__agents__get_daily_admin', 'mcp__agents__list_action_proposals', 'mcp__agents__list_agents', 'mcp__agents__get_agent_reports', 'mcp__agents__delegate_task', 'mcp__agents__propose_agent_change']);
  assert.deepEqual(allowedTools({ google: true }), ['mcp__agents__write_brief', 'mcp__agents__get_daily_admin', 'mcp__agents__list_action_proposals', 'mcp__agents__list_agents', 'mcp__agents__get_agent_reports', 'mcp__agents__delegate_task', 'mcp__agents__propose_agent_change', 'mcp__agents__list_calendars',
    'mcp__agents__get_events', 'mcp__agents__search_email', 'mcp__agents__read_email', 'mcp__agents__save_email_finding', 'mcp__agents__propose_action',
    'mcp__agents__draft_email_reply', 'mcp__agents__propose_purchase']);
});

test('the console allowlist is read-only', () => {
  assert.deepEqual(allowedTools({ google: false }, 'chat'), ['mcp__agents__get_daily_admin', 'mcp__agents__list_action_proposals', 'mcp__agents__list_agents', 'mcp__agents__get_agent_reports']);
  const google = allowedTools({ google: true }, 'chat');
  assert.deepEqual(google, ['mcp__agents__get_daily_admin', 'mcp__agents__list_action_proposals', 'mcp__agents__list_agents', 'mcp__agents__get_agent_reports', 'mcp__agents__list_calendars',
    'mcp__agents__get_events', 'mcp__agents__search_email', 'mcp__agents__read_email']);
  const config = codexConfig({ command: 'node', args: ['server.js'], env: {} }, { google: true }, catalogPath, 'chat');
  for (const write of ['write_brief', 'save_email_finding', 'propose_action', 'delegate_task', 'propose_agent_change', 'write_report', 'draft_email_reply', 'propose_purchase']) assert.ok(!config.includes(`"${write}"`), write);
  assert.ok(config.includes('shell_tool = false'));
});

test("a worker's allowlist is its report plus the read-only tools ticked for it", () => {
  const worker = { role: 'worker', tools: ['search_email', 'get_daily_admin', 'send_email', 'delegate_task'] };
  assert.deepEqual(allowedTools({ google: true }, 'task', worker), ['mcp__agents__write_report', 'mcp__agents__get_daily_admin', 'mcp__agents__search_email'],
    'anything outside the read-only set is dropped even if it reached the database');
  assert.deepEqual(allowedTools({ google: false }, 'task', worker), ['mcp__agents__write_report', 'mcp__agents__get_daily_admin'], 'Google tools need Google');
  const clerk = { role: 'worker', tools: ['read_email', 'save_email_finding', 'search_email'] };
  assert.deepEqual(allowedTools({ google: true }, 'task', clerk), ['mcp__agents__write_report', 'mcp__agents__read_email', 'mcp__agents__save_email_finding', 'mcp__agents__search_email'],
    'a granted write is offered');
  assert.deepEqual(allowedTools({ google: false }, 'task', clerk), ['mcp__agents__write_report'], 'and needs Google like the reads it works on');
  const shopper = { role: 'worker', tools: ['propose_purchase', 'draft_email_reply', 'save_email_finding', 'read_email'] };
  assert.deepEqual(allowedTools({ google: false }, 'task', shopper), ['mcp__agents__write_report', 'mcp__agents__propose_purchase'],
    'purchase suggestions need no Google; reply drafts do');
  assert.deepEqual(allowedTools({ google: true }, 'chat', worker), allowedTools({ google: true }, 'task', worker), "a worker never gets the EA's kinds");
});

test('chat input keeps only well-formed turns', () => {
  assert.deepEqual(chatMessages(null), []);
  assert.deepEqual(chatMessages({ messages: [{ role: 'user', text: 'hi' }, { role: 'system', text: 'x' }, { role: 'moniqr', text: ' ' }] }), [{ role: 'user', text: 'hi' }]);
});

test('Codex JSONL failures, incomplete output and zero-exit error events fail closed', () => {
  assert.equal(parseCodexResult('{"type":"thread.started"}'), null);
  assert.equal(parseCodexResult('not json'), null);
  assert.equal(parseCodexResult('{"type":"turn.failed","error":{"message":"usage limit"}}')?.result, 'usage limit');
  assert.equal(parseCodexResult('{"type":"error","message":"oops"}\n{"type":"turn.completed"}')?.is_error, true);
  assert.equal(parseCodexResult('{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n{"type":"turn.completed"}')?.result, 'ok');
});

test('Codex setup errors return a failed outcome before a model starts', async () => {
  const outcome = await executeRun({ run: { id: 1, kind: 'test' } } as any, {
    apiUrl: 'http://127.0.0.1:1', codexBin: '/nonexistent', timeoutMs: 100,
    codexHome: testHome, catalogPath: path.join(testHome, 'missing-catalog.json'),
  });
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.error!, /Codex setup failed/);
});

test('Login seeding preserves refreshed credentials', async () => {
  const home = path.join(testHome, 'auth-test');
  await initialiseCodexAuth(home, '{"tokens":{"refresh_token":"initial"}}');
  await writeFile(path.join(home, 'auth.json'), '{"tokens":{"refresh_token":"refreshed"}}');
  await initialiseCodexAuth(home, '{"tokens":{"refresh_token":"initial"}}');
  assert.equal(JSON.parse(await readFile(path.join(home, 'auth.json'), 'utf8')).tokens.refresh_token, 'refreshed');
});

test('Bundled catalog transform removes native execution and editing capabilities', () => {
  const script = fileURLToPath(new URL('../scripts/codex-models.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { input: JSON.stringify({ models: [{ slug: 'unchanged', shell_type: 'unified_exec', apply_patch_tool_type: 'freeform', experimental_supported_tools: ['clock'] }] }), encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout).models[0], { slug: 'unchanged', shell_type: 'disabled', apply_patch_tool_type: null, experimental_supported_tools: [], tool_mode: 'direct', supports_search_tool: false });
});

describe('runner', { skip: skipReason }, () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  let api: Awaited<ReturnType<typeof startApp>>;

  before(async () => {
    ({ pool, drop } = await freshDatabase());
    api = await startApp(pool);
    process.env.RUNNER_TOKEN = 'must-not-leak';
  });
  after(async () => {
    await api.close();
    await drop();
  });

  const claim = async (kind: string) => {
    await queueRun(pool, { agentSlug: 'ea', trigger: 'manual', kind });
    const claimed = await claimNextRun(pool, 60_000);
    assert.ok(claimed);
    return claimed;
  };

  test('a run starts the MCP server, writes one brief through the API and finishes done', async () => {
    const claimed = await claim('test');
    const outcome = await executeRun(claimed, {
      apiUrl: api.baseUrl,
      codexHome: testHome,
      catalogPath,
      codexBin: fixture('fake-codex.mjs'),
      timeoutMs: 30_000,
    });
    assert.equal(outcome.status, 'done', outcome.error);
    const seen = JSON.parse((outcome.result as { result: string }).result);

    assert.deepEqual(seen.tools.sort(), ['delegate_task', 'get_agent_reports', 'get_daily_admin', 'list_action_proposals', 'list_agents', 'propose_agent_change', 'write_brief'],
      'only local brief, approval and workforce tools are exposed without Google');
    assert.equal(seen.proposals.isError, false, 'run-scoped pending proposals are readable without Google');
    assert.equal(seen.admin.isError, false, 'run-scoped daily admin context is readable');
    assert.equal(JSON.parse(seen.admin.text).open_findings.total, 0);
    assert.match(seen.first, /^Brief saved/);
    assert.equal(seen.second.isError, true, 'second brief refused');
    assert.match(seen.second.text, /409/);
    assert.match(seen.cwd, /moniqr-run-/, 'runs in an empty directory; instructions are supplied explicitly');
    assert.ok(!seen.envKeys.includes('CODEX_AUTH_JSON'));
    await assert.rejects(readFile(path.join(testHome, 'config.toml')), /ENOENT/);
    assert.ok(!seen.envKeys.includes('RUNNER_TOKEN'), 'runner token not passed to Codex');
    assert.ok(!seen.envKeys.includes('DATABASE_URL'));

    const run = await finishRun(pool, claimed.run.id, outcome);
    assert.equal(run.status, 'done');
    const brief = (await pool.query('SELECT * FROM briefs WHERE run_id = $1', [claimed.run.id])).rows[0];
    assert.equal(brief.summary, 'Plumbing works.');
    assert.match(brief.body_md, /plumbing test/);
    assert.match(brief.body_md, /### Sources checked\n.*\n- Calendar and email: not connected\n- Findings and decisions: read /, 'moniqr appends what it actually read');
  });

  test('a failed Codex start is reported with its error', async () => {
    const claimed = await claim('morning_brief');
    const outcome = await executeRun(claimed, {
      apiUrl: api.baseUrl,
      codexHome: testHome,
      catalogPath,
      codexBin: fixture('fake-codex-fail.mjs'),
      timeoutMs: 30_000,
    });
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.error!, /Invalid API key/);
    assert.equal((await finishRun(pool, claimed.run.id, outcome)).status, 'failed');
  });

  test('a run that hangs is killed at the timeout', async () => {
    const claimed = await claim('test');
    const started = Date.now();
    const outcome = await executeRun(claimed, {
      apiUrl: api.baseUrl,
      codexHome: testHome,
      catalogPath,
      codexBin: fixture('fake-codex-hang.mjs'),
      timeoutMs: 500,
    });
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.error!, /Timed out/);
    assert.ok(Date.now() - started < 5_000);
    await finishRun(pool, claimed.run.id, outcome);
  });

  test('a missing Codex binary fails cleanly', async () => {
    const claimed = await claim('test');
    const outcome = await executeRun(claimed, {
      apiUrl: api.baseUrl,
      codexHome: testHome,
      catalogPath,
      codexBin: '/nonexistent/codex',
      timeoutMs: 5_000,
    });
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.error!, /Could not start Codex/);
    await finishRun(pool, claimed.run.id, outcome);
  });

  test('with Google connected, the MCP server offers calendar and Gmail tools and Codex never sees the credentials', async () => {
    const claimed = await claim('test');
    const outcome = await executeRun(claimed, {
      apiUrl: api.baseUrl,
      codexHome: testHome,
      catalogPath,
      codexBin: fixture('fake-codex.mjs'),
      timeoutMs: 30_000,
      google: { clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken' },
    });
    assert.equal(outcome.status, 'done', outcome.error);
    const seen = JSON.parse((outcome.result as { result: string }).result);
    assert.deepEqual(seen.tools.sort(), ['delegate_task', 'draft_email_reply', 'get_agent_reports', 'get_daily_admin', 'get_events', 'list_action_proposals', 'list_agents', 'list_calendars',
      'propose_action', 'propose_agent_change', 'propose_purchase', 'read_email', 'save_email_finding', 'search_email', 'write_brief']);
    assert.equal(seen.invented.isError, true, 'the broker refuses an action without a saved finding from this run');
    assert.match(seen.invented.text, /Save this finding in this run/);
    assert.ok(!seen.envKeys.some((k: string) => k.startsWith('GOOGLE_')), 'Google credentials stay with the MCP server');
    assert.equal((await finishRun(pool, claimed.run.id, outcome)).status, 'done');
  });

  test('the morning brief prompt points at today, tomorrow and email when Google is connected', async () => {
    const claimed = await claim('morning_brief');
    const prompt = buildPrompt(claimed, new Date('2026-10-26T20:30:00Z'), { google: true });
    assert.match(prompt, /get_events with from 2026-10-27 and days 2/);
    assert.match(prompt, /search his email/);
    assert.match(prompt, /finance sheet is not connected/);
    assert.doesNotMatch(prompt, /Gmail/);
    assert.match(prompt, /get_daily_admin/);
    assert.match(prompt, /only when confirmed_created is true/);
    assert.match(prompt, /paid or unpaid unless the email says so/);
    assert.match(prompt, /never a manual step to check funds/);
    await finishRun(pool, claimed.run.id, { status: 'failed', error: 'test cleanup' });
  });

  test('morning brief prompts forbid inventing data while no sources are connected', async () => {
    const claimed = await claim('morning_brief');
    const prompt = buildPrompt(claimed, new Date('2026-10-26T20:30:00Z'));
    assert.match(prompt, /Tuesday 27 October 2026/);
    assert.match(prompt, /6:30/);
    assert.match(prompt, /do not invent/);
    await finishRun(pool, claimed.run.id, { status: 'failed', error: 'test cleanup' });
  });

  test('a chat run is read-only, uses the console persona and finishes with its reply, no brief', async () => {
    await queueRun(pool, { agentSlug: 'ea', trigger: 'manual', kind: 'test' });
    await queueRun(pool, { agentSlug: 'ea', trigger: 'manual', kind: 'chat', input: { messages: [{ role: 'user', text: 'What is on today?' }] } });
    const claimed = await claimNextRun(pool, 60_000);
    assert.equal(claimed?.run.kind, 'chat', 'a waiting chat goes ahead of a queued brief');
    assert.deepEqual(claimed.run.input, { messages: [{ role: 'user', text: 'What is on today?' }] });
    const prompt = buildPrompt(claimed, new Date('2026-10-26T20:30:00Z'), { google: true });
    assert.match(prompt, /moniqr console/);
    assert.match(prompt, /Bailey: What is on today\?/);
    assert.doesNotMatch(prompt, /write_brief/);

    const outcome = await executeRun(claimed, {
      apiUrl: api.baseUrl, codexHome: testHome, catalogPath, codexBin: fixture('fake-codex.mjs'), timeoutMs: 30_000,
      google: { clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken' },
    });
    assert.equal(outcome.status, 'done', outcome.error);
    const seen = JSON.parse((outcome.result as { result: string }).result);
    assert.equal(seen.runKind, 'chat');
    assert.deepEqual(seen.tools.sort(), ['get_agent_reports', 'get_daily_admin', 'get_events', 'list_action_proposals', 'list_agents', 'list_calendars', 'read_email', 'search_email'],
      'the MCP server registers no write tools for a chat');
    assert.match(seen.args.at(-1), /# moniqr, in the console/, 'the console persona replaces the brief instructions');
    assert.doesNotMatch(seen.args.at(-1), /Call `write_brief` exactly once/);

    // Even with the run token, the API refuses writes from a chat run.
    const token = claimed.runToken;
    for (const [path, body] of [['brief', { body_md: 'x', summary: 'x' }], ['findings', {}], ['actions', {}], ['email-scan', {}]] as const) {
      assert.equal((await api.call('POST', `/runs/${claimed.run.id}/${path}`, token, body)).status, 401, path);
    }
    assert.equal((await api.call('GET', `/runs/${claimed.run.id}/admin-context`, token)).status, 200, 'reads still work');

    const run = await finishRun(pool, claimed.run.id, outcome);
    assert.equal(run.status, 'done', 'a reply is enough; no brief is needed');
    assert.equal((await pool.query('SELECT 1 FROM briefs WHERE run_id = $1', [claimed.run.id])).rowCount, 0);
    const brief = await claimNextRun(pool, 60_000);
    await finishRun(pool, brief!.run.id, { status: 'failed', error: 'test cleanup' });
  });

  const google = { clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken' };
  const workerTask = async (slug: string, tools: string[]) => {
    await createAgent(pool, { slug, name: `Agent ${slug}`, description: '', instructions_md: `# ${slug} instructions`, tools: tools as any, enabled: true });
    await queueTask(pool, slug, 'Find the rates notice');
    const claimed = await claimNextRun(pool, 60_000);
    assert.equal(claimed?.agent.slug, slug);
    return claimed;
  };

  test("a worker's task runs its own instructions with only its ticked tools and files one report", async () => {
    const claimed = await workerTask('finder', ['search_email', 'read_email']);
    const prompt = buildPrompt(claimed, new Date('2026-10-26T20:30:00Z'), { google: true });
    assert.match(prompt, /<task>\nFind the rates notice\n<\/task>/);
    assert.match(prompt, /Bailey handed you this task/);
    assert.doesNotMatch(prompt, /write_brief/);

    const outcome = await executeRun(claimed, { apiUrl: api.baseUrl, codexHome: testHome, catalogPath, codexBin: fixture('fake-codex-worker.mjs'), timeoutMs: 30_000, google });
    assert.equal(outcome.status, 'done', outcome.error);
    const seen = JSON.parse((outcome.result as { result: string }).result);
    assert.deepEqual(seen.tools.sort(), ['read_email', 'search_email', 'write_report']);
    assert.match(seen.args.at(-1), /^# finder instructions/, "the worker's own instructions, not the EA's");
    assert.doesNotMatch(seen.args.at(-1), /Executive Assistant/);
    assert.match(seen.first, /Report filed/);
    assert.equal(seen.second.isError, true);
    assert.match(seen.second.text, /409/);
    assert.ok(seen.mcpEnvKeys.includes('GOOGLE_REFRESH_TOKEN'), 'a worker with email tools gets Google in its MCP server');
    assert.ok(!seen.envKeys.some((k: string) => k.startsWith('GOOGLE_')), 'and Codex itself never sees it');
    assert.equal((await finishRun(pool, claimed.run.id, outcome)).status, 'done');
    assert.equal((await pool.query('SELECT data FROM reports WHERE run_id = $1', [claimed.run.id])).rows[0].data.summary, 'Found it.');
  });

  test('a worker granted findings is offered save_email_finding and told how to use it, but still no EA tools', async () => {
    const claimed = await workerTask('clerk', ['read_email', 'save_email_finding', 'search_email']);
    assert.match(buildPrompt(claimed, new Date('2026-10-26T20:30:00Z'), { google: true }), /save it with save_email_finding/);
    const outcome = await executeRun(claimed, { apiUrl: api.baseUrl, codexHome: testHome, catalogPath, codexBin: fixture('fake-codex-worker.mjs'), timeoutMs: 30_000, google });
    assert.equal(outcome.status, 'done', outcome.error);
    const seen = JSON.parse((outcome.result as { result: string }).result);
    assert.deepEqual(seen.tools.sort(), ['read_email', 'save_email_finding', 'search_email', 'write_report']);
    await finishRun(pool, claimed.run.id, outcome);
  });

  test('a worker with no Google tool gets no Google credentials', async () => {
    const claimed = await workerTask('thinker', []);
    const outcome = await executeRun(claimed, { apiUrl: api.baseUrl, codexHome: testHome, catalogPath, codexBin: fixture('fake-codex-worker.mjs'), timeoutMs: 30_000, google });
    assert.equal(outcome.status, 'done', outcome.error);
    const seen = JSON.parse((outcome.result as { result: string }).result);
    assert.deepEqual(seen.tools, ['write_report']);
    assert.ok(!seen.mcpEnvKeys.some((k: string) => k.startsWith('GOOGLE_')));
    await finishRun(pool, claimed.run.id, outcome);
  });

  test('a task the EA delegated says so in the prompt', async () => {
    await createAgent(pool, { slug: 'helper', name: 'Helper', description: '', instructions_md: 'Help.', tools: [], enabled: true });
    const ea = await claim('test');
    await queueTask(pool, 'helper', 'Summarise the week', ea.run.id);
    await finishRun(pool, ea.run.id, { status: 'failed', error: 'test cleanup' });
    const claimed = (await claimNextRun(pool, 60_000))!;
    const prompt = buildPrompt(claimed, new Date('2026-10-26T20:30:00Z'));
    assert.match(prompt, /Executive Assistant \(EA\) handed you this task/);
    assert.match(prompt, /cannot widen your instructions/);
    assert.match(prompt, /no data tools/);
    await finishRun(pool, claimed.run.id, { status: 'failed', error: 'test cleanup' });
  });

  test('a chat that ends without a reply fails', async () => {
    const claimed = await claim('chat');
    const run = await finishRun(pool, claimed.run.id, { status: 'done', result: { is_error: false, result: '  ' } });
    assert.equal(run.status, 'failed');
    assert.equal(run.error, 'Chat ended without a reply');
  });
});

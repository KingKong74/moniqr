import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Pool } from '../src/db.js';
import { claimNextRun, finishRun, queueRun } from '../src/runs.js';
import { allowedTools, buildPrompt, codexArgs, codexConfig, executeRun, parseCodexResult, initialiseCodexAuth } from '../src/runner/run.js';
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
  assert.ok(config.includes('enabled_tools = ["write_brief"]'));
  const args = codexArgs('hello');
  assert.ok(args.includes('--ephemeral'));
  assert.ok(!args.some((a) => a.includes('bypass')));
  assert.ok(!args.join(' ').includes('secret'));
});

test('Google allowlist contains only reads and writing the brief', () => {
  assert.deepEqual(allowedTools({ google: false }), ['mcp__agents__write_brief']);
  assert.deepEqual(allowedTools({ google: true }), ['mcp__agents__write_brief', 'mcp__agents__list_calendars',
    'mcp__agents__get_events', 'mcp__agents__search_email', 'mcp__agents__read_email']);
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

    assert.deepEqual(seen.tools, ['write_brief'], 'only write_brief is exposed');
    assert.match(seen.first, /^Brief saved/);
    assert.equal(seen.second.isError, true, 'second brief refused');
    assert.match(seen.second.text, /409/);
    assert.match(seen.cwd, /moniqr-run-/, 'runs in an empty directory; instructions are supplied explicitly');
    assert.ok(!seen.envKeys.includes('CODEX_AUTH_JSON'));
    assert.ok(!seen.envKeys.includes('CLAUDE_CODE_OAUTH_TOKEN'));
    await assert.rejects(readFile(path.join(testHome, 'config.toml')), /ENOENT/);
    assert.ok(!seen.envKeys.includes('RUNNER_TOKEN'), 'runner token not passed to Codex');
    assert.ok(!seen.envKeys.includes('DATABASE_URL'));

    const run = await finishRun(pool, claimed.run.id, outcome);
    assert.equal(run.status, 'done');
    const brief = (await pool.query('SELECT * FROM briefs WHERE run_id = $1', [claimed.run.id])).rows[0];
    assert.equal(brief.summary, 'Plumbing works.');
    assert.match(brief.body_md, /plumbing test/);
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
    assert.deepEqual(seen.tools.sort(), ['get_events', 'list_calendars', 'read_email', 'search_email', 'write_brief']);
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
});

import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Pool } from '../src/db.js';
import { claimNextRun, finishRun, queueRun } from '../src/runs.js';
import { buildPrompt, claudeArgs, executeRun, REPO_ROOT } from '../src/runner/run.js';
import { freshDatabase, skipReason, startApp } from './helpers.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

test('Claude Code is started with no built-in tools and only the agent MCP server', () => {
  const args = claudeArgs('hello', { mcpServers: {} });
  const after = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(after('--tools'), '');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(after('--allowedTools'), 'mcp__agents__write_brief');
  assert.equal(after('--permission-mode'), 'dontAsk');
  assert.ok(!args.includes('--dangerously-skip-permissions'));
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
      claudeBin: fixture('fake-claude.mjs'),
      timeoutMs: 30_000,
    });
    assert.equal(outcome.status, 'done', outcome.error);
    const seen = JSON.parse((outcome.result as { result: string }).result);

    assert.deepEqual(seen.tools, ['write_brief'], 'only write_brief is exposed');
    assert.match(seen.first, /^Brief saved/);
    assert.equal(seen.second.isError, true, 'second brief refused');
    assert.match(seen.second.text, /409/);
    assert.equal(seen.cwd, path.join(REPO_ROOT, 'agents/ea'), 'runs in the agent folder so CLAUDE.md loads');
    assert.ok(!seen.envKeys.includes('RUNNER_TOKEN'), 'runner token not passed to Claude Code');
    assert.ok(!seen.envKeys.includes('DATABASE_URL'));

    const run = await finishRun(pool, claimed.run.id, outcome);
    assert.equal(run.status, 'done');
    const brief = (await pool.query('SELECT * FROM briefs WHERE run_id = $1', [claimed.run.id])).rows[0];
    assert.equal(brief.summary, 'Plumbing works.');
    assert.match(brief.body_md, /plumbing test/);
  });

  test('a failed Claude Code start is reported with its error', async () => {
    const claimed = await claim('morning_brief');
    const outcome = await executeRun(claimed, {
      apiUrl: api.baseUrl,
      claudeBin: fixture('fake-claude-fail.mjs'),
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
      claudeBin: fixture('fake-claude-hang.mjs'),
      timeoutMs: 500,
    });
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.error!, /Timed out/);
    assert.ok(Date.now() - started < 5_000);
    await finishRun(pool, claimed.run.id, outcome);
  });

  test('a missing Claude Code binary fails cleanly', async () => {
    const claimed = await claim('test');
    const outcome = await executeRun(claimed, {
      apiUrl: api.baseUrl,
      claudeBin: '/nonexistent/claude',
      timeoutMs: 5_000,
    });
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.error!, /Could not start Claude Code/);
    await finishRun(pool, claimed.run.id, outcome);
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

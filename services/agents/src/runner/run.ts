import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClaimedRun } from '../runs.js';

/** Repo root, where `agents/<slug>/CLAUDE.md` lives. Overridable for Docker. */
export const REPO_ROOT =
  process.env.AGENTS_REPO_ROOT ?? fileURLToPath(new URL('../../../../', import.meta.url));

/** How to start the MCP server: compiled JS in production, TypeScript via tsx in development. */
export function mcpServerCommand(): { command: string; args: string[] } {
  const self = fileURLToPath(import.meta.url);
  const isTs = self.endsWith('.ts');
  const entry = path.join(path.dirname(self), '..', 'mcp', isTs ? 'server.ts' : 'server.js');
  const args = isTs ? ['--import', import.meta.resolve('tsx'), entry] : [entry];
  return { command: process.execPath, args };
}

const brisbaneNow = (now: Date) =>
  new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(now);

export function buildPrompt(claimed: ClaimedRun, now = new Date()): string {
  const when = `It is ${brisbaneNow(now)} in Brisbane. This is run ${claimed.run.id}.`;
  const noData =
    'No calendar, email or finance tools are connected yet, so do not invent any commitments, bills or figures. ' +
    'Say plainly which sections are waiting on which data source.';
  switch (claimed.run.kind) {
    case 'morning_brief':
      return `${when}\n\nWrite Bailey's morning brief and save it with write_brief. ${noData}`;
    case 'weekly_lookahead':
      return `${when}\n\nWrite Bailey's weekly look-ahead for the coming week and save it with write_brief. ${noData}`;
    case 'test':
      return `${when}\n\nThis is a plumbing test. Call write_brief once with a two-line brief confirming the run works, mentioning the run number and the time.`;
    default:
      return `${when}\n\nRun kind "${claimed.run.kind}". Write a short brief explaining you don't have instructions for this kind of run, and save it with write_brief.`;
  }
}

export interface RunOptions {
  apiUrl: string;
  claudeBin: string;
  model?: string;
  timeoutMs: number;
}

export interface RunOutcome {
  status: 'done' | 'failed';
  error?: string;
  result?: unknown;
}

/** Arguments for a locked-down headless Claude Code session. */
export function claudeArgs(prompt: string, mcpConfig: object, model?: string): string[] {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--no-session-persistence',
    // No built-in tools at all: no shell, no file access, no web.
    '--tools',
    '',
    // Only the agent MCP server, nothing from user or project config.
    '--mcp-config',
    JSON.stringify(mcpConfig),
    '--strict-mcp-config',
    '--allowedTools',
    'mcp__agents__write_brief',
    '--permission-mode',
    'dontAsk',
  ];
  if (model) args.push('--model', model);
  return args;
}

/** Env for Claude Code: only what it needs to authenticate and run. No runner or database secrets. */
function claudeEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'LANG', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'];
  const env: NodeJS.ProcessEnv = { TZ: 'Australia/Brisbane' };
  for (const key of keep) if (process.env[key]) env[key] = process.env[key];
  return env;
}

export async function executeRun(claimed: ClaimedRun, opts: RunOptions): Promise<RunOutcome> {
  const mcp = mcpServerCommand();
  const mcpConfig = {
    mcpServers: {
      agents: {
        type: 'stdio',
        command: mcp.command,
        args: mcp.args,
        env: { AGENTS_API_URL: opts.apiUrl, RUN_ID: String(claimed.run.id), RUN_TOKEN: claimed.runToken },
      },
    },
  };
  const cwd = path.join(REPO_ROOT, path.dirname(claimed.agent.instructions_path));
  const args = claudeArgs(buildPrompt(claimed), mcpConfig, opts.model);

  return new Promise<RunOutcome>((resolve) => {
    const child = spawn(opts.claudeBin, args, { cwd, env: claudeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    }, opts.timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ status: 'failed', error: `Could not start Claude Code: ${err.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ status: 'failed', error: `Timed out after ${Math.round(opts.timeoutMs / 1000)}s` });
        return;
      }
      const parsed = parseResult(stdout);
      if (code !== 0 || parsed?.is_error) {
        const reason = parsed?.result ?? (stderr.trim() || `exit code ${code}`);
        resolve({ status: 'failed', error: String(reason).slice(0, 4000), result: parsed ?? undefined });
        return;
      }
      resolve({ status: 'done', result: parsed ?? undefined });
    });
  });
}

interface ClaudeResult {
  is_error?: boolean;
  result?: string;
  num_turns?: number;
  total_cost_usd?: number;
  duration_ms?: number;
}

function parseResult(stdout: string): ClaudeResult | null {
  try {
    const all = JSON.parse(stdout.trim());
    const { is_error, result, num_turns, total_cost_usd, duration_ms } = all as ClaudeResult;
    return { is_error, result, num_turns, total_cost_usd, duration_ms };
  } catch {
    return null;
  }
}

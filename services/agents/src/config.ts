function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function numberFrom(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

/** Longest a single Claude Code run may take before the runner kills it. */
export const runTimeoutMs = () => numberFrom('RUN_TIMEOUT_MS', 10 * 60_000);

export function serverConfig() {
  return {
    databaseUrl: required('DATABASE_URL'),
    apiToken: required('API_TOKEN'),
    runnerToken: required('RUNNER_TOKEN'),
    port: numberFrom('PORT', 8080),
    schedulerIntervalMs: numberFrom('SCHEDULER_INTERVAL_MS', 30_000),
    // A run is only stale once it is well past the runner's own timeout.
    staleRunMs: runTimeoutMs() + 5 * 60_000,
  };
}

export function runnerConfig() {
  return {
    apiUrl: required('AGENTS_API_URL'),
    runnerToken: required('RUNNER_TOKEN'),
    pollIntervalMs: numberFrom('RUNNER_POLL_MS', 15_000),
    runTimeoutMs: runTimeoutMs(),
    claudeBin: process.env.CLAUDE_BIN ?? 'claude',
    model: process.env.CLAUDE_MODEL,
  };
}

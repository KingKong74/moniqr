import { runnerConfig } from '../config.js';
import type { ClaimedRun } from '../runs.js';
import { executeRun } from './run.js';

const config = runnerConfig();
let stopping = false;

async function api(path: string, body?: unknown): Promise<Response> {
  return fetch(new URL(path, config.apiUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.runnerToken}` },
    body: JSON.stringify(body ?? {}),
  });
}

/** Claims and executes one run. Returns false when the queue is empty. */
async function runOnce(): Promise<boolean> {
  const res = await api('/runner/claim');
  if (res.status === 204) return false;
  if (!res.ok) throw new Error(`Claim failed: ${res.status} ${await res.text()}`);
  const claimed = (await res.json()) as ClaimedRun;
  console.log(`[runner] run ${claimed.run.id} (${claimed.agent.slug}, ${claimed.run.kind}) started`);

  const outcome = await executeRun(claimed, {
    apiUrl: config.apiUrl,
    claudeBin: config.claudeBin,
    model: config.model,
    timeoutMs: config.runTimeoutMs,
  });
  const finish = await api(`/runner/runs/${claimed.run.id}/finish`, outcome);
  const finished = finish.ok ? ((await finish.json()) as { run: { status: string; error: string | null } }).run : null;
  console.log(
    `[runner] run ${claimed.run.id} ${finished?.status ?? `finish call failed (${finish.status})`}` +
      (finished?.error ? `: ${finished.error}` : ''),
  );
  return true;
}

async function loop() {
  while (!stopping) {
    try {
      // Drain the queue one run at a time, then wait.
      while (!stopping && (await runOnce()));
    } catch (err) {
      console.error('[runner]', err);
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

process.on('SIGTERM', () => (stopping = true));
process.on('SIGINT', () => (stopping = true));
console.log(`[runner] polling ${config.apiUrl} every ${config.pollIntervalMs / 1000}s`);
await loop();

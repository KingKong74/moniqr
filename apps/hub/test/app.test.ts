import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { AccessDenied } from '../src/access.js';
import type { AgentsClient, RunKind } from '../src/agents.js';
import { createApp } from '../src/app.js';
import { formatWhen } from '../src/page.js';

const ORIGIN = 'https://moniqr.com';
const queued: RunKind[] = [];
let failAgents = false;

const agents: AgentsClient = {
  latestBrief: async () => {
    if (failAgents) throw new Error('down');
    return { id: 1, kind: 'test', body_md: '## Hello\n\n- <b>first</b>', summary: 'Hi', created_at: '2026-10-26T20:30:00Z' };
  },
  recentRuns: async () => {
    if (failAgents) throw new Error('down');
    return [
      { id: 1, agent: 'ea', trigger: 'manual', kind: 'test', status: 'succeeded', queued_at: '2026-10-26T20:29:00Z', finished_at: null, duration_ms: 1000, error: null },
    ];
  },
  queueRun: async (kind) => {
    queued.push(kind);
  },
};

let base: string;
let close: () => void;

before(async () => {
  const app = createApp({
    agents,
    origin: ORIGIN,
    identify: async (token) => {
      if (token !== 'good') throw new AccessDenied('nope');
      return 'bailey@example.com';
    },
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(() => close());

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(base + path, { headers, redirect: 'manual' });
const authed = { 'cf-access-jwt-assertion': 'good' };

test('health needs no login', async () => {
  assert.equal((await get('/health')).status, 200);
});

test('www redirects to the apex, keeping the path', async () => {
  // fetch won't send a custom Host header, so use a raw request.
  const res = await new Promise<{ status?: number; location?: string }>((resolve, reject) => {
    request(`${base}/runs?x=1`, { headers: { host: 'www.moniqr.com' } }, (r) => {
      r.resume();
      resolve({ status: r.statusCode, location: r.headers.location });
    })
      .on('error', reject)
      .end();
  });
  assert.equal(res.status, 301);
  assert.equal(res.location, 'https://moniqr.com/runs?x=1');
});

test('everything else needs a valid Access token', async () => {
  assert.equal((await get('/')).status, 403);
  assert.equal((await get('/', { 'cf-access-jwt-assertion': 'bad' })).status, 403);
  assert.equal((await get('/hub.css')).status, 403);
});

test('the page shows the brief escaped, the runs and the signed-in email', async () => {
  const res = await get('/', authed);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  const html = await res.text();
  assert.ok(html.includes('<h3>Hello</h3>'));
  assert.ok(html.includes('&lt;b&gt;first&lt;/b&gt;'));
  assert.ok(html.includes('bailey@example.com'));
  assert.ok(html.includes('Plumbing test'));
  assert.ok(html.includes('Tue 27 Oct, 6:30am'));
});

test('the page still renders when the agent API is down', async () => {
  failAgents = true;
  try {
    const res = await get('/', authed);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes("isn't reachable"));
  } finally {
    failAgents = false;
  }
});

const post = (body: string, headers: Record<string, string>) =>
  fetch(base + '/run', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  });

test('run now queues a run from the hub', async () => {
  const res = await post('kind=test', { ...authed, origin: ORIGIN });
  assert.equal(res.status, 303);
  assert.deepEqual(queued.splice(0), ['test']);
});

test('run now refuses cross-site posts and unknown kinds', async () => {
  assert.equal((await post('kind=test', { ...authed, origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('kind=test', authed)).status, 403);
  assert.equal((await post('kind=delete_everything', { ...authed, origin: ORIGIN })).status, 400);
  assert.equal((await post('kind=test', { origin: ORIGIN })).status, 403);
  assert.deepEqual(queued, []);
});

test('dates read in Brisbane time', () => {
  assert.equal(formatWhen('2026-10-26T20:30:00Z'), 'Tue 27 Oct, 6:30am');
  assert.equal(formatWhen('2026-10-27T03:05:00Z'), 'Tue 27 Oct, 1:05pm');
});

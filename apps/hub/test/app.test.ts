import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { AccessDenied } from '../src/access.js';
import { AgentApiError, type AgentsClient, type RunKind } from '../src/agents.js';
import { createApp } from '../src/app.js';
import { formatWhen } from '../src/page.js';

const ORIGIN = 'https://moniqr.com';
const queued: RunKind[] = [];
let failAgents = false;
const decisions: unknown[] = [];
const actionDecisions: unknown[] = [];
let staleAction = false;

const agents: AgentsClient = {
  actions: async () => {
    if (failAgents) throw new Error('down');
    return { items: [], total: 0, pending: 0 };
  },
  actionDetail: async () => { throw new AgentApiError(404, 'Action not found.'); },
  decideAction: async (id, decision, revision) => {
    if (staleAction) throw new AgentApiError(409, 'This proposal changed. Reload and review the latest details.');
    actionDecisions.push({ id, decision, revision });
  },
  findings: async () => {
    if (failAgents) throw new Error('down');
    return { items: [], scan: null, total: 0 };
  },
  setFindingStatus: async (id, status) => { decisions.push({ id, status }); },
  calendar: async () => {
    if (failAgents) throw new Error('down');
    return { status: 'connected', events: [{ calendar: 'Personal', title: 'Meeting', start: '2026-11-09T09:00:00+10:00', end: '2026-11-09T10:00:00+10:00', allDay: false }] };
  },
  latestBrief: async () => {
    if (failAgents) throw new Error('down');
    return { id: 1, kind: 'test', body_md: '## Hello\n\n- <b>first</b>', summary: 'Hi', created_at: '2026-10-26T20:30:00Z' };
  },
  recentRuns: async () => {
    if (failAgents) throw new Error('down');
    return [
      { id: 1, agent: 'ea', trigger: 'manual', kind: 'test', status: 'done', queued_at: '2026-10-26T20:29:00Z', finished_at: null, duration_ms: 1000, error: null },
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
  assert.equal((await get('/hq.css')).status, 403);
  assert.equal((await get('/hq.js')).status, 403);
  assert.equal((await get('/api/hq')).status, 403);
  assert.equal((await get('/findings/1/status')).status, 403);
});

test('the page shell loads its script and styles from the hub only', async () => {
  const res = await get('/', authed);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  const html = await res.text();
  assert.ok(html.includes('src="/hq.js"'));
  assert.ok(html.includes('bailey@example.com'));
  for (const path of ['/hq.js', '/hq.css', '/vendor/preact-htm.js']) {
    assert.equal((await get(path, authed)).status, 200, path);
  }
});

test('HQ data carries the brief as escaped HTML, the runs and the placeholder content', async () => {
  const res = await get('/api/hq', authed);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.calendar.status, 'connected');
  assert.deepEqual(data.findings, { items: [], scan: null, total: 0 });
  assert.equal(data.findingsError, false);
  assert.deepEqual(data.actions, { items: [], total: 0, pending: 0 });
  assert.equal(data.actionsError, false);
  assert.equal(data.calendar.events[0].title, 'Meeting');
  assert.equal(data.email, 'bailey@example.com');
  assert.equal(data.agentsError, false);
  assert.ok(data.brief.html.includes('<h3>Hello</h3>'));
  assert.ok(data.brief.html.includes('&lt;b&gt;first&lt;/b&gt;'));
  assert.equal(data.brief.when, 'Tue 27 Oct, 6:30am');
  assert.equal(data.runs[0].kind, 'Plumbing test');
  assert.equal(data.busy, false);
  assert.deepEqual(data.mock.mail, [], 'sample emails must not masquerade as findings');
});

test('HQ data still loads when the agent API is down', async () => {
  failAgents = true;
  try {
    const res = await get('/api/hq', authed);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.agentsError, true);
    assert.equal(data.brief, null);
    assert.equal(data.calendar.status, 'error');
    assert.equal(data.findingsError, true);
    assert.equal(data.actionsError, true);
    assert.deepEqual(data.calendar.events, []);
    assert.deepEqual(data.runs, []);
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

test('run now answers the page script with no content', async () => {
  const res = await post('kind=morning_brief', { ...authed, origin: ORIGIN, accept: 'application/json' });
  assert.equal(res.status, 204);
  assert.deepEqual(queued.splice(0), ['morning_brief']);
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

test('action decisions authenticate, enforce same origin, validate revision and expose stale-review conflicts', async () => {
  const decide = (body: string, headers: Record<string, string>) => fetch(`${base}/actions/1/decision`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body,
  });
  const body = 'decision=approved&revision=1';
  assert.equal((await decide(body, { origin: ORIGIN })).status, 403);
  assert.equal((await decide(body, authed)).status, 403);
  assert.equal((await decide(body, { ...authed, origin: 'https://evil.example' })).status, 403);
  assert.equal((await decide('decision=approved', { ...authed, origin: ORIGIN })).status, 400);
  assert.equal((await decide('decision=executed&revision=1', { ...authed, origin: ORIGIN })).status, 400);
  assert.equal((await decide(body, { ...authed, origin: ORIGIN })).status, 204);
  assert.deepEqual(actionDecisions.splice(0), [{ id: 1, decision: 'approved', revision: 1 }]);
  staleAction = true;
  try {
    const r = await decide(body, { ...authed, origin: ORIGIN });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /proposal changed/);
  } finally { staleAction = false; }
  assert.equal((await get('/api/actions/1')).status, 403);
  assert.equal((await get('/api/actions/bad', authed)).status, 400);
  assert.equal((await get('/api/actions/1', authed)).status, 404);
});

test('finding decisions require sign-in, same origin and a supported status', async () => {
  const decide = (id: string, status: string, headers: Record<string, string>) => fetch(`${base}/findings/${id}/status`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ status }),
  });
  assert.equal((await decide('1', 'reviewed', { origin: ORIGIN })).status, 403);
  assert.equal((await decide('1', 'reviewed', authed)).status, 403);
  assert.equal((await decide('1', 'reviewed', { ...authed, origin: 'https://evil.example' })).status, 403);
  assert.equal((await decide('bad', 'reviewed', { ...authed, origin: ORIGIN })).status, 400);
  assert.equal((await decide('1', 'approved', { ...authed, origin: ORIGIN })).status, 400);
  assert.equal((await decide('1', 'reviewed', { ...authed, origin: ORIGIN })).status, 204);
  assert.deepEqual(decisions.splice(0), [{ id: 1, status: 'reviewed' }]);
});

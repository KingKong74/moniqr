import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../src/api/app.js';
import type { Pool } from '../src/db.js';

test('calendar endpoint requires hub authentication, uses Brisbane week and caches reads', async () => {
  let calls = 0;
  const app = createApp({
    pool: {} as Pool, apiToken: 'hub', runnerToken: 'runner', staleRunMs: 1000,
    calendar: { listEvents: async (start, end) => {
      calls++;
      const local = new Date(start.getTime() + 10 * 3_600_000);
      assert.equal(local.getUTCDay(), 1);
      assert.equal(local.getUTCHours(), 0);
      assert.equal(end.getTime() - start.getTime(), 7 * 86_400_000);
      return [{ title: 'Live event' }];
    } },
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/calendar`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal(calls, 0);
    for (let i = 0; i < 2; i++) {
      const res = await fetch(url, { headers: { authorization: 'Bearer hub' } });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { status: 'connected', events: [{ title: 'Live event' }] });
    }
    assert.equal(calls, 1);
  } finally { server.close(); }
});

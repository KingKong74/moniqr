import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { createApp } from '../src/api/app.js';
import { createPool, type Pool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

export const API_TOKEN = 'test-api-token';
export const RUNNER_TOKEN = 'test-runner-token';

const adminUrl = process.env.TEST_DATABASE_URL;

export const skipReason = adminUrl ? undefined : 'TEST_DATABASE_URL is not set';

/** Creates an empty, migrated database for one test file. */
export async function freshDatabase(): Promise<{ pool: Pool; drop: () => Promise<void> }> {
  const name = `agents_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(adminUrl!);
  url.pathname = `/${name}`;
  const pool = createPool(url.toString());
  await migrate(pool);

  return {
    pool,
    drop: async () => {
      await pool.end();
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

export async function startApp(pool: Pool, staleRunMs = 60_000) {
  const app = createApp({ pool, apiToken: API_TOKEN, runnerToken: RUNNER_TOKEN, staleRunMs });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  return { baseUrl, call, close: () => new Promise<void>((r) => server.close(() => r())) };
}

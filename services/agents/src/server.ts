import { createApp } from './api/app.js';
import { serverConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { startScheduler } from './scheduler.js';

import { googleCalendar, googleCredentialsFromEnv } from './google.js';

const config = serverConfig();
const google = googleCredentialsFromEnv();
const pool = createPool(config.databaseUrl);

const applied = await migrate(pool);
if (applied.length) console.log(`[migrate] applied ${applied.join(', ')}`);

const app = createApp({
  pool,
  calendar: google ? googleCalendar(google) : null,
  actionCalendarId: process.env.GOOGLE_WRITE_CALENDAR_ID,
  apiToken: config.apiToken,
  runnerToken: config.runnerToken,
  staleRunMs: config.staleRunMs,
});
const server = app.listen(config.port, () => console.log(`[api] listening on :${config.port}`));
const stopScheduler = startScheduler(pool, config.schedulerIntervalMs);

const shutdown = () => {
  stopScheduler();
  server.close(() => void pool.end().then(() => process.exit(0)));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

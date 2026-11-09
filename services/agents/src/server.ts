import { createApp } from './api/app.js';
import { serverConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { startScheduler } from './scheduler.js';

import { googleCalendar, googleCredentialsFromEnv, calendarWriteCredentialsFromEnv } from './google.js';
import { calendarWriter } from './calendar-writer.js';

const config = serverConfig();
const google = googleCredentialsFromEnv();
const pool = createPool(config.databaseUrl);
const writeCredentials = calendarWriteCredentialsFromEnv();
const target = process.env.GOOGLE_WRITE_CALENDAR_ID?.trim();
const writer = process.env.GOOGLE_CALENDAR_WRITES_ENABLED === 'true' && writeCredentials && target
  ? calendarWriter(writeCredentials, target) : null;
const reader = google ? googleCalendar(google) : null;

const applied = await migrate(pool);
if (applied.length) console.log(`[migrate] applied ${applied.join(', ')}`);

const app = createApp({
  pool,
  calendar: reader ? { listEvents: (start, end) => reader.listEvents(start, end, target) } : null,
  actionCalendarId: process.env.GOOGLE_WRITE_CALENDAR_ID,
  calendarWriter: writer,
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

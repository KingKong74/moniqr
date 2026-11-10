import { agentsClient } from './agents.js';
import { createApp, type HubAuth } from './app.js';
import { googleSignIn, sessions } from './auth.js';
import { hubConfig } from './config.js';

const config = hubConfig();
const { login } = config;
const auth: HubAuth = login.mode === 'dev'
  ? login
  : { mode: 'google', google: googleSignIn(login), sessions: sessions(login.sessionSecret, login.allowedEmails) };

const app = createApp({
  agents: agentsClient(config.agentsApiUrl, config.apiToken),
  auth,
  origin: config.origin,
});
const server = app.listen(config.port, () => console.log(`[hub] listening on :${config.port}`));

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

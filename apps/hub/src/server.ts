import { cloudflareAccess, devAccess } from './access.js';
import { agentsClient } from './agents.js';
import { createApp } from './app.js';
import { hubConfig } from './config.js';

const config = hubConfig();
const identify = config.access.mode === 'dev' ? devAccess(config.access.email) : cloudflareAccess(config.access);

const app = createApp({
  agents: agentsClient(config.agentsApiUrl, config.apiToken),
  identify,
  origin: config.origin,
});
const server = app.listen(config.port, () => console.log(`[hub] listening on :${config.port}`));

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

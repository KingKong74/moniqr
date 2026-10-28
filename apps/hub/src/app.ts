import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AccessDenied, type Identify } from './access.js';
import { RUN_KINDS, type AgentsClient, type RunKind } from './agents.js';
import { hqData, renderPage } from './page.js';

// The page's own script and styles. They sit beside src/ and dist/, so this works for both.
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
// Preact, its hooks and htm in one ES module, so the browser needs no build step or import map.
const PREACT = fileURLToPath(import.meta.resolve('htm/preact/standalone'));

export interface HubOptions {
  agents: AgentsClient;
  identify: Identify;
  /** Canonical origin, e.g. https://moniqr.com. www redirects here and POSTs must come from it. */
  origin: string;
}

export function createApp(opts: HubOptions) {
  const canonical = new URL(opts.origin);
  const app = express();
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.set({
      'content-security-policy': [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com",
        'font-src https://fonts.gstatic.com',
        "connect-src 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
      ].join('; '),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'cache-control': 'no-store',
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.type('text/plain').send('ok\n');
  });

  app.use((req, res, next) => {
    if (req.hostname === `www.${canonical.hostname}`) {
      res.redirect(301, new URL(req.originalUrl, canonical).toString());
      return;
    }
    next();
  });

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.email = await opts.identify(req.header('cf-access-jwt-assertion'));
      next();
    } catch (err) {
      if (!(err instanceof AccessDenied)) return next(err);
      res.status(403).type('text/plain').send('Forbidden. Sign in through https://moniqr.com.\n');
    }
  });

  app.use(express.static(PUBLIC_DIR, { index: false }));
  app.get('/vendor/preact-htm.js', (_req, res) => {
    res.sendFile(PREACT);
  });

  app.get('/', (_req, res) => {
    res.type('html').send(renderPage(res.locals.email));
  });

  app.get('/api/hq', async (_req, res) => {
    const [brief, runs] = await Promise.allSettled([opts.agents.latestBrief(), opts.agents.recentRuns(5)]);
    const agentsError = brief.status === 'rejected' || runs.status === 'rejected';
    if (agentsError) console.error('[hub] agent API unreachable', brief.status === 'rejected' ? brief.reason : runs);
    res.json(
      hqData({
        email: res.locals.email,
        brief: brief.status === 'fulfilled' ? brief.value : null,
        runs: runs.status === 'fulfilled' ? runs.value : [],
        agentsError,
      }),
    );
  });

  app.post('/run', express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
    // A cross-site form can't forge the Origin header, so this stops CSRF.
    if (req.header('origin') !== canonical.origin) {
      res.status(403).type('text/plain').send('Cross-site request refused.\n');
      return;
    }
    const kind = req.body?.kind as RunKind;
    if (!RUN_KINDS.includes(kind)) {
      res.status(400).type('text/plain').send('Unknown run kind.\n');
      return;
    }
    await opts.agents.queueRun(kind);
    // The page posts with fetch and refreshes itself; a plain form post lands back on HQ.
    if (req.accepts(['html', 'json']) === 'json') res.status(204).end();
    else res.redirect(303, '/');
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[hub]', err);
    res.status(502).type('text/plain').send('Something went wrong talking to the agent service.\n');
  });

  return app;
}

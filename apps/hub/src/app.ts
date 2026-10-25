import express, { type NextFunction, type Request, type Response } from 'express';
import { AccessDenied, type Identify } from './access.js';
import { RUN_KINDS, type AgentsClient, type RunKind } from './agents.js';
import { renderPage, STYLES } from './page.js';

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
      'content-security-policy': "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
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

  app.get('/hub.css', (_req, res) => {
    res.type('text/css').send(STYLES);
  });

  app.get('/', async (_req, res) => {
    const [brief, runs] = await Promise.allSettled([opts.agents.latestBrief(), opts.agents.recentRuns(5)]);
    const agentsError = brief.status === 'rejected' || runs.status === 'rejected';
    if (agentsError) console.error('[hub] agent API unreachable', brief.status === 'rejected' ? brief.reason : runs);
    res.type('html').send(
      renderPage({
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
    res.redirect(303, '/');
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[hub]', err);
    res.status(502).type('text/plain').send('Something went wrong talking to the agent service.\n');
  });

  return app;
}

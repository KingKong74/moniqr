import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AgentApiError, RUN_KINDS, type AgentsClient, type RunKind } from './agents.js';
import { LOGIN_MINUTES, newPendingLogin, SESSION_DAYS, SignInError, type GoogleSignIn, type Sessions } from './auth.js';
import { isLoginMessage, renderLogin } from './login.js';
import { hqData, renderPage } from './page.js';

// The page's own script and styles. They sit beside src/ and dist/, so this works for both.
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
// Preact, its hooks and htm in one ES module, so the browser needs no build step or import map.
const PREACT = fileURLToPath(import.meta.resolve('htm/preact/standalone'));

/** Google sign-in with session cookies, or local development signed in as one email. */
export type HubAuth =
  | { mode: 'google'; google: GoogleSignIn; sessions: Sessions }
  | { mode: 'dev'; email: string };

/** A same-site path to return to after signing in, or '/'. Refuses anything that could leave the hub. */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512 || !/^\/(?![/\\])/.test(value) || /[\u0000-\u001f\\]/.test(value)) return '/';
  return value.startsWith('/login') || value.startsWith('/logout') ? '/' : value;
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.header('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export interface HubOptions {
  agents: AgentsClient;
  auth: HubAuth;
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

  // Cookie names. __Host- pins a cookie to this exact host over HTTPS; plain names keep local http dev working.
  const secure = canonical.protocol === 'https:';
  const SESSION = secure ? '__Host-moniqr_session' : 'moniqr_session';
  const LOGIN = secure ? '__Host-moniqr_login' : 'moniqr_login';
  const cookieOpts = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
  const auth = opts.auth;
  const identify = async (req: Request) =>
    auth.mode === 'dev' ? auth.email : auth.sessions.read(readCookie(req, SESSION));

  app.get('/login.css', (_req, res) => {
    res.sendFile('login.css', { root: PUBLIC_DIR });
  });

  app.get('/login', async (req, res) => {
    const next = safeNext(req.query.next);
    if (await identify(req)) return void res.redirect(303, next);
    const message = isLoginMessage(req.query.error) ? req.query.error : req.query.signed_out !== undefined ? 'signed-out' : undefined;
    res.type('html').send(renderLogin({ message, next }));
  });

  app.get('/login/google', async (req, res) => {
    if (auth.mode === 'dev') return void res.redirect(303, '/');
    const login = newPendingLogin(safeNext(req.query.next));
    res.cookie(LOGIN, await auth.sessions.sealLogin(login), { ...cookieOpts, maxAge: LOGIN_MINUTES * 60_000 });
    res.redirect(303, auth.google.authUrl(login));
  });

  app.get('/login/google/callback', async (req, res) => {
    if (auth.mode === 'dev') return void res.redirect(303, '/');
    const fail = (reason: string) => res.clearCookie(LOGIN, cookieOpts).redirect(303, `/login?error=${reason}`);
    const login = await auth.sessions.openLogin(readCookie(req, LOGIN));
    if (!login || typeof req.query.state !== 'string' || req.query.state !== login.state) return void fail('expired');
    if (req.query.error === 'access_denied') return void fail('cancelled');
    if (typeof req.query.code !== 'string' || !req.query.code) return void fail('failed');
    try {
      const email = await auth.google.finish(req.query.code, login);
      res.clearCookie(LOGIN, cookieOpts);
      res.cookie(SESSION, await auth.sessions.issue(email), { ...cookieOpts, maxAge: SESSION_DAYS * 86_400_000 });
      console.log(`[hub] signed in ${email}`);
      res.redirect(303, login.next);
    } catch (err) {
      if (!(err instanceof SignInError)) throw err;
      console.warn(`[hub] sign-in refused: ${err.message}`);
      fail(err.reason);
    }
  });

  app.post('/logout', (req, res) => {
    // Same Origin check as every other post, so another site can't sign you out.
    if (req.header('origin') !== canonical.origin) return void res.status(403).type('text/plain').send('Cross-site request refused.\n');
    res.clearCookie(SESSION, cookieOpts).redirect(303, '/login?signed_out');
  });

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const email = await identify(req);
    if (email) {
      res.locals.email = email;
      return next();
    }
    // A person opening a page goes to the login page; the page's own requests get a 401 to act on.
    if (req.method === 'GET' && !req.path.startsWith('/api/') && req.accepts(['html', 'json']) === 'html') {
      const back = safeNext(req.originalUrl);
      return void res.redirect(302, back === '/' ? '/login' : `/login?next=${encodeURIComponent(back)}`);
    }
    res.status(401).json({ error: 'Sign in at /login.' });
  });

  app.use(express.static(PUBLIC_DIR, { index: false }));
  app.get('/vendor/preact-htm.js', (_req, res) => {
    res.sendFile(PREACT);
  });

  app.get('/', (_req, res) => {
    res.type('html').send(renderPage(res.locals.email));
  });

  app.get('/api/hq', async (_req, res) => {
    const [brief, runs, calendar, findings, actions] = await Promise.allSettled([
      opts.agents.latestBrief(), opts.agents.recentRuns(5), opts.agents.calendar(), opts.agents.findings(), opts.agents.actions(),
    ]);
    const agentsError = brief.status === 'rejected' || runs.status === 'rejected';
    if (agentsError) console.error('[hub] agent API unreachable', brief.status === 'rejected' ? brief.reason : runs);
    res.json(
      hqData({
        email: res.locals.email,
        brief: brief.status === 'fulfilled' ? brief.value : null,
        runs: runs.status === 'fulfilled' ? runs.value : [],
        agentsError,
        calendar: calendar.status === 'fulfilled' ? calendar.value : { status: 'error', events: [] },
        findings: findings.status === 'fulfilled' ? findings.value : undefined,
        findingsError: findings.status === 'rejected',
        actions: actions.status === 'fulfilled' ? actions.value : undefined,
        actionsError: actions.status === 'rejected',
      }),
    );
  });

  app.get('/api/actions/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return void res.status(400).json({ error: 'Invalid action.' });
    try { res.json(await opts.agents.actionDetail(id)); }
    catch (err) {
      if (err instanceof AgentApiError && err.status === 404) return void res.status(404).json({ error: err.message });
      throw err;
    }
  });

  app.post('/actions/:id/decision', express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
    if (req.header('origin') !== canonical.origin) return void res.status(403).json({ error: 'Cross-site request refused.' });
    const id = Number(req.params.id);
    const revision = Number(req.body?.revision);
    const decision = req.body?.decision;
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(revision) || revision <= 0 || !['approved', 'rejected'].includes(decision)) {
      return void res.status(400).json({ error: 'Invalid action decision.' });
    }
    try {
      const action = await opts.agents.decideAction(id, decision, revision);
      if (action) res.json({ action }); else res.status(204).end();
    }
    catch (err) {
      if (err instanceof AgentApiError && [400, 404, 409].includes(err.status)) return void res.status(err.status).json({ error: err.message });
      throw err;
    }
  });

  for (const operation of ['prepare','execute','undo'] as const) app.post(`/actions/:id/${operation}`,
    express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
      if (req.header('origin') !== canonical.origin) return void res.status(403).json({ error: 'Cross-site request refused.' });
      const id = Number(req.params.id), revision = Number(req.body?.revision);
      if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(revision) || revision <= 0) return void res.status(400).json({ error: 'Invalid action revision.' });
      try { res.json({ action: await opts.agents.calendarAction!(id, operation, revision) }); }
      catch (err) {
        if (err instanceof AgentApiError && [400,404,409].includes(err.status)) return void res.status(err.status).json({ error: err.message });
        throw err;
      }
    });

  app.post('/findings/:id/status', express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
    if (req.header('origin') !== canonical.origin) return void res.status(403).send('Cross-site request refused.');
    const id = Number(req.params.id);
    const status = req.body?.status;
    if (!Number.isSafeInteger(id) || id <= 0 || !['new', 'reviewed', 'dismissed'].includes(status)) {
      return void res.status(400).send('Invalid finding status.');
    }
    await opts.agents.setFindingStatus(id, status);
    res.status(204).end();
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

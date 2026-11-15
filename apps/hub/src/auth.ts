import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose';

/**
 * moniqr's own login: a security code (HUB_PASSCODE) and, when configured, "Continue with Google" (OpenID Connect, authorisation code + PKCE), limited
 * to the emails in HUB_ALLOWED_EMAILS, then a signed session cookie. Traefik is also reachable
 * directly over IPv6, so nothing here trusts anything a proxy adds to the request.
 */

/** Why sign-in failed, as shown on the login page. */
export type SignInFailure = 'denied' | 'failed' | 'expired' | 'cancelled' | 'passcode' | 'locked';

export class SignInError extends Error {
  constructor(readonly reason: SignInFailure, message: string) {
    super(message);
  }
}

const SESSION_AUDIENCE = 'moniqr-session';
const LOGIN_AUDIENCE = 'moniqr-login';
export const SESSION_DAYS = 30;
export const LOGIN_MINUTES = 10;

export const normaliseEmails = (emails: string[]) => new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));

/** What the hub keeps between leaving for Google and coming back. */
export interface PendingLogin {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
}

/**
 * Signs and checks the session cookie and the short-lived login cookie with one secret. Each has its
 * own audience, so one can never stand in for the other. Rotating the secret signs everyone out.
 */
export function sessions(secret: string, allowedEmails: string[]) {
  const key = new TextEncoder().encode(secret);
  const allowed = normaliseEmails(allowedEmails);

  return {
    async issue(email: string): Promise<string> {
      return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(email.toLowerCase())
        .setAudience(SESSION_AUDIENCE).setIssuedAt().setExpirationTime(`${SESSION_DAYS}d`).sign(key);
    },

    /** The signed-in email, or null. Re-checks the allow list so removing an email locks it out. */
    async read(token: string | undefined): Promise<string | null> {
      if (!token) return null;
      try {
        const { payload } = await jwtVerify(token, key, { audience: SESSION_AUDIENCE, algorithms: ['HS256'] });
        return payload.sub && allowed.has(payload.sub) ? payload.sub : null;
      } catch {
        return null;
      }
    },

    async sealLogin(login: PendingLogin): Promise<string> {
      return new SignJWT({ ...login }).setProtectedHeader({ alg: 'HS256' })
        .setAudience(LOGIN_AUDIENCE).setIssuedAt().setExpirationTime(`${LOGIN_MINUTES}m`).sign(key);
    },

    async openLogin(token: string | undefined): Promise<PendingLogin | null> {
      if (!token) return null;
      try {
        const { payload: p } = await jwtVerify(token, key, { audience: LOGIN_AUDIENCE, algorithms: ['HS256'] });
        const fields = [p.state, p.nonce, p.verifier, p.next];
        return fields.every((f) => typeof f === 'string')
          ? { state: p.state as string, nonce: p.nonce as string, verifier: p.verifier as string, next: p.next as string }
          : null;
      } catch {
        return null;
      }
    },
  };
}
export type Sessions = ReturnType<typeof sessions>;

const random = () => randomBytes(32).toString('base64url');

export function newPendingLogin(next: string): PendingLogin {
  return { state: random(), nonce: random(), verifier: random(), next };
}

export interface GoogleOptions {
  clientId: string;
  clientSecret: string;
  /** e.g. https://moniqr.com/login/google/callback, registered on the Google OAuth client. */
  redirectUri: string;
  allowedEmails: string[];
  /** Google's signing keys; tests pass local ones. */
  keys?: JWTVerifyGetKey;
  /** Tests pass a fake token endpoint. */
  fetch?: typeof fetch;
}

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** Google sign-in. It asks only for `openid email`, so it can't read anything else in the account. */
export function googleSignIn(opts: GoogleOptions) {
  const keys = opts.keys ?? createRemoteJWKSet(new URL(GOOGLE_CERTS));
  const doFetch = opts.fetch ?? fetch;
  const allowed = normaliseEmails(opts.allowedEmails);

  return {
    authUrl(login: PendingLogin): string {
      const url = new URL(GOOGLE_AUTH);
      url.search = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        response_type: 'code',
        scope: 'openid email',
        state: login.state,
        nonce: login.nonce,
        code_challenge: createHash('sha256').update(login.verifier).digest('base64url'),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString();
      return url.toString();
    },

    /** Swaps the code Google sent back for an ID token and returns its email if it's allowed in. */
    async finish(code: string, login: PendingLogin): Promise<string> {
      const res = await doFetch(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: opts.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: login.verifier,
        }),
      });
      if (!res.ok) throw new SignInError('failed', `Google token exchange returned ${res.status}`);
      const idToken = ((await res.json()) as { id_token?: unknown }).id_token;
      if (typeof idToken !== 'string') throw new SignInError('failed', 'Google returned no ID token');

      let claims;
      try {
        ({ payload: claims } = await jwtVerify(idToken, keys, { issuer: GOOGLE_ISSUERS, audience: opts.clientId }));
      } catch (err) {
        throw new SignInError('failed', `Invalid Google ID token: ${(err as Error).message}`);
      }
      if (claims.nonce !== login.nonce) throw new SignInError('failed', 'Google ID token nonce mismatch');
      const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
      if (claims.email_verified !== true || !allowed.has(email)) {
        throw new SignInError('denied', `Refused sign-in for ${email || 'an account without an email'}`);
      }
      return email;
    },
  };
}
export type GoogleSignIn = ReturnType<typeof googleSignIn>;

export const PASSCODE_LIMITS = {
  /** Wrong codes one client may try before it's locked out for the rest of the window. */
  perClient: 5,
  clientWindowMs: 15 * 60_000,
  /** Wrong codes from everyone together before the code is refused for the rest of the window. */
  global: 20,
  globalWindowMs: 60 * 60_000,
};

export type PasscodeResult = 'ok' | 'wrong' | 'locked';

/**
 * The security code. It signs in as the first allowed email, so the allow list still governs
 * sessions. Codes are compared as HMACs in constant time. Client addresses can be forged by
 * anyone who reaches Traefik directly, so the site-wide limit is what really caps guessing:
 * 20 wrong codes an hour, whoever sends them.
 */
export function passcodeGate(code: string, email: string, now: () => number = Date.now) {
  const key = randomBytes(32);
  const digest = (s: string) => createHmac('sha256', key).update(s.normalize('NFKC')).digest();
  const want = digest(code);
  const clients = new Map<string, { fails: number; since: number }>();
  let everyone = { fails: 0, since: 0 };

  const fresh = (w: { fails: number; since: number }, windowMs: number) =>
    now() - w.since >= windowMs ? { fails: 0, since: now() } : w;

  return {
    email,
    check(input: string, client: string): PasscodeResult {
      everyone = fresh(everyone, PASSCODE_LIMITS.globalWindowMs);
      const mine = fresh(clients.get(client) ?? { fails: 0, since: now() }, PASSCODE_LIMITS.clientWindowMs);
      clients.set(client, mine);
      if (everyone.fails >= PASSCODE_LIMITS.global || mine.fails >= PASSCODE_LIMITS.perClient) return 'locked';
      if (input.length <= 256 && timingSafeEqual(digest(input), want)) {
        clients.delete(client);
        return 'ok';
      }
      mine.fails++;
      everyone.fails++;
      if (clients.size > 10_000) for (const [k, w] of clients) if (now() - w.since >= PASSCODE_LIMITS.clientWindowMs) clients.delete(k);
      return 'wrong';
    },
  };
}
export type PasscodeGate = ReturnType<typeof passcodeGate>;

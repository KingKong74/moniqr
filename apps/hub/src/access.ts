import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Returns the signed-in email, or throws if the request isn't from an allowed user. */
export type Identify = (assertion: string | undefined) => Promise<string>;

export class AccessDenied extends Error {}

export interface AccessOptions {
  /** e.g. bkos.cloudflareaccess.com */
  teamDomain: string;
  /** The Access application's AUD tag. */
  audience: string;
  allowedEmails: string[];
  /** Signing keys; defaults to the team's published certs. Tests pass local keys. */
  keys?: JWTVerifyGetKey;
}

/**
 * Checks the token Cloudflare Access adds to every request it lets through. Traefik is also
 * reachable directly over IPv6, so the hub can't assume a request came through Cloudflare.
 */
export function cloudflareAccess(opts: AccessOptions): Identify {
  const issuer = `https://${opts.teamDomain}`;
  const keys = opts.keys ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  const allowed = new Set(opts.allowedEmails.map((e) => e.toLowerCase()));

  return async (assertion) => {
    if (!assertion) throw new AccessDenied('No Cloudflare Access token');
    let email: unknown;
    try {
      ({ payload: { email } } = await jwtVerify(assertion, keys, { issuer, audience: opts.audience }));
    } catch {
      throw new AccessDenied('Invalid Cloudflare Access token');
    }
    if (typeof email !== 'string' || !allowed.has(email.toLowerCase())) {
      throw new AccessDenied('This account is not allowed');
    }
    return email;
  };
}

export const devAccess = (email: string): Identify => async () => email;

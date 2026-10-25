import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { AccessDenied, cloudflareAccess, type Identify } from '../src/access.js';

const TEAM = 'example.cloudflareaccess.com';
const AUD = 'hub-aud';
let key: CryptoKey;
let otherKey: CryptoKey;
let identify: Identify;

const sign = (claims: Record<string, unknown>, opts: { signer?: CryptoKey; aud?: string; iss?: string; exp?: string } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.signer ?? key);

before(async () => {
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  identify = cloudflareAccess({
    teamDomain: TEAM,
    audience: AUD,
    allowedEmails: ['Bailey@Example.com'],
    keys: createLocalJWKSet({ keys: [jwk] }),
  });
});

test('accepts an allowed email, ignoring case', async () => {
  assert.equal(await identify(await sign({ email: 'bailey@example.com' })), 'bailey@example.com');
});

test('refuses a missing token', async () => {
  await assert.rejects(identify(undefined), AccessDenied);
});

test('refuses an email that is not allowed', async () => {
  await assert.rejects(identify(await sign({ email: 'someone@example.com' })), AccessDenied);
});

test('refuses tokens for another app, another team, the wrong key or past expiry', async () => {
  await assert.rejects(identify(await sign({ email: 'bailey@example.com' }, { aud: 'other' })), AccessDenied);
  await assert.rejects(identify(await sign({ email: 'bailey@example.com' }, { iss: 'https://evil.cloudflareaccess.com' })), AccessDenied);
  await assert.rejects(identify(await sign({ email: 'bailey@example.com' }, { signer: otherKey })), AccessDenied);
  await assert.rejects(identify(await sign({ email: 'bailey@example.com' }, { exp: '-1m' })), AccessDenied);
});

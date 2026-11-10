import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { googleSignIn, newPendingLogin, sessions, SignInError, type GoogleSignIn } from '../src/auth.js';

const CLIENT = 'client-id.apps.googleusercontent.com';
const REDIRECT = 'https://moniqr.com/login/google/callback';
let key: CryptoKey;
let otherKey: CryptoKey;
let google: GoogleSignIn;
let idToken: string | undefined;
let tokenStatus = 200;
let exchanged: URLSearchParams | undefined;

const sign = (claims: Record<string, unknown>, opts: { signer?: CryptoKey; aud?: string; iss?: string; exp?: string } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? 'https://accounts.google.com')
    .setAudience(opts.aud ?? CLIENT)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.signer ?? key);

before(async () => {
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  google = googleSignIn({
    clientId: CLIENT,
    clientSecret: 'secret',
    redirectUri: REDIRECT,
    allowedEmails: [' Bailey@Example.com '],
    keys: createLocalJWKSet({ keys: [jwk] }),
    fetch: async (_url, init) => {
      exchanged = new URLSearchParams(String(init?.body));
      return new Response(JSON.stringify({ id_token: idToken }), { status: tokenStatus });
    },
  });
});

test('the Google link asks only for openid email, with state, nonce and a PKCE challenge', () => {
  const login = newPendingLogin('/');
  const url = new URL(google.authUrl(login));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = url.searchParams;
  assert.equal(q.get('scope'), 'openid email');
  assert.equal(q.get('client_id'), CLIENT);
  assert.equal(q.get('redirect_uri'), REDIRECT);
  assert.equal(q.get('state'), login.state);
  assert.equal(q.get('nonce'), login.nonce);
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('code_challenge'), createHash('sha256').update(login.verifier).digest('base64url'));
  assert.ok(!url.toString().includes(login.verifier));
});

test('accepts a verified, allowed email and sends the PKCE verifier', async () => {
  const login = newPendingLogin('/');
  idToken = await sign({ email: 'bailey@example.com', email_verified: true, nonce: login.nonce });
  assert.equal(await google.finish('the-code', login), 'bailey@example.com');
  assert.equal(exchanged?.get('code'), 'the-code');
  assert.equal(exchanged?.get('code_verifier'), login.verifier);
  assert.equal(exchanged?.get('redirect_uri'), REDIRECT);
});

const refused = async (reason: string, claims: Record<string, unknown>, opts?: Parameters<typeof sign>[1]) => {
  const login = newPendingLogin('/');
  idToken = await sign({ email: 'bailey@example.com', email_verified: true, nonce: login.nonce, ...claims }, opts);
  await assert.rejects(google.finish('code', login), (err) => err instanceof SignInError && err.reason === reason);
};

test('refuses other accounts and unverified emails', async () => {
  await refused('denied', { email: 'someone@example.com' });
  await refused('denied', { email_verified: false });
  await refused('denied', { email: undefined });
});

test('refuses tokens for another client, another issuer, the wrong key, past expiry or another login', async () => {
  await refused('failed', {}, { aud: 'other-client' });
  await refused('failed', {}, { iss: 'https://evil.example' });
  await refused('failed', {}, { signer: otherKey });
  await refused('failed', {}, { exp: '-1m' });
  await refused('failed', { nonce: 'another-login' });
});

test('refuses a failed token exchange', async () => {
  tokenStatus = 400;
  await assert.rejects(google.finish('code', newPendingLogin('/')), (err) => err instanceof SignInError && err.reason === 'failed');
  tokenStatus = 200;
  idToken = undefined;
  await assert.rejects(google.finish('code', newPendingLogin('/')), (err) => err instanceof SignInError && err.reason === 'failed');
});

test('sessions round trip, honour the allow list and reject tampering', async () => {
  const store = sessions('test-secret-that-is-at-least-32-characters', ['bailey@example.com']);
  const token = await store.issue('Bailey@Example.com');
  assert.equal(await store.read(token), 'bailey@example.com');
  assert.equal(await store.read(undefined), null);
  assert.equal(await store.read(token.slice(0, -2) + 'xx'), null);
  // Removing an email from the allow list locks out its existing sessions.
  assert.equal(await sessions('test-secret-that-is-at-least-32-characters', ['other@example.com']).read(token), null);
  const login = newPendingLogin('/runs');
  const sealed = await store.sealLogin(login);
  assert.deepEqual(await store.openLogin(sealed), login);
  assert.equal(await store.openLogin(token), null);
  assert.equal(await store.read(sealed), null);
});

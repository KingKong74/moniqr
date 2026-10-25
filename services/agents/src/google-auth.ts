/**
 * One-off: get a read-only Google Calendar refresh token and save it to an env file.
 *
 *   npm run google-auth -w services/agents [-- path/to/ops.env]
 *
 * Reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a Desktop app OAuth client) from the
 * environment or the env file, opens a consent link, and writes GOOGLE_REFRESH_TOKEN into
 * the env file. The token is never printed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { CALENDAR_SCOPE } from './google.js';

const PORT = 8765;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/`;
const envPath = process.argv[2] ?? `${homedir()}/.config/moniqr/ops.env`;

function readEnvFile(path: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch {
    return {};
  }
}

function saveToEnvFile(path: string, key: string, value: string) {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {}
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, '\n')}${line}\n`;
  writeFileSync(path, text, { mode: 0o600 });
}

const fileEnv = readEnvFile(envPath);
const clientId = process.env.GOOGLE_CLIENT_ID ?? fileEnv.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? fileEnv.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error(`Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in ${envPath} first.`);
  process.exit(1);
}

const state = randomBytes(16).toString('base64url');
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

const consent = new URL('https://accounts.google.com/o/oauth2/v2/auth');
consent.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: CALENDAR_SCOPE,
  access_type: 'offline',
  prompt: 'consent',
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString();

console.log(`\n1. Open this link and allow read-only calendar access:\n\n${consent}\n`);
console.log(
  `2. Google then sends you to ${REDIRECT_URI}. If this machine's browser opened it, you're done.\n` +
    '   If the page fails to load (browser on another device), copy the whole address from the\n' +
    '   address bar and paste it here.\n',
);

async function finish(callbackUrl: string): Promise<string> {
  const url = new URL(callbackUrl, REDIRECT_URI);
  if (url.searchParams.get('error')) throw new Error(`Google said: ${url.searchParams.get('error')}`);
  if (url.searchParams.get('state') !== state) throw new Error('State mismatch; start again.');
  const code = url.searchParams.get('code');
  if (!code) throw new Error('No code in that address.');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const data = (await res.json()) as { refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!res.ok) throw new Error(`Token exchange failed: ${data.error_description ?? data.error ?? res.status}`);
  if (!data.refresh_token) throw new Error('Google returned no refresh token. Remove the app at myaccount.google.com/permissions and try again.');
  if (data.scope?.trim() !== CALENDAR_SCOPE) throw new Error(`Unexpected scopes granted: ${data.scope}`);
  saveToEnvFile(envPath, 'GOOGLE_REFRESH_TOKEN', data.refresh_token);
  return `Saved GOOGLE_REFRESH_TOKEN to ${envPath} (read-only calendar scope).`;
}

let done = false;
const complete = (p: Promise<string>) =>
  p.then(
    (msg) => {
      if (done) return;
      done = true;
      console.log(`\n${msg}`);
      process.exit(0);
    },
    (err: Error) => console.error(`\n${err.message}`),
  );

const server = createServer((req, res) => {
  if (!req.url?.includes('code=') && !req.url?.includes('error=')) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'text/plain' }).end('Done. You can close this tab and go back to the terminal.\n');
  void complete(finish(req.url));
});
server.listen(PORT, '127.0.0.1');

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim()) void complete(finish(line.trim()));
});

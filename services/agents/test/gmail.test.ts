import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gmail, htmlToText } from '../src/gmail.js';
import { CALENDAR_SCOPE, GMAIL_SCOPE, scopesMatch } from '../src/google.js';

const creds = { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' };
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

/** A stand-in for Gmail: records each request and answers from a route table. */
function fakeGmail(routes: Record<string, unknown>, status = 200) {
  const calls: { method: string; url: URL }[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'at', expires_in: 3600 });
    calls.push({ method: init?.method ?? 'GET', url });
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer at');
    if (status !== 200) return new Response('no', { status });
    const body = routes[url.pathname.replace('/gmail/v1/users/me', '')];
    return body ? Response.json(body) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

const headers = (from: string, subject?: string) => [
  { name: 'From', value: from },
  { name: 'To', value: 'me@example.com' },
  ...(subject ? [{ name: 'Subject', value: subject }] : []),
];

test('search returns summaries in Brisbane time and only ever reads', async () => {
  const google = fakeGmail({
    '/messages': { messages: [{ id: 'a1' }, { id: 'b2' }] },
    '/messages/a1': {
      id: 'a1',
      threadId: 't1',
      snippet: 'Your bill of $120 &amp; more',
      labelIds: ['INBOX', 'UNREAD'],
      internalDate: String(Date.UTC(2026, 10, 4, 20, 30)),
      payload: { headers: headers('Origin <bills@origin.example>', 'Your bill') },
    },
    '/messages/b2': { id: 'b2', threadId: 't2', internalDate: '0', payload: { headers: headers('x@example.com') } },
  });
  const found = await gmail(creds, google.impl).search('newer_than:7d bill', 2);

  assert.equal(found.length, 2);
  assert.deepEqual(found[0], {
    id: 'a1',
    threadId: 't1',
    from: 'Origin <bills@origin.example>',
    to: 'me@example.com',
    subject: 'Your bill',
    date: '2026-11-05T06:30:00+10:00',
    snippet: 'Your bill of $120 & more',
    unread: true,
  });
  assert.equal(found[1]!.subject, '(no subject)');
  assert.equal(found[1]!.unread, false);

  const list = google.calls[0]!.url;
  assert.equal(list.searchParams.get('q'), 'newer_than:7d bill');
  assert.equal(list.searchParams.get('maxResults'), '2');
  assert.equal(list.searchParams.get('includeSpamTrash'), null, 'spam and trash stay out');
  assert.ok(google.calls.every((c) => c.method === 'GET'));
});

test('search caps the result count and copes with no matches', async () => {
  const google = fakeGmail({ '/messages': {} });
  assert.deepEqual(await gmail(creds, google.impl).search('nothing', 500), []);
  assert.equal(google.calls[0]!.url.searchParams.get('maxResults'), '25');
});

test('read prefers plain text in nested parts and lists attachments without fetching them', async () => {
  const google = fakeGmail({
    '/messages/m1': {
      id: 'm1',
      threadId: 't1',
      internalDate: '0',
      payload: {
        mimeType: 'multipart/mixed',
        headers: headers('a@example.com', 'Invoice'),
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/plain', body: { data: b64('Amount due: $88.40 ✓') } },
              { mimeType: 'text/html', body: { data: b64('<p>ignored</p>') } },
            ],
          },
          { mimeType: 'application/pdf', filename: 'invoice.pdf', body: { attachmentId: 'x', size: 1234 } },
          { mimeType: 'text/plain', filename: 'notes.txt', body: { data: b64('attached text, not the body') } },
        ],
      },
    },
  });
  const email = await gmail(creds, google.impl).read('m1');
  assert.equal(email.body, 'Amount due: $88.40 ✓');
  assert.equal(email.truncated, false);
  assert.deepEqual(email.attachments.map((a) => a.name), ['invoice.pdf', 'notes.txt']);
  assert.equal(email.attachments[0]!.bytes, 1234);
  assert.equal(google.calls.length, 1, 'one request; attachments are not downloaded');
});

test('read falls back to HTML when the plain part is empty, and cuts long bodies', async () => {
  const google = fakeGmail({
    '/messages/m2': {
      id: 'm2',
      threadId: 't2',
      internalDate: '0',
      payload: {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64('  \n ') } },
          { mimeType: 'text/html', body: { data: b64(`<p>Due Friday</p>${'x'.repeat(9000)}`) } },
        ],
      },
    },
    '/messages/m3': {
      id: 'm3',
      threadId: 't3',
      internalDate: '0',
      payload: { mimeType: 'text/plain', body: { data: b64('single part') } },
    },
  });
  const client = gmail(creds, google.impl);
  const long = await client.read('m2');
  assert.ok(long.body.startsWith('Due Friday\n'));
  assert.equal(long.truncated, true);
  assert.equal(long.body.length, 8001);
  assert.equal((await client.read('m3')).body, 'single part');
});

test('HTML becomes readable text without scripts, styles or double-decoded entities', () => {
  const html = `<html><head><title>t</title><style>p{color:red}</style></head><body>
    <!-- hidden --><script>alert(1)</script>
    <p>Rates&nbsp;notice</p><table><tr><td>Total</td><td>$1,204&#46;50</td></tr></table>
    Fish &amp; chips &amp;lt;b&amp;gt;<br>Done</body></html>`;
  assert.equal(htmlToText(html), 'Rates notice\nTotal $1,204.50\n\nFish & chips &lt;b&gt;\nDone');
});

test('a token without Gmail access says how to fix it', async () => {
  const client = gmail(creds, fakeGmail({}, 403).impl);
  await assert.rejects(client.search('x'), /run google-auth again/);
  await assert.rejects(gmail(creds, fakeGmail({}, 500).impl).read('m'), /returned 500/);
});

test('the token must hold exactly the read-only scopes', () => {
  assert.ok(scopesMatch(`${GMAIL_SCOPE} ${CALENDAR_SCOPE}`), 'order does not matter');
  assert.ok(!scopesMatch(CALENDAR_SCOPE), 'Gmail unticked at consent');
  assert.ok(!scopesMatch(`${CALENDAR_SCOPE} ${GMAIL_SCOPE} https://mail.google.com/`), 'anything extra is refused');
  assert.ok(!scopesMatch(undefined));
});

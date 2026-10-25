import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleCalendar, googleCredentialsFromEnv } from '../src/google.js';

const creds = { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' };

/** A stand-in for Google: records each request and answers from a route table. */
function fakeGoogle(routes: Record<string, unknown>, tokenStatus = 200) {
  const calls: string[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.hostname === 'oauth2.googleapis.com') {
      assert.equal((init?.body as URLSearchParams).get('grant_type'), 'refresh_token');
      return Response.json(tokenStatus === 200 ? { access_token: 'at', expires_in: 3600 } : { error: 'invalid_grant' }, {
        status: tokenStatus,
      });
    }
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer at');
    const body = routes[url.pathname];
    return body ? Response.json(body) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

test('credentials are all-or-nothing', () => {
  assert.equal(googleCredentialsFromEnv({}), null);
  assert.deepEqual(
    googleCredentialsFromEnv({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GOOGLE_REFRESH_TOKEN: 'c' }),
    { clientId: 'a', clientSecret: 'b', refreshToken: 'c' },
  );
  assert.throws(() => googleCredentialsFromEnv({ GOOGLE_CLIENT_ID: 'a' }), /all of/);
});

test('events from every calendar are merged, soonest first, without cancelled ones', async () => {
  const google = fakeGoogle({
    '/calendar/v3/users/me/calendarList': {
      items: [
        { id: 'me@gmail.com', summary: 'me@gmail.com', summaryOverride: 'Personal', primary: true },
        { id: 'shifts#x', summary: 'Woolworths' },
      ],
    },
    '/calendar/v3/calendars/me%40gmail.com/events': {
      items: [
        { summary: 'Study CA ANZ', start: { dateTime: '2026-10-27T19:00:00+10:00' }, end: { dateTime: '2026-10-27T21:00:00+10:00' } },
        { summary: 'Rego due', start: { date: '2026-10-27' }, end: { date: '2026-10-28' } },
        { summary: 'Old plan', status: 'cancelled', start: { dateTime: '2026-10-27T08:00:00+10:00' } },
      ],
    },
    '/calendar/v3/calendars/shifts%23x/events': {
      items: [
        {
          summary: 'Shift',
          location: 'Woolworths',
          description: 'x'.repeat(600),
          start: { dateTime: '2026-10-27T06:00:00+10:00' },
          end: { dateTime: '2026-10-27T10:00:00+10:00' },
          attendees: [{ self: true, responseStatus: 'accepted' }],
        },
      ],
    },
  });
  const cal = googleCalendar(creds, google.impl);
  const events = await cal.listEvents(new Date('2026-10-26T14:00:00Z'), new Date('2026-10-27T14:00:00Z'));

  assert.deepEqual(
    events.map((e) => [e.calendar, e.title, e.allDay]),
    [
      ['Personal', 'Rego due', true],
      ['Woolworths', 'Shift', false],
      ['Personal', 'Study CA ANZ', false],
    ],
  );
  const shift = events[1]!;
  assert.equal(shift.response, 'accepted');
  assert.equal(shift.description!.length, 501, 'long descriptions are cut to 500 characters plus an ellipsis');

  // One token exchange serves every call in the run; everything else is a read.
  assert.equal(google.calls.filter((c) => c.startsWith('POST')).length, 1);
  assert.ok(google.calls.filter((c) => !c.includes('oauth2') && !c.includes('/token')).every((c) => c.startsWith('GET')));
});

test('a revoked refresh token gives a clear error', async () => {
  const cal = googleCalendar(creds, fakeGoogle({}, 400).impl);
  await assert.rejects(cal.listCalendars(), /refresh token may need renewing/);
});

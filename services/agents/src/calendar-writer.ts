/** Server-only Google writer. The target is fixed at construction; no model input
 * can select a calendar, invite guests, edit events or delete an arbitrary event.
 * Provider IDs and private tags let an uncertain write be reconciled safely.
 */
import { createHash } from 'node:crypto';
import { googleAccessToken, type GoogleCredentials } from './google.js';

export interface EventSpec {
  id: string; title: string; start: string; end: string; location: string;
  tags: Record<string, string>;
}
export interface ProviderEvent {
  id: string; status?: string; etag?: string; summary?: string; location?: string;
  start?: { dateTime?: string }; end?: { dateTime?: string };
  attendees?: unknown[]; extendedProperties?: { private?: Record<string, string> };
}
export interface CalendarWriter {
  calendarId: string;
  get(id: string): Promise<ProviderEvent | null>;
  create(spec: EventSpec): Promise<ProviderEvent>;
  remove(event: ProviderEvent): Promise<void>;
}
export class CalendarProviderError extends Error {
  constructor(public status: number | null) {
    super(status === 403 || status === 401 ? 'Google refused calendar access. Renew the calendar write connection.'
      : status === 412 ? 'This event changed in Google. Reload it before attempting undo.'
      : status ? `Google Calendar returned ${status}.` : 'Google Calendar did not confirm the request.');
  }
}
export const eventId = (instance: string, action: number, revision: number) =>
  'moniqr' + createHash('sha256').update(`${instance}:${action}:${revision}`).digest('hex');

export function matchesEvent(event: ProviderEvent, spec: EventSpec) {
  return event.id === spec.id && event.status !== 'cancelled' &&
    Object.entries(spec.tags).every(([k, v]) => event.extendedProperties?.private?.[k] === v) &&
    event.summary === spec.title && (event.location ?? '') === spec.location && !event.attendees?.length &&
    Date.parse(event.start?.dateTime ?? '') === Date.parse(spec.start) &&
    Date.parse(event.end?.dateTime ?? '') === Date.parse(spec.end);
}

export function calendarWriter(creds: GoogleCredentials, calendarId: string, fetchImpl: typeof fetch = fetch): CalendarWriter {
  const token = googleAccessToken(creds, fetchImpl);
  const root = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  async function request(method: string, path: string, body?: unknown, etag?: string) {
    try {
      return await fetchImpl(root + path, {
        method, headers: { authorization: `Bearer ${await token()}`, ...(body ? { 'content-type': 'application/json' } : {}),
          ...(etag ? { 'if-match': etag } : {}) }, body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new CalendarProviderError(null); }
  }
  return {
    calendarId,
    async get(id) {
      const r = await request('GET', '/' + encodeURIComponent(id));
      if ([404, 410].includes(r.status)) return null;
      if (!r.ok) throw new CalendarProviderError(r.status);
      const event = await r.json() as ProviderEvent;
      return event.status === 'cancelled' ? null : event;
    },
    async create(spec) {
      const r = await request('POST', '?sendUpdates=none', {
        id: spec.id, summary: spec.title, location: spec.location,
        start: { dateTime: spec.start, timeZone: 'Australia/Brisbane' },
        end: { dateTime: spec.end, timeZone: 'Australia/Brisbane' },
        extendedProperties: { private: spec.tags },
        description: 'Created by Moniqr after review. Manage its proposal in the Moniqr dashboard.',
        visibility: 'private', reminders: { useDefault: false },
      });
      if (!r.ok) throw new CalendarProviderError(r.status);
      try { return await r.json() as ProviderEvent; } catch { throw new CalendarProviderError(null); }
    },
    async remove(event) {
      if (!event.etag) throw new Error('Google supplied no event version; undo was not attempted.');
      const r = await request('DELETE', '/' + encodeURIComponent(event.id) + '?sendUpdates=none', undefined, event.etag);
      if (!r.ok && ![404, 410].includes(r.status)) throw new CalendarProviderError(r.status);
    },
  };
}

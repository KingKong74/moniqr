/**
 * Read-only Google Calendar access for the agent MCP server. Uses one OAuth refresh token
 * with the calendar.readonly scope and calls the REST API directly, so there is nothing in
 * here that could create, change or delete an event.
 */

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** All three variables or none. Half-configured is a mistake worth failing on. */
export function googleCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): GoogleCredentials | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_REFRESH_TOKEN;
  const set = [clientId, clientSecret, refreshToken].filter(Boolean).length;
  if (set === 0) return null;
  if (set !== 3) throw new Error('Set all of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN, or none');
  return { clientId: clientId!, clientSecret: clientSecret!, refreshToken: refreshToken! };
}

export interface CalendarSummary {
  id: string;
  name: string;
  primary: boolean;
}

export interface CalendarEvent {
  calendar: string;
  title: string;
  /** ISO date-time, or YYYY-MM-DD for all-day events. */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  /** Free text from the event. Untrusted. */
  description?: string;
  /** Bailey's own response, when he is an attendee. */
  response?: string;
}

const API = 'https://www.googleapis.com/calendar/v3';
const DESCRIPTION_LIMIT = 500;

export function googleCalendar(creds: GoogleCredentials, fetchImpl: typeof fetch = fetch) {
  let cached: { token: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !data.access_token) {
      throw new Error(`Google sign-in failed (${data.error ?? res.status}). The refresh token may need renewing.`);
    }
    cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return cached.token;
  }

  async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${await accessToken()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Google Calendar ${path} returned ${res.status}`);
    return (await res.json()) as T;
  }

  async function listCalendars(): Promise<CalendarSummary[]> {
    const data = await get<{ items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean; selected?: boolean }[] }>(
      '/users/me/calendarList',
    );
    return (data.items ?? []).map((c) => ({
      id: c.id,
      name: c.summaryOverride ?? c.summary ?? c.id,
      primary: Boolean(c.primary),
    }));
  }

  /** Events overlapping [timeMin, timeMax) across every calendar, soonest first. */
  async function listEvents(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    const calendars = await listCalendars();
    const perCalendar = await Promise.all(
      calendars.map(async (cal) => {
        const data = await get<{ items?: RawEvent[] }>(`/calendars/${encodeURIComponent(cal.id)}/events`, {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
          timeZone: 'Australia/Brisbane',
        });
        return (data.items ?? []).filter((e) => e.status !== 'cancelled').map((e) => toEvent(cal.name, e));
      }),
    );
    return perCalendar.flat().sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }

  return { listCalendars, listEvents };
}

interface RawEvent {
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

function toEvent(calendar: string, e: RawEvent): CalendarEvent {
  const allDay = !e.start?.dateTime;
  const description = e.description?.trim();
  const response = e.attendees?.find((a) => a.self)?.responseStatus;
  return {
    calendar,
    title: e.summary?.trim() || '(no title)',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    allDay,
    ...(e.location ? { location: e.location } : {}),
    ...(description
      ? { description: description.length > DESCRIPTION_LIMIT ? `${description.slice(0, DESCRIPTION_LIMIT)}…` : description }
      : {}),
    ...(response ? { response } : {}),
  };
}

// All-day events sort to the start of their day.
const sortKey = (e: CalendarEvent) => (e.allDay ? `${e.start}T00:00:00+10:00` : e.start);

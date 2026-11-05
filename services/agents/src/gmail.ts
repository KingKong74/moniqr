/**
 * Read-only Gmail access for the agent MCP server. Uses the gmail.readonly scope and only
 * ever sends GET requests, so there is nothing in here that could send, label or delete.
 * Everything returned is written by other people, so it is untrusted.
 */
import { googleAccessToken, type GoogleCredentials } from './google.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const BODY_LIMIT = 8_000;
export const MAX_SEARCH_RESULTS = 25;

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  /** Brisbane time, from when Gmail received it rather than the sender's Date header. */
  date: string;
  snippet: string;
  unread: boolean;
}

export interface Email extends EmailSummary {
  body: string;
  truncated: boolean;
  attachments: { name: string; type: string; bytes: number }[];
}

interface RawPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: RawPart[];
}

interface RawMessage {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: RawPart;
}

export function gmail(creds: GoogleCredentials, fetchImpl: typeof fetch = fetch) {
  const accessToken = googleAccessToken(creds, fetchImpl);

  async function get<T>(path: string, params: [string, string][]): Promise<T> {
    const url = new URL(API + path);
    url.search = new URLSearchParams(params).toString();
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${await accessToken()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 403) {
      throw new Error('Gmail refused access (403). The Google token may be missing gmail.readonly; run google-auth again.');
    }
    if (!res.ok) throw new Error(`Gmail ${path} returned ${res.status}`);
    return (await res.json()) as T;
  }

  /** Messages matching a Gmail search, newest first. Spam and trash are left out. */
  async function search(query: string, max = 15): Promise<EmailSummary[]> {
    const limit = Math.min(max, MAX_SEARCH_RESULTS);
    const list = await get<{ messages?: { id: string }[] }>('/messages', [
      ['q', query],
      ['maxResults', String(limit)],
    ]);
    return Promise.all(
      (list.messages ?? []).map(async ({ id }) =>
        toSummary(
          await get<RawMessage>(`/messages/${encodeURIComponent(id)}`, [
            ['format', 'metadata'],
            ['metadataHeaders', 'From'],
            ['metadataHeaders', 'To'],
            ['metadataHeaders', 'Subject'],
          ]),
        ),
      ),
    );
  }

  async function read(id: string): Promise<Email> {
    const raw = await get<RawMessage>(`/messages/${encodeURIComponent(id)}`, [['format', 'full']]);
    const text = raw.payload ? bodyText(raw.payload) : '';
    const truncated = text.length > BODY_LIMIT;
    return {
      ...toSummary(raw),
      body: truncated ? `${text.slice(0, BODY_LIMIT)}…` : text,
      truncated,
      attachments: raw.payload ? attachments(raw.payload) : [],
    };
  }

  return { search, read };
}

function toSummary(m: RawMessage): EmailSummary {
  const header = (name: string) =>
    m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value.trim() ?? '';
  return {
    id: m.id,
    threadId: m.threadId,
    from: header('from'),
    to: header('to'),
    subject: header('subject') || '(no subject)',
    date: brisbaneTime(Number(m.internalDate ?? 0)),
    snippet: decodeEntities(m.snippet ?? ''),
    unread: m.labelIds?.includes('UNREAD') ?? false,
  };
}

// Brisbane is UTC+10 all year, so a fixed offset is exact.
const brisbaneTime = (ms: number) =>
  new Date(ms + 10 * 3_600_000).toISOString().replace(/\.\d+Z$/, '+10:00');

/** Every part in the message, depth first. */
function* walk(part: RawPart): Generator<RawPart> {
  yield part;
  for (const child of part.parts ?? []) yield* walk(child);
}

const isAttachment = (p: RawPart) => Boolean(p.filename || p.body?.attachmentId);
const decoded = (p: RawPart) => Buffer.from(p.body?.data ?? '', 'base64url').toString('utf8');

/** The plain text part if it has any words in it, otherwise the HTML part as text. */
function bodyText(payload: RawPart): string {
  const parts = [...walk(payload)].filter((p) => !isAttachment(p) && p.body?.data);
  const plain = parts.find((p) => p.mimeType === 'text/plain');
  const text = plain ? decoded(plain).trim() : '';
  if (text) return text;
  const html = parts.find((p) => p.mimeType === 'text/html');
  return html ? htmlToText(decoded(html)) : '';
}

function attachments(payload: RawPart): Email['attachments'] {
  return [...walk(payload)]
    .filter(isAttachment)
    .map((p) => ({
      name: p.filename || '(unnamed)',
      type: p.mimeType ?? 'unknown',
      bytes: p.body?.size ?? 0,
    }));
}

export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)\s*>/gi, '\n')
    // Bills are mostly tables: without this, neighbouring cells merge into one figure.
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** One pass, so "&amp;lt;" becomes "&lt;" and not "<". */
function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi, (match, dec, hex, name) => {
    if (name) return NAMED[name.toLowerCase()] ?? match;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

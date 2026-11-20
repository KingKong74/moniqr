import type { Brief, RunSummary, CalendarData, FindingsData, ActionsData } from './agents.js';
import { LINKS } from './links.js';
import { escapeHtml as esc, renderMarkdown } from './markdown.js';
import { MOCK } from './mock.js';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Where the page's own scripts and styles are served: /v/<hash of their contents>/. Relative
 * imports inside the scripts inherit the prefix, so each deploy gets fresh URLs that no cache
 * (Cloudflare's or the browser's) has seen.
 */
const PUBLIC = new URL('../public/', import.meta.url);
export const ASSET_BASE = (() => {
  const hash = createHash('sha256');
  for (const f of readdirSync(PUBLIC).filter((f) => /\.(js|css)$/.test(f)).sort()) hash.update(f).update(readFileSync(new URL(f, PUBLIC)));
  return `/v/${hash.digest('hex').slice(0, 10)}`;
})();

const parts = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Brisbane',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "Mon 27 Oct, 6:30am" in Brisbane time. */
export function formatWhen(iso: string): string {
  const p = Object.fromEntries(parts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}${String(p.dayPeriod).toLowerCase()}`;
}

const KIND_LABELS: Record<string, string> = {
  morning_brief: 'Morning brief',
  afternoon_brief: 'Afternoon brief',
  weekly_lookahead: 'Weekly look-ahead',
  test: 'Plumbing test',
};
const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind;

export interface HqInput {
  email: string;
  brief: Brief | null;
  runs: RunSummary[];
  /** Set when the agent API couldn't be reached. */
  agentsError: boolean;
  calendar?: CalendarData;
  findings?: FindingsData;
  findingsError?: boolean;
  actions?: ActionsData;
  actionsError?: boolean;
}

/**
 * Everything the dashboard draws, as JSON for /api/hq. Briefs, calendar, findings, runs and links
 * are real; lifestyle cards are still samples. The brief's Markdown is rendered here so the
 * browser only ever receives escaped HTML.
 */
export function hqData(d: HqInput) {
  return {
    email: d.email,
    calendar: d.calendar ?? { status: 'disconnected', events: [] },
    findings: d.findings ?? { items: [], scan: null, total: 0 },
    findingsError: d.findingsError ?? false,
    actions: d.actions ?? { items: [], total: 0, pending: 0 },
    actionsError: d.actionsError ?? false,
    agentsError: d.agentsError,
    brief: d.brief && {
      kind: kindLabel(d.brief.kind),
      when: formatWhen(d.brief.created_at),
      at: d.brief.created_at,
      summary: d.brief.summary,
      html: renderMarkdown(d.brief.body_md),
    },
    runs: d.runs.map((r) => ({
      id: r.id,
      kind: kindLabel(r.kind),
      status: r.status,
      when: formatWhen(r.queued_at),
      error: r.error,
    })),
    busy: d.runs.some((r) => r.status === 'queued' || r.status === 'running'),
    links: LINKS,
    mock: { ...MOCK, mail: [], readMail: [] },
  };
}

export type HqData = ReturnType<typeof hqData>;

/** The page shell. /hq.js fetches /api/hq and draws everything inside #app. */
export function renderPage(email: string): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>moniqr</title>
  <link rel="icon" type="image/png" href="/assets/moniqr-icon-dark.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap">
  <link rel="stylesheet" href="${ASSET_BASE}/hq.css">
  <script type="module" src="${ASSET_BASE}/hq.js"></script>
</head>
<body>
  <div id="app"><p class="boot">Loading moniqr for ${esc(email)}…</p></div>
  <noscript><p class="boot">moniqr needs JavaScript.</p></noscript>
</body>
</html>`;
}

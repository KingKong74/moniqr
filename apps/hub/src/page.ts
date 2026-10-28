import type { Brief, RunSummary } from './agents.js';
import { LINKS } from './links.js';
import { escapeHtml as esc, renderMarkdown } from './markdown.js';
import { MOCK } from './mock.js';

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
}

/**
 * Everything the HQ page draws, as JSON for /api/hq. The brief, runs and links are real; the
 * rest is MOCK until the agent service stores it. The brief's Markdown is rendered here so the
 * browser only ever receives escaped HTML.
 */
export function hqData(d: HqInput) {
  return {
    email: d.email,
    agentsError: d.agentsError,
    brief: d.brief && {
      kind: kindLabel(d.brief.kind),
      when: formatWhen(d.brief.created_at),
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
    mock: MOCK,
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
  <title>moniqr · HQ</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;700&display=swap">
  <link rel="stylesheet" href="/hq.css">
  <script type="module" src="/hq.js"></script>
</head>
<body>
  <div id="app"><p class="boot">Loading HQ for ${esc(email)}…</p></div>
  <noscript><p class="boot">HQ needs JavaScript.</p></noscript>
</body>
</html>`;
}

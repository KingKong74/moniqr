import type { Brief, RunSummary } from './agents.js';
import { LINKS } from './links.js';
import { escapeHtml as esc, renderMarkdown } from './markdown.js';

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

export interface PageData {
  email: string;
  brief: Brief | null;
  runs: RunSummary[];
  /** Set when the agent API couldn't be reached. */
  agentsError: boolean;
}

function briefPanel(d: PageData): string {
  if (d.agentsError) return `<p class="muted">The agent service isn't reachable right now.</p>`;
  if (!d.brief) return `<p class="muted">No brief yet. Run the EA to write the first one.</p>`;
  return `<p class="meta">${esc(kindLabel(d.brief.kind))} · ${esc(formatWhen(d.brief.created_at))}</p>
      <div class="brief">${renderMarkdown(d.brief.body_md)}</div>`;
}

function runsPanel(d: PageData): string {
  if (d.agentsError || !d.runs.length) return `<p class="muted">No runs yet.</p>`;
  const rows = d.runs
    .map(
      (r) => `<li class="run">
          <span class="status ${esc(r.status)}">${esc(r.status)}</span>
          <span>${esc(kindLabel(r.kind))}</span>
          <span class="muted">${esc(formatWhen(r.queued_at))}</span>
          ${r.error ? `<span class="error">${esc(r.error)}</span>` : ''}
        </li>`,
    )
    .join('');
  return `<ul class="runs">${rows}</ul>`;
}

export function renderPage(d: PageData): string {
  // Refresh while a run is in flight so its result appears without a reload. No scripts needed.
  const busy = d.runs.some((r) => r.status === 'queued' || r.status === 'running');
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  ${busy ? '<meta http-equiv="refresh" content="15">' : ''}
  <title>moniqr</title>
  <link rel="stylesheet" href="/hub.css">
</head>
<body>
  <header>
    <h1>moniqr</h1>
    <span class="muted">${esc(d.email)}</span>
  </header>
  <main>
    <section>
      <h2>Today's brief</h2>
      ${briefPanel(d)}
    </section>
    <section>
      <h2>Executive Assistant</h2>
      <form method="post" action="/run" class="actions">
        <button name="kind" value="morning_brief"${busy ? ' disabled' : ''}>Run EA now</button>
        <button name="kind" value="test" class="secondary"${busy ? ' disabled' : ''}>Plumbing test</button>
      </form>
      ${runsPanel(d)}
    </section>
    <section>
      <h2>Projects</h2>
      <ul class="links">
        ${LINKS.map((l) => `<li><a href="${esc(l.url)}">${esc(l.name)}</a> <span class="muted">${esc(l.note)}</span></li>`).join('')}
      </ul>
    </section>
  </main>
</body>
</html>`;
}

export const STYLES = `
:root { --bg: #f6f5f2; --panel: #ffffff; --fg: #1c1b19; --muted: #6b6862; --line: #e4e2dc;
  --accent: #2f5d50; --ok: #2f7d4f; --bad: #b3261e; --wait: #8a6d1a; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #141413; --panel: #1d1d1b; --fg: #ecebe7; --muted: #9a978f; --line: #2e2d2a;
    --accent: #7fb8a6; --ok: #79c08f; --bad: #f2867e; --wait: #d9b85c; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header, main { max-width: 720px; margin: 0 auto; padding: 0 16px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding-top: 24px; flex-wrap: wrap; }
h1 { font-size: 1.75rem; letter-spacing: -0.03em; margin: 0; }
h2 { font-size: 1rem; margin: 0 0 12px; }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin: 16px 0; }
.muted, .meta { color: var(--muted); }
.meta { font-size: 0.875rem; margin: 0 0 8px; }
.brief h3 { font-size: 1rem; margin: 16px 0 4px; }
.brief h4 { font-size: 0.9375rem; margin: 12px 0 4px; }
.brief ul, .brief ol { padding-left: 20px; margin: 4px 0; }
.brief p { margin: 8px 0; }
code { font-size: 0.875em; background: var(--bg); padding: 1px 4px; border-radius: 4px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
button { font: inherit; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer;
  background: var(--accent); color: var(--bg); }
button.secondary { background: transparent; color: var(--fg); border: 1px solid var(--line); }
button:disabled { opacity: 0.5; cursor: default; }
ul.runs, ul.links { list-style: none; padding: 0; margin: 0; }
.run { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 8px 0; border-top: 1px solid var(--line); font-size: 0.9375rem; }
.status { font-size: 0.8125rem; font-weight: 600; min-width: 72px; }
.status.done { color: var(--ok); } .status.failed { color: var(--bad); }
.status.queued, .status.running { color: var(--wait); }
.error { flex-basis: 100%; color: var(--bad); font-size: 0.875rem; }
ul.links li { padding: 6px 0; }
a { color: var(--accent); }
`;

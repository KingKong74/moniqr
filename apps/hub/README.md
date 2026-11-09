# Hub

HQ, the homepage at the root of moniqr.com, built from the *Personal OS – HQ v4* design: brief carousel, today's key decision, priorities, news, mood, inbox with approvals, week calendar, habits, food, people, markets, projects and the Moniqr chat panel. All Moniqr-related apps live on subdomains (the budgeting app at finance.moniqr.com) behind the same login.

It is a thin client of the agent API. The Express server sends a page shell, `public/hq.js` and `public/hq.css`, and `/api/hq` with everything the page draws. The page is Preact + htm, served as one ES module from `node_modules` (`/vendor/preact-htm.js`), so there's no client build step. The agent API token stays on the server.

## Real and sample data

The latest brief, recent runs, *Run EA now*, project links, admin inbox findings and Google Calendar events are real. The calendar reads the current Brisbane week from the selected main calendar through the agent API and refreshes once per minute. The EA can still read the other connected calendars for briefs. Configure the Google read credentials as described in the root README; the calendar shows a disconnected or unavailable message when it cannot load. Calendar writing requires a separate API-only connection.

The Admin inbox replaces sample messages and approval controls with source-linked email findings. **Scan email** starts an EA morning-brief run. Review/dismiss/new decisions persist through the agent API and survive reloads and re-scans. The inbox shows the latest scan's completion state and the last successful scan separately, and retains findings when a scan fails. Lists are capped at 200 with new findings first; the UI reports when more exist.

Action review shows real persisted proposals, source evidence, missing details, expiry and decision history. Requests include the displayed revision, so a changed proposal requires another review. Manual/record-only decisions never execute. When Google writing is connected, a calendar proposal labelled **Creates an event after approval** creates one event after owner approval. Old record-only choices require explicit preparation and a fresh review. The UI shows confirmed, failed, uncertain and undone outcomes, with owner-only retry/check/undo controls. Findings and action decisions remain separate.

The calendar shows the owner-selected main calendar with a separate toggleable Moniqr request overlay. Clicking an overlay opens its proposal details. Undated/ambiguous requests stay in Action review. Overlapping confirmed events and requests use separate lanes. A successful write invalidates the calendar cache, and provider IDs prevent a request appearing twice when the real event arrives. Undo is limited to unchanged, tagged Moniqr-created events. See the root README for the separate calendar write connection; reads and overlays still work without it.

Lifestyle cards, the carousel and chat still come from `src/mock.ts`, and the page labels sample content. Priorities, mood, habits and chat only change page state and reset on reload. Nothing on the page books, buys or sends anything.

## Login

Cloudflare Access sits in front of moniqr.com and its subdomains and only lets in the emails in its policy. Traefik can also be reached directly, so the hub checks the `Cf-Access-Jwt-Assertion` token on every request too: signature, team, AUD tag and an email in `HUB_ALLOWED_EMAILS`. `/health` is the only open route. Run requests, finding decisions and action decisions accept only posts whose `Origin` is the hub itself. Scripts load only from the hub; the one third party is Google Fonts for Barlow.

## Local development

```sh
AGENTS_API_URL=http://localhost:8080 API_TOKEN=... HUB_DEV_EMAIL=you@example.com npm run dev -w apps/hub   # :3000
```

`HUB_DEV_EMAIL` skips Cloudflare Access and is refused when `NODE_ENV=production`. Set `HUB_ORIGIN=http://localhost:3000` too if you want *Run EA now* to work locally.

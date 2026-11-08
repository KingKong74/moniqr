# Hub

HQ, the homepage at the root of moniqr.com, built from the *Personal OS – HQ v4* design: brief carousel, today's key decision, priorities, news, mood, inbox with approvals, week calendar, habits, food, people, markets, projects and the Moniqr chat panel. All Moniqr-related apps live on subdomains (the budgeting app at finance.moniqr.com) behind the same login.

It is a thin client of the agent API. The Express server sends a page shell, `public/hq.js` and `public/hq.css`, and `/api/hq` with everything the page draws. The page is Preact + htm, served as one ES module from `node_modules` (`/vendor/preact-htm.js`), so there's no client build step. The agent API token stays on the server.

## Real and sample data

The latest brief, recent runs, *Run EA now*, project links, admin inbox findings and Google Calendar events are real. The calendar reads the current Brisbane week across your Google calendars through the agent API and refreshes once per minute. Configure all three Google credentials in the API environment as described in the root README; the calendar shows a disconnected or unavailable message when it cannot load. Calendar access is read-only.

The Admin inbox replaces sample messages and approval controls with source-linked email findings. **Scan email** starts an EA morning-brief run. Review/dismiss/new decisions persist through the agent API and survive reloads and re-scans. The inbox shows the latest scan's completion state and the last successful scan separately, and retains findings when a scan fails. Lists are capped at 200 with new findings first; the UI reports when more exist.

Action review shows real persisted proposals, source evidence, missing details, expiry and decision history. Approve/reject decisions survive reloads; they record a choice without executing or queueing an external action. The request includes the displayed revision, so a changed proposal requires another review. Calendar proposals show Brisbane times and the owner-configured destination; missing details block approval. Findings and action decisions remain separate.

Lifestyle cards, the carousel and chat still come from `src/mock.ts`, and the page labels sample content. Priorities, mood, habits and chat only change page state and reset on reload. Nothing on the page books, buys or sends anything.

## Login

Cloudflare Access sits in front of moniqr.com and its subdomains and only lets in the emails in its policy. Traefik can also be reached directly, so the hub checks the `Cf-Access-Jwt-Assertion` token on every request too: signature, team, AUD tag and an email in `HUB_ALLOWED_EMAILS`. `/health` is the only open route. Run requests, finding decisions and action decisions accept only posts whose `Origin` is the hub itself. Scripts load only from the hub; the one third party is Google Fonts for Barlow.

## Local development

```sh
AGENTS_API_URL=http://localhost:8080 API_TOKEN=... HUB_DEV_EMAIL=you@example.com npm run dev -w apps/hub   # :3000
```

`HUB_DEV_EMAIL` skips Cloudflare Access and is refused when `NODE_ENV=production`. Set `HUB_ORIGIN=http://localhost:3000` too if you want *Run EA now* to work locally.

# Hub

HQ, the homepage at the root of moniqr.com, built from the *Personal OS – HQ v4* design: brief carousel, today's key decision, priorities, news, mood, inbox with approvals, week calendar, habits, food, people, markets, projects and the Moniqr chat panel. All Moniqr-related apps live on subdomains (the budgeting app at finance.moniqr.com) behind their own login (Cloudflare Access for now).

It is a thin client of the agent API. The Express server sends a page shell, `public/hq.js` and `public/hq.css`, and `/api/hq` with everything the page draws. The page is Preact + htm, served as one ES module from `node_modules` (`/vendor/preact-htm.js`), so there's no client build step. The agent API token stays on the server.

## Real and sample data

The Projects and Finance sidebar buttons open dashboards inside HQ. Projects shows sample resume context, attention items, filterable project cards and recent activity inspired by Stack. Finance shows sample balances, cash flow, budgets, transactions and bills. Both dashboards are labelled as design previews; they do not fetch live Stack or Finance data. Explicit **Open Stack** and **Open Finance** links lead to the full apps.

When checking a live UI change, verify the running hub's assets after deployment. A successful push to `main` does not establish that Dokploy rebuilt the hub. The Google sign-in version requires the `HUB_GOOGLE_CLIENT_ID`, `HUB_GOOGLE_CLIENT_SECRET` and `HUB_SESSION_SECRET` settings before deployment; a hub still using Cloudflare Access must retain its existing authentication until that configuration is ready.

The latest brief, recent runs, *Run EA now*, project links, admin inbox findings and Google Calendar events are real. The calendar preserves the current Brisbane week across the connected Google calendars through the agent API and refreshes once per minute. Approved Moniqr additions go to the selected main calendar. Configure the Google read credentials as described in the root README; the calendar shows a disconnected or unavailable message when it cannot load. Calendar writing requires a separate API-only connection.

The Admin inbox replaces sample messages and approval controls with source-linked email findings. **Scan email** starts an EA morning-brief run. Review/dismiss/new decisions persist through the agent API and survive reloads and re-scans. The inbox shows the latest scan's completion state and the last successful scan separately, and retains findings when a scan fails. Lists are capped at 200 with new findings first; the UI reports when more exist.

Action review shows real persisted proposals, source evidence, missing details, expiry and decision history. Requests include the displayed revision, so a changed proposal requires another review. Manual/record-only decisions never execute. When Google writing is connected, a calendar proposal labelled **Creates an event after approval** creates one event after owner approval. Old record-only choices require explicit preparation and a fresh review. The UI shows confirmed, failed, uncertain and undone outcomes, with owner-only retry/check/undo controls. Findings and action decisions remain separate.

The calendar shows the owner-selected main calendar with a separate toggleable Moniqr request overlay. Clicking an overlay opens its proposal details. Undated/ambiguous requests stay in Action review. Requests span the full day column with a translucent background; confirmed events retain their normal layout beneath them. A successful write invalidates the calendar cache, and provider IDs prevent a request appearing twice when the real event arrives. Undo is limited to unchanged, tagged Moniqr-created events. See the root README for the separate calendar write connection; reads and overlays still work without it.

Lifestyle cards, the carousel and chat still come from `src/mock.ts`, and the page labels sample content. Priorities, mood, habits and chat only change page state and reset on reload. Nothing on the page books, buys or sends anything.

## Login

moniqr.com has its own sign-in page at `/login`: **Continue with Google** (OpenID Connect authorisation code flow with PKCE, state and nonce), asking Google only for `openid email`. The ID token's signature, issuer, client ID and nonce are checked, and the email must be verified and listed in `HUB_ALLOWED_EMAILS`. The hub then sets a 30-day `__Host-moniqr_session` cookie (HttpOnly, Secure, SameSite=Lax), signed with `HUB_SESSION_SECRET`. Every request re-checks the allow list, so removing an email locks it out, and rotating the secret signs everyone out. **Sign out** in the top bar clears the cookie.

Pages opened without a session redirect to `/login` and return to the same page after sign-in. Data requests get a 401, and HQ reloads to the login page. `/health`, `/login`, `/login.css` and the Google callback are the only open routes. Run requests, finding and action decisions, and sign-out accept only posts whose `Origin` is the hub itself. Scripts load only from the hub, the login page has no script, and the one third party is Google Fonts for Barlow.

Cloudflare Access no longer covers moniqr.com or www. It still protects the other subdomains, such as finance.moniqr.com, which don't use this login.

Google setup: in the Google Cloud project, create an OAuth client of type *Web application* with the authorised redirect URI `https://moniqr.com/login/google/callback`, then set `HUB_GOOGLE_CLIENT_ID` and `HUB_GOOGLE_CLIENT_SECRET` on the hub.

## Local development

```sh
AGENTS_API_URL=http://localhost:8080 API_TOKEN=... HUB_DEV_EMAIL=you@example.com npm run dev -w apps/hub   # :3000
```

`HUB_DEV_EMAIL` skips sign-in and is refused when `NODE_ENV=production`. Set `HUB_ORIGIN=http://localhost:3000` too if you want *Run EA now* to work locally.

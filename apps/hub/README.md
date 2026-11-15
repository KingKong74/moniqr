# Hub

The moniqr web app at the root of moniqr.com. It opens on **Home**, the landing page from the *Moniqr design system* project in Claude Design (`Landing Page.dc.html`), with **HQ**, Projects and Finance a tab away in the top bar.

## Home and themes

Home greets Bailey over an animated backdrop (silk night in dark mode, warm sunrise in light mode) with the energy orb (`public/energy-orb.js`, a canvas sphere you can drag to turn). Today's items orbit it: today's brief, today's Google Calendar events and dated Moniqr calendar requests, all live. Clicking an item shows its details, ←/→ step through them and the orb or *Read today's list* opens the day as a list. The brief and *Waiting on you* cards open the briefing and Action review in HQ. Home never approves anything; a request's **Review** button opens it in Action review.

The whole app follows the design system's colours: cream and paper with a peach action colour in light mode, indigo night with a violet action colour in dark mode, and an indigo sidebar in both. It starts from the device setting; clicking the moniqr logo (on Home or in the sidebar) switches, flipping the logo as the icons swap, and the choice is remembered in that browser. Moving between Home and another page animates (switching among the other pages is instant): going out from Home the new page expands as a circle from the top-left corner, and coming back to Home the page collapses into that corner (View Transitions API, where the browser supports it), then its sections rise into place one after another. Nothing animates with reduced motion.

Signed out, `/login` is Home in the design's locked state (`public/locked.js`): the same backdrop and orb, but the tabs read `****`, the cards and orb items are redacted bars, and every control opens the sign-in panel. It loads no data; the page's code, styles and icons are the only open files, and the app script (`hq.js`) and everything under `/api/` still need a session. Without JavaScript a plain sign-in card does the same job.

## HQ

HQ, the command centre, built from the *Personal OS – HQ v4* design: brief carousel, today's key decision, priorities, news, mood, inbox with approvals, week calendar, habits, food, people, markets, projects and the Moniqr chat panel. All Moniqr-related apps live on subdomains (the budgeting app at finance.moniqr.com) behind their own login (Cloudflare Access for now).

It is a thin client of the agent API. The Express server sends a page shell, `public/hq.js` and `public/hq.css`, and `/api/hq` with everything the page draws. The page is Preact + htm, served as one ES module from `node_modules` (`/vendor/preact-htm.js`), so there's no client build step. The agent API token stays on the server.

## Real and sample data

The Projects and Finance sidebar buttons open dashboards inside HQ. Projects shows sample resume context, attention items, filterable project cards and recent activity inspired by Stack. Finance shows sample balances, cash flow, budgets, transactions and bills. Both dashboards are labelled as design previews; they do not fetch live Stack or Finance data. Explicit **Open Stack** and **Open Finance** links lead to the full apps.

When checking a live UI change, verify the running hub's assets after deployment. A successful push to `main` does not establish that Dokploy rebuilt the hub. The hub needs `HUB_SESSION_SECRET`, `HUB_ALLOWED_EMAILS` and a sign-in method (`HUB_PASSCODE` and/or the `HUB_GOOGLE_*` pair) in Dokploy's environment, or it won't start.

The latest brief, recent runs, *Run EA now*, project links, admin inbox findings and Google Calendar events are real. The calendar preserves the current Brisbane week across the connected Google calendars through the agent API and refreshes once per minute. Approved Moniqr additions go to the selected main calendar. Configure the Google read credentials as described in the root README; the calendar shows a disconnected or unavailable message when it cannot load. Calendar writing requires a separate API-only connection.

The Admin inbox replaces sample messages and approval controls with source-linked email findings. **Scan email** starts an EA morning-brief run. Review/dismiss/new decisions persist through the agent API and survive reloads and re-scans. The inbox shows the latest scan's completion state and the last successful scan separately, and retains findings when a scan fails. Lists are capped at 200 with new findings first; the UI reports when more exist.

Action review shows real persisted proposals, source evidence, missing details, expiry and decision history. Requests include the displayed revision, so a changed proposal requires another review. Manual/record-only decisions never execute. When Google writing is connected, a calendar proposal labelled **Creates an event after approval** creates one event after owner approval. Old record-only choices require explicit preparation and a fresh review. The UI shows confirmed, failed, uncertain and undone outcomes, with owner-only retry/check/undo controls. Findings and action decisions remain separate.

The calendar shows the owner-selected main calendar with a separate toggleable Moniqr request overlay. Clicking an overlay opens its proposal details. Undated/ambiguous requests stay in Action review. Requests span the full day column with a translucent background; confirmed events retain their normal layout beneath them. A successful write invalidates the calendar cache, and provider IDs prevent a request appearing twice when the real event arrives. Undo is limited to unchanged, tagged Moniqr-created events. See the root README for the separate calendar write connection; reads and overlays still work without it.

Lifestyle cards, the carousel and chat still come from `src/mock.ts`, and the page labels sample content. Chat opens from a small bottom-right button as a floating window; it starts closed and can be dismissed with Close, the launcher or Escape. Priorities, mood, habits and sample chat only change page state and reset on reload. Nothing on the page books, buys or sends anything.

## Login

moniqr.com has its own sign-in page at `/login`, with no Cloudflare Access in front of it.

**Security code** (`HUB_PASSCODE`): a plain form, no script. A correct code signs in as the first email in `HUB_ALLOWED_EMAILS`. Codes are compared as HMACs in constant time. Wrong codes are limited to 5 per client per 15 minutes and 20 across everyone per hour; past either limit the code is refused, even when it's right, until the window passes. Client addresses come from Cloudflare's `CF-Connecting-IP` and can be forged by anyone who reaches Traefik directly, so the site-wide limit is what really caps guessing. The counters live in memory and reset when the hub restarts. Change the code in Dokploy's environment and redeploy.

**Continue with Google** (optional, when `HUB_GOOGLE_CLIENT_ID` and `HUB_GOOGLE_CLIENT_SECRET` are set): OpenID Connect authorisation code flow with PKCE, state and nonce, asking Google only for `openid email`. The ID token's signature, issuer, client ID and nonce are checked, and the email must be verified and listed in `HUB_ALLOWED_EMAILS`. Google setup: create an OAuth client of type *Web application* with the authorised redirect URI `https://moniqr.com/login/google/callback`.

Either way the hub sets a 30-day `__Host-moniqr_session` cookie (HttpOnly, Secure, SameSite=Lax), signed with `HUB_SESSION_SECRET`. Every request re-checks the allow list, so removing an email locks it out, and rotating the secret signs everyone out. **Sign out** in the top bar clears the cookie.

Pages opened without a session redirect to `/login` and return to the same page after sign-in. Data requests get a 401, and HQ reloads to the login page. `/health`, `/login`, `/login.css`, the signed-out page's files (`locked.js`, `home.js`, `theme.js`, `energy-orb.js`, `calendar-overlay.js`, `hq.css`, Preact and the brand icons) and the Google callback are the only open routes. The security code, run requests, finding and action decisions, and sign-out accept only posts whose `Origin` is the hub itself. Scripts and images load only from the hub, nothing runs inline, and the one third party is Google Fonts for Barlow.

Cloudflare Access doesn't cover moniqr.com or www. It still protects the other subdomains, such as finance.moniqr.com, which don't use this login.

## Local development

```sh
AGENTS_API_URL=http://localhost:8080 API_TOKEN=... HUB_DEV_EMAIL=you@example.com npm run dev -w apps/hub   # :3000
```

`HUB_DEV_EMAIL` skips sign-in and is refused when `NODE_ENV=production`. Set `HUB_ORIGIN=http://localhost:3000` too if you want *Run EA now* to work locally.

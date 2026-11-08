# moniqr

Everything that runs on moniqr.com.

| Path | What it is | Status |
| --- | --- | --- |
| `services/agents` | Agent service: API, scheduler, runner and MCP server. Runs the Executive Assistant now and the rest of the agent hierarchy later. | Phase 1 |
| `agents/ea` | The Executive Assistant's instructions (`CLAUDE.md`). The runner supplies these instructions to Codex. | Phase 1 |
| `apps/hub` | The hub and EA homepage at the root of moniqr.com, behind Cloudflare Access. | Phase 2 |
| `apps/finance` | The budgeting app, moving to finance.moniqr.com. | Later |

The design spec lives in Claude Docs: "Executive Assistant — Design Spec".

## How a run works

1. Something queues a run: a schedule, `POST /agents/ea/run` (the hub's *Run EA now*), or an instruction sent to the inbox.
2. The runner claims the run from the agent API and receives a one-off run token.
3. The runner starts Codex headless in `agents/ea`, with built-in tools switched off and only the agent MCP server available.
4. The EA writes its output through MCP tools (`write_brief` in phase 1). The MCP server calls the agent API with the run token, so the runner never holds database credentials.
5. The runner marks the run done or failed.

## Local development

Requires Node 22 and Postgres 16.

```sh
npm install
cp .env.example .env            # fill in DATABASE_URL and the two tokens
npm run migrate -w services/agents
npm run dev -w services/agents      # API and scheduler on :8080
npm run runner -w services/agents   # runner loop, needs `codex` on PATH and CODEX_MODEL_CATALOG pointing to a restricted catalog
```

Queue a test run:

```sh
curl -X POST localhost:8080/agents/ea/run -H "Authorization: Bearer $API_TOKEN"
```

Tests need a Postgres they can create and drop databases on. Each test file gets its own throwaway database; without `TEST_DATABASE_URL` the database tests are skipped.

```sh
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
```

The runner tests use stand-ins for Codex in `services/agents/test/fixtures`, so they need no Codex login and cost nothing.

## First real run

After deploying, open moniqr.com and press *Plumbing test*. The page refreshes until the run finishes, then shows the test brief. The runner's logs in Dokploy show what Codex did.

Both schedules ship disabled. Switch one on (or change its time) from the agent API, for example the 6:30am morning brief:

```sh
curl -X PATCH .../schedules/1 -H "Authorization: Bearer $API_TOKEN" -H 'content-type: application/json' -d '{"enabled":true}'
```

## Google Calendar and Gmail

The EA reads calendars and email with one refresh token limited to `calendar.readonly` and `gmail.readonly`. The dashboard shows the current week in Brisbane time, with read-only events refreshed once per minute. The token is configured in the API and runner environments and is passed to the agent MCP server, never to the Codex model process itself.

1. In Google Cloud, create a project, enable the Google Calendar and Gmail APIs, set up the OAuth consent screen and **publish it to production** (in Testing, refresh tokens expire after 7 days). Then create an OAuth client of type *Desktop app*.
2. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `~/.config/moniqr/ops.env`, then run `npm run google-auth -w services/agents` and follow the link. It saves `GOOGLE_REFRESH_TOKEN` to the same file without printing it.
3. Copy all three into the Dokploy environment and redeploy.

Gmail is a restricted scope, so Google shows an "unverified app" warning at consent. That is expected for a personal client: choose Advanced, then continue. Leave both permission boxes ticked; `google-auth` refuses a token that doesn't hold exactly these two scopes.

## Admin inbox

Morning briefs and weekly look-aheads can save email findings: bills/deadlines, commitments and messages needing a reply. The `save_email_finding` MCP tool accepts only messages read in that run, and its evidence and date/time wording must quote the message body. Sender, subject, received time and source identity come from the broker's Gmail read, not model-supplied metadata. Dates remain as source wording; ambiguous or missing details stay visible rather than becoming inferred calendar dates.

Findings live in Postgres, deduplicated by message and category. Re-scanning updates their content while preserving your reviewed/dismissed state. The hub's **Admin inbox** shows the source, evidence and scan status, and **Scan email** queues a morning-brief run. A scan's coverage is bounded by the existing Gmail searches and result limits; it is not a complete mailbox audit. Partial and failed scans retain existing findings, and a run that never searched email does not count as a successful scan.

This is the first daily-admin slice: findings are notes, not executable approvals. Reviewing or dismissing one changes Moniqr only. Calendar creation, payments, sending email and attachment downloads are not implemented here. The new migration runs on API startup, as existing migrations do.

## Deploying on Dokploy

`docker-compose.yml` defines four services: `postgres`, `agents-api`, `agents-runner` and `hub`. Create a Compose app in Dokploy pointing at this repo, set the variables from `.env.example`, and deploy. Only `hub` gets domains (`moniqr.com` and `www.moniqr.com`); `agents-api` stays on the compose network.

## Codex runner login

The EA runs with the pinned Codex CLI using your ChatGPT login. Put compact JSON from
`~/.codex/auth.json` into Dokploy's `CODEX_AUTH_JSON` secret environment value. The runner
seeds its dedicated `agents-codex` volume only if no login exists; Codex refreshes that
cached login in place. Do not put the auth cache in Git or paste it into chat.
`CODEX_MODEL` optionally chooses a model; blank uses the CLI default. ChatGPT/Codex usage
limits still apply.

The image generates a restricted model catalog from its pinned CLI: shell execution,
file edits and experimental tools are removed. Web, image, browser, apps, plugins and
subagents are disabled too. Each run starts in an empty temporary directory with the EA
instructions supplied explicitly. Only the agent MCP server is configured; Google and
per-run API credentials stay in its private configuration, removed after the run.

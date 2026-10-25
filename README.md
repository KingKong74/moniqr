# moniqr

Everything that runs on moniqr.com.

| Path | What it is | Status |
| --- | --- | --- |
| `services/agents` | Agent service: API, scheduler, runner and MCP server. Runs the Executive Assistant now and the rest of the agent hierarchy later. | Phase 1 |
| `agents/ea` | The Executive Assistant's instructions (`CLAUDE.md`). The runner starts Claude Code in this folder. | Phase 1 |
| `apps/hub` | The hub and EA homepage at the root of moniqr.com, behind Cloudflare Access. | Phase 2 |
| `apps/finance` | The budgeting app, moving to finance.moniqr.com. | Later |

The design spec lives in Claude Docs: "Executive Assistant — Design Spec".

## How a run works

1. Something queues a run: a schedule, `POST /agents/ea/run` (the hub's *Run EA now*), or an instruction sent to the inbox.
2. The runner claims the run from the agent API and receives a one-off run token.
3. The runner starts Claude Code headless in `agents/ea`, with built-in tools switched off and only the agent MCP server available.
4. The EA writes its output through MCP tools (`write_brief` in phase 1). The MCP server calls the agent API with the run token, so the runner never holds database credentials.
5. The runner marks the run done or failed.

## Local development

Requires Node 22 and Postgres 16.

```sh
npm install
cp .env.example .env            # fill in DATABASE_URL and the two tokens
npm run migrate -w services/agents
npm run dev -w services/agents      # API and scheduler on :8080
npm run runner -w services/agents   # runner loop, needs `claude` on PATH
```

Queue a test run:

```sh
curl -X POST localhost:8080/agents/ea/run -H "Authorization: Bearer $API_TOKEN"
```

Tests need a Postgres they can create and drop databases on. Each test file gets its own throwaway database; without `TEST_DATABASE_URL` the database tests are skipped.

```sh
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
```

The runner tests use stand-ins for Claude Code in `services/agents/test/fixtures`, so they need no Claude login and cost nothing.

## First real run

After deploying, open moniqr.com and press *Plumbing test*. The page refreshes until the run finishes, then shows the test brief. The runner's logs in Dokploy show what Claude Code did.

Both schedules ship disabled. Switch one on (or change its time) from the agent API, for example the 6:30am morning brief:

```sh
curl -X PATCH .../schedules/1 -H "Authorization: Bearer $API_TOKEN" -H 'content-type: application/json' -d '{"enabled":true}'
```

## Google Calendar

The EA reads calendars with one refresh token limited to `calendar.readonly`. The token stays in the runner's environment and is passed only to the agent MCP server, never to Claude Code itself.

1. In Google Cloud, create a project, enable the Google Calendar API, set up the OAuth consent screen and **publish it to production** (in Testing, refresh tokens expire after 7 days). Then create an OAuth client of type *Desktop app*.
2. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `~/.config/moniqr/ops.env`, then run `npm run google-auth -w services/agents` and follow the link. It saves `GOOGLE_REFRESH_TOKEN` to the same file without printing it.
3. Copy all three into the Dokploy environment and redeploy.

## Deploying on Dokploy

`docker-compose.yml` defines four services: `postgres`, `agents-api`, `agents-runner` and `hub`. Create a Compose app in Dokploy pointing at this repo, set the variables from `.env.example`, and deploy. Only `hub` gets domains (`moniqr.com` and `www.moniqr.com`); `agents-api` stays on the compose network.

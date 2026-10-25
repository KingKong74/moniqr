# Working on the moniqr repo

## Conventions

- en-AU spelling everywhere, in code comments, docs and UI copy.
- Secrets load from the environment at runtime. Nothing secret is ever committed; `.env.example` lists every variable with a placeholder.
- TypeScript, ES modules, Node 22. No framework beyond Express for HTTP.
- Each folder under `services/` and `apps/` is an npm workspace with its own `typecheck` and `test` scripts.
- Database changes are new numbered files in `services/agents/migrations/`. Never edit a migration that has shipped.

## Agent service rules (do not weaken without asking Bailey)

- The EA has no outward tools. Claude Code runs with built-in tools switched off and only the agent MCP server loaded.
- Every write an agent makes goes through an MCP tool, which calls the agent API with a per-run token. The runner has no database credentials.
- Google access, when added, uses read-only scopes. Anything that sends, pays, books or deletes becomes an approval for Bailey instead.
- Notifications go only to fixed recipients set in the environment, never to addresses an agent chooses.

## Layout

- `services/agents/src/api` — Express app and routes
- `services/agents/src/scheduler.ts` — queues runs when schedules are due
- `services/agents/src/runner` — claims runs and starts Claude Code
- `services/agents/src/mcp` — the agent MCP server
- `agents/<slug>/CLAUDE.md` — each agent's instructions

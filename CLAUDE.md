# Working on the moniqr repo

## Delivery

Follow [AGENTS.md](AGENTS.md): completed changes must be committed, pushed and merged into `main` by default, with remote delivery verified before reporting completion. Do not leave finished work only locally unless Bailey explicitly asks.

## Conventions

- en-AU spelling everywhere, in code comments, docs and UI copy.
- Secrets load from the environment at runtime. Nothing secret is ever committed; `.env.example` lists every variable with a placeholder.
- TypeScript, ES modules, Node 22. No framework beyond Express for HTTP.
- Each folder under `services/` and `apps/` is an npm workspace with its own `typecheck` and `test` scripts.
- Database changes are new numbered files in `services/agents/migrations/`. Never edit a migration that has shipped.

## Agent service rules (do not weaken without asking Bailey)

- The EA has no outward tools. Codex runs with native execution and file-edit tools disabled and only the agent MCP server loaded.
- Every write an agent makes goes through an MCP tool, which calls the agent API with a per-run token. The runner has no database credentials.
- Google access is read-only, with one exception Bailey approved on 2026-11-01: the EA may add calendar events. That tool only creates events. It never edits or deletes, and it writes only to the calendar named in the environment. An event goes straight in only when it matches the auto-add rules Bailey sets in the environment (sender and kind). Everything else becomes a pending approval, and the EA can never change those rules. Events it adds are tagged as moniqr's, so the hub can undo them. Anything else that sends, pays, books or deletes becomes an approval for Bailey.
- Notifications go only to fixed recipients set in the environment, never to addresses an agent chooses.

## Layout

- `services/agents/src/api` — Express app and routes
- `services/agents/src/scheduler.ts` — queues runs when schedules are due
- `services/agents/src/runner` — claims runs and starts Claude Code
- `services/agents/src/mcp` — the agent MCP server
- `agents/<slug>/CLAUDE.md` — each agent's instructions

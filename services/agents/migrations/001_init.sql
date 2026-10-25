-- Agent service schema, phase 1.
-- The EA is the first row in agents; later managers and workers are new rows, not new tables.

CREATE TABLE agents (
  id                serial PRIMARY KEY,
  slug              text NOT NULL UNIQUE,
  name              text NOT NULL,
  role              text NOT NULL CHECK (role IN ('ea', 'executive', 'partner', 'manager', 'worker')),
  parent_id         integer REFERENCES agents(id),
  instructions_path text NOT NULL,
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schedules (
  id           serial PRIMARY KEY,
  agent_id     integer NOT NULL REFERENCES agents(id),
  kind         text NOT NULL,
  cron         text NOT NULL,
  timezone     text NOT NULL DEFAULT 'Australia/Brisbane',
  enabled      boolean NOT NULL DEFAULT false,
  next_run_at  timestamptz,
  last_run_at  timestamptz,
  UNIQUE (agent_id, kind)
);

CREATE TABLE runs (
  id              serial PRIMARY KEY,
  agent_id        integer NOT NULL REFERENCES agents(id),
  trigger         text NOT NULL CHECK (trigger IN ('schedule', 'manual', 'inbox')),
  kind            text NOT NULL,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  schedule_id     integer REFERENCES schedules(id),
  -- sha256 of the one-off token the runner hands to the MCP server; cleared when the run ends
  run_token_hash  text,
  queued_at       timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  duration_ms     integer,
  error           text,
  result          jsonb
);
CREATE INDEX runs_queue_idx ON runs (queued_at) WHERE status = 'queued';
CREATE INDEX runs_agent_idx ON runs (agent_id, queued_at DESC);

CREATE TABLE reports (
  id          serial PRIMARY KEY,
  agent_id    integer NOT NULL REFERENCES agents(id),
  run_id      integer NOT NULL REFERENCES runs(id),
  domain      text NOT NULL,
  period      text,
  body_md     text NOT NULL,
  data        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE briefs (
  id          serial PRIMARY KEY,
  run_id      integer NOT NULL REFERENCES runs(id),
  kind        text NOT NULL,
  body_md     text NOT NULL,
  summary     text NOT NULL,
  delivered   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX briefs_created_idx ON briefs (created_at DESC);

CREATE TABLE approvals (
  id               serial PRIMARY KEY,
  run_id           integer NOT NULL REFERENCES runs(id),
  title            text NOT NULL,
  detail           text NOT NULL,
  proposed_action  jsonb,
  risk             text NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'medium', 'high')),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz
);

CREATE TABLE inbox (
  id          serial PRIMARY KEY,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled')),
  run_id      integer REFERENCES runs(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notes (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The EA and its two schedules. Schedules start disabled: the morning brief is
-- switched on in phase 3 once calendar tools exist, the look-ahead in phase 6.
INSERT INTO agents (slug, name, role, instructions_path)
VALUES ('ea', 'Executive Assistant', 'ea', 'agents/ea/CLAUDE.md');

INSERT INTO schedules (agent_id, kind, cron)
SELECT id, 'morning_brief', '30 6 * * *' FROM agents WHERE slug = 'ea'
UNION ALL
SELECT id, 'weekly_lookahead', '0 19 * * 0' FROM agents WHERE slug = 'ea';

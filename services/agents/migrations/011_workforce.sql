-- The workforce: agents Bailey creates in the hub that work for the EA.
-- A worker's instructions live in the database, so the hub can create and edit agents
-- without a deploy. Its tools are a per-agent tick list from a fixed read-only set; the
-- API and the runner both refuse anything else. A worker's only write is its report.

ALTER TABLE agents
  ADD COLUMN description       text NOT NULL DEFAULT '',
  ADD COLUMN instructions_md   text,
  ADD COLUMN tools             text[] NOT NULL DEFAULT '{}',
  ADD COLUMN updated_at        timestamptz NOT NULL DEFAULT now(),
  ALTER COLUMN instructions_path DROP NOT NULL,
  ADD CONSTRAINT agents_instructions_present CHECK (instructions_path IS NOT NULL OR instructions_md IS NOT NULL);

-- The EA hands a worker a task: a run of kind 'task' whose input holds the task text.
ALTER TABLE runs DROP CONSTRAINT runs_trigger_check;
ALTER TABLE runs ADD CONSTRAINT runs_trigger_check CHECK (trigger IN ('schedule', 'manual', 'inbox', 'delegated'));
ALTER TABLE runs ADD COLUMN parent_run_id integer REFERENCES runs(id);
CREATE INDEX runs_parent_idx ON runs (parent_run_id) WHERE parent_run_id IS NOT NULL;

CREATE INDEX reports_agent_idx ON reports (agent_id, created_at DESC);

-- Changes the EA asks for. Nothing about an agent changes until Bailey approves.
CREATE TABLE agent_changes (
  id           serial PRIMARY KEY,
  run_id       integer NOT NULL REFERENCES runs(id),
  agent_id     integer REFERENCES agents(id),
  kind         text NOT NULL CHECK (kind IN ('create', 'update', 'pause', 'resume')),
  change       jsonb NOT NULL,
  reason       text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  -- A create has no agent until Bailey approves it; then it points at the new agent.
  CHECK (kind = 'create' OR agent_id IS NOT NULL)
);
CREATE INDEX agent_changes_pending_idx ON agent_changes (created_at) WHERE status = 'pending';

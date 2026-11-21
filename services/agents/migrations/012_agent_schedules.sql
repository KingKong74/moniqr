-- Standing tasks: a worker runs on its own schedule. Each schedule carries the task text it
-- hands the worker, and an agent can have several. The EA's brief schedules stay one per kind.
ALTER TABLE schedules ADD COLUMN task text;
ALTER TABLE schedules ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE schedules DROP CONSTRAINT schedules_agent_id_kind_key;
CREATE UNIQUE INDEX schedules_agent_kind_idx ON schedules (agent_id, kind) WHERE kind <> 'task';
ALTER TABLE schedules ADD CONSTRAINT schedules_task_present CHECK ((kind = 'task') = (task IS NOT NULL));

-- The EA may ask Bailey to add a schedule to an agent, like any other change.
ALTER TABLE agent_changes DROP CONSTRAINT agent_changes_kind_check;
ALTER TABLE agent_changes ADD CONSTRAINT agent_changes_kind_check CHECK (kind IN ('create', 'update', 'pause', 'resume', 'schedule'));

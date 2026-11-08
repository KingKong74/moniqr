-- Reuse approvals: a human decision and provider execution are separate facts.
ALTER TABLE approvals
  ADD COLUMN finding_id integer REFERENCES email_findings(id),
  ADD COLUMN kind text NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'calendar_create')),
  ADD COLUMN source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN payload_hash text NOT NULL DEFAULT '',
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN execution_status text NOT NULL DEFAULT 'not_requested'
    CHECK (execution_status IN ('not_requested', 'queued', 'executing', 'succeeded', 'failed', 'uncertain')),
  ADD COLUMN execution_mode text NOT NULL DEFAULT 'record_only' CHECK (execution_mode IN ('record_only', 'enabled'));

CREATE UNIQUE INDEX approvals_finding_kind_idx ON approvals(finding_id, kind);
CREATE INDEX approvals_pending_idx ON approvals(expires_at, id) WHERE status = 'pending';

-- Snapshots preserve what was proposed/approved even when a later scan revises it.
CREATE TABLE approval_events (
  id serial PRIMARY KEY,
  approval_id integer NOT NULL REFERENCES approvals(id),
  revision integer NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('proposed', 'revised', 'approved', 'rejected', 'expired')),
  actor text NOT NULL CHECK (actor IN ('ea', 'owner', 'system')),
  run_id integer REFERENCES runs(id),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approval_events_action_idx ON approval_events(approval_id, id);

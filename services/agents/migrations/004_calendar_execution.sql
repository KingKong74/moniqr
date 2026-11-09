ALTER TABLE approvals
  ADD COLUMN calendar_event_id text,
  ADD COLUMN calendar_target_id text,
  ADD COLUMN execution_error text,
  ADD COLUMN executed_at timestamptz;
ALTER TABLE approvals DROP CONSTRAINT approvals_execution_status_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_execution_status_check
  CHECK (execution_status IN ('not_requested','queued','executing','succeeded','failed','uncertain','undone','undo_uncertain'));
ALTER TABLE approval_events DROP CONSTRAINT approval_events_event_type_check;
ALTER TABLE approval_events ADD CONSTRAINT approval_events_event_type_check
  CHECK (event_type IN ('proposed','revised','approved','rejected','expired','enabled_for_review',
    'execution_started','succeeded','failed','uncertain','undo_started','undone','undo_uncertain'));

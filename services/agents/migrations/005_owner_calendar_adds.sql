-- Bailey can add a finding to the calendar straight from the inbox. Those rows have no EA run.
ALTER TABLE approvals ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE approvals ADD COLUMN origin text NOT NULL DEFAULT 'ea' CHECK (origin IN ('ea', 'owner'));
ALTER TABLE approval_events DROP CONSTRAINT approval_events_event_type_check;
ALTER TABLE approval_events ADD CONSTRAINT approval_events_event_type_check
  CHECK (event_type IN ('proposed','revised','approved','rejected','expired','enabled_for_review','owner_added',
    'execution_started','succeeded','failed','uncertain','undo_started','undone','undo_uncertain'));

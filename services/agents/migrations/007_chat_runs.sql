-- The moniqr console: Bailey's chat messages travel to the runner as a run's input.
-- A chat run is read-only. It writes no brief, findings or proposals; its reply is the run result.
ALTER TABLE runs ADD COLUMN input jsonb;

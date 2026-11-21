-- The morning brief's daily pick for the dashboard: a quote, small challenge, word of the day,
-- question and fact, as [{ kind, text, sub }].
ALTER TABLE briefs ADD COLUMN daily_pick jsonb;

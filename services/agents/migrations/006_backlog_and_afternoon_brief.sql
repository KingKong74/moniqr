-- Owner-managed capture list. The EA may read it as context; it cannot edit it.
CREATE TABLE backlog_items (
  id serial PRIMARY KEY,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 10000),
  status text NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'next', 'doing', 'done')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO backlog_items (title, notes)
VALUES ('Connect the Moniqr chatbot', 'Connect the current sample chat to the EA. Plan the conversation history, tools and approval boundaries before implementation. Saved for later; do not implement automatically.');
UPDATE schedules SET cron='0 7 * * *', enabled=true, next_run_at=NULL
WHERE kind='morning_brief' AND agent_id=(SELECT id FROM agents WHERE slug='ea');
INSERT INTO schedules (agent_id, kind, cron, timezone, enabled)
SELECT id, 'afternoon_brief', '30 16 * * *', 'Australia/Brisbane', true FROM agents WHERE slug='ea';

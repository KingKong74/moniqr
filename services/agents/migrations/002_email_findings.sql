-- One finding per message/category. Re-scanning never resets the owner's decision.
CREATE TABLE email_findings (
  id serial PRIMARY KEY,
  message_id text NOT NULL,
  thread_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('bill', 'commitment', 'reply')),
  sender text NOT NULL,
  subject text NOT NULL,
  received_at timestamptz NOT NULL,
  summary text NOT NULL,
  evidence text NOT NULL,
  deadline_text text NOT NULL DEFAULT '',
  missing_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'dismissed')),
  first_run_id integer NOT NULL REFERENCES runs(id),
  last_run_id integer NOT NULL REFERENCES runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (message_id, category)
);
CREATE INDEX email_findings_status_idx ON email_findings (status, received_at DESC, id DESC);

-- Written by the MCP broker from observed Gmail calls, never inferred from brief text.
CREATE TABLE email_scans (
  run_id integer PRIMARY KEY REFERENCES runs(id),
  status text NOT NULL CHECK (status IN ('scanning', 'completed', 'partial', 'failed')),
  searches integer NOT NULL CHECK (searches >= 0),
  messages_read integer NOT NULL CHECK (messages_read >= 0),
  failures integer NOT NULL CHECK (failures >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

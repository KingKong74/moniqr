-- Bailey's "How are you feeling?" check-ins. Owner-written only; the EA may read recent ones as context.
CREATE TABLE checkins (
  id serial PRIMARY KEY,
  mood smallint NOT NULL CHECK (mood BETWEEN 0 AND 4),
  energy smallint CHECK (energy BETWEEN 0 AND 4),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checkins_created_at ON checkins (created_at DESC);

-- Backlog items can be broken into steps and ordered by hand ("show on top", "send to bottom").
-- position orders items within a status; lower comes first.
ALTER TABLE backlog_items
  ADD COLUMN steps jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 50),
  ADD COLUMN position double precision;
UPDATE backlog_items b SET position = o.n FROM (
  SELECT id, row_number() OVER (ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at DESC, id DESC) AS n
  FROM backlog_items) o WHERE o.id = b.id;
ALTER TABLE backlog_items ALTER COLUMN position SET NOT NULL;

-- Level 3 of docs/workforce-permissions.md: agents propose outward actions that Bailey carries
-- out himself. An email reply is a draft he sends; a purchase is a prepared cart he buys.
-- Neither has an executor, so approving one records his decision and nothing else.
ALTER TABLE approvals DROP CONSTRAINT approvals_kind_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_check CHECK (kind IN ('manual', 'calendar_create', 'email_reply', 'purchase'));
ALTER TABLE approvals DROP CONSTRAINT approvals_origin_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_origin_check CHECK (origin IN ('ea', 'owner', 'agent'));
-- Which agent proposed it, so the Inbox can say "Proposed by Bills Clerk".
ALTER TABLE approvals ADD COLUMN agent_id integer REFERENCES agents(id);
ALTER TABLE approval_events DROP CONSTRAINT approval_events_actor_check;
ALTER TABLE approval_events ADD CONSTRAINT approval_events_actor_check CHECK (actor IN ('ea', 'owner', 'system', 'agent'));

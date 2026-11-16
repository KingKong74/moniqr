# Moniqr: next implementation steps

This is a proposed roadmap, not authorisation for the EA to carry out tasks. Only the chatbot connection has been added to the personal backlog automatically.

## Delivered foundation

- Owner-managed personal backlog: capture titles and notes, set priority, move between Backlog, Next, Doing and Done, and retain completed items.
- Briefs at 7:00am and 4:30pm Brisbane time. Settings can change or pause either slot; changes apply to future runs.
- Open backlog items are available to the EA through its existing bounded daily-admin context. The EA may suggest priorities; it cannot change the backlog.

## Suggested order

| Order | Work | Why | Implementation and completion criteria |
| --- | --- | --- | --- |
| 1 | Connection health and recovery | Calendar writes recently failed with an invalid Google grant, hidden behind a generic message. | Track separate read and write credential health without exposing secrets. Show last successful checks, explain expired/revoked credentials, and add an owner-only reconnect flow. Preserve login and runner isolation. Done when a revoked write token produces a clear recovery action and reconnect survives redeployment. |
| 2 | Brief history and delivery reliability | A twice daily brief needs a visible record of whether it ran and what changed. | Add morning/afternoon history, last success, next due, failure details and an owner-triggered retry. Link findings and confirmed outcomes to the source. Decide a fixed notification channel before adding delivery; keep recipients configured by the owner. Done when missed/failed runs are visible and retry cannot duplicate external actions. |
| 3 | EA-assisted backlog triage | Capture is useful; the next step is turning a long list into a manageable shortlist. | Add optional area, due date, effort and project links. Have the EA produce a separate suggested triage with rationale and duplicate candidates. Apply changes only after owner review, with item versions and an audit trail. Done when Bailey can accept selected suggestions without overwriting intervening edits. |
| 4 | Connect the Moniqr chatbot | The current chat is a sample; a real conversation should retain context and respect approvals. | Persist owner-scoped conversations and messages. Queue chat runs through the existing broker; expose run state and a saved reply. Start with read tools plus explicit local proposals; keep outward sends, booking and deletion behind the existing approval rules. Bound context, usage and timeouts. Done when a conversation survives refresh and a requested external action becomes a reviewable proposal rather than executing. This task is already in the backlog. |
| 5 | Weekly planning and project links | Backlog items, calendar availability and project status should form one realistic plan. | Group tasks into projects; show commitments and available time together. Add a weekly review with owner-approved scheduling suggestions, all using the calendar proposal path. Done when a task links to its project and proposed event, and changes invalidate stale approvals. |
| 6 | Replace sample dashboard sections with real data | Projects, finance and lifestyle panels currently contain sample content. | Connect one source at a time, label source and freshness, and show an honest empty state for disconnected sources. Start with projects/backlog; scope finance separately around a read-only source and exact field mappings. Done when no sample values can be mistaken for live personal records. |
| 7 | Backups, restore and operational visibility | More personal records make recovery essential. | Define retention for Postgres and the separate runner login volume, add encrypted off-host backups, test restoring to an isolated database, and surface service/queue health. Keep credentials out of logs and source control. Done when a documented restore has been tested and failures reach a fixed owner destination. |

## Settings to add as each feature lands

Keep the current control panel focused on controls that work. Add notification destination and quiet hours with delivery, briefing sections with configurable brief content, preferred areas/projects with triage, and connection health with reconnect. Keep secrets server-side; give the EA read-only preference access and no ability to change its own permissions or schedules.

## Decisions before the next larger feature

- Which channel should notify Bailey when a brief is ready?
- Should real chat initially answer questions only, or also propose local backlog edits?
- Which areas should organise the backlog: personal, Moniqr, HMW, Woolworths and CA study?
- Which project source and finance source should replace the sample panels first?

A practical next slice is connection health plus brief history, followed by reviewed backlog triage, then real chat. These make the assistant's state and decisions visible before giving it more ways to act.

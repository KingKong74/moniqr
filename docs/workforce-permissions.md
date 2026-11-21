# Workforce permissions, budgets and buying

How moniqr's agents get more power over time without any one bug, prompt injection or bad model day costing Bailey money or reputation. Nothing in this document is switched on yet. Each step needs Bailey's go-ahead, because each one changes the agent service rules in `CLAUDE.md`.

## Where it stands (Nov 2026)

- Workers have a tick list of read-only tools (daily admin, calendar list and events, email search and read). Their only write is a report.
- Workers run when Bailey or the EA hands them a task, or on their own schedules (at most hourly, Brisbane time).
- The EA can hand out tasks but can only *ask* to create or change an agent or add a schedule. Bailey approves each ask in the hub.
- The only outward action anywhere is the EA's calendar add, and only to one calendar, under owner-set auto-add rules or approval.

## The ladder

Every tool gets one of five levels. An agent is granted tools, and each grant has a level. Higher levels are separate grants, never implied by lower ones.

| Level | What it means | Example | Who executes |
|---|---|---|---|
| 1. Read | Look at data | Search email, read calendar | MCP server, read-only credentials |
| 2. Internal write | Change moniqr's own records only | Save a finding, add a backlog suggestion, draft a reply | Agent API |
| 3. Propose | Ask for an outward action; Bailey approves each one | Send this email, book this table, buy this item | Executor in the agent API, after approval |
| 4. Act within rules | Outward action that goes straight through when it matches rules Bailey wrote | Calendar add from a known sender; reply "confirmed" to a roster email | Executor, rules checked server side |
| 5. Spend within budget | An action that costs money, inside hard limits | Reorder pantry staples under $40 | Executor with a limited payment instrument |

The same principles hold at every level:

1. **Agents never hold outward credentials.** Gmail send scopes, booking accounts and cards live only in the agent API's executors. An agent calls an MCP tool, the tool records a request, and the executor decides.
2. **Limits are enforced in code and data, never in the prompt.** Instructions are guidance. The API refuses anything outside the grant, the rules or the budget, whatever the model says.
3. **Rules and limits are Bailey's alone.** No agent, including the EA, can change a grant level, a rule, a budget or a recipient list. It can only ask, as it does now.
4. **Untrusted content lowers trust.** A run that read email or web pages is *tainted*. A tainted run can propose at level 3 but never auto-execute at levels 4 or 5, unless a rule names the exact sender and action. This closes the classic attack where an email says "buy this gift card".
5. **Every action is logged, idempotent and undoable where the world allows.** Calendar events are tagged and can be deleted. Sent email and spent money can't be undone, which is why they sit higher on the ladder.

## Configuring it (the shape, when we build it)

- A `tool_grants` table: agent, tool, level, and optional rule JSON (for example `{ "senders": ["roster@woolworths.com.au"], "max_per_day": 2 }`). The tick list on the Agents page grows a level selector per tool.
- An `outward_actions` table, generalising today's `approvals`: kind, payload, requesting run, taint flag, status, executor result and undo handle. The Inbox's Proposals tab shows all of them.
- One executor per action kind (calendar, email send, booking, purchase), each with its own credential in the environment and its own tests. Adding a capability means adding an executor, not widening a prompt.

## Budgets

A budget is a hard ceiling the API checks before any spend, plus a ledger.

- **`budgets`**: agent (or shared), currency, period (week or month), cap, per-transaction limit, an approval threshold (auto under $X, approval above), and a merchant allowlist.
- **`spend_requests`**: agent, run, merchant, item, link, amount, taint flag, status (requested → approved → placed → settled, or refused or failed), and the executor's receipt.
- **Ledger rule**: a request reserves funds when created. It counts against the cap until it settles or is refused, so two runs can't both spend the last $30.
- The Agents page shows each budget's spent, reserved and remaining amounts, and the Inbox shows spend approvals.

The payment instrument is the real safety net. Use a **virtual card per agent or budget**, with its own card-level limit and merchant lock set at the provider, so even a bug in moniqr can't spend more than the card allows. In Australia that means a bank or fintech that issues virtual cards with spend controls. The card's limit should match moniqr's cap, and the card number should live only in the purchase executor.

## Buying things: what's realistic

- **Most shops have no purchase API.** Agents can't just call "buy". The options, from safest:
  1. **Prepared cart.** The agent finds the item and price and proposes it. Bailey clicks a link and pays himself. No payment rail needed. *Start here.*
  2. **Merchant APIs** where they exist (some grocery, travel and ticketing platforms). The executor places the order with stored credentials after approval or within budget.
  3. **Browser automation** of a checkout. This is high risk: web pages are untrusted content that can steer the model. It would only ever run inside the executor, from an approved, fully specified request, never directed live by the model.
- Bookings work like purchases: propose first, and auto-book only under narrow rules (a known venue, a price cap, a time window).

## Suggested order

1. **Level 2 for workers.** Let a worker save findings and backlog suggestions. Low risk, and it makes reports actionable.
2. **Level 3, prepared carts and email drafts.** Purchases and replies arrive as proposals. Bailey acts himself. Still no outward credentials.
3. **Level 3 with executors.** Send an approved email reply, and place an approved order through one merchant API.
4. **Budgets with a virtual card.** Start at level 5 for one agent, one merchant and a small cap, with every spend logged and shown in the brief.
5. **Level 4 rules** for repetitive, low-stakes actions, once the logs show the proposals are reliably right.

Each step means updating the agent service rules in `CLAUDE.md` with what Bailey approved and when, as was done for the calendar add on 2026-11-01.

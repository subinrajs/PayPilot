# Features

Tracks every piece of work on this project past initial scaffolding — not just user-facing capabilities. Four types:

- **Story** — a user-facing capability defined in `docs/spec.md`. Gets a full "As a ___, I want ___, so that ___" subsection with acceptance criteria, under `## Web chat (business owner)` or `## Telegram bot (external customer)` below.
- **Bug** — something that was built but behaves incorrectly. Logged under `## Bugs, tasks & chores` with a short what/why — no user-story framing.
- **Task** — a discrete piece of implementation work that isn't itself a user-facing capability (e.g. an internal tool, a refactor enabling something else). Same lighter format as Bug.
- **Chore** — maintenance with no functional behavior change (docs, cleanup, dependency bumps). Same lighter format as Bug.

See `## Maintaining this backlog` below for how to add and work through new items of any type.

The Status/Notes table is kept in sync with implementation by the `plan-tracker` subagent (`.claude/agents/plan-tracker.md`) — a row is only marked `Done` once the item is implemented and, where it covers guardrail/policy behavior, tested.

## Status

| ID | Type | Feature | Actor | Status | Notes |
|---|---|---|---|---|---|
| S1 | Story | Daily summary | Owner | Done | |
| S2 | Story | Refund a payment | Owner | Done | |
| S3 | Story | Create an invoice | Owner | Done | |
| S4 | Story | Compare revenue across periods | Owner | Done | |
| S5 | Story | Link Telegram chat to Stripe customer | Customer | Done | |
| S6 | Story | View what I owe | Customer | Done | |
| S7 | Story | Pay an invoice under the cap | Customer | Done | |
| S8 | Story | Handoff for an invoice at or above the cap | Customer | Done | ADR-011 settled the mechanism (Stripe's own `hosted_invoice_url`); live-verified against a real Telegram client linked to Sarah Johnson's $2,500 invoice — no Pay button shown, handoff message includes a working hosted invoice link |
| B1 | Bug | Pending action mismatched the assistant's narrated action | Owner | Done | Fixed 2026-09-15, commit `b05ade0` — see `## Bugs, tasks & chores` |
| T1 | Task | Add read-only invoice lookup for the owner chat | Owner | Done | Added alongside B1, commit `b05ade0` — see `## Bugs, tasks & chores` |
| C1 | Chore | Update `CLAUDE.md`'s stale Phase-1 intro paragraph | — | Not started | See `## Bugs, tasks & chores` |

## Web chat (business owner)

### S1. Daily summary

As the business owner, I want to ask for a summary of a day's activity, so that I can check in without opening the Stripe dashboard.

- Given a day with a mix of payments (successful and declined), asking to "summarize my day" (or similar) returns a natural-language summary grounded in that day's actual Stripe data.
- The summary is read-only and executes immediately — no confirmation step.
- If the day has no activity, the assistant says so rather than fabricating numbers.

### S2. Refund a payment

As the business owner, I want to refund a specific payment by describing it in natural language, so that I don't have to look up the payment id manually.

- Given an instruction like "refund Maya's last payment," the assistant identifies the specific payment, and returns a pending action describing exactly what will be refunded (customer, amount, payment reference) rather than executing immediately.
- The owner must explicitly confirm before the refund is issued to Stripe.
- If the reference is ambiguous (e.g., multiple candidate payments), the assistant asks for clarification instead of guessing.
- Confirming a pending action whose underlying payment no longer matches (e.g., expired, already refunded) is rejected with a clear error, not silently applied to something else.

### S3. Create an invoice

As the business owner, I want to create an invoice with amount, recipient, and due date in a single instruction, so that I can bill a customer without leaving chat.

- Given an instruction like "create a $250 invoice for Acme Corp due next Friday," the assistant resolves the recipient to a Stripe customer, resolves the relative date, and returns a pending action showing amount, recipient, and due date for confirmation.
- The invoice is only created in Stripe after explicit confirmation.
- An unresolvable recipient (no matching customer) is reported to the owner rather than silently creating a new one.

### S4. Compare revenue across periods

As the business owner, I want to compare revenue between two time periods, so that I can see whether the business is trending up or down without pulling reports manually.

- Given an instruction like "how much did we take last week compared to the week before," the assistant returns both period totals and the difference, grounded in Stripe data.
- Read-only — executes immediately, no confirmation step.

## Telegram bot (external customer)

### S5. Link Telegram chat to Stripe customer

As a customer, I want to connect my Telegram chat to my account, so that the bot knows which invoices are mine.

- `/start <link-token>` establishes the `telegramChatId → stripeCustomerId` mapping for that chat.
- An invalid or already-used token is rejected with a clear message; no mapping is created.
- Until linked, the bot cannot answer any invoice question for that chat — there is no "unscoped" fallback.

### S6. View what I owe

As a linked customer, I want to ask what I owe, so that I don't have to guess or wait for an email.

- Returns only invoices belonging to the chat's linked `stripeCustomerId` — never another customer's.
- If nothing is owed, the bot says so rather than returning an empty/ambiguous response.

### S7. Pay an invoice under the cap

As a linked customer, I want to pay an outstanding invoice directly in the chat, so that I don't need a separate payment page.

- For an invoice below the $2,000 cap, the bot returns a pending action; the customer confirms; only then does Stripe process the payment.
- A confirmation that doesn't match the pending invoice/amount is rejected.
- Successful payment is reflected back to the customer in the chat (and is visible to the owner via Stripe, per "Stripe is the source of truth").

### S8. Handoff for an invoice at or above the cap

As a linked customer with an invoice at or above $2,000, I want to be told how to pay it, so that I'm not stuck when the bot can't process it directly.

- The bot never offers a payable pending action for an invoice at/above the cap — this is enforced in code (per `docs/design.md`), not by asking the model to decline.
- The customer is told the invoice needs to be handled outside the bot, with next steps: the invoice's Stripe-hosted `hosted_invoice_url` (mechanism settled by ADR-011, see `docs/decisions.md`).

## Bugs, tasks & chores

Lighter-weight than Stories — no user-story framing, just what/why and, once done, a short note on the fix.

### B1. Pending action mismatched the assistant's narrated action

Reported 2026-09-15: asked "is there any invoice created for Acme?", the assistant's reply described an invoice, but the pending-action card that actually appeared was a REFUND for the same customer/amount — the model's narration didn't match the tool it actually called.

Root cause: the web owner chat had no tool to look up existing invoices at all, so the model had no correct way to answer — it appears to have both guessed at invoice details and separately misfired a real `propose_refund` call. Neither the system prompt nor either tool's description told the model it must only call a money-moving tool on an explicit request, or that its reply must match the action it actually produced.

**Fixed** (commit `b05ade0`): `apps/api/src/agent/system-prompt.ts` now explicitly forbids calling `propose_refund`/`propose_invoice_creation` speculatively, requires the reply to always describe the exact action just produced, and directs invoice-status questions to the new `get_customer_invoices` tool (T1) instead of guessing. A regression test in `apps/api/src/agent/loop.test.ts` pins that the returned pending action is always sourced from the tool call itself, never influenced by the model's reply text — the structural safety net independent of prompt wording. Note: the pending-action card itself was never wrong (it faithfully showed the real action), and nothing executes without explicit confirmation — this was a narration/trust bug, not a guardrail bypass.

### T1. Add read-only invoice lookup for the owner chat

Added alongside B1's fix (commit `b05ade0`), since B1's root cause was this capability's absence: `get_customer_invoices` in `apps/api/src/agent/tool-registry.ts`, backed by `apps/api/src/agent/tools/owner-invoice-lookup.ts`. Resolves a customer by name/email (same pattern as `propose_refund`/`propose_invoice_creation`) and reuses the existing `lookupInvoices` (previously wired only into the Telegram bot). Read-only, executes immediately, no pending action.

### C1. Update CLAUDE.md's stale Phase-1 intro paragraph

`CLAUDE.md`'s opening section still reads "No application code exists yet — this repo currently holds only README.md and the planning docs in docs/... not something you can run today" — true during Phase 1 scaffolding, no longer true now that all 8 phases are built and the app runs via `pnpm dev`. Needs a rewrite reflecting the app's current, real state. Not yet picked up.

## Maintaining this backlog

How work gets added and carried through, for any of the four types above:

1. **Log it.** Add a row to the `## Status` table above with the next ID in its type's sequence (`S9`, `B2`, `T2`, `C2`, ...) and `Status: Not started`. A Story gets a full "As a ___, I want ___, so that ___" subsection with acceptance criteria, under `## Web chat (business owner)` or `## Telegram bot (external customer)`. A Bug/Task/Chore gets a short entry under `## Bugs, tasks & chores` — what/why is enough, no story framing needed.
2. **Load it into context.** When it's time to work on an item, fill in `.claude/context/current-feature.md` with that item's ID, context/why, relevant files, and next steps. This is the file meant to be loaded into a session's context at the start of work on it.
3. **Work it the same way regardless of type**: read the relevant docs, confirm understanding, propose a plan, implement, verify — the usual plan-mode discipline this project has followed throughout.
4. **Close it out.** Once done (and tested, for anything touching guardrail/policy logic), the `plan-tracker` subagent updates the `Status` cell to `Done` and resets `.claude/context/current-feature.md` back to its placeholder state, so that file always reflects what's actually active, never stale finished work.

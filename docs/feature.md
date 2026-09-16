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
| S9 | Story | Redesign web chat UI as a dashboard | Owner | In progress | Today's Summary, Payment Activity, Needs Attention (overdue invoices + disputes), Recent Activity, and suggested-prompt chips shipped; Payouts/Deposits still not built — see story for detail |
| B2 | Bug | Duplicate invoice tiles for one reply | Owner | Done | Fixed 2026-09-16 — see `## Bugs, tasks & chores` |
| B3 | Bug | "List refunds" crashed with "assistant failed to respond" | Owner | Done | Fixed 2026-09-16 — see `## Bugs, tasks & chores` |
| B4 | Bug | "Any outstanding invoice" looped asking for a specific customer | Owner | Done | Fixed 2026-09-16 — see `## Bugs, tasks & chores` |

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

### S9. Redesign web chat UI as a dashboard

As the business owner, I want the web chat to show at-a-glance summary and activity panels alongside the chat, so that I can see today's status and anything that needs my attention without having to ask for it.

Reference mockup: `docs/assets/PayPilot Web UI.png` — a three-column "command center" layout replacing the current sidebar-plus-chat layout.

- **Left panel — Today's Summary**: ✅ **Shipped** — today's sales total (net revenue) with % change vs. yesterday, and a failed-charge count, both via a new direct `GET /api/dashboard/summary` route (bypasses the LLM entirely, per the architecture decision below) composing the existing `getDailySummary`/`getRevenueComparison` functions, plus a 7-day bar chart. **Correction found during implementation**: the mockup's "Deposits" and "Failed Payouts" figures are Stripe *Payouts* (money moving from the Stripe balance to the owner's bank account) — a wholly different Stripe object this codebase has never touched (everything here is charge-based). Not fabricated; simply not shown yet. Deferred alongside the other new-capability items below.
- **Left panel — Payment Activity**: ✅ **Shipped** — a line chart of payment volume with a working 7/30/90-day range toggle, via a new `GET /api/dashboard/activity?days=` route and a new `bucketDailyTotals` aggregation function (`agent/aggregation.ts`) that buckets charges by their own UTC calendar day.
- **Center panel — chat**: unchanged, as planned (tiles, pending-action confirmation). ✅ **Shipped**: clickable suggested-prompt chips above the input, shown only before the first message and hidden once a conversation starts.
- **Right panel — Needs Attention**: ✅ **Shipped in full.** Cross-customer overdue invoices via `GET /api/dashboard/overdue-invoices` (`getOverdueInvoicesSummary`, scanning the full customer list via `customer-resolution.ts`'s `listAllCustomers`). Payment disputes via a new `GET /api/dashboard/disputes` route (`getDisputesSummary`) — this codebase's first use of Stripe's Disputes API, showing only disputes still awaiting the owner's evidence response (`needs_response`/`warning_needs_response`), each with the disputed amount, reason, the customer's name (pulled from the disputed charge's `billing_details`, no customer expansion needed), and a short "in 2h"/"in 3d" label for the evidence deadline. Both sections render together in one panel, matching the mockup; the panel shows a calm neutral state when neither has anything to report. **Known gap, not a bug**: the seed script doesn't create any test disputes (that requires Stripe's special dispute-triggering test flow, which the current charge-based seed script doesn't use), so this always reads as "0 disputes" against seed data today — verified correct via the real empty-state response, and separately verified the "has disputes" rendering path via a mocked response (not shown against real data, since none exists yet).
- **Right panel — Recent Activity**: ✅ **Shipped** — the 10 most recent account-wide events (successful/failed payments, refunds, invoice creation), via a new `GET /api/dashboard/recent-activity` route (`getRecentActivity`) merging three independent Stripe list calls (charges, refunds, invoices) and sorting newest-first. Deliberately excludes "invoice paid" as its own event, since the charge that pays an invoice already appears via the charges stream and showing both would double-count the same money movement. Customer name is pulled from `billing_details.name` (charges/refunds, via the charge) or the invoice's own `customer_name` field — no customer expansion needed; renders honestly with no customer name shown when that field is null, as it is for this project's current seed data.
- Deposits/Payouts (discovered during implementation, see above) also needs new backend capability before it can be shown honestly.
- Every guardrail in `CLAUDE.md` stays unchanged: money-moving actions still require the pending-action/confirm flow, the $2,000 Telegram cap is untouched (this story is web-only), and every number shown (including the new chart data) still comes from a deterministic aggregation module — never computed or estimated by the model. The new dashboard routes are read-only and reuse the same aggregation functions the chat tools already use — no new mutating Stripe call anywhere in this slice.

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

### B2. Duplicate invoice tiles for one reply

Reported 2026-09-16: asking "list the invoices for next week" rendered the same customer's invoice card twice (once with 3 invoices, once with 2), plus a text reply that also enumerated each invoice.

Root cause: `get_customer_invoices` only filters by status (open/paid/overdue/all) — it has no date-range parameter. Trying to narrow the results to "next week," the model called the tool a second time with a different status, and the chat UI faithfully renders every tool-result message in the transcript as its own tile, so two calls in one reply produced two tiles.

**Fixed**: `apps/api/src/agent/system-prompt.ts` now tells the model explicitly that the tool has no date filter, to do date filtering itself when narrating, and never to call it twice for the same customer within one reply. Defense-in-depth: `apps/web/src/toolResults.ts` now dedupes tool-result tiles that share the same tool + identity (customer, date, or period) within a single turn, keeping only the latest — so even a redundant call can't produce a duplicate card. A later, separate turn asking about the same customer still gets its own tile. Live-verified via Playwright against the exact reported prompt.

### B3. "List refunds" crashed with "assistant failed to respond"

Reported 2026-09-16: asking "list the refunds done this week" always failed with a generic error banner.

Root cause: there was no tool at all for listing past refunds — `propose_refund` only creates a new refund, and no read-only tool covered this. With no way to answer, the model kept calling tools without ever producing a final reply, hitting `loop.ts`'s `MAX_TOOL_ROUNDS` safety cap (an intentional circuit-breaker against a misbehaving model looping forever), which throws and surfaces as a 502 to the owner.

**Fixed**: added a new read-only owner tool, `get_refunds` (`apps/api/src/agent/tools/refund-lookup.ts`), listing refunds account-wide over a date range (`endDate` exclusive, same convention as `get_revenue_comparison`), with each refund's amount and customer name (pulled from the refunded charge's `billing_details`, no customer expansion needed). Registered in `tool-registry.ts`; `system-prompt.ts` now points refund-history questions at it and explicitly distinguishes it from `propose_refund`. Frontend: a new `RefundsTile` renders it the same way invoices/summaries already render as cards. Live-verified via Playwright against the exact reported prompt — no more error, real refund data renders.

### B4. "Any outstanding invoice" looped asking for a specific customer

Reported 2026-09-16: asking "any outstanding invoice as of today" got "couldn't find any customer matching 'customer'." Rephrasing as "check for all the customers" / "check for all customers" produced the same failure with "all" substituted as the reference — the assistant never got past asking for a specific customer name, three times in a row.

Root cause: same shape of gap as B3, this time for invoices — `get_customer_invoices` only resolves to exactly ONE customer by name/email (substring match against the real customer list), so it has no way to answer an account-wide question. With no cross-customer tool available, the model literalized "all"/"all the customers"/"customer" as a customer-name search, which of course matched nobody, and kept retrying the same broken approach instead of recognizing the question needed a different tool entirely.

**Fixed**: added a new read-only owner tool, `get_outstanding_invoices` (`apps/api/src/agent/tools/outstanding-invoices.ts`), listing unpaid invoices account-wide across every customer (reuses `customer-resolution.ts`'s `listAllCustomers` and the existing per-customer `lookupInvoices`, same N+1-call pattern already accepted for `agent/dashboard.ts`'s `getOverdueInvoicesSummary`). Defaults to status "open" (which already includes overdue invoices) when the model doesn't specify a narrower filter. Registered in `tool-registry.ts`; `system-prompt.ts` now explicitly says never to pass a generic word like "all" or "every customer" to `get_customer_invoices`, and to call this new tool instead for any account-wide question. Frontend: a new `OutstandingInvoicesTile` renders it the same way `CustomerInvoicesTile` does, reusing its status-badge logic across multiple customers. Live-verified via Playwright against the exact reported prompt — no more loop, real cross-customer invoice data renders (12 invoices, $4,180.00, across 5 customers).

### C1. Update CLAUDE.md's stale Phase-1 intro paragraph

`CLAUDE.md`'s opening section still reads "No application code exists yet — this repo currently holds only README.md and the planning docs in docs/... not something you can run today" — true during Phase 1 scaffolding, no longer true now that all 8 phases are built and the app runs via `pnpm dev`. Needs a rewrite reflecting the app's current, real state. Not yet picked up.

## Maintaining this backlog

How work gets added and carried through, for any of the four types above:

1. **Log it.** Add a row to the `## Status` table above with the next ID in its type's sequence (`S10`, `B2`, `T2`, `C2`, ...) and `Status: Not started`. A Story gets a full "As a ___, I want ___, so that ___" subsection with acceptance criteria, under `## Web chat (business owner)` or `## Telegram bot (external customer)`. A Bug/Task/Chore gets a short entry under `## Bugs, tasks & chores` — what/why is enough, no story framing needed.
2. **Load it into context.** When it's time to work on an item, fill in `.claude/context/current-feature.md` with that item's ID, context/why, relevant files, and next steps. This is the file meant to be loaded into a session's context at the start of work on it.
3. **Work it the same way regardless of type**: read the relevant docs, confirm understanding, propose a plan, implement, verify — the usual plan-mode discipline this project has followed throughout.
4. **Close it out.** Once done (and tested, for anything touching guardrail/policy logic), the `plan-tracker` subagent updates the `Status` cell to `Done` and resets `.claude/context/current-feature.md` back to its placeholder state, so that file always reflects what's actually active, never stale finished work.

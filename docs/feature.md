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
| S3 | Story | Create an invoice | Owner | Superseded | Single-amount, one-step create+finalize+send flow replaced by S10's multi-item draft/review/send lifecycle |
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
| B5 | Bug | Telegram "what I owe" kept showing an already-paid invoice and missed a new one | Customer | Done | Fixed 2026-09-17 — see `## Bugs, tasks & chores` |
| B6 | Bug | "List all my customers" had no tool to answer it | Owner | Done | Fixed 2026-09-17 — see `## Bugs, tasks & chores` |
| B7 | Bug | "Which customer has the highest payments" had no tool to answer it | Owner | Done | Fixed 2026-09-17 — see `## Bugs, tasks & chores` |
| B8 | Bug | Payment reminder draft showed a raw overflowing URL instead of a link | Owner | Done | Fixed 2026-09-17 — see `## Bugs, tasks & chores` |
| B9 | Bug | Payment reminders silently skipped no-email customers, and the reply duplicated the tile | Owner | Done | Fixed 2026-09-17 — see `## Bugs, tasks & chores` |
| S10 | Story | AI invoice creator, reviewer & sender | Owner | Done | Supersedes S3 — multi-line-item drafts, a pre-send reviewer, and an explicit approve-and-send step; live-verified end-to-end against real seed data (John Smith), including the natural-language edit and the real sent invoice's number/hosted link |
| S11 | Story | AI dispute assistant | Owner | Done | Evidence checklist, AI-drafted response, explicit submit/decline; live-verified end-to-end against a real seeded dispute (Acme Corp) — the real Stripe dispute now shows `has_evidence:true`, `submission_count:1`, `status:under_review` |
| S12 | Story | Natural-language conversation with the Telegram bot | Customer | Done | Reuses `runAssistantTurn` (now parameterized, ADR-014) with a customer-scoped tool registry — `/start`/`/owe` unchanged, confirmation stays exclusively button-driven; live-verified (real "what I owe" query against real Sarah Johnson data) alongside fixing B5 |
| S13 | Story | Notify the customer when a handoff-path invoice is paid | Customer | Done | New Stripe webhook (`POST /api/stripe/webhook`), scoped to at/above-cap invoices only (ADR-015) — mutually exclusive with the bot's own synchronous confirmation by construction; live-verified end-to-end — real $3,000 hosted-page payment, real webhook delivery, real Telegram notification received |
| S14 | Story | Payment reminder notifications from Needs Attention | Owner | Done | AI-drafted reminders for overdue invoices + failed payments (new), reviewed/edited/sent from a chat tile; sending is a deterministic, LLM-free route that only logs (no real email) — live-verified end-to-end including a real edit and both individual-Send and Send-all paths |
| S15 | Story | Login screen (no real authentication) | Owner | Done | A username/password gate in front of the whole app — any non-empty values accepted, nothing validated server-side; session persisted to localStorage for convenience, not security; live-verified (login, reload persistence, logout) |

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

### S3. Create an invoice — Superseded by S10

As the business owner, I want to create an invoice with amount, recipient, and due date in a single instruction, so that I can bill a customer without leaving chat.

- Given an instruction like "create a $250 invoice for Acme Corp due next Friday," the assistant resolves the recipient to a Stripe customer, resolves the relative date, and returns a pending action showing amount, recipient, and due date for confirmation.
- The invoice is only created in Stripe after explicit confirmation.
- An unresolvable recipient (no matching customer) is reported to the owner rather than silently creating a new one.

*(Kept for history. S10 replaces this flow entirely — a single confirm step no longer both finalizes and sends; see S10 for the current behavior.)*

### S10. AI invoice creator, reviewer & sender

As the business owner, I want to build up an invoice with multiple line items conversationally, see a review of anything worth double-checking before it goes out, and explicitly approve sending it, so that I can bill customers accurately without leaving chat or accidentally sending something wrong.

Reference: a design proposal the owner supplied, adapted to this codebase's actual constraints (see `.claude/context/s10-invoice-creator.md` for the full research and scoping decisions behind what's below).

- **Create**: given an instruction like "create an invoice for John Smith for 10 hours of consulting at $150/hour and 5 hours of development at $125/hour, due in 15 days," the assistant resolves the customer, computes each line item's amount (quantity × unit price — computed by application code, never the model), and creates a real Stripe **draft** invoice (no charge, nothing emailed yet, fully reversible). An unresolvable or ambiguous customer reference is reported rather than guessed.
- **Review**: the draft is shown as a structured review card — itemized line items, subtotal, tax (always "Not configured" — see Non-goals), total, due date — alongside deterministic checks: the customer's email is on file; the customer's current overdue-invoice count/total, if any; whether this amount is unusually high vs. that customer's historical average; whether a very similar invoice (same amount + same/similar description) went to this customer in the last 30 days. Checks that pass are shown too, not just problems.
- **Edit**: a natural-language follow-up (e.g. "make it due in 15 days," "change the consulting hours to 12") updates the *same* draft invoice in Stripe and re-runs the review — it does not create a second invoice.
- **Send**: only after the owner explicitly approves (e.g. "send it," clicking Approve & Send) does the assistant finalize and email the invoice — this is a pending action requiring the same confirm ceremony as a refund; nothing is sent on the strength of the draft or the review alone. The confirmation names the real invoice number and a working hosted invoice link, only available once actually sent (Stripe doesn't assign a number to a draft).
- **Discard**: the owner can discard a draft before sending, which deletes the Stripe draft rather than leaving it orphaned.
- Confirming a stale "send" (e.g. the draft was already sent or discarded elsewhere) is rejected with a clear error rather than silently re-sending or acting on the wrong invoice.

**Non-goals for this story** (explicitly out of scope, not silently dropped):
- **Tax** — always shown as "Not configured." Stripe Tax (`automatic_tax`) isn't confirmed enabled on this account; wiring it in without that confirmation risks looking broken rather than honestly unbuilt (same reasoning as S9's deferred Payouts gap).
- **Proactive overdue notifications** — no webhook or notification infrastructure exists in this codebase. A sent invoice surfaces automatically in the existing Needs Attention dashboard panel once it's actually overdue; the assistant says this honestly rather than promising a push notification. Real webhook-based notifications would be a separate future story.
- **A line-item edit form** — edits are conversational only, matching this project's existing preference for chat as the primary interface over a traditional form.
- **Predictive payment-timing analytics** (e.g. "this customer typically pays within 18 days") — not part of the reviewer's checks.

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

### S11. AI dispute assistant

As the business owner, I want PayPilot to help me understand a payment dispute, see what evidence actually exists, draft a response, and submit it, so that I don't have to manually piece together evidence and write a rebuttal from Stripe's dashboard.

Reference: a design proposal the owner supplied, adapted to this codebase's real data model (see `.claude/context/s11-dispute-assistant.md` for the full research and scoping decisions behind what's below — most importantly, this app has no order/shipping/tracking/CRM system, so the evidence checklist is honest about what's actually derivable from Stripe versus what the owner has to supply).

- **Understand the dispute**: given a dispute (found via the Needs Attention panel or asked about directly, e.g. "what disputes need my attention?"), the assistant shows the dispute reason, the disputed transaction's real facts (customer, amount, charge description, response deadline), and a checklist of which evidence fields relevant to that specific reason are already derivable from real Stripe data versus missing. Different dispute reasons surface different relevant fields (e.g. shipping/tracking for "product not received"; a matching prior charge for "duplicate"; customer identity/billing details for "fraudulent") — reason-specific, not one generic checklist. Nothing is ever shown as "found" unless it's a real fact from Stripe or something the owner explicitly supplied in conversation.
- **Supply missing evidence conversationally**: the owner can answer with details PayPilot doesn't have (e.g. "we shipped it via UPS, tracking 1Z999, delivered Sept 13") and a follow-up drafting/revision step incorporates it — no form to fill out.
- **Draft a response**: the assistant composes a written response and stages it as evidence on the real Stripe dispute (safe and reversible — staging is not submitting, nothing is sent to the card network yet). The draft can be revised conversationally before anything is submitted.
- **Submit or decline, explicitly confirmed**: submitting staged evidence to the card network, and declining to contest (conceding the dispute), are both separate, irreversible actions requiring the same explicit pending-action confirmation as a refund — never assumed from drafting or reviewing alone.
- **No outcome guarantees**: PayPilot never states or implies a submitted response will win — the card issuer makes the final decision, matching Stripe's own stated caveat about Smart Disputes.
- Confirming a stale submit/decline (e.g. the dispute was already resolved elsewhere) is rejected with a clear error rather than silently acting on the wrong dispute.

**Non-goals for this story** (explicitly out of scope, not silently dropped):
- **File-upload evidence** (receipt, customer communication, shipping documentation as actual attached files) — this app has no file-upload infrastructure; V1 is text-evidence-only.
- **Fabricated evidence** — no "order fulfilled," "delivery confirmed," or similar checklist item is ever shown unless it's a real, checkable fact; there is no order/shipping system in this codebase to check against.
- **Proactive/webhook-based deadline notifications** — no webhook infrastructure exists (same gap already documented for S10's invoice-overdue monitoring); the existing Needs Attention panel's due-by countdown already covers this passively.
- **A numeric "evidence strength" score or automated "potential issue" detection** (e.g. comparing a delivery address this app doesn't have) — flags stay qualitative and grounded in what's actually derivable.

### S14. Payment reminder notifications from Needs Attention

As the business owner, I want to draft and send reminder emails to customers with overdue invoices or failed payments, so that I don't have to write each one by hand or dig through Stripe to find who needs a nudge.

An earlier version of this idea was explored and explicitly abandoned mid-planning; this is a fresh implementation with a different, more specific shape, requested directly by the owner.

- **Failed payments now surface in Needs Attention**, alongside the existing overdue invoices and disputes — a charge with `status:"failed"` whose associated invoice (if any) isn't currently paid; no arbitrary lookback window, same reasoning as overdue invoices having none.
- **One "Send Notification" trigger** in the Needs Attention panel drafts a reminder for every currently-overdue invoice and every currently-failed payment in one go — not a separate button per row.
- **AI-drafted, human-reviewed**: the assistant composes a subject and body per item from real facts only (customer name, amount, due date or failed date) and stages them for review as a chat tile — it never claims anything was sent at this point.
- **Each draft is individually editable and sendable**, plus a **"Send all"** button that sends every not-yet-sent draft in one action. Editing is inline in the tile (no LLM round-trip needed to change already-drafted text).
- **Sending is explicitly simulated**: no real email is configured or sent anywhere in this app (same honest gap as S10's invoice-send). Clicking Send only logs the reminder server-side and reports success — this is a deterministic action with no LLM involvement, since finalized text needs no further reasoning.
- A customer with no email on file is still shown (never fabricated), with "no email on file" stated plainly, leaving the choice of whether to send anyway to the owner.

**Non-goals for this story** (explicitly out of scope, not silently dropped):
- **Real email sending/configuration** (SMTP, SendGrid, etc.) — explicitly simulated per the request.
- **A reminder option on disputes** — they already have their own "Review Response →" flow.
- **Persisting draft/sent state across a page reload** — lives only in the tile's local state, like every other in-flight chat interaction in this app.

### S15. Login screen (no real authentication)

As the business owner, I want to log in with a username and password before reaching the app, so that the page looks and behaves like a real product rather than opening straight into the dashboard.

Explicitly requested as a stub: no authentication logic, no backend involvement — any non-empty username and password is accepted.

- A login screen (username + password fields, both required to be non-empty) is shown before anything else in the app; submitting reveals the dashboard.
- The entered username is shown in the sidebar's profile block (`UserProfile.tsx`), replacing the previous hardcoded "Admin" placeholder — "Owner" stays as the static role label, since this app models exactly one role.
- The session is remembered in `localStorage` so a page refresh doesn't force re-login — a UI convenience only, not a security boundary (there is none: no server-side session, no cookie, no credential check of any kind).
- The profile block's existing (previously decorative) icon now works as a real "Log out" action, returning to the login screen and clearing the current chat session (a fresh login starts a fresh conversation).

**Non-goals for this story** (explicitly out of scope, not silently dropped):
- **Any real credential validation, hashing, session/cookie mechanism, or backend auth route** — explicitly not wanted; this is a UI-only gate.
- **Multiple accounts/roles** — still exactly one implied owner, matching every other part of this app's single-owner framing.

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

### S12. Natural-language conversation with the Telegram bot

As a linked customer, I want to talk to the bot in my own words instead of only exact commands, so that a plain question like "what do I owe" or "pay the first one" works the same way `/owe` and the Pay button already do.

- Any message that isn't `/start` or `/owe` (and isn't itself a stray `/command`) is answered by the same OpenAI tool-calling loop the web chat uses (`runAssistantTurn`), scoped to exactly two tools: looking up the chat's own invoices and proposing to pay one of them.
- `/start` and `/owe` keep working exactly as before — this is purely additive, not a replacement.
- The model can propose paying an invoice from natural language (e.g. "pay the consulting one"), but this only creates the same pending action a Pay-button tap creates — a separate tap on the existing Confirm button is still the only way anything is actually paid (ADR-014). The model is never asked to interpret "yes"/"go ahead" as authorization.
- `customerId` is bound server-side from the chat's session for both tools, exactly as it already was for `/owe` and the `pay:` callback — there is no field in either tool's schema the model could use to act on a different customer, and no new isolation gap is introduced by adding natural language.
- An at/above-cap invoice reached via natural language gets the same handoff message (Stripe's hosted invoice link) as reaching it via `/owe` and the Pay button.
- Each chat's conversation history is remembered in-memory (mirroring the existing chat-to-customer session map) so a follow-up like "pay that one" can refer back to an invoice named a turn earlier; it's cleared on a fresh `/start` re-link so a previous customer's context can't leak into a newly-linked chat.

### S13. Notify the customer when a handoff-path invoice is paid

As a linked customer who pays an at/above-cap invoice through the Stripe-hosted link (S8's handoff), I want to be told the payment went through, so that I'm not left wondering whether it worked without opening the bot again.

- A real Stripe webhook (`POST /api/stripe/webhook`, signature-verified via `stripe.webhooks.constructEvent` — a forged or missing signature is rejected with no side effect) listens for `invoice.paid` events and proactively messages the linked chat when one fires.
- Scoped strictly to invoices at or above the $2,000 cap — the bot's own Confirm-button flow can never pay one of those (it's routed to handoff instead), so this is the only case the customer wasn't already told synchronously in-chat. A below-cap `invoice.paid` event (only reachable via the bot's own flow) is deliberately a no-op here, by construction rather than by tracking "did the bot already say something" as separate state (see ADR-015).
- A redelivered/duplicate Stripe event for the same payment sends at most one notification, not one per delivery.
- An invoice paid for a customer with no linked Telegram chat is a silent no-op — this only reaches customers who actually linked via `/start`.

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

### B5. Telegram "what I owe" kept showing an already-paid invoice and missed a new one

Reported 2026-09-17, live-testing S12/S13: after paying a $500 invoice via the bot's own Confirm button, asking "what I owe" (natural language) still showed that same $500 invoice as outstanding with a Pay button — and after the owner sent Sarah Johnson a genuinely new $3,000 invoice, asking again still didn't show it.

Root cause: `telegram/bot.ts`'s `handleConversationalMessage` calls `findToolResult(result.messages, "get_my_invoices")` to find the tool's result and render it via `formatInvoiceList`. `result.messages` is `runAssistantTurn`'s full accumulated conversation (prior history plus this turn), not just what this turn produced. So once `get_my_invoices` had been called anywhere earlier in the chat, `findToolResult` kept finding and re-rendering *that* result on every later turn where the model — relying on its own (stale) memory rather than re-calling the tool, a known prompt-adherence gap — didn't call it again. The displayed card was real tool output, just from several turns ago, silently going stale as real invoice state changed underneath it.

**Fixed**: `handleConversationalMessage` now slices `result.messages` down to only the messages the current turn actually produced (`result.messages.slice(nextMessages.length)`) before searching for a tool result, for both `get_my_invoices` and `pay_invoice`. Mirrors the turn-scoping the web frontend's `toolResults.ts` already does for the same class of problem (its `dedupeKey` mechanism, from the B2 fix). A regression test in `test/telegram/bot.test.ts` pins this: a two-turn conversation where turn 1 calls `get_my_invoices` and turn 2 doesn't now correctly shows no invoice card on turn 2, rather than re-displaying turn 1's now-stale result.

### B6. "List all my customers" had no tool to answer it

Reported 2026-09-17: asking "list all my customers" got "I can't directly list your customers, but I can help with specific information related to invoices, payments, or disputes if you provide me with a customer name or email" — an honest refusal, not a fabrication, but a real capability gap: every existing owner tool (`get_customer_invoices`, `propose_refund`, etc.) requires resolving a free-text reference down to exactly one customer first, so there was genuinely no tool for a plain account-wide "who are my customers" question. Same shape of gap as B3/B4.

**Fixed**: added a new read-only owner tool, `get_customers` (`apps/api/src/agent/tools/customer-list.ts`), reusing the existing `customer-resolution.ts`'s `listAllCustomers`/`displayName` helpers unchanged (already handling the test-clock-customer quirk — see `outstanding-invoices.ts`'s prior use of the same helper). Registered in `tool-registry.ts` (16 → 17 owner tools) with a description explicitly telling the model this is the only way to answer that kind of request rather than asking the owner to name a customer first. No dedicated tile — narrated in plain prose, same "the model's own reply is enough for a simple list" reasoning already applied to `get_disputes`. Live-verified via Playwright against the exact reported prompt: correctly lists all 5 real customers, including honestly showing "no email on file" for the one seeded via `stripe trigger` rather than fabricating one.

### B7. "Which customer has the highest payments" had no tool to answer it

Reported 2026-09-17: asking "which customer has the highest payments" got an honest refusal ("I don't have access to payment history or individual payment totals... you would need to review your payment records through Stripe"). Same shape of gap as B4/B6 — no tool aggregated payments *per customer* to rank against; `get_daily_summary`/`get_revenue_comparison` total across the whole account for a date range, and `get_customer_invoices` needs a customer already named.

**Fixed**: added a new read-only owner tool, `get_top_customers` (`apps/api/src/agent/tools/top-customers.ts`), ranking every customer by net-of-refunds total payments, highest first. Reuses `charge-fetching.ts`'s existing per-range charge fetch (generalized into a new `fetchCharges`, with `fetchChargesInRange` now a thin wrapper over it) and a new pure aggregation function, `rankCustomersByRevenue` (`agent/aggregation.ts`) — grouped by customer *id*, not display name, since two customers can share a name and a missing name must not silently merge unrelated customers into one bucket. `ChargeLike` gained `customerId`/`customerEmail` fields (previously only `customerName`) to make that grouping possible. Defaults to all-time totals and the top 10 customers when the owner doesn't narrow with a date range or limit. Registered in `tool-registry.ts` (17 → 18 owner tools). Live-verified via Playwright against the exact reported prompt: correctly named Sarah Johnson with a total matching her real charge history exactly ($6,345.00 across 6 real charges).

### B8. Payment reminder draft showed a raw overflowing URL instead of a link

Reported 2026-09-17, live-testing S14: a drafted overdue-invoice reminder rendered a raw, unbroken hosted-invoice URL (sometimes wrapped in literal Markdown `[text](url)` syntax) directly inside the email body text, overflowing past the card's edge instead of wrapping.

Root cause: `draft_payment_reminders`' schema gave the model no structured field for a link at all, so it embedded one as free text inside `subject`/`body` — the same class of bug already fixed once for the web chat's own replies (`MessageBubble.tsx`'s `invoiceUrl` field) and for Telegram (S13's HTML-anchor fix), just not yet applied to this new card.

**Fixed**: added a real `invoiceUrl: string | null` field carried through structurally — `getFailedPaymentsSummary` (`agent/dashboard.ts`) now resolves it from the failed charge's associated invoice (if any, via the existing `hosted_invoice_url`), and `get_outstanding_invoices` already had it. `draft_payment_reminders`'/`POST /api/reminders/send`'s schemas both gained the field; `system-prompt.ts` and the tool's own description now explicitly tell the model to pass it through unchanged and never write a URL or markdown link inside subject/body itself. `PaymentReminderCard.tsx` renders it as a real `<a>` link ("View invoice ↗", same styling as `MessageBubble.tsx`'s existing one) instead of trusting free text — plus `break-words`/`min-w-0` added defensively to the subject/body text so any other long unbroken string can't overflow the card again either. Live-verified: the same reported prompt now shows a clean, non-overflowing card with a proper clickable link.

### B9. Payment reminders silently skipped no-email customers, and the reply duplicated the tile

Reported 2026-09-17, right after B8: clicking "Send Notification" with 5 items in Needs Attention (1 overdue + 4 failed payments) only produced 2 drafts, and the chat showed a full second copy of every drafted email as plain text below the review card.

Two separate root causes:
1. **Missing items** — an earlier version of `system-prompt.ts`'s guidance told the model to *skip* drafting for any customer with no email on file. This directly contradicted `PaymentReminderCard`'s own design, which already discloses "no email on file" per item specifically so the *owner* can decide whether to send anyway — the skip instruction was itself the bug. **Fixed**: `system-prompt.ts` and the `draft_payment_reminders` tool description now say to include every single item the lookup tools returned, no omissions.
2. **Duplicated reply** — the model reliably restated every drafted subject/body in prose below the tile despite the existing "one line, the card already shows it" instruction; prompt wording alone had already failed twice for this exact class of issue (S10/S11's own "known minor gap" notes). **Fixed properly this time**: `routes/assistant.ts` now deterministically overrides the reply for this one especially-verbose tool whenever it fires in a turn — replacing it with a short fixed sentence (e.g. "Here are 5 payment reminder drafts below…") regardless of what the model wrote. (First attempt at this only overrode the response's `reply` field, which the frontend never actually reads — `App.tsx` renders from `messages`, so the real fix replaces the last message's `content` too, caught by testing against `messages` directly rather than just `reply`.)

A third, smaller issue surfaced during this same live-testing pass: the model still occasionally wrote a raw URL into the drafted body despite being told the real link renders separately (a repeat of B8, one prompt-compliance failure short of recurring) — `draftPaymentReminders` (`agent/tools/payment-reminders.ts`) now deterministically strips any URL or markdown link out of the drafted subject/body server-side, the same "don't rely on compliance" fix applied to the reply-duplication issue. And fixing all of the above pushed a real 3-lookup-then-draft turn right up against `agent/loop.ts`'s `MAX_TOOL_ROUNDS` cap (4) — a live run actually hit "Assistant loop exceeded the maximum number of tool-call rounds" once every lookup+draft call was reliably happening; raised to 6 to give real multi-lookup flows headroom.

Regression tests added: `routes/assistant.test.ts` (the deterministic-override fires only for `draft_payment_reminders`, only for the current turn, with correct singular/plural wording, verified against the response's `messages` field specifically — not just `reply`), `agent/tools/payment-reminders.test.ts` (URL/markdown-link stripping, including a bare-URL-only fallback). Live-verified end-to-end: all 5 items drafted, no raw URL in any body, no duplicated prose in the chat.

### C1. Update CLAUDE.md's stale Phase-1 intro paragraph

`CLAUDE.md`'s opening section still reads "No application code exists yet — this repo currently holds only README.md and the planning docs in docs/... not something you can run today" — true during Phase 1 scaffolding, no longer true now that all 8 phases are built and the app runs via `pnpm dev`. Needs a rewrite reflecting the app's current, real state. Not yet picked up.

## Maintaining this backlog

How work gets added and carried through, for any of the four types above:

1. **Log it.** Add a row to the `## Status` table above with the next ID in its type's sequence (`S10`, `B2`, `T2`, `C2`, ...) and `Status: Not started`. A Story gets a full "As a ___, I want ___, so that ___" subsection with acceptance criteria, under `## Web chat (business owner)` or `## Telegram bot (external customer)`. A Bug/Task/Chore gets a short entry under `## Bugs, tasks & chores` — what/why is enough, no story framing needed.
2. **Load it into context.** When it's time to work on an item, fill in `.claude/context/current-feature.md` with that item's ID, context/why, relevant files, and next steps. This is the file meant to be loaded into a session's context at the start of work on it.
3. **Work it the same way regardless of type**: read the relevant docs, confirm understanding, propose a plan, implement, verify — the usual plan-mode discipline this project has followed throughout.
4. **Close it out.** Once done (and tested, for anything touching guardrail/policy logic), the `plan-tracker` subagent updates the `Status` cell to `Done` and resets `.claude/context/current-feature.md` back to its placeholder state, so that file always reflects what's actually active, never stale finished work.

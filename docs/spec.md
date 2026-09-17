# Spec

This document defines *what* the system does — actors, capabilities, and guardrails. It intentionally does not cover *how* it's built: API shapes, architecture, and technology rationale belong in `docs/design.md`; phased build order belongs in `docs/plan.md`; user-story-level detail belongs in `docs/feature.md`. Those documents don't exist yet — where this spec would otherwise need to anticipate their content, it says so rather than inventing detail that hasn't been decided.

## Actors & scoping

| Actor | Surface | Access |
|---|---|---|
| Business owner | Web chat | Full read access to their own Stripe account's data; can initiate refunds and invoice creation, subject to confirmation |
| External customer | Telegram bot | Read/pay access to only the invoices belonging to their own linked Stripe customer record |

A customer's Telegram chat is linked to a Stripe customer via a `telegramChatId → stripeCustomerId` mapping, established through a `/start <link-token>` flow. This mapping is the only state the app persists — everything else is read from or written to Stripe at request time.

## Web chat capabilities (owner-facing)

- **Daily summaries** — natural-language recap of a day's activity (e.g. "summarize my day").
- **Refunds** — refund a specific payment by natural-language reference (e.g. "refund Maya's last payment").
- **Invoice creation, review & send** — build a multi-line-item invoice conversationally (e.g. "create an invoice for John Smith for 10 hours of consulting at $150/hour and 5 hours of development at $125/hour, due in 15 days"); the draft is created in Stripe immediately (no charge, nothing emailed) and shown with a deterministic review — missing customer email, that customer's overdue-invoice history, an unusually-high-amount flag, a possible-duplicate flag. Natural-language edits (e.g. "make it due in 15 days") update the same draft. Sending — the step that actually emails the customer — is a separate, explicitly confirmed action. Tax is not yet supported (always shown as "not configured").
- **Revenue comparisons** — compare revenue across time periods (e.g. "how much did we take last week compared to the week before").

These are illustrative, not exhaustive — see README §8 for the current example set.

## Telegram bot capabilities (customer-facing)

- **Link account** — `/start <link-token>` associates the customer's Telegram chat with their Stripe customer record.
- **View own invoices** — ask what they owe; see only invoices tied to their own linked customer id.
- **Pay an invoice** — pay an invoice that is below the payment cap, entirely within the chat.
- **Handoff above the cap** — an invoice at or above the cap is not payable through the bot; the customer is handed off (mechanism TBD in `design.md`/`plan.md`) instead.

## Guardrails / non-functional requirements

- **Payment cap** — $2,000, enforced in code on the server side. This is not a prompt instruction the model can be talked around; it's a check the code performs before any payment executes. Amounts are handled in cents (Stripe's native unit), so the boundary is "$2,000 or more" (`amount >= 200000`) — an invoice for exactly $2,000 is capped, not payable through the bot.
- **Customer scoping** — a Telegram customer's queries and actions are always constrained to their own linked `stripeCustomerId`. There is no code path by which one customer's chat can read or act on another customer's data; `customerId` is bound server-side from the chat-to-customer mapping and is never a parameter the model can set.
- **Confirmation before money moves** — refunds and payments require an explicit confirmation step; a confirmation that doesn't match the pending action is rejected rather than assumed to match. Invoice creation is more granular: drafting an invoice is safe and reversible (nothing is charged or emailed), so it happens without a confirmation step, but *sending* it — the point where the customer is actually notified — is still gated behind the same explicit-confirmation requirement as a refund.
- **Model never executes directly** — the LLM's role is to reason over the conversation and select from a fixed set of tools; the tools (not the model) perform reads and writes against Stripe. Full rationale deferred to `design.md`.
- **No LLM-side financial arithmetic** — totals, counts, and revenue comparisons are computed deterministically in code; the model only narrates the resulting numbers, it never derives them.

## Data & environment

- **Payments provider**: Stripe, test mode only for this phase — no live charges.
- **Persistence**: none beyond the `telegramChatId → stripeCustomerId` mapping; Stripe is the source of truth for customers, invoices, payments, and balances.
- **LLM provider**: OpenAI, via structured tool/function calling.
- **Seed data**: a fixed sandbox fixture — 4 test customers, a mix of successful and declined payments over the last few days, and invoices covering four states (paid, outstanding under the cap, overdue, at/above the cap). See README §4.

## Out of scope for this document

- API endpoint shapes and request/response contracts → `docs/design.md`.
- Architecture and technology choices (why Fastify, why grammY, why no database) → `docs/design.md`.
- Phased build sequencing → `docs/plan.md`.
- User-story-level walkthroughs → `docs/feature.md`.
- The full known-limitations list → `write-up.md` (README §9), to be summarized back into the README once finalized.

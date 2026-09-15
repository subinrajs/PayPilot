# Features

User-story-level detail for the capabilities defined in `docs/spec.md`. Each story includes acceptance criteria tied to the guardrails in `docs/spec.md` and the confirmation flow in `docs/design.md`.

The Status/Notes table below is kept in sync with implementation by the `plan-tracker` subagent (`.claude/agents/plan-tracker.md`) — a row is only marked `Done` once the story's acceptance criteria are implemented and, where they cover guardrail/policy behavior, tested.

## Status

| # | Feature | Actor | Status | Notes |
|---|---|---|---|---|
| 1 | Daily summary | Owner | Done | |
| 2 | Refund a payment | Owner | Done | |
| 3 | Create an invoice | Owner | Done | |
| 4 | Compare revenue across periods | Owner | Done | |
| 5 | Link Telegram chat to Stripe customer | Customer | Not started | |
| 6 | View what I owe | Customer | Not started | |
| 7 | Pay an invoice under the cap | Customer | Not started | |
| 8 | Handoff for an invoice at or above the cap | Customer | Not started | Handoff mechanism still open, see `docs/design.md` |

## Web chat (business owner)

### 1. Daily summary

As the business owner, I want to ask for a summary of a day's activity, so that I can check in without opening the Stripe dashboard.

- Given a day with a mix of payments (successful and declined), asking to "summarize my day" (or similar) returns a natural-language summary grounded in that day's actual Stripe data.
- The summary is read-only and executes immediately — no confirmation step.
- If the day has no activity, the assistant says so rather than fabricating numbers.

### 2. Refund a payment

As the business owner, I want to refund a specific payment by describing it in natural language, so that I don't have to look up the payment id manually.

- Given an instruction like "refund Maya's last payment," the assistant identifies the specific payment, and returns a pending action describing exactly what will be refunded (customer, amount, payment reference) rather than executing immediately.
- The owner must explicitly confirm before the refund is issued to Stripe.
- If the reference is ambiguous (e.g., multiple candidate payments), the assistant asks for clarification instead of guessing.
- Confirming a pending action whose underlying payment no longer matches (e.g., expired, already refunded) is rejected with a clear error, not silently applied to something else.

### 3. Create an invoice

As the business owner, I want to create an invoice with amount, recipient, and due date in a single instruction, so that I can bill a customer without leaving chat.

- Given an instruction like "create a $250 invoice for Acme Corp due next Friday," the assistant resolves the recipient to a Stripe customer, resolves the relative date, and returns a pending action showing amount, recipient, and due date for confirmation.
- The invoice is only created in Stripe after explicit confirmation.
- An unresolvable recipient (no matching customer) is reported to the owner rather than silently creating a new one.

### 4. Compare revenue across periods

As the business owner, I want to compare revenue between two time periods, so that I can see whether the business is trending up or down without pulling reports manually.

- Given an instruction like "how much did we take last week compared to the week before," the assistant returns both period totals and the difference, grounded in Stripe data.
- Read-only — executes immediately, no confirmation step.

## Telegram bot (external customer)

### 5. Link Telegram chat to Stripe customer

As a customer, I want to connect my Telegram chat to my account, so that the bot knows which invoices are mine.

- `/start <link-token>` establishes the `telegramChatId → stripeCustomerId` mapping for that chat.
- An invalid or already-used token is rejected with a clear message; no mapping is created.
- Until linked, the bot cannot answer any invoice question for that chat — there is no "unscoped" fallback.

### 6. View what I owe

As a linked customer, I want to ask what I owe, so that I don't have to guess or wait for an email.

- Returns only invoices belonging to the chat's linked `stripeCustomerId` — never another customer's.
- If nothing is owed, the bot says so rather than returning an empty/ambiguous response.

### 7. Pay an invoice under the cap

As a linked customer, I want to pay an outstanding invoice directly in the chat, so that I don't need a separate payment page.

- For an invoice below the $2,000 cap, the bot returns a pending action; the customer confirms; only then does Stripe process the payment.
- A confirmation that doesn't match the pending invoice/amount is rejected.
- Successful payment is reflected back to the customer in the chat (and is visible to the owner via Stripe, per "Stripe is the source of truth").

### 8. Handoff for an invoice at or above the cap

As a linked customer with an invoice at or above $2,000, I want to be told how to pay it, so that I'm not stuck when the bot can't process it directly.

- The bot never offers a payable pending action for an invoice at/above the cap — this is enforced in code (per `docs/design.md`), not by asking the model to decline.
- The customer is told the invoice needs to be handled outside the bot, with next steps (exact handoff mechanism: open item, see `docs/design.md`).

# Intent

## Problem

Running a small business on Stripe means routine work happens in two different places. The owner has to open the Stripe dashboard just to answer questions they already know the shape of — "how did we do today," "did that refund go through," "what's still outstanding" — and to take actions that don't need a full dashboard, like issuing a refund or creating an invoice. None of that requires the dashboard's full surface area; it requires quick, conversational access to data and a small set of actions.

Separately, the business's customers have no lightweight way to check what they owe and pay it. Today that means either a support back-and-forth, or handing the customer broad access to a payment portal that shows more than their own account. Neither is a good fit for a quick "what do I owe, let me pay it" interaction.

Both problems share a root cause: Stripe's dashboard is built for full account access, not for a narrow, conversational slice of it — one slice for the owner, a much narrower one for each customer.

## Who it's for

**Business owner** (internal, trusted user)
Wants to ask questions and take action against their own Stripe data in natural language, without switching into the dashboard. Trusted with full read access to their account's data and with initiating money-moving actions (refunds, invoices), subject to confirming those actions before they execute.

**External customer** (untrusted, scoped user)
Reached via Telegram rather than the web app. Wants to check what they owe and pay it without contacting support or being given dashboard access. Must never see or affect any other customer's data — only their own, linked invoices.

## What success looks like

- The owner gets answers grounded in live Stripe data, not model-generated guesses — summaries and revenue comparisons reflect what Stripe actually shows.
- The owner can trigger refunds and create invoices from chat, with an explicit confirmation step between "I asked for this" and "this happened" — no money moves on a single ambiguous message.
- A customer can link their Telegram chat to their own Stripe customer record and, from then on, see and pay only their own invoices — never another customer's.
- The $2,000 payment cap is a hard, code-enforced limit, not a guideline the model is asked to respect — an invoice at or above the cap is handed off rather than paid through the bot, regardless of what the conversation says.
- The app introduces no second copy of financial truth: Stripe remains authoritative for balances, invoices, and payments, and the app persists nothing beyond the minimal link between a Telegram chat and a Stripe customer.

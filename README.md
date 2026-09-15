# AI Payments Assistant

A business-owner web chat assistant over Stripe — natural-language daily summaries, refunds, invoices, and revenue comparisons — plus a Telegram bot that lets external customers view and pay only their own invoices, with a $2,000 payment cap enforced in code.

> Internal design/planning docs live in `docs/` (`intent.md`, `spec.md`, `design.md`, `plan.md`, `feature.md`, `decisions.md`, `onboarding.md`) and `CLAUDE.md` at the root — this README is the quickstart; new to the project? See `docs/onboarding.md` for the detailed, step-by-step version.

---

## 1. Architecture overview

A pnpm workspace with two packages: `apps/web` (the owner's chat UI) and `apps/api` (everything else — the REST API, the LLM tool-calling loop, Stripe integration, and the Telegram bot, all in one process). Stripe is the only system of record; the app persists nothing beyond a single in-memory `telegramChatId → stripeCustomerId` mapping.

- **Frontend:** React + Vite + TypeScript — single-page chat UI
- **Backend:** Node.js + Fastify + TypeScript — REST API, agent orchestration, Stripe integration
- **LLM:** OpenAI API, structured tool/function calling — the model reasons and selects tools; it never executes anything directly (see "Core principle" in `docs/design.md`)
- **Payments:** Stripe Node SDK, test mode only
- **Telegram bot:** grammY, running in the same process as the API (`apps/api/src/telegram/bot.ts`), calling the same tool implementations in-process rather than over HTTP
- **Persistence:** none beyond a `telegramChatId → stripeCustomerId` mapping — Stripe is the source of truth for everything else

**Why these choices:** Fastify over Express for first-class TypeScript ergonomics and built-in JSON-schema validation on the tool-call/pending-action payloads this API mostly exists to validate. OpenAI for its mature structured tool/function-calling support, which the "model never executes directly" principle depends on. grammY over node-telegram-bot-api for a modern, typed middleware API that simplifies the `/start <token>` linking flow. No database, because Stripe already is the system of record for customers, invoices, and payments — the one fact it doesn't hold (which Telegram chat maps to which customer) is small enough for an in-memory map rather than a second, syncable copy of financial data. Full rationale for each: `docs/decisions.md` (ADR-001 through ADR-004).

**API design:** Three routes, all in `apps/api/src/routes/`. `POST /api/assistant` takes the owner's chat messages, runs the OpenAI tool-calling loop, and returns either a read-only tool's result (executed immediately) or a **pending action** (id, tool name, resolved arguments, expiry) for anything that moves money. `POST /api/assistant/confirm` confirms or cancels a pending action by id — the backend re-validates the id against its stored pending action (never trusting client-supplied arguments) before calling Stripe, and a stale, altered, or unrecognized id is rejected rather than executed. `GET /api/health` is a liveness check. The Telegram bot never goes through this HTTP surface at all — its grammY handlers call the same tool implementations directly in-process, applying the same confirmation and cap logic. Full detail: `docs/design.md` "API surface."

---

## 2. Prerequisites

- Node.js (LTS) and pnpm
- A free [Stripe](https://stripe.com) account, in **test mode** — no card required
- An OpenAI API key ([platform.openai.com](https://platform.openai.com))
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

---

## 3. Setup

```bash
git clone <repo-url>
cd ai-payments-assistant
pnpm install
cp apps/api/.env.example apps/api/.env
```

Fill in `apps/api/.env`:

```bash
STRIPE_SECRET_KEY=sk_test_...
OPENAI_API_KEY=sk-...
TELEGRAM_BOT_TOKEN=...
```

---

## 4. Seed the Stripe sandbox

**Run this once, against a fresh/empty Stripe test account** (the app assumes nothing was created by hand in the dashboard):

```bash
pnpm seed
```

This creates:
- 4 test customers (Maya Rodriguez, Acme Corp, John Smith, Sarah Johnson)
- A mix of successful and declined payments spread across the last few days
- Invoices: one paid, one outstanding (< $2,000), one overdue, one at/above $2,000

---

## 5. Run the app

```bash
pnpm dev
```

This starts the web app and API together. Individually:

```bash
pnpm --filter web dev     # frontend only
pnpm --filter api dev     # backend only
```

Open the web app at `http://localhost:5173` (API runs at `http://localhost:3000`).

---

## 6. Run the Telegram bot

The bot starts automatically alongside the API — there's no separate command. `pnpm dev` (or `pnpm --filter api dev`) calls `startTelegramBot()` once the Fastify server is listening; if `TELEGRAM_BOT_TOKEN` isn't set in `apps/api/.env`, it logs a warning and skips starting rather than crashing the server, so the rest of the app still works without it.

To test as a customer:
1. Message your bot on Telegram directly (linking only works in a private 1:1 chat, not a group — the `telegramChatId → stripeCustomerId` mapping is per-chat, so a group chat would be shared by everyone in it)
2. `/start <link-token>` — the link-token is the linked customer's Stripe id, printed by `pnpm seed` (§4)
3. `/owe` to see outstanding invoices; tap **Pay** on one under $2,000, then **Confirm**
4. Try an invoice at/above $2,000 — instead of a Pay button, you'll see a direct link to Stripe's own hosted invoice page (that page is Stripe's own payment surface, not something this bot's $2,000 cap governs)

---

## 7. Run tests

```bash
pnpm --filter api test
```

Covers the guardrail/policy logic: the $2,000 threshold, Telegram customer scoping, and confirmation-mismatch rejection — see `docs/plan.md` Phase 7.

---

## 8. Trying the core commands

In the web chat:
- "Summarize my day"
- "Refund Maya's last payment"
- "Create a $250 invoice for Acme Corp due next Friday"
- "How much did we take last week compared to the week before?"

---

## 9. Known limitations

See `write-up.md` for full detail on each of these:

- Seeded charges all land on the real day `pnpm seed` was run — Stripe test clocks don't backdate a `Charge`'s `created` timestamp, so the fixture can't demonstrate a multi-day revenue comparison from a single seed run.
- The Telegram chat-to-customer mapping is in-memory only and doesn't survive an API restart.
- The Telegram link-token is a real Stripe customer id, not a separately issued opaque secret — fine in test mode, would need revisiting for a live account.
- Stripe test clocks cap at 3 customers each, which is why the seed script batches its 4 customers into more than one clock.
- The Telegram bot's grammY wiring layer (as opposed to its underlying tool/guardrail logic, which is fully unit-tested) is verified by live manual testing rather than automated tests.

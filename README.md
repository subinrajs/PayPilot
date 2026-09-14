# AI Payments Assistant

A business-owner web chat assistant over Stripe — natural-language daily summaries, refunds, invoices, and revenue comparisons — plus a Telegram bot that lets external customers view and pay only their own invoices, with a $2,000 payment cap enforced in code.

> Internal design/planning docs live in `docs/` (`intent.md`, `spec.md`, `design.md`, `plan.md`, `feature.md`, `decisions.md`) and `CLAUDE.md` at the root — this README is the setup guide for running the app.

---

## 1. Architecture overview

*(Fill in once implementation stabilizes — pull the short version from `docs/design.md` rather than duplicating it in full.)*

- **Frontend:** React + Vite + TypeScript — single-page chat UI
- **Backend:** Node.js + Fastify + TypeScript — REST API, agent orchestration, Stripe integration
- **LLM:** OpenAI API, structured tool/function calling — the model reasons and selects tools; it never executes anything directly (see "Core principle" in `docs/design.md`)
- **Payments:** Stripe Node SDK, test mode only
- **Telegram bot:** grammY
- **Persistence:** none beyond a `telegramChatId → stripeCustomerId` mapping — Stripe is the source of truth for everything else

**Why these choices:** *(one or two sentences per major choice — Fastify over Express, OpenAI over another provider, grammY over node-telegram-bot-api, no database. Link back to `docs/design.md` for the full rationale rather than repeating it here.)*

**API design:** *(Summarize `POST /api/assistant`, `POST /api/assistant/confirm`, `GET /api/health` — see `docs/design.md` "API surface" for the canonical version.)*

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

*(Fill in: how the bot is started — same process as the API, or `pnpm --filter api telegram`? — and how to link a test customer, e.g. `/start <token>` from `docs/spec.md` §2.1.)*

To test as a customer:
1. Message the bot on Telegram
2. `/start <link-token>` to associate your chat with a seeded customer
3. Ask "what do I owe?" and try paying an invoice under $2,000
4. Try an invoice at/above $2,000 to confirm it's handed off instead of paid

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

See `write-up.md` for the full list — summarized here once finalized.

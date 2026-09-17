# Onboarding

A comprehensive, step-by-step guide for a new developer setting up PayPilot on a fresh machine and starting to work on features, bugs, tasks, or chores. If you just want the short version, see `README.md` — this doc is the detailed one, and takes precedence if the two ever disagree.

PayPilot is an AI payments assistant over Stripe: a web chat for a business owner (daily summaries, refunds, invoice creation, revenue comparisons) plus a Telegram bot that lets external customers view and pay only their own invoices, with a $2,000 payment cap enforced in code. See `docs/intent.md` for the full problem statement and who it's for.

---

## 1. Prerequisites

### Node.js and pnpm

You need a reasonably recent Node.js (the LTS line — Node 20 or newer is safe; this repo doesn't pin an exact version via `.nvmrc`, but everything here was built and tested on Node 24).

This repo pins its package manager exactly: `"packageManager": "pnpm@12.4.1"` in the root `package.json`. Use [Corepack](https://nodejs.org/api/corepack.html) (bundled with Node) to get that exact version rather than installing pnpm some other way:

```bash
corepack enable
```

**A real gotcha on macOS**: if Corepack or `npm install -g` tries to write into `/usr/local/bin` and that directory is root-owned on your machine, the install will fail with a permission error. Don't reach for `sudo` — install pnpm to a directory you own instead and put it on your `PATH`:

```bash
# if corepack enable fails with a permission error:
mkdir -p ~/.local/bin
corepack enable --install-directory ~/.local/bin
export PATH="$HOME/.local/bin:$PATH"   # add this line to your ~/.zshrc or ~/.bashrc too
```

Verify:

```bash
pnpm -v   # should print 12.4.1
```

### Git

Standard Git, any reasonably recent version.

### Credentials — Stripe, OpenAI, Telegram

You'll need three things before the app is fully runnable, plus an optional fourth for the payment-webhook notification (S13). All are free to obtain; only the OpenAI one requires billing to be enabled on your account before it will actually respond to requests.

**Stripe (test mode)**
1. Sign up at [stripe.com](https://stripe.com) (or log in if you already have an account).
2. Make sure you're in **Test mode** — there's a toggle for this in the Stripe Dashboard (top-right area). Everything in this project only ever touches test mode; no real card or real money is ever involved.
3. Go to **Developers → API keys**.
4. Copy the **Secret key** (starts with `sk_test_...`). This is your `STRIPE_SECRET_KEY`.

**OpenAI**
1. Sign up or log in at [platform.openai.com](https://platform.openai.com).
2. Go to **API keys** in the left sidebar.
3. Click **Create new secret key**, give it any name, and copy the value (starts with `sk-...`). You will not be able to see it again after this — if you lose it, just create another one. This is your `OPENAI_API_KEY`.
4. Make sure your OpenAI account has billing/a payment method set up — a key with no billing enabled will fail every request with an authentication/quota error, which can look confusingly like a bad key.
5. The app defaults to the `gpt-4o-mini` model (`apps/api/src/openai.ts`). You can override this with an optional `OPENAI_MODEL` environment variable if you want a different model — it isn't listed in `.env.example` since the default is almost always fine.

**Telegram bot token** (optional to start — the app runs fine without it; the bot just won't start, with a warning logged instead of a crash)
1. Open Telegram and start a chat with **@BotFather** (Telegram's own bot for creating bots).
2. Send `/newbot`.
3. When asked, type a **display name** for your bot (e.g. "PayPilot Dev").
4. When asked for a **username**, type something unique that ends in `bot` (e.g. `paypilot_yourname_bot`) — BotFather will tell you if it's taken.
5. BotFather replies with a token that looks like `123456789:AAExampleTokenValueGoesHere`. This is your `TELEGRAM_BOT_TOKEN`.

**Stripe webhook signing secret** (optional — only needed to test S13's payment-received notification; the rest of the app runs fine without it)
1. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli) if you don't already have it, and run `stripe login` once.
2. With the API running locally (`pnpm dev`, see below), run: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
3. It prints a signing secret starting with `whsec_...` — that's your `STRIPE_WEBHOOK_SECRET`. Leave this command running in its own terminal while you test; it forwards real test-mode Stripe events to your local server.

---

## 2. Clone, install, configure

```bash
git clone https://github.com/subinrajs/PayPilot.git
cd PayPilot
pnpm install
```

`pnpm install` sets up the whole workspace (`apps/web` and `apps/api`) in one go — there's no need to install inside each app's folder separately.

Now set up your environment file:

```bash
cp apps/api/.env.example apps/api/.env
```

Open `apps/api/.env` and fill in the keys from step 1 (`STRIPE_WEBHOOK_SECRET` only if you're testing S13 — leave it blank otherwise):

```bash
STRIPE_SECRET_KEY=sk_test_...
OPENAI_API_KEY=sk-...
TELEGRAM_BOT_TOKEN=123456789:AAExampleTokenValueGoesHere
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Never commit real secrets.** `apps/api/.env` is already gitignored — only `apps/api/.env.example` (which stays empty) is tracked in git. Before any commit, it's worth a quick `git status` glance to make sure `.env` isn't staged and no key value ended up somewhere it shouldn't (a screenshot, a log line, a test fixture).

---

## 3. Seed the Stripe sandbox

Run this once:

```bash
pnpm seed
```

**Important:** run this against a fresh/empty Stripe test account. The script assumes nothing was created by hand in the dashboard beforehand.

This creates:
- 4 test customers: Maya Rodriguez, Acme Corp, John Smith, Sarah Johnson
- A mix of successful and declined payments
- Four invoice states: one paid, one outstanding (under the $2,000 cap), one overdue, one at/above the $2,000 cap

The script prints each customer's Stripe id — **note these down**, or just re-run `pnpm seed` later to see them again. Each one doubles as that customer's Telegram link-token (see §4).

The script is **idempotent** — it checks for already-created customers and invoices and skips them rather than duplicating, so re-running it is safe if something goes wrong partway through, or if you just want to see the printed ids again.

---

## 4. Run it

```bash
pnpm dev
```

This starts both the web app and the API together. To run just one:

```bash
pnpm --filter web dev     # frontend only, http://localhost:5173
pnpm --filter api dev     # backend only, http://localhost:3000
```

Sanity-check the API is up:

```bash
curl http://localhost:3000/api/health
# {"status":"ok"}
```

Then open **http://localhost:5173** in a browser and try:
- "Summarize my day"
- "Refund Maya's last payment"
- "Create a $250 invoice for Acme Corp due next Friday"
- "How much did we take last week compared to the week before?"

### Trying the Telegram bot (optional)

If you set a `TELEGRAM_BOT_TOKEN`, the bot starts automatically alongside the API — there's no separate command to run. (If the token isn't set, you'll see a warning logged and the rest of the app keeps working normally.)

1. Message your bot directly on Telegram — linking only works in a private 1:1 chat, not a group.
2. Send `/start <link-token>`, using one of the customer ids `pnpm seed` printed (e.g. `/start cus_ABC123`).
3. Send `/owe` to see outstanding invoices. Tap **Pay** on one under $2,000, then **Confirm**.
4. Try an invoice at/above $2,000 — instead of a Pay button, you'll get a direct link to Stripe's own hosted invoice page (that's Stripe's own payment surface, not something this bot's cap governs).

---

## 5. Run the checks

Before considering any change done, run:

```bash
pnpm --filter api test                             # the full Vitest suite
pnpm --filter api exec tsc --noEmit -p tsconfig.test.json # type-check src/ + test/ together
pnpm --filter web build                            # type-checks and builds the frontend
```

Tests live in a dedicated `apps/api/test/` folder, mirroring `apps/api/src/`'s structure exactly (e.g. `apps/api/src/policies/payment-policy.ts` is covered by `apps/api/test/policies/payment-policy.test.ts`) — kept separate from production code so `apps/api/tsconfig.json`'s real build never sweeps up test code (`apps/api/tsconfig.test.json` extends it with `test/` added, purely for type-checking). Two shared fixture modules are used throughout:
- `apps/api/test/support/fake-stripe.ts` — a fake Stripe client plus fixtures (`fakeCustomer`, `fakeCharge`, `fakeInvoice`) and an `asyncIterableList` helper for mocking `for await` list calls.
- `apps/api/test/support/fake-openai.ts` — a fake OpenAI client plus a `toolCall()`/`completionOf()` helper pair for simulating the model's tool-calling behavior.

Anything touching `policies/`, `agent/`, or `telegram/` should get real test coverage, not just a manual check — see §6's non-negotiable rules for why this matters more here than in a typical app.

---

## 6. Understand the codebase

### Read the docs in this order

1. `docs/intent.md` — the problem, who it's for, what success looks like.
2. `docs/spec.md` — functional scope: actors, capabilities, guardrails, what's explicitly out of scope.
3. `docs/design.md` — architecture, tech-choice rationale, the API surface.
4. `docs/plan.md` — the historical phased build order (all 8 phases are done — this is a record, not something you add to).
5. `docs/feature.md` — the **active work backlog** (see §8 below) — this is where you add and find things to work on.
6. `docs/decisions.md` — ADRs explaining individual technical choices (why Fastify, why grammY, why no database, why the confirmation flow works the way it does, etc.).
7. `CLAUDE.md` — a condensed reference combining architecture, non-negotiable rules, and the available Claude Code subagents (see §9). Read even if you're not using Claude Code yourself — the rules apply regardless of tooling.
8. `write-up.md` — known limitations, and why each was left as-is.
9. `CHANGELOG.md` — release history.

### Repo layout

```
apps/
  web/                 React + Vite + TypeScript — the owner's chat UI
    src/
      components/       Sidebar, MessageList, MessageBubble, ChatInput, PendingActionPanel, ...
      api.ts             fetch layer + wire types for the two API routes
  api/                 Node + Fastify + TypeScript — everything else, one process
    src/                 production code only
      policies/          payment-policy.ts ($2,000 cap), authorization.ts (customer scoping)
      agent/
        tools/             one file per tool (refund, invoice-creation, invoice-lookup, ...)
        loop.ts             the OpenAI tool-calling loop
        tool-registry.ts    the exact set of tools the model can call
        system-prompt.ts    the system prompt
      telegram/
        bot.ts              grammY bot: linking, invoice view/pay, handoff
        session.ts          telegramChatId → stripeCustomerId mapping
      routes/
        assistant.ts        POST /api/assistant, POST /api/assistant/confirm
        health.ts           GET /api/health
      seed.ts              the pnpm seed script
    test/                mirrors src/'s structure exactly — every *.test.ts lives here, not in src/
      support/             shared fake-Stripe/fake-OpenAI test fixtures
    tsconfig.json        production build config (include: ["src"])
    tsconfig.test.json   extends tsconfig.json, adds test/, for full-coverage type-checking
docs/                  intent, spec, design, plan, feature (backlog), decisions, this file
.claude/
  agents/              subagent definitions (see §9)
  context/
    current-feature.md  whatever's actively being worked on right now (see §8)
CLAUDE.md              condensed architecture + rules + subagents, for any session working here
```

### The five non-negotiable rules (from `CLAUDE.md`)

These hold regardless of what feature you're touching:

1. Every mutating Stripe call passes through `policies/authorization.ts` and/or `policies/payment-policy.ts` — no refund/invoice/payment code path calls Stripe directly.
2. No financial arithmetic (totals, % change, comparisons) inside a prompt or an LLM-facing function — it belongs in a deterministic aggregation module (`agent/aggregation.ts`). The model only ever narrates numbers it's handed; it never computes them.
3. Telegram-scoped tools never accept `customerId` as a caller-supplied parameter — it's bound server-side from the chat session, never something the model can set.
4. The $2,000 cap boundary is "$2,000 or more" (`amount >= 200000` in cents) — checked before every Telegram payment path calls Stripe.
5. Money-moving actions (refund, invoice creation, invoice payment) always go through a pending-action + explicit confirm step; `POST /api/assistant/confirm` re-validates against the stored pending action rather than trusting whatever the client sends.

---

## 7. How work is tracked, and how to start on something

`docs/feature.md` is the live backlog — not just user stories. It tracks four types of work:

- **Story** — a user-facing capability from `docs/spec.md`. Gets a full "As a ___, I want ___, so that ___" subsection with acceptance criteria.
- **Bug** — something built that behaves incorrectly.
- **Task** — a discrete piece of implementation work that isn't itself user-facing (an internal tool, a refactor).
- **Chore** — maintenance with no functional behavior change (docs, cleanup, dependency bumps).

Each item has an ID prefixed by type (`S1`, `B1`, `T1`, `C1`, ...) and a row in `feature.md`'s `## Status` table. Bugs/Tasks/Chores get a short write-up under `## Bugs, tasks & chores`; Stories get a full subsection under `## Web chat (business owner)` or `## Telegram bot (external customer)`.

**To pick something up:**

1. Find (or add) its row in `docs/feature.md`. If it's new, give it the next ID in its type's sequence and set `Status: Not started`.
2. Fill in `.claude/context/current-feature.md` with that item's ID, why it matters, the relevant files, and next steps. This file is meant to be loaded into a session's context at the start of work — it should only ever describe what's genuinely active right now.
3. Work it through the same discipline regardless of type: understand what's being asked, propose an approach, implement it, verify it (tests + type-check, plus the subagents in §8 for anything touching money or customer data), then update the docs.
4. Once it's done and verified, mark `docs/feature.md`'s `Status` cell `Done` and reset `.claude/context/current-feature.md` back to its placeholder — see `docs/feature.md`'s own "Maintaining this backlog" section for the full detail.

**Commit conventions actually used in this repo:** direct commits to `main` (no feature-branch/PR ceremony has been used so far — introduce one if the team grows past what direct-to-main comfortably supports), descriptive commit messages explaining *why* a change was made, and committing only once a change is verified and ready — not speculatively mid-work.

---

## 8. Working with Claude Code on this repo

This project has been built and maintained through Claude Code, using `CLAUDE.md` as the always-loaded reference for architecture, the non-negotiable rules, and four project-scoped subagents defined in `.claude/agents/`:

- **test-runner** — runs `pnpm --filter api test` and reports only failures concisely. Use after changing anything in `policies/`, `agent/`, or `telegram/`.
- **guardrail-auditor** — adversarially traces the code for each financial guardrail (cap, customer isolation, no LLM-side arithmetic, confirmation-before-mutation) and reports PASS/FAIL per guardrail with exact file/line references. Use before considering any change that touches money or customer data done.
- **code-reviewer** — reviews a `git diff` against `CLAUDE.md`'s non-negotiable rules and `docs/design.md`'s security model. Use right after writing or modifying code, especially under `policies/` or `agent/`.
- **plan-tracker** — keeps `docs/plan.md` and `docs/feature.md` synced against actual repo state, and resets `.claude/context/current-feature.md` once the item it names is done. Use after completing anything.

Even if you're working by hand rather than through Claude Code, the same rules and the same verification discipline apply — `CLAUDE.md` is a good five-minute read regardless.

---

## 9. Troubleshooting

**`pnpm: command not found` or a permission error enabling Corepack**
See the macOS gotcha in §1 — install pnpm to a directory you own (e.g. `~/.local/bin`) and make sure it's on your `PATH`, rather than using `sudo`.

**Port 3000 or 5173 already in use**
Likely a stale dev server from an earlier run. Find and stop it:
```bash
lsof -ti:3000,5173 | xargs kill
```

**OpenAI requests fail with an auth or quota error**
Almost always means billing isn't enabled on the OpenAI account the key belongs to, or the key was mistyped/truncated when copied. Double-check both in the OpenAI dashboard.

**A seeded customer doesn't show up when Stripe's dashboard/API is queried directly**
Every seed customer is attached to a Stripe test clock (used to simulate dates), and a plain `customers.list()` call doesn't return test-clock-attached customers — Stripe only returns them when the list call is filtered by that specific `test_clock` id. The app's own code already handles this (`agent/customer-resolution.ts`); it only bites if you're poking at the Stripe dashboard/API directly outside the app.

**Wondering why a Telegram customer's invoice total looks "off" across days**
See `write-up.md`'s first known limitation — Stripe test clocks don't backdate a charge's `created` timestamp, so seeded charges all land on whichever real day `pnpm seed` was actually run, not spread across the simulated days.

---

## 10. Where to go next

- `README.md` — the short version of §§1–5 above, if you just need a command reference later.
- `docs/feature.md` — what's actually queued up to work on right now.

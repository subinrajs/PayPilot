# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

No application code exists yet — this repo currently holds only `README.md` and the planning docs in `docs/`. The commands and architecture below describe the intended shape of the app (per those docs), not something you can run today. Treat `docs/plan.md`'s phases as the build order; update this file's "Commands" section with real, verified commands as soon as the corresponding scaffolding (workspace, `package.json` scripts) actually exists — don't assume the commands below work without checking.

## Commands (intended, per README/docs/plan.md)

```bash
pnpm install                    # install deps (pnpm workspace: apps/web, apps/api)
pnpm seed                       # seed the Stripe test-mode sandbox — run once, against an empty account
pnpm dev                        # run web + api together
pnpm --filter web dev           # frontend only
pnpm --filter api dev           # backend only
pnpm --filter api test          # guardrail/policy tests — cap threshold, Telegram scoping, confirmation-mismatch rejection (docs/plan.md Phase 7)
```

`pnpm seed` must be run against a fresh/empty Stripe test account — the app assumes nothing was created by hand in the dashboard.

## Architecture

Read `docs/design.md` for full rationale; this is the summary needed to navigate the code once it exists.

- **Frontend** (`apps/web`): React + Vite + TypeScript, single-page chat UI for the business owner.
- **Backend** (`apps/api`): Node.js + Fastify + TypeScript. Hosts the REST API, the LLM tool-calling loop, Stripe integration, and the Telegram bot (grammY) — the bot runs in the **same process** as the API, calling tool implementations in-process rather than over HTTP.
- **LLM**: OpenAI API, structured tool/function calling.
- **Payments**: Stripe Node SDK, test mode only.
- **Persistence**: none beyond a `telegramChatId → stripeCustomerId` map. Stripe is the source of truth for every customer, invoice, and payment — never introduce a local copy of that data.

### Core principle: the model never executes directly

> "The LLM is responsible for reasoning and language; application code is responsible for authority and execution."

The LLM only selects from a fixed set of tools and supplies arguments; it cannot call Stripe itself. This has a specific consequence for any tool that moves money (refund, invoice creation, invoice payment):

1. Tool selection returns a **pending action** (id, tool, resolved arguments, expiry) — it does not execute.
2. The user (owner or Telegram customer) explicitly confirms.
3. The backend re-validates the confirmation against that exact pending action — a mismatched, stale, or unknown confirmation is rejected, never assumed to match the "most recent" pending action.
4. Only then is Stripe called.

Read-only tools (summaries, revenue comparisons, invoice lookups) execute immediately — no pending-action step.

The **$2,000 payment cap** is a plain conditional in this backend payment path, checked before step 4 — it is enforced in code, not via prompt instruction, and holds regardless of what the model or conversation says. An invoice at/above the cap must never produce a payable pending action; route it to handoff instead.

Two further consequences: financial totals (summaries, revenue comparisons) are computed by a deterministic module and only the resulting JSON goes to the model — it narrates numbers, it never computes them. And `customerId` for Telegram-scoped tools is bound server-side from the chat-to-customer mapping, never accepted as a tool parameter the model can set.

### Internal structure (`apps/api/src`)

```
apps/api/src/
  policies/
    payment-policy.ts   # $2,000 cap — amounts in cents, so `amount >= 200000`
    authorization.ts     # server-side customer scoping
  agent/
    tools/                # tool implementations
    loop.ts                # OpenAI tool-calling loop
  telegram/
    bot.ts                  # grammY bot: linking, invoice view/pay, handoff
    session.ts                # telegramChatId → stripeCustomerId mapping
  routes/
    assistant.ts                # POST /api/assistant, POST /api/assistant/confirm
    health.ts                     # GET /api/health
```

Every mutating Stripe call must pass through `policies/payment-policy.ts` and/or `policies/authorization.ts` — never call Stripe directly for a money-moving action.

### Non-negotiable rules

- Every mutating Stripe call passes through `policies/authorization.ts` and/or `policies/payment-policy.ts` — no refund/invoice/payment code path calls Stripe directly.
- No financial arithmetic (totals, % change, comparisons) inside a prompt or an LLM-facing function — it belongs in a deterministic aggregation module.
- Telegram-scoped tools never accept `customerId` as a caller-supplied parameter — bound server-side from the session.
- The $2,000 cap boundary is "$2,000 or more" (`amount >= 200000` in cents) — checked before every Telegram payment path calls Stripe.
- Money-moving actions (refund, invoice creation, invoice payment) always go through pending-action + explicit confirm; `/api/assistant/confirm` re-validates against the original pending action rather than trusting the confirmation payload.
- Input validated with Zod at every tool boundary.

### API surface

- `POST /api/assistant` — owner chat message in, tool-calling loop runs, returns either a result (read-only tool) or a pending action (money-moving tool).
- `POST /api/assistant/confirm` — confirms/cancels a pending action by id; only executes Stripe call on a validated match.
- `GET /api/health` — liveness check.

### Actor scoping

- **Business owner** (web chat): full read access to their own Stripe account's data; can initiate money-moving actions subject to confirmation.
- **Telegram customer**: linked via `/start <link-token>` to exactly one `stripeCustomerId`. Every query and action for that chat is constrained to that customer id — there is no code path where one customer's chat can read or act on another's data.

## Subagents

Defined in `.claude/agents/`, scoped to this project:

- **test-runner** — runs `pnpm --filter api test` and reports only failures concisely. Use after changing anything in `policies/`, `agent/`, or `telegram/`.
- **guardrail-auditor** — adversarially traces the code for each financial guardrail (cap, customer isolation, no LLM-side arithmetic, confirmation-before-mutation) and reports PASS/FAIL per guardrail with exact file/line. Use proactively before considering any phase touching money or customer data done.
- **code-reviewer** — reviews `git diff` against this file's "Non-negotiable rules" and `docs/design.md`'s security model. Use immediately after writing or modifying code, especially under `policies/` or `agent/`.
- **plan-tracker** — syncs `docs/plan.md`'s checkboxes/status table and `docs/feature.md`'s Status column against actual repo state. Use after completing a phase or feature.

## Where to look

The docs in `docs/` are the source of truth for intent and scope — read them before making product/behavior decisions, don't re-derive from the README alone:

- `docs/intent.md` — problem, who it's for, success criteria.
- `docs/spec.md` — functional scope: actors, capabilities, guardrails, what's explicitly out of scope.
- `docs/design.md` — architecture, tech-choice rationale, API surface (fuller version of this file's Architecture section).
- `docs/plan.md` — phased build order.
- `docs/feature.md` — user-story-level acceptance criteria per capability.
- `docs/decisions.md` — ADRs for individual technical choices (Fastify, OpenAI, grammY, no database, single-process bot, confirmation flow, cap enforcement).

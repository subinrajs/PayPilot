# Plan

Phased build sequence for the system described in `docs/spec.md` and `docs/design.md`. Each phase should leave the app in a runnable state; later phases depend on earlier ones.

Checkboxes below are only marked done once the corresponding code exists **and**, for guardrail/policy items, is covered by a passing test — not on code existing alone. Kept in sync by the `plan-tracker` subagent (`.claude/agents/plan-tracker.md`); don't hand-edit the status table without also updating the matching checkboxes, or vice versa.

## Phase status

| Phase | Name | Status |
|---|---|---|
| 1 | Scaffolding & environment | Done |
| 2 | Stripe sandbox seed script | Not started |
| 3 | Backend core: tools & Stripe integration | Not started |
| 4 | Web chat assistant | Not started |
| 5 | Web chat UI | Not started |
| 6 | Telegram bot | Not started |
| 7 | Guardrail/policy test suite | Not started |
| 8 | Polish & known limitations | Not started |

## Phase 1 — Scaffolding & environment

- [x] pnpm workspace set up (`apps/web`, `apps/api`)
- [x] `apps/api/.env.example` with `STRIPE_SECRET_KEY`, `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`
- [x] `GET /api/health` on a bare Fastify server, so `pnpm dev` has something to run end to end from the start

## Phase 2 — Stripe sandbox seed script

- [ ] `pnpm seed` creates the 4 test customers, a mix of successful/declined payments, and the four invoice states (paid, outstanding under the cap, overdue, at/above the cap) described in `docs/spec.md`
- [ ] Seed script prints the link-token(s) needed to connect a Telegram chat to a seeded customer (see `docs/design.md` open items)

## Phase 3 — Backend core: tools & Stripe integration

- [ ] Stripe client wiring in `apps/api`
- [ ] `policies/authorization.ts` — server-side customer scoping
- [ ] `policies/payment-policy.ts` — $2,000 cap check (`amount >= 200000`)
- [ ] Read-only tool implementations: daily summary, revenue comparison, invoice lookup (deterministic aggregation, no LLM-side arithmetic)
- [ ] Money-moving tool implementations: refund, invoice creation, invoice payment — unit-tested in isolation, not yet wired to the LLM or an HTTP route
- [ ] Pending-action/confirmation data shape (id, tool name, arguments, expiry)

## Phase 4 — Web chat assistant

- [ ] `POST /api/assistant` — OpenAI tool-calling loop wired to the Phase 3 tools; read-only tools execute inline, money-moving tools return a pending action
- [ ] `POST /api/assistant/confirm` — validates the pending action id/arguments match, applies the cap check, then executes via Stripe on a match
- [ ] Zod validation on tool arguments and the confirm payload
- [ ] Manual verification via curl/Postman before building the UI in front of it

## Phase 5 — Web chat UI

- [ ] React + Vite frontend: chat input/history, rendering assistant replies
- [ ] Distinct UI state for "confirm this action" that calls `/api/assistant/confirm`
- [ ] `pnpm dev` runs web + api together; README's "open the web app at" line filled in once the dev port is fixed

## Phase 6 — Telegram bot

- [ ] grammY bot in the same process as the API (per `docs/design.md`)
- [ ] `/start <link-token>` handler establishing the `telegramChatId → stripeCustomerId` mapping
- [ ] Invoice lookup and payment, scoped to the linked customer id — reusing Phase 3 tools and Phase 4 confirmation/cap logic directly (not over HTTP)
- [ ] Handoff behavior for invoices at/above the cap (mechanism settled here, per `docs/design.md` open items)
- [ ] README's Telegram bot section (§6) filled in once the startup command and linking flow are final

## Phase 7 — Guardrail/policy test suite

- [ ] $2,000 cap boundary tests (just under, exactly at, just over)
- [ ] Telegram customer scoping tests — a linked chat can't read or act on another customer's invoices
- [ ] Confirmation-mismatch rejection tests — confirming a stale, altered, or unknown pending action id fails closed
- [ ] `guardrail-auditor` subagent run with no Critical/FAIL findings

This is the phase the README's "Run tests" section (§7) refers to.

## Phase 8 — Polish & known limitations

- [ ] README's still-open placeholders (architecture summary, API design summary, dev port, Telegram startup instructions) reconciled against what actually got built in Phases 1–7
- [ ] `write-up.md` written with the full known-limitations list; summarized back into README §9

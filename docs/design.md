# Design

This document covers *how* the system in `docs/spec.md` gets built: architecture, technology choices and their rationale, and the API surface. Full pros/cons writeups for individual decisions belong in `docs/decisions.md` (not yet written) — this document states the choice and a short reason, not the full debate.

## Architecture overview

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript — single-page chat UI |
| Backend | Node.js + Fastify + TypeScript — REST API, agent orchestration, Stripe integration |
| LLM | OpenAI API, structured tool/function calling |
| Payments | Stripe Node SDK, test mode only |
| Telegram bot | grammY, running in the same Node process as the API |
| Validation | Zod, at every tool boundary (arguments coming out of the LLM's tool call, and the `/api/assistant/confirm` payload) |
| Persistence | None beyond a `telegramChatId → stripeCustomerId` mapping — Stripe is the source of truth for everything else |

## Core principle: the model never executes directly

> "The LLM is responsible for reasoning and language; application code is responsible for authority and execution."

The LLM's only job is to read the conversation and pick from a fixed set of tools (functions) with fixed, hand-written implementations. The model cannot run arbitrary code or call Stripe itself — every tool is backend code that the model merely selects and supplies arguments for.

For any tool that moves money (refund, invoice payment) or that has a real customer/network-visible effect (sending an invoice, submitting or declining dispute evidence), tool selection and execution are two separate steps:

1. The model selects the tool and proposes arguments. The backend does **not** execute yet — it returns a **pending action** describing what would happen.
2. The user (owner in web chat, customer in Telegram) explicitly confirms. The backend re-validates the confirmation against the specific pending action it issued — a confirmation that doesn't match the pending action (wrong id, expired, altered amount) is rejected rather than assumed to match.
3. Only on a matched confirmation does the backend call Stripe.

The $2,000 payment cap is enforced in this same backend code path, before step 3 ever runs — it is a plain conditional on the payment amount, not something the model is asked to respect. An invoice at or above the cap never reaches a payable pending action; it's routed to handoff instead.

Invoice creation (S10, `docs/feature.md`) and dispute evidence (S11) are both deliberate exceptions to "the backend does not execute yet": creating the Stripe **draft** invoice, and **staging** dispute evidence (`disputes.update(id, {evidence, submit:false})`), both happen immediately, without a pending action — a draft is safe and fully reversible (no charge, nothing emailed, deletable), and staged evidence is likewise safe and reversible (nothing is sent to the card network until a separate explicit `submit:true`) — so both are treated like a read-only tool's immediate execution rather than a money-moving one's gated execution. The steps that actually matter — **sending** an invoice (finalizes and emails the customer), and **submitting or declining** dispute evidence (sends to the card network, or irreversibly concedes) — still go through the full three-step pending-action ceremony above. See ADR-012 and ADR-013 in `docs/decisions.md`.

Read-only tools (summaries, invoice lookups, revenue comparisons) execute immediately since they can't cause unwanted side effects.

The invoice draft's pre-send review (S10) and the dispute evidence checklist (S11) both follow the same "no LLM-side judgment on facts" spirit as the arithmetic rule below: missing-email/overdue-history/unusual-amount/possible-duplicate checks (`agent/tools/invoice-creation.ts`), and which dispute-evidence fields are found versus missing (`agent/tools/dispute-response.ts`), are plain deterministic code run against real Stripe data, not something the model is asked to judge — the model only narrates the resulting flags, same as it narrates a daily summary's numbers. For disputes specifically, this also means never fabricating a "found" evidence item — this app has no order/shipping/CRM system, so most evidence beyond payment and customer facts is genuinely either present in Stripe or missing, never guessed.

Two further consequences of this principle:

- **No LLM-side financial arithmetic.** Totals, counts, and percentage changes for summaries and revenue comparisons are computed by a deterministic aggregation module, not by the model. Only the resulting structured JSON (not raw Stripe objects, and not a request to "calculate this") is passed to the LLM, whose job is narrating that JSON in natural language — never producing the numbers itself.
- **`customerId` is always server-bound, never model-supplied.** For Telegram-scoped tools, the customer id comes from the `telegramChatId → stripeCustomerId` mapping on the server side and is injected before the tool runs. It is not a parameter the LLM can set, so no phrasing in the conversation can cause a tool to run against a different customer — the tool schema itself makes it structurally impossible, not merely discouraged.

## Internal structure (`apps/api/src`)

```
apps/api/src/
  policies/
    payment-policy.ts     # $2,000 cap check — amounts are handled in cents (Stripe's native unit),
                           # so the cap is `amount >= 200000`; sits on every payment path before the Stripe call
    authorization.ts       # customer scoping — binds customerId server-side from the Telegram session,
                           # never accepted as a tool parameter
  agent/
    tools/                 # tool implementations: summary, revenue-comparison, refund, invoice draft/review/send,
                           # dispute evidence checklist/draft/submit/decline, invoice payment, invoice lookup
    loop.ts                 # OpenAI structured tool-calling loop
  telegram/
    bot.ts                  # grammY bot: /start linking, invoice view/pay, handoff at/above the cap
    session.ts               # telegramChatId → stripeCustomerId mapping
  routes/
    assistant.ts              # POST /api/assistant, POST /api/assistant/confirm
    health.ts                  # GET /api/health
```

Every mutating Stripe call for a money-moving action (refund, invoice payment) must pass through `policies/payment-policy.ts` and/or `policies/authorization.ts` — no tool calls Stripe directly for one of these without going through these first. Invoice draft creation/editing/discarding, and dispute evidence staging/submission/decline, are mutating Stripe calls too, but aren't money-moving (see the draft-vs-send / stage-vs-submit distinctions above) and so aren't cap- or authorization-scoped the same way — there is no cap check on invoicing or on dispute responses, since the cap governs what's payable through the app's own execution path, not these other kinds of Stripe writes.

## Why these choices

- **Fastify over Express** — first-class TypeScript ergonomics and built-in JSON-schema request/response validation, which fits an API whose main job is validating structured tool-call arguments and pending-action payloads.
- **OpenAI over another provider** — mature, well-documented structured tool/function-calling support, which the "model never executes directly" principle depends on.
- **grammY over node-telegram-bot-api** — modern TypeScript-first API with cleaner middleware/session handling, which simplifies the chat-linking flow (`/start <token>` → session → customer id).
- **Telegram bot in the same process as the API** — the bot needs the same Stripe client, the same tool implementations, and the same guardrail logic as the web chat. Running it as a second process would mean either duplicating that logic or extracting a shared package for no real benefit at this scale; one process also means there's no second place for the `telegramChatId → stripeCustomerId` mapping to drift out of sync. Started together via `pnpm dev`; revisit if/when the bot needs to scale independently of the API.
- **Zod for validation** — tool arguments come out of the LLM's structured tool call, and `/api/assistant/confirm` payloads come from the client; both are boundaries where malformed or adversarial input needs to be rejected before it reaches a policy check or Stripe, so every tool boundary is schema-validated rather than trusted.
- **No database** — Stripe already is the system of record for customers, invoices, and payments; adding a database would create a second copy of that data with its own sync problem, for no functional gain at this scale. The one fact Stripe doesn't know — which Telegram chat belongs to which customer — is small enough to hold in a lightweight in-memory/file-backed map rather than standing up a full datastore. Revisit if the mapping needs to survive process restarts in a hosted (non-dev) environment.

## API surface

- **`POST /api/assistant`** — owner sends a chat message from the web UI. The backend runs the LLM tool-calling loop; if the model selects a read-only tool, the response includes the tool's result and the assistant's reply. If the model selects a money-moving tool, the response includes a **pending action** (tool name, resolved arguments, an id, a short expiry) instead of a result, and the assistant's reply asks the owner to confirm.
- **`POST /api/assistant/confirm`** — owner confirms or cancels a specific pending action by id. The backend re-validates the referenced pending action still matches what's being confirmed (id, arguments, not expired) before calling Stripe; a mismatch is rejected with an error rather than silently executed or silently ignored.
- **`GET /api/health`** — liveness check for local/dev use.
- **`GET /api/dashboard/summary`** — today's summary plus a today-vs-yesterday revenue comparison, for the web UI's always-visible dashboard panel (S9, `docs/feature.md`). Deliberately outside the LLM tool-calling loop — a passive display needs no narration, so this calls the same deterministic aggregation the chat tools use directly, with no OpenAI cost or latency on page load.
- **`GET /api/dashboard/activity?days=7|30|90`** — a day-by-day revenue time series over the requested range, for the same dashboard's Payment Activity chart. Same reasoning: direct, LLM-free.
- **`GET /api/dashboard/overdue-invoices`** — an aggregate of overdue invoices *across every customer*, for the dashboard's Needs Attention panel. The only dashboard route that scans the full customer list rather than one date range; same LLM-free reasoning.
- **`GET /api/dashboard/disputes`** — payment disputes still awaiting the owner's evidence response (`needs_response`/`warning_needs_response` only — already-answered or resolved disputes are excluded), for the same Needs Attention panel. First route in this codebase to touch Stripe's Disputes API.
- **`GET /api/dashboard/recent-activity`** — the 10 most recent account-wide events (successful/failed payments, refunds, invoice creation) merged from three separate Stripe list calls and sorted newest-first, for the dashboard's Recent Activity feed. Deliberately does not also surface "invoice paid" as its own event, since the charge that pays an invoice already appears via the charges stream. Same LLM-free reasoning as the other dashboard routes.
- **`POST /api/stripe/webhook`** (S13, `docs/feature.md`) — the only route in this codebase that's inbound *from* Stripe rather than outbound *to* it, and the only one requiring the raw, unparsed request body (`stripe.webhooks.constructEvent`'s HMAC signature check needs the exact bytes Stripe signed, not a JSON-reparsed copy) — handled via a content-type parser scoped to this route's own Fastify plugin context, not a global change to body parsing. Deliberately narrow: it only acts on `invoice.paid` events for invoices at/above the $2,000 cap, proactively messaging the linked Telegram customer, since that's the only payment path this app has no other way of learning about (see ADR-015).
- **`GET /api/dashboard/failed-payments`** (S14, `docs/feature.md`) — currently-failed charges whose invoice (if any) isn't paid, for the same Needs Attention panel. Same LLM-free reasoning as the other dashboard routes.
- **`POST /api/reminders/send`** (S14) — the first *write* route that bypasses the LLM entirely (see ADR-016): once a payment reminder's text is drafted (by the model) or edited (by the owner), actually sending it needs no reasoning, only logging a fixed string, so the frontend calls this directly rather than routing a finalized string back through a tool call. No Stripe or email SDK call of any kind — logs only, per S14's explicit "simulate, don't configure a real provider" scope.

The Telegram bot does not go through this HTTP surface — grammY handlers call the same underlying tool implementations directly in-process, applying the same confirmation and cap logic described above. Since S12 (`docs/feature.md`), free-text messages in the bot are handled the same way the web chat's `POST /api/assistant` messages are — by `agent/loop.ts`'s `runAssistantTurn` — rather than a second, parallel tool-calling loop: the function takes an optional `{toolRegistry, systemPrompt}` override (defaulting to the owner's `TOOL_REGISTRY`/`buildSystemPrompt`, so the web path's call site is unchanged), and `telegram/bot.ts` passes a customer-scoped registry of exactly two tools (`telegram/tool-registry.ts`) plus a customer-facing prompt (`telegram/system-prompt.ts`). This keeps pending-action storage, Markdown stripping, and the tool-call round cap identical across both entry points by construction, rather than by convention. Confirming a pending action created this way is still exclusively the existing `confirm:`/`cancel:` callback handlers, never a tool the model can call — see ADR-014.

## Open items for `docs/plan.md` / `docs/decisions.md`

- Exact shape of the `telegramChatId → stripeCustomerId` link-token: how it's generated and where the owner obtains it to share with a customer (candidate: the seed script prints one link-token per seeded customer for local testing).
- Exact handoff mechanism for at/above-cap invoices (e.g., a message directing the customer to contact the owner directly, vs. some other channel).
- Persistence backing for the chat-id-to-customer-id map in a non-dev environment (in-memory is sufficient for local dev but won't survive a restart).

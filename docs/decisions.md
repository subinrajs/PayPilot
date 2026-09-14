# Decisions

Lightweight ADRs for the choices summarized in `docs/design.md`. Each record: context, decision, consequences. Status is `Accepted` unless noted.

## ADR-001: Fastify over Express for the backend

**Context** — The backend is mostly a thin layer validating structured input (tool-call arguments, pending-action payloads) and calling Stripe/OpenAI. TypeScript ergonomics and request validation matter more than ecosystem size here.

**Decision** — Use Fastify.

**Consequences** — Built-in JSON-schema validation reduces hand-rolled input checking on `/api/assistant` and `/api/assistant/confirm`. Smaller plugin ecosystem than Express, but nothing in this app's scope needs it.

## ADR-002: OpenAI for the LLM, via structured tool/function calling

**Context** — The system's core principle (`docs/design.md`) is that the model never executes anything directly — it must reliably select from a fixed tool set and supply structured arguments, not free-form text the backend has to parse.

**Decision** — Use the OpenAI API with structured tool/function calling for all model interaction.

**Consequences** — Tool selection and argument extraction are structured and validated at the boundary, rather than parsed out of prose. Ties the project to OpenAI's tool-calling contract; switching providers later would mean re-verifying that contract's guarantees hold elsewhere.

## ADR-003: grammY over node-telegram-bot-api for the Telegram bot

**Context** — The bot needs session/middleware handling for the `/start <token>` linking flow, and the rest of the codebase is TypeScript-first.

**Decision** — Use grammY.

**Consequences** — Cleaner typed middleware for the linking flow than older callback-based libraries. Smaller/newer ecosystem than node-telegram-bot-api, acceptable given the bot's scope is narrow (link, view, pay).

## ADR-004: No database — Stripe is the sole source of truth

**Context** — Customers, invoices, and payments already live in Stripe. The only fact Stripe doesn't hold is which Telegram chat belongs to which customer.

**Decision** — Persist nothing except the `telegramChatId → stripeCustomerId` mapping; read everything else from Stripe at request time.

**Consequences** — No sync problem between a local copy of financial data and Stripe — eliminates a whole class of drift/staleness bugs. Every read hits the Stripe API directly, so latency and Stripe rate limits become the app's latency/limits (acceptable at this scale). The one piece of local state (the chat-customer mapping) still needs a storage decision for non-dev environments — see the open item in `docs/design.md`.

## ADR-005: Telegram bot runs in the same process as the API

**Context** — The bot needs the same Stripe client, tool implementations, and guardrail logic (cap check, confirmation matching) as the web chat backend.

**Decision** — Run the grammY bot inside the same Node process as the Fastify API, started together via `pnpm dev`, calling tool implementations in-process rather than over HTTP.

**Consequences** — One deployable process, one place the guardrail logic lives — no risk of the bot and the API enforcing the cap or confirmation logic differently. Couples the bot's uptime to the API's; revisit if the bot ever needs to scale or deploy independently.

## ADR-006: Money-moving actions require a separate, explicit confirmation step

**Context** — A single ambiguous chat message (from an owner or a customer) should never be enough to move money; per `docs/intent.md`, "no money moves on a single ambiguous message" is a stated success criterion.

**Decision** — Every money-moving tool (refund, invoice creation, invoice payment) returns a pending action on first selection; it only executes after a second, explicit confirmation that the backend re-validates against that specific pending action.

**Consequences** — Adds a round-trip to every money-moving flow (owner and customer both see a confirm step), but removes the failure mode where a misread instruction directly causes a financial action. A stale or mismatched confirmation fails closed rather than executing against "whatever the most recent pending action was."

## ADR-007: The $2,000 cap is enforced in backend code, not via prompt instruction

**Context** — The model can be talked around a prompt instruction; a payment cap that only lives in the system prompt is not a reliable safety boundary.

**Decision** — The cap is a plain conditional in the backend payment path, checked before any Stripe payment call — independent of what the model or the conversation says.

**Consequences** — The cap holds even if the model is adversarially prompted or simply makes a mistake. An invoice at/above the cap never produces a payable pending action in the first place (see `docs/feature.md` story 8), rather than being caught and blocked only at confirmation time.

## ADR-008: Financial totals are computed deterministically, never by the LLM

**Context** — Summaries and revenue comparisons involve arithmetic (sums, counts, percentage change). Letting the model compute these from raw data risks silently wrong numbers that read as confident and correct.

**Decision** — A deterministic aggregation module computes all totals/counts/percentages from Stripe data; only the resulting structured JSON is passed to the LLM, whose role is limited to narrating it in natural language.

**Consequences** — Numbers shown to the owner are exactly what the code computed, not what the model inferred — verifiable and reproducible independent of the model. The model's narration must be checked for fidelity to the JSON it was given (i.e., that it doesn't restate a number incorrectly in prose), but it can never introduce a wrong number that wasn't in the input.

## ADR-009: Zod validation at every tool boundary

**Context** — Two boundaries receive input the backend doesn't fully control: tool arguments produced by the LLM's structured tool call, and the `/api/assistant/confirm` payload from the client. Both need to be rejected cleanly when malformed rather than reaching a policy check or Stripe in a bad shape.

**Decision** — Every tool implementation and the confirm route validates its input against a Zod schema before doing anything else.

**Consequences** — Malformed or adversarial input fails fast with a clear validation error instead of causing a confusing downstream failure (or, worse, being coerced into something unintended). Adds a schema to maintain per tool, kept close to the tool it validates.

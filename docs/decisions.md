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

## ADR-010: The Telegram link-token is the Stripe customer id

**Context** — `docs/design.md` left the exact shape of the `telegramChatId → stripeCustomerId` link-token as an open item, candidate: "the seed script prints one link-token per seeded customer." ADR-004 already commits to persisting nothing beyond the `telegramChatId → stripeCustomerId` mapping itself — introducing a separately-generated, separately-stored token would mean a second piece of persisted state ahead of that mapping even existing.

**Decision** — The link-token *is* the Stripe customer id (`cus_...`). The seed script prints each seeded customer's id as its link-token; Phase 6's `/start <link-token>` handler validates it via `stripe.customers.retrieve(token)` before recording the `telegramChatId → stripeCustomerId` mapping.

**Consequences** — No separate token store, generation scheme, or expiry logic is needed — consistent with ADR-004's "no database" stance. The tradeoff is that the link-token is a real Stripe object id rather than an opaque single-purpose secret; acceptable for a test-mode sandbox where these ids carry no standalone authority (a Stripe secret key is still required for anything to act on them), and revisit if this ever needs to run against a live account.

## ADR-011: The at/above-cap handoff mechanism is Stripe's own hosted invoice page

**Context** — `docs/design.md` left the exact handoff mechanism for at/above-cap invoices as an open item, candidate: "a message directing the customer to contact the owner directly." This app has no stored contact channel for the owner (no email/phone on file), so that candidate has nothing concrete to point to.

**Decision** — Every finalized Stripe invoice already carries a `hosted_invoice_url` — a real, working Stripe-hosted payment page. When `proposeInvoicePayment` routes an at/above-cap invoice to `{kind:"handoff"}`, it includes that URL (also surfaced on `invoice-lookup.ts`'s results), and the Telegram bot gives the customer that link directly instead of an instruction to "contact the owner."

**Consequences** — No invented communication channel is needed, and the mechanism is free (the field is already on the Invoice object Stripe returns). This isn't a bypass of the $2,000 cap: the cap governs what's payable through *this app's own execution path* (`executeInvoicePayment`), not Stripe's own hosted checkout, which is Stripe's authorization surface and out of this app's control either way. Falls back to a plain "contact us directly" line in the unlikely case a finalized invoice lacks the URL.

## ADR-012: Invoice drafts are created immediately in Stripe; only sending is confirm-gated

**Context** — S10 (`docs/feature.md`) replaces the single-shot "propose → confirm → create+finalize" invoice flow with a richer lifecycle: multiple line items, a pre-send review, and natural-language edits against the same invoice before it's sent. ADR-006 established that money-moving actions go through a pending-action/confirm step before Stripe is touched at all. Applying that literally to invoice *creation* would mean either (a) inventing an in-memory representation of a not-yet-real invoice draft that this app has to keep consistent with itself across multiple edit turns, or (b) creating the real Stripe object immediately and letting Stripe be the source of truth for the draft, same as for everything else in this app.

**Decision** — Creating a Stripe invoice in `draft` status (and updating or discarding that draft) happens immediately, with no pending action — a draft has no customer-visible effect (no charge, no email) and is fully reversible (`stripe.invoices.del`). Only the explicit "send" action — which finalizes the invoice and emails the customer — goes through the same pending-action/confirm ceremony ADR-006 established for refunds and payments.

**Consequences** — Stripe remains the sole source of truth for the draft throughout its whole lifecycle, including across multiple conversational edits — this app never has to maintain its own parallel copy of "what the draft currently looks like." The tradeoff is a narrower reading of "the backend does not execute yet": a Stripe write does happen before any owner confirmation, but only for the specific class of write (draft creation/editing/deletion) that has no external effect — the same reasoning ADR-006 doesn't apply to read-only tools already applies here, just extended to a mutating-but-harmless one. The customer-visible, hard-to-undo action (sending) still gets the full confirm treatment with no exception.

## ADR-013: Dispute evidence is staged immediately in Stripe; only submitting or declining is confirm-gated

**Context** — S11 (`docs/feature.md`) adds an AI-assisted dispute response workflow: an evidence checklist, an AI-drafted written response, conversational revision, then either submitting evidence to the card network or declining to contest. Stripe's `disputes.update(id, {evidence, submit})` API has `submit` default to `true` — every staging call in this codebase must pass `submit: false` explicitly, or it silently sends to the network. This is architecturally identical to ADR-012's invoice-draft question: should drafting/staging require a pending-action confirm, or is it safe to do immediately?

**Decision** — Staging dispute evidence (`disputes.update(id, {evidence, submit:false})`), and revising that staged evidence, happen immediately with no pending action — staged evidence has no effect on the dispute's outcome or the card network until a separate, explicit submission. Only `submit: true` (sends evidence to the card network) and `disputes.close()` (concedes the dispute, irreversible) go through the pending-action/confirm ceremony ADR-006 established.

**Consequences** — Same reasoning and same tradeoff as ADR-012: Stripe stays the source of truth for the in-progress response throughout conversational revision, at the cost of a narrower reading of "the backend does not execute yet" for the specific, harmless class of write that staging is. Unlike an invoice draft, staged dispute evidence can't simply be deleted the way a draft invoice can (Stripe's dispute lifecycle doesn't offer a "delete the dispute" action — the dispute exists independent of what evidence has been staged against it), but re-staging with different evidence via `update()` is equally safe and overwrites what was staged before, which is why "Edit" in this workflow re-stages rather than discarding and recreating.

## ADR-014: Telegram's natural-language path can propose a payment, but confirmation stays exclusively callback-driven

**Context** — S12 (`docs/feature.md`) adds LLM-based natural-language understanding to the Telegram bot, reusing the same `runAssistantTurn` orchestration the web chat already uses (parameterized with a customer-scoped tool registry and prompt, `agent/loop.ts`). The two existing tools it exposes — `get_my_invoices` (read-only) and `pay_invoice` (money-moving) — are the same `lookupInvoices`/`proposeInvoicePayment` functions the `/owe` command and `pay:` button callback already call, with `customerId` bound server-side and structurally absent from either tool's Zod schema (ADR-006's confirmation model already covers what happens once a pending action exists). The new question this story raises: once the model can *reach* `pay_invoice` through free text instead of only a button tap, could it also be trusted to interpret a later "yes"/"go ahead" as the confirmation itself, skipping the button?

**Decision** — No. Natural language may call `pay_invoice` and produce a pending action, exactly as tapping "Pay" does — `runAssistantTurn` already stores it via the same `setPendingAction` path regardless of which registry is active. But resolving that pending action — `confirmPayInvoice`, reached only through the `confirm:`/`cancel:` callback handlers in `telegram/bot.ts` — remains entirely outside the LLM tool-calling loop. There is no tool the model can call to execute a payment, and the system prompt (`telegram/system-prompt.ts`) explicitly instructs it never to claim a payment succeeded or is confirmed, since it has no way to know whether or when the customer taps the button.

**Consequences** — The guardrail ADR-006 established — a second, explicit, human-originated confirmation before any money moves — holds exactly as before; this story only adds a second way to *reach* the propose step, not a second way to *skip past* confirm. The cost is a small UX one: a customer who types "yes, pay it" after seeing a proposal gets a reply pointing them at the Confirm button rather than the payment actually happening on that message — an intentional friction point, not an oversight. Nothing about this decision changes if a future story adds more Telegram-scoped money-moving tools; the same button-only confirmation mechanism already generalizes to any tool that returns a `{kind:"pending"}` result, by construction.

## ADR-015: The payment-webhook notification is scoped to at/above-cap invoices only, and requires signature verification

**Context** — S13 (`docs/feature.md`) closes a real gap: a customer who pays an at/above-cap invoice through Stripe's own hosted invoice page (the handoff link, ADR-011) gets no confirmation from PayPilot — nothing in this codebase previously listened for Stripe webhooks at all, and the bot only reflects reality the next time it's *asked* (ADR-004). Two design questions this story has to settle: (1) which `invoice.paid` events should trigger a proactive Telegram message, given the bot's own Confirm-button flow (`invoice-payment.ts`'s `executeInvoicePayment`) *also* pays invoices and therefore *also* triggers this same Stripe event; and (2) how much to trust an inbound POST to a new, unauthenticated-by-default route.

**Decision** — The webhook route only acts on `invoice.paid` events where the invoice's `amount_paid` is at or above `PAYMENT_CAP_CENTS` (reusing `policies/payment-policy.ts`'s `isAtOrAboveCap`, not a re-declared threshold). Every request must pass `stripe.webhooks.constructEvent`'s signature check against `STRIPE_WEBHOOK_SECRET` or is rejected outright (400) before any business logic runs.

**Consequences** — The cap check exploits a structural fact rather than adding new state: `executeInvoicePayment` calls `assertBelowCap` and can never pay an at/above-cap invoice (those are always routed to handoff instead, per ADR-011), so a webhook event for one of those can only mean the customer paid outside the bot — exactly the one case the bot has no other way of learning about. A below-cap `invoice.paid` event, by the same logic, can only originate from the bot's own flow, which already sent its own synchronous confirmation in that turn — so the webhook silently skips it, with no need to track "did the bot already tell them" as a second piece of state that could drift out of sync with reality. This means the notification path and the bot's own confirmation path are mutually exclusive by construction, not by coordination. Signature verification is a hard requirement, not a nice-to-have: without it, anyone who could guess or observe a customer id and an invoice amount could POST a forged event and get PayPilot to send a real customer a fake "payment received" message — a spoofing risk distinct from (and worse than) a plain correctness bug. A small in-memory set of already-processed Stripe event ids guards against Stripe's documented at-least-once redelivery producing a duplicate customer-facing message — same in-memory-only tradeoff already accepted elsewhere in this app (ADR-004), acceptable at this project's single-instance, local-dev scale.

## ADR-016: Sending a drafted payment reminder bypasses the LLM entirely, and isn't pending-action-gated

**Context** — S14 (`docs/feature.md`) lets the owner draft, review, edit, and send payment-reminder emails for overdue invoices and failed payments — explicitly simulated (logged only, no real email provider configured anywhere in this app). Two questions this raises that every other money-moving or customer-facing action in this app has answered one way: should *sending* a reminder go through the OpenAI tool-calling loop like drafting does, and should it require the same pending-action/confirm ceremony ADR-006 established for refunds, invoice sends, and dispute submissions?

**Decision** — No to both. Drafting (`draft_payment_reminders`) is the one LLM-facing step — the model composes each subject/body from real facts. Once that text exists (as drafted, or as edited by the owner directly in the review tile), *sending* it requires no reasoning or language generation at all, only logging a fixed string — so `POST /api/reminders/send` is called directly by the frontend, never through `runAssistantTurn`. And unlike refunds/invoice-sends/dispute-submissions, nothing real happens when it's called: no Stripe object changes, no email is actually delivered, only a log line is written — so ADR-006's guardrail (a second explicit confirmation before something consequential and hard to undo occurs) has nothing to gate. The review-and-edit step in the chat tile already is the meaningful checkpoint before a customer-facing action is even simulated.

**Consequences** — This is the first *write* route in this codebase reached directly by the frontend rather than through either the tool-calling loop or a pending-action confirm — consistent with `routes/dashboard.ts`'s existing precedent that a *read* needing no narration skips the LLM, extended here to a *write* needing no reasoning. If this feature ever grows a real email provider, sending would stop being "nothing real happens" and this decision would need revisiting — at minimum re-introducing a pending-action/confirm step per ADR-006's existing standard, since a real send is exactly the kind of consequential, hard-to-undo action that guardrail exists for. Until then, the simulated nature of sending is exactly what makes skipping both the LLM and the confirm step safe.

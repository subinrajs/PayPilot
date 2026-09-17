# S12 — Natural-language conversation with the Telegram bot: working notes

Supplementary to `current-feature.md` — same reasoning as `s10-invoice-creator.md`/`s11-dispute-assistant.md` before it. `docs/feature.md`'s `### S12` section is the source of truth for *what* this is; this file is scoped to *how* it gets built.

## How this started

The owner tested the bot in Telegram: `/start` and `/owe` both worked, but a plain "hello" was silently ignored — confirmed by reading `telegram/bot.ts` in full, there was no fallback handler at all, so grammY just dropped anything that wasn't an exact command match. Two scope questions were asked and both answered with the recommended option: (1) natural language should be able to propose payment too, not just answer read-only questions; (2) `/start`/`/owe` stay working unchanged, natural language is purely additive.

## The one guardrail principle this design is built around

**Confirmation stays exclusively button-driven — the model never gets to decide "yes, pay it."** Tapping "Pay" today only *proposes* (creates a pending action); a *separate* tap on "Confirm" is what actually calls `executeInvoicePayment`, via the existing `confirm:` callback — a fixed, deterministic handler with zero LLM involvement. This story only adds a new way to *reach* the propose step (natural language calling the same `pay_invoice` tool, instead of only a button tap) — every pending action it creates still requires the customer to tap the *existing, unchanged* Confirm button to execute. Written up as ADR-014.

## What already existed and was reused as-is (nothing in these changed)

- `agent/tools/invoice-lookup.ts`'s `lookupInvoices` and `agent/tools/invoice-payment.ts`'s `proposeInvoicePayment`/`executeInvoicePayment` — `customerId` was already a trusted TS parameter, not part of either Zod schema, confirmed by each file's own pre-existing comment.
- `bot.ts`'s `formatInvoiceList`, `formatPendingConfirmation`, `handoffMessage`, and the `confirm:`/`cancel:` callback handlers — untouched. They become the universal confirmation mechanism for any pending action regardless of how it was proposed.
- `agent/pending-action-store.ts` and `agent/loop.ts`'s automatic `setPendingAction()` call — already generic over which tool registry is active.
- `agent/markdown-strip.ts` — applied unconditionally inside the shared loop body, so Telegram replies get the same plain-text safety net as the web chat automatically.

## What's new

1. **`agent/loop.ts`** — `runAssistantTurn` gained an optional 4th parameter, `options?: {toolRegistry?, systemPrompt?}`, defaulting to today's exact owner behavior. `runToolCall` (internal) now takes the resolved registry explicitly instead of reading the module-level default. Confirmed fully backward-compatible — the full suite passed unchanged with this parameterization alone, before any Telegram-side code was written.
2. **`agent/tool-registry.ts`** — `findTool`/`toolDefinitionsForOpenAI` both gained an optional `registry: ToolRegistryEntry[] = TOOL_REGISTRY` parameter.
3. **`telegram/tool-registry.ts`** (new) — `buildCustomerToolRegistry(customerId)`, exactly 2 tools (`get_my_invoices`, `pay_invoice`), each a closure binding the given customerId, wrapping the existing owner-agnostic functions unchanged.
4. **`telegram/system-prompt.ts`** (new) — `buildTelegramSystemPrompt(now)`, a small customer-persona prompt: explains the two tools, states plainly that `pay_invoice` only proposes and a button tap is what actually pays, never claim a payment succeeded, no Markdown (this chat renders it as literal stray characters), never guess an amount/invoice from memory of an earlier turn.
5. **`telegram/conversation-store.ts`** (new) — per-chat in-memory `Map<chatId, messages>`, mirroring `session.ts`'s existing pattern (same ADR-004 tradeoff: no restart persistence). Cleared on a successful `/start` re-link so a previous customer's history can't leak into a freshly-linked chat.
6. **`telegram/bot.ts`** — added (module-private) `findToolResult(messages, toolName)`, exported `ConversationalReply` + `handleConversationalMessage(stripe, openai, customerId, history, userText)`, and a new `bot.on("message:text", ...)` handler registered after the `/start`/`/owe` command handlers (grammY matches commands first, so this only runs for anything else — a stray `/unknown` command gets a short "didn't recognize that" reply instead of spending an OpenAI call on it).

## Testing

Five files touched/added, mirroring each existing file's established conventions exactly (fixture usage from `fake-stripe.ts`, the `createFakeOpenAI`/`completionOf`/`toolCall` pattern from `fake-openai.ts` already used in `loop.test.ts`):

- `telegram/tool-registry.test.ts` (new, 5 tests) — exactly 2 tools registered; neither schema exposes a `customerId` property; both handlers are genuinely bound to the given customerId (verified through real Stripe-call behavior — e.g. `get_my_invoices` scoping the underlying `invoices.list` call, `pay_invoice` returning `not_found` for an invoice owned by a different customer — rather than by spying on the imported functions, which isn't an established pattern in this codebase).
- `telegram/conversation-store.test.ts` (new, 6 tests) — get/set/clear, per-chat isolation, overwrite-not-append, clearing an unknown chat is a no-op.
- `telegram/bot.test.ts` (+7 tests) — `handleConversationalMessage`: a plain-text reply with no tool call; `get_my_invoices` rendering via `formatInvoiceList` (byte-for-byte the same card `/owe` produces); `pay_invoice` rendering via `formatPendingConfirmation` (same Confirm/Cancel card the button path produces); a handoff result rendering via `handoffMessage`; a guardrail test confirming an injected `customerId` in a mocked tool-call's arguments is rejected by `.strict()` (surfaces as a Zod "Unrecognized key(s)" error fed back to the model, Stripe never called) rather than silently honored; a scoping test confirming the bound customerId (not one from history or args) reaches the underlying Stripe call.
- `agent/loop.test.ts` (+2 tests) — a custom `toolRegistry`/`systemPrompt` passed via `options` is actually what reaches the mocked OpenAI call (system message content, `tools` array containing only the custom registry's tool, none of the owner-only tool names leaking through); and that tool-call resolution during a turn uses the *passed* registry even when a tool name coincidentally matches one in the owner default, never silently falling back to `TOOL_REGISTRY`.
- `agent/tool-registry.test.ts` (+2 tests) — `findTool`/`toolDefinitionsForOpenAI` honor an explicit override registry while the no-arg call sites (routes/assistant.ts's real usage) keep resolving against the unchanged 16-tool `TOOL_REGISTRY`.

Full suite: **232/232 passing** (up from 211 pre-S12 baseline — 21 new tests, zero regressions). `pnpm --filter api exec tsc --noEmit -p tsconfig.test.json` clean. `pnpm --filter web build` unaffected (S12 touches no frontend code).

## Live verification — done, and a real bug found and fixed along the way (B5)

Live-testing free-text "what I owe" (while separately verifying S13's webhook), a genuine bug surfaced: an already-paid invoice kept showing as still owed, and a brand-new invoice didn't show up at all. Root cause: `handleConversationalMessage`'s `findToolResult(result.messages, ...)` was searching the ENTIRE accumulated conversation history for a tool result, not just the current turn — so once `get_my_invoices` had been called anywhere earlier in a long-running chat, that stale result kept getting re-rendered on every later turn where the model (relying on its own memory instead of re-calling the tool, per this project's already-documented prompt-adherence gap) didn't call it again. Fixed by scoping the search to `result.messages.slice(nextMessages.length)` — only the messages this specific turn actually produced — mirroring the turn-scoping the web frontend's `toolResults.ts` already does for the identical class of problem (its `dedupeKey` mechanism, from the B2 fix earlier this session). Logged as **B5** in `docs/feature.md`, with a dedicated regression test in `bot.test.ts` (a two-turn conversation where turn 2 doesn't re-call the tool no longer re-surfaces turn 1's now-stale result).

After the fix, live-verified for real: `/start cus_VGGLBtlUcKjY8y` → "what do I owe" correctly showed only the real, currently-open invoice (a $3,000 one, correctly rendered via the handoff-link path since it's above the cap) with no trace of an older, already-paid invoice. `/start` and `/owe` both still work unchanged. Natural-language payment *proposal* (`pay_invoice` reached via free text rather than a button tap) is covered thoroughly by `bot.test.ts`'s dedicated tests rather than a redundant separate live click-through, since it's the exact same `proposeInvoicePayment`/`formatPendingConfirmation` code path already proven live via the button-driven flow.

Discovered mid-session: the dev server had been restarted several times (for S13 changes), which silently clears the in-memory `chatToCustomer` session map (ADR-004's accepted tradeoff) — Sarah's chat needed relinking via `/start` each time before conversational testing would work at all. Not a bug, just a real operational consequence of the in-memory-only design worth remembering for any future live-testing session.

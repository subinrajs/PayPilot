# S13 — Notify the Telegram customer when a handoff-path invoice is paid: working notes

Supplementary to `current-feature.md` — same reasoning as `s10-invoice-creator.md`/`s11-dispute-assistant.md`/`s12-telegram-conversational.md` before it. `docs/feature.md`'s `### S13` section is the source of truth for *what* this is; this file is scoped to *how* it gets built.

## How this started

Live-testing S12's fixed friendly payment link, the owner tapped it and paid a real $2,500 invoice through Stripe's own hosted page, then asked: how would the Telegram bot know that happened? Answer at the time: it wouldn't — confirmed by grep, no webhook infrastructure exists anywhere in this codebase (`docs/feature.md` explicitly lists this as an out-of-scope gap for both S10 and S11). Asked to scope it as a story and implement it.

## The one design decision this story is built around

Restrict the proactive notification strictly to invoices **at/above the $2,000 cap**, reusing `isAtOrAboveCap` from `policies/payment-policy.ts` rather than a re-declared threshold. This isn't an arbitrary restriction — it's the exact boundary that makes the notification path and the bot's own confirmation path mutually exclusive *by construction*:

- An at/above-cap invoice can **never** be paid through the bot's own Confirm button (`invoice-payment.ts`'s `executeInvoicePayment` calls `assertBelowCap` and would throw first) — those are always routed to the handoff message instead (ADR-011), so an `invoice.paid` webhook event for one can only mean the customer paid via the hosted link, which the bot has no other way of learning about.
- A below-cap invoice, conversely, can only be paid via the bot's own Confirm button in this app's current UI (the hosted link is never surfaced to the customer for those) — and that flow already sends its own confirmation synchronously in the same turn.

No "did the bot already tell them" state needed anywhere — the cap check alone settles it. Written up as ADR-015.

## Security invariant

Signature verification (`stripe.webhooks.constructEvent`) is mandatory. Without it, anyone who could guess/observe a customer id and an invoice amount could forge a POST and get PayPilot to message a real customer a fake "payment received" confirmation — a spoofing risk, not just correctness. This needs the raw, unparsed request body (Stripe's HMAC is computed over the exact bytes), which Fastify's default JSON parser discards — solved with a content-type parser scoped to only this route's own Fastify plugin encapsulation context (`app.addContentTypeParser(...)` called inside `stripeWebhookRoutes`, confirmed via `server.ts`'s four independent `app.register(...)` calls each getting their own encapsulation), so no new dependency (`@fastify/raw-body`) was needed and every other route's JSON parsing is untouched.

## What's new

1. **`apps/api/src/stripe.ts`** — `getStripeWebhookSecret()`, same throw-on-missing pattern as `createStripeClient()`.
2. **`apps/api/src/telegram/session.ts`** — `getChatIdForCustomer(customerId)`, the reverse of the existing `getCustomerId(chatId)`. Linear scan, matching the file's own existing precedent (the reverse check inside `linkChat` already scans rather than keeping a second index) — a customerId maps to at most one chatId by construction (`linkChat` refuses to link an already-linked customerId elsewhere), so the first match is the only match.
3. **New `apps/api/src/telegram/notify.ts`** — `sendTelegramMessage(chatId, text)`, a lightweight grammY `Api` client constructed lazily per call from `TELEGRAM_BOT_TOKEN`. Deliberately independent of the long-polling `Bot` instance inside `bot.ts`'s `startTelegramBot` (confirmed via research: that `bot` variable is local, never exported) — no need to touch that file's control flow at all.
4. **New `apps/api/src/routes/stripe-webhook.ts`** — `POST /api/stripe/webhook`. Verifies the signature (400 on failure), dedupes by `event.id` via a module-level `Set<string>` (in-memory only, same tradeoff as `pending-action-store.ts`), and on `invoice.paid` sends the same-styled confirmation (`✅ Payment of $X received. Thank you!`) as the bot's own `confirm:` callback — only when at/above cap and a linked chat exists.
5. **`apps/api/src/server.ts`** — registered alongside the other three route modules.
6. **`.env.example`** — added `STRIPE_WEBHOOK_SECRET=`.

## What's explicitly NOT touched

`executeInvoicePayment`, `confirmPayInvoice`, the bot's `confirm:`/`cancel:` callbacks, `agent/loop.ts`, every existing tool. This route never calls a Stripe *write* and involves no LLM — it only reads one event and sends a fixed-wording notification, so no existing money-moving guardrail is implicated.

## Testing

- `test/routes/stripe-webhook.test.ts` (new, 8 tests) — mirrors `test/routes/dashboard.test.ts`'s `vi.mock`/`app.inject` pattern. `constructEvent` needed `vi.hoisted()` since it's referenced both inside the `vi.mock("../../src/stripe.js", ...)` factory (nested under `createStripeClient`'s return value) and from test bodies — a plain outer `const` would hit vi.mock's hoisting-above-everything-else behavior. Cases: missing signature header (400); missing `STRIPE_WEBHOOK_SECRET` (500, no `constructEvent` call attempted); forged signature (400); at/above-cap + linked chat → notified (200); below-cap → not notified (200); at/above-cap + no linked chat → not notified (200); non-`invoice.paid` event type → ignored (200); redelivered duplicate event id → notified only once. Each test uses its own unique fake event id, since the route's `processedEventIds` Set is real module state that persists for the life of the test file process — reusing an id across tests would create a false-passing dedup coupling between unrelated tests.
- `test/telegram/session.test.ts` (+2 tests) — `getChatIdForCustomer` found/not-found.
- `test/telegram/notify.test.ts` (new, 2 tests) — mocks grammY's `Api` class, confirms it's constructed from `TELEGRAM_BOT_TOKEN` and `sendMessage` is called with the right args; confirms it throws (doesn't silently no-op) when the token is unset.

Full suite: **245/245 passing** (up from 233 pre-S13 baseline). `tsc --noEmit` clean. `pnpm --filter web build` unaffected (no frontend changes).

## Live verification — done

Installed the Stripe CLI via Homebrew, authenticated (`stripe login`, device-pairing flow), ran `stripe listen --forward-to localhost:3000/api/stripe/webhook`, set the printed `whsec_...` in `apps/api/.env`. Smoke-tested with `stripe trigger invoice.paid` first (200 response, confirmed signature verification + routing work before touching real data).

Discovered along the way that this Stripe account uses a **test clock** for its seeded customers (`Dispute`/invoice `created` timestamps all show the clock's frozen time, not real wall-clock time) — clock-attached objects are excluded from the default `list()` endpoints, which briefly looked like the seeded data had been deleted. Resolved by querying `invoices.list({customer: ...})` directly rather than the unfiltered global list.

Used Playwright to actually complete a real $2,500 payment through Sarah Johnson's genuine hosted invoice link (`stripe.com` Payment Element inside a nested iframe — required `frameLocator` targeting the `elements-inner-payment` iframe specifically, `getByLabel` rather than `getByPlaceholder` since the visible label text and the placeholder text differ, and explicitly setting Country to US before the postal code would validate). Payment succeeded; the webhook fired but — because the in-memory `chatToCustomer` session map had been cleared by an intervening dev-server restart — found no linked chat and correctly no-op'd (not a bug, expected consequence of ADR-004's in-memory-only tradeoff).

Mid-session, the Stripe CLI's OAuth session expired (`stripe listen` died with a 401 fatal error) without being noticed immediately, so a second real payment (owner sent Sarah a genuine new $3,000 invoice via the web chat, she paid it for real through the hosted link) initially produced no notification. Diagnosed via the CLI's own log output, re-authenticated (`stripe login` → `stripe login --complete-reauth`), restarted `stripe listen` (same signing secret was reissued, no `.env` change needed), found the missed real event via `stripe events?type=invoice.paid` list, and redelivered it with `stripe events resend <event_id>` — confirmed via dev server logs (`"Notified chat 8626679755 of payment for invoice in_1UGhzIIaARQPQcXlQ2UkGUjZ"`) and the user confirming the real Telegram message arrived.

Net result: the webhook route itself worked correctly on the very first real payment (before the CLI session expired) — every gap encountered was in the *local dev tunnel* (test clock discovery, session expiry, in-memory session clearing from restarts), not in the application code. Below-cap non-duplication is covered by the existing unit tests (`test/routes/stripe-webhook.test.ts`) and was also observed indirectly in the same live session (a $500 bot-Confirm-button payment produced exactly one Telegram confirmation, no second webhook-triggered message).

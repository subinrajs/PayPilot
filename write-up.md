# Known limitations

Full detail behind the summary in README §9. Nothing here is a bug — each item is a deliberate scope decision made during the build, recorded here rather than silently left for someone to rediscover.

## 1. Seed data isn't actually spread across multiple calendar days

**What it is:** `pnpm seed` (`apps/api/src/seed.ts`) uses Stripe test clocks to simulate a spread of payments "over the last few days" (per `docs/spec.md`'s fixture description). Stripe test clocks control what `Stripe.now()` returns to the API for time-dependent behavior (like invoice due dates), but they do **not** backdate a `Charge`'s `created` timestamp — every seeded charge's `created` field reflects the real wall-clock time the seed script was actually run, not the clock's simulated time.

**Why it's left as-is:** discovered during Phase 4 while building the daily-summary/revenue-comparison tools, which were verified correct against whatever dates the seed data actually has — so it doesn't affect anything built on top of it. Re-engineering the seed script's date handling to work around a Stripe test-clock limitation was judged not worth it for a local sandbox fixture (decision recorded 2026-09-15, `docs/plan.md` Phase 2).

**Practical effect:** a fresh `pnpm seed` run can't demonstrate a meaningful multi-day "compare revenue across periods" scenario on its own — every seeded charge lands on the same real calendar day. Re-running `pnpm seed` on different days (against separate test-mode data) would produce a genuinely multi-day fixture if that scenario needs to be demonstrated live.

## 2. The Telegram chat-to-customer mapping doesn't survive a restart

**What it is:** the only state this app persists beyond Stripe itself — the `telegramChatId → stripeCustomerId` mapping — lives in a single in-memory `Map` (`apps/api/src/telegram/session.ts`). Restarting the API process loses every linked chat; customers would need to `/start <link-token>` again.

**Why it's left as-is:** by design (ADR-004, `docs/decisions.md`) — introducing a datastore just to persist one small mapping, when Stripe already holds everything else, was judged not worth the added moving part for this build's scope. `docs/design.md` explicitly flagged this as an open item for "a non-dev environment" rather than something this phase needed to resolve.

**Practical effect:** fine for local development and demo use, where the process stays up for the length of a session. A hosted deployment expected to survive restarts (or run more than one instance) would need a real persistence decision here first — a small key-value store or a single-table database, not a general-purpose ORM/schema, since the mapping itself is trivial.

## 3. The Telegram link-token is a real Stripe customer id, not an opaque secret

**What it is:** per ADR-010, the link-token a customer sends via `/start <link-token>` *is* their Stripe customer id (`cus_...`), printed by `pnpm seed`. There's no separately generated, separately stored token.

**Why it's left as-is:** ADR-004 already committed to persisting nothing beyond the chat-to-customer mapping itself; adding a second generated/stored token ahead of that mapping existing would have meant a second piece of persisted state for no functional gain in a test-mode sandbox.

**Practical effect:** acceptable here because a Stripe customer id carries no standalone authority — a valid Stripe secret key is still required for anything to act on it, and this app only ever runs in Stripe test mode. This would need revisiting before ever pointing the app at a live Stripe account, where customer ids are easier to guess or observe and would benefit from being a single-use, expiring, separately-issued token instead.

## 4. Stripe test clocks cap out at 3 customers each

**What it is:** Stripe's test-clock API allows at most 3 customers attached to any one test clock. The seed script (`apps/api/src/seed.ts:17`) seeds 4 customers, so it batches them into more than one test clock to work within that limit.

**Why it's left as-is:** this is a hard constraint of Stripe's test-clock API, not a design choice — the seed script already handles it correctly by splitting customers into clock-sized groups. Documented here only because it shaped the seed script's structure and would otherwise look unexplained to someone reading it.

**Practical effect:** none for the app itself. Relevant only if the seed fixture is ever extended to more customers — any addition needs to account for the same 3-per-clock grouping.

## 5. The Telegram bot's grammY wiring isn't exercised by automated tests

**What it is:** `apps/api/src/telegram/bot.ts` is split into a "testable core" (`resolveConfirmablePendingAction`, `confirmPayInvoice`, `cancelPendingAction`, the message/keyboard formatters — all pure or Stripe-only functions with no grammY `Context`) and a thin wiring layer, `startTelegramBot()`, that registers the actual `bot.command`/`bot.callbackQuery` handlers. The testable core has full unit coverage (`bot.test.ts`); the wiring layer itself — the handlers that call `ctx.reply`, read `ctx.chat.id`, etc. — is not directly unit-tested.

**Why it's left as-is:** grammY's `Context` object isn't easily constructed in a unit test without a mocking layer that would mostly test the mock rather than real behavior. Instead, the wiring layer was verified by driving a real Telegram client against the running bot (Phase 6/7's live verification, including the at/above-cap handoff path against a real linked customer).

**Practical effect:** a regression introduced only in the wiring itself (e.g. a typo in which testable-core function a handler calls, or a wrong `ctx.match` group index) would not be caught by `pnpm --filter api test` — it would only surface in live manual testing or in production use. The guardrail logic these handlers call into (ownership checks, the cap, confirmation matching) is fully covered either way, since that all lives in the tested core.

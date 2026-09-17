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

# Future work

Deliberately not built — either out of scope for this build, or intentionally stubbed so the rest of the app could be demonstrated without it. Unlike "Known limitations" above (deliberate scope decisions being defended), these are gaps a production version of this app would need to close.

## Authentication

The login screen (S15, `docs/feature.md`) is a UI-only gate — any non-empty username and password is accepted, nothing is checked server-side, and the "session" is just a username string in `localStorage`. A real version needs actual credential verification, a server-side session or token (JWT/cookie), password hashing, and the routes themselves (`/api/assistant`, `/api/reminders/send`, etc.) would need to actually enforce that session rather than trusting any caller — today every backend route is reachable by anyone who can reach the port, regardless of what the login screen shows.

## Comprehensive prompts for edge cases

`system-prompt.ts` (owner) and `telegram/system-prompt.ts` (customer) cover the flows this build actually exercised, but prompt-only instructions have repeatedly proven unreliable in live testing for anything the model has to remember to *not* do — restating a tile's contents in prose despite being told not to, drafting for a customer it was told to skip, embedding a raw URL despite a separate structured field existing for it (see B9 in `docs/feature.md` for the most recent instance, and S10/S11's earlier "known minor gap" notes for the same pattern). Each case found so far was fixed with a deterministic backend override rather than more prompt wording, which works but means the fix is reactive — found live, one bug report at a time — rather than the product of a systematic edge-case pass (ambiguous references, contradictory instructions mid-conversation, adversarial input, multi-intent messages) up front.

## Comprehensive test evaluation

The backend has real coverage (296 Vitest tests as of this write-up, plus a guardrail-auditor pass on every money-moving path) and every feature was live-verified via Playwright before being called done — but there is no automated frontend test suite at all (no component tests, no frontend-driven end-to-end suite that runs in CI), no load/performance testing, and no adversarial/security testing beyond the guardrail-auditor's manual reasoning about specific attack shapes (cross-customer access, replayed confirmations, cap bypass). A production evaluation pass would want all three, plus eval-style testing of the LLM's own behavior (prompt regression tests, not just the deterministic code around it).

## Production coding standards and design patterns

This app was built conversationally and iteratively, verifying each feature as it landed rather than against a pre-agreed style guide. It's consistent in the ways that mattered for correctness (Zod at every tool boundary, the pending-action pattern, deterministic aggregation), but things a longer-lived production codebase typically formalizes were never explicitly decided: a documented error-handling convention (today it's ad hoc — some routes return `{error}` strings, some throw and let a handler catch), a logging/observability strategy beyond Fastify's default logger, and a stated position on when to add an abstraction versus inline a one-off (handled case by case per CLAUDE.md's "no premature abstraction" rule, which is a philosophy, not a design-pattern catalog).

## Email integration for notifications

Nothing in this app sends a real email. S14's payment reminders and S13's Stripe-webhook payment notification are both explicitly simulated/Telegram-only — S14 only logs what it would have sent (`routes/reminders.ts`), and S13's "notification" is a Telegram message, not an email, since no email provider is configured anywhere (the same honest gap S10's invoice-send already has for its own confirmation emails, which are Stripe's, not this app's). A real integration (Postmark, SendGrid, SES) would need its own credentials, deliverability handling, and probably a queue rather than a synchronous send in the request path.

## Real-time updates

Every dashboard panel (Today's Summary, Payment Activity, Needs Attention, Recent Activity) fetches once on mount and never refreshes itself — a payment that comes in while the owner has the page open won't appear until they reload. There's no websocket/SSE connection and no polling-refresh. A production version would want push-based updates (Stripe webhooks already arrive server-side for S13's one case — a broader webhook handler could fan out to a websocket or SSE connection per connected owner) rather than requiring a manual reload.

## Also worth flagging

- **A real, production-grade data layer.** ADR-004's "no database" decision is well-reasoned for this build's scope (Stripe already holds everything but one small mapping), but it's a decision that stops making sense the moment there's a login system with real sessions, more persisted state than one chat-id mapping, or more than one API instance running at once — all of which land squarely in "Future work" above.
- **Broader Stripe webhook coverage.** S13 handles exactly one event (`invoice.paid`, scoped to at/above-cap invoices) for one purpose. A production app would want a general-purpose webhook handler covering disputes, subscription events, and payment failures broadly, rather than one narrowly-scoped route added to solve one reported gap.
- **CI/CD.** Tests and typechecking are run manually (`pnpm --filter api test`, `tsc --noEmit`) before anything is called done; nothing runs them automatically on push or PR. A GitHub Actions workflow (or equivalent) gating merges on the existing test suite would catch a regression before it reaches `main`, not after.
- **Observability.** Structured logging exists (Fastify's built-in Pino logger), but there's no metrics, tracing, or error-reporting integration (Sentry or similar) — a production incident would be debugged from raw log lines, not a dashboard.
- **Rate limiting / abuse protection.** `POST /api/assistant` makes a real, billed OpenAI call per request with no rate limiting of any kind — anyone who can reach the API can run up the OpenAI bill. The Telegram bot has no equivalent limit either.
- **The Telegram bot's deployment posture.** It long-polls Telegram in the same process as the API (ADR-005), which is the right call for this build's scale but doesn't scale independently of the API and would typically move to a webhook-based bot (and possibly its own process) in production.

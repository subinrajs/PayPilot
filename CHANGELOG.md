# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-15

All 8 phases of `docs/plan.md` and all 8 stories of `docs/feature.md` are complete — this is the first feature-complete release.

### Added

- pnpm workspace scaffolding (`apps/web`, `apps/api`), a bare Fastify `GET /api/health`, and a Vite React shell (Phase 1).
- Stripe sandbox seed script (`pnpm seed`) creating 4 test customers, a mix of successful/declined payments, and four invoice states (paid, outstanding, overdue, at/above the cap), printing each customer's Telegram link-token (Phase 2).
- Backend core: Stripe client wiring, `policies/authorization.ts` (customer scoping) and `policies/payment-policy.ts` (the $2,000 cap), six tool implementations (daily summary, revenue comparison, invoice lookup, refund, invoice creation, invoice payment), and the pending-action/confirmation data shape (Phase 3).
- Web chat assistant: `POST /api/assistant` (OpenAI tool-calling loop; read-only tools execute inline, money-moving tools return a pending action) and `POST /api/assistant/confirm` (validates and executes/cancels a pending action) (Phase 4).
- Web chat UI: React chat interface with a distinct "confirm this action" state wired to `/api/assistant/confirm` (Phase 5).
- Telegram bot (grammY), running in-process with the API: `/start <link-token>` account linking, `/owe` invoice lookup, in-chat invoice payment under the cap, and handoff via Stripe's own hosted invoice page for invoices at/above the cap (ADR-011) (Phase 6).
- Cross-cutting guardrail test suite (`apps/api/src/guardrails.test.ts`) proving the $2,000 cap boundary, Telegram customer scoping, and cross-surface (web/Telegram) pending-action authorization hold with the real modules wired together, not just in per-module unit tests (Phase 7).
- `write-up.md`, documenting five known limitations: seed-data date clustering, the in-memory-only Telegram chat mapping, the link-token being a real Stripe customer id, the test-clock 3-customer cap, and the untested grammY wiring layer; summarized into README §9 (Phase 8).
- `.claude/context/current-feature.md` placeholder for tracking whatever's actively in progress.

### Fixed

- `POST /api/assistant/confirm` and the Telegram bot's `confirm:`/`cancel:` callbacks no longer consume a pending action before verifying it's the right tool *and* belongs to the confirming session — a pending action for the wrong surface or the wrong customer is now left completely untouched rather than silently destroyed (found by a `guardrail-auditor` pass; closed via `peekPendingAction` and a shared `resolveConfirmablePendingAction` helper) (Phase 7).

### Changed

- README's architecture overview, "why these choices," and API design sections filled in with real content (previously placeholders); README §9 now summarizes the known-limitations list (Phase 8).

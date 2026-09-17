# S11 — AI dispute assistant: working notes

Supplementary to `current-feature.md` — same reasoning as `s9-dashboard-redesign.md`/`s10-invoice-creator.md` before it. `docs/feature.md`'s `### S11` section is the source of truth for *what* this is; this file is scoped to *how* it gets built.

## The critical constraint this whole design is built around

This codebase has **no order, shipping, tracking, delivery, or CRM/communication-log system anywhere** — confirmed by grepping the entire backend (the only "order/shipping" hit at all was an unrelated code comment about list ordering). It's a Stripe test-mode sandbox: a charge has only `description`, `amount`, and a customer link. The owner's reference mockup shows a checklist with "✓ Order fulfilled / ✓ Shipping confirmation / ✓ Tracking number available / ✓ Delivery confirmation" — **none of that can be honestly auto-populated**, because the data doesn't exist. Building it anyway (faking checkmarks) would violate this project's core "never fabricate" principle, demonstrated repeatedly already (the deferred Stripe Payouts gap in S9, the deferred Stripe Tax gap in S10, the deferred real-email-provider gap).

The resolution: PayPilot auto-fills whatever real facts Stripe *does* have (customer name/email, billing address if present, charge description, a genuinely-findable matching charge for "duplicate" disputes), is honest about what it doesn't have, and lets the owner supply the rest **conversationally** — the model captures what the owner tells it (e.g. "shipped via UPS, tracking 1Z999, delivered Sept 13") and passes it as tool arguments on the next drafting call. The AI's real value is turning scattered real + owner-supplied facts into Stripe's structured evidence fields and a clear written response — not inventing evidence sources.

## Architecture decision: mirrors S10's draft/confirm split exactly

Stripe's `disputes.update(id, {evidence, submit})` — `submit` **defaults to `true`** (a critical gotcha: every staging call in this codebase must pass `submit: false` explicitly). Staging evidence (`submit:false`) is safe, reversible, and re-editable — exactly like a Stripe invoice draft — so it happens immediately, no pending action. Only `submit: true` (sends to the card network) or `disputes.close()` (concedes, irreversible) are real consequential actions, gated behind the existing pending-action confirm ceremony. This is the same reasoning as ADR-012 (S10's invoice-draft decision), applied to disputes — will get its own ADR alongside it.

## Reason → evidence fields (deterministic lookup, not LLM judgment)

Stripe's real `Dispute.reason` values: `bank_cannot_process`, `check_returned`, `credit_not_processed`, `customer_initiated`, `debit_not_authorized`, `duplicate`, `fraudulent`, `general`, `incorrect_account_details`, `insufficient_funds`, `product_not_received`, `product_unacceptable`, `subscription_canceled`, `unrecognized` (it's a plain `string` in this SDK version, not a literal union — the doc comment lists these). Each maps to a curated subset of Stripe's evidence fields:

- `product_not_received` → shipping carrier/tracking number/date/address + narrative
- `fraudulent` → customer name/email/purchase IP/billing address + narrative
- `duplicate` → duplicate charge id/explanation + narrative (duplicate charge id is genuinely auto-findable — see below)
- `product_unacceptable` → product description + refund policy disclosure + narrative
- `credit_not_processed` → refund refusal explanation + service date + narrative
- `subscription_canceled` → cancellation policy disclosure + cancellation rebuttal + narrative
- everything else (`unrecognized`, `general`, and Stripe reasons with no specific mapping) → a generic fallback: product description + narrative

## Auto-fillable vs. owner-supplied

**Always auto-filled from real Stripe data** (never asked of the model or owner): `customer_name`/`customer_email_address` from the disputed charge's `billing_details` (falls back to the Customer object), `billing_address` when present, `product_description` from the charge's `description`. For `duplicate` specifically: search that customer's recent charges (reusing existing charge-fetching utilities) for another succeeded charge at the same amount within ~7 days — a real, checkable fact, auto-fill `duplicate_charge_id` if found.

**Never auto-fillable, stays "missing" unless supplied**: shipping carrier/tracking/date/address, service date, access activity log, cancellation/refund policy text, refund-refusal explanation. The tool accepts a handful of well-named args (`shippingCarrier`, `shippingTrackingNumber`, etc. — not raw Stripe snake_case) rather than exposing all 18 evidence field names raw to the model.

## Six new tools

1. `get_disputes` (reuses `getDisputesSummary` from `agent/dashboard.ts` directly, registered in `tool-registry.ts` — no new file) — read-only, executes immediately. Lists every dispute still needing a response, account-wide. Added mid-implementation once the original 5-tool plan turned out to have no way to answer "what disputes need attention" at all — see the gap note below.
2. `get_dispute_evidence` (`getDisputeEvidence`, in `agent/tools/dispute-response.ts`) — read-only, executes immediately. Returns the checklist (found/missing per relevant field) + dispute facts for ONE dispute by id. Answers "what evidence do we have" for a specific dispute.
3. `draft_dispute_response` (`draftDisputeResponse`) — model supplies `narrative` (it composes this itself from real facts + whatever the owner said — no second internal OpenAI call, same as how `memo`/`description` args are already model-authored elsewhere) + any evidence fields it captured conversationally. Stages via `disputes.update(id, {evidence, submit:false})`. Returns checklist + narrative + a short `assessment` (missing-evidence count if any, plus an always-present "can't guarantee the outcome" disclaimer).
4. `update_dispute_response` (`updateDisputeResponse`) — same shape, only re-stages passed fields, for conversational revision.
5. `submit_dispute_evidence` (backing fn `proposeSubmitDisputeEvidence`/`executeSubmitDisputeEvidence`) — pending action. Execute just calls `disputes.update(id, {submit:true})` — no need to resend evidence, it's already staged.
6. `decline_dispute` (backing fn `proposeDeclineDispute`/`executeDeclineDispute`) — pending action. Execute calls `disputes.close(id)`.

`dispute-response.ts`'s five tools (#2-6) all re-fetch the dispute/charge fresh rather than trusting stale state — mirrors `refund.ts`'s `executeRefund` re-validation discipline. `get_disputes` needs no such guard, since it's a pure list read with no id to go stale.

## Build order — progress

1. ✅ `dispute-response.ts`: reason→fields mapping, all 5 tools, the duplicate-charge auto-find helper.
2. ✅ `routes/assistant.ts`'s confirm dispatch, `tool-registry.ts` (6 new tools counting `get_disputes` — see gap note below — 10 → 16), `system-prompt.ts` guidance including the explicit "never guarantee the outcome" rule.
3. ✅ Backend tests: `dispute-response.test.ts` (18 tests — all 5 tools, checklist honesty, staging vs. submit distinction, decline, re-validation against an already-resolved dispute), `tool-registry.test.ts` count, `fake-stripe.ts` extended (`disputes.retrieve`/`update`/`close`, `fakeDisputeEvidence`, sensible defaults for `customers.retrieve`/`charges.list` that several other tests turned out to need too). Full suite: 209/209 passing.
4. ✅ `apps/api/src/seed.ts`: one real disputed charge via `PaymentIntent` + `pm_card_createDisputeProductNotReceived`, customer Acme Corp, $890.00, description "Office equipment order." Stripe's own documented example call shape (found via their API reference page) worked on the first real attempt — no trial and error needed. The dispute appeared **immediately** (not the few-seconds delay the docs implied) — `du_1UGdRNIaARQPQcXlELJbUSEi`, `product_not_received`, correctly linked to Acme Corp's customer id.
5. ✅ Frontend: `api.ts` types, `DisputeResponseCard.tsx`, `toolResults.ts`/`MessageList.tsx` wiring, `NeedsAttentionPanel.tsx`'s per-dispute "Review Response →" action (embeds the real Stripe dispute id directly in the synthetic chat message, since the model needs the exact id to call `get_dispute_evidence`), `PendingActionPanel.tsx`'s two new branches, `App.tsx`'s confirm-narration cases. Generalized the invoice-era `editHintActive`/`handleEditInvoiceDraft` into a reusable `editHint: string | null`/`handleRequestEdit(hint)` so both cards' Edit buttons share one focus/placeholder mechanism with their own contextual hint text.
6. ✅ Live Playwright verification against the real seeded dispute — full lifecycle: dashboard showed it → clicked "Review Response →" → checklist honestly showed all 4 shipping fields as missing (real auto-filled customer name/email only) → supplied shipping carrier/tracking/date conversationally → drafted a response → review card showed the correct staged fields + narrative → clicked Submit Evidence → confirmed → **verified directly against the real Stripe API**: `status` moved from `needs_response` to `under_review`, `evidence_details.has_evidence: true`, `submission_count: 1`, every evidence field (auto-filled + conversational + AI-drafted narrative) present exactly as expected.
7. ✅ Doc sync: `docs/spec.md`, `docs/design.md`, `docs/decisions.md` (ADR-013), `docs/feature.md`'s S11 row → `Done`, this file, `current-feature.md` reset to placeholder.

## Gap found and fixed during implementation: no way to *list* disputes in chat

The original plan's 5 tools all operate on an already-known `disputeId` — but the user's own example flow includes "What disputes need my attention?" as a plain chat question, and there was no chat tool that could answer it (only the LLM-free dashboard route could). Fixed by adding a 6th tool, `get_disputes`, which directly reuses the existing `getDisputesSummary` from `agent/dashboard.ts` (already exactly the right shape) — registered in `tool-registry.ts` with no new aggregation logic. Not given a tile (deliberately) — narrated in plain conversational prose, matching the user's own example ("You have 3 open disputes totaling $3,420...") rather than a dumped list; the rich per-dispute card still comes from `get_dispute_evidence` once a specific dispute is identified.

## Known minor gap, not fixed (consistent with prior session precedent)

The model doesn't always follow the "the card already shows this, keep your reply to one line" tile-shortcut instruction perfectly — in live testing it sometimes still enumerates the evidence checklist in prose after calling `get_dispute_evidence`, duplicating what `DisputeResponseCard` already shows. Same class of minor prompt-adherence gap already observed and left as-is after S10 (e.g. invoice line items sometimes restated in prose); not a functional or data-honesty bug, just narration verbosity.

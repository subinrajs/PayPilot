# S10 — AI invoice creator, reviewer & sender: working notes

Supplementary to `current-feature.md` — same reasoning as `s9-dashboard-redesign.md` before it: this story is bigger than the current-feature.md template comfortably holds. `docs/feature.md`'s `### S10` section is still the source of truth for *what* this is; this file is scoped to *how* it gets built.

## Four architecture decisions already made (confirmed with the owner before implementation)

**1. The Stripe draft invoice is created immediately, not deferred to a confirm step.** When the owner first asks to create an invoice, the backend resolves the customer, creates real `invoiceItems` and a real Stripe invoice in `draft` status right away — no charge, nothing emailed, fully reversible via `stripe.invoices.del()`. Only **sending** (finalize + email, a real customer-visible effect) goes through the existing pending-action confirm ceremony. This lets Stripe stay the sole source of truth for the draft throughout, including multi-turn edits ("make it due in 15 days") — those just update the real Stripe object rather than some parallel in-memory structure this app would have to invent and keep in sync.

**2. Reviewer checks are 4 deterministic, reused-data checks — no new Stripe API surface, no LLM judgment:**
   - Missing customer email (`customer.email` null/empty).
   - Overdue risk: `lookupInvoices(stripe, customerId, {status:"overdue"})` — flag count + total if any.
   - Unusual amount: average of that customer's other non-draft, non-void invoices (excluding the new draft itself); flag if the new total is >40% above that average. Skipped silently if there's no prior history to compare against.
   - Duplicate: same total amount + same/similar memo (case-insensitive) for that customer within the last 30 days — an intentionally coarse, exact-match heuristic, not fuzzy matching.
   Checks that pass are shown too (✓), not just problems (⚠) — matches the reference mockup's style.

**3. No proactive overdue monitoring.** No webhook or notification infrastructure exists anywhere in this codebase (confirmed zero webhook code during research). The mockup's "I'll monitor this invoice and notify you if it becomes overdue" line is dropped from the assistant's actual reply — the sent invoice already surfaces automatically in the existing Needs Attention dashboard panel (`getOverdueInvoicesSummary`) once it's genuinely overdue, and the reply says this honestly instead.

**4. Tax is deferred.** Always shown as "Tax: Not configured." Same reasoning as S9's deferred Stripe Payouts gap — it's unconfirmed whether Stripe Tax is even enabled on this test account, and wiring `automatic_tax` in without that confirmation risks a silently-broken feature rather than an honestly-unbuilt one.

## Stripe SDK facts this design leans on (verified against the installed SDK's types, not assumed)

- `stripe.invoiceItems.create({customer, currency, quantity, unit_amount, description})` is the correct shape for a quantity×unit-price line item — no `price`/product object needed, `amount` (flat) and `quantity`+`unit_amount` (multiplied) are alternative paths on the same params type.
- `finalizeInvoice` and `sendInvoice` are genuinely separate Stripe API calls. `finalizeInvoice(id, {auto_advance:false})` prevents any implicit auto-collection/auto-send, so the explicit `sendInvoice(id)` call is the one deterministic dispatch point — this is what "Approve & Send" actually triggers.
- `Invoice.number` is `null` until finalize — the review card (shown pre-send, while still draft) must never fabricate an invoice number; only the post-send confirmation can show the real one.
- `stripe.invoices.del(id)` deletes a **draft** invoice (used for Discard). `voidInvoice` is for already-finalized invoices and isn't used in this story.

## What's reused, not rebuilt

- Pending-action pattern (`agent/pending-action.ts`, `pending-action-store.ts`, `routes/assistant.ts`'s confirm handler) — reused as-is for the new `send_invoice` tool, same re-validate-at-confirm-time discipline as `refund.ts`.
- `findCustomersByReference`/`displayName` (`customer-resolution.ts`) — unchanged, reused for resolving `customerReference`.
- `lookupInvoices`/`lookupCustomerInvoices` (`invoice-lookup.ts`/`owner-invoice-lookup.ts`) — reused for all 4 reviewer checks, all per-customer, zero new Stripe surface.

## Build order — progress

1. ✅ Backend rewrite of `apps/api/src/agent/tools/invoice-creation.ts`: multi-item schema, `createInvoiceDraft`, `updateInvoiceDraft`, `discardInvoiceDraft`, `proposeSendInvoice`, `executeSendInvoice`, the 4 reviewer checks. Also extended `invoice-lookup.ts`'s `InvoiceLookupResultItem` with a `createdAt` field (Stripe's `invoice.created`) — needed for the duplicate check's recency comparison, since `dueDate` is typically in the future and was the wrong signal for "sent recently."
2. ✅ `routes/assistant.ts`'s confirm dispatch and tool allow-list (`"create_invoice"` → `"send_invoice"`), `tool-registry.ts` (4 new tools replacing 1, 7 → 10 total), `system-prompt.ts` guidance for the create/update/discard/send lifecycle.
3. ✅ Backend tests: full rewrite of `invoice-creation.test.ts` (20 tests covering create/update/discard/propose-send/execute-send plus each of the 4 reviewer checks), `tool-registry.test.ts` tool count (10), `fake-stripe.ts` extended with `invoices.update`/`sendInvoice`/`del`, `invoiceItems.list`/`del`, `fakeInvoiceItem`. Full suite: 191/191 passing.
4. ✅ Frontend: `api.ts` types (`InvoiceDraft`, `InvoiceDraftLineItem`, `InvoiceDraftReviewFlag`, `SendInvoicePendingArgs`, `SentInvoice`), new `InvoiceReviewCard.tsx` tile (wired into `toolResults.ts`/`MessageList.tsx`), `PendingActionPanel.tsx`'s `send_invoice` branch, `App.tsx`'s send-confirmation narration (`describeSentInvoice`), a `focusSignal` prop on `ChatInput.tsx` + an edit-hint placeholder for the review card's "Edit" button (no full edit form — conversational only, per plan).
5. ✅ Live Playwright verification against real seed data: created a multi-item draft for John Smith (10h consulting + 5h development) — review card correctly flagged his real overdue $320 invoice and an unusual-amount warning; edited the due date via a natural-language follow-up, confirmed it updated the same draft (not a duplicate); approved & sent; confirmed the real result — invoice number `EBOBP2MY-0005`, a working hosted invoice URL, and the honest "you'll see it in Needs Attention if it becomes overdue" narration (no false monitoring promise).
6. ✅ Doc sync: `docs/spec.md`, `docs/design.md` (money-moving description + tools list + reviewer-checks note), `docs/decisions.md` (ADR-012), `docs/feature.md`'s S10 row → `Done`, this file, `current-feature.md` reset to placeholder.

## Known scope boundaries (see docs/feature.md's S10 non-goals for the full list)

Tax, proactive/webhook-based overdue notifications, a line-item edit form, and predictive payment-timing analytics are all explicitly out of scope for this story — not overlooked, deliberately deferred with reasoning recorded in `docs/feature.md`.

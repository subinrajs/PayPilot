# S9 — dashboard redesign: working notes

Supplementary to `current-feature.md` — S9 is bigger than that template's five fields comfortably hold, so the fuller design notes live here. Source of truth for the story itself is still `docs/feature.md`'s `### S9` section; this file is scoped to *how* it'll get built, not a restatement of *what* it is.

## Two architecture decisions already made

**1. Dashboard panels fetch data via a new direct read-only endpoint, not the chat loop.**
The always-visible panels (Today's Summary now, Payment Activity/Recent Activity/Needs Attention later) need data on page load, before the owner has typed anything. Driving that through `POST /api/assistant` with a synthetic prompt would cost a real OpenAI call and latency on every page load, and couples a passive display to conversational infrastructure that isn't really built for it. Instead: a new route (working name `GET /api/dashboard/summary`, exact shape TBD when built) calls the existing aggregation functions directly — no LLM involved at all, matching "deterministic data, no narration needed" even more purely than the chat tools do. This is a new addition to `docs/design.md`'s API surface once built.

**2. `current-feature.md` scopes to all of S9 as one active unit**, not split into separate phased backlog rows — per explicit instruction, even though the story is large. The build order below still sequences the work internally; it just isn't chopped into separate `S`/`T` backlog entries the way, e.g., B1/T1 were split out of a single bug report earlier in this project.

## Panel-by-panel: already-available vs. new capability

(Restated from `docs/feature.md`'s S9 section for quick reference while implementing — that section is still the source of truth if these ever drift.)

| Panel | Data need | Status |
|---|---|---|
| Today's Summary — sales + % vs yesterday, failed-charge count, bar chart | `get_daily_summary` + a today-vs-yesterday `get_revenue_comparison` call | ✅ Shipped (`GET /api/dashboard/summary`) |
| Today's Summary — deposits, failed payouts | Stripe *Payouts* API | **Correction, found mid-implementation**: not in the original already-vs-new breakdown at all — this is a different Stripe object (money Stripe → bank account) the app has never touched. Not shown; not faked. New capability, not yet built. |
| Payment Activity (7/30/90-day line chart) | Day-by-day time series over a range | ✅ Shipped (`GET /api/dashboard/activity`, `bucketDailyTotals` in `aggregation.ts`) |
| Needs Attention — overdue invoices | Overdue invoices *across all customers* | ✅ Shipped (`GET /api/dashboard/overdue-invoices`, `getOverdueInvoicesSummary` in `agent/dashboard.ts`) |
| Needs Attention — payment disputes | Stripe Disputes | ✅ Shipped (`GET /api/dashboard/disputes`, `getDisputesSummary`) — reads as 0 against seed data today since `seed.ts` doesn't create a test dispute; see the note below the build order |
| Recent Activity feed | Chronological cross-customer payments/refunds/invoices | ✅ Shipped (`GET /api/dashboard/recent-activity`, `getRecentActivity` in `agent/dashboard.ts`) |
| Center chat panel | Existing chat/tiles/`PendingActionPanel` | Unchanged, as planned |
| Suggested-prompt chips | None (just UI) | ✅ Shipped — hidden once the conversation starts |

## Build order — progress

1. ✅ Dashboard read endpoint serving Today's Summary (`agent/dashboard.ts`'s `getTodaysSummary`, `routes/dashboard.ts`).
2. ✅ Day-by-day time-series aggregation (`bucketDailyTotals` in `aggregation.ts`, `lastNDays` in `charge-fetching.ts`) wired into the same route file's `/activity` endpoint.
3. ✅ Cross-customer overdue-invoices aggregate (`getOverdueInvoicesSummary` in `agent/dashboard.ts`, reuses `customer-resolution.ts`'s `listAllCustomers` — exported for this purpose — plus the existing per-customer `lookupInvoices`). N+1 Stripe-call pattern (one customer scan + one invoices list per customer) — documented as acceptable at this project's test-account scale, revisit if it ever needs to handle many customers.
4. ✅ Stripe Disputes integration (`getDisputesSummary` in `agent/dashboard.ts`) — this codebase's first use of the Disputes API. Filters to `needs_response`/`warning_needs_response` only (resolved/already-answered disputes aren't actionable, so don't belong on a "needs attention" panel); pulls the customer's name from the disputed charge's `billing_details.name` (via `expand: ["data.charge"]`) rather than a separate customer lookup.
5. ✅ Cross-customer recent-activity feed (`getRecentActivity` in `agent/dashboard.ts`, `GET /api/dashboard/recent-activity`) — merges charges/refunds/invoices into one newest-first feed, capped at 10 events; deliberately excludes "invoice paid" as its own event to avoid double-counting the charge that pays it.
6. **Not started.** New: Stripe Payouts integration for Deposits/Failed Payouts (discovered mid-implementation — see the correction above; wasn't in the original scope breakdown at all).
7. ✅ Frontend layout is now the real 3-column shape: left = `Sidebar` (identity only, capability chips dropped — the mockup's left column doesn't have them either) + `TodaysSummaryPanel` + `PaymentActivityPanel`; center = chat, unchanged; right = `NeedsAttentionPanel` (combining disputes and overdue invoices in one amber-accented card, calm neutral state when neither has anything) + `RecentActivityPanel` below it (10-item event list, dot-coded by type, amount + relative-time per row — stacked two-line layout per row since the ~288px column is too narrow to fit label/time/amount on one line without truncating the label).
8. ✅ Suggested-prompt chips above `ChatInput`.
9. ✅ Bar chart (`BarChart.tsx`) and line chart (`LineChart.tsx`) — hand-rolled SVG/div, no new dependency (resolves the open question below).
10. Doc sync: `docs/design.md`'s API surface ✅ updated with all five shipped routes; `docs/feature.md`'s S9 section and status row ✅ updated to reflect what's shipped vs. not. `docs/spec.md` still deferred until the whole story is done (per the original plan — this slice doesn't add a spec-level capability, it's a new delivery mechanism for capabilities already in spec).

## Known gap: disputes can't be demonstrated against real seed data yet

`seed.ts` only creates ordinary succeeded/failed charges — Stripe test-mode disputes require a special dispute-triggering test flow (e.g. a specific test card/PaymentIntent path) the seed script doesn't use. So `GET /api/dashboard/disputes` correctly and honestly reads `{count: 0, ...}` against the current seed data — verified that empty state is real, not just assumed. The "has disputes" rendering path was separately verified via a mocked API response in Playwright (route interception, not fake production data) to confirm the UI itself is correct. If you want this demonstrable end-to-end with real data, `seed.ts` would need extending — not done here since it's a scope decision, not something to make unilaterally.

## Resolved: charting approach

Hand-rolled — `BarChart.tsx` (flex/div bars) and `LineChart.tsx` (small SVG polyline + circles). No charting library added. Confirmed working via live Playwright verification, including the 7/30/90-day range toggle.

## Bug found and fixed during implementation

`PaymentActivityPanel`'s range-toggle fetch had no stale-response guard — if the initial 7-day fetch on mount resolved *after* a newly-selected range's fetch (a plain React race condition), the older response would silently overwrite the newer one, and the chart would keep showing the wrong range. Fixed with a `cancelled` flag set in the effect's cleanup, applied to both `PaymentActivityPanel` and (defensively, no observed bug there) `TodaysSummaryPanel`. Verified via a direct Playwright check counting rendered chart points before/after toggling (7 → 30, confirmed 30 distinct points render, not 7).

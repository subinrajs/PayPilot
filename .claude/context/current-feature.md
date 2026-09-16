# Current feature

*(placeholder — fill in with whatever is being worked on right now, and clear/replace it once that work lands)*

- **Feature/phase:** S9 — Redesign web chat UI as a dashboard (`docs/feature.md`)
- **Status:** In progress — Today's Summary, Payment Activity (7/30/90-day toggle), Needs Attention (cross-customer overdue invoices + payment disputes), Recent Activity feed, and suggested-prompt chips are shipped and verified. Only the Payouts/Deposits integration is not started.
- **Context / why:** Replace the current sidebar-plus-chat web UI with a dashboard layout per `docs/assets/PayPilot Web UI.png`. See `docs/feature.md`'s `### S9` section for the current panel-by-panel status.
- **Relevant files:**
  - `docs/feature.md` (`### S9` — source of truth, now annotated with what's shipped vs. not)
  - `.claude/context/s9-dashboard-redesign.md` (fuller working notes)
  - `docs/assets/PayPilot Web UI.png` (reference mockup)
  - `docs/design.md` (API surface — updated with all five shipped dashboard routes)
  - `apps/api/src/agent/dashboard.ts` (all five dashboard aggregates), `routes/dashboard.ts`, `agent/aggregation.ts` (`bucketDailyTotals`), `agent/charge-fetching.ts` (`lastNDays`), `agent/customer-resolution.ts` (`listAllCustomers`, exported) — shipped backend
  - `apps/web/src/components/TodaysSummaryPanel.tsx`, `PaymentActivityPanel.tsx`, `NeedsAttentionPanel.tsx`, `RecentActivityPanel.tsx`, `BarChart.tsx`, `LineChart.tsx`, `SuggestedPrompts.tsx`, `Sidebar.tsx`, `App.tsx` — shipped frontend (full 3-column layout)
- **Next steps:**
  1. Deposits/Failed Payouts — new Stripe Payouts API integration (discovered mid-implementation), added to Today's Summary once built. This is the only remaining S9 panel.
  2. Optional/ask-first: extend `seed.ts` to create a real test dispute (via Stripe's dispute-triggering test flow) so the Needs Attention panel's dispute section can be demonstrated against real seed data, not just verified via a mocked response — currently a known, documented gap, not a bug.
  3. Once the above lands: sync `docs/spec.md` (new capabilities), re-verify `docs/feature.md`'s S9 row → `Done` via `plan-tracker`, reset this file to its placeholder.

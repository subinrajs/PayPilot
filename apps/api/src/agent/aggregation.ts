// Pure functions only — no Stripe import, no I/O. Tool wrappers fetch data and pass it here; only
// the resulting plain JSON goes to the model. The model narrates these numbers, it never derives
// them — this file is that boundary made concrete rather than a convention someone could miss.

export interface ChargeLike {
  id: string;
  amountCents: number;
  // Stripe doesn't change a charge's `status` when it's refunded — a fully or partially
  // refunded charge still reports status "succeeded". Without this, a refunded charge would be
  // silently counted as revenue kept, which is wrong.
  amountRefundedCents: number;
  status: "succeeded" | "failed" | "pending";
  // The real Stripe customer id — used to group charges by customer (rankCustomersByRevenue
  // below) without the collision risk of grouping by name (two customers can share a display
  // name; a null/blank name would otherwise merge every nameless customer into one bucket).
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  description: string | null;
  // UTC calendar day the charge was created on (YYYY-MM-DD) — used to bucket charges by day for
  // the Payment Activity chart (see bucketDailyTotals below). Unused by summarizeCharges/
  // compareRevenue, but populated on every charge regardless so callers don't need two shapes.
  date: string;
}

export interface DailySummary {
  date: string;
  succeededCount: number;
  // Gross amount of succeeded charges, before refunds.
  succeededTotalCents: number;
  // Portion of that gross amount later refunded.
  refundedTotalCents: number;
  // succeededTotalCents - refundedTotalCents — the actual revenue kept.
  netTotalCents: number;
  failedCount: number;
  charges: ChargeLike[];
}

export function summarizeCharges(date: string, charges: ChargeLike[]): DailySummary {
  const succeeded = charges.filter((c) => c.status === "succeeded");
  const failed = charges.filter((c) => c.status === "failed");

  const succeededTotalCents = succeeded.reduce((sum, c) => sum + c.amountCents, 0);
  const refundedTotalCents = succeeded.reduce((sum, c) => sum + c.amountRefundedCents, 0);

  return {
    date,
    succeededCount: succeeded.length,
    succeededTotalCents,
    refundedTotalCents,
    netTotalCents: succeededTotalCents - refundedTotalCents,
    failedCount: failed.length,
    charges,
  };
}

export interface RevenuePeriodInput {
  label: string;
  startDate: string;
  endDate: string;
  charges: ChargeLike[];
}

export interface RevenuePeriod {
  label: string;
  startDate: string;
  endDate: string;
  // Net of refunds — the figure "how much did we take" should mean.
  totalCents: number;
  grossCents: number;
  refundedCents: number;
  chargeCount: number;
}

export interface RevenueComparison {
  current: RevenuePeriod;
  previous: RevenuePeriod;
  differenceCents: number;
  // null when the previous period had zero revenue — a percentage change is undefined there,
  // not zero or infinite, and NaN/Infinity can't round-trip through JSON to the model anyway.
  percentChange: number | null;
}

function toRevenuePeriod(input: RevenuePeriodInput): RevenuePeriod {
  const succeeded = input.charges.filter((c) => c.status === "succeeded");
  const grossCents = succeeded.reduce((sum, c) => sum + c.amountCents, 0);
  const refundedCents = succeeded.reduce((sum, c) => sum + c.amountRefundedCents, 0);

  return {
    label: input.label,
    startDate: input.startDate,
    endDate: input.endDate,
    totalCents: grossCents - refundedCents,
    grossCents,
    refundedCents,
    chargeCount: succeeded.length,
  };
}

export function compareRevenue(
  current: RevenuePeriodInput,
  previous: RevenuePeriodInput,
): RevenueComparison {
  const currentPeriod = toRevenuePeriod(current);
  const previousPeriod = toRevenuePeriod(previous);
  const differenceCents = currentPeriod.totalCents - previousPeriod.totalCents;
  const percentChange =
    previousPeriod.totalCents === 0 ? null : (differenceCents / previousPeriod.totalCents) * 100;

  return { current: currentPeriod, previous: previousPeriod, differenceCents, percentChange };
}

export interface DailyBucket {
  date: string;
  // Net of refunds, succeeded charges only — same "revenue kept" meaning as RevenuePeriod's
  // totalCents, just broken out per day instead of summed across a whole range.
  totalCents: number;
}

// `days` is the full list of calendar days to report, oldest first, including ones with zero
// activity — the Payment Activity chart needs an unbroken day-by-day series, not just the days
// that happened to have a charge. `charges` may span outside `days`; anything outside is ignored
// rather than assumed to be a caller error, since the caller (agent/dashboard.ts) fetches by a
// plain date range and this function is what actually enforces the bucket boundaries.
export function bucketDailyTotals(charges: ChargeLike[], days: string[]): DailyBucket[] {
  const totals = new Map<string, number>(days.map((date) => [date, 0]));

  for (const charge of charges) {
    if (charge.status !== "succeeded") continue;
    if (!totals.has(charge.date)) continue;
    const net = charge.amountCents - charge.amountRefundedCents;
    totals.set(charge.date, totals.get(charge.date)! + net);
  }

  return days.map((date) => ({ date, totalCents: totals.get(date)! }));
}

export interface CustomerRevenueTotal {
  customerId: string;
  customerName: string;
  // Net of refunds, succeeded charges only — same "revenue kept" meaning as RevenuePeriod's
  // totalCents.
  totalCents: number;
  chargeCount: number;
}

// Grouped by customerId (never by name — two customers can share a display name, and a null name
// would otherwise merge every nameless customer into a single bucket). Sorted highest total
// first. Charges with no customer attached (a one-off/guest payment) are excluded — nothing to
// rank them against.
export function rankCustomersByRevenue(charges: ChargeLike[]): CustomerRevenueTotal[] {
  const totals = new Map<string, { customerName: string; totalCents: number; chargeCount: number }>();

  for (const charge of charges) {
    if (charge.status !== "succeeded" || !charge.customerId) continue;
    const net = charge.amountCents - charge.amountRefundedCents;
    const existing = totals.get(charge.customerId);
    if (existing) {
      existing.totalCents += net;
      existing.chargeCount += 1;
    } else {
      totals.set(charge.customerId, {
        customerName: charge.customerName ?? charge.customerEmail ?? charge.customerId,
        totalCents: net,
        chargeCount: 1,
      });
    }
  }

  return [...totals.entries()]
    .map(([customerId, v]) => ({ customerId, ...v }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

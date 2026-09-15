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
  customerName: string | null;
  description: string | null;
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

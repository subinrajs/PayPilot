// Pure functions only — no Stripe import, no I/O. Tool wrappers fetch data and pass it here; only
// the resulting plain JSON goes to the model. The model narrates these numbers, it never derives
// them — this file is that boundary made concrete rather than a convention someone could miss.

export interface ChargeLike {
  id: string;
  amountCents: number;
  status: "succeeded" | "failed" | "pending";
  customerName: string | null;
  description: string | null;
}

export interface DailySummary {
  date: string;
  succeededCount: number;
  succeededTotalCents: number;
  failedCount: number;
  charges: ChargeLike[];
}

export function summarizeCharges(date: string, charges: ChargeLike[]): DailySummary {
  const succeeded = charges.filter((c) => c.status === "succeeded");
  const failed = charges.filter((c) => c.status === "failed");

  return {
    date,
    succeededCount: succeeded.length,
    succeededTotalCents: succeeded.reduce((sum, c) => sum + c.amountCents, 0),
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
  totalCents: number;
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
  return {
    label: input.label,
    startDate: input.startDate,
    endDate: input.endDate,
    totalCents: succeeded.reduce((sum, c) => sum + c.amountCents, 0),
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

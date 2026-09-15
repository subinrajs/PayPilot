import { z } from "zod";
import type Stripe from "stripe";
import { fetchChargesInRange, isoDateToUnixSeconds } from "../charge-fetching.js";
import { compareRevenue, type RevenueComparison } from "../aggregation.js";

const PeriodArgsSchema = z.object({
  label: z.string().min(1),
  // endDate is EXCLUSIVE (charges are fetched as [startDate, endDate)), matching UTC-day
  // boundaries the same way daily-summary.ts does for a single day. A period meant to cover
  // Sep 1-7 inclusive must be passed as startDate: "2026-09-01", endDate: "2026-09-08" — Phase
  // 4's tool description for the model needs to say this explicitly, or "last week" will read as
  // one day short.
  startDate: z.string().date(),
  endDate: z.string().date(),
});

// Owner-only, read-only — executes immediately, no pending action. Both periods' date ranges are
// concrete dates the model has already resolved from something like "last week"; this tool stays
// independent of any date-parsing correctness.
export const RevenueComparisonArgsSchema = z
  .object({
    current: PeriodArgsSchema,
    previous: PeriodArgsSchema,
  })
  .strict();
export type RevenueComparisonArgs = z.infer<typeof RevenueComparisonArgsSchema>;

export async function getRevenueComparison(
  stripe: Stripe,
  args: RevenueComparisonArgs,
): Promise<RevenueComparison> {
  const parsed = RevenueComparisonArgsSchema.parse(args);

  const [currentCharges, previousCharges] = await Promise.all([
    fetchChargesInRange(stripe, isoDateToUnixSeconds(parsed.current.startDate), isoDateToUnixSeconds(parsed.current.endDate)),
    fetchChargesInRange(
      stripe,
      isoDateToUnixSeconds(parsed.previous.startDate),
      isoDateToUnixSeconds(parsed.previous.endDate),
    ),
  ]);

  return compareRevenue(
    { ...parsed.current, charges: currentCharges },
    { ...parsed.previous, charges: previousCharges },
  );
}

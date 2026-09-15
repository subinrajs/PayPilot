import { z } from "zod";
import type Stripe from "stripe";
import { fetchChargesInRange, isoDateToUnixSeconds } from "../charge-fetching.js";
import { summarizeCharges, type DailySummary } from "../aggregation.js";

// Owner-only, read-only — executes immediately, no pending action, no customer scoping needed.
export const DailySummaryArgsSchema = z.object({ date: z.string().date() }).strict();
export type DailySummaryArgs = z.infer<typeof DailySummaryArgsSchema>;

export async function getDailySummary(stripe: Stripe, args: DailySummaryArgs): Promise<DailySummary> {
  const parsed = DailySummaryArgsSchema.parse(args);
  const startSec = isoDateToUnixSeconds(parsed.date);
  const endSec = startSec + 24 * 60 * 60;

  const charges = await fetchChargesInRange(stripe, startSec, endSec);
  return summarizeCharges(parsed.date, charges);
}

import { z } from "zod";
import type Stripe from "stripe";
import { fetchCharges, isoDateToUnixSeconds } from "../charge-fetching.js";
import { rankCustomersByRevenue, type CustomerRevenueTotal } from "../aggregation.js";

// Owner-only, read-only, account-wide — executes immediately, no pending action. Same B4/B6-shaped
// gap (docs/feature.md) as get_outstanding_invoices/get_customers: without this, "which customer
// has the highest payments" or "who are my top customers" has no tool to answer it, since every
// per-customer tool requires already knowing which customer to ask about.
export const TopCustomersArgsSchema = z
  .object({
    // Both optional and BOTH-or-NEITHER — "highest payments" naturally means all-time unless the
    // owner narrows it, unlike get_refunds (always requires an explicit range). endDate stays
    // EXCLUSIVE, same convention as get_refunds/get_revenue_comparison, when both are given.
    startDate: z.string().date().optional(),
    endDate: z.string().date().optional(),
    limit: z.number().int().positive().max(50).optional(),
  })
  .strict()
  .refine((v) => (v.startDate === undefined) === (v.endDate === undefined), {
    message: "startDate and endDate must be given together, or both omitted for all-time",
  });
export type TopCustomersArgs = z.infer<typeof TopCustomersArgsSchema>;

export interface TopCustomersResult {
  startDate: string | null;
  endDate: string | null;
  customers: CustomerRevenueTotal[];
}

const DEFAULT_LIMIT = 10;

export async function getTopCustomers(stripe: Stripe, args: TopCustomersArgs): Promise<TopCustomersResult> {
  const parsed = TopCustomersArgsSchema.parse(args);

  const range =
    parsed.startDate && parsed.endDate
      ? { startSec: isoDateToUnixSeconds(parsed.startDate), endSec: isoDateToUnixSeconds(parsed.endDate) }
      : undefined;

  const charges = await fetchCharges(stripe, range);
  const ranked = rankCustomersByRevenue(charges);
  const limit = parsed.limit ?? DEFAULT_LIMIT;

  return {
    startDate: parsed.startDate ?? null,
    endDate: parsed.endDate ?? null,
    customers: ranked.slice(0, limit),
  };
}

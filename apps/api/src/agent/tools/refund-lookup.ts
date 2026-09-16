import { z } from "zod";
import type Stripe from "stripe";
import { isoDateToUnixSeconds } from "../charge-fetching.js";

// Owner-only, read-only — executes immediately, no pending action. Mirrors revenue-comparison.ts's
// date-range convention: endDate is EXCLUSIVE, so a range meant to cover Sep 1-7 inclusive must be
// passed as startDate: "2026-09-01", endDate: "2026-09-08".
export const RefundLookupArgsSchema = z
  .object({
    startDate: z.string().date(),
    endDate: z.string().date(),
  })
  .strict();
export type RefundLookupArgs = z.infer<typeof RefundLookupArgsSchema>;

export interface RefundLookupItem {
  id: string;
  amountCents: number;
  // Pulled from the refunded charge's billing_details — a real name without needing a separate
  // customer expansion (and possibly not finding one, for a guest/one-off payment).
  customerName: string | null;
  createdAt: string;
}

export interface RefundLookupResult {
  startDate: string;
  endDate: string;
  count: number;
  totalCents: number;
  refunds: RefundLookupItem[];
}

export async function lookupRefunds(stripe: Stripe, args: RefundLookupArgs): Promise<RefundLookupResult> {
  const parsed = RefundLookupArgsSchema.parse(args);
  const startSec = isoDateToUnixSeconds(parsed.startDate);
  const endSec = isoDateToUnixSeconds(parsed.endDate);

  const refunds: RefundLookupItem[] = [];
  for await (const refund of stripe.refunds.list({
    created: { gte: startSec, lt: endSec },
    limit: 100,
    expand: ["data.charge"],
  })) {
    const charge = typeof refund.charge === "object" && refund.charge !== null ? refund.charge : null;
    refunds.push({
      id: refund.id,
      amountCents: refund.amount,
      customerName: charge?.billing_details.name ?? null,
      createdAt: new Date(refund.created * 1000).toISOString(),
    });
  }

  const totalCents = refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
  return { startDate: parsed.startDate, endDate: parsed.endDate, count: refunds.length, totalCents, refunds };
}

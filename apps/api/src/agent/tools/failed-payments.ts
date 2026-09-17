import { z } from "zod";
import type Stripe from "stripe";
import { getFailedPaymentsSummary, type FailedPaymentsSummary } from "../dashboard.js";

export const GetFailedPaymentsArgsSchema = z.object({}).strict();
export type GetFailedPaymentsArgs = z.infer<typeof GetFailedPaymentsArgsSchema>;

// Thin wrapper reusing getFailedPaymentsSummary directly — same pattern as get_disputes reusing
// getDisputesSummary (tool-registry.ts), no aggregation logic duplicated at the tool layer.
export async function getFailedPayments(stripe: Stripe): Promise<FailedPaymentsSummary> {
  return getFailedPaymentsSummary(stripe);
}

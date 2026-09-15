import { z } from "zod";
import type Stripe from "stripe";
import { displayName, findCustomersByReference } from "../customer-resolution.js";
import { lookupInvoices, InvoiceLookupArgsSchema, type InvoiceLookupResultItem } from "./invoice-lookup.js";

// Owner-only, read-only tool — executes immediately, no pending action. Mirrors refund.ts's
// customer-resolution pattern (the owner refers to customers by name/email, not a bound id) and
// then delegates to the same lookupInvoices already used by the Telegram bot, once resolved down
// to exactly one customer.
export const OwnerInvoiceLookupArgsSchema = z
  .object({
    customerReference: z.string().min(1).describe("The customer's name or email, as mentioned by the owner."),
    status: InvoiceLookupArgsSchema.shape.status,
  })
  .strict();
export type OwnerInvoiceLookupArgs = z.infer<typeof OwnerInvoiceLookupArgsSchema>;

export interface CustomerCandidate {
  customerId: string;
  customerName: string;
}

export type LookupCustomerInvoicesResult =
  | { kind: "found"; customerName: string; invoices: InvoiceLookupResultItem[] }
  | { kind: "ambiguous_customer"; candidates: CustomerCandidate[] }
  | { kind: "not_found"; reason: string };

export async function lookupCustomerInvoices(
  stripe: Stripe,
  args: OwnerInvoiceLookupArgs,
): Promise<LookupCustomerInvoicesResult> {
  const parsed = OwnerInvoiceLookupArgsSchema.parse(args);

  const customers = await findCustomersByReference(stripe, parsed.customerReference);
  if (customers.length === 0) {
    return { kind: "not_found", reason: `No customer matching "${parsed.customerReference}"` };
  }
  if (customers.length > 1) {
    return {
      kind: "ambiguous_customer",
      candidates: customers.map((c) => ({ customerId: c.id, customerName: displayName(c) })),
    };
  }

  const customer = customers[0];
  const { invoices } = await lookupInvoices(stripe, customer.id, { status: parsed.status });

  return { kind: "found", customerName: displayName(customer), invoices };
}

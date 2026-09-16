import { z } from "zod";
import type Stripe from "stripe";
import { displayName, listAllCustomers } from "../customer-resolution.js";
import { lookupInvoices, InvoiceLookupArgsSchema, type InvoiceLookupResultItem } from "./invoice-lookup.js";

// Owner-only, read-only, cross-customer — executes immediately, no pending action. Unlike
// get_customer_invoices (which requires resolving to exactly one customer), this answers "what's
// outstanding right now" account-wide, so the model has a real tool for that instead of trying to
// force a generic word like "all" through customer-reference resolution (see B4 in feature.md).
export const OutstandingInvoicesArgsSchema = z
  .object({
    status: InvoiceLookupArgsSchema.shape.status,
  })
  .strict();
export type OutstandingInvoicesArgs = z.infer<typeof OutstandingInvoicesArgsSchema>;

export interface OutstandingInvoiceItem extends InvoiceLookupResultItem {
  customerName: string;
}

export interface OutstandingInvoicesResult {
  status: string;
  count: number;
  totalCents: number;
  invoices: OutstandingInvoiceItem[];
}

// N+1 Stripe call pattern (one customer scan + one invoices.list per customer) — same
// acceptable-at-this-scale reasoning as agent/dashboard.ts's getOverdueInvoicesSummary and
// ADR-004's "no database" call; revisit if this ever needs to handle many customers.
export async function getOutstandingInvoices(
  stripe: Stripe,
  args: OutstandingInvoicesArgs,
): Promise<OutstandingInvoicesResult> {
  const parsed = OutstandingInvoicesArgsSchema.parse(args);
  // "Outstanding" means unpaid — default to "open" (which already includes overdue ones, since
  // an overdue invoice is just an open one past its due date) rather than "all", which would also
  // pull in paid history nobody asked about.
  const status = parsed.status ?? "open";

  const customers: Stripe.Customer[] = [];
  for await (const customer of listAllCustomers(stripe)) {
    customers.push(customer);
  }

  const perCustomer = await Promise.all(
    customers.map(async (customer) => {
      const { invoices } = await lookupInvoices(stripe, customer.id, { status });
      return invoices.map((invoice) => ({ ...invoice, customerName: displayName(customer) }));
    }),
  );

  const invoices = perCustomer.flat();
  const totalCents = invoices.reduce((sum, invoice) => sum + invoice.amountDueCents, 0);

  return { status, count: invoices.length, totalCents, invoices };
}

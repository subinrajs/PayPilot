import { z } from "zod";
import type Stripe from "stripe";
import { displayName, listAllCustomers } from "../customer-resolution.js";

// Owner-only, read-only, account-wide — executes immediately, no pending action. Same B4-shaped
// gap (docs/feature.md) as get_outstanding_invoices/get_refunds: without this, a plain "list all
// my customers" has no tool to answer it, since every other customer-facing tool requires
// resolving a free-text reference down to exactly one customer first.
export const ListCustomersArgsSchema = z.object({}).strict();
export type ListCustomersArgs = z.infer<typeof ListCustomersArgsSchema>;

export interface CustomerListItem {
  id: string;
  name: string;
  email: string | null;
}

export interface CustomerListResult {
  count: number;
  customers: CustomerListItem[];
}

export async function listCustomers(stripe: Stripe): Promise<CustomerListResult> {
  const customers: CustomerListItem[] = [];
  for await (const customer of listAllCustomers(stripe)) {
    customers.push({ id: customer.id, name: displayName(customer), email: customer.email });
  }
  return { count: customers.length, customers };
}

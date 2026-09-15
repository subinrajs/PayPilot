import type Stripe from "stripe";

// Shared by refund.ts and invoice-creation.ts — both are owner-only tools that resolve a
// free-text customer reference the same way.
export function displayName(customer: Stripe.Customer): string {
  return customer.name ?? customer.email ?? customer.id;
}

export async function findCustomersByReference(stripe: Stripe, reference: string): Promise<Stripe.Customer[]> {
  // Client-side substring match over the full customer list, not Stripe's Search API — Search
  // is eventually consistent, and we already hit real indexing-lag surprises with test-clock
  // customers in the seed script; a small test account doesn't need it.
  const needle = reference.trim().toLowerCase();
  const matches: Stripe.Customer[] = [];
  for await (const customer of stripe.customers.list({ limit: 100 })) {
    const name = customer.name?.toLowerCase() ?? "";
    const email = customer.email?.toLowerCase() ?? "";
    if (name.includes(needle) || email.includes(needle)) {
      matches.push(customer);
    }
  }
  return matches;
}

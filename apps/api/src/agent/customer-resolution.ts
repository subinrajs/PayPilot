import type Stripe from "stripe";

// Shared by refund.ts and invoice-creation.ts — both are owner-only tools that resolve a
// free-text customer reference the same way.
export function displayName(customer: Stripe.Customer): string {
  return customer.name ?? customer.email ?? customer.id;
}

export async function findCustomersByReference(stripe: Stripe, reference: string): Promise<Stripe.Customer[]> {
  const needle = reference.trim().toLowerCase();
  const matches: Stripe.Customer[] = [];

  for await (const customer of listAllCustomers(stripe)) {
    const name = customer.name?.toLowerCase() ?? "";
    const email = customer.email?.toLowerCase() ?? "";
    if (name.includes(needle) || email.includes(needle)) {
      matches.push(customer);
    }
  }

  return matches;
}

// Customers attached to a test clock are NOT returned by a plain `customers.list()` — Stripe only
// returns them when the list call is filtered by that specific test_clock id (the same behavior
// hit and fixed in seed.ts's idempotency check). Every seed customer is clock-attached, so
// skipping this means refund/invoice-creation can never resolve any of them.
async function* listAllCustomers(stripe: Stripe): AsyncGenerator<Stripe.Customer> {
  // Client-side substring match over the full customer list, not Stripe's Search API — Search
  // is eventually consistent, and we already hit real indexing-lag surprises with test-clock
  // customers in the seed script; a small test account doesn't need it.
  for await (const customer of stripe.customers.list({ limit: 100 })) {
    yield customer;
  }

  for await (const clock of stripe.testHelpers.testClocks.list({ limit: 100 })) {
    for await (const customer of stripe.customers.list({
      limit: 100,
      test_clock: clock.id,
    } as Stripe.CustomerListParams & { test_clock: string })) {
      yield customer;
    }
  }
}

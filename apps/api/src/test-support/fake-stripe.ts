import { vi } from "vitest";
import type Stripe from "stripe";

// A minimal fake shaped like the subset of the Stripe SDK our tools actually call — cast to
// `Stripe` so tool signatures don't need a separate test-only type. Extend the returned object's
// methods per-test with `.mockResolvedValueOnce(...)` etc. rather than adding new fields here
// unless a tool needs a genuinely new Stripe method.
export function createFakeStripe() {
  const fake = {
    customers: {
      list: vi.fn(),
      retrieve: vi.fn(),
    },
    charges: {
      list: vi.fn(),
      retrieve: vi.fn(),
    },
    refunds: {
      create: vi.fn(),
    },
    invoices: {
      list: vi.fn(),
      create: vi.fn(),
      retrieve: vi.fn(),
      finalizeInvoice: vi.fn(),
      pay: vi.fn(),
    },
    invoiceItems: {
      create: vi.fn(),
    },
  };
  return fake;
}

export type FakeStripe = ReturnType<typeof createFakeStripe>;
export function asStripe(fake: FakeStripe): Stripe {
  return fake as unknown as Stripe;
}

// `for await` over a list call (used for full-account customer scans) needs an async iterator,
// not just a `.data` array — this makes a fake list response behave like the real SDK's.
export function asyncIterableList<T>(items: T[]): Stripe.ApiListPromise<T> {
  const response = {
    object: "list" as const,
    data: items,
    has_more: false,
    url: "/v1/fake",
    [Symbol.asyncIterator]: async function* () {
      for (const item of items) yield item;
    },
  };
  return response as unknown as Stripe.ApiListPromise<T>;
}

export function fakeCustomer(overrides: Partial<Stripe.Customer> = {}): Stripe.Customer {
  return {
    id: "cus_fake",
    object: "customer",
    name: "Fake Customer",
    email: "fake@example.com",
    ...overrides,
  } as Stripe.Customer;
}

export function fakeCharge(overrides: Partial<Stripe.Charge> = {}): Stripe.Charge {
  return {
    id: "ch_fake",
    object: "charge",
    amount: 1000,
    currency: "usd",
    customer: "cus_fake",
    status: "succeeded",
    refunded: false,
    amount_refunded: 0,
    description: null,
    created: Math.floor(Date.now() / 1000),
    ...overrides,
  } as Stripe.Charge;
}

export function fakeInvoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    id: "in_fake",
    object: "invoice",
    customer: "cus_fake",
    amount_due: 1000,
    status: "open",
    due_date: null,
    paid: false,
    description: null,
    ...overrides,
  } as Stripe.Invoice;
}

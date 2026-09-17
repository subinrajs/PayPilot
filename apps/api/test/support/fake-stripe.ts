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
      // Defaults to a generic customer so tests that only care about the disputed charge/invoice
      // (most of them) don't each need to mock this — override with mockResolvedValueOnce where a
      // test specifically needs particular customer fields or a deleted customer.
      retrieve: vi.fn().mockResolvedValue(fakeCustomer()),
    },
    charges: {
      // Defaults to "no charges" so tests that don't care (most of them) don't each need to mock
      // this — override with mockResolvedValueOnce (direct-await callers) or mockReturnValueOnce
      // (for-await callers) where a test specifically needs charge data. asyncIterableList's
      // return value satisfies both calling conventions at once.
      list: vi.fn().mockReturnValue(asyncIterableList([])),
      retrieve: vi.fn(),
    },
    refunds: {
      create: vi.fn(),
      // Defaults to "no refunds" so tests that don't care (most of them) don't each need to mock
      // this — override with mockReturnValueOnce/mockResolvedValueOnce where a test specifically
      // needs refund data.
      list: vi.fn().mockReturnValue(asyncIterableList([])),
    },
    invoices: {
      // Defaults to "no invoices" so tests that don't care (most of them) don't each need to mock
      // this — override with mockResolvedValueOnce where a test specifically needs invoice history.
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
      finalizeInvoice: vi.fn(),
      sendInvoice: vi.fn(),
      pay: vi.fn(),
      del: vi.fn(),
    },
    invoiceItems: {
      create: vi.fn(),
      // Defaults to "no pending items" so tests that don't care (most of them) don't each need to
      // mock this — override with mockReturnValueOnce where a test specifically needs a draft's
      // existing line items (e.g. updateInvoiceDraft leaving items unchanged).
      list: vi.fn().mockReturnValue(asyncIterableList([])),
      del: vi.fn(),
    },
    disputes: {
      list: vi.fn().mockReturnValue(asyncIterableList([])),
      retrieve: vi.fn(),
      update: vi.fn(),
      close: vi.fn(),
    },
    testHelpers: {
      testClocks: {
        // Defaults to "no test clocks" so tests that don't care about clock-attached customers
        // (most of them) don't each need to mock this — override with mockReturnValueOnce where
        // a test specifically needs customers found via a clock.
        list: vi.fn().mockReturnValue(asyncIterableList([])),
      },
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
    billing_details: { name: null, email: null, phone: null, address: null },
    ...overrides,
  } as Stripe.Charge;
}

// Matches the real API's default shape (every evidence field null until staged) — see
// https://docs.stripe.com/api/disputes/update's example response.
export function fakeDisputeEvidence(overrides: Partial<Stripe.Dispute.Evidence> = {}): Stripe.Dispute.Evidence {
  return {
    access_activity_log: null,
    billing_address: null,
    cancellation_policy: null,
    cancellation_policy_disclosure: null,
    cancellation_rebuttal: null,
    customer_communication: null,
    customer_email_address: null,
    customer_name: null,
    customer_purchase_ip: null,
    customer_signature: null,
    duplicate_charge_documentation: null,
    duplicate_charge_explanation: null,
    duplicate_charge_id: null,
    enhanced_evidence: {} as Stripe.Dispute.Evidence["enhanced_evidence"],
    product_description: null,
    receipt: null,
    refund_policy: null,
    refund_policy_disclosure: null,
    refund_refusal_explanation: null,
    service_date: null,
    service_documentation: null,
    shipping_address: null,
    shipping_carrier: null,
    shipping_date: null,
    shipping_documentation: null,
    shipping_tracking_number: null,
    uncategorized_file: null,
    uncategorized_text: null,
    ...overrides,
  } as Stripe.Dispute.Evidence;
}

export function fakeDispute(overrides: Partial<Stripe.Dispute> = {}): Stripe.Dispute {
  return {
    id: "dp_fake",
    object: "dispute",
    amount: 1000,
    currency: "usd",
    charge: "ch_fake",
    reason: "general",
    status: "needs_response",
    evidence: fakeDisputeEvidence(),
    evidence_details: { due_by: null, has_evidence: false, past_due: false, submission_count: 0 },
    ...overrides,
  } as Stripe.Dispute;
}

export function fakeInvoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    id: "in_fake",
    object: "invoice",
    customer: "cus_fake",
    amount_due: 1000,
    subtotal: 1000,
    status: "open",
    due_date: null,
    paid: false,
    description: null,
    hosted_invoice_url: "https://invoice.stripe.com/i/fake",
    created: Math.floor(Date.now() / 1000),
    ...overrides,
  } as Stripe.Invoice;
}

export function fakeInvoiceItem(overrides: Partial<Stripe.InvoiceItem> = {}): Stripe.InvoiceItem {
  return {
    id: "ii_fake",
    object: "invoiceitem",
    customer: "cus_fake",
    amount: 1000,
    quantity: 1,
    unit_amount: 1000,
    description: "Item",
    ...overrides,
  } as Stripe.InvoiceItem;
}

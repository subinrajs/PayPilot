import { describe, expect, it } from "vitest";
import {
  getDisputesSummary,
  getFailedPaymentsSummary,
  getOverdueInvoicesSummary,
  getPaymentActivity,
  getRecentActivity,
  getTodaysSummary,
} from "../../src/agent/dashboard.js";
import { lastNDays } from "../../src/agent/charge-fetching.js";
import {
  asStripe,
  asyncIterableList,
  createFakeStripe,
  fakeCharge,
  fakeCustomer,
  fakeDispute,
  fakeInvoice,
} from "../support/fake-stripe.js";

describe("getTodaysSummary", () => {
  it("composes today's daily summary with a today-vs-yesterday revenue comparison", async () => {
    const [today] = lastNDays(1);
    const fake = createFakeStripe();
    // Shared across all three underlying charges.list calls (daily-summary's own fetch, plus
    // revenue-comparison's current/previous fetches) — this test verifies composition (both
    // pieces get called and combined correctly), not the underlying math, which is already
    // covered by daily-summary.test.ts / revenue-comparison.test.ts in isolation.
    fake.charges.list.mockReturnValue(asyncIterableList([fakeCharge({ amount: 1000, status: "succeeded" })]));

    const result = await getTodaysSummary(asStripe(fake));

    expect(fake.charges.list).toHaveBeenCalledTimes(3);
    expect(result.summary.date).toBe(today);
    expect(result.comparison.current.label).toBe("Today");
    expect(result.comparison.previous.label).toBe("Yesterday");
  });
});

describe("getPaymentActivity", () => {
  it("returns one bucket per requested day, oldest first, with charges netted into the right day", async () => {
    const days = lastNDays(7);
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(
      asyncIterableList([
        fakeCharge({ id: "ch_1", amount: 5000, status: "succeeded", created: isoToUnix(days[0]) }),
        fakeCharge({ id: "ch_2", amount: 3000, status: "succeeded", created: isoToUnix(days[6]) }),
      ]),
    );

    const result = await getPaymentActivity(asStripe(fake), 7);

    expect(result.days).toBe(7);
    expect(result.buckets).toHaveLength(7);
    expect(result.buckets.map((b) => b.date)).toEqual(days);
    expect(result.buckets[0].totalCents).toBe(5000);
    expect(result.buckets[6].totalCents).toBe(3000);
    expect(result.buckets.slice(1, 6).every((b) => b.totalCents === 0)).toBe(true);
  });
});

describe("getOverdueInvoicesSummary", () => {
  it("aggregates overdue invoices across every customer, tagging each with its customer's name", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([fakeCustomer({ id: "cus_a", name: "Acme Corp" }), fakeCustomer({ id: "cus_b", name: "Maya Rodriguez" })]),
    );
    fake.invoices.list
      .mockResolvedValueOnce({
        data: [fakeInvoice({ id: "in_1", customer: "cus_a", amount_due: 25000, status: "open", due_date: pastDueDate() })],
      })
      .mockResolvedValueOnce({ data: [] });

    const result = await getOverdueInvoicesSummary(asStripe(fake));

    expect(result.count).toBe(1);
    expect(result.totalCents).toBe(25000);
    expect(result.invoices).toEqual([
      { id: "in_1", customerName: "Acme Corp", amountDueCents: 25000, dueDate: expect.any(String) },
    ]);
  });

  it("reports zero rather than fabricating when nothing is overdue", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([fakeCustomer({ id: "cus_a" })]));
    fake.invoices.list.mockResolvedValueOnce({ data: [] });

    const result = await getOverdueInvoicesSummary(asStripe(fake));

    expect(result).toEqual({ count: 0, totalCents: 0, invoices: [] });
  });

  it("scans customers attached to a test clock too, not just the plain customer list", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([])); // plain list: none
    fake.testHelpers.testClocks.list.mockReturnValueOnce(asyncIterableList([{ id: "clock_1" }] as never));
    fake.customers.list.mockReturnValueOnce(asyncIterableList([fakeCustomer({ id: "cus_clocked", name: "Clocked Co" })]));
    fake.invoices.list.mockResolvedValueOnce({
      data: [fakeInvoice({ id: "in_2", customer: "cus_clocked", amount_due: 5000, status: "open", due_date: pastDueDate() })],
    });

    const result = await getOverdueInvoicesSummary(asStripe(fake));

    expect(result.count).toBe(1);
    expect(result.invoices[0].customerName).toBe("Clocked Co");
  });
});

describe("getFailedPaymentsSummary", () => {
  it("lists failed charges account-wide, using billing_details name/email", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(
      asyncIterableList([
        fakeCharge({
          id: "ch_1",
          status: "failed",
          amount: 5000,
          billing_details: { name: "John Smith", email: "john@example.com", phone: null, address: null },
        }),
      ]),
    );

    const result = await getFailedPaymentsSummary(asStripe(fake));

    expect(result.count).toBe(1);
    expect(result.totalCents).toBe(5000);
    expect(result.payments).toEqual([
      expect.objectContaining({ id: "ch_1", customerName: "John Smith", customerEmail: "john@example.com", amountCents: 5000 }),
    ]);
  });

  it("excludes a failed charge whose invoice has since been paid another way", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(
      asyncIterableList([
        fakeCharge({ id: "ch_1", status: "failed", invoice: fakeInvoice({ id: "in_1", status: "paid" }) }),
      ]),
    );

    const result = await getFailedPaymentsSummary(asStripe(fake));

    expect(result).toEqual({ count: 0, totalCents: 0, payments: [] });
  });

  it("includes a failed charge whose invoice is still unpaid", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(
      asyncIterableList([
        fakeCharge({ id: "ch_1", status: "failed", invoice: fakeInvoice({ id: "in_1", status: "open" }) }),
      ]),
    );

    const result = await getFailedPaymentsSummary(asStripe(fake));

    expect(result.count).toBe(1);
  });

  it("includes a failed charge with no invoice at all — nothing to check, so it stays included", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(asyncIterableList([fakeCharge({ id: "ch_1", status: "failed", invoice: null })]));

    const result = await getFailedPaymentsSummary(asStripe(fake));

    expect(result.count).toBe(1);
    expect(result.payments[0].invoiceUrl).toBeNull();
  });

  it("carries the associated invoice's hosted_invoice_url through as invoiceUrl, for a real structured link", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(
      asyncIterableList([
        fakeCharge({
          id: "ch_1",
          status: "failed",
          invoice: fakeInvoice({ id: "in_1", status: "open", hosted_invoice_url: "https://invoice.stripe.com/i/x" }),
        }),
      ]),
    );

    const result = await getFailedPaymentsSummary(asStripe(fake));

    expect(result.payments[0].invoiceUrl).toBe("https://invoice.stripe.com/i/x");
  });

  it("excludes succeeded charges — only status:failed counts", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(asyncIterableList([fakeCharge({ id: "ch_1", status: "succeeded" })]));

    const result = await getFailedPaymentsSummary(asStripe(fake));

    expect(result).toEqual({ count: 0, totalCents: 0, payments: [] });
  });

  it("reports zero rather than fabricating when nothing has failed", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(asyncIterableList([]));

    const result = await getFailedPaymentsSummary(asStripe(fake));

    expect(result).toEqual({ count: 0, totalCents: 0, payments: [] });
  });
});

describe("getDisputesSummary", () => {
  it("includes a dispute that needs a response, with its customer name pulled from the disputed charge", async () => {
    const fake = createFakeStripe();
    fake.disputes.list.mockReturnValueOnce(
      asyncIterableList([
        fakeDispute({
          id: "dp_1",
          amount: 8000,
          reason: "fraudulent",
          status: "needs_response",
          charge: fakeCharge({ id: "ch_1", billing_details: { name: "Maya Rodriguez", email: null, phone: null, address: null } }),
          evidence_details: { due_by: isoToUnix("2026-09-20"), has_evidence: false, past_due: false, submission_count: 0 } as never,
        }),
      ]),
    );

    const result = await getDisputesSummary(asStripe(fake));

    expect(result.count).toBe(1);
    expect(result.totalCents).toBe(8000);
    expect(result.disputes).toEqual([
      {
        id: "dp_1",
        amountCents: 8000,
        reason: "fraudulent",
        customerName: "Maya Rodriguez",
        dueBy: expect.any(String),
      },
    ]);
  });

  it("excludes disputes that don't need a response (already under review, won, or lost)", async () => {
    const fake = createFakeStripe();
    fake.disputes.list.mockReturnValueOnce(
      asyncIterableList([
        fakeDispute({ id: "dp_review", status: "under_review" }),
        fakeDispute({ id: "dp_won", status: "won" }),
        fakeDispute({ id: "dp_lost", status: "lost" }),
      ]),
    );

    const result = await getDisputesSummary(asStripe(fake));

    expect(result).toEqual({ count: 0, totalCents: 0, disputes: [] });
  });

  it("reports zero rather than fabricating when there are no disputes at all", async () => {
    const fake = createFakeStripe();
    fake.disputes.list.mockReturnValueOnce(asyncIterableList([]));

    const result = await getDisputesSummary(asStripe(fake));

    expect(result).toEqual({ count: 0, totalCents: 0, disputes: [] });
  });

  it("falls back to the linked customer's name when the charge has no billing_details.name", async () => {
    // Regression test: some test/dispute-triggering payment methods (confirmed against the real
    // Stripe API — see S11's seed.ts) never populate billing_details at all, which previously
    // left every such dispute showing "Unknown customer" in the Needs Attention panel even though
    // the customer link was right there on the charge.
    const fake = createFakeStripe();
    fake.disputes.list.mockReturnValueOnce(
      asyncIterableList([
        fakeDispute({
          id: "dp_1",
          status: "needs_response",
          charge: fakeCharge({ id: "ch_1", customer: fakeCustomer({ id: "cus_1", name: "Maya Rodriguez" }) as never }),
        }),
      ]),
    );

    const result = await getDisputesSummary(asStripe(fake));

    expect(result.disputes[0].customerName).toBe("Maya Rodriguez");
  });

  it("falls back to a null customer name when neither billing_details nor an expanded customer has one", async () => {
    const fake = createFakeStripe();
    fake.disputes.list.mockReturnValueOnce(
      asyncIterableList([fakeDispute({ id: "dp_1", status: "needs_response", charge: fakeCharge({ id: "ch_1" }) })]),
    );

    const result = await getDisputesSummary(asStripe(fake));

    expect(result.disputes[0].customerName).toBeNull();
  });

  it("expands the charge's customer, not just the charge", async () => {
    const fake = createFakeStripe();
    fake.disputes.list.mockReturnValueOnce(asyncIterableList([]));

    await getDisputesSummary(asStripe(fake));

    expect(fake.disputes.list).toHaveBeenCalledWith(expect.objectContaining({ expand: ["data.charge", "data.charge.customer"] }));
  });
});

describe("getRecentActivity", () => {
  it("merges charges, refunds, and invoices into one feed, newest first", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockResolvedValueOnce({
      data: [
        fakeCharge({
          id: "ch_1",
          status: "succeeded",
          amount: 1240,
          billing_details: { name: "Acme Corp", email: null, phone: null, address: null },
          created: isoToUnix("2026-09-16"),
        }),
        fakeCharge({
          id: "ch_2",
          status: "failed",
          amount: 820,
          billing_details: { name: "Beta Industries", email: null, phone: null, address: null },
          created: isoToUnix("2026-09-13"),
        }),
      ],
    });
    fake.refunds.list.mockResolvedValueOnce({
      data: [
        {
          id: "re_1",
          amount: 180,
          created: isoToUnix("2026-09-15"),
          charge: fakeCharge({ id: "ch_3", billing_details: { name: "Maya Rodriguez", email: null, phone: null, address: null } }),
        },
      ],
    });
    fake.invoices.list.mockResolvedValueOnce({
      data: [fakeInvoice({ id: "in_1", customer_name: "Global Logistics", amount_due: 3200, created: isoToUnix("2026-09-14") } as never)],
    });

    const result = await getRecentActivity(asStripe(fake));

    expect(result.events.map((e) => e.id)).toEqual(["ch_1", "re_1", "in_1", "ch_2"]);
    expect(result.events[0]).toEqual({
      type: "payment_succeeded",
      id: "ch_1",
      customerName: "Acme Corp",
      amountCents: 1240,
      createdAt: expect.any(String),
    });
    expect(result.events[3].type).toBe("payment_failed");
  });

  it("pulls the refund's customer name from its expanded charge", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockResolvedValueOnce({ data: [] });
    fake.refunds.list.mockResolvedValueOnce({
      data: [
        {
          id: "re_1",
          amount: 500,
          created: isoToUnix("2026-09-16"),
          charge: fakeCharge({ billing_details: { name: "Sarah Johnson", email: null, phone: null, address: null } }),
        },
      ],
    });
    fake.invoices.list.mockResolvedValueOnce({ data: [] });

    const result = await getRecentActivity(asStripe(fake));

    expect(result.events).toEqual([
      { type: "refund", id: "re_1", customerName: "Sarah Johnson", amountCents: 500, createdAt: expect.any(String) },
    ]);
  });

  it("excludes pending charges — only succeeded and failed are activity events", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockResolvedValueOnce({ data: [fakeCharge({ id: "ch_pending", status: "pending" })] });
    fake.refunds.list.mockResolvedValueOnce({ data: [] });
    fake.invoices.list.mockResolvedValueOnce({ data: [] });

    const result = await getRecentActivity(asStripe(fake));

    expect(result.events).toEqual([]);
  });

  it("reports an empty feed rather than fabricating activity when there is none", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockResolvedValueOnce({ data: [] });
    fake.refunds.list.mockResolvedValueOnce({ data: [] });
    fake.invoices.list.mockResolvedValueOnce({ data: [] });

    const result = await getRecentActivity(asStripe(fake));

    expect(result).toEqual({ events: [] });
  });
});

function isoToUnix(isoDate: string): number {
  return Math.floor(new Date(`${isoDate}T10:00:00.000Z`).getTime() / 1000);
}

function pastDueDate(): number {
  return Math.floor((Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000);
}

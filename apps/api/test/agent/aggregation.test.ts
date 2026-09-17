import { describe, expect, it } from "vitest";
import {
  type ChargeLike,
  bucketDailyTotals,
  compareRevenue,
  rankCustomersByRevenue,
  summarizeCharges,
} from "../../src/agent/aggregation.js";

function charge(overrides: Partial<ChargeLike>): ChargeLike {
  return {
    id: "ch_1",
    amountCents: 1000,
    amountRefundedCents: 0,
    status: "succeeded",
    customerId: "cus_test",
    customerName: "Test Customer",
    customerEmail: "test@example.com",
    description: null,
    date: "2026-09-14",
    ...overrides,
  };
}

describe("summarizeCharges", () => {
  it("sums only succeeded charges and counts failed separately", () => {
    const summary = summarizeCharges("2026-09-14", [
      charge({ id: "ch_1", amountCents: 1000, status: "succeeded" }),
      charge({ id: "ch_2", amountCents: 2000, status: "succeeded" }),
      charge({ id: "ch_3", amountCents: 500, status: "failed" }),
    ]);

    expect(summary).toEqual({
      date: "2026-09-14",
      succeededCount: 2,
      succeededTotalCents: 3000,
      refundedTotalCents: 0,
      netTotalCents: 3000,
      failedCount: 1,
      charges: expect.any(Array),
    });
  });

  it("reports zero activity for an empty day rather than fabricating numbers", () => {
    const summary = summarizeCharges("2026-09-01", []);
    expect(summary.succeededCount).toBe(0);
    expect(summary.succeededTotalCents).toBe(0);
    expect(summary.netTotalCents).toBe(0);
    expect(summary.failedCount).toBe(0);
  });

  it("nets refunded amounts out of revenue instead of counting a refunded charge as money kept", () => {
    // A regression case: Stripe doesn't change a charge's status when it's refunded, so a naive
    // status==="succeeded" sum silently double-counts refunded charges as revenue.
    const summary = summarizeCharges("2026-09-14", [
      charge({ id: "ch_1", amountCents: 8000, amountRefundedCents: 0 }),
      charge({ id: "ch_2", amountCents: 5000, amountRefundedCents: 5000 }), // fully refunded
      charge({ id: "ch_3", amountCents: 6000, amountRefundedCents: 2000 }), // partially refunded
    ]);

    expect(summary.succeededTotalCents).toBe(19000); // gross
    expect(summary.refundedTotalCents).toBe(7000);
    expect(summary.netTotalCents).toBe(12000);
  });
});

describe("compareRevenue", () => {
  it("computes totals, difference, and percent change across two periods", () => {
    const result = compareRevenue(
      {
        label: "this week",
        startDate: "2026-09-08",
        endDate: "2026-09-14",
        charges: [charge({ amountCents: 15000 }), charge({ amountCents: 5000, status: "failed" })],
      },
      {
        label: "last week",
        startDate: "2026-09-01",
        endDate: "2026-09-07",
        charges: [charge({ amountCents: 10000 })],
      },
    );

    expect(result.current.totalCents).toBe(15000);
    expect(result.previous.totalCents).toBe(10000);
    expect(result.differenceCents).toBe(5000);
    expect(result.percentChange).toBe(50);
  });

  it("nets refunded amounts out of each period's totalCents", () => {
    const result = compareRevenue(
      {
        label: "this week",
        startDate: "2026-09-08",
        endDate: "2026-09-14",
        charges: [charge({ amountCents: 15000, amountRefundedCents: 15000 })], // fully refunded
      },
      {
        label: "last week",
        startDate: "2026-09-01",
        endDate: "2026-09-07",
        charges: [charge({ amountCents: 10000 })],
      },
    );

    expect(result.current.grossCents).toBe(15000);
    expect(result.current.totalCents).toBe(0);
    expect(result.differenceCents).toBe(-10000);
  });

  it("returns null percentChange instead of NaN/Infinity when the previous period had no revenue", () => {
    const result = compareRevenue(
      { label: "this week", startDate: "a", endDate: "b", charges: [charge({ amountCents: 1000 })] },
      { label: "last week", startDate: "c", endDate: "d", charges: [] },
    );
    expect(result.percentChange).toBeNull();
  });
});

describe("bucketDailyTotals", () => {
  it("nets refunds into each day's total, keyed by the charge's own date", () => {
    const result = bucketDailyTotals(
      [
        charge({ date: "2026-09-14", amountCents: 1000 }),
        charge({ date: "2026-09-14", amountCents: 2000, amountRefundedCents: 500 }),
        charge({ date: "2026-09-15", amountCents: 4000 }),
      ],
      ["2026-09-14", "2026-09-15"],
    );

    expect(result).toEqual([
      { date: "2026-09-14", totalCents: 2500 },
      { date: "2026-09-15", totalCents: 4000 },
    ]);
  });

  it("reports zero rather than omitting a day with no activity", () => {
    const result = bucketDailyTotals([charge({ date: "2026-09-14" })], ["2026-09-13", "2026-09-14", "2026-09-15"]);

    expect(result).toEqual([
      { date: "2026-09-13", totalCents: 0 },
      { date: "2026-09-14", totalCents: 1000 },
      { date: "2026-09-15", totalCents: 0 },
    ]);
  });

  it("excludes failed charges from the daily total", () => {
    const result = bucketDailyTotals([charge({ date: "2026-09-14", status: "failed", amountCents: 9000 })], [
      "2026-09-14",
    ]);

    expect(result).toEqual([{ date: "2026-09-14", totalCents: 0 }]);
  });

  it("ignores a charge whose date falls outside the requested day list", () => {
    const result = bucketDailyTotals([charge({ date: "2026-01-01", amountCents: 9000 })], ["2026-09-14"]);

    expect(result).toEqual([{ date: "2026-09-14", totalCents: 0 }]);
  });
});

describe("rankCustomersByRevenue", () => {
  it("sums net revenue per customer and sorts highest first", () => {
    const result = rankCustomersByRevenue([
      charge({ customerId: "cus_a", customerName: "Acme Corp", amountCents: 5000 }),
      charge({ customerId: "cus_b", customerName: "Maya Rodriguez", amountCents: 20000 }),
      charge({ customerId: "cus_a", customerName: "Acme Corp", amountCents: 3000 }),
    ]);

    expect(result).toEqual([
      { customerId: "cus_b", customerName: "Maya Rodriguez", totalCents: 20000, chargeCount: 1 },
      { customerId: "cus_a", customerName: "Acme Corp", totalCents: 8000, chargeCount: 2 },
    ]);
  });

  it("groups by customer id, not name — two different customers must never merge just because a name matches or is missing", () => {
    const result = rankCustomersByRevenue([
      charge({ customerId: "cus_a", customerName: null, customerEmail: null, amountCents: 1000 }),
      charge({ customerId: "cus_b", customerName: null, customerEmail: null, amountCents: 2000 }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.customerId).sort()).toEqual(["cus_a", "cus_b"]);
  });

  it("falls back to email, then the customer id, when name is missing — never blank", () => {
    const result = rankCustomersByRevenue([
      charge({ customerId: "cus_a", customerName: null, customerEmail: "a@example.com" }),
      charge({ customerId: "cus_b", customerName: null, customerEmail: null }),
    ]);

    const byId = Object.fromEntries(result.map((c) => [c.customerId, c.customerName]));
    expect(byId.cus_a).toBe("a@example.com");
    expect(byId.cus_b).toBe("cus_b");
  });

  it("excludes failed charges and charges with no customer attached", () => {
    const result = rankCustomersByRevenue([
      charge({ customerId: "cus_a", amountCents: 9000, status: "failed" }),
      charge({ customerId: null, amountCents: 9000 }),
    ]);

    expect(result).toEqual([]);
  });

  it("nets refunds out of each customer's total", () => {
    const result = rankCustomersByRevenue([charge({ customerId: "cus_a", amountCents: 10000, amountRefundedCents: 4000 })]);

    expect(result[0].totalCents).toBe(6000);
  });
});

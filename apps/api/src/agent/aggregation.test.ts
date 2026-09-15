import { describe, expect, it } from "vitest";
import { type ChargeLike, compareRevenue, summarizeCharges } from "./aggregation.js";

function charge(overrides: Partial<ChargeLike>): ChargeLike {
  return {
    id: "ch_1",
    amountCents: 1000,
    amountRefundedCents: 0,
    status: "succeeded",
    customerName: "Test Customer",
    description: null,
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

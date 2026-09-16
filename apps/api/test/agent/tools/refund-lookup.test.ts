import { describe, expect, it } from "vitest";
import { lookupRefunds } from "../../../src/agent/tools/refund-lookup.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCharge } from "../../support/fake-stripe.js";

describe("lookupRefunds", () => {
  it("lists refunds within the date range, with the customer name pulled from the refunded charge", async () => {
    const fake = createFakeStripe();
    fake.refunds.list.mockReturnValueOnce(
      asyncIterableList([
        {
          id: "re_1",
          amount: 5000,
          created: isoToUnix("2026-09-15"),
          charge: fakeCharge({ id: "ch_1", billing_details: { name: "Maya Rodriguez", email: null, phone: null, address: null } }),
        },
      ] as never),
    );

    const result = await lookupRefunds(asStripe(fake), { startDate: "2026-09-14", endDate: "2026-09-21" });

    expect(result.count).toBe(1);
    expect(result.totalCents).toBe(5000);
    expect(result.refunds).toEqual([
      { id: "re_1", amountCents: 5000, customerName: "Maya Rodriguez", createdAt: expect.any(String) },
    ]);
  });

  it("sums totalCents across every refund in range", async () => {
    const fake = createFakeStripe();
    fake.refunds.list.mockReturnValueOnce(
      asyncIterableList([
        { id: "re_1", amount: 3000, created: isoToUnix("2026-09-15"), charge: fakeCharge({ id: "ch_1" }) },
        { id: "re_2", amount: 2000, created: isoToUnix("2026-09-16"), charge: fakeCharge({ id: "ch_2" }) },
      ] as never),
    );

    const result = await lookupRefunds(asStripe(fake), { startDate: "2026-09-14", endDate: "2026-09-21" });

    expect(result.count).toBe(2);
    expect(result.totalCents).toBe(5000);
  });

  it("reports zero rather than fabricating when there are no refunds in range", async () => {
    const fake = createFakeStripe();
    fake.refunds.list.mockReturnValueOnce(asyncIterableList([]));

    const result = await lookupRefunds(asStripe(fake), { startDate: "2026-09-14", endDate: "2026-09-21" });

    expect(result).toEqual({ startDate: "2026-09-14", endDate: "2026-09-21", count: 0, totalCents: 0, refunds: [] });
  });

  it("echoes the queried date range back on the result", async () => {
    const fake = createFakeStripe();
    fake.refunds.list.mockReturnValueOnce(asyncIterableList([]));

    const result = await lookupRefunds(asStripe(fake), { startDate: "2026-09-14", endDate: "2026-09-21" });

    expect(result.startDate).toBe("2026-09-14");
    expect(result.endDate).toBe("2026-09-21");
  });

  it("falls back to a null customer name when the refund's charge has no billing_details.name", async () => {
    const fake = createFakeStripe();
    fake.refunds.list.mockReturnValueOnce(
      asyncIterableList([
        { id: "re_1", amount: 1000, created: isoToUnix("2026-09-15"), charge: fakeCharge({ id: "ch_1" }) },
      ] as never),
    );

    const result = await lookupRefunds(asStripe(fake), { startDate: "2026-09-14", endDate: "2026-09-21" });

    expect(result.refunds[0].customerName).toBeNull();
  });

  it("passes the date range through as a gte/lt created filter on the Stripe call", async () => {
    const fake = createFakeStripe();
    fake.refunds.list.mockReturnValueOnce(asyncIterableList([]));

    await lookupRefunds(asStripe(fake), { startDate: "2026-09-14", endDate: "2026-09-21" });

    expect(fake.refunds.list).toHaveBeenCalledWith(
      expect.objectContaining({
        created: { gte: isoToUnix("2026-09-14"), lt: isoToUnix("2026-09-21") },
      }),
    );
  });
});

function isoToUnix(isoDate: string): number {
  return Math.floor(new Date(`${isoDate}T00:00:00.000Z`).getTime() / 1000);
}

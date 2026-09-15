import { describe, expect, it } from "vitest";
import { getRevenueComparison } from "../../../src/agent/tools/revenue-comparison.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCharge } from "../../support/fake-stripe.js";

describe("getRevenueComparison", () => {
  it("fetches both periods and returns their computed comparison", async () => {
    const fake = createFakeStripe();
    fake.charges.list
      .mockReturnValueOnce(asyncIterableList([fakeCharge({ amount: 15000, status: "succeeded" })]))
      .mockReturnValueOnce(asyncIterableList([fakeCharge({ amount: 10000, status: "succeeded" })]));

    const result = await getRevenueComparison(asStripe(fake), {
      current: { label: "this week", startDate: "2026-09-08", endDate: "2026-09-15" },
      previous: { label: "last week", startDate: "2026-09-01", endDate: "2026-09-08" },
    });

    expect(result.current.totalCents).toBe(15000);
    expect(result.previous.totalCents).toBe(10000);
    expect(result.differenceCents).toBe(5000);
    expect(fake.charges.list).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed args rather than passing them through to Stripe", async () => {
    const fake = createFakeStripe();
    await expect(
      getRevenueComparison(asStripe(fake), {
        current: { label: "this week", startDate: "bad-date", endDate: "2026-09-15" },
        previous: { label: "last week", startDate: "2026-09-01", endDate: "2026-09-08" },
      } as never),
    ).rejects.toThrow();
    expect(fake.charges.list).not.toHaveBeenCalled();
  });
});

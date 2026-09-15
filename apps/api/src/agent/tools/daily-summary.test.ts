import { describe, expect, it } from "vitest";
import { getDailySummary } from "./daily-summary.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCharge } from "../../test-support/fake-stripe.js";

describe("getDailySummary", () => {
  it("fetches charges scoped to the requested day and summarizes them", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(
      asyncIterableList([
        fakeCharge({ id: "ch_1", amount: 8000, status: "succeeded" }),
        fakeCharge({ id: "ch_2", amount: 4500, status: "failed" }),
      ]),
    );

    const summary = await getDailySummary(asStripe(fake), { date: "2026-09-14" });

    const expectedStart = Math.floor(new Date("2026-09-14T00:00:00.000Z").getTime() / 1000);
    expect(fake.charges.list).toHaveBeenCalledWith(
      expect.objectContaining({ created: { gte: expectedStart, lt: expectedStart + 86400 } }),
    );
    expect(summary).toMatchObject({
      date: "2026-09-14",
      succeededCount: 1,
      succeededTotalCents: 8000,
      failedCount: 1,
    });
  });

  it("reports no activity rather than fabricating numbers for an empty day", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(asyncIterableList([]));

    const summary = await getDailySummary(asStripe(fake), { date: "2026-01-01" });

    expect(summary.succeededCount).toBe(0);
    expect(summary.failedCount).toBe(0);
  });

  it("rejects a malformed date rather than passing it through to Stripe", async () => {
    const fake = createFakeStripe();
    await expect(getDailySummary(asStripe(fake), { date: "not-a-date" } as never)).rejects.toThrow();
    expect(fake.charges.list).not.toHaveBeenCalled();
  });
});

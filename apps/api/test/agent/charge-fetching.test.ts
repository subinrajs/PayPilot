import { describe, expect, it } from "vitest";
import { fetchCharges, fetchChargesInRange, lastNDays } from "../../src/agent/charge-fetching.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCharge, fakeCustomer } from "../support/fake-stripe.js";

describe("lastNDays", () => {
  it("returns the last N UTC calendar days including today, oldest first", () => {
    const today = new Date("2026-09-16T15:00:00.000Z");
    expect(lastNDays(3, today)).toEqual(["2026-09-14", "2026-09-15", "2026-09-16"]);
  });

  it("returns just today for a count of 1", () => {
    const today = new Date("2026-09-16T00:00:00.000Z");
    expect(lastNDays(1, today)).toEqual(["2026-09-16"]);
  });
});

describe("fetchChargesInRange", () => {
  it("populates each charge's date from its created timestamp", async () => {
    const fake = createFakeStripe();
    const created = Math.floor(new Date("2026-09-14T12:00:00.000Z").getTime() / 1000);
    fake.charges.list.mockReturnValueOnce(asyncIterableList([fakeCharge({ id: "ch_1", created })]));

    const result = await fetchChargesInRange(asStripe(fake), 0, 1);

    expect(result).toEqual([expect.objectContaining({ id: "ch_1", date: "2026-09-14" })]);
  });

  it("passes a created date filter to Stripe", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(asyncIterableList([]));

    await fetchChargesInRange(asStripe(fake), 100, 200);

    expect(fake.charges.list).toHaveBeenCalledWith(expect.objectContaining({ created: { gte: 100, lt: 200 } }));
  });

  it("populates customerId/customerName/customerEmail from the expanded customer", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(
      asyncIterableList([
        fakeCharge({ id: "ch_1", customer: fakeCustomer({ id: "cus_a", name: "Acme Corp", email: "billing@acme.example" }) }),
      ]),
    );

    const result = await fetchChargesInRange(asStripe(fake), 0, 1);

    expect(result).toEqual([
      expect.objectContaining({ customerId: "cus_a", customerName: "Acme Corp", customerEmail: "billing@acme.example" }),
    ]);
  });
});

describe("fetchCharges (unbounded, all-time)", () => {
  it("fetches without a created date filter when no range is given", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(asyncIterableList([]));

    await fetchCharges(asStripe(fake));

    const callArgs = fake.charges.list.mock.calls[0][0] as { created?: unknown };
    expect(callArgs.created).toBeUndefined();
  });

  it("applies a created date filter when a range is given", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(asyncIterableList([]));

    await fetchCharges(asStripe(fake), { startSec: 100, endSec: 200 });

    expect(fake.charges.list).toHaveBeenCalledWith(expect.objectContaining({ created: { gte: 100, lt: 200 } }));
  });
});

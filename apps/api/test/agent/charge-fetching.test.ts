import { describe, expect, it } from "vitest";
import { fetchChargesInRange, lastNDays } from "../../src/agent/charge-fetching.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCharge } from "../support/fake-stripe.js";

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
});

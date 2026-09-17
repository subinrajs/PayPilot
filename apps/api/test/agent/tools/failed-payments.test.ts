import { describe, expect, it } from "vitest";
import { getFailedPayments } from "../../../src/agent/tools/failed-payments.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCharge } from "../../support/fake-stripe.js";

describe("getFailedPayments", () => {
  it("reuses getFailedPaymentsSummary's aggregation unchanged", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(asyncIterableList([fakeCharge({ id: "ch_1", status: "failed", amount: 4000 })]));

    const result = await getFailedPayments(asStripe(fake));

    expect(result.count).toBe(1);
    expect(result.totalCents).toBe(4000);
  });
});

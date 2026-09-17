import { describe, expect, it } from "vitest";
import { getTopCustomers } from "../../../src/agent/tools/top-customers.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCharge, fakeCustomer } from "../../support/fake-stripe.js";

describe("getTopCustomers", () => {
  it("ranks customers by net revenue, highest first, all-time when no range is given", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(
      asyncIterableList([
        fakeCharge({ id: "ch_1", amount: 5000, customer: fakeCustomer({ id: "cus_a", name: "Acme Corp" }) }),
        fakeCharge({ id: "ch_2", amount: 20000, customer: fakeCustomer({ id: "cus_b", name: "Maya Rodriguez" }) }),
      ]),
    );

    const result = await getTopCustomers(asStripe(fake), {});

    expect(result.startDate).toBeNull();
    expect(result.endDate).toBeNull();
    expect(result.customers).toEqual([
      { customerId: "cus_b", customerName: "Maya Rodriguez", totalCents: 20000, chargeCount: 1 },
      { customerId: "cus_a", customerName: "Acme Corp", totalCents: 5000, chargeCount: 1 },
    ]);
    // No date filter passed to Stripe when none was requested.
    const callArgs = fake.charges.list.mock.calls[0][0] as { created?: unknown };
    expect(callArgs.created).toBeUndefined();
  });

  it("reports an empty ranking rather than fabricating when there are no charges", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(asyncIterableList([]));

    const result = await getTopCustomers(asStripe(fake), {});

    expect(result.customers).toEqual([]);
  });

  it("respects an explicit date range when both startDate and endDate are given", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(asyncIterableList([]));

    await getTopCustomers(asStripe(fake), { startDate: "2026-09-01", endDate: "2026-09-08" });

    expect(fake.charges.list).toHaveBeenCalledWith(
      expect.objectContaining({ created: { gte: expect.any(Number), lt: expect.any(Number) } }),
    );
  });

  it("rejects a startDate given without a matching endDate rather than silently ignoring it", async () => {
    const fake = createFakeStripe();
    await expect(getTopCustomers(asStripe(fake), { startDate: "2026-09-01" } as never)).rejects.toThrow();
  });

  it("caps the result to the given limit, keeping only the highest earners", async () => {
    const fake = createFakeStripe();
    fake.charges.list.mockReturnValueOnce(
      asyncIterableList([
        fakeCharge({ id: "ch_1", amount: 1000, customer: fakeCustomer({ id: "cus_a" }) }),
        fakeCharge({ id: "ch_2", amount: 3000, customer: fakeCustomer({ id: "cus_b" }) }),
        fakeCharge({ id: "ch_3", amount: 2000, customer: fakeCustomer({ id: "cus_c" }) }),
      ]),
    );

    const result = await getTopCustomers(asStripe(fake), { limit: 2 });

    expect(result.customers).toHaveLength(2);
    expect(result.customers.map((c) => c.customerId)).toEqual(["cus_b", "cus_c"]);
  });

  it("defaults to the top 10 rather than returning every customer unbounded", async () => {
    const fake = createFakeStripe();
    const charges = Array.from({ length: 15 }, (_, i) =>
      fakeCharge({ id: `ch_${i}`, amount: 1000 + i, customer: fakeCustomer({ id: `cus_${i}` }) }),
    );
    fake.charges.list.mockReturnValueOnce(asyncIterableList(charges));

    const result = await getTopCustomers(asStripe(fake), {});

    expect(result.customers).toHaveLength(10);
  });
});

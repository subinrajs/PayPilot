import { describe, expect, it } from "vitest";
import { findCustomersByReference } from "../../src/agent/customer-resolution.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCustomer } from "../support/fake-stripe.js";

describe("findCustomersByReference", () => {
  it("matches a customer from the plain (clock-less) customer list", () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([fakeCustomer({ id: "cus_1", name: "Acme Corp" })]));

    return findCustomersByReference(asStripe(fake), "acme").then((matches) => {
      expect(matches.map((c) => c.id)).toEqual(["cus_1"]);
    });
  });

  it("also matches a customer only visible via a test clock's own customer list", async () => {
    // Regression test: customers attached to a test clock are invisible to a plain
    // customers.list() call — Stripe only returns them when filtered by that clock's id. Every
    // seeded customer is clock-attached (see seed.ts), so missing this meant refund/invoice
    // creation could never resolve any of the seed data by name.
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([])); // plain scan finds nobody
    fake.testHelpers.testClocks.list.mockReturnValueOnce(asyncIterableList([{ id: "clock_1" }]));
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([fakeCustomer({ id: "cus_maya", name: "Maya Rodriguez" })]),
    );

    const matches = await findCustomersByReference(asStripe(fake), "Maya");

    expect(matches.map((c) => c.id)).toEqual(["cus_maya"]);
    expect(fake.customers.list).toHaveBeenCalledWith(expect.objectContaining({ test_clock: "clock_1" }));
  });

  it("returns no matches when nobody, clock-attached or not, matches the reference", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([]));

    const matches = await findCustomersByReference(asStripe(fake), "Nobody");

    expect(matches).toEqual([]);
  });
});

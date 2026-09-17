import { describe, expect, it } from "vitest";
import { listCustomers } from "../../../src/agent/tools/customer-list.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCustomer } from "../../support/fake-stripe.js";

describe("listCustomers", () => {
  it("lists every customer's id, name, and email", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([
        fakeCustomer({ id: "cus_a", name: "Acme Corp", email: "billing@acme.example" }),
        fakeCustomer({ id: "cus_b", name: "Maya Rodriguez", email: "maya@example.com" }),
      ]),
    );

    const result = await listCustomers(asStripe(fake));

    expect(result.count).toBe(2);
    expect(result.customers).toEqual([
      { id: "cus_a", name: "Acme Corp", email: "billing@acme.example" },
      { id: "cus_b", name: "Maya Rodriguez", email: "maya@example.com" },
    ]);
  });

  it("reports zero rather than fabricating when there are no customers", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([]));

    const result = await listCustomers(asStripe(fake));

    expect(result).toEqual({ count: 0, customers: [] });
  });

  it("scans customers attached to a test clock too, not just the plain customer list", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([]));
    fake.testHelpers.testClocks.list.mockReturnValueOnce(asyncIterableList([{ id: "clock_1" }] as never));
    fake.customers.list.mockReturnValueOnce(asyncIterableList([fakeCustomer({ id: "cus_clocked", name: "Clocked Co" })]));

    const result = await listCustomers(asStripe(fake));

    expect(result.count).toBe(1);
    expect(result.customers[0]).toEqual({ id: "cus_clocked", name: "Clocked Co", email: "fake@example.com" });
  });

  it("falls back to email, then id, when a customer has no name — never blank", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([
        fakeCustomer({ id: "cus_noname", name: null, email: "noname@example.com" }),
        fakeCustomer({ id: "cus_bare", name: null, email: null }),
      ]),
    );

    const result = await listCustomers(asStripe(fake));

    expect(result.customers[0].name).toBe("noname@example.com");
    expect(result.customers[1].name).toBe("cus_bare");
  });
});

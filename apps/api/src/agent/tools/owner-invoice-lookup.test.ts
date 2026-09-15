import { describe, expect, it } from "vitest";
import { lookupCustomerInvoices } from "./owner-invoice-lookup.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCustomer, fakeInvoice } from "../../test-support/fake-stripe.js";

describe("lookupCustomerInvoices", () => {
  it("resolves a customer reference and returns their invoices", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([fakeCustomer({ id: "cus_acme", name: "Acme Corp" })]),
    );
    fake.invoices.list.mockResolvedValueOnce({
      data: [fakeInvoice({ id: "in_1", customer: "cus_acme", amount_due: 25000, status: "open" })],
    });

    const result = await lookupCustomerInvoices(asStripe(fake), { customerReference: "Acme" });

    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.customerName).toBe("Acme Corp");
      expect(result.invoices).toHaveLength(1);
      expect(result.invoices[0].id).toBe("in_1");
    }
    // Scoped to the resolved customer, not left to Stripe's default (unscoped) list.
    expect(fake.invoices.list).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_acme" }));
  });

  it("reports not_found when no customer matches the reference", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([]));

    const result = await lookupCustomerInvoices(asStripe(fake), { customerReference: "Nobody" });

    expect(result).toEqual({ kind: "not_found", reason: 'No customer matching "Nobody"' });
    expect(fake.invoices.list).not.toHaveBeenCalled();
  });

  it("asks for clarification when multiple customers match, rather than guessing which one", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([
        fakeCustomer({ id: "cus_1", name: "John Smith" }),
        fakeCustomer({ id: "cus_2", name: "John Doe" }),
      ]),
    );

    const result = await lookupCustomerInvoices(asStripe(fake), { customerReference: "John" });

    expect(result.kind).toBe("ambiguous_customer");
    if (result.kind === "ambiguous_customer") {
      expect(result.candidates).toHaveLength(2);
    }
    expect(fake.invoices.list).not.toHaveBeenCalled();
  });

  it("passes the status filter through to the underlying lookup", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([fakeCustomer({ id: "cus_acme", name: "Acme Corp" })]),
    );
    fake.invoices.list.mockResolvedValueOnce({
      data: [fakeInvoice({ id: "in_paid", customer: "cus_acme", status: "paid", paid: true })],
    });

    const result = await lookupCustomerInvoices(asStripe(fake), { customerReference: "Acme", status: "paid" });

    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.invoices.map((i) => i.id)).toEqual(["in_paid"]);
    }
  });

  it("rejects a customerId key the schema doesn't allow", async () => {
    const fake = createFakeStripe();
    await expect(
      lookupCustomerInvoices(asStripe(fake), { customerReference: "Acme", customerId: "cus_attacker" } as never),
    ).rejects.toThrow();
    expect(fake.customers.list).not.toHaveBeenCalled();
  });
});

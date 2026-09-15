import { describe, expect, it } from "vitest";
import { executeInvoiceCreation, proposeInvoiceCreation } from "./invoice-creation.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCustomer, fakeInvoice } from "../../test-support/fake-stripe.js";

describe("proposeInvoiceCreation", () => {
  it("returns a pending action when exactly one customer matches", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([fakeCustomer({ id: "cus_acme", name: "Acme Corp" })]));

    const result = await proposeInvoiceCreation(asStripe(fake), {
      customerReference: "Acme",
      amountCents: 25000,
      dueDate: "2026-09-21",
    });

    expect(result.kind).toBe("pending");
    if (result.kind === "pending") {
      expect(result.action.tool).toBe("create_invoice");
      expect(result.action.arguments).toMatchObject({
        customerId: "cus_acme",
        customerName: "Acme Corp",
        amountCents: 25000,
        dueDate: "2026-09-21",
      });
    }
  });

  it("reports not_found for an unresolvable recipient rather than creating a new customer", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([]));

    const result = await proposeInvoiceCreation(asStripe(fake), {
      customerReference: "Nobody",
      amountCents: 1000,
      dueDate: "2026-09-21",
    });

    expect(result).toEqual({ kind: "not_found", reason: 'No customer matching "Nobody"' });
  });

  it("asks for clarification when multiple customers match", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([fakeCustomer({ id: "cus_1", name: "John Smith" }), fakeCustomer({ id: "cus_2", name: "John Doe" })]),
    );

    const result = await proposeInvoiceCreation(asStripe(fake), {
      customerReference: "John",
      amountCents: 1000,
      dueDate: "2026-09-21",
    });

    expect(result.kind).toBe("ambiguous_customer");
  });
});

describe("executeInvoiceCreation", () => {
  it("creates the invoice item and invoice with pending items included, then finalizes", async () => {
    const fake = createFakeStripe();
    fake.customers.retrieve.mockResolvedValueOnce(fakeCustomer({ id: "cus_acme" }));
    fake.invoiceItems.create.mockResolvedValueOnce({ id: "ii_1" });
    fake.invoices.create.mockResolvedValueOnce(fakeInvoice({ id: "in_1" }));
    fake.invoices.finalizeInvoice.mockResolvedValueOnce(fakeInvoice({ id: "in_1", status: "open" }));

    const result = await executeInvoiceCreation(asStripe(fake), {
      customerId: "cus_acme",
      customerName: "Acme Corp",
      amountCents: 25000,
      dueDate: "2026-09-21",
      description: "Q3 services",
    });

    expect(fake.invoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_acme", amount: 25000, description: "Q3 services" }),
    );
    expect(fake.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_acme", pending_invoice_items_behavior: "include" }),
    );
    expect(fake.invoices.finalizeInvoice).toHaveBeenCalledWith("in_1");
    expect(result.id).toBe("in_1");
  });

  it("rejects if the customer was deleted since the pending action was proposed", async () => {
    const fake = createFakeStripe();
    fake.customers.retrieve.mockResolvedValueOnce({ id: "cus_acme", deleted: true });

    await expect(
      executeInvoiceCreation(asStripe(fake), {
        customerId: "cus_acme",
        customerName: "Acme Corp",
        amountCents: 25000,
        dueDate: "2026-09-21",
        description: "Q3 services",
      }),
    ).rejects.toThrow(/no longer exists/);
    expect(fake.invoiceItems.create).not.toHaveBeenCalled();
  });
});

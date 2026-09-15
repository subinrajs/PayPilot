import { describe, expect, it } from "vitest";
import { lookupInvoices } from "../../../src/agent/tools/invoice-lookup.js";
import { asStripe, createFakeStripe, fakeInvoice } from "../../support/fake-stripe.js";

describe("lookupInvoices", () => {
  it("scopes the Stripe list call to the given customer id", async () => {
    const fake = createFakeStripe();
    fake.invoices.list.mockResolvedValueOnce({ data: [] });

    await lookupInvoices(asStripe(fake), "cus_sarah", {});

    expect(fake.invoices.list).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_sarah" }));
  });

  it("says nothing owed rather than an empty/ambiguous response", async () => {
    const fake = createFakeStripe();
    fake.invoices.list.mockResolvedValueOnce({ data: [] });

    const result = await lookupInvoices(asStripe(fake), "cus_sarah", {});

    expect(result.invoices).toEqual([]);
  });

  it("marks an open invoice with a past due_date as overdue", async () => {
    const fake = createFakeStripe();
    const pastDueDate = Math.floor((Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000);
    fake.invoices.list.mockResolvedValueOnce({
      data: [fakeInvoice({ id: "in_overdue", status: "open", due_date: pastDueDate })],
    });

    const result = await lookupInvoices(asStripe(fake), "cus_sarah", {});

    expect(result.invoices[0].overdue).toBe(true);
  });

  it("does not mark an open invoice with a future due_date as overdue", async () => {
    const fake = createFakeStripe();
    const futureDueDate = Math.floor((Date.now() + 10 * 24 * 60 * 60 * 1000) / 1000);
    fake.invoices.list.mockResolvedValueOnce({
      data: [fakeInvoice({ id: "in_future", status: "open", due_date: futureDueDate })],
    });

    const result = await lookupInvoices(asStripe(fake), "cus_sarah", {});

    expect(result.invoices[0].overdue).toBe(false);
  });

  it("does not mark a paid invoice as overdue even with a past due_date", async () => {
    const fake = createFakeStripe();
    const pastDueDate = Math.floor((Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000);
    fake.invoices.list.mockResolvedValueOnce({
      data: [fakeInvoice({ id: "in_paid", status: "paid", paid: true, due_date: pastDueDate })],
    });

    const result = await lookupInvoices(asStripe(fake), "cus_sarah", {});

    expect(result.invoices[0].overdue).toBe(false);
  });

  it("filters by the requested status", async () => {
    const fake = createFakeStripe();
    fake.invoices.list.mockResolvedValueOnce({
      data: [fakeInvoice({ id: "in_open", status: "open" }), fakeInvoice({ id: "in_paid", status: "paid", paid: true })],
    });

    const result = await lookupInvoices(asStripe(fake), "cus_sarah", { status: "paid" });

    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0].id).toBe("in_paid");
  });

  it("rejects a customerId key the schema doesn't allow", async () => {
    const fake = createFakeStripe();
    await expect(
      lookupInvoices(asStripe(fake), "cus_sarah", { customerId: "cus_attacker" } as never),
    ).rejects.toThrow();
    expect(fake.invoices.list).not.toHaveBeenCalled();
  });
});

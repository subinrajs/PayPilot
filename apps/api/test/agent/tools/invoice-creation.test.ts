import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  createInvoiceDraft,
  updateInvoiceDraft,
  discardInvoiceDraft,
  proposeSendInvoice,
  executeSendInvoice,
} from "../../../src/agent/tools/invoice-creation.js";
import {
  asStripe,
  asyncIterableList,
  createFakeStripe,
  fakeCustomer,
  fakeInvoice,
  fakeInvoiceItem,
  type FakeStripe,
} from "../../support/fake-stripe.js";

function setupSingleItemDraft(fake: FakeStripe, customerOverrides: Partial<Stripe.Customer> = {}): void {
  fake.customers.list.mockReturnValueOnce(
    asyncIterableList([fakeCustomer({ id: "cus_acme", name: "Acme Corp", email: "billing@acme.com", ...customerOverrides })]),
  );
  fake.invoiceItems.create.mockResolvedValueOnce(
    fakeInvoiceItem({ id: "ii_1", description: "Consulting", quantity: 1, unit_amount: 100000, amount: 100000 }),
  );
  fake.invoices.create.mockResolvedValueOnce(fakeInvoice({ id: "in_1", customer: "cus_acme", status: "draft", subtotal: 100000 }));
}

describe("createInvoiceDraft", () => {
  it("creates one invoiceItem per line item and a draft invoice, without finalizing", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([fakeCustomer({ id: "cus_acme", name: "Acme Corp", email: "billing@acme.com" })]),
    );
    fake.invoiceItems.create
      .mockResolvedValueOnce(fakeInvoiceItem({ id: "ii_1", description: "Consulting", quantity: 10, unit_amount: 15000, amount: 150000 }))
      .mockResolvedValueOnce(fakeInvoiceItem({ id: "ii_2", description: "Development", quantity: 5, unit_amount: 12500, amount: 62500 }));
    fake.invoices.create.mockResolvedValueOnce(fakeInvoice({ id: "in_1", customer: "cus_acme", status: "draft", subtotal: 212500 }));

    const result = await createInvoiceDraft(asStripe(fake), {
      customerReference: "Acme",
      items: [
        { description: "Consulting", quantity: 10, unitAmountCents: 15000 },
        { description: "Development", quantity: 5, unitAmountCents: 12500 },
      ],
      dueDate: "2026-10-01",
    });

    expect(fake.invoiceItems.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ customer: "cus_acme", currency: "usd", quantity: 10, unit_amount: 15000, description: "Consulting" }),
    );
    expect(fake.invoiceItems.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ customer: "cus_acme", currency: "usd", quantity: 5, unit_amount: 12500, description: "Development" }),
    );
    expect(fake.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_acme", collection_method: "send_invoice", pending_invoice_items_behavior: "include" }),
    );
    expect(fake.invoices.finalizeInvoice).not.toHaveBeenCalled();

    if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
    expect(result.draftInvoiceId).toBe("in_1");
    expect(result.customerName).toBe("Acme Corp");
    expect(result.customerEmail).toBe("billing@acme.com");
    expect(result.subtotalCents).toBe(212500);
    expect(result.items).toEqual([
      { description: "Consulting", quantity: 10, unitAmountCents: 15000, amountCents: 150000 },
      { description: "Development", quantity: 5, unitAmountCents: 12500, amountCents: 62500 },
    ]);
  });

  it("reports not_found for an unresolvable recipient rather than creating a new customer", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([]));

    const result = await createInvoiceDraft(asStripe(fake), {
      customerReference: "Nobody",
      items: [{ description: "Widget", quantity: 1, unitAmountCents: 1000 }],
      dueDate: "2026-10-01",
    });

    expect(result).toEqual({ kind: "not_found", reason: 'No customer matching "Nobody"' });
    expect(fake.invoiceItems.create).not.toHaveBeenCalled();
  });

  it("asks for clarification when multiple customers match", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([fakeCustomer({ id: "cus_1", name: "John Smith" }), fakeCustomer({ id: "cus_2", name: "John Doe" })]),
    );

    const result = await createInvoiceDraft(asStripe(fake), {
      customerReference: "John",
      items: [{ description: "Widget", quantity: 1, unitAmountCents: 1000 }],
      dueDate: "2026-10-01",
    });

    expect(result.kind).toBe("ambiguous_customer");
  });

  describe("reviewer checks", () => {
    it("flags a missing customer email", async () => {
      const fake = createFakeStripe();
      setupSingleItemDraft(fake, { email: null });

      const result = await createInvoiceDraft(asStripe(fake), {
        customerReference: "Acme",
        items: [{ description: "Consulting", quantity: 1, unitAmountCents: 100000 }],
        dueDate: "2026-10-01",
      });

      if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
      expect(result.reviewFlags).toContainEqual({ severity: "warning", label: "Customer has no email on file" });
    });

    it("confirms the customer's email when one is on file", async () => {
      const fake = createFakeStripe();
      setupSingleItemDraft(fake);

      const result = await createInvoiceDraft(asStripe(fake), {
        customerReference: "Acme",
        items: [{ description: "Consulting", quantity: 1, unitAmountCents: 100000 }],
        dueDate: "2026-10-01",
      });

      if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
      expect(result.reviewFlags).toContainEqual({ severity: "ok", label: "Customer email verified (billing@acme.com)" });
    });

    it("flags this customer's overdue invoices", async () => {
      const fake = createFakeStripe();
      setupSingleItemDraft(fake);
      fake.invoices.list.mockResolvedValueOnce({
        data: [fakeInvoice({ id: "in_prev", customer: "cus_acme", status: "open", amount_due: 30000, due_date: pastDueDate() })],
      });

      const result = await createInvoiceDraft(asStripe(fake), {
        customerReference: "Acme",
        items: [{ description: "Consulting", quantity: 1, unitAmountCents: 100000 }],
        dueDate: "2026-10-01",
      });

      if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
      expect(result.reviewFlags).toContainEqual({ severity: "warning", label: "1 overdue invoice totaling $300.00" });
    });

    it("reports no overdue invoices when there are none", async () => {
      const fake = createFakeStripe();
      setupSingleItemDraft(fake);

      const result = await createInvoiceDraft(asStripe(fake), {
        customerReference: "Acme",
        items: [{ description: "Consulting", quantity: 1, unitAmountCents: 100000 }],
        dueDate: "2026-10-01",
      });

      if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
      expect(result.reviewFlags).toContainEqual({ severity: "ok", label: "No overdue invoices for this customer" });
    });

    it("flags an unusually high amount vs. this customer's average", async () => {
      const fake = createFakeStripe();
      setupSingleItemDraft(fake);
      fake.invoices.list.mockResolvedValueOnce({
        data: [fakeInvoice({ id: "in_prev", customer: "cus_acme", status: "paid", amount_due: 50000, due_date: null })],
      });

      const result = await createInvoiceDraft(asStripe(fake), {
        customerReference: "Acme",
        items: [{ description: "Consulting", quantity: 1, unitAmountCents: 100000 }],
        dueDate: "2026-10-01",
      });

      if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
      expect(result.reviewFlags.some((f) => f.severity === "warning" && f.label.includes("higher than"))).toBe(true);
    });

    it("skips the unusual-amount check when there's no prior history to compare against", async () => {
      const fake = createFakeStripe();
      setupSingleItemDraft(fake);

      const result = await createInvoiceDraft(asStripe(fake), {
        customerReference: "Acme",
        items: [{ description: "Consulting", quantity: 1, unitAmountCents: 100000 }],
        dueDate: "2026-10-01",
      });

      if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
      expect(result.reviewFlags.some((f) => f.label.includes("higher than") || f.label.includes("line with"))).toBe(false);
    });

    it("flags a possible duplicate — same amount and memo for this customer within 30 days", async () => {
      const fake = createFakeStripe();
      fake.customers.list.mockReturnValueOnce(asyncIterableList([fakeCustomer({ id: "cus_acme", name: "Acme Corp", email: "billing@acme.com" })]));
      fake.invoiceItems.create.mockResolvedValueOnce(
        fakeInvoiceItem({ id: "ii_1", description: "Website Development", quantity: 1, unit_amount: 250000, amount: 250000 }),
      );
      fake.invoices.create.mockResolvedValueOnce(fakeInvoice({ id: "in_1", customer: "cus_acme", status: "draft", subtotal: 250000 }));
      fake.invoices.list.mockResolvedValueOnce({
        data: [
          fakeInvoice({
            id: "in_prev",
            customer: "cus_acme",
            status: "open",
            amount_due: 250000,
            description: "Website Development",
            created: recentUnix(),
          }),
        ],
      });

      const result = await createInvoiceDraft(asStripe(fake), {
        customerReference: "Acme",
        items: [{ description: "Website Development", quantity: 1, unitAmountCents: 250000 }],
        dueDate: "2026-10-01",
        memo: "Website Development",
      });

      if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
      expect(result.reviewFlags.some((f) => f.severity === "warning" && f.label.includes("similar"))).toBe(true);
    });

    it("always flags tax as not configured", async () => {
      const fake = createFakeStripe();
      setupSingleItemDraft(fake);

      const result = await createInvoiceDraft(asStripe(fake), {
        customerReference: "Acme",
        items: [{ description: "Consulting", quantity: 1, unitAmountCents: 100000 }],
        dueDate: "2026-10-01",
      });

      if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
      expect(result.reviewFlags).toContainEqual({ severity: "warning", label: "Tax: Not configured" });
    });
  });
});

describe("updateInvoiceDraft", () => {
  it("updates the due date, leaving items unchanged", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_1", customer: "cus_acme", status: "draft", subtotal: 100000, description: "Old memo" }),
    );
    fake.customers.retrieve.mockResolvedValueOnce(fakeCustomer({ id: "cus_acme", name: "Acme Corp", email: "billing@acme.com" }));
    fake.invoiceItems.list.mockReturnValueOnce(
      asyncIterableList([fakeInvoiceItem({ id: "ii_1", description: "Consulting", quantity: 1, unit_amount: 100000, amount: 100000 })]),
    );
    fake.invoices.update.mockResolvedValueOnce(
      fakeInvoice({ id: "in_1", customer: "cus_acme", status: "draft", subtotal: 100000, description: "Old memo", due_date: isoToUnix("2026-11-01") }),
    );

    const result = await updateInvoiceDraft(asStripe(fake), { draftInvoiceId: "in_1", dueDate: "2026-11-01" });

    expect(fake.invoiceItems.del).not.toHaveBeenCalled();
    expect(fake.invoiceItems.create).not.toHaveBeenCalled();
    expect(fake.invoices.update).toHaveBeenCalledWith("in_1", expect.objectContaining({ due_date: isoToUnix("2026-11-01") }));

    if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
    expect(result.dueDate).toBe("2026-11-01");
    expect(result.items).toEqual([{ description: "Consulting", quantity: 1, unitAmountCents: 100000, amountCents: 100000 }]);
  });

  it("replaces line items — deletes the draft's existing pending items and recreates from the new array", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(fakeInvoice({ id: "in_1", customer: "cus_acme", status: "draft", subtotal: 100000 }));
    fake.customers.retrieve.mockResolvedValueOnce(fakeCustomer({ id: "cus_acme", name: "Acme Corp", email: "billing@acme.com" }));
    fake.invoiceItems.list.mockReturnValueOnce(asyncIterableList([fakeInvoiceItem({ id: "ii_old" })]));
    fake.invoiceItems.create.mockResolvedValueOnce(
      fakeInvoiceItem({ id: "ii_new", description: "Consulting (revised)", quantity: 12, unit_amount: 15000, amount: 180000 }),
    );
    fake.invoices.update.mockResolvedValueOnce(fakeInvoice({ id: "in_1", customer: "cus_acme", status: "draft", subtotal: 180000 }));

    const result = await updateInvoiceDraft(asStripe(fake), {
      draftInvoiceId: "in_1",
      items: [{ description: "Consulting (revised)", quantity: 12, unitAmountCents: 15000 }],
    });

    expect(fake.invoiceItems.del).toHaveBeenCalledWith("ii_old");
    expect(fake.invoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_acme", quantity: 12, unit_amount: 15000, description: "Consulting (revised)" }),
    );

    if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
    expect(result.items).toEqual([{ description: "Consulting (revised)", quantity: 12, unitAmountCents: 15000, amountCents: 180000 }]);
  });

  it("reports not_found rather than editing an invoice that's already been sent", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(fakeInvoice({ id: "in_1", status: "open" }));

    const result = await updateInvoiceDraft(asStripe(fake), { draftInvoiceId: "in_1", dueDate: "2026-11-01" });

    expect(result).toEqual({ kind: "not_found", reason: "Invoice draft in_1 no longer exists or was already sent" });
    expect(fake.invoices.update).not.toHaveBeenCalled();
  });
});

describe("discardInvoiceDraft", () => {
  it("deletes a draft invoice", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(fakeInvoice({ id: "in_1", status: "draft" }));

    const result = await discardInvoiceDraft(asStripe(fake), { draftInvoiceId: "in_1" });

    expect(fake.invoices.del).toHaveBeenCalledWith("in_1");
    expect(result).toEqual({ kind: "discarded" });
  });

  it("reports not_found rather than deleting an invoice that's already been sent", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(fakeInvoice({ id: "in_1", status: "open" }));

    const result = await discardInvoiceDraft(asStripe(fake), { draftInvoiceId: "in_1" });

    expect(result).toEqual({ kind: "not_found", reason: "Invoice draft in_1 no longer exists or was already sent" });
    expect(fake.invoices.del).not.toHaveBeenCalled();
  });
});

describe("proposeSendInvoice", () => {
  it("returns a pending action describing the draft", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_1", customer: "cus_acme", status: "draft", subtotal: 100000, due_date: isoToUnix("2026-11-01") }),
    );
    fake.customers.retrieve.mockResolvedValueOnce(fakeCustomer({ id: "cus_acme", name: "Acme Corp" }));

    const result = await proposeSendInvoice(asStripe(fake), { draftInvoiceId: "in_1" });

    expect(result.kind).toBe("pending");
    if (result.kind !== "pending") throw new Error("expected pending");
    expect(result.action.tool).toBe("send_invoice");
    expect(result.action.arguments).toEqual({
      draftInvoiceId: "in_1",
      customerName: "Acme Corp",
      totalCents: 100000,
      dueDate: "2026-11-01",
    });
  });

  it("reports not_found if the draft no longer exists or was already sent", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(fakeInvoice({ id: "in_1", status: "open" }));

    const result = await proposeSendInvoice(asStripe(fake), { draftInvoiceId: "in_1" });

    expect(result).toEqual({ kind: "not_found", reason: "Invoice draft in_1 no longer exists or was already sent" });
  });
});

describe("executeSendInvoice", () => {
  it("finalizes with auto_advance false, then explicitly sends", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(fakeInvoice({ id: "in_1", customer: "cus_acme", status: "draft" }));
    fake.invoices.finalizeInvoice.mockResolvedValueOnce(fakeInvoice({ id: "in_1", status: "open" }));
    const sent = fakeInvoice({ id: "in_1", status: "open", number: "INV-1001", hosted_invoice_url: "https://invoice.stripe.com/i/1001" });
    fake.invoices.sendInvoice.mockResolvedValueOnce(sent);

    const result = await executeSendInvoice(asStripe(fake), {
      draftInvoiceId: "in_1",
      customerName: "Acme Corp",
      totalCents: 100000,
      dueDate: "2026-11-01",
    });

    expect(fake.invoices.finalizeInvoice).toHaveBeenCalledWith("in_1", { auto_advance: false });
    expect(fake.invoices.sendInvoice).toHaveBeenCalledWith("in_1");
    expect(result).toEqual(sent);
  });

  it("rejects if the draft was already sent or discarded since the pending action was proposed", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(fakeInvoice({ id: "in_1", status: "open" }));

    await expect(
      executeSendInvoice(asStripe(fake), { draftInvoiceId: "in_1", customerName: "Acme Corp", totalCents: 100000, dueDate: "2026-11-01" }),
    ).rejects.toThrow(/no longer exists or was already sent/);
    expect(fake.invoices.finalizeInvoice).not.toHaveBeenCalled();
    expect(fake.invoices.sendInvoice).not.toHaveBeenCalled();
  });
});

function isoToUnix(isoDate: string): number {
  return Math.floor(new Date(`${isoDate}T00:00:00.000Z`).getTime() / 1000);
}

function pastDueDate(): number {
  return Math.floor((Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000);
}

function recentUnix(): number {
  return Math.floor((Date.now() - 5 * 24 * 60 * 60 * 1000) / 1000);
}

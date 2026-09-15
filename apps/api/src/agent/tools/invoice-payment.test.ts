import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { executeInvoicePayment, proposeInvoicePayment } from "./invoice-payment.js";
import { asStripe, createFakeStripe, fakeInvoice } from "../../test-support/fake-stripe.js";

describe("proposeInvoicePayment", () => {
  it("returns a pending action for an owned, unpaid, under-cap invoice", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_1", customer: "cus_sarah", amount_due: 45000, paid: false, status: "open" }),
    );

    const result = await proposeInvoicePayment(asStripe(fake), "cus_sarah", { invoiceId: "in_1" });

    expect(result.kind).toBe("pending");
    if (result.kind === "pending") {
      expect(result.action.tool).toBe("pay_invoice");
      expect(result.action.arguments).toEqual({ invoiceId: "in_1", customerId: "cus_sarah", amountCents: 45000 });
    }
  });

  it("routes an at/above-cap invoice to handoff instead of a payable pending action", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_2", customer: "cus_sarah", amount_due: 250000, paid: false, status: "open" }),
    );

    const result = await proposeInvoicePayment(asStripe(fake), "cus_sarah", { invoiceId: "in_2" });

    expect(result).toEqual({
      kind: "handoff",
      invoiceId: "in_2",
      amountCents: 250000,
      hostedInvoiceUrl: "https://invoice.stripe.com/i/fake",
    });
  });

  it("falls back to a null hostedInvoiceUrl rather than throwing when Stripe doesn't provide one", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({
        id: "in_3",
        customer: "cus_sarah",
        amount_due: 250000,
        paid: false,
        status: "open",
        hosted_invoice_url: null,
      }),
    );

    const result = await proposeInvoicePayment(asStripe(fake), "cus_sarah", { invoiceId: "in_3" });

    expect(result).toMatchObject({ kind: "handoff", hostedInvoiceUrl: null });
  });

  it("routes an invoice at exactly the cap boundary to handoff, not payment", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_3", customer: "cus_sarah", amount_due: 200000, paid: false, status: "open" }),
    );

    const result = await proposeInvoicePayment(asStripe(fake), "cus_sarah", { invoiceId: "in_3" });

    expect(result.kind).toBe("handoff");
  });

  it("returns not_found for an invoice belonging to a different customer, without revealing it exists", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_1", customer: "cus_other", amount_due: 1000, paid: false, status: "open" }),
    );

    const result = await proposeInvoicePayment(asStripe(fake), "cus_sarah", { invoiceId: "in_1" });

    expect(result).toEqual({ kind: "not_found" });
  });

  it("returns not_found for an unknown invoice id", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "resource_missing",
        message: "No such invoice",
      } as never),
    );

    const result = await proposeInvoicePayment(asStripe(fake), "cus_sarah", { invoiceId: "in_missing" });

    expect(result).toEqual({ kind: "not_found" });
  });

  it("rejects an invoiceId supplied alongside a customerId key the schema doesn't allow", async () => {
    const fake = createFakeStripe();
    await expect(
      proposeInvoicePayment(asStripe(fake), "cus_sarah", {
        invoiceId: "in_1",
        customerId: "cus_attacker",
      } as never),
    ).rejects.toThrow();
    expect(fake.invoices.retrieve).not.toHaveBeenCalled();
  });

  it("returns already_paid for an invoice that's already settled", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_1", customer: "cus_sarah", amount_due: 0, paid: true, status: "paid" }),
    );

    const result = await proposeInvoicePayment(asStripe(fake), "cus_sarah", { invoiceId: "in_1" });

    expect(result).toEqual({ kind: "already_paid" });
  });
});

describe("executeInvoicePayment", () => {
  it("pays the invoice after re-validating ownership and the cap", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_1", customer: "cus_sarah", amount_due: 45000, paid: false, status: "open" }),
    );
    fake.invoices.pay.mockResolvedValueOnce(fakeInvoice({ id: "in_1", paid: true, status: "paid" }));

    const result = await executeInvoicePayment(asStripe(fake), "cus_sarah", {
      invoiceId: "in_1",
      customerId: "cus_sarah",
      amountCents: 45000,
    });

    expect(fake.invoices.pay).toHaveBeenCalledWith("in_1");
    expect(result.paid).toBe(true);
  });

  it("refuses to pay an invoice that no longer belongs to this customer", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(fakeInvoice({ id: "in_1", customer: "cus_other" }));

    await expect(
      executeInvoicePayment(asStripe(fake), "cus_sarah", {
        invoiceId: "in_1",
        customerId: "cus_sarah",
        amountCents: 45000,
      }),
    ).rejects.toThrow();
    expect(fake.invoices.pay).not.toHaveBeenCalled();
  });

  it("refuses to pay an invoice that's at/above the cap even if it was resolved before the cap changed", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_1", customer: "cus_sarah", amount_due: 250000, paid: false, status: "open" }),
    );

    await expect(
      executeInvoicePayment(asStripe(fake), "cus_sarah", {
        invoiceId: "in_1",
        customerId: "cus_sarah",
        amountCents: 250000,
      }),
    ).rejects.toThrow();
    expect(fake.invoices.pay).not.toHaveBeenCalled();
  });

  it("refuses to pay an invoice that was already paid since it was proposed", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_1", customer: "cus_sarah", amount_due: 45000, paid: true, status: "paid" }),
    );

    await expect(
      executeInvoicePayment(asStripe(fake), "cus_sarah", {
        invoiceId: "in_1",
        customerId: "cus_sarah",
        amountCents: 45000,
      }),
    ).rejects.toThrow(/already paid/);
    expect(fake.invoices.pay).not.toHaveBeenCalled();
  });
});

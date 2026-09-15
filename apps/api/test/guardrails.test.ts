// Cross-cutting guardrail suite (Phase 7 — README §7's "Run tests" section refers to this file
// and the suites it draws together). Individual pieces of every guarantee here are already
// unit-tested in isolation in the matching test file (agent/tools/*.test.ts, policies/*.test.ts,
// telegram/*.test.ts, routes/assistant.test.ts) — this file's job is different: prove the
// guarantees hold when the real modules interact together (only Stripe is faked), in one
// discoverable place, rather than trusting that isolated unit tests compose correctly.
import { describe, expect, it } from "vitest";
import { proposeInvoicePayment, executeInvoicePayment, type ResolvedInvoicePaymentArgs } from "../src/agent/tools/invoice-payment.js";
import { lookupInvoices } from "../src/agent/tools/invoice-lookup.js";
import { PAYMENT_CAP_CENTS } from "../src/policies/payment-policy.js";
import { setPendingAction, peekPendingAction } from "../src/agent/pending-action-store.js";
import { createPendingAction } from "../src/agent/pending-action.js";
import { executeConfirmedAction } from "../src/routes/assistant.js";
import { confirmPayInvoice, cancelPendingAction } from "../src/telegram/bot.js";
import { linkChat, getCustomerId } from "../src/telegram/session.js";
import { asStripe, createFakeStripe, fakeInvoice } from "./support/fake-stripe.js";

describe("guardrail: $2,000 cap, system level (propose -> confirm cycle)", () => {
  it("just under the cap: proposes a payable pending action, and executing it really calls Stripe", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValue(
      fakeInvoice({ id: "in_lo", customer: "cus_a", amount_due: PAYMENT_CAP_CENTS - 1, paid: false, status: "open" }),
    );
    fake.invoices.pay.mockResolvedValueOnce(fakeInvoice({ id: "in_lo", paid: true, status: "paid" }));

    const proposed = await proposeInvoicePayment(asStripe(fake), "cus_a", { invoiceId: "in_lo" });
    expect(proposed.kind).toBe("pending");
    if (proposed.kind !== "pending") return;

    const result = await executeInvoicePayment(asStripe(fake), "cus_a", proposed.action.arguments);
    expect(fake.invoices.pay).toHaveBeenCalledWith("in_lo");
    expect(result.paid).toBe(true);
  });

  it("exactly at the cap: never produces a payable pending action, and Stripe is never called for payment", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValue(
      fakeInvoice({ id: "in_eq", customer: "cus_a", amount_due: PAYMENT_CAP_CENTS, paid: false, status: "open" }),
    );

    const proposed = await proposeInvoicePayment(asStripe(fake), "cus_a", { invoiceId: "in_eq" });

    expect(proposed.kind).toBe("handoff");
    expect(fake.invoices.pay).not.toHaveBeenCalled();
  });

  it("just above the cap: same as at-cap — handoff, no Stripe payment call", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValue(
      fakeInvoice({ id: "in_hi", customer: "cus_a", amount_due: PAYMENT_CAP_CENTS + 1, paid: false, status: "open" }),
    );

    const proposed = await proposeInvoicePayment(asStripe(fake), "cus_a", { invoiceId: "in_hi" });

    expect(proposed.kind).toBe("handoff");
    expect(fake.invoices.pay).not.toHaveBeenCalled();
  });

  it("a forged/tampered resolved amount cannot buy a bypass — execute re-derives the amount from Stripe, not the stored pending action", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValue(
      fakeInvoice({ id: "in_forged", customer: "cus_a", amount_due: PAYMENT_CAP_CENTS + 50000, paid: false, status: "open" }),
    );

    const forged: ResolvedInvoicePaymentArgs = { invoiceId: "in_forged", customerId: "cus_a", amountCents: 1 };

    await expect(executeInvoicePayment(asStripe(fake), "cus_a", forged)).rejects.toThrow();
    expect(fake.invoices.pay).not.toHaveBeenCalled();
  });
});

describe("guardrail: Telegram customer scoping, system level (session -> tool)", () => {
  it("two linked chats never see or act on each other's invoices", async () => {
    linkChat(90001, "cus_scope_a");
    linkChat(90002, "cus_scope_b");

    const customerIdA = getCustomerId(90001)!;
    const customerIdB = getCustomerId(90002)!;
    expect(customerIdA).not.toBe(customerIdB);

    const fake = createFakeStripe();
    fake.invoices.list.mockResolvedValueOnce({
      data: [fakeInvoice({ id: "in_a", customer: customerIdA, amount_due: 5000 })],
    });
    const resultA = await lookupInvoices(asStripe(fake), customerIdA, {});
    expect(fake.invoices.list).toHaveBeenLastCalledWith(expect.objectContaining({ customer: customerIdA }));
    expect(resultA.invoices.map((i) => i.id)).toEqual(["in_a"]);

    fake.invoices.list.mockResolvedValueOnce({
      data: [fakeInvoice({ id: "in_b", customer: customerIdB, amount_due: 7000 })],
    });
    const resultB = await lookupInvoices(asStripe(fake), customerIdB, {});
    expect(fake.invoices.list).toHaveBeenLastCalledWith(expect.objectContaining({ customer: customerIdB }));
    expect(resultB.invoices.map((i) => i.id)).toEqual(["in_b"]);

    // Neither result leaks into the other.
    expect(resultA.invoices.map((i) => i.id)).not.toContain("in_b");
    expect(resultB.invoices.map((i) => i.id)).not.toContain("in_a");
  });

  it("chat A's session customerId cannot propose payment against chat B's invoice", async () => {
    linkChat(90003, "cus_scope_c");
    linkChat(90004, "cus_scope_d");
    const customerIdC = getCustomerId(90003)!;
    const customerIdD = getCustomerId(90004)!;

    const fake = createFakeStripe();
    // The invoice actually belongs to D.
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_d", customer: customerIdD, amount_due: 5000, status: "open" }),
    );

    const result = await proposeInvoicePayment(asStripe(fake), customerIdC, { invoiceId: "in_d" });

    // Same result as a nonexistent invoice — C must not learn D's invoice exists at all.
    expect(result).toEqual({ kind: "not_found" });
  });
});

describe("guardrail: cross-surface pending-action authorization (web <-> Telegram, one shared store)", () => {
  it("a Telegram pay_invoice pending action confirmed under a different chat's session fails closed", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(fakeInvoice({ id: "in_1", customer: "cus_owner", amount_due: 5000 }));

    const action = createPendingAction<"pay_invoice", ResolvedInvoicePaymentArgs>("pay_invoice", {
      invoiceId: "in_1",
      customerId: "cus_owner",
      amountCents: 5000,
    });

    await expect(confirmPayInvoice(asStripe(fake), action, "cus_attacker")).rejects.toThrow();
    expect(fake.invoices.pay).not.toHaveBeenCalled();
  });

  it("the web route's own dispatch (executeConfirmedAction) refuses a pay_invoice action outright — defense in depth beyond the route's peek gate", async () => {
    const fake = createFakeStripe();
    const action = createPendingAction<"pay_invoice", ResolvedInvoicePaymentArgs>("pay_invoice", {
      invoiceId: "in_1",
      customerId: "cus_a",
      amountCents: 5000,
    });

    await expect(executeConfirmedAction(asStripe(fake), action)).rejects.toThrow(/No executor registered/);
    expect(fake.invoices.retrieve).not.toHaveBeenCalled();
  });

  it("a web-side refund pending action is left untouched by the bot's cancel path — not consumed, not actioned", () => {
    const refundAction = createPendingAction("refund", { chargeId: "ch_shared_store" });
    setPendingAction(refundAction);

    expect(cancelPendingAction(refundAction.id, "cus_anyone")).toBe("not_found");
    // Still there — proves the bot's cancel path peeked and declined rather than consuming.
    expect(peekPendingAction(refundAction.id)).not.toBeNull();
  });

  it("an expired pending action fails closed the same way through both the raw store and the tool layer", async () => {
    const fake = createFakeStripe();
    const expired = createPendingAction<"pay_invoice", ResolvedInvoicePaymentArgs>("pay_invoice", {
      invoiceId: "in_1",
      customerId: "cus_a",
      amountCents: 5000,
    });
    expired.expiresAt = Date.now() - 1;
    setPendingAction(expired);

    expect(peekPendingAction(expired.id)).toBeNull();
    expect(cancelPendingAction(expired.id, "cus_a")).toBe("not_found");
    expect(fake.invoices.pay).not.toHaveBeenCalled();
  });
});

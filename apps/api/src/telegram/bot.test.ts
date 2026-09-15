import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import {
  cancelPendingAction,
  confirmPayInvoice,
  formatInvoiceList,
  formatPendingConfirmation,
  handleStart,
  handoffMessage,
  startResultMessage,
} from "./bot.js";
import { getCustomerId, linkChat } from "./session.js";
import { createPendingAction } from "../agent/pending-action.js";
import { setPendingAction } from "../agent/pending-action-store.js";
import type { ResolvedInvoicePaymentArgs } from "../agent/tools/invoice-payment.js";
import type { InvoiceLookupResultItem } from "../agent/tools/invoice-lookup.js";
import { asStripe, createFakeStripe, fakeCustomer, fakeInvoice } from "../test-support/fake-stripe.js";

describe("handleStart", () => {
  it("links a chat to a valid customer id", async () => {
    const fake = createFakeStripe();
    fake.customers.retrieve.mockResolvedValueOnce(fakeCustomer({ id: "cus_valid" }));

    const result = await handleStart(asStripe(fake), 201, "private", "cus_valid");

    expect(result).toBe("linked");
    expect(getCustomerId(201)).toBe("cus_valid");
  });

  it("rejects an unknown link-token rather than creating a mapping", async () => {
    const fake = createFakeStripe();
    fake.customers.retrieve.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "resource_missing",
        message: "No such customer",
      } as never),
    );

    const result = await handleStart(asStripe(fake), 202, "private", "cus_unknown");

    expect(result).toBe("invalid_token");
    expect(getCustomerId(202)).toBeUndefined();
  });

  it("rejects a token for a deleted customer", async () => {
    const fake = createFakeStripe();
    fake.customers.retrieve.mockResolvedValueOnce({ id: "cus_deleted", deleted: true } as never);

    const result = await handleStart(asStripe(fake), 203, "private", "cus_deleted");

    expect(result).toBe("invalid_token");
  });

  it("propagates a real error rather than treating it as an invalid token", async () => {
    const fake = createFakeStripe();
    fake.customers.retrieve.mockRejectedValueOnce(new Error("network blip"));

    await expect(handleStart(asStripe(fake), 204, "private", "cus_x")).rejects.toThrow("network blip");
  });

  it("refuses to link in a group chat — the chat id would be shared by every member", async () => {
    const fake = createFakeStripe();

    const result = await handleStart(asStripe(fake), 205, "group", "cus_valid");

    expect(result).toBe("not_private_chat");
    expect(getCustomerId(205)).toBeUndefined();
    // Must reject before ever consulting Stripe — a group chat is refused on chat type alone.
    expect(fake.customers.retrieve).not.toHaveBeenCalled();
  });

  it("also refuses in a supergroup", async () => {
    const fake = createFakeStripe();
    const result = await handleStart(asStripe(fake), 206, "supergroup", "cus_valid");
    expect(result).toBe("not_private_chat");
  });
});

describe("confirmPayInvoice — cross-chat authorization", () => {
  it("pays when the confirming session's customerId matches the invoice's owner", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_1", customer: "cus_a", amount_due: 45000, paid: false, status: "open" }),
    );
    fake.invoices.pay.mockResolvedValueOnce(fakeInvoice({ id: "in_1", paid: true, status: "paid" }));

    const action = createPendingAction<"pay_invoice", ResolvedInvoicePaymentArgs>("pay_invoice", {
      invoiceId: "in_1",
      customerId: "cus_a",
      amountCents: 45000,
    });

    const result = await confirmPayInvoice(asStripe(fake), action, "cus_a");

    expect(result.paid).toBe(true);
  });

  it("fails closed when a different chat's session tries to confirm someone else's pending action", async () => {
    // The exact scenario docs/plan.md Phase 6 flags: a pay_invoice pending action built for
    // customer A must not be payable by confirming it under customer B's session, even though
    // both write into the same shared pending-action store. The pending action's own
    // `arguments.customerId` (= "cus_a") must never be trusted for authorization — only the
    // confirming session's own customerId, passed as this function's second argument, matters.
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(fakeInvoice({ id: "in_1", customer: "cus_a", amount_due: 45000 }));

    const action = createPendingAction<"pay_invoice", ResolvedInvoicePaymentArgs>("pay_invoice", {
      invoiceId: "in_1",
      customerId: "cus_a",
      amountCents: 45000,
    });

    await expect(confirmPayInvoice(asStripe(fake), action, "cus_b")).rejects.toThrow();
    expect(fake.invoices.pay).not.toHaveBeenCalled();
  });

  it("refuses to dispatch a pending action for any tool other than pay_invoice", async () => {
    const fake = createFakeStripe();
    const action = createPendingAction("refund", { chargeId: "ch_1" });

    await expect(confirmPayInvoice(asStripe(fake), action, "cus_a")).rejects.toThrow(/No executor registered/);
    expect(fake.invoices.retrieve).not.toHaveBeenCalled();
  });
});

describe("cancelPendingAction", () => {
  it("cancels a pending action created for the confirming session's own customer", () => {
    const action = createPendingAction<"pay_invoice", ResolvedInvoicePaymentArgs>("pay_invoice", {
      invoiceId: "in_1",
      customerId: "cus_a",
      amountCents: 45000,
    });
    setPendingAction(action);

    expect(cancelPendingAction(action.id, "cus_a")).toBe("cancelled");
  });

  it("refuses to cancel a pending action that belongs to a different customer", () => {
    const action = createPendingAction<"pay_invoice", ResolvedInvoicePaymentArgs>("pay_invoice", {
      invoiceId: "in_1",
      customerId: "cus_a",
      amountCents: 45000,
    });
    setPendingAction(action);

    expect(cancelPendingAction(action.id, "cus_b")).toBe("forbidden");
  });

  it("reports not_found for an unknown or already-consumed id", () => {
    expect(cancelPendingAction("does-not-exist", "cus_a")).toBe("not_found");
  });
});

describe("startResultMessage", () => {
  it("has a distinct message for every LinkResult/invalid_token outcome", () => {
    const outcomes = [
      "linked",
      "already_linked_elsewhere",
      "chat_linked_to_other_customer",
      "invalid_token",
      "not_private_chat",
    ] as const;
    const messages = outcomes.map(startResultMessage);
    expect(new Set(messages).size).toBe(outcomes.length);
  });
});

describe("handoffMessage", () => {
  it("includes the hosted invoice URL and formatted amount when present", () => {
    const message = handoffMessage({ amountCents: 250000, hostedInvoiceUrl: "https://invoice.stripe.com/i/abc" });
    expect(message).toContain("https://invoice.stripe.com/i/abc");
    expect(message).toContain("$2500.00");
  });

  it("falls back to a contact-us message when there's no hosted invoice URL", () => {
    const message = handoffMessage({ amountCents: 250000, hostedInvoiceUrl: null });
    expect(message).toContain("contact us directly");
    expect(message).not.toContain("http");
  });
});

describe("formatInvoiceList", () => {
  function invoice(overrides: Partial<InvoiceLookupResultItem> = {}): InvoiceLookupResultItem {
    return {
      id: "in_1",
      amountDueCents: 45000,
      status: "open",
      dueDate: null,
      overdue: false,
      description: "Q3 services",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/abc",
      ...overrides,
    };
  }

  it("says nothing owed rather than an empty/ambiguous response", () => {
    const { text, keyboard } = formatInvoiceList([]);
    expect(text).toMatch(/don't have any outstanding/i);
    expect(keyboard.inline_keyboard.flat()).toHaveLength(0);
  });

  it("adds a Pay button for an under-cap invoice", () => {
    const { keyboard } = formatInvoiceList([invoice({ id: "in_1", amountDueCents: 45000 })]);
    expect(keyboard.inline_keyboard.flat().some((b) => "callback_data" in b && b.callback_data === "pay:in_1")).toBe(true);
  });

  it("shows a handoff note instead of a Pay button for an at/above-cap invoice", () => {
    const { text, keyboard } = formatInvoiceList([invoice({ id: "in_2", amountDueCents: 250000 })]);
    expect(text).toContain("bot limit");
    expect(keyboard.inline_keyboard.flat().some((b) => "callback_data" in b && b.callback_data === "pay:in_2")).toBe(false);
  });
});

describe("formatPendingConfirmation", () => {
  it("includes Confirm and Cancel buttons keyed to the pending action's id", () => {
    const action = createPendingAction<"pay_invoice", ResolvedInvoicePaymentArgs>("pay_invoice", {
      invoiceId: "in_1",
      customerId: "cus_a",
      amountCents: 45000,
    });

    const { keyboard } = formatPendingConfirmation(action);
    const callbackData = keyboard.inline_keyboard.flat().map((b) => ("callback_data" in b ? b.callback_data : null));
    expect(callbackData).toContain(`confirm:${action.id}`);
    expect(callbackData).toContain(`cancel:${action.id}`);
  });
});

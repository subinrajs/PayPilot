import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import {
  cancelPendingAction,
  confirmPayInvoice,
  formatInvoiceList,
  formatPendingConfirmation,
  handleConversationalMessage,
  handleStart,
  handoffMessage,
  resolveConfirmablePendingAction,
  startResultMessage,
} from "../../src/telegram/bot.js";
import { getCustomerId, linkChat } from "../../src/telegram/session.js";
import { createPendingAction } from "../../src/agent/pending-action.js";
import { peekPendingAction, setPendingAction } from "../../src/agent/pending-action-store.js";
import type { ResolvedInvoicePaymentArgs } from "../../src/agent/tools/invoice-payment.js";
import type { InvoiceLookupResultItem } from "../../src/agent/tools/invoice-lookup.js";
import { asOpenAI, completionOf, createFakeOpenAI, toolCall } from "../support/fake-openai.js";
import { asStripe, createFakeStripe, fakeCustomer, fakeInvoice } from "../support/fake-stripe.js";

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

  it("refuses to cancel a pending action that belongs to a different customer, leaving it untouched", () => {
    const action = createPendingAction<"pay_invoice", ResolvedInvoicePaymentArgs>("pay_invoice", {
      invoiceId: "in_1",
      customerId: "cus_a",
      amountCents: 45000,
    });
    setPendingAction(action);

    expect(cancelPendingAction(action.id, "cus_b")).toBe("forbidden");
    // Unlike Phase 6's version, a forbidden attempt must not consume it — the rightful owner
    // (cus_a) can still act on it afterward.
    expect(cancelPendingAction(action.id, "cus_a")).toBe("cancelled");
  });

  it("reports not_found for an unknown or already-consumed id", () => {
    expect(cancelPendingAction("does-not-exist", "cus_a")).toBe("not_found");
  });

  it("reports not_found (not forbidden) for a non-pay_invoice id, leaving it untouched for its own surface", () => {
    // A web-side refund pending action shares the same global store — the bot must not be able
    // to affect it at all, and must not learn it exists either (not_found, not forbidden).
    const refundAction = createPendingAction("refund", { chargeId: "ch_1" });
    setPendingAction(refundAction);

    expect(cancelPendingAction(refundAction.id, "cus_a")).toBe("not_found");
    // Still there for routes/assistant.ts to consume — proves it wasn't touched.
    expect(peekPendingAction(refundAction.id)).not.toBeNull();
  });
});

describe("resolveConfirmablePendingAction — shared by both confirm: and cancel:", () => {
  it("resolves and consumes when the pending action is pay_invoice and belongs to this session", () => {
    const action = createPendingAction<"pay_invoice", ResolvedInvoicePaymentArgs>("pay_invoice", {
      invoiceId: "in_1",
      customerId: "cus_a",
      amountCents: 45000,
    });
    setPendingAction(action);

    const result = resolveConfirmablePendingAction(action.id, "cus_a");

    expect(result).toEqual({ kind: "ok", action });
    expect(peekPendingAction(action.id)).toBeNull(); // consumed
  });

  it("refuses a pending action that belongs to a different customer, leaving it untouched — this is the guardrail-auditor's Critical finding, now covered directly rather than only through cancelPendingAction", () => {
    const action = createPendingAction<"pay_invoice", ResolvedInvoicePaymentArgs>("pay_invoice", {
      invoiceId: "in_1",
      customerId: "cus_a",
      amountCents: 45000,
    });
    setPendingAction(action);

    expect(resolveConfirmablePendingAction(action.id, "cus_b")).toEqual({ kind: "forbidden" });
    // Untouched — cus_a can still resolve (and consume) it afterward.
    expect(resolveConfirmablePendingAction(action.id, "cus_a").kind).toBe("ok");
  });

  it("reports not_found (not forbidden) for a non-pay_invoice id, leaving it untouched", () => {
    const refundAction = createPendingAction("refund", { chargeId: "ch_1" });
    setPendingAction(refundAction);

    expect(resolveConfirmablePendingAction(refundAction.id, "cus_a")).toEqual({ kind: "not_found" });
    expect(peekPendingAction(refundAction.id)).not.toBeNull();
  });

  it("reports not_found for an unknown id", () => {
    expect(resolveConfirmablePendingAction("does-not-exist", "cus_a")).toEqual({ kind: "not_found" });
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
  it("renders the hosted invoice URL as a friendly HTML link, not a raw pasted URL", () => {
    // Sent with parse_mode: "HTML" by every ctx.reply call site — a raw URL in the text is easy
    // to mis-copy (the bug this was fixed from); an <a> tag gives Telegram a tappable link with
    // readable anchor text instead.
    const message = handoffMessage({ amountCents: 250000, hostedInvoiceUrl: "https://invoice.stripe.com/i/abc" });
    expect(message).toContain('<a href="https://invoice.stripe.com/i/abc">Pay this invoice</a>');
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
      createdAt: "2026-09-01T00:00:00.000Z",
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

  it("escapes HTML special characters in the invoice description — sent with parse_mode: HTML, and the owner can set this text to anything at invoice-creation time", () => {
    const { text } = formatInvoiceList([invoice({ description: "Consulting <10% off> & travel" })]);
    expect(text).toContain("Consulting &lt;10% off&gt; &amp; travel");
    expect(text).not.toContain("<10% off>");
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

describe("handleConversationalMessage — S12's LLM-based free-text handler", () => {
  it("returns the model's own reply when it makes no tool calls, with no structured card attached", async () => {
    const stripe = createFakeStripe();
    const openai = createFakeOpenAI();
    openai.chat.completions.create.mockResolvedValueOnce(completionOf({ content: "Hi! How can I help?" }));

    const { reply, messages } = await handleConversationalMessage(asStripe(stripe), asOpenAI(openai), "cus_a", [], "hello");

    expect(reply.text).toBe("Hi! How can I help?");
    expect(reply.invoiceList).toBeUndefined();
    expect(reply.pendingConfirmation).toBeUndefined();
    expect(reply.handoff).toBeUndefined();
    // Returned messages become next turn's history — must include this turn's user message.
    expect(messages).toContainEqual({ role: "user", content: "hello" });
  });

  it("renders get_my_invoices' result via formatInvoiceList — the SAME card /owe produces, not the model's own prose", async () => {
    const stripe = createFakeStripe();
    stripe.invoices.list.mockResolvedValueOnce({
      data: [fakeInvoice({ id: "in_1", customer: "cus_a", amount_due: 45000, status: "open", description: "Q3 services" })],
    });

    const openai = createFakeOpenAI();
    const call = toolCall("get_my_invoices", {});
    openai.chat.completions.create
      .mockResolvedValueOnce(completionOf({ tool_calls: [call] }))
      .mockResolvedValueOnce(completionOf({ content: "Here's what you owe." }));

    const { reply } = await handleConversationalMessage(asStripe(stripe), asOpenAI(openai), "cus_a", [], "what do I owe?");

    expect(reply.invoiceList).toBeDefined();
    const { text, keyboard } = formatInvoiceList([
      { id: "in_1", amountDueCents: 45000, status: "open", dueDate: null, overdue: false, description: "Q3 services", hostedInvoiceUrl: "https://invoice.stripe.com/i/fake", createdAt: expect.any(String) as unknown as string },
    ]);
    expect(reply.invoiceList!.text).toBe(text);
    expect(reply.invoiceList!.keyboard.inline_keyboard).toEqual(keyboard.inline_keyboard);
  });

  it("renders pay_invoice's pending action via formatPendingConfirmation — the SAME Confirm/Cancel card the pay: button callback produces", async () => {
    const stripe = createFakeStripe();
    stripe.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_1", customer: "cus_a", amount_due: 45000, paid: false, status: "open" }),
    );

    const openai = createFakeOpenAI();
    const call = toolCall("pay_invoice", { invoiceId: "in_1" });
    openai.chat.completions.create
      .mockResolvedValueOnce(completionOf({ tool_calls: [call] }))
      .mockResolvedValueOnce(completionOf({ content: "Sure, here's the confirmation." }));

    const { reply } = await handleConversationalMessage(asStripe(stripe), asOpenAI(openai), "cus_a", [], "pay that invoice");

    expect(reply.pendingConfirmation).toBeDefined();
    expect(reply.pendingConfirmation!.text).toContain("$450.00");
    const callbackData = reply.pendingConfirmation!.keyboard.inline_keyboard
      .flat()
      .map((b) => ("callback_data" in b ? b.callback_data : null));
    expect(callbackData.some((d) => d?.startsWith("confirm:"))).toBe(true);
    expect(callbackData.some((d) => d?.startsWith("cancel:"))).toBe(true);
  });

  it("renders a handoff result via handoffMessage when the invoice is at/above the cap", async () => {
    const stripe = createFakeStripe();
    stripe.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_1", customer: "cus_a", amount_due: 250000, paid: false, status: "open" }),
    );

    const openai = createFakeOpenAI();
    const call = toolCall("pay_invoice", { invoiceId: "in_1" });
    openai.chat.completions.create
      .mockResolvedValueOnce(completionOf({ tool_calls: [call] }))
      .mockResolvedValueOnce(completionOf({ content: "That one's above our bot limit." }));

    const { reply } = await handleConversationalMessage(asStripe(stripe), asOpenAI(openai), "cus_a", [], "pay the big one");

    expect(reply.handoff).toBeDefined();
    expect(reply.handoff).toContain("$2500.00");
    expect(reply.pendingConfirmation).toBeUndefined();
  });

  it("guardrail: an injected customerId in a mocked pay_invoice tool call is rejected by .strict() rather than honored", async () => {
    // Simulates an adversarial/malfunctioning model trying to smuggle a different customerId
    // through the tool-call arguments — pay_invoice's schema has no such field (see
    // invoice-payment.ts), so this must be rejected as a validation error, never silently
    // accepted or used to act on someone else's invoice.
    const stripe = createFakeStripe();
    const openai = createFakeOpenAI();
    const call = toolCall("pay_invoice", { invoiceId: "in_1", customerId: "cus_attacker" });
    openai.chat.completions.create
      .mockResolvedValueOnce(completionOf({ tool_calls: [call] }))
      .mockResolvedValueOnce(completionOf({ content: "Sorry, I couldn't process that." }));

    const { reply, messages } = await handleConversationalMessage(asStripe(stripe), asOpenAI(openai), "cus_bound", [], "pay it");

    expect(reply.pendingConfirmation).toBeUndefined();
    expect(reply.handoff).toBeUndefined();
    // Never even reached Stripe — the args failed schema validation before the handler's own logic ran.
    expect(stripe.invoices.retrieve).not.toHaveBeenCalled();

    const toolResultMessage = messages.find((m) => m.role === "tool");
    expect(JSON.parse((toolResultMessage as { content: string }).content)).toMatchObject({
      error: expect.stringContaining("Unrecognized key"),
    });
  });

  it("threads the given customerId through, not one from prior history or the tool args", async () => {
    const stripe = createFakeStripe();
    stripe.invoices.list.mockResolvedValueOnce({ data: [] });

    const openai = createFakeOpenAI();
    const call = toolCall("get_my_invoices", {});
    openai.chat.completions.create
      .mockResolvedValueOnce(completionOf({ tool_calls: [call] }))
      .mockResolvedValueOnce(completionOf({ content: "Nothing outstanding." }));

    await handleConversationalMessage(asStripe(stripe), asOpenAI(openai), "cus_specific", [], "what do I owe?");

    expect(stripe.invoices.list).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_specific" }));
  });

  it("does NOT re-surface a prior turn's stale tool result when the model doesn't call the tool again this turn — regression for a real bug where an already-paid invoice kept showing as owed", async () => {
    const stripe = createFakeStripe();
    const openai = createFakeOpenAI();

    // Turn 1: the model calls get_my_invoices and sees one open invoice.
    stripe.invoices.list.mockResolvedValueOnce({
      data: [fakeInvoice({ id: "in_stale", customer: "cus_a", amount_due: 50000, status: "open" })],
    });
    const firstCall = toolCall("get_my_invoices", {});
    openai.chat.completions.create
      .mockResolvedValueOnce(completionOf({ tool_calls: [firstCall] }))
      .mockResolvedValueOnce(completionOf({ content: "You owe $500." }));

    const first = await handleConversationalMessage(asStripe(stripe), asOpenAI(openai), "cus_a", [], "what do I owe?");
    expect(first.reply.invoiceList).toBeDefined();

    // Between turns, that invoice gets paid (e.g. via the bot's own Confirm button) — irrelevant
    // to this test's point, which is purely about turn 2 not re-narrating turn 1's stale result.

    // Turn 2: the model answers from its own (wrong, stale) belief WITHOUT calling the tool again
    // — this is the real, observed failure mode (a documented prompt-adherence gap elsewhere in
    // this project), not something this fix can force the model to avoid. What this fix guarantees
    // is that the DETERMINISTIC card doesn't also re-render turn 1's now-stale result when that
    // happens.
    openai.chat.completions.create.mockResolvedValueOnce(completionOf({ content: "You still owe $500, due soon." }));

    const second = await handleConversationalMessage(asStripe(stripe), asOpenAI(openai), "cus_a", first.messages, "what do I owe?");

    expect(second.reply.invoiceList).toBeUndefined();
  });
});

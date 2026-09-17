import { describe, expect, it } from "vitest";
import { draftPaymentReminders } from "../../../src/agent/tools/payment-reminders.js";

function reminder(overrides: Partial<Parameters<typeof draftPaymentReminders>[0]["reminders"][number]> = {}) {
  return {
    targetId: "in_1",
    targetType: "overdue_invoice" as const,
    customerName: "Acme Corp",
    customerEmail: "billing@acme.example",
    amountCents: 25000,
    invoiceUrl: "https://invoice.stripe.com/i/acct_1/test_abc",
    subject: "Friendly reminder: invoice payment due",
    body: "Hi Acme Corp, just a reminder that your invoice for $250.00 is now overdue.",
    ...overrides,
  };
}

describe("draftPaymentReminders", () => {
  it("validates and echoes the drafted reminders back unchanged", async () => {
    const result = await draftPaymentReminders({ reminders: [reminder()] });

    expect(result.reminders).toEqual([reminder()]);
  });

  it("accepts multiple reminders in one call — this is what makes a single 'Send all' meaningful", async () => {
    const result = await draftPaymentReminders({
      reminders: [
        reminder({ targetId: "in_1", customerName: "Acme Corp" }),
        reminder({ targetId: "ch_1", targetType: "failed_payment", customerName: "John Smith" }),
      ],
    });

    expect(result.reminders).toHaveLength(2);
    expect(result.reminders[1].targetType).toBe("failed_payment");
  });

  it("allows a null customerEmail — the model is expected to draft for these too (never fabricating an email), letting the owner decide whether to send", async () => {
    const result = await draftPaymentReminders({ reminders: [reminder({ customerEmail: null })] });

    expect(result.reminders[0].customerEmail).toBeNull();
  });

  it("passes invoiceUrl through unchanged, including a null when the item has none — never fabricated by this tool", async () => {
    const withUrl = await draftPaymentReminders({ reminders: [reminder({ invoiceUrl: "https://invoice.stripe.com/i/x" })] });
    expect(withUrl.reminders[0].invoiceUrl).toBe("https://invoice.stripe.com/i/x");

    const withoutUrl = await draftPaymentReminders({ reminders: [reminder({ invoiceUrl: null })] });
    expect(withoutUrl.reminders[0].invoiceUrl).toBeNull();
  });

  it("rejects an empty reminders array rather than silently no-op-ing", async () => {
    await expect(draftPaymentReminders({ reminders: [] })).rejects.toThrow();
  });

  it("rejects a reminder missing required text (empty subject/body)", async () => {
    await expect(draftPaymentReminders({ reminders: [reminder({ subject: "" })] })).rejects.toThrow();
    await expect(draftPaymentReminders({ reminders: [reminder({ body: "" })] })).rejects.toThrow();
  });

  it("rejects an unrecognized extra field rather than silently ignoring it", async () => {
    await expect(
      draftPaymentReminders({ reminders: [{ ...reminder(), extra: "nope" }] } as never),
    ).rejects.toThrow();
  });

  describe("stripping a URL the model embedded in free text despite being told not to", () => {
    // Regression coverage: live testing showed the model still wrote a raw URL into the body even
    // with an explicit "never do this, invoiceUrl is a separate field" instruction — the same
    // unreliable-prompt-compliance pattern already fixed deterministically for reply duplication
    // (routes/assistant.ts). This guarantees it can't recur regardless of model behavior.
    it("strips a bare URL out of the body", async () => {
      const result = await draftPaymentReminders({
        reminders: [reminder({ body: "Please pay here: https://invoice.stripe.com/i/acct_1/test_abc. Thank you!" })],
      });

      expect(result.reminders[0].body).not.toContain("https://");
      expect(result.reminders[0].body).toContain("Please pay here:");
      expect(result.reminders[0].body).toContain("Thank you!");
    });

    it("strips a markdown-style [text](url) link, keeping the link text", async () => {
      const result = await draftPaymentReminders({
        reminders: [reminder({ body: "You can pay via [this link](https://invoice.stripe.com/i/acct_1/test_abc) today." })],
      });

      expect(result.reminders[0].body).not.toContain("https://");
      expect(result.reminders[0].body).not.toContain("[");
      expect(result.reminders[0].body).toContain("this link");
    });

    it("strips a URL from the subject too, defensively", async () => {
      const result = await draftPaymentReminders({
        reminders: [reminder({ subject: "Pay now: https://invoice.stripe.com/i/acct_1/test_abc" })],
      });

      expect(result.reminders[0].subject).not.toContain("https://");
    });

    it("leaves body/subject with no URL completely untouched", async () => {
      const result = await draftPaymentReminders({ reminders: [reminder()] });
      expect(result.reminders[0]).toEqual(reminder());
    });

    it("falls back to a generic line rather than leaving an empty body when the text was nothing but a URL", async () => {
      const result = await draftPaymentReminders({
        reminders: [reminder({ body: "https://invoice.stripe.com/i/acct_1/test_abc" })],
      });

      expect(result.reminders[0].body.length).toBeGreaterThan(0);
      expect(result.reminders[0].body).not.toContain("https://");
    });
  });
});

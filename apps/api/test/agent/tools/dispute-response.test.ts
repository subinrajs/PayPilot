import { describe, expect, it } from "vitest";
import {
  getDisputeEvidence,
  draftDisputeResponse,
  updateDisputeResponse,
  proposeSubmitDisputeEvidence,
  executeSubmitDisputeEvidence,
  proposeDeclineDispute,
  executeDeclineDispute,
} from "../../../src/agent/tools/dispute-response.js";
import {
  asStripe,
  createFakeStripe,
  fakeCharge,
  fakeCustomer,
  fakeDispute,
  fakeDisputeEvidence,
} from "../../support/fake-stripe.js";

describe("getDisputeEvidence", () => {
  it("auto-fills real customer facts from the charge and flags the rest as missing for 'product not received'", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(
      fakeDispute({
        id: "dp_1",
        reason: "product_not_received",
        charge: fakeCharge({ id: "ch_1", billing_details: { name: "Maya Rodriguez", email: "maya@example.com", phone: null, address: null } }) as never,
      }),
    );

    const result = await getDisputeEvidence(asStripe(fake), { disputeId: "dp_1" });

    if (result.kind !== "found") throw new Error(`expected found, got ${result.kind}`);
    expect(result.customerName).toBe("Maya Rodriguez");
    const byKey = Object.fromEntries(result.evidenceFields.map((f) => [f.key, f]));
    expect(byKey.customerName).toEqual({ key: "customerName", label: "Customer name on file", status: "found", value: "Maya Rodriguez" });
    expect(byKey.customerEmailAddress.status).toBe("found");
    expect(byKey.shippingCarrier).toEqual({ key: "shippingCarrier", label: "Shipping carrier", status: "missing", value: null });
    expect(byKey.shippingTrackingNumber.status).toBe("missing");
  });

  it("reports not_found for an unresolvable dispute id", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockRejectedValueOnce(new Error("No such dispute"));

    const result = await getDisputeEvidence(asStripe(fake), { disputeId: "dp_missing" });

    expect(result).toEqual({ kind: "not_found", reason: "No dispute found with id dp_missing" });
  });

  it("auto-finds a genuinely matching prior charge for a 'duplicate' dispute", async () => {
    const fake = createFakeStripe();
    const disputedCharge = fakeCharge({ id: "ch_2", customer: "cus_acme", amount: 5000, created: Math.floor(Date.now() / 1000) });
    fake.disputes.retrieve.mockResolvedValueOnce(fakeDispute({ id: "dp_2", reason: "duplicate", charge: disputedCharge as never }));
    fake.charges.list.mockResolvedValueOnce({
      data: [disputedCharge, fakeCharge({ id: "ch_1", customer: "cus_acme", amount: 5000, status: "succeeded" })],
    });

    const result = await getDisputeEvidence(asStripe(fake), { disputeId: "dp_2" });

    if (result.kind !== "found") throw new Error(`expected found, got ${result.kind}`);
    const duplicateField = result.evidenceFields.find((f) => f.key === "duplicateChargeId");
    expect(duplicateField).toEqual({ key: "duplicateChargeId", label: "Matching prior charge", status: "found", value: "ch_1" });
  });

  it("reads billing address for a 'fraudulent' dispute when the charge has one on file", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(
      fakeDispute({
        id: "dp_3",
        reason: "fraudulent",
        charge: fakeCharge({
          id: "ch_3",
          billing_details: {
            name: "John Smith",
            email: null,
            phone: null,
            address: { line1: "1 Main St", line2: null, city: "Springfield", state: "IL", postal_code: "62704", country: "US" },
          },
        }) as never,
      }),
    );

    const result = await getDisputeEvidence(asStripe(fake), { disputeId: "dp_3" });

    if (result.kind !== "found") throw new Error(`expected found, got ${result.kind}`);
    const billingAddress = result.evidenceFields.find((f) => f.key === "billingAddress");
    expect(billingAddress?.status).toBe("found");
    expect(billingAddress?.value).toContain("Springfield");
  });

  it("assesses missing evidence with a warning, and always includes the no-guarantee disclaimer", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(
      fakeDispute({ id: "dp_4", reason: "product_not_received", charge: fakeCharge({ id: "ch_4" }) as never }),
    );

    const result = await getDisputeEvidence(asStripe(fake), { disputeId: "dp_4" });

    if (result.kind !== "found") throw new Error(`expected found, got ${result.kind}`);
    expect(result.assessment.some((f) => f.severity === "warning" && f.label.includes("missing"))).toBe(true);
    expect(result.assessment.some((f) => f.severity === "info" && f.label.includes("can't guarantee"))).toBe(true);
  });

  it("reports 'all evidence on file' when every relevant field for the reason is already staged", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(
      fakeDispute({
        id: "dp_5",
        reason: "duplicate",
        charge: fakeCharge({ id: "ch_5", customer: "cus_x" }) as never,
        evidence: fakeDisputeEvidence({
          duplicate_charge_id: "ch_prev",
          duplicate_charge_explanation: "Same order, charged twice by mistake",
          uncategorized_text: "We refunded the duplicate charge already.",
        }),
      }),
    );

    const result = await getDisputeEvidence(asStripe(fake), { disputeId: "dp_5" });

    if (result.kind !== "found") throw new Error(`expected found, got ${result.kind}`);
    expect(result.assessment).toContainEqual({ severity: "ok", label: "All commonly-requested evidence for this dispute reason is on file" });
  });
});

describe("draftDisputeResponse", () => {
  it("stages evidence with submit:false, auto-filling real facts alongside the model's narrative", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(
      fakeDispute({
        id: "dp_1",
        reason: "product_not_received",
        charge: fakeCharge({ id: "ch_1", billing_details: { name: "Maya Rodriguez", email: "maya@example.com", phone: null, address: null } }) as never,
      }),
    );
    const staged = fakeDispute({
      id: "dp_1",
      reason: "product_not_received",
      evidence: fakeDisputeEvidence({
        customer_name: "Maya Rodriguez",
        customer_email_address: "maya@example.com",
        shipping_carrier: "UPS",
        shipping_tracking_number: "1Z999",
        uncategorized_text: "The order was delivered per the tracking information.",
      }),
      evidence_details: { due_by: null, has_evidence: true, past_due: false, submission_count: 0 } as never,
    });
    fake.disputes.update.mockResolvedValueOnce(staged);

    const result = await draftDisputeResponse(asStripe(fake), {
      disputeId: "dp_1",
      narrative: "The order was delivered per the tracking information.",
      shippingCarrier: "UPS",
      shippingTrackingNumber: "1Z999",
    });

    expect(fake.disputes.update).toHaveBeenCalledWith(
      "dp_1",
      expect.objectContaining({
        submit: false,
        evidence: expect.objectContaining({
          uncategorized_text: "The order was delivered per the tracking information.",
          shipping_carrier: "UPS",
          shipping_tracking_number: "1Z999",
          customer_name: "Maya Rodriguez",
          customer_email_address: "maya@example.com",
        }),
      }),
    );

    if (result.kind !== "found") throw new Error(`expected found, got ${result.kind}`);
    expect(result.staged).toBe(true);
    expect(result.narrative).toBe("The order was delivered per the tracking information.");
  });

  it("reports not_found for an unresolvable dispute id", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockRejectedValueOnce(new Error("No such dispute"));

    const result = await draftDisputeResponse(asStripe(fake), { disputeId: "dp_missing", narrative: "Explanation." });

    expect(result).toEqual({ kind: "not_found", reason: "No dispute found with id dp_missing" });
    expect(fake.disputes.update).not.toHaveBeenCalled();
  });

  it("refuses to stage evidence on a dispute that's no longer awaiting a response", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(fakeDispute({ id: "dp_1", status: "won", charge: fakeCharge() as never }));

    const result = await draftDisputeResponse(asStripe(fake), { disputeId: "dp_1", narrative: "Explanation." });

    expect(result).toEqual({ kind: "not_found", reason: "Dispute dp_1 is no longer awaiting a response (status: won)" });
    expect(fake.disputes.update).not.toHaveBeenCalled();
  });

  it("never sends a value for an evidence field the model didn't actually supply", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(
      fakeDispute({ id: "dp_1", reason: "product_not_received", charge: fakeCharge({ id: "ch_1" }) as never }),
    );
    fake.disputes.update.mockResolvedValueOnce(fakeDispute({ id: "dp_1" }));

    await draftDisputeResponse(asStripe(fake), { disputeId: "dp_1", narrative: "Explanation." });

    const call = fake.disputes.update.mock.calls[0][1] as { evidence: Record<string, unknown> };
    expect(call.evidence.shipping_carrier).toBeUndefined();
    expect(call.evidence.shipping_tracking_number).toBeUndefined();
  });
});

describe("updateDisputeResponse", () => {
  it("only re-stages the fields actually passed", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(
      fakeDispute({ id: "dp_1", reason: "product_not_received", charge: fakeCharge({ id: "ch_1" }) as never }),
    );
    fake.disputes.update.mockResolvedValueOnce(fakeDispute({ id: "dp_1" }));

    await updateDisputeResponse(asStripe(fake), { disputeId: "dp_1", shippingTrackingNumber: "1Z000" });

    const call = fake.disputes.update.mock.calls[0][1] as { evidence: Record<string, unknown>; submit: boolean };
    expect(call.evidence.shipping_tracking_number).toBe("1Z000");
    expect(call.evidence.uncategorized_text).toBeUndefined();
    expect(call.submit).toBe(false);
  });
});

describe("proposeSubmitDisputeEvidence / executeSubmitDisputeEvidence", () => {
  it("proposes a pending action describing the dispute", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(
      fakeDispute({ id: "dp_1", reason: "product_not_received", amount: 12400, charge: fakeCharge({ id: "ch_1", billing_details: { name: "John Smith", email: null, phone: null, address: null } }) as never }),
    );

    const result = await proposeSubmitDisputeEvidence(asStripe(fake), { disputeId: "dp_1" });

    expect(result.kind).toBe("pending");
    if (result.kind !== "pending") throw new Error("expected pending");
    expect(result.action.tool).toBe("submit_dispute_evidence");
    expect(result.action.arguments).toEqual({ disputeId: "dp_1", customerName: "John Smith", amountCents: 12400, reason: "product_not_received" });
  });

  it("reports not_found rather than proposing to submit a dispute that's already resolved", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(fakeDispute({ id: "dp_1", status: "lost", charge: fakeCharge() as never }));

    const result = await proposeSubmitDisputeEvidence(asStripe(fake), { disputeId: "dp_1" });

    expect(result).toEqual({ kind: "not_found", reason: "Dispute dp_1 is no longer awaiting a response" });
  });

  it("submits with just submit:true — no need to resend already-staged evidence", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(fakeDispute({ id: "dp_1", status: "needs_response" }));
    fake.disputes.update.mockResolvedValueOnce(fakeDispute({ id: "dp_1", status: "under_review" }));

    await executeSubmitDisputeEvidence(asStripe(fake), { disputeId: "dp_1", customerName: "John Smith", amountCents: 12400, reason: "product_not_received" });

    expect(fake.disputes.update).toHaveBeenCalledWith("dp_1", { submit: true });
  });

  it("rejects submission if the dispute was resolved elsewhere since it was proposed", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(fakeDispute({ id: "dp_1", status: "won" }));

    await expect(
      executeSubmitDisputeEvidence(asStripe(fake), { disputeId: "dp_1", customerName: "John Smith", amountCents: 12400, reason: "product_not_received" }),
    ).rejects.toThrow(/no longer awaiting a response/);
    expect(fake.disputes.update).not.toHaveBeenCalled();
  });
});

describe("proposeDeclineDispute / executeDeclineDispute", () => {
  it("proposes a pending action describing the dispute", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(
      fakeDispute({ id: "dp_1", reason: "fraudulent", amount: 8000, charge: fakeCharge({ id: "ch_1", billing_details: { name: "Acme Corp", email: null, phone: null, address: null } }) as never }),
    );

    const result = await proposeDeclineDispute(asStripe(fake), { disputeId: "dp_1" });

    expect(result.kind).toBe("pending");
    if (result.kind !== "pending") throw new Error("expected pending");
    expect(result.action.tool).toBe("decline_dispute");
    expect(result.action.arguments).toEqual({ disputeId: "dp_1", customerName: "Acme Corp", amountCents: 8000, reason: "fraudulent" });
  });

  it("closes the dispute on execute", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(fakeDispute({ id: "dp_1", status: "needs_response" }));
    fake.disputes.close.mockResolvedValueOnce(fakeDispute({ id: "dp_1", status: "lost" }));

    const result = await executeDeclineDispute(asStripe(fake), { disputeId: "dp_1", customerName: "Acme Corp", amountCents: 8000, reason: "fraudulent" });

    expect(fake.disputes.close).toHaveBeenCalledWith("dp_1");
    expect(result.status).toBe("lost");
  });

  it("rejects declining a dispute that's already been resolved elsewhere", async () => {
    const fake = createFakeStripe();
    fake.disputes.retrieve.mockResolvedValueOnce(fakeDispute({ id: "dp_1", status: "won" }));

    await expect(
      executeDeclineDispute(asStripe(fake), { disputeId: "dp_1", customerName: "Acme Corp", amountCents: 8000, reason: "fraudulent" }),
    ).rejects.toThrow(/no longer awaiting a response/);
    expect(fake.disputes.close).not.toHaveBeenCalled();
  });
});

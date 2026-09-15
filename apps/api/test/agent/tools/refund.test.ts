import { describe, expect, it } from "vitest";
import { executeRefund, proposeRefund } from "../../../src/agent/tools/refund.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCharge, fakeCustomer } from "../../support/fake-stripe.js";

describe("proposeRefund", () => {
  it("returns a pending action when exactly one customer and one refundable charge match", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([fakeCustomer({ id: "cus_maya", name: "Maya Rodriguez" })]),
    );
    fake.charges.list.mockResolvedValueOnce({
      data: [fakeCharge({ id: "ch_1", customer: "cus_maya", amount: 8000, status: "succeeded", refunded: false })],
    });

    const result = await proposeRefund(asStripe(fake), { customerReference: "Maya" });

    expect(result.kind).toBe("pending");
    if (result.kind === "pending") {
      expect(result.action.tool).toBe("refund");
      expect(result.action.arguments).toEqual({
        chargeId: "ch_1",
        customerId: "cus_maya",
        customerName: "Maya Rodriguez",
        amountCents: 8000,
      });
    }
  });

  it("reports not_found when no customer matches the reference", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([]));

    const result = await proposeRefund(asStripe(fake), { customerReference: "Nobody" });

    expect(result).toEqual({ kind: "not_found", reason: 'No customer matching "Nobody"' });
  });

  it("asks for clarification when multiple customers match", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([
        fakeCustomer({ id: "cus_1", name: "John Smith" }),
        fakeCustomer({ id: "cus_2", name: "John Doe" }),
      ]),
    );

    const result = await proposeRefund(asStripe(fake), { customerReference: "John" });

    expect(result.kind).toBe("ambiguous_customer");
    if (result.kind === "ambiguous_customer") {
      expect(result.candidates).toHaveLength(2);
    }
  });

  it("asks for clarification when multiple refundable charges match and no reference narrows it", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([fakeCustomer({ id: "cus_maya", name: "Maya Rodriguez" })]),
    );
    fake.charges.list.mockResolvedValueOnce({
      data: [
        fakeCharge({ id: "ch_1", customer: "cus_maya", amount: 8000 }),
        fakeCharge({ id: "ch_2", customer: "cus_maya", amount: 6000 }),
      ],
    });

    const result = await proposeRefund(asStripe(fake), { customerReference: "Maya" });

    expect(result.kind).toBe("ambiguous_charge");
  });

  it("narrows to the most recent charge when the reference says 'last'", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([fakeCustomer({ id: "cus_maya", name: "Maya Rodriguez" })]),
    );
    fake.charges.list.mockResolvedValueOnce({
      data: [
        fakeCharge({ id: "ch_newest", customer: "cus_maya", amount: 7000 }),
        fakeCharge({ id: "ch_older", customer: "cus_maya", amount: 8000 }),
      ],
    });

    const result = await proposeRefund(asStripe(fake), {
      customerReference: "Maya",
      paymentReference: "last",
    });

    expect(result.kind).toBe("pending");
    if (result.kind === "pending") {
      expect(result.action.arguments.chargeId).toBe("ch_newest");
    }
  });

  it("excludes already-refunded and failed charges from candidates", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([fakeCustomer({ id: "cus_maya", name: "Maya Rodriguez" })]),
    );
    fake.charges.list.mockResolvedValueOnce({
      data: [
        fakeCharge({ id: "ch_refunded", customer: "cus_maya", refunded: true }),
        fakeCharge({ id: "ch_failed", customer: "cus_maya", status: "failed" }),
      ],
    });

    const result = await proposeRefund(asStripe(fake), { customerReference: "Maya" });

    expect(result.kind).toBe("not_found");
  });
});

describe("executeRefund", () => {
  it("re-validates the charge is still refundable before calling Stripe, refunding the confirmed amount explicitly", async () => {
    const fake = createFakeStripe();
    fake.charges.retrieve.mockResolvedValueOnce(
      fakeCharge({ id: "ch_1", customer: "cus_maya", amount: 8000, status: "succeeded", refunded: false, amount_refunded: 0 }),
    );
    fake.refunds.create.mockResolvedValueOnce({ id: "re_1" });

    const result = await executeRefund(asStripe(fake), {
      chargeId: "ch_1",
      customerId: "cus_maya",
      customerName: "Maya Rodriguez",
      amountCents: 8000,
    });

    expect(fake.refunds.create).toHaveBeenCalledWith({ charge: "ch_1", amount: 8000 });
    expect(result).toEqual({ id: "re_1" });
  });

  it("rejects a pending action whose charge was already fully refunded since it was proposed", async () => {
    const fake = createFakeStripe();
    fake.charges.retrieve.mockResolvedValueOnce(
      fakeCharge({ id: "ch_1", customer: "cus_maya", status: "succeeded", refunded: true }),
    );

    await expect(
      executeRefund(asStripe(fake), {
        chargeId: "ch_1",
        customerId: "cus_maya",
        customerName: "Maya Rodriguez",
        amountCents: 8000,
      }),
    ).rejects.toThrow(/no longer refundable/);
    expect(fake.refunds.create).not.toHaveBeenCalled();
  });

  it("rejects a pending action whose charge was partially refunded since it was proposed", async () => {
    const fake = createFakeStripe();
    fake.charges.retrieve.mockResolvedValueOnce(
      fakeCharge({
        id: "ch_1",
        customer: "cus_maya",
        amount: 8000,
        status: "succeeded",
        refunded: false,
        amount_refunded: 2000,
      }),
    );

    await expect(
      executeRefund(asStripe(fake), {
        chargeId: "ch_1",
        customerId: "cus_maya",
        customerName: "Maya Rodriguez",
        amountCents: 8000,
      }),
    ).rejects.toThrow(/partially refunded/);
    expect(fake.refunds.create).not.toHaveBeenCalled();
  });

  it("rejects a charge that no longer belongs to the confirmed customer", async () => {
    const fake = createFakeStripe();
    fake.charges.retrieve.mockResolvedValueOnce(fakeCharge({ id: "ch_1", customer: "cus_other", amount: 8000 }));

    await expect(
      executeRefund(asStripe(fake), {
        chargeId: "ch_1",
        customerId: "cus_maya",
        customerName: "Maya Rodriguez",
        amountCents: 8000,
      }),
    ).rejects.toThrow();
    expect(fake.refunds.create).not.toHaveBeenCalled();
  });

  it("rejects if the charge's amount no longer matches what was confirmed", async () => {
    const fake = createFakeStripe();
    fake.charges.retrieve.mockResolvedValueOnce(fakeCharge({ id: "ch_1", customer: "cus_maya", amount: 9000 }));

    await expect(
      executeRefund(asStripe(fake), {
        chargeId: "ch_1",
        customerId: "cus_maya",
        customerName: "Maya Rodriguez",
        amountCents: 8000,
      }),
    ).rejects.toThrow(/no longer matches/);
    expect(fake.refunds.create).not.toHaveBeenCalled();
  });
});

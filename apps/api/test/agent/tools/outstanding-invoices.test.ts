import { describe, expect, it } from "vitest";
import { getOutstandingInvoices } from "../../../src/agent/tools/outstanding-invoices.js";
import { asStripe, asyncIterableList, createFakeStripe, fakeCustomer, fakeInvoice } from "../../support/fake-stripe.js";

describe("getOutstandingInvoices", () => {
  it("aggregates open invoices across every customer, tagging each with its customer's name", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(
      asyncIterableList([fakeCustomer({ id: "cus_a", name: "Acme Corp" }), fakeCustomer({ id: "cus_b", name: "Maya Rodriguez" })]),
    );
    fake.invoices.list
      .mockResolvedValueOnce({
        data: [fakeInvoice({ id: "in_1", customer: "cus_a", amount_due: 15000, status: "open", due_date: null })],
      })
      .mockResolvedValueOnce({
        data: [fakeInvoice({ id: "in_2", customer: "cus_b", amount_due: 5000, status: "paid", due_date: null })],
      });

    const result = await getOutstandingInvoices(asStripe(fake), {});

    // Defaults to status "open" — the paid invoice for Maya must not appear.
    expect(result.status).toBe("open");
    expect(result.count).toBe(1);
    expect(result.totalCents).toBe(15000);
    expect(result.invoices).toEqual([
      expect.objectContaining({ id: "in_1", customerName: "Acme Corp", amountDueCents: 15000, status: "open" }),
    ]);
  });

  it("reports zero rather than fabricating when nothing is outstanding", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([fakeCustomer({ id: "cus_a" })]));
    fake.invoices.list.mockResolvedValueOnce({ data: [] });

    const result = await getOutstandingInvoices(asStripe(fake), {});

    expect(result).toEqual({ status: "open", count: 0, totalCents: 0, invoices: [] });
  });

  it("scans customers attached to a test clock too, not just the plain customer list", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([]));
    fake.testHelpers.testClocks.list.mockReturnValueOnce(asyncIterableList([{ id: "clock_1" }] as never));
    fake.customers.list.mockReturnValueOnce(asyncIterableList([fakeCustomer({ id: "cus_clocked", name: "Clocked Co" })]));
    fake.invoices.list.mockResolvedValueOnce({
      data: [fakeInvoice({ id: "in_3", customer: "cus_clocked", amount_due: 8000, status: "open", due_date: null })],
    });

    const result = await getOutstandingInvoices(asStripe(fake), {});

    expect(result.count).toBe(1);
    expect(result.invoices[0].customerName).toBe("Clocked Co");
  });

  it("respects an explicit status filter, e.g. narrowing to only overdue invoices", async () => {
    const fake = createFakeStripe();
    fake.customers.list.mockReturnValueOnce(asyncIterableList([fakeCustomer({ id: "cus_a", name: "Acme Corp" })]));
    fake.invoices.list.mockResolvedValueOnce({
      data: [
        fakeInvoice({ id: "in_1", customer: "cus_a", amount_due: 15000, status: "open", due_date: pastDueDate() }),
        fakeInvoice({ id: "in_2", customer: "cus_a", amount_due: 5000, status: "open", due_date: futureDueDate() }),
      ],
    });

    const result = await getOutstandingInvoices(asStripe(fake), { status: "overdue" });

    expect(result.status).toBe("overdue");
    expect(result.count).toBe(1);
    expect(result.invoices[0].id).toBe("in_1");
  });
});

function pastDueDate(): number {
  return Math.floor((Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000);
}

function futureDueDate(): number {
  return Math.floor((Date.now() + 10 * 24 * 60 * 60 * 1000) / 1000);
}

import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { buildCustomerToolRegistry } from "../../src/telegram/tool-registry.js";
import type { InvoiceLookupResult } from "../../src/agent/tools/invoice-lookup.js";
import type { ProposeInvoicePaymentResult } from "../../src/agent/tools/invoice-payment.js";
import { asStripe, createFakeStripe, fakeInvoice } from "../support/fake-stripe.js";

describe("buildCustomerToolRegistry", () => {
  it("registers exactly get_my_invoices and pay_invoice — never any owner-only tool", () => {
    const registry = buildCustomerToolRegistry("cus_a");
    expect(registry.map((tool) => tool.name)).toEqual(["get_my_invoices", "pay_invoice"]);
  });

  it("exposes no customerId property on either tool's schema — the model has no field to set it through", () => {
    const registry = buildCustomerToolRegistry("cus_a");
    for (const tool of registry) {
      const schema = zodToJsonSchema(tool.parametersSchema, { target: "jsonSchema7" }) as {
        properties?: Record<string, unknown>;
      };
      expect(schema.properties ?? {}).not.toHaveProperty("customerId");
    }
  });

  it("get_my_invoices is bound to the given customerId — the underlying Stripe list call is scoped to it, not to any args field", async () => {
    const fake = createFakeStripe();
    fake.invoices.list.mockResolvedValueOnce({ data: [fakeInvoice({ id: "in_1", customer: "cus_bound" })] });

    const registry = buildCustomerToolRegistry("cus_bound");
    const tool = registry.find((t) => t.name === "get_my_invoices")!;

    const result = (await tool.handler(asStripe(fake), {})) as InvoiceLookupResult;

    expect(result.invoices.map((i) => i.id)).toEqual(["in_1"]);
    expect(fake.invoices.list).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_bound" }));
  });

  it("pay_invoice is bound to the given customerId — proposing payment for an invoice owned by a different customer is refused as not_found", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(fakeInvoice({ id: "in_1", customer: "cus_other", amount_due: 5000 }));

    const registry = buildCustomerToolRegistry("cus_bound");
    const tool = registry.find((t) => t.name === "pay_invoice")!;

    const result = (await tool.handler(asStripe(fake), { invoiceId: "in_1" })) as ProposeInvoicePaymentResult;

    expect(result.kind).toBe("not_found");
  });

  it("pay_invoice proposes a pending action scoped to the bound customerId when the invoice is genuinely owned by it", async () => {
    const fake = createFakeStripe();
    fake.invoices.retrieve.mockResolvedValueOnce(
      fakeInvoice({ id: "in_1", customer: "cus_bound", amount_due: 5000, paid: false, status: "open" }),
    );

    const registry = buildCustomerToolRegistry("cus_bound");
    const tool = registry.find((t) => t.name === "pay_invoice")!;

    const result = (await tool.handler(asStripe(fake), { invoiceId: "in_1" })) as ProposeInvoicePaymentResult;

    expect(result.kind).toBe("pending");
    if (result.kind === "pending") {
      expect(result.action.arguments).toMatchObject({ invoiceId: "in_1", customerId: "cus_bound", amountCents: 5000 });
    }
  });
});

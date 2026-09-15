import { describe, expect, it } from "vitest";
import { TOOL_REGISTRY, toolDefinitionsForOpenAI } from "../../src/agent/tool-registry.js";

describe("tool-registry", () => {
  it("registers exactly the 5 owner tools — never Telegram-scoped invoice-payment", () => {
    const names = TOOL_REGISTRY.map((tool) => tool.name);
    expect(names).toEqual([
      "get_daily_summary",
      "get_revenue_comparison",
      "propose_refund",
      "propose_invoice_creation",
      "get_customer_invoices",
    ]);
  });

  it("produces OpenAI-valid JSON Schema, not OpenAPI's boolean-exclusiveMinimum dialect", () => {
    // Regression test: zodToJsonSchema with target "openApi3" renders z.number().positive() as
    // `exclusiveMinimum: true` (a boolean) rather than a numeric bound — OpenAI's function-
    // calling schema validator rejects that outright ("True is not of type 'number'"), which
    // broke every real request until this was caught in manual end-to-end verification.
    const definitions = toolDefinitionsForOpenAI();
    const invoiceCreation = definitions.find((d) => d.function.name === "propose_invoice_creation");
    expect(invoiceCreation).toBeDefined();

    const json = JSON.stringify(invoiceCreation!.function.parameters);
    expect(json).not.toContain('"exclusiveMinimum":true');

    const params = invoiceCreation!.function.parameters as {
      properties: { amountCents: { exclusiveMinimum?: unknown } };
    };
    expect(typeof params.properties.amountCents.exclusiveMinimum).toBe("number");
  });
});

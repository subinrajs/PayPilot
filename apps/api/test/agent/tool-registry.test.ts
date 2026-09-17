import { describe, expect, it } from "vitest";
import { TOOL_REGISTRY, toolDefinitionsForOpenAI } from "../../src/agent/tool-registry.js";

describe("tool-registry", () => {
  it("registers exactly the 10 owner tools — never Telegram-scoped invoice-payment", () => {
    const names = TOOL_REGISTRY.map((tool) => tool.name);
    expect(names).toEqual([
      "get_daily_summary",
      "get_revenue_comparison",
      "propose_refund",
      "create_invoice_draft",
      "update_invoice_draft",
      "discard_invoice_draft",
      "send_invoice",
      "get_customer_invoices",
      "get_refunds",
      "get_outstanding_invoices",
    ]);
  });

  it("produces OpenAI-valid JSON Schema, not OpenAPI's boolean-exclusiveMinimum dialect", () => {
    // Regression test: zodToJsonSchema with target "openApi3" renders z.number().positive() as
    // `exclusiveMinimum: true` (a boolean) rather than a numeric bound — OpenAI's function-
    // calling schema validator rejects that outright ("True is not of type 'number'"), which
    // broke every real request until this was caught in manual end-to-end verification.
    const definitions = toolDefinitionsForOpenAI();
    const createDraft = definitions.find((d) => d.function.name === "create_invoice_draft");
    expect(createDraft).toBeDefined();

    const json = JSON.stringify(createDraft!.function.parameters);
    expect(json).not.toContain('"exclusiveMinimum":true');

    const params = createDraft!.function.parameters as {
      properties: { items: { items: { properties: { quantity: { exclusiveMinimum?: unknown } } } } };
    };
    expect(typeof params.properties.items.items.properties.quantity.exclusiveMinimum).toBe("number");
  });
});

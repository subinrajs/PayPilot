import { describe, expect, it } from "vitest";
import { z } from "zod";
import { findTool, TOOL_REGISTRY, toolDefinitionsForOpenAI, type ToolRegistryEntry } from "../../src/agent/tool-registry.js";

describe("tool-registry", () => {
  it("registers exactly the 20 owner tools — never Telegram-scoped invoice-payment", () => {
    const names = TOOL_REGISTRY.map((tool) => tool.name);
    expect(names).toEqual([
      "get_daily_summary",
      "get_revenue_comparison",
      "propose_refund",
      "create_invoice_draft",
      "update_invoice_draft",
      "discard_invoice_draft",
      "send_invoice",
      "get_customers",
      "get_top_customers",
      "get_customer_invoices",
      "get_refunds",
      "get_outstanding_invoices",
      "get_failed_payments",
      "draft_payment_reminders",
      "get_disputes",
      "get_dispute_evidence",
      "draft_dispute_response",
      "update_dispute_response",
      "submit_dispute_evidence",
      "decline_dispute",
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

  it("findTool defaults to TOOL_REGISTRY but accepts an override registry — S12's Telegram bot passes its own", () => {
    expect(findTool("get_daily_summary")?.name).toBe("get_daily_summary");

    const customRegistry: ToolRegistryEntry[] = [
      { name: "get_my_invoices", description: "x", parametersSchema: z.object({}).strict(), handler: async () => ({}) },
    ];
    expect(findTool("get_my_invoices", customRegistry)?.name).toBe("get_my_invoices");
    // Not present in the owner default — proves the override registry, not TOOL_REGISTRY, was searched.
    expect(findTool("get_my_invoices")).toBeUndefined();
    expect(findTool("get_daily_summary", customRegistry)).toBeUndefined();
  });

  it("toolDefinitionsForOpenAI defaults to TOOL_REGISTRY but accepts an override registry", () => {
    const customRegistry: ToolRegistryEntry[] = [
      { name: "get_my_invoices", description: "x", parametersSchema: z.object({}).strict(), handler: async () => ({}) },
      { name: "pay_invoice", description: "y", parametersSchema: z.object({}).strict(), handler: async () => ({}) },
    ];

    const definitions = toolDefinitionsForOpenAI(customRegistry);

    expect(definitions.map((d) => d.function.name)).toEqual(["get_my_invoices", "pay_invoice"]);
    // Confirms the no-arg call site (routes/assistant.ts via loop.ts) is unaffected by this override.
    expect(toolDefinitionsForOpenAI().map((d) => d.function.name)).toEqual(TOOL_REGISTRY.map((t) => t.name));
  });
});

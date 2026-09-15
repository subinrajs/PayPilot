import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type Stripe from "stripe";
import { DailySummaryArgsSchema, getDailySummary, type DailySummaryArgs } from "./tools/daily-summary.js";
import {
  RevenueComparisonArgsSchema,
  getRevenueComparison,
  type RevenueComparisonArgs,
} from "./tools/revenue-comparison.js";
import { RefundArgsSchema, proposeRefund, type RefundArgs } from "./tools/refund.js";
import {
  InvoiceCreationArgsSchema,
  proposeInvoiceCreation,
  type InvoiceCreationArgs,
} from "./tools/invoice-creation.js";
import {
  OwnerInvoiceLookupArgsSchema,
  lookupCustomerInvoices,
  type OwnerInvoiceLookupArgs,
} from "./tools/owner-invoice-lookup.js";

// The only place OpenAI function definitions are declared — generated from the same Zod schemas
// that validate at runtime, so the model is never shown a shape different from what's enforced.
// Deliberately just these 5 owner tools: invoice-payment is Telegram-scoped and never reaches
// this loop at all (see docs/design.md — the Telegram bot calls it directly, in-process,
// bypassing the HTTP surface entirely). get_customer_invoices resolves a customer reference here
// and then delegates to the same lookupInvoices the Telegram bot uses (see
// tools/owner-invoice-lookup.ts) — the underlying read is identical, only the customer-id
// resolution differs (owner: by name/email; Telegram: bound server-side from the chat session).
export interface ToolRegistryEntry {
  name: string;
  description: string;
  parametersSchema: ZodTypeAny;
  handler: (stripe: Stripe, args: unknown) => Promise<unknown>;
}

export const TOOL_REGISTRY: ToolRegistryEntry[] = [
  {
    name: "get_daily_summary",
    description:
      "Get a summary of a single day's payment activity (successful and failed charges, with totals). Read-only, executes immediately.",
    parametersSchema: DailySummaryArgsSchema,
    handler: (stripe, args) => getDailySummary(stripe, args as DailySummaryArgs),
  },
  {
    name: "get_revenue_comparison",
    description:
      "Compare succeeded revenue between two date ranges. Read-only, executes immediately. " +
      "IMPORTANT: each period's endDate is EXCLUSIVE — a period covering Sep 1 through Sep 7 " +
      "inclusive must be passed as startDate: '2026-09-01', endDate: '2026-09-08'.",
    parametersSchema: RevenueComparisonArgsSchema,
    handler: (stripe, args) => getRevenueComparison(stripe, args as RevenueComparisonArgs),
  },
  {
    name: "propose_refund",
    description:
      "Resolve a natural-language reference to a specific customer and payment, and propose refunding it. " +
      "Does NOT execute the refund — returns a pending action the owner must separately confirm, or an " +
      "ambiguous/not-found result if the reference didn't resolve to exactly one payment. Always call this " +
      "tool fresh for every refund request, even if you believe you already know the answer from earlier " +
      "in the conversation (e.g. from a daily summary) — only this tool's live result is authoritative, " +
      "since payment state can change between messages.",
    parametersSchema: RefundArgsSchema,
    handler: (stripe, args) => proposeRefund(stripe, args as RefundArgs),
  },
  {
    name: "propose_invoice_creation",
    description:
      "Resolve a natural-language customer reference and propose creating an invoice for a given amount and " +
      "due date. Does NOT create the invoice — returns a pending action the owner must separately confirm, " +
      "or a not-found/ambiguous result if the recipient didn't resolve to exactly one customer. dueDate must " +
      "be a concrete ISO date (resolve relative phrases like 'next Friday' yourself before calling this).",
    parametersSchema: InvoiceCreationArgsSchema,
    handler: (stripe, args) => proposeInvoiceCreation(stripe, args as InvoiceCreationArgs),
  },
  {
    name: "get_customer_invoices",
    description:
      "Look up a specific customer's invoices by name/email — status, amount due, due date. Read-only, " +
      "executes immediately, no confirmation needed. This is the ONLY way to answer whether an invoice " +
      "exists for a customer, or what one's amount/status/due date is — never answer from memory of an " +
      "earlier turn in this conversation and never guess, since invoice state can change between messages. " +
      "Returns a not-found/ambiguous result if the reference didn't resolve to exactly one customer.",
    parametersSchema: OwnerInvoiceLookupArgsSchema,
    handler: (stripe, args) => lookupCustomerInvoices(stripe, args as OwnerInvoiceLookupArgs),
  },
];

export function findTool(name: string): ToolRegistryEntry | undefined {
  return TOOL_REGISTRY.find((tool) => tool.name === name);
}

export function toolDefinitionsForOpenAI() {
  return TOOL_REGISTRY.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      // "jsonSchema7" (the default target), not "openApi3" — OpenAI's function-calling schema
      // validator expects standard JSON Schema, where e.g. `.positive()` becomes a numeric
      // `exclusiveMinimum`. openApi3's dialect renders that as a boolean flag instead
      // (`exclusiveMinimum: true` alongside `minimum: 0`), which OpenAI rejects outright.
      parameters: zodToJsonSchema(tool.parametersSchema, { target: "jsonSchema7" }),
    },
  }));
}

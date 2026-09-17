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
  CreateInvoiceDraftArgsSchema,
  createInvoiceDraft,
  type CreateInvoiceDraftArgs,
  UpdateInvoiceDraftArgsSchema,
  updateInvoiceDraft,
  type UpdateInvoiceDraftArgs,
  DiscardInvoiceDraftArgsSchema,
  discardInvoiceDraft,
  type DiscardInvoiceDraftArgs,
  SendInvoiceArgsSchema,
  proposeSendInvoice,
  type SendInvoiceArgs,
} from "./tools/invoice-creation.js";
import {
  OwnerInvoiceLookupArgsSchema,
  lookupCustomerInvoices,
  type OwnerInvoiceLookupArgs,
} from "./tools/owner-invoice-lookup.js";
import { RefundLookupArgsSchema, lookupRefunds, type RefundLookupArgs } from "./tools/refund-lookup.js";
import {
  OutstandingInvoicesArgsSchema,
  getOutstandingInvoices,
  type OutstandingInvoicesArgs,
} from "./tools/outstanding-invoices.js";

// The only place OpenAI function definitions are declared — generated from the same Zod schemas
// that validate at runtime, so the model is never shown a shape different from what's enforced.
// Deliberately just these 10 owner tools: invoice-payment is Telegram-scoped and never reaches
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
    name: "create_invoice_draft",
    description:
      "Resolve a natural-language customer reference and create a DRAFT invoice with one or more line items " +
      "(each with a description, quantity, and unit price). This is safe to call as soon as the owner asks — " +
      "it creates a real but harmless draft (no charge, nothing emailed to the customer yet) and returns a " +
      "review with the itemized breakdown, total, and a few checks (customer email on file, overdue history, " +
      "unusual amount, possible duplicate). It does NOT send anything — call send_invoice separately, only " +
      "when the owner explicitly approves. dueDate must be a concrete ISO date (resolve phrases like 'due in " +
      "15 days' yourself before calling this). Returns a not-found/ambiguous result if the recipient didn't " +
      "resolve to exactly one customer.",
    parametersSchema: CreateInvoiceDraftArgsSchema,
    handler: (stripe, args) => createInvoiceDraft(stripe, args as CreateInvoiceDraftArgs),
  },
  {
    name: "update_invoice_draft",
    description:
      "Change an existing invoice DRAFT's line items, due date, and/or memo, using the draftInvoiceId from " +
      "an earlier create_invoice_draft or update_invoice_draft result in this conversation. Use this for a " +
      "follow-up like 'make it due in 15 days' or 'change the consulting hours to 12' — it updates the SAME " +
      "draft and re-runs the review, it does not create a second invoice. Only fields you pass are changed; " +
      "omit items entirely to leave them as they are. Fails if the draft was already sent or discarded.",
    parametersSchema: UpdateInvoiceDraftArgsSchema,
    handler: (stripe, args) => updateInvoiceDraft(stripe, args as UpdateInvoiceDraftArgs),
  },
  {
    name: "discard_invoice_draft",
    description:
      "Delete an invoice DRAFT the owner no longer wants, using its draftInvoiceId. Only works on drafts that " +
      "haven't been sent yet. Use this when the owner says to discard, cancel, or throw away a drafted " +
      "invoice.",
    parametersSchema: DiscardInvoiceDraftArgsSchema,
    handler: (stripe, args) => discardInvoiceDraft(stripe, args as DiscardInvoiceDraftArgs),
  },
  {
    name: "send_invoice",
    description:
      "Propose sending an invoice DRAFT (identified by its draftInvoiceId) — finalizing it and emailing the " +
      "customer. Does NOT send anything itself — returns a pending action the owner must separately confirm, " +
      "exactly like propose_refund. Only call this when the owner explicitly says to send/approve the " +
      "invoice; never claim an invoice was sent before this has actually been confirmed and executed.",
    parametersSchema: SendInvoiceArgsSchema,
    handler: (stripe, args) => proposeSendInvoice(stripe, args as SendInvoiceArgs),
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
  {
    name: "get_refunds",
    description:
      "List refunds issued account-wide (across every customer) within a date range, with each refund's " +
      "amount and the customer it belongs to. Read-only, executes immediately. This is the ONLY way to " +
      "answer a question about past refunds — never answer from memory of an earlier turn, and never " +
      "confuse this with propose_refund, which creates a NEW refund rather than listing existing ones. " +
      "IMPORTANT: endDate is EXCLUSIVE — a range covering Sep 1 through Sep 7 inclusive must be passed as " +
      "startDate: '2026-09-01', endDate: '2026-09-08'.",
    parametersSchema: RefundLookupArgsSchema,
    handler: (stripe, args) => lookupRefunds(stripe, args as RefundLookupArgs),
  },
  {
    name: "get_outstanding_invoices",
    description:
      "List unpaid invoices account-wide, across EVERY customer at once, with each invoice's amount, " +
      "status, and which customer it belongs to. Use this for account-wide questions like 'any outstanding " +
      "invoices?', 'who owes us money right now?', or 'what's overdue?' — NOT for a specific customer's " +
      "invoices (use get_customer_invoices for that instead). Read-only, executes immediately. Never pass a " +
      "generic word like 'all' or 'every customer' as a customerReference to get_customer_invoices to try " +
      "to answer an account-wide question — it will never resolve, since that tool only looks up one " +
      "specific customer by name or email; call this tool instead. Defaults to status 'open' (everything " +
      "currently unpaid, which already includes overdue ones) when not specified; pass 'overdue' to narrow " +
      "to only those already past their due date.",
    parametersSchema: OutstandingInvoicesArgsSchema,
    handler: (stripe, args) => getOutstandingInvoices(stripe, args as OutstandingInvoicesArgs),
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

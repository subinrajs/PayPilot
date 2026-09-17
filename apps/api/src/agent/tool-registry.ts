import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type Stripe from "stripe";
import { getDisputesSummary } from "./dashboard.js";
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
import { ListCustomersArgsSchema, listCustomers } from "./tools/customer-list.js";
import { TopCustomersArgsSchema, getTopCustomers, type TopCustomersArgs } from "./tools/top-customers.js";
import { GetFailedPaymentsArgsSchema, getFailedPayments } from "./tools/failed-payments.js";
import {
  DraftPaymentRemindersArgsSchema,
  draftPaymentReminders,
  type DraftPaymentRemindersArgs,
} from "./tools/payment-reminders.js";
import {
  OutstandingInvoicesArgsSchema,
  getOutstandingInvoices,
  type OutstandingInvoicesArgs,
} from "./tools/outstanding-invoices.js";
import {
  GetDisputeEvidenceArgsSchema,
  getDisputeEvidence,
  type GetDisputeEvidenceArgs,
  DraftDisputeResponseArgsSchema,
  draftDisputeResponse,
  type DraftDisputeResponseArgs,
  UpdateDisputeResponseArgsSchema,
  updateDisputeResponse,
  type UpdateDisputeResponseArgs,
  SubmitDisputeEvidenceArgsSchema,
  proposeSubmitDisputeEvidence,
  type SubmitDisputeEvidenceArgs,
  DeclineDisputeArgsSchema,
  proposeDeclineDispute,
  type DeclineDisputeArgs,
} from "./tools/dispute-response.js";

// The only place OpenAI function definitions are declared — generated from the same Zod schemas
// that validate at runtime, so the model is never shown a shape different from what's enforced.
// Deliberately just these 20 owner tools: invoice-payment is Telegram-scoped and never reaches
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
    name: "get_customers",
    description:
      "List every customer on the account — id, name, email. Read-only, executes immediately. This is the " +
      "ONLY way to answer 'list all my customers', 'who are my customers', or similar account-wide requests " +
      "— never invent a customer list from memory, and never ask the owner to name a customer first when " +
      "they're explicitly asking to SEE the list. Not for looking up one specific customer's invoices/refunds " +
      "— use get_customer_invoices/get_refunds/get_outstanding_invoices for that instead.",
    parametersSchema: ListCustomersArgsSchema,
    handler: (stripe) => listCustomers(stripe),
  },
  {
    name: "get_top_customers",
    description:
      "Rank customers by total payments received (net of refunds), highest first. Read-only, executes " +
      "immediately. This is the ONLY way to answer 'which customer has the highest payments', 'who are my " +
      "top customers', or similar ranking/leaderboard questions — never guess or infer this from memory or " +
      "from a single daily summary. Defaults to all-time totals across every customer; pass startDate/endDate " +
      "together to narrow to a specific range (endDate is EXCLUSIVE, same as get_refunds), and/or limit to " +
      "cap how many customers come back (defaults to the top 10).",
    parametersSchema: TopCustomersArgsSchema,
    handler: (stripe, args) => getTopCustomers(stripe, args as TopCustomersArgs),
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
  {
    name: "get_failed_payments",
    description:
      "List currently-failed payments account-wide, across every customer — a charge that failed and " +
      "hasn't since been paid another way (an invoice that was later paid successfully is excluded). Each " +
      "item has the customer's name, email (if on file), and the failed amount. Read-only, executes " +
      "immediately. This is the ONLY way to answer 'any failed payments?' or similar — never guess or infer " +
      "this from a daily summary's failedCount, which only covers a single day.",
    parametersSchema: GetFailedPaymentsArgsSchema,
    handler: (stripe) => getFailedPayments(stripe),
  },
  {
    name: "draft_payment_reminders",
    description:
      "Draft one reminder email (subject + body, composed by you) for EVERY item the owner wants reminded " +
      "about — typically every currently-overdue invoice and every currently-failed payment, with no " +
      "omissions. Call get_outstanding_invoices (status: 'overdue') and/or get_failed_payments FIRST to see " +
      "the real items and their real facts (customer name, amount, due date or failed date) — never invent " +
      "a customer, amount, or date that didn't come from one of those results. Include EVERY item returned, " +
      "even one with no email on file — the review card discloses that plainly, and it's the owner's call " +
      "whether to send it anyway, not yours to decide by omitting it. Pass each item's hostedInvoiceUrl " +
      "straight through as invoiceUrl (null if it didn't have one) — never write a URL or markdown link " +
      "inside subject/body yourself, the review card renders invoiceUrl as its own proper link. Pass one " +
      "entry per item in a single call. This does NOT send anything — it only stages the drafts for the " +
      "owner to review, edit, and send themselves; nothing is emailed or logged until the owner explicitly " +
      "sends from the review card that appears.",
    parametersSchema: DraftPaymentRemindersArgsSchema,
    handler: (_stripe, args) => draftPaymentReminders(args as DraftPaymentRemindersArgs),
  },
  {
    name: "get_disputes",
    description:
      "List payment disputes still awaiting your response, across every customer, with each one's amount, " +
      "reason, customer name, and response deadline. Read-only, executes immediately. This is the ONLY way " +
      "to answer 'what disputes need my attention' or similar account-wide questions — never answer from " +
      "memory. To act on a specific dispute afterward (see its evidence, draft a response), use its id from " +
      "this result with get_dispute_evidence.",
    parametersSchema: z.object({}).strict(),
    handler: (stripe) => getDisputesSummary(stripe),
  },
  {
    name: "get_dispute_evidence",
    description:
      "Look up a payment dispute by its disputeId and see the evidence checklist relevant to its specific " +
      "reason — which fields are already on file (real Stripe/customer data) versus missing. Read-only, " +
      "executes immediately, no confirmation needed. This is the ONLY way to answer what a dispute is about " +
      "or what evidence exists for it — never answer from memory of an earlier turn, and never state an " +
      "evidence field is 'found' unless this tool says so; this app has no order/shipping/CRM system, so " +
      "most evidence beyond payment and customer facts is genuinely missing unless the owner tells you " +
      "otherwise in conversation.",
    parametersSchema: GetDisputeEvidenceArgsSchema,
    handler: (stripe, args) => getDisputeEvidence(stripe, args as GetDisputeEvidenceArgs),
  },
  {
    name: "draft_dispute_response",
    description:
      "Compose a written response for a dispute (the narrative argument — written by you, from real facts " +
      "plus whatever the owner has told you in this conversation) and stage it as evidence on the dispute. " +
      "Also pass any other evidence fields the owner has supplied that are relevant to the dispute's reason " +
      "(e.g. shippingCarrier/shippingTrackingNumber for 'product not received'). This is safe to call as " +
      "soon as you have something to draft — staging evidence does NOT submit it to the card network yet, " +
      "and can be revised via update_dispute_response before anything is sent. Never invent a value for a " +
      "field the owner hasn't actually told you — leave it out rather than guessing.",
    parametersSchema: DraftDisputeResponseArgsSchema,
    handler: (stripe, args) => draftDisputeResponse(stripe, args as DraftDisputeResponseArgs),
  },
  {
    name: "update_dispute_response",
    description:
      "Revise a dispute response already drafted in this conversation, using its disputeId. Pass only the " +
      "fields that changed (e.g. a corrected narrative, or a newly-supplied tracking number) — this re-stages " +
      "those fields on the SAME dispute, it does not start over. Same safety as draft_dispute_response: " +
      "staging is not submitting.",
    parametersSchema: UpdateDisputeResponseArgsSchema,
    handler: (stripe, args) => updateDisputeResponse(stripe, args as UpdateDisputeResponseArgs),
  },
  {
    name: "submit_dispute_evidence",
    description:
      "Propose submitting a dispute's already-staged evidence to the card network, using its disputeId. Does " +
      "NOT submit anything itself — returns a pending action the owner must separately confirm, exactly like " +
      "propose_refund. Only call this when the owner explicitly says to submit/send the response. Never claim " +
      "evidence was submitted before this has actually been confirmed and executed, and never claim or imply " +
      "the dispute will be won — the card issuer makes the final decision.",
    parametersSchema: SubmitDisputeEvidenceArgsSchema,
    handler: (stripe, args) => proposeSubmitDisputeEvidence(stripe, args as SubmitDisputeEvidenceArgs),
  },
  {
    name: "decline_dispute",
    description:
      "Propose declining to contest a dispute (conceding it as lost) — irreversible. Does NOT execute itself " +
      "— returns a pending action the owner must separately confirm. Only call this when the owner explicitly " +
      "says to decline, concede, or not fight a specific dispute — never speculatively, and never as a " +
      "consequence of the evidence merely looking weak; that's the owner's call to make, not yours.",
    parametersSchema: DeclineDisputeArgsSchema,
    handler: (stripe, args) => proposeDeclineDispute(stripe, args as DeclineDisputeArgs),
  },
];

// Both default to the fixed owner registry so every existing call site (routes/assistant.ts via
// loop.ts, this file's own tests) keeps working unchanged — S12's Telegram bot passes its own
// customer-scoped registry (telegram/tool-registry.ts) explicitly instead.
export function findTool(name: string, registry: ToolRegistryEntry[] = TOOL_REGISTRY): ToolRegistryEntry | undefined {
  return registry.find((tool) => tool.name === name);
}

export function toolDefinitionsForOpenAI(registry: ToolRegistryEntry[] = TOOL_REGISTRY) {
  return registry.map((tool) => ({
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

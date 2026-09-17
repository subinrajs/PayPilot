import { InvoiceLookupArgsSchema, lookupInvoices, type InvoiceLookupArgs } from "../agent/tools/invoice-lookup.js";
import { InvoicePaymentArgsSchema, proposeInvoicePayment, type InvoicePaymentArgs } from "../agent/tools/invoice-payment.js";
import type { ToolRegistryEntry } from "../agent/tool-registry.js";

// S12 (docs/feature.md) — the customer-scoped equivalent of agent/tool-registry.ts's owner
// TOOL_REGISTRY, built fresh per chat so each tool's handler closes over exactly one customerId.
// Both underlying schemas are already customerId-free by design (see invoice-lookup.ts/invoice-
// payment.ts's own comments) — the model literally cannot set or override which customer it's
// acting for, the same structural guarantee the existing button-driven callbacks already rely on.
export function buildCustomerToolRegistry(customerId: string): ToolRegistryEntry[] {
  return [
    {
      name: "get_my_invoices",
      description:
        "Look up the customer's own invoices — status, amount due, due date. Read-only, executes " +
        "immediately, no confirmation needed. This is the ONLY way to answer what the customer owes or " +
        "whether a specific invoice exists — never answer from memory of an earlier turn, since invoice " +
        "state can change between messages.",
      parametersSchema: InvoiceLookupArgsSchema,
      handler: (stripe, args) => lookupInvoices(stripe, customerId, args as InvoiceLookupArgs),
    },
    {
      name: "pay_invoice",
      description:
        "Propose paying one of the customer's own invoices, by its id (from a prior get_my_invoices " +
        "result — never guess an id). Does NOT pay it — returns a pending action that only executes once " +
        "the customer taps the Confirm button that appears after your reply. If the invoice is at or above " +
        "the $2,000 limit, already paid, or not found, say so honestly instead of claiming it's payable. " +
        "Only call this when the customer's CURRENT message is an explicit request to pay a specific " +
        "invoice — if they haven't said which one and more than one is open, ask or look them up first " +
        "rather than guessing.",
      parametersSchema: InvoicePaymentArgsSchema,
      handler: (stripe, args) => proposeInvoicePayment(stripe, customerId, args as InvoicePaymentArgs),
    },
  ];
}

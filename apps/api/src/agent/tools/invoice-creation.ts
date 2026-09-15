import { z } from "zod";
import type Stripe from "stripe";
import { createPendingAction, type PendingAction } from "../pending-action.js";
import { displayName, findCustomersByReference } from "../customer-resolution.js";
import { isoDateToUnixSeconds } from "../charge-fetching.js";

// Owner-only tool — no cap check and no customerId parameter, mirroring refund.ts. dueDate is a
// concrete ISO date the model has already resolved from something like "next Friday" — this tool
// stays independent of any date-parsing correctness, per docs/design.md.
export const InvoiceCreationArgsSchema = z
  .object({
    customerReference: z.string().min(1),
    amountCents: z.number().int().positive(),
    dueDate: z.string().date(),
    description: z.string().min(1).optional(),
  })
  .strict();
export type InvoiceCreationArgs = z.infer<typeof InvoiceCreationArgsSchema>;

export interface ResolvedInvoiceCreationArgs {
  customerId: string;
  customerName: string;
  amountCents: number;
  dueDate: string;
  description: string;
}

export interface CustomerCandidate {
  customerId: string;
  customerName: string;
}

export type ProposeInvoiceCreationResult =
  | { kind: "pending"; action: PendingAction<"create_invoice", ResolvedInvoiceCreationArgs> }
  | { kind: "ambiguous_customer"; candidates: CustomerCandidate[] }
  | { kind: "not_found"; reason: string };

export async function proposeInvoiceCreation(
  stripe: Stripe,
  args: InvoiceCreationArgs,
): Promise<ProposeInvoiceCreationResult> {
  const parsed = InvoiceCreationArgsSchema.parse(args);

  const customers = await findCustomersByReference(stripe, parsed.customerReference);
  if (customers.length === 0) {
    return { kind: "not_found", reason: `No customer matching "${parsed.customerReference}"` };
  }
  if (customers.length > 1) {
    return {
      kind: "ambiguous_customer",
      candidates: customers.map((c) => ({ customerId: c.id, customerName: displayName(c) })),
    };
  }

  const customer = customers[0];
  const resolved: ResolvedInvoiceCreationArgs = {
    customerId: customer.id,
    customerName: displayName(customer),
    amountCents: parsed.amountCents,
    dueDate: parsed.dueDate,
    description: parsed.description ?? `Invoice for ${displayName(customer)}`,
  };

  return { kind: "pending", action: createPendingAction("create_invoice", resolved) };
}

// Re-verifies the customer still exists rather than trusting the resolved args — mirrors the
// same "re-validate at execute time" pattern as refund.ts and invoice-payment.ts.
export async function executeInvoiceCreation(
  stripe: Stripe,
  resolved: ResolvedInvoiceCreationArgs,
): Promise<Stripe.Invoice> {
  const customer = await stripe.customers.retrieve(resolved.customerId);
  if (customer.deleted) {
    throw new Error(`Customer ${resolved.customerId} no longer exists`);
  }

  await stripe.invoiceItems.create({
    customer: resolved.customerId,
    amount: resolved.amountCents,
    currency: "usd",
    description: resolved.description,
  });

  const invoice = await stripe.invoices.create({
    customer: resolved.customerId,
    collection_method: "send_invoice",
    due_date: isoDateToUnixSeconds(resolved.dueDate),
    // The invoice ITEM's description (above) doesn't carry over to the invoice object itself —
    // callers that show an invoice list (e.g. the Telegram bot) read `invoice.description`, not
    // the line item's, so without this every invoice falls back to displaying its raw Stripe id.
    description: resolved.description,
    // Without this, pending invoice items aren't attached and the invoice finalizes as a $0
    // invoice Stripe immediately marks "paid" — the exact bug hit and fixed in seed.ts.
    pending_invoice_items_behavior: "include",
  });

  return stripe.invoices.finalizeInvoice(invoice.id);
}

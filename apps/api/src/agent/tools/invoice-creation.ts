import { z } from "zod";
import type Stripe from "stripe";
import { createPendingAction, type PendingAction } from "../pending-action.js";
import { displayName, findCustomersByReference } from "../customer-resolution.js";
import { isoDateToUnixSeconds } from "../charge-fetching.js";
import { lookupInvoices } from "./invoice-lookup.js";

// S10 (docs/feature.md) — replaces the old single-amount, one-shot create+finalize+send flow.
// Per ADR-012 (docs/decisions.md), creating/editing/discarding the DRAFT is safe and fully
// reversible (no charge, nothing emailed) and so happens immediately, with no pending action —
// only `proposeSendInvoice`/`executeSendInvoice` (the step with a real customer-visible effect)
// goes through the usual pending-action confirm ceremony, mirroring refund.ts.

export const InvoiceDraftItemSchema = z
  .object({
    description: z.string().min(1),
    quantity: z.number().int().positive(),
    unitAmountCents: z.number().int().positive(),
  })
  .strict();
export type InvoiceDraftItemArgs = z.infer<typeof InvoiceDraftItemSchema>;

export const CreateInvoiceDraftArgsSchema = z
  .object({
    customerReference: z.string().min(1).describe("The customer's name or email, as mentioned by the owner."),
    items: z
      .array(InvoiceDraftItemSchema)
      .min(1)
      .describe(
        "One entry per line item. quantity and unitAmountCents are multiplied by application code to get " +
          "each item's amount — never compute or state that total yourself.",
      ),
    dueDate: z.string().date(),
    memo: z.string().min(1).optional().describe("Optional overall invoice memo/description."),
  })
  .strict();
export type CreateInvoiceDraftArgs = z.infer<typeof CreateInvoiceDraftArgsSchema>;

export const UpdateInvoiceDraftArgsSchema = z
  .object({
    draftInvoiceId: z.string().min(1),
    items: z.array(InvoiceDraftItemSchema).min(1).optional(),
    dueDate: z.string().date().optional(),
    memo: z.string().min(1).optional(),
  })
  .strict();
export type UpdateInvoiceDraftArgs = z.infer<typeof UpdateInvoiceDraftArgsSchema>;

export const DiscardInvoiceDraftArgsSchema = z.object({ draftInvoiceId: z.string().min(1) }).strict();
export type DiscardInvoiceDraftArgs = z.infer<typeof DiscardInvoiceDraftArgsSchema>;

export const SendInvoiceArgsSchema = z.object({ draftInvoiceId: z.string().min(1) }).strict();
export type SendInvoiceArgs = z.infer<typeof SendInvoiceArgsSchema>;

export interface InvoiceDraftLineItem {
  description: string;
  quantity: number;
  unitAmountCents: number;
  amountCents: number;
}

export interface InvoiceDraftReviewFlag {
  severity: "ok" | "warning";
  label: string;
}

export interface InvoiceDraft {
  kind: "created";
  draftInvoiceId: string;
  customerName: string;
  customerEmail: string | null;
  items: InvoiceDraftLineItem[];
  subtotalCents: number;
  dueDate: string;
  memo: string | null;
  reviewFlags: InvoiceDraftReviewFlag[];
}

export interface CustomerCandidate {
  customerId: string;
  customerName: string;
}

export type CreateInvoiceDraftResult =
  | InvoiceDraft
  | { kind: "ambiguous_customer"; candidates: CustomerCandidate[] }
  | { kind: "not_found"; reason: string };

export async function createInvoiceDraft(
  stripe: Stripe,
  args: CreateInvoiceDraftArgs,
): Promise<CreateInvoiceDraftResult> {
  const parsed = CreateInvoiceDraftArgsSchema.parse(args);

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
  const items = await createPendingLineItems(stripe, customer.id, parsed.items);

  const invoice = await stripe.invoices.create({
    customer: customer.id,
    collection_method: "send_invoice",
    due_date: isoDateToUnixSeconds(parsed.dueDate),
    description: parsed.memo,
    // Without this, the just-created pending items aren't attached and the invoice finalizes as
    // a $0 invoice Stripe immediately marks "paid" — the same bug hit and fixed in seed.ts.
    pending_invoice_items_behavior: "include",
  });

  const reviewFlags = await reviewInvoiceDraft(stripe, customer, invoice, parsed.memo ?? null);

  return {
    kind: "created",
    draftInvoiceId: invoice.id,
    customerName: displayName(customer),
    customerEmail: customer.email,
    items,
    subtotalCents: invoice.subtotal,
    dueDate: parsed.dueDate,
    memo: parsed.memo ?? null,
    reviewFlags,
  };
}

export type UpdateInvoiceDraftResult = InvoiceDraft | { kind: "not_found"; reason: string };

export async function updateInvoiceDraft(
  stripe: Stripe,
  args: UpdateInvoiceDraftArgs,
): Promise<UpdateInvoiceDraftResult> {
  const parsed = UpdateInvoiceDraftArgsSchema.parse(args);

  const invoice = await retrieveDraft(stripe, parsed.draftInvoiceId);
  if (!invoice) {
    return { kind: "not_found", reason: `Invoice draft ${parsed.draftInvoiceId} no longer exists or was already sent` };
  }

  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer!.id;
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) {
    throw new Error(`Customer ${customerId} no longer exists`);
  }

  let items: InvoiceDraftLineItem[];
  if (parsed.items) {
    // Simpler and more correct than diffing item-by-item: drop the draft's current pending items
    // and recreate fresh ones from the new array. Stripe only allows deleting invoice items that
    // aren't yet attached to a finalized invoice, which a draft's items always satisfy.
    for await (const existing of stripe.invoiceItems.list({ invoice: invoice.id, limit: 100 })) {
      await stripe.invoiceItems.del(existing.id);
    }
    items = await createPendingLineItems(stripe, customerId, parsed.items);
  } else {
    items = pendingItemsToDraftLineItems(await listCurrentPendingItems(stripe, invoice.id));
  }

  const updated = await stripe.invoices.update(invoice.id, {
    ...(parsed.dueDate ? { due_date: isoDateToUnixSeconds(parsed.dueDate) } : {}),
    ...(parsed.memo ? { description: parsed.memo } : {}),
  });

  const dueDate = parsed.dueDate ?? isoUnixToDate(updated.due_date);
  const memo = parsed.memo ?? updated.description ?? null;
  const reviewFlags = await reviewInvoiceDraft(stripe, customer, updated, memo);

  return {
    kind: "created",
    draftInvoiceId: updated.id,
    customerName: displayName(customer),
    customerEmail: customer.email,
    items,
    subtotalCents: updated.subtotal,
    dueDate,
    memo,
    reviewFlags,
  };
}

export type DiscardInvoiceDraftResult = { kind: "discarded" } | { kind: "not_found"; reason: string };

export async function discardInvoiceDraft(
  stripe: Stripe,
  args: DiscardInvoiceDraftArgs,
): Promise<DiscardInvoiceDraftResult> {
  const parsed = DiscardInvoiceDraftArgsSchema.parse(args);

  const invoice = await retrieveDraft(stripe, parsed.draftInvoiceId);
  if (!invoice) {
    return { kind: "not_found", reason: `Invoice draft ${parsed.draftInvoiceId} no longer exists or was already sent` };
  }

  await stripe.invoices.del(invoice.id);
  return { kind: "discarded" };
}

export interface ResolvedSendInvoiceArgs {
  draftInvoiceId: string;
  customerName: string;
  totalCents: number;
  dueDate: string;
}

export type ProposeSendInvoiceResult =
  | { kind: "pending"; action: PendingAction<"send_invoice", ResolvedSendInvoiceArgs> }
  | { kind: "not_found"; reason: string };

export async function proposeSendInvoice(stripe: Stripe, args: SendInvoiceArgs): Promise<ProposeSendInvoiceResult> {
  const parsed = SendInvoiceArgsSchema.parse(args);

  const invoice = await retrieveDraft(stripe, parsed.draftInvoiceId);
  if (!invoice) {
    return { kind: "not_found", reason: `Invoice draft ${parsed.draftInvoiceId} no longer exists or was already sent` };
  }

  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer!.id;
  const customer = await stripe.customers.retrieve(customerId);
  const resolved: ResolvedSendInvoiceArgs = {
    draftInvoiceId: invoice.id,
    customerName: customer.deleted ? invoice.id : displayName(customer),
    totalCents: invoice.subtotal,
    dueDate: isoUnixToDate(invoice.due_date),
  };

  return { kind: "pending", action: createPendingAction("send_invoice", resolved) };
}

// Re-fetches and re-validates from scratch rather than trusting the resolved args — mirrors
// refund.ts's executeRefund. A pending "send" confirmed after the draft was edited, discarded, or
// already sent elsewhere must be rejected here, never silently sent as something it no longer is.
export async function executeSendInvoice(stripe: Stripe, resolved: ResolvedSendInvoiceArgs): Promise<Stripe.Invoice> {
  const invoice = await retrieveDraft(stripe, resolved.draftInvoiceId);
  if (!invoice) {
    throw new Error(`Invoice draft ${resolved.draftInvoiceId} no longer exists or was already sent`);
  }

  // auto_advance:false so finalizing never implicitly triggers Stripe's own auto-collection —
  // sendInvoice() below is the one deliberate, explicit dispatch point.
  await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false });
  return stripe.invoices.sendInvoice(invoice.id);
}

async function retrieveDraft(stripe: Stripe, invoiceId: string): Promise<Stripe.Invoice | null> {
  const invoice = await stripe.invoices.retrieve(invoiceId);
  return invoice.status === "draft" ? invoice : null;
}

async function createPendingLineItems(
  stripe: Stripe,
  customerId: string,
  items: InvoiceDraftItemArgs[],
): Promise<InvoiceDraftLineItem[]> {
  const created: Stripe.InvoiceItem[] = [];
  for (const item of items) {
    created.push(
      await stripe.invoiceItems.create({
        customer: customerId,
        currency: "usd",
        quantity: item.quantity,
        unit_amount: item.unitAmountCents,
        description: item.description,
      }),
    );
  }
  return pendingItemsToDraftLineItems(created);
}

async function listCurrentPendingItems(stripe: Stripe, invoiceId: string): Promise<Stripe.InvoiceItem[]> {
  const items: Stripe.InvoiceItem[] = [];
  for await (const item of stripe.invoiceItems.list({ invoice: invoiceId, limit: 100 })) {
    items.push(item);
  }
  return items;
}

function pendingItemsToDraftLineItems(items: Stripe.InvoiceItem[]): InvoiceDraftLineItem[] {
  return items.map((item) => ({
    description: item.description ?? "Item",
    quantity: item.quantity ?? 1,
    unitAmountCents: item.unit_amount ?? item.amount,
    amountCents: item.amount,
  }));
}

function isoUnixToDate(unixSeconds: number | null): string {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString().slice(0, 10) : "";
}

// The reviewer: 4 deterministic checks against real Stripe data, never LLM judgment (docs/design.md).
// "ok" checks are included too, not just problems, matching the reference mockup's ✓ lines.
async function reviewInvoiceDraft(
  stripe: Stripe,
  customer: Stripe.Customer | Stripe.DeletedCustomer,
  draft: Stripe.Invoice,
  memo: string | null,
): Promise<InvoiceDraftReviewFlag[]> {
  const flags: InvoiceDraftReviewFlag[] = [];

  if (customer.deleted || !customer.email) {
    flags.push({ severity: "warning", label: "Customer has no email on file" });
  } else {
    flags.push({ severity: "ok", label: `Customer email verified (${customer.email})` });
  }

  if (customer.deleted) return flags;

  const { invoices: allInvoices } = await lookupInvoices(stripe, customer.id, { status: "all" });
  const history = allInvoices.filter(
    (i) => i.id !== draft.id && i.status !== "draft" && i.status !== "void",
  );

  const overdue = history.filter((i) => i.overdue);
  if (overdue.length > 0) {
    const overdueTotalCents = overdue.reduce((sum, i) => sum + i.amountDueCents, 0);
    flags.push({
      severity: "warning",
      label: `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"} totaling $${(overdueTotalCents / 100).toFixed(2)}`,
    });
  } else {
    flags.push({ severity: "ok", label: "No overdue invoices for this customer" });
  }

  if (history.length > 0) {
    const averageCents = history.reduce((sum, i) => sum + i.amountDueCents, 0) / history.length;
    if (draft.subtotal > averageCents * 1.4) {
      flags.push({
        severity: "warning",
        label: `${Math.round((draft.subtotal / averageCents - 1) * 100)}% higher than this customer's average invoice`,
      });
    } else {
      flags.push({ severity: "ok", label: "Amount is in line with this customer's history" });
    }
  }

  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const duplicate = memo
    ? history.find(
        (i) =>
          i.amountDueCents === draft.subtotal &&
          i.description?.toLowerCase() === memo.toLowerCase() &&
          new Date(i.createdAt).getTime() >= thirtyDaysAgoMs,
      )
    : undefined;
  if (duplicate) {
    flags.push({ severity: "warning", label: `Looks similar to an invoice sent to this customer in the last 30 days` });
  }

  flags.push({ severity: "warning", label: "Tax: Not configured" });

  return flags;
}

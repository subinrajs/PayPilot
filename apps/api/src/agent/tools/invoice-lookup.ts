import { z } from "zod";
import type Stripe from "stripe";
import { scopeListParams } from "../../policies/authorization.js";

// Telegram-scoped, read-only — executes immediately, no pending action. customerId is a trusted
// TS parameter, never part of this schema (see invoice-payment.ts for the same pattern on the
// money-moving twin of this tool).
export const InvoiceLookupArgsSchema = z
  .object({
    status: z.enum(["open", "paid", "overdue", "all"]).optional(),
  })
  .strict();
export type InvoiceLookupArgs = z.infer<typeof InvoiceLookupArgsSchema>;

type StripeInvoiceStatus = NonNullable<Stripe.Invoice["status"]>;

export interface InvoiceLookupResultItem {
  id: string;
  amountDueCents: number;
  status: StripeInvoiceStatus;
  dueDate: string | null;
  overdue: boolean;
  description: string | null;
}

export interface InvoiceLookupResult {
  invoices: InvoiceLookupResultItem[];
}

export async function lookupInvoices(
  stripe: Stripe,
  customerId: string,
  args: InvoiceLookupArgs,
): Promise<InvoiceLookupResult> {
  const parsed = InvoiceLookupArgsSchema.parse(args);

  const list = await stripe.invoices.list({ ...scopeListParams(customerId), limit: 100 });
  const now = Date.now();
  let invoices = list.data.map((invoice) => toResultItem(invoice, now));

  if (parsed.status && parsed.status !== "all") {
    invoices =
      parsed.status === "overdue"
        ? invoices.filter((i) => i.overdue)
        : invoices.filter((i) => i.status === parsed.status);
  }

  return { invoices };
}

function toResultItem(invoice: Stripe.Invoice, nowMs: number): InvoiceLookupResultItem {
  const dueDateMs = invoice.due_date ? invoice.due_date * 1000 : null;
  return {
    id: invoice.id,
    amountDueCents: invoice.amount_due,
    status: invoice.status ?? "draft",
    dueDate: dueDateMs !== null ? new Date(dueDateMs).toISOString() : null,
    overdue: invoice.status === "open" && dueDateMs !== null && dueDateMs < nowMs,
    description: invoice.description,
  };
}

import { z } from "zod";
import Stripe from "stripe";
import { assertOwnedByCustomer, AuthorizationError } from "../../policies/authorization.js";
import { assertBelowCap, isAtOrAboveCap } from "../../policies/payment-policy.js";
import { createPendingAction, type PendingAction } from "../pending-action.js";

// Telegram-scoped tool — customerId is a trusted TS parameter, never part of this schema. A
// compromised/adversarial tool-call JSON that includes a customerId key is rejected by `.strict()`
// validation, not silently ignored.
export const InvoicePaymentArgsSchema = z.object({ invoiceId: z.string().min(1) }).strict();
export type InvoicePaymentArgs = z.infer<typeof InvoicePaymentArgsSchema>;

export interface ResolvedInvoicePaymentArgs {
  invoiceId: string;
  customerId: string;
  amountCents: number;
}

export type ProposeInvoicePaymentResult =
  | { kind: "pending"; action: PendingAction<"pay_invoice", ResolvedInvoicePaymentArgs> }
  // The exact customer-facing handoff mechanism is Phase 6's job — this only guarantees a
  // payable pending action is never produced for an at/above-cap invoice.
  | { kind: "handoff"; invoiceId: string; amountCents: number }
  | { kind: "not_found" }
  | { kind: "already_paid" };

export async function proposeInvoicePayment(
  stripe: Stripe,
  customerId: string,
  args: InvoicePaymentArgs,
): Promise<ProposeInvoicePaymentResult> {
  const parsed = InvoicePaymentArgsSchema.parse(args);

  const invoice = await fetchOwnedInvoice(stripe, customerId, parsed.invoiceId);
  if (!invoice) {
    // Deliberately the same result whether the invoice doesn't exist or belongs to someone
    // else — a customer must not learn that a given invoice id exists for another customer.
    return { kind: "not_found" };
  }

  if (invoice.paid || invoice.status === "paid") {
    return { kind: "already_paid" };
  }

  const amountCents = invoice.amount_due;
  if (isAtOrAboveCap(amountCents)) {
    return { kind: "handoff", invoiceId: invoice.id, amountCents };
  }

  const resolved: ResolvedInvoicePaymentArgs = { invoiceId: invoice.id, customerId, amountCents };
  return { kind: "pending", action: createPendingAction("pay_invoice", resolved) };
}

// Re-fetches and re-runs every check — ownership, already-paid, and the cap — rather than
// trusting the resolved args, since Stripe state can change between propose and confirm.
export async function executeInvoicePayment(
  stripe: Stripe,
  customerId: string,
  resolved: ResolvedInvoicePaymentArgs,
): Promise<Stripe.Invoice> {
  const invoice = await stripe.invoices.retrieve(resolved.invoiceId);
  assertOwnedByCustomer(customerId, invoice);

  if (invoice.paid || invoice.status === "paid") {
    throw new Error(`Invoice ${resolved.invoiceId} is already paid`);
  }

  assertBelowCap(invoice.amount_due);

  return stripe.invoices.pay(resolved.invoiceId);
}

async function fetchOwnedInvoice(
  stripe: Stripe,
  customerId: string,
  invoiceId: string,
): Promise<Stripe.Invoice | null> {
  try {
    const invoice = await stripe.invoices.retrieve(invoiceId);
    assertOwnedByCustomer(customerId, invoice);
    return invoice;
  } catch (err) {
    // An unknown id and a real-but-unowned id are both treated as "not found" rather than
    // leaking which ids are valid — but only for those two specific cases. Anything else (a
    // network failure, an auth problem with our own Stripe key) is a real error and must not be
    // silently swallowed as "invoice not found."
    if (err instanceof AuthorizationError) return null;
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") return null;
    throw err;
  }
}

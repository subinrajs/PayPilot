import { z } from "zod";
import type Stripe from "stripe";
import { assertOwnedByCustomer } from "../../policies/authorization.js";
import { createPendingAction, type PendingAction } from "../pending-action.js";
import { displayName, findCustomersByReference } from "../customer-resolution.js";

// Owner-only tool — no cap check and no customerId parameter, since the owner has full access to
// their own account. Both fields are natural-language hints the model extracted from the
// conversation (e.g. "refund Maya's last payment" → customerReference: "Maya", paymentReference:
// "last"); resolving them to a specific Stripe charge is this tool's own job, not the model's.
export const RefundArgsSchema = z
  .object({
    customerReference: z.string().min(1),
    paymentReference: z.string().min(1).optional(),
  })
  .strict();
export type RefundArgs = z.infer<typeof RefundArgsSchema>;

export interface ResolvedRefundArgs {
  chargeId: string;
  customerId: string;
  customerName: string;
  amountCents: number;
}

export interface CustomerCandidate {
  customerId: string;
  customerName: string;
}

export interface ChargeCandidate {
  chargeId: string;
  amountCents: number;
  description: string | null;
}

export type ProposeRefundResult =
  | { kind: "pending"; action: PendingAction<"refund", ResolvedRefundArgs> }
  | { kind: "ambiguous_customer"; candidates: CustomerCandidate[] }
  | { kind: "ambiguous_charge"; candidates: ChargeCandidate[] }
  | { kind: "not_found"; reason: string };

const RECENCY_WORDS = new Set(["last", "latest", "most recent", "recent"]);

export async function proposeRefund(stripe: Stripe, args: RefundArgs): Promise<ProposeRefundResult> {
  const parsed = RefundArgsSchema.parse(args);

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
  const charges = await findRefundableCharges(stripe, customer.id, parsed.paymentReference);

  if (charges.length === 0) {
    return { kind: "not_found", reason: `No refundable payment found for ${displayName(customer)}` };
  }
  if (charges.length > 1) {
    return {
      kind: "ambiguous_charge",
      candidates: charges.map((c) => ({ chargeId: c.id, amountCents: c.amount, description: c.description })),
    };
  }

  const charge = charges[0];
  const resolved: ResolvedRefundArgs = {
    chargeId: charge.id,
    customerId: customer.id,
    customerName: displayName(customer),
    amountCents: charge.amount,
  };

  return { kind: "pending", action: createPendingAction("refund", resolved) };
}

// Re-fetches and re-validates from scratch rather than trusting the resolved args — a pending
// action confirmed after its underlying charge changed state (already refunded, partially
// refunded, or moved to a different customer somehow) must be rejected here, not silently applied
// to something else or refunded for a different amount than what was confirmed.
export async function executeRefund(stripe: Stripe, resolved: ResolvedRefundArgs): Promise<Stripe.Refund> {
  const charge = await stripe.charges.retrieve(resolved.chargeId);

  assertOwnedByCustomer(resolved.customerId, charge);

  if (charge.status !== "succeeded" || charge.refunded) {
    throw new Error(
      `Charge ${resolved.chargeId} is no longer refundable (status=${charge.status}, refunded=${charge.refunded})`,
    );
  }
  if (charge.amount_refunded > 0) {
    throw new Error(`Charge ${resolved.chargeId} was partially refunded since this refund was confirmed`);
  }
  if (charge.amount !== resolved.amountCents) {
    throw new Error(
      `Charge ${resolved.chargeId}'s amount (${charge.amount}) no longer matches the confirmed amount (${resolved.amountCents})`,
    );
  }

  // Passed explicitly (not left to default to "whatever's left") so Stripe itself rejects the
  // call if any of the checks above somehow missed a state change.
  return stripe.refunds.create({ charge: resolved.chargeId, amount: resolved.amountCents });
}

async function findRefundableCharges(
  stripe: Stripe,
  customerId: string,
  paymentReference: string | undefined,
): Promise<Stripe.Charge[]> {
  const list = await stripe.charges.list({ customer: customerId, limit: 20 });
  let candidates = list.data.filter((c) => c.status === "succeeded" && !c.refunded);

  if (paymentReference) {
    const needle = paymentReference.trim().toLowerCase();
    if (RECENCY_WORDS.has(needle)) {
      // Stripe's default charge list order is most-recent-first.
      candidates = candidates.slice(0, 1);
    } else {
      candidates = candidates.filter((c) => c.description?.toLowerCase().includes(needle));
    }
  }
  // No paymentReference and more than one candidate is left ambiguous deliberately — the caller
  // must ask for clarification rather than guessing which payment was meant.

  return candidates;
}

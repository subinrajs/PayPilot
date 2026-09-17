import { z } from "zod";
import type Stripe from "stripe";
import { createPendingAction, type PendingAction } from "../pending-action.js";
import { DISPUTE_NEEDS_RESPONSE_STATUSES } from "../dashboard.js";

// S11 (docs/feature.md) — per ADR-013, staging evidence (submit:false) is safe and reversible and
// so happens immediately, no pending action; only submit_dispute_evidence/decline_dispute (a real
// network-facing or irreversible effect) go through the usual pending-action confirm ceremony,
// mirroring invoice-creation.ts's draft/send split.
//
// This codebase has no order/shipping/tracking/CRM system (see .claude/context/s11-dispute-
// assistant.md) — most evidence fields below can never be auto-derived and stay "missing" unless
// the owner supplies them conversationally. Never fabricate a "found" value.

// The handful of Stripe evidence fields this app supports, renamed to a friendlier vocabulary for
// the model's tool arguments. File-upload fields (receipt, customer_communication, shipping_
// documentation, etc.) are deliberately excluded — no file-upload infrastructure exists.
type AutoFieldKey = "customerName" | "customerEmailAddress" | "billingAddress" | "productDescription";
type ManualFieldKey =
  | "shippingCarrier"
  | "shippingTrackingNumber"
  | "shippingDate"
  | "shippingAddress"
  | "serviceDate"
  | "accessActivityLog"
  | "duplicateChargeId"
  | "duplicateChargeExplanation"
  | "refundRefusalExplanation"
  | "cancellationPolicyDisclosure"
  | "cancellationRebuttal"
  | "refundPolicyDisclosure";
export type EvidenceFieldKey = AutoFieldKey | ManualFieldKey | "narrative";

type FreeTextEvidenceKey = Exclude<keyof Stripe.Dispute.Evidence, "enhanced_evidence" | FileEvidenceKey>;
type FileEvidenceKey =
  | "cancellation_policy"
  | "customer_communication"
  | "customer_signature"
  | "duplicate_charge_documentation"
  | "receipt"
  | "refund_policy"
  | "service_documentation"
  | "shipping_documentation"
  | "uncategorized_file";

const STRIPE_EVIDENCE_FIELD: Record<EvidenceFieldKey, FreeTextEvidenceKey> = {
  customerName: "customer_name",
  customerEmailAddress: "customer_email_address",
  billingAddress: "billing_address",
  productDescription: "product_description",
  shippingCarrier: "shipping_carrier",
  shippingTrackingNumber: "shipping_tracking_number",
  shippingDate: "shipping_date",
  shippingAddress: "shipping_address",
  serviceDate: "service_date",
  accessActivityLog: "access_activity_log",
  duplicateChargeId: "duplicate_charge_id",
  duplicateChargeExplanation: "duplicate_charge_explanation",
  refundRefusalExplanation: "refund_refusal_explanation",
  cancellationPolicyDisclosure: "cancellation_policy_disclosure",
  cancellationRebuttal: "cancellation_rebuttal",
  refundPolicyDisclosure: "refund_policy_disclosure",
  narrative: "uncategorized_text",
};

const FIELD_LABEL: Record<EvidenceFieldKey, string> = {
  customerName: "Customer name on file",
  customerEmailAddress: "Customer email on file",
  billingAddress: "Billing address on file",
  productDescription: "Product/service description",
  shippingCarrier: "Shipping carrier",
  shippingTrackingNumber: "Shipping tracking number",
  shippingDate: "Shipping date",
  shippingAddress: "Shipping address",
  serviceDate: "Service date",
  accessActivityLog: "Account access activity log",
  duplicateChargeId: "Matching prior charge",
  duplicateChargeExplanation: "Explanation of the duplicate charge",
  refundRefusalExplanation: "Explanation for not refunding",
  cancellationPolicyDisclosure: "Cancellation policy shown to the customer",
  cancellationRebuttal: "Rebuttal to the cancellation claim",
  refundPolicyDisclosure: "Refund policy shown to the customer",
  narrative: "Written response",
};

const AUTO_FIELD_KEYS: AutoFieldKey[] = ["customerName", "customerEmailAddress", "billingAddress", "productDescription"];

// Which fields are worth asking about for a given real Stripe dispute reason (docs/decisions.md
// ADR-013 background, .claude/context/s11-dispute-assistant.md) — deterministic, not the model's
// call. Reasons not listed fall back to the generic set.
const REASON_FIELDS: Record<string, EvidenceFieldKey[]> = {
  product_not_received: [
    "customerName",
    "customerEmailAddress",
    "shippingCarrier",
    "shippingTrackingNumber",
    "shippingDate",
    "shippingAddress",
    "narrative",
  ],
  fraudulent: ["customerName", "customerEmailAddress", "billingAddress", "accessActivityLog", "narrative"],
  duplicate: ["duplicateChargeId", "duplicateChargeExplanation", "narrative"],
  product_unacceptable: ["productDescription", "refundPolicyDisclosure", "narrative"],
  credit_not_processed: ["refundRefusalExplanation", "serviceDate", "narrative"],
  subscription_canceled: ["cancellationPolicyDisclosure", "cancellationRebuttal", "narrative"],
};
const DEFAULT_REASON_FIELDS: EvidenceFieldKey[] = ["productDescription", "narrative"];

function relevantFieldsForReason(reason: string): EvidenceFieldKey[] {
  return REASON_FIELDS[reason] ?? DEFAULT_REASON_FIELDS;
}

const ManualEvidenceArgsSchema = z.object({
  shippingCarrier: z.string().min(1).optional(),
  shippingTrackingNumber: z.string().min(1).optional(),
  shippingDate: z.string().date().optional(),
  shippingAddress: z.string().min(1).optional(),
  serviceDate: z.string().date().optional(),
  accessActivityLog: z.string().min(1).optional(),
  duplicateChargeId: z.string().min(1).optional(),
  duplicateChargeExplanation: z.string().min(1).optional(),
  refundRefusalExplanation: z.string().min(1).optional(),
  cancellationPolicyDisclosure: z.string().min(1).optional(),
  cancellationRebuttal: z.string().min(1).optional(),
  refundPolicyDisclosure: z.string().min(1).optional(),
});
type ManualEvidenceArgs = z.infer<typeof ManualEvidenceArgsSchema>;

export const GetDisputeEvidenceArgsSchema = z.object({ disputeId: z.string().min(1) }).strict();
export type GetDisputeEvidenceArgs = z.infer<typeof GetDisputeEvidenceArgsSchema>;

export const DraftDisputeResponseArgsSchema = ManualEvidenceArgsSchema.extend({
  disputeId: z.string().min(1),
  narrative: z
    .string()
    .min(1)
    .describe("The written response explaining the business's side, composed from real facts and whatever the owner has supplied."),
}).strict();
export type DraftDisputeResponseArgs = z.infer<typeof DraftDisputeResponseArgsSchema>;

export const UpdateDisputeResponseArgsSchema = ManualEvidenceArgsSchema.extend({
  disputeId: z.string().min(1),
  narrative: z.string().min(1).optional(),
}).strict();
export type UpdateDisputeResponseArgs = z.infer<typeof UpdateDisputeResponseArgsSchema>;

export const SubmitDisputeEvidenceArgsSchema = z.object({ disputeId: z.string().min(1) }).strict();
export type SubmitDisputeEvidenceArgs = z.infer<typeof SubmitDisputeEvidenceArgsSchema>;

export const DeclineDisputeArgsSchema = z.object({ disputeId: z.string().min(1) }).strict();
export type DeclineDisputeArgs = z.infer<typeof DeclineDisputeArgsSchema>;

export interface EvidenceField {
  key: EvidenceFieldKey;
  label: string;
  status: "found" | "missing";
  value: string | null;
}

export interface DisputeAssessmentFlag {
  severity: "ok" | "warning" | "info";
  label: string;
}

export interface DisputeResponseFound {
  kind: "found";
  disputeId: string;
  reason: string;
  customerName: string | null;
  amountCents: number;
  chargeDescription: string | null;
  dueBy: string | null;
  evidenceFields: EvidenceField[];
  narrative: string | null;
  staged: boolean;
  assessment: DisputeAssessmentFlag[];
}

export type DisputeResponseResult = DisputeResponseFound | { kind: "not_found"; reason: string };

interface DisputeContext {
  dispute: Stripe.Dispute;
  charge: Stripe.Charge | null;
  customer: Stripe.Customer | null;
}

async function loadDisputeContext(stripe: Stripe, disputeId: string): Promise<DisputeContext | null> {
  let dispute: Stripe.Dispute;
  try {
    dispute = await stripe.disputes.retrieve(disputeId, { expand: ["charge"] });
  } catch {
    return null;
  }

  const charge = typeof dispute.charge === "object" && dispute.charge !== null ? dispute.charge : null;
  let customer: Stripe.Customer | null = null;
  if (charge?.customer) {
    const customerId = typeof charge.customer === "string" ? charge.customer : charge.customer.id;
    const fetched = await stripe.customers.retrieve(customerId);
    customer = fetched.deleted ? null : fetched;
  }

  return { dispute, charge, customer };
}

function autoFilledValue(key: AutoFieldKey, ctx: DisputeContext): string | null {
  switch (key) {
    case "customerName":
      return ctx.charge?.billing_details.name ?? ctx.customer?.name ?? null;
    case "customerEmailAddress":
      return ctx.charge?.billing_details.email ?? ctx.customer?.email ?? null;
    case "billingAddress":
      return formatAddress(ctx.charge?.billing_details.address ?? null);
    case "productDescription":
      return ctx.charge?.description ?? null;
  }
}

function formatAddress(address: Stripe.Address | null | undefined): string | null {
  if (!address) return null;
  const parts = [address.line1, address.line2, address.city, address.state, address.postal_code, address.country].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

// A genuinely findable fact for "duplicate" disputes — not fabricated, an actual search over this
// customer's other charges. Matches on amount within a 7-day window around the disputed charge;
// deliberately simple (same reasoning as invoice-creation.ts's coarse duplicate-invoice heuristic).
async function findDuplicateChargeId(stripe: Stripe, ctx: DisputeContext): Promise<string | null> {
  if (!ctx.charge?.customer) return null;
  const customerId = typeof ctx.charge.customer === "string" ? ctx.charge.customer : ctx.charge.customer.id;
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  const gte = Math.floor((ctx.charge.created * 1000 - windowMs) / 1000);
  const lte = Math.floor((ctx.charge.created * 1000 + windowMs) / 1000);

  const list = await stripe.charges.list({ customer: customerId, created: { gte, lte }, limit: 100 });
  const match = list.data.find((c) => c.id !== ctx.charge!.id && c.status === "succeeded" && c.amount === ctx.charge!.amount);
  return match?.id ?? null;
}

function buildEvidenceFields(
  relevantKeys: EvidenceFieldKey[],
  dispute: Stripe.Dispute,
  ctx: DisputeContext,
  duplicateChargeId: string | null,
): EvidenceField[] {
  return relevantKeys.map((key) => {
    const staged = dispute.evidence[STRIPE_EVIDENCE_FIELD[key]];
    if (staged) {
      return { key, label: FIELD_LABEL[key], status: "found", value: staged };
    }
    if ((AUTO_FIELD_KEYS as EvidenceFieldKey[]).includes(key)) {
      const auto = autoFilledValue(key as AutoFieldKey, ctx);
      if (auto) return { key, label: FIELD_LABEL[key], status: "found", value: auto };
    }
    if (key === "duplicateChargeId" && duplicateChargeId) {
      return { key, label: FIELD_LABEL[key], status: "found", value: duplicateChargeId };
    }
    return { key, label: FIELD_LABEL[key], status: "missing", value: null };
  });
}

function buildAssessment(evidenceFields: EvidenceField[]): DisputeAssessmentFlag[] {
  const missing = evidenceFields.filter((f) => f.status === "missing" && f.key !== "narrative");
  const flags: DisputeAssessmentFlag[] = [];

  if (missing.length > 0) {
    flags.push({
      severity: "warning",
      label: `${missing.length} piece${missing.length === 1 ? "" : "s"} of commonly-requested evidence ${missing.length === 1 ? "is" : "are"} missing for this reason`,
    });
  } else {
    flags.push({ severity: "ok", label: "All commonly-requested evidence for this dispute reason is on file" });
  }

  flags.push({
    severity: "info",
    label: "PayPilot can't guarantee this dispute will be won — the card issuer makes the final decision.",
  });

  return flags;
}

async function buildFoundResult(stripe: Stripe, dispute: Stripe.Dispute, ctx: DisputeContext): Promise<DisputeResponseFound> {
  const relevant = relevantFieldsForReason(dispute.reason);
  const duplicateChargeId = relevant.includes("duplicateChargeId") ? await findDuplicateChargeId(stripe, ctx) : null;
  const evidenceFields = buildEvidenceFields(relevant, dispute, ctx, duplicateChargeId);

  return {
    kind: "found",
    disputeId: dispute.id,
    reason: dispute.reason,
    customerName: autoFilledValue("customerName", ctx),
    amountCents: dispute.amount,
    chargeDescription: ctx.charge?.description ?? null,
    dueBy: dispute.evidence_details.due_by ? new Date(dispute.evidence_details.due_by * 1000).toISOString() : null,
    evidenceFields,
    narrative: dispute.evidence.uncategorized_text,
    staged: dispute.evidence_details.has_evidence,
    assessment: buildAssessment(evidenceFields),
  };
}

export async function getDisputeEvidence(stripe: Stripe, args: GetDisputeEvidenceArgs): Promise<DisputeResponseResult> {
  const parsed = GetDisputeEvidenceArgsSchema.parse(args);
  const ctx = await loadDisputeContext(stripe, parsed.disputeId);
  if (!ctx) return { kind: "not_found", reason: `No dispute found with id ${parsed.disputeId}` };

  return buildFoundResult(stripe, ctx.dispute, ctx);
}

function buildEvidencePayload(args: ManualEvidenceArgs & { narrative?: string }): Stripe.DisputeUpdateParams.Evidence {
  const evidence: Stripe.DisputeUpdateParams.Evidence = {};
  if (args.narrative) evidence.uncategorized_text = args.narrative;
  if (args.shippingCarrier) evidence.shipping_carrier = args.shippingCarrier;
  if (args.shippingTrackingNumber) evidence.shipping_tracking_number = args.shippingTrackingNumber;
  if (args.shippingDate) evidence.shipping_date = args.shippingDate;
  if (args.shippingAddress) evidence.shipping_address = args.shippingAddress;
  if (args.serviceDate) evidence.service_date = args.serviceDate;
  if (args.accessActivityLog) evidence.access_activity_log = args.accessActivityLog;
  if (args.duplicateChargeId) evidence.duplicate_charge_id = args.duplicateChargeId;
  if (args.duplicateChargeExplanation) evidence.duplicate_charge_explanation = args.duplicateChargeExplanation;
  if (args.refundRefusalExplanation) evidence.refund_refusal_explanation = args.refundRefusalExplanation;
  if (args.cancellationPolicyDisclosure) evidence.cancellation_policy_disclosure = args.cancellationPolicyDisclosure;
  if (args.cancellationRebuttal) evidence.cancellation_rebuttal = args.cancellationRebuttal;
  if (args.refundPolicyDisclosure) evidence.refund_policy_disclosure = args.refundPolicyDisclosure;
  return evidence;
}

async function stageEvidence(
  stripe: Stripe,
  disputeId: string,
  args: ManualEvidenceArgs & { narrative?: string },
): Promise<DisputeResponseResult> {
  const ctx = await loadDisputeContext(stripe, disputeId);
  if (!ctx) return { kind: "not_found", reason: `No dispute found with id ${disputeId}` };
  if (!DISPUTE_NEEDS_RESPONSE_STATUSES.has(ctx.dispute.status)) {
    return { kind: "not_found", reason: `Dispute ${disputeId} is no longer awaiting a response (status: ${ctx.dispute.status})` };
  }

  // Auto-fill the always-derivable fields on every staging call — the model never needs to ask
  // for or pass these itself.
  const evidence = buildEvidencePayload(args);
  for (const key of AUTO_FIELD_KEYS) {
    const auto = autoFilledValue(key, ctx);
    if (auto) evidence[STRIPE_EVIDENCE_FIELD[key]] = auto;
  }

  // submit:false is not optional here — Stripe defaults `submit` to true, which would send
  // evidence to the card network immediately instead of staging it (see ADR-013).
  const updated = await stripe.disputes.update(disputeId, { evidence, submit: false });
  return buildFoundResult(stripe, updated, ctx);
}

export async function draftDisputeResponse(stripe: Stripe, args: DraftDisputeResponseArgs): Promise<DisputeResponseResult> {
  const parsed = DraftDisputeResponseArgsSchema.parse(args);
  return stageEvidence(stripe, parsed.disputeId, parsed);
}

export async function updateDisputeResponse(stripe: Stripe, args: UpdateDisputeResponseArgs): Promise<DisputeResponseResult> {
  const parsed = UpdateDisputeResponseArgsSchema.parse(args);
  return stageEvidence(stripe, parsed.disputeId, parsed);
}

export interface ResolvedDisputeActionArgs {
  disputeId: string;
  customerName: string | null;
  amountCents: number;
  reason: string;
}

export type ProposeDisputeActionResult =
  | { kind: "pending"; action: PendingAction<"submit_dispute_evidence", ResolvedDisputeActionArgs> }
  | { kind: "not_found"; reason: string };

export async function proposeSubmitDisputeEvidence(
  stripe: Stripe,
  args: SubmitDisputeEvidenceArgs,
): Promise<ProposeDisputeActionResult> {
  const parsed = SubmitDisputeEvidenceArgsSchema.parse(args);
  const ctx = await loadDisputeContext(stripe, parsed.disputeId);
  if (!ctx || !DISPUTE_NEEDS_RESPONSE_STATUSES.has(ctx.dispute.status)) {
    return { kind: "not_found", reason: `Dispute ${parsed.disputeId} is no longer awaiting a response` };
  }

  const resolved: ResolvedDisputeActionArgs = {
    disputeId: ctx.dispute.id,
    customerName: autoFilledValue("customerName", ctx),
    amountCents: ctx.dispute.amount,
    reason: ctx.dispute.reason,
  };
  return { kind: "pending", action: createPendingAction("submit_dispute_evidence", resolved) };
}

// Re-fetches and re-validates rather than trusting the resolved args — mirrors refund.ts's
// executeRefund. A dispute resolved elsewhere (won/lost/already submitted) between propose and
// confirm must be rejected here, not silently submitted against stale state.
export async function executeSubmitDisputeEvidence(stripe: Stripe, resolved: ResolvedDisputeActionArgs): Promise<Stripe.Dispute> {
  const dispute = await stripe.disputes.retrieve(resolved.disputeId);
  if (!DISPUTE_NEEDS_RESPONSE_STATUSES.has(dispute.status)) {
    throw new Error(`Dispute ${resolved.disputeId} is no longer awaiting a response (status: ${dispute.status})`);
  }

  return stripe.disputes.update(resolved.disputeId, { submit: true });
}

export type ProposeDeclineDisputeResult =
  | { kind: "pending"; action: PendingAction<"decline_dispute", ResolvedDisputeActionArgs> }
  | { kind: "not_found"; reason: string };

export async function proposeDeclineDispute(stripe: Stripe, args: DeclineDisputeArgs): Promise<ProposeDeclineDisputeResult> {
  const parsed = DeclineDisputeArgsSchema.parse(args);
  const ctx = await loadDisputeContext(stripe, parsed.disputeId);
  if (!ctx || !DISPUTE_NEEDS_RESPONSE_STATUSES.has(ctx.dispute.status)) {
    return { kind: "not_found", reason: `Dispute ${parsed.disputeId} is no longer awaiting a response` };
  }

  const resolved: ResolvedDisputeActionArgs = {
    disputeId: ctx.dispute.id,
    customerName: autoFilledValue("customerName", ctx),
    amountCents: ctx.dispute.amount,
    reason: ctx.dispute.reason,
  };
  return { kind: "pending", action: createPendingAction("decline_dispute", resolved) };
}

export async function executeDeclineDispute(stripe: Stripe, resolved: ResolvedDisputeActionArgs): Promise<Stripe.Dispute> {
  const dispute = await stripe.disputes.retrieve(resolved.disputeId);
  if (!DISPUTE_NEEDS_RESPONSE_STATUSES.has(dispute.status)) {
    throw new Error(`Dispute ${resolved.disputeId} is no longer awaiting a response (status: ${dispute.status})`);
  }

  return stripe.disputes.close(resolved.disputeId);
}

// Wire types mirroring apps/api/src/routes/assistant.ts's request/response shapes exactly. The
// message array is otherwise opaque to the UI — it's stored and resent verbatim (including
// tool/tool_call entries), never trimmed, since the backend's loop needs the full transcript.
// "system" is deliberately excluded — the backend's AssistantRequestSchema rejects it too, so a
// client can't inject a fake system-level message; the real system prompt is always injected
// fresh server-side.
export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content?: string | null;
  // Present on an assistant message that called a tool (content is usually null in that case);
  // used client-side only to identify which tool a later role:"tool" message's result came from
  // — see toolResults.ts.
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  // Present on a role:"tool" message — links it back to the tool_calls entry that produced it.
  tool_call_id?: string;
  [key: string]: unknown;
}

// Mirrors apps/api/src/agent/aggregation.ts's DailySummary/RevenueComparison and
// apps/api/src/agent/tools/owner-invoice-lookup.ts's result shape by hand — the web package
// doesn't import from apps/api, same as PendingAction's arg types just below.
export interface ChargeLike {
  id: string;
  amountCents: number;
  amountRefundedCents: number;
  status: "succeeded" | "failed" | "pending";
  customerName: string | null;
  description: string | null;
}

export interface DailySummary {
  date: string;
  succeededCount: number;
  succeededTotalCents: number;
  refundedTotalCents: number;
  netTotalCents: number;
  failedCount: number;
  charges: ChargeLike[];
}

export interface RevenuePeriod {
  label: string;
  startDate: string;
  endDate: string;
  totalCents: number;
  grossCents: number;
  refundedCents: number;
  chargeCount: number;
}

export interface RevenueComparison {
  current: RevenuePeriod;
  previous: RevenuePeriod;
  differenceCents: number;
  percentChange: number | null;
}

export interface InvoiceLookupResultItem {
  id: string;
  amountDueCents: number;
  status: string;
  dueDate: string | null;
  overdue: boolean;
  description: string | null;
  hostedInvoiceUrl: string | null;
}

export interface CustomerInvoicesFound {
  kind: "found";
  customerName: string;
  invoices: InvoiceLookupResultItem[];
}

// Mirrors apps/api/src/agent/tools/outstanding-invoices.ts's result shape by hand.
export interface OutstandingInvoiceItem extends InvoiceLookupResultItem {
  customerName: string;
}

export interface OutstandingInvoicesResult {
  status: string;
  count: number;
  totalCents: number;
  invoices: OutstandingInvoiceItem[];
}

// Mirrors apps/api/src/agent/tools/refund-lookup.ts's result shape by hand, same as
// CustomerInvoicesFound above.
export interface RefundLookupItem {
  id: string;
  amountCents: number;
  customerName: string | null;
  createdAt: string;
}

export interface RefundLookupResult {
  startDate: string;
  endDate: string;
  count: number;
  totalCents: number;
  refunds: RefundLookupItem[];
}

export interface RefundPendingArgs {
  chargeId: string;
  customerId: string;
  customerName: string;
  amountCents: number;
}

export interface SendInvoicePendingArgs {
  draftInvoiceId: string;
  customerName: string;
  totalCents: number;
  dueDate: string;
}

export interface DisputeActionPendingArgs {
  disputeId: string;
  customerName: string | null;
  amountCents: number;
  reason: string;
}

export type PendingAction =
  | { id: string; tool: "refund"; arguments: RefundPendingArgs; expiresAt: number }
  | { id: string; tool: "send_invoice"; arguments: SendInvoicePendingArgs; expiresAt: number }
  | { id: string; tool: "submit_dispute_evidence"; arguments: DisputeActionPendingArgs; expiresAt: number }
  | { id: string; tool: "decline_dispute"; arguments: DisputeActionPendingArgs; expiresAt: number };

// Mirrors apps/api/src/agent/tools/invoice-creation.ts's InvoiceDraft result shape by hand (S10).
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

// Mirrors apps/api/src/agent/tools/dispute-response.ts's DisputeResponseFound shape by hand (S11).
export type EvidenceFieldKey =
  | "customerName"
  | "customerEmailAddress"
  | "billingAddress"
  | "productDescription"
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
  | "refundPolicyDisclosure"
  | "narrative";

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

export interface DisputeResponse {
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

export interface AssistantResponse {
  // Convenience copy of the final assistant message's content — `messages` already contains it
  // (as the last displayable entry) and is what the UI actually renders from.
  reply: string;
  messages: ChatMessage[];
  pendingAction?: PendingAction;
}

export type ConfirmResult = { status: "cancelled" } | { status: "executed"; result: unknown };

// The raw Stripe Invoice fields the UI cares about from a "send_invoice" confirm's result — only
// available once actually sent (a draft has neither), which is why these live separately from
// SendInvoicePendingArgs above rather than being folded into it.
export interface SentInvoice {
  number: string | null;
  hosted_invoice_url: string | null;
}

// Mirrors apps/api/src/agent/dashboard.ts's response shapes — the direct, LLM-free dashboard
// routes (S9). Today's Summary and Payment Activity share the same underlying DailyBucket shape;
// Payment Activity's is just a longer, user-selectable range of it.
export interface DailyBucket {
  date: string;
  totalCents: number;
}

export interface TodaysSummary {
  summary: DailySummary;
  comparison: RevenueComparison;
}

export type PaymentActivityRange = 7 | 30 | 90;

export interface PaymentActivity {
  days: PaymentActivityRange;
  buckets: DailyBucket[];
}

export interface OverdueInvoice {
  id: string;
  customerName: string;
  amountDueCents: number;
  dueDate: string | null;
}

export interface OverdueInvoicesSummary {
  count: number;
  totalCents: number;
  invoices: OverdueInvoice[];
}

export interface Dispute {
  id: string;
  amountCents: number;
  reason: string;
  customerName: string | null;
  dueBy: string | null;
}

export interface DisputesSummary {
  count: number;
  totalCents: number;
  disputes: Dispute[];
}

export interface FailedPayment {
  id: string;
  customerName: string | null;
  customerEmail: string | null;
  amountCents: number;
  failedAt: string;
  description: string | null;
  invoiceUrl: string | null;
}

export interface FailedPaymentsSummary {
  count: number;
  totalCents: number;
  payments: FailedPayment[];
}

export type ReminderTargetType = "overdue_invoice" | "failed_payment";

export interface PaymentReminderItem {
  targetId: string;
  targetType: ReminderTargetType;
  customerName: string;
  customerEmail: string | null;
  amountCents: number;
  invoiceUrl: string | null;
  subject: string;
  body: string;
}

export interface PaymentReminderDraft {
  reminders: PaymentReminderItem[];
}

export interface SendRemindersResult {
  results: { targetId: string; status: "sent" }[];
}

export type RecentActivityEventType = "payment_succeeded" | "payment_failed" | "refund" | "invoice_created";

export interface RecentActivityEvent {
  type: RecentActivityEventType;
  id: string;
  customerName: string | null;
  amountCents: number;
  createdAt: string;
}

export interface RecentActivity {
  events: RecentActivityEvent[];
}

export async function sendMessage(messages: ChatMessage[]): Promise<AssistantResponse> {
  return postJson("/api/assistant", { messages });
}

export async function confirmPendingAction(
  pendingActionId: string,
  action: "confirm" | "cancel",
): Promise<ConfirmResult> {
  return postJson("/api/assistant/confirm", { pendingActionId, action });
}

export async function fetchTodaysSummary(): Promise<TodaysSummary> {
  return getJson("/api/dashboard/summary");
}

export async function fetchPaymentActivity(days: PaymentActivityRange): Promise<PaymentActivity> {
  return getJson(`/api/dashboard/activity?days=${days}`);
}

export async function fetchOverdueInvoices(): Promise<OverdueInvoicesSummary> {
  return getJson("/api/dashboard/overdue-invoices");
}

export async function fetchDisputes(): Promise<DisputesSummary> {
  return getJson("/api/dashboard/disputes");
}

export async function fetchRecentActivity(): Promise<RecentActivity> {
  return getJson("/api/dashboard/recent-activity");
}

export async function fetchFailedPayments(): Promise<FailedPaymentsSummary> {
  return getJson("/api/dashboard/failed-payments");
}

export async function sendPaymentReminders(reminders: PaymentReminderItem[]): Promise<SendRemindersResult> {
  return postJson("/api/reminders/send", { reminders });
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const parsed = await safeJson(res);
    throw new Error(parsed?.error ?? `Request to ${url} failed (${res.status})`);
  }
  return res.json();
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const parsed = await safeJson(res);
    throw new Error(parsed?.error ?? `Request to ${url} failed (${res.status})`);
  }

  return res.json();
}

async function safeJson(res: Response): Promise<{ error?: string } | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

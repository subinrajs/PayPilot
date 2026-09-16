import type Stripe from "stripe";
import { getDailySummary } from "./tools/daily-summary.js";
import { getRevenueComparison } from "./tools/revenue-comparison.js";
import { lookupInvoices } from "./tools/invoice-lookup.js";
import { bucketDailyTotals, type DailyBucket, type DailySummary, type RevenueComparison } from "./aggregation.js";
import { fetchChargesInRange, isoDateToUnixSeconds, lastNDays } from "./charge-fetching.js";
import { displayName, listAllCustomers } from "./customer-resolution.js";

// Backs the dashboard's always-visible panels (routes/dashboard.ts) — called directly, never
// through the OpenAI tool-calling loop. These panels render on page load, before the owner has
// typed anything, so driving them through the LLM would mean a real API call (cost + latency) for
// a passive display that needs no narration at all — the deterministic numbers ARE the display.
// Reuses the exact same tool functions/aggregation the chat surface uses, so there's exactly one
// implementation of "what today's summary means," not a second copy that could drift.

export interface TodaysSummary {
  summary: DailySummary;
  comparison: RevenueComparison;
}

export async function getTodaysSummary(stripe: Stripe): Promise<TodaysSummary> {
  const [today] = lastNDays(1);
  const [yesterday] = lastNDays(2);

  const [summary, comparison] = await Promise.all([
    getDailySummary(stripe, { date: today }),
    getRevenueComparison(stripe, {
      current: { label: "Today", startDate: today, endDate: addDays(today, 1) },
      previous: { label: "Yesterday", startDate: yesterday, endDate: today },
    }),
  ]);

  return { summary, comparison };
}

export type PaymentActivityRange = 7 | 30 | 90;

export interface PaymentActivity {
  days: PaymentActivityRange;
  buckets: DailyBucket[];
}

export async function getPaymentActivity(stripe: Stripe, days: PaymentActivityRange): Promise<PaymentActivity> {
  const dayList = lastNDays(days);
  const startSec = isoDateToUnixSeconds(dayList[0]);
  const endSec = Math.floor(Date.now() / 1000);

  const charges = await fetchChargesInRange(stripe, startSec, endSec);
  return { days, buckets: bucketDailyTotals(charges, dayList) };
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

// Cross-customer — unlike every other tool in agent/tools/, which is scoped to one customer
// (Telegram) or resolves a single customer by name (owner refund/invoice tools). "Needs
// Attention" genuinely needs to know about every customer's overdue invoices at once, so this
// scans the full customer list (reusing listAllCustomers's already-solved test-clock quirk) and
// calls the existing per-customer lookupInvoices once per customer. That's an N+1 Stripe call
// pattern — one customers scan plus one invoices.list per customer — acceptable at this project's
// test-account scale (a handful of seed customers), same reasoning ADR-004 already applies to
// skipping a database; revisit with Stripe's Search API or a cache if this ever needs to scale to
// a real account with many customers.
export async function getOverdueInvoicesSummary(stripe: Stripe): Promise<OverdueInvoicesSummary> {
  const customers: Stripe.Customer[] = [];
  for await (const customer of listAllCustomers(stripe)) {
    customers.push(customer);
  }

  const perCustomer = await Promise.all(
    customers.map(async (customer) => {
      const { invoices } = await lookupInvoices(stripe, customer.id, { status: "overdue" });
      return invoices.map((invoice) => ({
        id: invoice.id,
        customerName: displayName(customer),
        amountDueCents: invoice.amountDueCents,
        dueDate: invoice.dueDate,
      }));
    }),
  );

  const invoices = perCustomer.flat();
  const totalCents = invoices.reduce((sum, invoice) => sum + invoice.amountDueCents, 0);

  return { count: invoices.length, totalCents, invoices };
}

export interface Dispute {
  id: string;
  amountCents: number;
  reason: string;
  // Pulled from the disputed charge's billing_details — a real name without needing to expand
  // (and possibly not find, for a guest/one-off payment) a full Customer object.
  customerName: string | null;
  dueBy: string | null;
}

export interface DisputesSummary {
  count: number;
  totalCents: number;
  disputes: Dispute[];
}

// "Needs attention" means the owner has something to actually do — submit evidence before the
// deadline. Every other dispute status (already responded, already resolved) doesn't belong on a
// panel whose whole point is surfacing outstanding action items.
const DISPUTE_NEEDS_RESPONSE_STATUSES = new Set<Stripe.Dispute.Status>(["needs_response", "warning_needs_response"]);

export async function getDisputesSummary(stripe: Stripe): Promise<DisputesSummary> {
  const disputes: Dispute[] = [];

  for await (const dispute of stripe.disputes.list({ limit: 100, expand: ["data.charge"] })) {
    if (!DISPUTE_NEEDS_RESPONSE_STATUSES.has(dispute.status)) continue;

    const charge = typeof dispute.charge === "object" && dispute.charge !== null ? dispute.charge : null;

    disputes.push({
      id: dispute.id,
      amountCents: dispute.amount,
      reason: dispute.reason,
      customerName: charge?.billing_details.name ?? null,
      dueBy: dispute.evidence_details.due_by ? new Date(dispute.evidence_details.due_by * 1000).toISOString() : null,
    });
  }

  const totalCents = disputes.reduce((sum, dispute) => sum + dispute.amountCents, 0);
  return { count: disputes.length, totalCents, disputes };
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

const RECENT_ACTIVITY_LIMIT = 10;

// Combines three separate Stripe object streams (charges, refunds, invoices) into one
// chronological feed, account-wide. Deliberately does NOT also surface "invoice paid" as its own
// event — the charge that pays an invoice already appears via the charges stream, and showing
// both would double-count the same money movement as two entries. Each stream is fetched
// independently at this same limit and only merged+trimmed after sorting, so a burst of activity
// in one stream (e.g. many refunds) can't crowd out genuinely more recent events from another.
export async function getRecentActivity(stripe: Stripe): Promise<RecentActivity> {
  const [charges, refunds, invoices] = await Promise.all([
    stripe.charges.list({ limit: RECENT_ACTIVITY_LIMIT }),
    stripe.refunds.list({ limit: RECENT_ACTIVITY_LIMIT, expand: ["data.charge"] }),
    stripe.invoices.list({ limit: RECENT_ACTIVITY_LIMIT }),
  ]);

  const chargeEvents: RecentActivityEvent[] = charges.data
    .filter((charge) => charge.status === "succeeded" || charge.status === "failed")
    .map((charge) => ({
      type: charge.status === "succeeded" ? "payment_succeeded" : "payment_failed",
      id: charge.id,
      customerName: charge.billing_details.name,
      amountCents: charge.amount,
      createdAt: new Date(charge.created * 1000).toISOString(),
    }));

  const refundEvents: RecentActivityEvent[] = refunds.data.map((refund) => {
    const charge = typeof refund.charge === "object" && refund.charge !== null ? refund.charge : null;
    return {
      type: "refund",
      id: refund.id,
      customerName: charge?.billing_details.name ?? null,
      amountCents: refund.amount,
      createdAt: new Date(refund.created * 1000).toISOString(),
    };
  });

  const invoiceEvents: RecentActivityEvent[] = invoices.data.map((invoice) => ({
    type: "invoice_created",
    id: invoice.id,
    customerName: invoice.customer_name,
    amountCents: invoice.amount_due,
    createdAt: new Date(invoice.created * 1000).toISOString(),
  }));

  const events = [...chargeEvents, ...refundEvents, ...invoiceEvents]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, RECENT_ACTIVITY_LIMIT);

  return { events };
}

function addDays(isoDate: string, count: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}

import { useEffect, useState } from "react";
import {
  fetchDisputes,
  fetchFailedPayments,
  fetchOverdueInvoices,
  type DisputesSummary,
  type FailedPaymentsSummary,
  type OverdueInvoicesSummary,
} from "../api.js";
import { formatCents } from "../format.js";

// A short, human "in 2h" / "in 3d" / "overdue" label for a dispute's evidence deadline — mirrors
// the reference mockup's "(Expires in 2h)" framing without needing a date-formatting dependency.
function formatDueBy(dueBy: string | null): string | null {
  if (!dueBy) return null;
  const diffMs = new Date(dueBy).getTime() - Date.now();
  if (diffMs <= 0) return "overdue";

  const hours = Math.round(diffMs / (60 * 60 * 1000));
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

// Same relative-time idea as formatDueBy above, but for a past timestamp (a charge that already
// failed) rather than a future deadline — "Xh/Xd ago" instead of "in Xh/Xd".
function formatFailedAgo(failedAt: string): string {
  const diffMs = Date.now() - new Date(failedAt).getTime();
  const hours = Math.round(diffMs / (60 * 60 * 1000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

interface NeedsAttentionPanelProps {
  onSendText: (text: string) => void;
}

export function NeedsAttentionPanel({ onSendText }: NeedsAttentionPanelProps) {
  const [disputes, setDisputes] = useState<DisputesSummary | null>(null);
  const [overdue, setOverdue] = useState<OverdueInvoicesSummary | null>(null);
  const [failedPayments, setFailedPayments] = useState<FailedPaymentsSummary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchDisputes()
      .then((data) => {
        if (!cancelled) setDisputes(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    fetchOverdueInvoices()
      .then((data) => {
        if (!cancelled) setOverdue(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    fetchFailedPayments()
      .then((data) => {
        if (!cancelled) setFailedPayments(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loaded = disputes !== null && overdue !== null && failedPayments !== null;
  const hasIssues = loaded && (disputes.count > 0 || overdue.count > 0 || failedPayments.count > 0);
  // S14 (docs/feature.md) — one combined trigger for everything currently overdue/failed, rather
  // than a per-row button, so the model drafts every reminder in one tool call and the review
  // card's single "Send all" button has one coherent batch to act on.
  const needsReminder = loaded && overdue.count + failedPayments.count > 0;

  return (
    <div
      className={`rounded-3xl p-4 ring-1 ${
        hasIssues ? "bg-amber-500/10 ring-amber-500/30" : "bg-white/[0.04] ring-white/10"
      }`}
    >
      <p className={`text-xs font-medium uppercase tracking-wide ${hasIssues ? "text-amber-400" : "text-slate-400"}`}>
        Needs Attention
      </p>

      {error && <p className="mt-2 text-sm text-slate-400">Couldn't load everything below — try refreshing.</p>}
      {!error && !loaded && <p className="mt-2 text-sm text-slate-400">Loading…</p>}

      {loaded && !hasIssues && <p className="mt-2 text-sm text-slate-300">Nothing needs attention right now.</p>}

      {loaded && disputes.count > 0 && (
        <div className="mt-1.5">
          <p className="text-sm font-semibold text-white">
            {disputes.count} payment dispute{disputes.count === 1 ? "" : "s"} ({formatCents(disputes.totalCents)} total)
          </p>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {disputes.disputes.map((dispute) => (
              <div key={dispute.id} className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-slate-300">{dispute.customerName ?? "Unknown customer"}</span>
                  <span className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap">
                    <span className="font-medium text-white">{formatCents(dispute.amountCents)}</span>
                    {formatDueBy(dispute.dueBy) && <span className="text-xs text-amber-400">({formatDueBy(dispute.dueBy)})</span>}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onSendText(
                      `Show me the evidence for dispute ${dispute.id} (${dispute.customerName ?? "unknown customer"}, ${formatCents(dispute.amountCents)}).`,
                    )
                  }
                  className="self-start text-xs font-medium text-amber-400 hover:underline"
                >
                  Review Response →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loaded && overdue.count > 0 && (
        <div className={disputes.count > 0 ? "mt-3" : "mt-1.5"}>
          <p className="text-sm font-semibold text-white">
            {overdue.count} overdue invoice{overdue.count === 1 ? "" : "s"} ({formatCents(overdue.totalCents)} total)
          </p>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {overdue.invoices.map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-slate-300">{invoice.customerName}</span>
                <span className="whitespace-nowrap font-medium text-white">{formatCents(invoice.amountDueCents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loaded && failedPayments.count > 0 && (
        <div className={disputes.count > 0 || overdue.count > 0 ? "mt-3" : "mt-1.5"}>
          <p className="text-sm font-semibold text-white">
            {failedPayments.count} failed payment{failedPayments.count === 1 ? "" : "s"} ({formatCents(failedPayments.totalCents)} total)
          </p>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {failedPayments.payments.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-slate-300">{payment.customerName ?? "Unknown customer"}</span>
                <span className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap">
                  <span className="font-medium text-white">{formatCents(payment.amountCents)}</span>
                  <span className="text-xs text-amber-400">({formatFailedAgo(payment.failedAt)})</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {needsReminder && (
        <button
          type="button"
          onClick={() =>
            onSendText("Draft payment reminder emails for everyone currently in Needs Attention (overdue invoices and failed payments).")
          }
          className="mt-3 self-start text-xs font-medium text-amber-400 hover:underline"
        >
          Send Notification →
        </button>
      )}
    </div>
  );
}

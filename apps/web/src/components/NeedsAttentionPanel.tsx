import { useEffect, useState } from "react";
import {
  fetchDisputes,
  fetchOverdueInvoices,
  type DisputesSummary,
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

export function NeedsAttentionPanel() {
  const [disputes, setDisputes] = useState<DisputesSummary | null>(null);
  const [overdue, setOverdue] = useState<OverdueInvoicesSummary | null>(null);
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

    return () => {
      cancelled = true;
    };
  }, []);

  const loaded = disputes !== null && overdue !== null;
  const hasIssues = loaded && (disputes.count > 0 || overdue.count > 0);

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
              <div key={dispute.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-slate-300">{dispute.customerName ?? "Unknown customer"}</span>
                <span className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap">
                  <span className="font-medium text-white">{formatCents(dispute.amountCents)}</span>
                  {formatDueBy(dispute.dueBy) && <span className="text-xs text-amber-400">({formatDueBy(dispute.dueBy)})</span>}
                </span>
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
    </div>
  );
}

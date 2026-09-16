import type { RefundLookupResult } from "../api.js";
import { formatCents } from "../format.js";

interface RefundsTileProps {
  data: RefundLookupResult;
}

// endDate is exclusive (matches revenue-comparison's convention) — the last inclusive day shown
// to the owner is one day before it.
function lastInclusiveDay(endDateExclusive: string): string {
  const d = new Date(`${endDateExclusive}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function RefundsTile({ data }: RefundsTileProps) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-3xl bg-white/[0.05] p-4 ring-1 ring-white/10">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Refunds, {data.startDate} to {lastInclusiveDay(data.endDate)} — {data.count} total, {formatCents(data.totalCents)}
        </p>

        {data.refunds.length === 0 ? (
          <p className="mt-2 text-sm text-slate-300">No refunds in this range.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {data.refunds.map((refund) => (
              <div key={refund.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{refund.customerName ?? "Unknown customer"}</p>
                  <p className="text-xs text-slate-400">{refund.createdAt.slice(0, 10)}</p>
                </div>
                <span className="flex-shrink-0 text-sm font-semibold text-white">{formatCents(refund.amountCents)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

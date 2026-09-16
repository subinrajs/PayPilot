import type { DailySummary } from "../api.js";
import { formatCents } from "../format.js";

interface DailySummaryTileProps {
  data: DailySummary;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] px-3 py-2">
      <p className="text-[0.65rem] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

export function DailySummaryTile({ data }: DailySummaryTileProps) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-3xl bg-white/[0.05] p-4 ring-1 ring-white/10">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Daily summary — {data.date}</p>

        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">{formatCents(data.netTotalCents)}</span>
          <span className="text-sm text-slate-400">net revenue</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Successful" value={String(data.succeededCount)} />
          <Stat label="Gross" value={formatCents(data.succeededTotalCents)} />
          <Stat label="Refunded" value={formatCents(data.refundedTotalCents)} />
          <Stat label="Failed" value={String(data.failedCount)} />
        </div>
      </div>
    </div>
  );
}

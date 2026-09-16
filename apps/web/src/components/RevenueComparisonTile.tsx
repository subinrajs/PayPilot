import type { RevenueComparison, RevenuePeriod } from "../api.js";
import { formatCents } from "../format.js";

interface RevenueComparisonTileProps {
  data: RevenueComparison;
}

function PeriodBlock({ period }: { period: RevenuePeriod }) {
  return (
    <div className="flex-1 rounded-2xl bg-white/[0.04] px-3 py-2.5">
      <p className="text-[0.65rem] font-medium uppercase tracking-wide text-slate-400">{period.label}</p>
      <p className="mt-0.5 text-xl font-bold text-white">{formatCents(period.totalCents)}</p>
      <p className="mt-0.5 text-xs text-slate-400">{period.chargeCount} payments</p>
    </div>
  );
}

export function RevenueComparisonTile({ data }: RevenueComparisonTileProps) {
  const isUp = data.differenceCents >= 0;
  const deltaColor = isUp ? "text-accent-confirm" : "text-danger";
  const sign = isUp ? "+" : "";
  const percentText =
    data.percentChange === null ? "n/a" : `${isUp ? "+" : ""}${data.percentChange.toFixed(1)}%`;

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-3xl bg-white/[0.05] p-4 ring-1 ring-white/10">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Revenue comparison</p>

        <div className="mt-2 flex gap-2">
          <PeriodBlock period={data.current} />
          <PeriodBlock period={data.previous} />
        </div>

        <p className={`mt-3 text-sm font-semibold ${deltaColor}`}>
          {isUp ? "▲" : "▼"} {sign}
          {formatCents(Math.abs(data.differenceCents))} ({percentText})
        </p>
      </div>
    </div>
  );
}

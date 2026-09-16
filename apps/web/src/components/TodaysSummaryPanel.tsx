import { useEffect, useState } from "react";
import { fetchPaymentActivity, fetchTodaysSummary, type DailyBucket, type TodaysSummary } from "../api.js";
import { formatCents } from "../format.js";
import { BarChart } from "./BarChart.js";

function formatPercent(percentChange: number | null): string | null {
  if (percentChange === null) return null;
  const sign = percentChange >= 0 ? "+" : "";
  return `${sign}${percentChange.toFixed(0)}%`;
}

export function TodaysSummaryPanel() {
  const [summary, setSummary] = useState<TodaysSummary | null>(null);
  const [buckets, setBuckets] = useState<DailyBucket[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Guards against setting state after unmount (fetch resolving after a quick navigation away)
    // — no re-fetch trigger here (empty deps), but cheap to guard consistently with
    // PaymentActivityPanel rather than only where a race was actually observed.
    let cancelled = false;

    fetchTodaysSummary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    fetchPaymentActivity(7)
      .then((activity) => {
        if (!cancelled) setBuckets(activity.buckets);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-3xl bg-white/[0.04] p-4 ring-1 ring-white/10">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Today's Summary</p>

      {error && <p className="mt-2 text-sm text-slate-400">Couldn't load today's summary.</p>}

      {!error && !summary && <p className="mt-2 text-sm text-slate-400">Loading…</p>}

      {summary && (
        <>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{formatCents(summary.summary.netTotalCents)}</span>
            {formatPercent(summary.comparison.percentChange) && (
              <span
                className={
                  summary.comparison.percentChange !== null && summary.comparison.percentChange >= 0
                    ? "text-sm font-semibold text-accent-confirm"
                    : "text-sm font-semibold text-danger"
                }
              >
                {formatPercent(summary.comparison.percentChange)}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">Sales vs. yesterday</p>

          {summary.summary.failedCount > 0 && (
            <p className="mt-1 text-xs text-danger">{summary.summary.failedCount} failed charge(s)</p>
          )}
        </>
      )}

      {buckets.length > 0 && (
        <div className="mt-3">
          <BarChart buckets={buckets} />
          <p className="mt-1 text-center text-[0.65rem] text-slate-500">Last 7 days</p>
        </div>
      )}
    </div>
  );
}

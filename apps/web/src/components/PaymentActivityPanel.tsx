import { useEffect, useState } from "react";
import { fetchPaymentActivity, type DailyBucket, type PaymentActivityRange } from "../api.js";
import { LineChart } from "./LineChart.js";

const RANGES: PaymentActivityRange[] = [7, 30, 90];

export function PaymentActivityPanel() {
  const [range, setRange] = useState<PaymentActivityRange>(7);
  const [buckets, setBuckets] = useState<DailyBucket[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    // A stale-response guard: if `range` changes again before this fetch resolves (e.g. clicking
    // 30 days shortly after mount, while the initial 7-day fetch is still in flight), the earlier
    // request must not be allowed to overwrite the newer selection just because it happens to
    // resolve later — `cancelled` is flipped by this effect's own cleanup the moment a newer run
    // starts, so only the most recent request's result is ever applied.
    let cancelled = false;
    setBuckets(null);
    setError(false);

    fetchPaymentActivity(range)
      .then((activity) => {
        if (!cancelled) setBuckets(activity.buckets);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="rounded-3xl bg-white/[0.04] p-4 ring-1 ring-white/10">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Payment Activity</p>
      </div>

      <div className="mt-2 flex gap-1.5">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              range === r ? "bg-bubble-user text-white" : "bg-white/[0.06] text-slate-300 hover:bg-white/10"
            }`}
          >
            {r} days
          </button>
        ))}
      </div>

      <div className="mt-3 text-slate-300">
        {error && <p className="text-sm text-slate-400">Couldn't load payment activity.</p>}
        {!error && !buckets && <p className="text-sm text-slate-400">Loading…</p>}
        {buckets && <LineChart buckets={buckets} />}
      </div>
    </div>
  );
}

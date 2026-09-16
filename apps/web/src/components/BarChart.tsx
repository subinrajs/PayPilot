import type { DailyBucket } from "../api.js";

interface BarChartProps {
  buckets: DailyBucket[];
}

// A small hand-rolled bar chart (flex row of divs, heights proportional to value) rather than a
// charting dependency — the data here is always a handful of points, not worth a new library for.
export function BarChart({ buckets }: BarChartProps) {
  const max = Math.max(1, ...buckets.map((b) => b.totalCents));

  return (
    <div className="flex h-16 gap-1.5">
      {buckets.map((bucket) => {
        const heightPct = Math.max(4, Math.round((bucket.totalCents / max) * 100));
        return (
          <div
            key={bucket.date}
            className="flex flex-1 flex-col justify-end"
            title={`${bucket.date}: $${(bucket.totalCents / 100).toFixed(2)}`}
          >
            <div
              className="mx-auto w-full max-w-[10px] rounded-full bg-bubble-user"
              style={{ height: `${heightPct}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

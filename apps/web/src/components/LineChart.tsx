import type { DailyBucket } from "../api.js";

interface LineChartProps {
  buckets: DailyBucket[];
}

const WIDTH = 280;
const HEIGHT = 96;
const PADDING = 8;

// A small hand-rolled SVG line chart — same reasoning as BarChart.tsx for not reaching for a
// charting library. Renders nothing (rather than a divide-by-zero chart) when there are fewer
// than two points to connect.
export function LineChart({ buckets }: LineChartProps) {
  if (buckets.length < 2) return null;

  const max = Math.max(1, ...buckets.map((b) => b.totalCents));
  const min = Math.min(0, ...buckets.map((b) => b.totalCents));
  const range = max - min || 1;

  const points = buckets.map((bucket, i) => {
    const x = PADDING + (i / (buckets.length - 1)) * (WIDTH - PADDING * 2);
    const y = HEIGHT - PADDING - ((bucket.totalCents - min) / range) * (HEIGHT - PADDING * 2);
    return { x, y, bucket };
  });

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Payment activity over time">
      <polyline points={polylinePoints} fill="none" stroke="currentColor" strokeWidth={2} className="text-bubble-user" />
      {points.map(({ x, y, bucket }) => (
        <circle key={bucket.date} cx={x} cy={y} r={3} className="fill-bubble-user">
          <title>{`${bucket.date}: $${(bucket.totalCents / 100).toFixed(2)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

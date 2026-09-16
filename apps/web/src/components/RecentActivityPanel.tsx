import { useEffect, useState } from "react";
import { fetchRecentActivity, type RecentActivity, type RecentActivityEvent, type RecentActivityEventType } from "../api.js";
import { formatCents } from "../format.js";

// A short "2h ago" / "3d ago" relative-time label — mirrors formatDueBy's style in
// NeedsAttentionPanel without needing a date-formatting dependency.
function formatRelativeTime(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.round(diffMs / (60 * 1000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const EVENT_LABELS: Record<RecentActivityEventType, string> = {
  payment_succeeded: "Payment received",
  payment_failed: "Payment failed",
  refund: "Refund processed",
  invoice_created: "Invoice created",
};

const EVENT_COLORS: Record<RecentActivityEventType, string> = {
  payment_succeeded: "bg-emerald-400",
  payment_failed: "bg-red-400",
  refund: "bg-amber-400",
  invoice_created: "bg-sky-400",
};

function EventRow({ event }: { event: RecentActivityEvent }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${EVENT_COLORS[event.type]}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-slate-300">
            {EVENT_LABELS[event.type]}
            {event.customerName ? ` — ${event.customerName}` : ""}
          </p>
          <span className="flex-shrink-0 font-medium text-white">{formatCents(event.amountCents)}</span>
        </div>
        <p className="text-xs text-slate-500">{formatRelativeTime(event.createdAt)}</p>
      </div>
    </div>
  );
}

export function RecentActivityPanel() {
  const [activity, setActivity] = useState<RecentActivity | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchRecentActivity()
      .then((data) => {
        if (!cancelled) setActivity(data);
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
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Recent Activity</p>

      {error && <p className="mt-2 text-sm text-slate-400">Couldn't load recent activity — try refreshing.</p>}
      {!error && activity === null && <p className="mt-2 text-sm text-slate-400">Loading…</p>}
      {activity !== null && activity.events.length === 0 && (
        <p className="mt-2 text-sm text-slate-300">No activity yet.</p>
      )}

      {activity !== null && activity.events.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {activity.events.map((event) => (
            <EventRow key={`${event.type}-${event.id}`} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

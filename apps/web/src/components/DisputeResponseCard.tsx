import type { DisputeResponse } from "../api.js";
import { formatCents } from "../format.js";

interface DisputeResponseCardProps {
  data: DisputeResponse;
  onSendText: (text: string) => void;
  onEditRequest: () => void;
}

function formatReason(reason: string): string {
  const spaced = reason.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function flagIcon(severity: "ok" | "warning" | "info"): string {
  if (severity === "warning") return "⚠";
  if (severity === "info") return "ℹ";
  return "✓";
}

function flagColor(severity: "ok" | "warning" | "info"): string {
  if (severity === "warning") return "text-amber-400";
  if (severity === "info") return "text-slate-400";
  return "text-accent-confirm";
}

export function DisputeResponseCard({ data, onSendText, onEditRequest }: DisputeResponseCardProps) {
  const evidenceFields = data.evidenceFields.filter((f) => f.key !== "narrative");

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-3xl bg-white/[0.05] p-4 ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Dispute response</p>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.7rem] font-medium text-slate-300">
            {formatReason(data.reason)}
          </span>
        </div>

        <p className="mt-1 truncate text-sm font-semibold text-white">{data.customerName ?? "Unknown customer"}</p>
        {data.chargeDescription && <p className="text-xs text-slate-400">{data.chargeDescription}</p>}

        <div className="mt-1.5 flex items-baseline justify-between gap-3">
          <span className="text-xl font-semibold text-white">{formatCents(data.amountCents)}</span>
          {data.dueBy && (
            <span className="whitespace-nowrap text-xs text-amber-400">Respond by {data.dueBy.slice(0, 10)}</span>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-1.5 border-y border-white/10 py-3">
          {evidenceFields.map((field) => (
            <div key={field.key} className="flex items-start justify-between gap-3 text-sm">
              <div className="flex min-w-0 items-start gap-2">
                <span className={flagColor(field.status === "found" ? "ok" : "warning")}>
                  {field.status === "found" ? "✓" : "⚠"}
                </span>
                <span className="truncate text-slate-300">{field.label}</span>
              </div>
              {field.value && (
                <span className="max-w-[45%] flex-shrink-0 truncate text-xs text-slate-400">{field.value}</span>
              )}
            </div>
          ))}
        </div>

        {data.narrative && (
          <div className="mt-3 rounded-2xl bg-white/[0.04] p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">AI-drafted response</p>
            <p className="mt-1 text-sm text-slate-200">{data.narrative}</p>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-1.5">
          {data.assessment.map((flag, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className={flagColor(flag.severity)}>{flagIcon(flag.severity)}</span>
              <span className="text-slate-300">{flag.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={data.narrative ? onEditRequest : () => onSendText("Please draft a response with the evidence we have on file.")}
            className="flex-1 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            {data.narrative ? "Edit" : "Prepare Response"}
          </button>
          <button
            type="button"
            onClick={() => onSendText("Decline to contest this dispute.")}
            className="flex-1 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            Decline to Contest
          </button>
          {data.narrative && (
            <button
              type="button"
              onClick={() => onSendText("Submit the evidence.")}
              className="flex-1 rounded-full bg-accent-confirm px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Submit Evidence
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

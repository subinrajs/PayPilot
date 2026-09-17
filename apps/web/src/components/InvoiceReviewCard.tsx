import type { InvoiceDraft } from "../api.js";
import { formatCents } from "../format.js";

interface InvoiceReviewCardProps {
  data: InvoiceDraft;
  onSendText: (text: string) => void;
  onEditRequest: () => void;
}

export function InvoiceReviewCard({ data, onSendText, onEditRequest }: InvoiceReviewCardProps) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-3xl bg-white/[0.05] p-4 ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Invoice draft</p>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.7rem] font-medium text-slate-300">Draft</span>
        </div>

        <p className="mt-1 truncate text-sm font-semibold text-white">{data.customerName}</p>
        {data.customerEmail && <p className="text-xs text-slate-400">{data.customerEmail}</p>}

        <div className="mt-3 flex flex-col gap-1.5 border-y border-white/10 py-3">
          {data.items.map((item, i) => (
            <div key={i} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate text-slate-200">{item.description}</p>
                <p className="text-xs text-slate-500">
                  Qty {item.quantity} × {formatCents(item.unitAmountCents)}
                </p>
              </div>
              <span className="flex-shrink-0 font-medium text-white">{formatCents(item.amountCents)}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-col gap-1 text-sm">
          <div className="flex justify-between text-slate-300">
            <span>Subtotal</span>
            <span>{formatCents(data.subtotalCents)}</span>
          </div>
          <div className="flex justify-between font-semibold text-white">
            <span>Total</span>
            <span>{formatCents(data.subtotalCents)}</span>
          </div>
          <p className="text-xs text-slate-500">Due {data.dueDate}</p>
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          {data.reviewFlags.map((flag, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className={flag.severity === "warning" ? "text-amber-400" : "text-accent-confirm"}>
                {flag.severity === "warning" ? "⚠" : "✓"}
              </span>
              <span className="text-slate-300">{flag.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onEditRequest}
            className="flex-1 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onSendText("Discard this invoice draft.")}
            className="flex-1 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => onSendText("Send it.")}
            className="flex-1 rounded-full bg-accent-confirm px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Approve &amp; Send
          </button>
        </div>
      </div>
    </div>
  );
}

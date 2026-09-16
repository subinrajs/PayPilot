import type { CustomerInvoicesFound, InvoiceLookupResultItem } from "../api.js";
import { formatCents } from "../format.js";

interface CustomerInvoicesTileProps {
  data: CustomerInvoicesFound;
}

// Exported for reuse by OutstandingInvoicesTile — same badge logic, just applied to invoices
// from more than one customer at once.
export function statusBadge(invoice: InvoiceLookupResultItem): { label: string; className: string } {
  if (invoice.overdue) return { label: "Overdue", className: "bg-danger/15 text-red-300" };
  if (invoice.status === "paid") return { label: "Paid", className: "bg-accent-confirm/15 text-accent-confirm" };
  if (invoice.status === "open") return { label: "Open", className: "bg-bubble-user/20 text-blue-300" };
  return { label: invoice.status, className: "bg-white/10 text-slate-300" };
}

export function CustomerInvoicesTile({ data }: CustomerInvoicesTileProps) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-3xl bg-white/[0.05] p-4 ring-1 ring-white/10">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-400">
          {data.customerName} — invoices
        </p>

        {data.invoices.length === 0 ? (
          <p className="mt-2 text-sm text-slate-300">No outstanding invoices.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {data.invoices.map((invoice) => {
              const badge = statusBadge(invoice);
              return (
                <div key={invoice.id} className="rounded-2xl bg-white/[0.04] px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{invoice.description ?? "Invoice"}</p>
                      {invoice.dueDate && (
                        <p className="text-xs text-slate-400">due {invoice.dueDate.slice(0, 10)}</p>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                      <span className="whitespace-nowrap text-sm font-semibold text-white">
                        {formatCents(invoice.amountDueCents)}
                      </span>
                    </div>
                  </div>
                  {invoice.hostedInvoiceUrl && (
                    <a
                      href={invoice.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-xs font-medium text-blue-300 hover:underline"
                    >
                      View invoice ↗
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

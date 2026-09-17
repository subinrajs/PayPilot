import { useState } from "react";
import { sendPaymentReminders, type PaymentReminderDraft, type PaymentReminderItem } from "../api.js";
import { formatCents } from "../format.js";

interface PaymentReminderCardProps {
  data: PaymentReminderDraft;
}

type SendState = "idle" | "sending" | "sent" | "error";

// S14 (docs/feature.md) — unlike InvoiceReviewCard/DisputeResponseCard, this card manages its own
// editing entirely in local state rather than routing through App.tsx's shared editHint/
// focusSignal mechanism. That mechanism is built for exactly one editable thing at a time (a
// single global hint string, one shared chat input) — retrofitting it for N independent drafts in
// one tile would mean threading an item id through it everywhere it's used. Editing text that's
// already been drafted needs no LLM reasoning at all, so there's nothing to gain from a round-trip
// through the chat — a plain textarea toggled per item is simpler and correct.
export function PaymentReminderCard({ data }: PaymentReminderCardProps) {
  const [items, setItems] = useState<PaymentReminderItem[]>(data.reminders);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [sendState, setSendState] = useState<Record<number, SendState>>({});
  const [sendingAll, setSendingAll] = useState(false);

  function updateItem(index: number, patch: Partial<PaymentReminderItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function sendOne(index: number) {
    setSendState((prev) => ({ ...prev, [index]: "sending" }));
    try {
      await sendPaymentReminders([items[index]]);
      setSendState((prev) => ({ ...prev, [index]: "sent" }));
    } catch {
      setSendState((prev) => ({ ...prev, [index]: "error" }));
    }
  }

  async function sendAll() {
    const pending = items.map((_, i) => i).filter((i) => sendState[i] !== "sent");
    if (pending.length === 0) return;

    setSendingAll(true);
    setSendState((prev) => {
      const next = { ...prev };
      for (const i of pending) next[i] = "sending";
      return next;
    });

    try {
      await sendPaymentReminders(pending.map((i) => items[i]));
      setSendState((prev) => {
        const next = { ...prev };
        for (const i of pending) next[i] = "sent";
        return next;
      });
    } catch {
      setSendState((prev) => {
        const next = { ...prev };
        for (const i of pending) next[i] = "error";
        return next;
      });
    } finally {
      setSendingAll(false);
    }
  }

  const allSent = items.length > 0 && items.every((_, i) => sendState[i] === "sent");

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-3xl bg-white/[0.05] p-4 ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Payment reminders</p>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.7rem] font-medium text-slate-300">
            {items.length} draft{items.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          {items.map((item, index) => {
            const state = sendState[index] ?? "idle";
            const isEditing = editingIndex === index;
            const isSent = state === "sent";

            return (
              <div key={item.targetId} className="rounded-2xl bg-white/[0.04] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-white">{item.customerName}</p>
                  <span className="whitespace-nowrap text-sm font-medium text-white">{formatCents(item.amountCents)}</span>
                </div>
                <p className="text-xs text-slate-400">
                  {item.targetType === "overdue_invoice" ? "Overdue invoice" : "Failed payment"}
                  {item.customerEmail ? ` · ${item.customerEmail}` : " · no email on file"}
                </p>

                {isEditing ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <input
                      value={item.subject}
                      onChange={(e) => updateItem(index, { subject: e.target.value })}
                      className="w-full rounded-lg bg-white/[0.06] px-2 py-1.5 text-sm text-white ring-1 ring-white/10 focus:outline-none focus:ring-1 focus:ring-accent-confirm"
                    />
                    <textarea
                      value={item.body}
                      onChange={(e) => updateItem(index, { body: e.target.value })}
                      rows={4}
                      className="w-full rounded-lg bg-white/[0.06] px-2 py-1.5 text-sm text-slate-200 ring-1 ring-white/10 focus:outline-none focus:ring-1 focus:ring-accent-confirm"
                    />
                  </div>
                ) : (
                  <div className="mt-2 min-w-0">
                    <p className="break-words text-sm font-medium text-slate-200">{item.subject}</p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-400">{item.body}</p>
                    {item.invoiceUrl && (
                      <a
                        href={item.invoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-block text-sm font-medium text-blue-300 hover:underline"
                      >
                        View invoice ↗
                      </a>
                    )}
                  </div>
                )}

                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingIndex(isEditing ? null : index)}
                    disabled={isSent}
                    className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isEditing ? "Done" : "Edit"}
                  </button>
                  <button
                    type="button"
                    onClick={() => sendOne(index)}
                    disabled={state === "sending" || isSent}
                    className="rounded-full bg-accent-confirm px-3 py-1 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSent ? "✓ Sent" : state === "sending" ? "Sending…" : "Send"}
                  </button>
                  {state === "error" && <span className="text-xs text-red-300">Couldn't send — try again</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={sendAll}
            disabled={sendingAll || allSent}
            className="w-full rounded-full bg-accent-confirm px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {allSent ? "✓ All sent" : sendingAll ? "Sending all…" : "Send all"}
          </button>
        </div>
      </div>
    </div>
  );
}

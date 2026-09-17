import { useState } from "react";
import type { PendingAction } from "../api.js";
import { formatCents } from "../format.js";

export function describePendingAction(action: PendingAction): string {
  if (action.tool === "refund") {
    return `Refund ${formatCents(action.arguments.amountCents)} to ${action.arguments.customerName}`;
  }
  return (
    `Send a ${formatCents(action.arguments.totalCents)} invoice to ${action.arguments.customerName}, ` +
    `due ${action.arguments.dueDate}`
  );
}

function actionLabel(action: PendingAction): string {
  return action.tool === "refund" ? "Refund" : "Send invoice";
}

function displayAmountCents(action: PendingAction): number {
  return action.tool === "refund" ? action.arguments.amountCents : action.arguments.totalCents;
}

function confirmationCopy(action: PendingAction): string {
  return action.tool === "refund"
    ? "This action needs your confirmation before anything happens in Stripe."
    : "The draft is already saved in Stripe — nothing is emailed to the customer until you confirm.";
}

interface PendingActionPanelProps {
  action: PendingAction;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
}

export function PendingActionPanel({ action, onConfirm, onCancel }: PendingActionPanelProps) {
  const [busy, setBusy] = useState(false);

  async function handle(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="group"
      aria-label={describePendingAction(action)}
      className="rounded-3xl bg-white/[0.05] p-4 shadow-lg shadow-black/20 ring-1 ring-white/10 backdrop-blur-xl"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-300">{actionLabel(action)}</p>

      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <span className="text-base font-medium text-white">{action.arguments.customerName}</span>
        <span className="whitespace-nowrap text-xl font-semibold text-white">{formatCents(displayAmountCents(action))}</span>
      </div>

      {action.tool === "send_invoice" && (
        <p className="mt-1 text-xs text-slate-300">due {action.arguments.dueDate}</p>
      )}

      <p className="mt-2 text-sm text-slate-300">{confirmationCopy(action)}</p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => handle(onConfirm)}
          className="flex-1 rounded-full bg-accent-confirm px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Confirm
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => handle(onCancel)}
          className="flex-1 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

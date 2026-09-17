import { useState } from "react";
import type { PendingAction } from "../api.js";
import { formatCents } from "../format.js";

export function describePendingAction(action: PendingAction): string {
  switch (action.tool) {
    case "refund":
      return `Refund ${formatCents(action.arguments.amountCents)} to ${action.arguments.customerName}`;
    case "send_invoice":
      return (
        `Send a ${formatCents(action.arguments.totalCents)} invoice to ${action.arguments.customerName}, ` +
        `due ${action.arguments.dueDate}`
      );
    case "submit_dispute_evidence":
      return `Submit evidence for the ${formatCents(action.arguments.amountCents)} dispute from ${action.arguments.customerName ?? "the customer"}`;
    case "decline_dispute":
      return `Decline to contest the ${formatCents(action.arguments.amountCents)} dispute from ${action.arguments.customerName ?? "the customer"}`;
  }
}

function actionLabel(action: PendingAction): string {
  switch (action.tool) {
    case "refund":
      return "Refund";
    case "send_invoice":
      return "Send invoice";
    case "submit_dispute_evidence":
      return "Submit dispute evidence";
    case "decline_dispute":
      return "Decline dispute";
  }
}

function displayCustomerName(action: PendingAction): string {
  return action.arguments.customerName ?? "Unknown customer";
}

function displayAmountCents(action: PendingAction): number {
  return action.tool === "send_invoice" ? action.arguments.totalCents : action.arguments.amountCents;
}

function confirmationCopy(action: PendingAction): string {
  switch (action.tool) {
    case "refund":
      return "This action needs your confirmation before anything happens in Stripe.";
    case "send_invoice":
      return "The draft is already saved in Stripe — nothing is emailed to the customer until you confirm.";
    case "submit_dispute_evidence":
      return "The response is already staged in Stripe — nothing is sent to the card network until you confirm. PayPilot can't guarantee the outcome.";
    case "decline_dispute":
      return "This concedes the dispute and cannot be undone once confirmed.";
  }
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
        <span className="text-base font-medium text-white">{displayCustomerName(action)}</span>
        <span className="whitespace-nowrap text-xl font-semibold text-white">{formatCents(displayAmountCents(action))}</span>
      </div>

      {action.tool === "send_invoice" && (
        <p className="mt-1 text-xs text-slate-300">due {action.arguments.dueDate}</p>
      )}
      {(action.tool === "submit_dispute_evidence" || action.tool === "decline_dispute") && (
        <p className="mt-1 text-xs text-slate-300">{action.arguments.reason.replace(/_/g, " ")}</p>
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

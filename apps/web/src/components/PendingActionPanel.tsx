import { useState } from "react";
import type { PendingAction } from "../api.js";
import { formatCents } from "../format.js";

export function describePendingAction(action: PendingAction): string {
  if (action.tool === "refund") {
    return `Refund ${formatCents(action.arguments.amountCents)} to ${action.arguments.customerName}`;
  }
  return (
    `Create a ${formatCents(action.arguments.amountCents)} invoice for ${action.arguments.customerName}, ` +
    `due ${action.arguments.dueDate}`
  );
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
    <div className="pending-action-panel">
      <p className="pending-action-panel__summary">{describePendingAction(action)}</p>
      <p className="pending-action-panel__note">This action needs your confirmation before anything happens in Stripe.</p>
      <div className="pending-action-panel__buttons">
        <button type="button" disabled={busy} onClick={() => handle(onConfirm)}>
          Confirm
        </button>
        <button type="button" disabled={busy} className="secondary" onClick={() => handle(onCancel)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

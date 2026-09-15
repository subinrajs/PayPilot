import type { PendingAction } from "./pending-action.js";

// Single in-memory store — no auth/session system exists in this app (one owner, one Stripe
// account, run locally), so a global map keyed by pending-action id is sufficient. `consume`
// rather than `get`: a confirm request removes the entry as it reads it, so a replayed or
// double-submitted confirm can never re-execute the same action.
const store = new Map<string, PendingAction>();

export function setPendingAction(action: PendingAction): void {
  store.set(action.id, action);
}

export function consumePendingAction(id: string): PendingAction | null {
  const action = store.get(id);
  if (!action) return null;

  store.delete(id);

  if (action.expiresAt < Date.now()) {
    return null;
  }

  return action;
}

// Non-destructive — lets a caller check "is this actually mine to act on?" (right tool, right
// owner) before touching the shared store at all. A caller that decides the id isn't theirs can
// leave it completely untouched for its rightful owner, rather than having to consume first (and
// so destroy it) just to find out it didn't apply to them.
export function peekPendingAction(id: string): PendingAction | null {
  const action = store.get(id);
  if (!action) return null;
  if (action.expiresAt < Date.now()) return null;
  return action;
}

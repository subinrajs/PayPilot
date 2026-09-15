import { describe, expect, it } from "vitest";
import { consumePendingAction, setPendingAction } from "./pending-action-store.js";
import type { PendingAction } from "./pending-action.js";

function makeAction(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id: "pa_1",
    tool: "refund",
    arguments: { chargeId: "ch_1" },
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe("pending-action-store", () => {
  it("returns a stored action and removes it (single use)", () => {
    setPendingAction(makeAction({ id: "pa_2" }));

    const first = consumePendingAction("pa_2");
    expect(first?.id).toBe("pa_2");

    const second = consumePendingAction("pa_2");
    expect(second).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(consumePendingAction("pa_unknown")).toBeNull();
  });

  it("returns null and still removes the entry for an expired action", () => {
    setPendingAction(makeAction({ id: "pa_3", expiresAt: Date.now() - 1 }));

    expect(consumePendingAction("pa_3")).toBeNull();
    // Confirms it was actually removed, not just rejected — a second call also returns null
    // rather than (say) throwing "already consumed", proving there's no leftover state.
    expect(consumePendingAction("pa_3")).toBeNull();
  });
});

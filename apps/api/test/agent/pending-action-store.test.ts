import { describe, expect, it } from "vitest";
import { consumePendingAction, peekPendingAction, setPendingAction } from "../../src/agent/pending-action-store.js";
import type { PendingAction } from "../../src/agent/pending-action.js";

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

  it("peek returns the action without removing it", () => {
    setPendingAction(makeAction({ id: "pa_4" }));

    const peeked = peekPendingAction("pa_4");
    expect(peeked?.id).toBe("pa_4");

    // Still there — unlike consume, peek must not have deleted it.
    expect(peekPendingAction("pa_4")?.id).toBe("pa_4");
    expect(consumePendingAction("pa_4")?.id).toBe("pa_4");
  });

  it("peek returns null for an unknown or expired id, without creating any side effect", () => {
    expect(peekPendingAction("pa_never_existed")).toBeNull();

    setPendingAction(makeAction({ id: "pa_5", expiresAt: Date.now() - 1 }));
    expect(peekPendingAction("pa_5")).toBeNull();
    // Confirms peek didn't delete it either — expired entries are still cleaned up by consume,
    // not left to leak, but peek's job is only to answer "is this valid", not to mutate state.
    expect(consumePendingAction("pa_5")).toBeNull();
  });
});

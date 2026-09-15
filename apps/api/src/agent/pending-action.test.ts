import { describe, expect, it } from "vitest";
import { PENDING_ACTION_TTL_MS, createPendingAction } from "./pending-action.js";

describe("pending-action", () => {
  it("stamps a unique id, the tool name, the arguments, and a future expiry", () => {
    const before = Date.now();
    const action = createPendingAction("refund", { chargeId: "ch_123" });
    const after = Date.now();

    expect(action.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(action.tool).toBe("refund");
    expect(action.arguments).toEqual({ chargeId: "ch_123" });
    expect(action.expiresAt).toBeGreaterThanOrEqual(before + PENDING_ACTION_TTL_MS);
    expect(action.expiresAt).toBeLessThanOrEqual(after + PENDING_ACTION_TTL_MS);
  });

  it("generates a different id for each pending action", () => {
    const a = createPendingAction("refund", {});
    const b = createPendingAction("refund", {});
    expect(a.id).not.toBe(b.id);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.mock("../../src/stripe.js", () => ({ createStripeClient: () => ({}) }));
vi.mock("../../src/openai.js", () => ({ createOpenAIClient: () => ({}), OPENAI_MODEL: "test-model" }));
vi.mock("../../src/agent/loop.js", () => ({ runAssistantTurn: vi.fn() }));
vi.mock("../../src/agent/tools/refund.js", () => ({ executeRefund: vi.fn() }));
vi.mock("../../src/agent/tools/invoice-creation.js", () => ({ executeInvoiceCreation: vi.fn() }));

import { assistantRoutes } from "../../src/routes/assistant.js";
import { runAssistantTurn } from "../../src/agent/loop.js";
import { executeRefund } from "../../src/agent/tools/refund.js";
import { executeInvoiceCreation } from "../../src/agent/tools/invoice-creation.js";
import { peekPendingAction, setPendingAction } from "../../src/agent/pending-action-store.js";

async function buildTestApp() {
  const app = Fastify();
  await app.register(assistantRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/assistant", () => {
  it("rejects a request with no messages array", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "POST", url: "/api/assistant", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("runs the assistant turn and returns its result", async () => {
    vi.mocked(runAssistantTurn).mockResolvedValueOnce({ reply: "hi", messages: [] });

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant",
      payload: { messages: [{ role: "user", content: "hello" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: "hi", messages: [] });
  });
});

describe("POST /api/assistant/confirm", () => {
  it("rejects a payload with an unrecognized key", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant/confirm",
      payload: { pendingActionId: "pa_1", action: "confirm", amountCents: 999999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown pending action id", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant/confirm",
      payload: { pendingActionId: "pa_missing", action: "confirm" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for an expired pending action rather than executing it", async () => {
    setPendingAction({ id: "pa_expired", tool: "refund", arguments: {}, expiresAt: Date.now() - 1 });
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant/confirm",
      payload: { pendingActionId: "pa_expired", action: "confirm" },
    });
    expect(res.statusCode).toBe(404);
    expect(executeRefund).not.toHaveBeenCalled();
  });

  it("cancels a pending action without executing it", async () => {
    setPendingAction({ id: "pa_cancel", tool: "refund", arguments: {}, expiresAt: Date.now() + 60_000 });
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant/confirm",
      payload: { pendingActionId: "pa_cancel", action: "cancel" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "cancelled" });
    expect(executeRefund).not.toHaveBeenCalled();
  });

  it("dispatches a confirmed refund action to executeRefund with the stored (not client-supplied) arguments", async () => {
    setPendingAction({ id: "pa_refund", tool: "refund", arguments: { chargeId: "ch_1" }, expiresAt: Date.now() + 60_000 });
    vi.mocked(executeRefund).mockResolvedValueOnce({ id: "re_1" } as never);

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant/confirm",
      payload: { pendingActionId: "pa_refund", action: "confirm" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "executed", result: { id: "re_1" } });
    expect(executeRefund).toHaveBeenCalledWith(expect.anything(), { chargeId: "ch_1" });
  });

  it("dispatches a confirmed invoice-creation action to executeInvoiceCreation", async () => {
    setPendingAction({
      id: "pa_invoice",
      tool: "create_invoice",
      arguments: { customerId: "cus_1" },
      expiresAt: Date.now() + 60_000,
    });
    vi.mocked(executeInvoiceCreation).mockResolvedValueOnce({ id: "in_1" } as never);

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant/confirm",
      payload: { pendingActionId: "pa_invoice", action: "confirm" },
    });

    expect(res.statusCode).toBe(200);
    expect(executeInvoiceCreation).toHaveBeenCalledWith(expect.anything(), { customerId: "cus_1" });
  });

  it("rejects confirming the same pending action a second time", async () => {
    setPendingAction({ id: "pa_once", tool: "refund", arguments: {}, expiresAt: Date.now() + 60_000 });
    vi.mocked(executeRefund).mockResolvedValueOnce({ id: "re_1" } as never);

    const app = await buildTestApp();
    const first = await app.inject({
      method: "POST",
      url: "/api/assistant/confirm",
      payload: { pendingActionId: "pa_once", action: "confirm" },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/assistant/confirm",
      payload: { pendingActionId: "pa_once", action: "confirm" },
    });
    expect(second.statusCode).toBe(404);
    expect(executeRefund).toHaveBeenCalledTimes(1);
  });

  it("leaves a Telegram-originated pay_invoice pending action untouched rather than consuming it", async () => {
    // Regression test for the ordering bug found by Phase 6's guardrail-auditor pass: this route
    // must not delete an action it doesn't recognize the tool of just because it was asked about
    // it — the bot (its rightful owner) must still be able to act on it afterward.
    setPendingAction({
      id: "pa_telegram",
      tool: "pay_invoice",
      arguments: { invoiceId: "in_1", customerId: "cus_a", amountCents: 45000 },
      expiresAt: Date.now() + 60_000,
    });

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant/confirm",
      payload: { pendingActionId: "pa_telegram", action: "confirm" },
    });

    expect(res.statusCode).toBe(404);
    expect(executeRefund).not.toHaveBeenCalled();
    expect(executeInvoiceCreation).not.toHaveBeenCalled();
    // Still there — proves this route peeked and rejected without consuming.
    expect(peekPendingAction("pa_telegram")).not.toBeNull();
  });

  it("also leaves a pay_invoice id untouched on a cancel request", async () => {
    setPendingAction({
      id: "pa_telegram_cancel",
      tool: "pay_invoice",
      arguments: { invoiceId: "in_1", customerId: "cus_a", amountCents: 45000 },
      expiresAt: Date.now() + 60_000,
    });

    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant/confirm",
      payload: { pendingActionId: "pa_telegram_cancel", action: "cancel" },
    });

    expect(res.statusCode).toBe(404);
    expect(peekPendingAction("pa_telegram_cancel")).not.toBeNull();
  });
});

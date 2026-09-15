import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.mock("../stripe.js", () => ({ createStripeClient: () => ({}) }));
vi.mock("../openai.js", () => ({ createOpenAIClient: () => ({}), OPENAI_MODEL: "test-model" }));
vi.mock("../agent/loop.js", () => ({ runAssistantTurn: vi.fn() }));
vi.mock("../agent/tools/refund.js", () => ({ executeRefund: vi.fn() }));
vi.mock("../agent/tools/invoice-creation.js", () => ({ executeInvoiceCreation: vi.fn() }));

import { assistantRoutes } from "./assistant.js";
import { runAssistantTurn } from "../agent/loop.js";
import { executeRefund } from "../agent/tools/refund.js";
import { executeInvoiceCreation } from "../agent/tools/invoice-creation.js";
import { setPendingAction } from "../agent/pending-action-store.js";

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
});

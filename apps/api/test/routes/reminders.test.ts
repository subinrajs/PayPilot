import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { remindersRoutes } from "../../src/routes/reminders.js";

async function buildTestApp() {
  const app = Fastify();
  await app.register(remindersRoutes);
  return app;
}

function reminder(overrides: Record<string, unknown> = {}) {
  return {
    targetId: "in_1",
    targetType: "overdue_invoice",
    customerName: "Acme Corp",
    customerEmail: "billing@acme.example",
    amountCents: 25000,
    invoiceUrl: "https://invoice.stripe.com/i/acct_1/test_abc",
    subject: "Friendly reminder",
    body: "Your invoice is overdue.",
    ...overrides,
  };
}

describe("POST /api/reminders/send", () => {
  it("logs each reminder and reports it sent, without touching any external system", async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/reminders/send",
      payload: { reminders: [reminder({ targetId: "in_1" }), reminder({ targetId: "ch_1", targetType: "failed_payment" })] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      results: [
        { targetId: "in_1", status: "sent" },
        { targetId: "ch_1", status: "sent" },
      ],
    });
  });

  it("allows a null customerEmail — logging still succeeds even with nothing to actually email", async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/reminders/send",
      payload: { reminders: [reminder({ customerEmail: null })] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ results: [{ targetId: "in_1", status: "sent" }] });
  });

  it("rejects an empty reminders array with 400", async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: "POST", url: "/api/reminders/send", payload: { reminders: [] } });

    expect(res.statusCode).toBe(400);
  });

  it("rejects a malformed body with 400 rather than throwing", async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: "POST", url: "/api/reminders/send", payload: { not: "valid" } });

    expect(res.statusCode).toBe(400);
  });

  it("rejects an unrecognized extra field on a reminder item", async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/reminders/send",
      payload: { reminders: [reminder({ extraField: "nope" })] },
    });

    expect(res.statusCode).toBe(400);
  });
});

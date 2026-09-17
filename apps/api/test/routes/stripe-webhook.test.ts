import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

// vi.hoisted — vi.mock's factory below is hoisted above every other top-level statement, so
// constructEvent must be created this way to be safely referenced both inside the factory (nested
// under createStripeClient's return value) and from each test body (to set its return value/throw).
const { constructEvent } = vi.hoisted(() => ({ constructEvent: vi.fn() }));

vi.mock("../../src/stripe.js", () => ({
  createStripeClient: vi.fn(() => ({ webhooks: { constructEvent } })),
  getStripeWebhookSecret: vi.fn(() => "whsec_test"),
}));
vi.mock("../../src/telegram/session.js", () => ({ getChatIdForCustomer: vi.fn() }));
vi.mock("../../src/telegram/notify.js", () => ({ sendTelegramMessage: vi.fn() }));

import { stripeWebhookRoutes } from "../../src/routes/stripe-webhook.js";
import { getStripeWebhookSecret } from "../../src/stripe.js";
import { getChatIdForCustomer } from "../../src/telegram/session.js";
import { sendTelegramMessage } from "../../src/telegram/notify.js";

async function buildTestApp() {
  const app = Fastify();
  await app.register(stripeWebhookRoutes);
  return app;
}

function invoicePaidEvent(overrides: { id?: string; amountPaid?: number; customer?: string | null } = {}) {
  return {
    id: overrides.id ?? "evt_1",
    type: "invoice.paid" as const,
    data: {
      object: {
        id: "in_1",
        amount_paid: overrides.amountPaid ?? 250000,
        customer: overrides.customer === undefined ? "cus_a" : overrides.customer,
      },
    },
  };
}

async function post(app: Awaited<ReturnType<typeof buildTestApp>>, opts: { signature?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.signature !== undefined) headers["stripe-signature"] = opts.signature;
  return app.inject({ method: "POST", url: "/api/stripe/webhook", headers, payload: JSON.stringify(opts.body ?? {}) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStripeWebhookSecret).mockImplementation(() => "whsec_test");
});

describe("POST /api/stripe/webhook", () => {
  it("rejects a request with no stripe-signature header, never touching Stripe or Telegram", async () => {
    const app = await buildTestApp();
    const res = await post(app, { body: invoicePaidEvent({ id: "evt_no_sig" }) });

    expect(res.statusCode).toBe(400);
    expect(constructEvent).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("returns 500 and never attempts signature verification when STRIPE_WEBHOOK_SECRET isn't configured", async () => {
    vi.mocked(getStripeWebhookSecret).mockImplementationOnce(() => {
      throw new Error("Missing STRIPE_WEBHOOK_SECRET");
    });

    const app = await buildTestApp();
    const res = await post(app, { signature: "sig_1", body: invoicePaidEvent({ id: "evt_no_secret" }) });

    expect(res.statusCode).toBe(500);
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("rejects a forged/invalid signature with 400, never reaching business logic", async () => {
    constructEvent.mockImplementationOnce(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });

    const app = await buildTestApp();
    const res = await post(app, { signature: "sig_bad", body: invoicePaidEvent({ id: "evt_bad_sig" }) });

    expect(res.statusCode).toBe(400);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("notifies the linked chat for an at/above-cap invoice.paid — the only case the bot couldn't have told the customer itself", async () => {
    constructEvent.mockReturnValueOnce(invoicePaidEvent({ id: "evt_notify", amountPaid: 250000, customer: "cus_a" }));
    vi.mocked(getChatIdForCustomer).mockReturnValueOnce(555);

    const app = await buildTestApp();
    const res = await post(app, { signature: "sig_1", body: {} });

    expect(res.statusCode).toBe(200);
    expect(getChatIdForCustomer).toHaveBeenCalledWith("cus_a");
    expect(sendTelegramMessage).toHaveBeenCalledWith(555, expect.stringContaining("$2500.00"));
  });

  it("does NOT notify for a below-cap invoice.paid — only reachable via the bot's own Confirm button, which already told the customer", async () => {
    constructEvent.mockReturnValueOnce(invoicePaidEvent({ id: "evt_below_cap", amountPaid: 5000, customer: "cus_a" }));

    const app = await buildTestApp();
    const res = await post(app, { signature: "sig_1", body: {} });

    expect(res.statusCode).toBe(200);
    expect(getChatIdForCustomer).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("no-ops (still 200) for an at/above-cap invoice.paid whose customer has no linked Telegram chat", async () => {
    constructEvent.mockReturnValueOnce(invoicePaidEvent({ id: "evt_unlinked", amountPaid: 250000, customer: "cus_unlinked" }));
    vi.mocked(getChatIdForCustomer).mockReturnValueOnce(undefined);

    const app = await buildTestApp();
    const res = await post(app, { signature: "sig_1", body: {} });

    expect(res.statusCode).toBe(200);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("ignores event types other than invoice.paid", async () => {
    constructEvent.mockReturnValueOnce({ id: "evt_x", type: "customer.created", data: { object: {} } });

    const app = await buildTestApp();
    const res = await post(app, { signature: "sig_1", body: {} });

    expect(res.statusCode).toBe(200);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("sends only one notification across a redelivered (duplicate event id) invoice.paid — Stripe's at-least-once delivery must not double-notify the customer", async () => {
    const event = invoicePaidEvent({ id: "evt_dup", amountPaid: 250000, customer: "cus_a" });
    constructEvent.mockReturnValue(event);
    vi.mocked(getChatIdForCustomer).mockReturnValue(555);

    const app = await buildTestApp();
    const first = await post(app, { signature: "sig_1", body: {} });
    const second = await post(app, { signature: "sig_1", body: {} });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });
});

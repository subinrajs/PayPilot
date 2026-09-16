import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.mock("../../src/stripe.js", () => ({ createStripeClient: () => ({}) }));
vi.mock("../../src/agent/dashboard.js", () => ({
  getTodaysSummary: vi.fn(),
  getPaymentActivity: vi.fn(),
  getOverdueInvoicesSummary: vi.fn(),
  getDisputesSummary: vi.fn(),
  getRecentActivity: vi.fn(),
}));

import { dashboardRoutes } from "../../src/routes/dashboard.js";
import {
  getDisputesSummary,
  getOverdueInvoicesSummary,
  getPaymentActivity,
  getRecentActivity,
  getTodaysSummary,
} from "../../src/agent/dashboard.js";

async function buildTestApp() {
  const app = Fastify();
  await app.register(dashboardRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboard/summary", () => {
  it("returns getTodaysSummary's result", async () => {
    vi.mocked(getTodaysSummary).mockResolvedValueOnce({ summary: { date: "2026-09-16" } } as never);

    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/dashboard/summary" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ summary: { date: "2026-09-16" } });
  });

  it("returns 502 rather than leaking a raw error when Stripe fails", async () => {
    vi.mocked(getTodaysSummary).mockRejectedValueOnce(new Error("stripe is down"));

    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/dashboard/summary" });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).not.toContain("stripe is down");
  });
});

describe("GET /api/dashboard/activity", () => {
  it("passes the days query param through as a number", async () => {
    vi.mocked(getPaymentActivity).mockResolvedValueOnce({ days: 30, buckets: [] });

    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/dashboard/activity?days=30" });

    expect(res.statusCode).toBe(200);
    expect(getPaymentActivity).toHaveBeenCalledWith(expect.anything(), 30);
  });

  it("rejects a days value that isn't 7, 30, or 90", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/dashboard/activity?days=14" });

    expect(res.statusCode).toBe(400);
    expect(getPaymentActivity).not.toHaveBeenCalled();
  });

  it("rejects a missing days param", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/dashboard/activity" });

    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/dashboard/overdue-invoices", () => {
  it("returns getOverdueInvoicesSummary's result", async () => {
    vi.mocked(getOverdueInvoicesSummary).mockResolvedValueOnce({ count: 2, totalCents: 55000, invoices: [] });

    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/dashboard/overdue-invoices" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ count: 2, totalCents: 55000, invoices: [] });
  });

  it("returns 502 rather than leaking a raw error when Stripe fails", async () => {
    vi.mocked(getOverdueInvoicesSummary).mockRejectedValueOnce(new Error("stripe is down"));

    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/dashboard/overdue-invoices" });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).not.toContain("stripe is down");
  });
});

describe("GET /api/dashboard/disputes", () => {
  it("returns getDisputesSummary's result", async () => {
    vi.mocked(getDisputesSummary).mockResolvedValueOnce({ count: 1, totalCents: 8000, disputes: [] });

    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/dashboard/disputes" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ count: 1, totalCents: 8000, disputes: [] });
  });

  it("returns 502 rather than leaking a raw error when Stripe fails", async () => {
    vi.mocked(getDisputesSummary).mockRejectedValueOnce(new Error("stripe is down"));

    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/dashboard/disputes" });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).not.toContain("stripe is down");
  });
});

describe("GET /api/dashboard/recent-activity", () => {
  it("returns getRecentActivity's result", async () => {
    vi.mocked(getRecentActivity).mockResolvedValueOnce({ events: [] });

    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/dashboard/recent-activity" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [] });
  });

  it("returns 502 rather than leaking a raw error when Stripe fails", async () => {
    vi.mocked(getRecentActivity).mockRejectedValueOnce(new Error("stripe is down"));

    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/dashboard/recent-activity" });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).not.toContain("stripe is down");
  });
});

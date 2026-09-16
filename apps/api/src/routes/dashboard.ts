import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createStripeClient } from "../stripe.js";
import {
  getTodaysSummary,
  getPaymentActivity,
  getOverdueInvoicesSummary,
  getDisputesSummary,
  getRecentActivity,
  type PaymentActivityRange,
} from "../agent/dashboard.js";

const ActivityQuerySchema = z.object({
  days: z.coerce.number().refine((n): n is PaymentActivityRange => n === 7 || n === 30 || n === 90, {
    message: "days must be 7, 30, or 90",
  }),
});

// Direct read-only routes for the dashboard's always-visible panels — deliberately outside the
// OpenAI tool-calling loop (see agent/dashboard.ts). No confirmation step and no pending action
// for either: both are pure reads, same as get_daily_summary/get_revenue_comparison already are
// for the chat surface.
export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard/summary", async (request, reply) => {
    const stripe = createStripeClient();
    try {
      return await getTodaysSummary(stripe);
    } catch (err) {
      request.log.error(err);
      return reply.status(502).send({ error: "Failed to load today's summary. Please try again." });
    }
  });

  app.get("/api/dashboard/activity", async (request, reply) => {
    const parsed = ActivityQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const stripe = createStripeClient();
    try {
      return await getPaymentActivity(stripe, parsed.data.days);
    } catch (err) {
      request.log.error(err);
      return reply.status(502).send({ error: "Failed to load payment activity. Please try again." });
    }
  });

  app.get("/api/dashboard/overdue-invoices", async (request, reply) => {
    const stripe = createStripeClient();
    try {
      return await getOverdueInvoicesSummary(stripe);
    } catch (err) {
      request.log.error(err);
      return reply.status(502).send({ error: "Failed to load overdue invoices. Please try again." });
    }
  });

  app.get("/api/dashboard/disputes", async (request, reply) => {
    const stripe = createStripeClient();
    try {
      return await getDisputesSummary(stripe);
    } catch (err) {
      request.log.error(err);
      return reply.status(502).send({ error: "Failed to load disputes. Please try again." });
    }
  });

  app.get("/api/dashboard/recent-activity", async (request, reply) => {
    const stripe = createStripeClient();
    try {
      return await getRecentActivity(stripe);
    } catch (err) {
      request.log.error(err);
      return reply.status(502).send({ error: "Failed to load recent activity. Please try again." });
    }
  });
}

import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";
import { assistantRoutes } from "./routes/assistant.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { stripeWebhookRoutes } from "./routes/stripe-webhook.js";
import { remindersRoutes } from "./routes/reminders.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  app.register(healthRoutes);
  app.register(assistantRoutes);
  app.register(dashboardRoutes);
  app.register(stripeWebhookRoutes);
  app.register(remindersRoutes);
  return app;
}

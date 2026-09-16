import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";
import { assistantRoutes } from "./routes/assistant.js";
import { dashboardRoutes } from "./routes/dashboard.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  app.register(healthRoutes);
  app.register(assistantRoutes);
  app.register(dashboardRoutes);
  return app;
}

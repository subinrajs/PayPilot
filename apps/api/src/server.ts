import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";
import { assistantRoutes } from "./routes/assistant.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  app.register(healthRoutes);
  app.register(assistantRoutes);
  return app;
}

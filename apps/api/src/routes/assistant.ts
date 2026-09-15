import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type Stripe from "stripe";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { createStripeClient } from "../stripe.js";
import { createOpenAIClient } from "../openai.js";
import { runAssistantTurn } from "../agent/loop.js";
import { consumePendingAction } from "../agent/pending-action-store.js";
import type { PendingAction } from "../agent/pending-action.js";
import { executeRefund, type ResolvedRefundArgs } from "../agent/tools/refund.js";
import { executeInvoiceCreation, type ResolvedInvoiceCreationArgs } from "../agent/tools/invoice-creation.js";

// Loose on purpose beyond `role` — the client is expected to just store and resend exactly what
// this route previously returned, including tool-call/tool-result entries whose shape is
// OpenAI's, not ours to constrain further here. `role` excludes "system" specifically so a client
// can't inject a fake system-level message into the conversation the server sends to the model —
// the real system prompt is always injected fresh by runAssistantTurn, never client-supplied.
const AssistantRequestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant", "tool"]) }).passthrough()),
});

// Explicit Zod validation on the confirm payload per ADR-009 — not just Fastify's built-in
// schema option. `.strict()` so an extra key (e.g. a client trying to smuggle resolved
// arguments) is rejected outright rather than silently ignored.
const ConfirmRequestSchema = z
  .object({
    pendingActionId: z.string().min(1),
    action: z.enum(["confirm", "cancel"]),
  })
  .strict();

export async function assistantRoutes(app: FastifyInstance) {
  // Created per request rather than once at registration, so a missing STRIPE_SECRET_KEY/
  // OPENAI_API_KEY only breaks these two routes, not server startup — GET /api/health must keep
  // working regardless, per Phase 1's "pnpm dev always has something runnable" goal.
  app.post("/api/assistant", async (request, reply) => {
    const parsed = AssistantRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const stripe = createStripeClient();
    const openai = createOpenAIClient();

    try {
      return await runAssistantTurn(stripe, openai, parsed.data.messages as ChatCompletionMessageParam[]);
    } catch (err) {
      request.log.error(err);
      return reply.status(502).send({ error: "The assistant failed to respond. Please try again." });
    }
  });

  app.post("/api/assistant/confirm", async (request, reply) => {
    const parsed = ConfirmRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const { pendingActionId, action } = parsed.data;

    // Consumed immediately regardless of confirm/cancel — a pending action is single-use either
    // way, and this is what makes a replayed or double-submitted confirm request a no-op rather
    // than a second execution.
    const pendingAction = consumePendingAction(pendingActionId);

    if (action === "cancel") {
      return { status: "cancelled" };
    }

    if (!pendingAction) {
      return reply.status(404).send({ error: "Unknown or expired pending action" });
    }

    const stripe = createStripeClient();

    try {
      const result = await executeConfirmedAction(stripe, pendingAction);
      return { status: "executed", result };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

// Only the two owner-facing money-moving tools are reachable here — invoice payment is
// Telegram-scoped and never produces a pending action this route could see.
async function executeConfirmedAction(stripe: Stripe, action: PendingAction): Promise<unknown> {
  switch (action.tool) {
    case "refund":
      return executeRefund(stripe, action.arguments as ResolvedRefundArgs);
    case "create_invoice":
      return executeInvoiceCreation(stripe, action.arguments as ResolvedInvoiceCreationArgs);
    default:
      throw new Error(`No executor registered for pending action tool "${action.tool}"`);
  }
}

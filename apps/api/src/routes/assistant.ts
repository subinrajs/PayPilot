import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type Stripe from "stripe";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { createStripeClient } from "../stripe.js";
import { createOpenAIClient } from "../openai.js";
import { runAssistantTurn, type AssistantTurnResult } from "../agent/loop.js";
import { consumePendingAction, peekPendingAction } from "../agent/pending-action-store.js";
import type { PendingAction } from "../agent/pending-action.js";
import { executeRefund, type ResolvedRefundArgs } from "../agent/tools/refund.js";
import { executeSendInvoice, type ResolvedSendInvoiceArgs } from "../agent/tools/invoice-creation.js";
import {
  executeSubmitDisputeEvidence,
  executeDeclineDispute,
  type ResolvedDisputeActionArgs,
} from "../agent/tools/dispute-response.js";

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
      const inputMessages = parsed.data.messages as ChatCompletionMessageParam[];
      const result = await runAssistantTurn(stripe, openai, inputMessages);
      return applyDeterministicReplyOverride(inputMessages, result);
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

    // Peeked (not consumed) first — an id this route doesn't recognize the tool of (e.g. a
    // Telegram-originated "pay_invoice" action, which shares this same store) must be left
    // completely untouched for its rightful owner, not silently destroyed just because this
    // route happened to be asked about it.
    const peeked = peekPendingAction(pendingActionId);
    const knownTools = new Set(["refund", "send_invoice", "submit_dispute_evidence", "decline_dispute"]);
    if (!peeked || !knownTools.has(peeked.tool)) {
      return reply.status(404).send({ error: "Unknown or expired pending action" });
    }

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

// A tile-rendering tool whose own JSON result is verbose enough (N drafted email subjects+bodies)
// that relying on system-prompt.ts's "keep your reply to one line, the card already shows it"
// instruction alone has repeatedly proven unreliable in live testing — the model restates the full
// drafted content in prose anyway. Rather than trying yet another round of prompt wording for a
// problem prompt wording has already failed to fix twice, this deterministically REPLACES the
// model's own reply whenever the tool fired this turn — guaranteeing no duplication regardless of
// how the model chooses to narrate, matching this app's core principle that application code (not
// the model) is responsible for anything it can just guarantee outright.
const DETERMINISTIC_REPLY_BUILDERS: Record<string, (result: unknown) => string> = {
  draft_payment_reminders: (result) => {
    const count = Array.isArray((result as { reminders?: unknown[] } | null)?.reminders)
      ? (result as { reminders: unknown[] }).reminders.length
      : 0;
    return count === 1
      ? "Here's the payment reminder draft below — review, edit, and send it whenever you're ready."
      : `Here are ${count} payment reminder drafts below — review, edit, and send them whenever you're ready.`;
  },
};

// Scoped to only the messages THIS call to runAssistantTurn actually produced (result.messages is
// the full accumulated conversation, input included — slicing off the input prefix avoids ever
// matching a stale tool call from an earlier turn, the same class of bug B5 fixed on the Telegram
// side for the identical reason).
function applyDeterministicReplyOverride(
  inputMessages: ChatCompletionMessageParam[],
  result: AssistantTurnResult,
): AssistantTurnResult {
  const turnMessages = result.messages.slice(inputMessages.length);

  const toolNameById = new Map<string, string>();
  for (const message of turnMessages) {
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) toolNameById.set(call.id, call.function.name);
    }
  }

  let override: string | undefined;
  for (const message of turnMessages) {
    if (message.role !== "tool" || typeof message.content !== "string") continue;
    const toolName = message.tool_call_id ? toolNameById.get(message.tool_call_id) : undefined;
    const builder = toolName ? DETERMINISTIC_REPLY_BUILDERS[toolName] : undefined;
    if (!builder) continue;
    try {
      override = builder(JSON.parse(message.content));
    } catch {
      // Malformed tool result — leave the model's own reply alone rather than guessing.
    }
  }

  if (!override) return result;

  // The frontend (App.tsx) renders the chat from `messages` (it calls `setMessages(res.messages)`
  // on every reply) — `reply` is never actually read there. Overriding only `reply` above would be
  // a no-op the client never sees; the LAST entry in `messages` is the same final assistant
  // message whose `content` the frontend displays, so that's the one that has to change too.
  const messages = [...result.messages];
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  if (last?.role === "assistant") {
    messages[lastIndex] = { ...last, content: override };
  }

  return { ...result, reply: override, messages };
}

// Only owner-facing pending-action tools are reachable here — invoice payment is Telegram-scoped
// and never produces a pending action this route could see. Exported (not just used internally)
// so a cross-cutting test can exercise this real dispatch logic directly — see
// apps/api/test/guardrails.test.ts.
export async function executeConfirmedAction(stripe: Stripe, action: PendingAction): Promise<unknown> {
  switch (action.tool) {
    case "refund":
      return executeRefund(stripe, action.arguments as ResolvedRefundArgs);
    case "send_invoice":
      return executeSendInvoice(stripe, action.arguments as ResolvedSendInvoiceArgs);
    case "submit_dispute_evidence":
      return executeSubmitDisputeEvidence(stripe, action.arguments as ResolvedDisputeActionArgs);
    case "decline_dispute":
      return executeDeclineDispute(stripe, action.arguments as ResolvedDisputeActionArgs);
    default:
      throw new Error(`No executor registered for pending action tool "${action.tool}"`);
  }
}

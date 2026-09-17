import type Stripe from "stripe";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { ZodError } from "zod";
import { OPENAI_MODEL } from "../openai.js";
import { findTool, toolDefinitionsForOpenAI, TOOL_REGISTRY, type ToolRegistryEntry } from "./tool-registry.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { setPendingAction } from "./pending-action-store.js";
import type { PendingAction } from "./pending-action.js";
import { stripMarkdownArtifacts } from "./markdown-strip.js";

// Caps how many rounds of tool-calling a single request can trigger — a cap prevents a
// misbehaving model from looping forever. Most flows need only a couple of rounds, but S14's
// payment-reminder flow genuinely needs three sequential calls before a final reply
// (get_outstanding_invoices, then get_failed_payments, then draft_payment_reminders) — at 4 that
// left zero margin for the model taking one extra/redundant round, which a live run actually hit
// ("Assistant loop exceeded the maximum number of tool-call rounds"). Raised to give real
// multi-lookup flows headroom without meaningfully weakening the runaway-loop guard.
const MAX_TOOL_ROUNDS = 6;

export interface AssistantTurnResult {
  reply: string;
  messages: ChatCompletionMessageParam[];
  pendingAction?: PendingAction;
}

// The model only ever gets to call a tool's `propose*`/read-only handler (see tool-registry.ts —
// it registers exactly those, never an `execute*`). A `kind:"pending"` result is stored here and
// surfaced to the caller, but nothing in this function is capable of executing it — that only
// happens via routes/assistant.ts's confirm handler (web) or telegram/bot.ts's confirm: callback
// (Telegram) consuming it back out of the store; this function never executes anything itself
// regardless of which tool registry/prompt it's given.
//
// `options` defaults to today's exact owner behavior — routes/assistant.ts's call site needs no
// changes. S12's Telegram bot passes its own customer-scoped registry and prompt explicitly
// (telegram/tool-registry.ts, telegram/system-prompt.ts) so the same orchestration (tool-call
// rounds, pending-action storage, Markdown stripping) is never duplicated for a second entry point.
export async function runAssistantTurn(
  stripe: Stripe,
  openai: OpenAI,
  messages: ChatCompletionMessageParam[],
  options?: { toolRegistry?: ToolRegistryEntry[]; systemPrompt?: string },
): Promise<AssistantTurnResult> {
  const toolRegistry = options?.toolRegistry ?? TOOL_REGISTRY;
  const systemPromptText = options?.systemPrompt ?? buildSystemPrompt(new Date());
  const systemMessage: ChatCompletionMessageParam = { role: "system", content: systemPromptText };
  let working: ChatCompletionMessageParam[] = [systemMessage, ...messages];
  let pendingAction: PendingAction | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: working,
      tools: toolDefinitionsForOpenAI(toolRegistry),
    });

    if (completion.choices.length === 0) {
      throw new Error("OpenAI response contained no choices");
    }

    const assistantMessage = completion.choices[0].message;
    working = [...working, assistantMessage];

    const toolCalls = assistantMessage.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // A code-level backstop for system-prompt.ts's "never Markdown syntax" rule — the model
      // doesn't reliably comply (a list-shaped result like multiple invoices reliably biases it
      // toward Markdown list formatting regardless), and this chat UI only ever renders plain
      // text, so unstripped Markdown would show up as literal stray characters. Applied to the
      // message actually returned to the client, not just to `reply`, so the client's own stored
      // history — which it resends verbatim next turn — is clean too.
      const cleanedContent = assistantMessage.content ? stripMarkdownArtifacts(assistantMessage.content) : assistantMessage.content;
      const messages = working.slice(1); // drop the freshly-injected system message
      messages[messages.length - 1] = { ...assistantMessage, content: cleanedContent };

      return {
        reply: cleanedContent ?? "",
        messages,
        pendingAction,
      };
    }

    for (const toolCall of toolCalls) {
      const resultContent = await runToolCall(stripe, toolCall.function.name, toolCall.function.arguments, toolRegistry);
      if (isPendingResult(resultContent)) {
        setPendingAction(resultContent.action);
        pendingAction = resultContent.action;
      }

      working = [
        ...working,
        { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(resultContent) },
      ];
    }
  }

  // A pending action may already have been written to the store on the final round even though
  // the model kept calling tools past it — it must still be surfaced here rather than discarded,
  // since it now exists and is confirmable/cancellable until its TTL regardless of what this
  // function returns.
  if (pendingAction) {
    return {
      reply: "I've prepared that action, but I'm having trouble finishing this response — please confirm or cancel it.",
      messages: working.slice(1),
      pendingAction,
    };
  }

  throw new Error("Assistant loop exceeded the maximum number of tool-call rounds");
}

async function runToolCall(stripe: Stripe, name: string, rawArguments: string, registry: ToolRegistryEntry[]): Promise<unknown> {
  const tool = findTool(name, registry);
  if (!tool) {
    return { error: `Unknown tool "${name}"` };
  }

  try {
    const args: unknown = rawArguments ? JSON.parse(rawArguments) : {};
    return await tool.handler(stripe, args);
  } catch (err) {
    // Fed back to the model as the tool's result (not thrown to the HTTP caller) so it can
    // self-correct — e.g. retry with a valid date format — rather than failing the whole request.
    if (err instanceof ZodError) {
      return { error: err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function isPendingResult(result: unknown): result is { kind: "pending"; action: PendingAction } {
  return typeof result === "object" && result !== null && (result as { kind?: unknown }).kind === "pending";
}

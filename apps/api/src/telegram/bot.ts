import { z } from "zod";
import { Bot, InlineKeyboard } from "grammy";
import Stripe from "stripe";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { FastifyBaseLogger } from "fastify";
import { createStripeClient } from "../stripe.js";
import { createOpenAIClient } from "../openai.js";
import { runAssistantTurn } from "../agent/loop.js";
import { getCustomerId, linkChat, type LinkResult } from "./session.js";
import { getConversationHistory, setConversationHistory, clearConversationHistory } from "./conversation-store.js";
import { buildCustomerToolRegistry } from "./tool-registry.js";
import { buildTelegramSystemPrompt } from "./system-prompt.js";
import { lookupInvoices, type InvoiceLookupResultItem, type InvoiceLookupResult } from "../agent/tools/invoice-lookup.js";
import {
  proposeInvoicePayment,
  executeInvoicePayment,
  type ResolvedInvoicePaymentArgs,
  type ProposeInvoicePaymentResult,
} from "../agent/tools/invoice-payment.js";
import { setPendingAction, consumePendingAction, peekPendingAction } from "../agent/pending-action-store.js";
import type { PendingAction } from "../agent/pending-action.js";
import { isAtOrAboveCap } from "../policies/payment-policy.js";

const LinkTokenSchema = z.string().trim().min(1);

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Every reply carrying a handoffMessage/formatInvoiceList result is sent with parse_mode: "HTML"
// (see the ctx.reply call sites below) so the hosted invoice link can render as friendly text
// instead of a raw pasted URL — Telegram requires &/</> escaped in the surrounding plain text of
// an HTML-mode message, hence this helper for the one piece of that text that isn't ours (the
// invoice description/label, which the owner can set to arbitrary text via invoice-creation.ts).
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- Testable core (no grammY Context anywhere below) ------------------------------------

export type StartResult = LinkResult | "invalid_token" | "not_private_chat";

// Linking is restricted to private (1:1) chats — the mapping is telegramChatId -> customerId, and
// a group/supergroup chat id is shared by every member of that group, so linking one there would
// let everyone in the group see and pay that customer's invoices. A real isolation gap found
// during the Phase 6 guardrail audit, closed here rather than left for a future phase.
export async function handleStart(
  stripe: Stripe,
  chatId: number,
  chatType: string,
  token: string,
): Promise<StartResult> {
  if (chatType !== "private") return "not_private_chat";

  const parsed = LinkTokenSchema.safeParse(token);
  if (!parsed.success) return "invalid_token";
  const customerId = parsed.data;

  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return "invalid_token";
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") {
      return "invalid_token";
    }
    throw err;
  }

  return linkChat(chatId, customerId);
}

export function startResultMessage(result: StartResult): string {
  switch (result) {
    case "linked":
      return "You're all set! 👋 I'm PayPilot, your personal payments assistant. Ask me anything about your account, like what you owe or whether you can pay something — I'm happy to help.";
    case "already_linked_elsewhere":
      return "That link-token is already in use by another chat.";
    case "chat_linked_to_other_customer":
      return "This chat is already linked to a different account.";
    case "invalid_token":
      return "That link-token isn't valid. Please check it and try again.";
    case "not_private_chat":
      return "Please message me directly (not in a group) to link your account.";
  }
}

// Dispatches only "pay_invoice" — mirrors routes/assistant.ts's discipline, so a leaked/guessed
// pending-action id from the web side can't be replayed through the bot. Always authorizes with
// the CONFIRMING chat's own session-bound customerId, never `pendingAction.arguments.customerId`
// (which is only descriptive data on the pending action) — see docs/plan.md Phase 6's "Confirmed
// understanding" for why this specific argument choice is the guardrail that actually matters
// once Telegram writes into the same shared pending-action store as the web app.
export async function confirmPayInvoice(
  stripe: Stripe,
  pendingAction: PendingAction,
  sessionCustomerId: string,
): Promise<Stripe.Invoice> {
  if (pendingAction.tool !== "pay_invoice") {
    throw new Error(`No executor registered for pending action tool "${pendingAction.tool}"`);
  }
  return executeInvoicePayment(stripe, sessionCustomerId, pendingAction.arguments as ResolvedInvoicePaymentArgs);
}

export type ResolveConfirmableResult =
  | { kind: "ok"; action: PendingAction<"pay_invoice", ResolvedInvoicePaymentArgs> }
  | { kind: "not_found" }
  | { kind: "forbidden" };

// Shared by both the confirm: and cancel: callbacks — peeks (non-destructive), checks the action
// is a pay_invoice action AND belongs to the confirming chat's own session customerId, and only
// THEN consumes. An id that fails either check is left completely untouched: a web-side
// refund/create_invoice action (same shared store), or another customer's pay_invoice action,
// must not be destroyable just because this session asked about it — whether by tapping Confirm
// or Cancel. (A prior version checked ownership in cancelPendingAction but not in the confirm:
// handler — this single shared helper is what keeps the two from silently drifting apart again.)
export function resolveConfirmablePendingAction(
  pendingActionId: string,
  sessionCustomerId: string,
): ResolveConfirmableResult {
  const peeked = peekPendingAction(pendingActionId);
  if (!peeked || peeked.tool !== "pay_invoice") return { kind: "not_found" };

  const args = peeked.arguments as ResolvedInvoicePaymentArgs;
  if (args.customerId !== sessionCustomerId) return { kind: "forbidden" };

  const consumed = consumePendingAction(pendingActionId);
  if (!consumed) return { kind: "not_found" }; // defensive: shouldn't happen in single-threaded Node
  return { kind: "ok", action: consumed as PendingAction<"pay_invoice", ResolvedInvoicePaymentArgs> };
}

export type CancelResult = "cancelled" | "not_found" | "forbidden";

export function cancelPendingAction(pendingActionId: string, sessionCustomerId: string): CancelResult {
  const resolved = resolveConfirmablePendingAction(pendingActionId, sessionCustomerId);
  if (resolved.kind === "ok") return "cancelled";
  return resolved.kind;
}

// Renders the hosted invoice link as friendly anchor text rather than a raw pasted URL — sent
// with parse_mode: "HTML" at every call site below. hostedInvoiceUrl comes straight from Stripe
// (never owner/customer-supplied free text), so no escaping is needed for the URL itself.
export function handoffMessage(result: { amountCents: number; hostedInvoiceUrl: string | null }): string {
  const amount = formatCents(result.amountCents);
  return result.hostedInvoiceUrl
    ? `This invoice (${amount}) is at or above our $2,000 bot limit. You can pay it directly here: <a href="${result.hostedInvoiceUrl}">Pay this invoice</a>`
    : `This invoice (${amount}) is at or above our $2,000 bot limit. Please contact us directly to arrange payment.`;
}

export function formatInvoiceList(invoices: InvoiceLookupResultItem[]): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();

  if (invoices.length === 0) {
    return { text: "You don't have any outstanding invoices.", keyboard };
  }

  const lines: string[] = ["Here's what you owe:", ""];

  for (const invoice of invoices) {
    // Never fall back to invoice.id — a raw Stripe id ("in_...") means nothing to a customer.
    // Invoices created before the invoice-level `description` field was set at creation time
    // (invoice-creation.ts, seed.ts) can't be backfilled either: Stripe rejects updating
    // `description` on an already-finalized invoice, so this fallback has to hold indefinitely,
    // not just until existing test data ages out.
    const label = invoice.description ?? "Invoice";
    const overdueNote = invoice.overdue ? " (overdue)" : "";
    // Sent with parse_mode: "HTML" (see call sites) — label is free text the owner set at
    // invoice-creation time, so it must be escaped before landing in an HTML-mode message.
    lines.push(`• ${escapeHtml(label)} — ${formatCents(invoice.amountDueCents)}${overdueNote}`);

    if (isAtOrAboveCap(invoice.amountDueCents)) {
      lines.push(`  ${handoffMessage({ amountCents: invoice.amountDueCents, hostedInvoiceUrl: invoice.hostedInvoiceUrl })}`);
    } else {
      keyboard.text(`Pay ${label} (${formatCents(invoice.amountDueCents)})`, `pay:${invoice.id}`).row();
    }
  }

  return { text: lines.join("\n"), keyboard };
}

export function formatPendingConfirmation(
  action: PendingAction<"pay_invoice", ResolvedInvoicePaymentArgs>,
): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard().text("Confirm", `confirm:${action.id}`).text("Cancel", `cancel:${action.id}`);
  return {
    // No invoice id here — ResolvedInvoicePaymentArgs doesn't carry a description, and a raw
    // Stripe id means nothing to a customer. The amount is enough to confirm against what they
    // just tapped "Pay" on a moment ago.
    text:
      `Pay ${formatCents(action.arguments.amountCents)}? ` +
      "This needs your confirmation before anything happens in Stripe.",
    keyboard,
  };
}

// Scans the given messages for the named tool's most recent result, mirroring the id-linking
// pattern apps/web/src/toolResults.ts already uses on the web side (reimplemented here since it
// operates on OpenAI SDK message types, not that file's own hand-rolled ChatMessage shape).
// Returns the LAST matching result if the tool was called more than once, same "latest reflects
// what the reply is actually describing" reasoning. Callers MUST pass only the current turn's own
// messages (see handleConversationalMessage's turnMessages) — passing full conversation history
// would re-surface a stale result from an earlier turn whenever the model doesn't re-call the tool.
function findToolResult(messages: ChatCompletionMessageParam[], toolName: string): unknown {
  const toolNameById = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        toolNameById.set(call.id, call.function.name);
      }
    }
  }

  let found: unknown;
  for (const message of messages) {
    if (message.role !== "tool" || typeof message.content !== "string") continue;
    if (toolNameById.get(message.tool_call_id) !== toolName) continue;
    try {
      found = JSON.parse(message.content);
    } catch {
      // Leave `found` as whatever it was — a malformed tool result is simply skipped.
    }
  }
  return found;
}

export interface ConversationalReply {
  text: string;
  invoiceList?: { text: string; keyboard: InlineKeyboard };
  pendingConfirmation?: { text: string; keyboard: InlineKeyboard };
  handoff?: string;
}

// The LLM-based counterpart to the /owe and pay: handlers below — same underlying tools
// (buildCustomerToolRegistry closes over lookupInvoices/proposeInvoicePayment unchanged), same
// pending-action store (runAssistantTurn already calls setPendingAction internally whenever a
// tool returns {kind:"pending"}), same deterministic renders (formatInvoiceList/
// formatPendingConfirmation/handoffMessage) reused as-is rather than trusting the model's own
// prose for anything guardrail-sensitive or precisely-worded — the model's own reply stays short
// and narrative, matching the web chat's "the card already shows it" tile convention.
export async function handleConversationalMessage(
  stripe: Stripe,
  openai: OpenAI,
  customerId: string,
  history: ChatCompletionMessageParam[],
  userText: string,
): Promise<{ reply: ConversationalReply; messages: ChatCompletionMessageParam[] }> {
  const nextMessages: ChatCompletionMessageParam[] = [...history, { role: "user", content: userText }];
  const result = await runAssistantTurn(stripe, openai, nextMessages, {
    toolRegistry: buildCustomerToolRegistry(customerId),
    systemPrompt: buildTelegramSystemPrompt(new Date()),
  });

  // result.messages is the WHOLE accumulated conversation (history + this turn's new messages),
  // not just what this turn produced — runAssistantTurn returns the full working array minus the
  // system message. Searching all of it for a tool result would keep re-surfacing a STALE result
  // from an earlier turn (e.g. an invoice list fetched several messages ago) on every later turn
  // where the model doesn't call the tool again, even though its own data is long out of date by
  // then. Slicing to only what's new this turn is what actually gives the "the card already shows
  // it" guarantee its own doc comment above claims — mirroring the turn-scoping the web frontend's
  // toolResults.ts already does for the same reason (its dedupeKey mechanism, per S9's B2 fix).
  const turnMessages = result.messages.slice(nextMessages.length);

  const reply: ConversationalReply = { text: result.reply };

  const invoicesResult = findToolResult(turnMessages, "get_my_invoices") as InvoiceLookupResult | undefined;
  if (invoicesResult?.invoices) {
    reply.invoiceList = formatInvoiceList(invoicesResult.invoices);
  }

  if (result.pendingAction?.tool === "pay_invoice") {
    reply.pendingConfirmation = formatPendingConfirmation(
      result.pendingAction as PendingAction<"pay_invoice", ResolvedInvoicePaymentArgs>,
    );
  }

  const payResult = findToolResult(turnMessages, "pay_invoice") as ProposeInvoicePaymentResult | undefined;
  if (payResult?.kind === "handoff") {
    reply.handoff = handoffMessage(payResult);
  }

  return { reply, messages: result.messages };
}

// --- grammY wiring — thin adapters over the testable core above --------------------------

export function startTelegramBot(logger: FastifyBaseLogger): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — Telegram bot will not start.");
    return;
  }

  let stripe: Stripe;
  try {
    stripe = createStripeClient();
  } catch (err) {
    logger.warn({ err }, "Telegram bot cannot start without a working Stripe client.");
    return;
  }

  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    const arg = ctx.match.trim();
    if (!arg) {
      await ctx.reply("Please provide your link token: /start <token>");
      return;
    }
    const result = await handleStart(stripe, ctx.chat.id, ctx.chat.type, arg);
    if (result === "linked") {
      // Stale history discussing a previous customer's invoices (or a previous link attempt)
      // must not leak into a freshly-(re)linked chat's next conversational turn.
      clearConversationHistory(ctx.chat.id);
    }
    await ctx.reply(startResultMessage(result));
  });

  bot.command("owe", async (ctx) => {
    const customerId = getCustomerId(ctx.chat.id);
    if (!customerId) {
      await ctx.reply("Please link your account first with /start <token>.");
      return;
    }
    try {
      const { invoices } = await lookupInvoices(stripe, customerId, { status: "open" });
      const { text, keyboard } = formatInvoiceList(invoices);
      await ctx.reply(text, { reply_markup: keyboard, parse_mode: "HTML" });
    } catch (err) {
      logger.error({ err }, "Failed to look up invoices");
      await ctx.reply("Sorry, something went wrong looking up your invoices. Please try again.");
    }
  });

  // S12 — anything that isn't /start or /owe (grammY only reaches this once both command matchers
  // above have already declined the message) is routed through the LLM tool-calling loop instead
  // of being silently ignored. /start and /owe keep working exactly as before; this is purely
  // additive. Money actually moves only via the existing confirm: callback below — this handler
  // can propose a payment (via pay_invoice) but never execute one.
  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      await ctx.reply("Sorry, I didn't recognize that command.");
      return;
    }

    const customerId = getCustomerId(ctx.chat.id);
    if (!customerId) {
      await ctx.reply("Please link your account first with /start <token>.");
      return;
    }

    try {
      const openai = createOpenAIClient();
      const history = getConversationHistory(ctx.chat.id);
      const { reply, messages } = await handleConversationalMessage(stripe, openai, customerId, history, text);
      setConversationHistory(ctx.chat.id, messages);

      if (reply.text) await ctx.reply(reply.text);
      if (reply.invoiceList) {
        await ctx.reply(reply.invoiceList.text, { reply_markup: reply.invoiceList.keyboard, parse_mode: "HTML" });
      }
      if (reply.pendingConfirmation) {
        await ctx.reply(reply.pendingConfirmation.text, { reply_markup: reply.pendingConfirmation.keyboard });
      }
      if (reply.handoff) await ctx.reply(reply.handoff, { parse_mode: "HTML" });
    } catch (err) {
      logger.error({ err }, "Failed to handle conversational message");
      await ctx.reply("Sorry, something went wrong. Please try again.");
    }
  });

  bot.callbackQuery(/^pay:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    const customerId = chatId ? getCustomerId(chatId) : undefined;
    if (!customerId) {
      await ctx.reply("Please link your account first with /start <token>.");
      return;
    }

    try {
      const invoiceId = ctx.match[1];
      const result = await proposeInvoicePayment(stripe, customerId, { invoiceId });

      if (result.kind === "pending") {
        setPendingAction(result.action);
        const { text, keyboard } = formatPendingConfirmation(result.action);
        await ctx.reply(text, { reply_markup: keyboard });
      } else if (result.kind === "handoff") {
        await ctx.reply(handoffMessage(result), { parse_mode: "HTML" });
      } else if (result.kind === "already_paid") {
        await ctx.reply("That invoice is already paid.");
      } else {
        await ctx.reply("I couldn't find that invoice.");
      }
    } catch (err) {
      logger.error({ err }, "Failed to propose invoice payment");
      await ctx.reply("Sorry, something went wrong. Please try again.");
    }
  });

  bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    const customerId = chatId ? getCustomerId(chatId) : undefined;
    if (!customerId) {
      await ctx.reply("Please link your account first with /start <token>.");
      return;
    }

    const resolved = resolveConfirmablePendingAction(ctx.match[1], customerId);
    if (resolved.kind === "not_found") {
      await ctx.reply("That request has expired or was already handled.");
      return;
    }
    if (resolved.kind === "forbidden") {
      await ctx.reply("That request doesn't belong to you.");
      return;
    }

    try {
      const invoice = await confirmPayInvoice(stripe, resolved.action, customerId);
      await ctx.reply(`✅ Payment of ${formatCents(invoice.amount_paid)} received. Thank you!`);
    } catch (err) {
      // Never relay the raw error to the customer — it could be an AuthorizationError's message
      // or a raw Stripe error string, neither meant for end-user eyes (see invoice-payment.ts's
      // "not_found" collapsing for the same reasoning). Only the log gets the real detail.
      logger.error({ err }, "Failed to confirm invoice payment");
      await ctx.reply("Sorry, that payment couldn't be completed. Please try again or ask us directly.");
    }
  });

  bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    const customerId = chatId ? getCustomerId(chatId) : undefined;
    if (!customerId) {
      await ctx.reply("Please link your account first with /start <token>.");
      return;
    }

    const result = cancelPendingAction(ctx.match[1], customerId);
    if (result === "cancelled") {
      await ctx.reply("Cancelled.");
    } else if (result === "not_found") {
      await ctx.reply("That request has expired or was already handled.");
    } else {
      await ctx.reply("That request doesn't belong to you.");
    }
  });

  bot.catch((err) => {
    logger.error({ err }, "Telegram bot error");
  });

  bot.start().catch((err) => {
    logger.error({ err }, "Telegram bot stopped unexpectedly");
  });

  logger.info("Telegram bot started");
}

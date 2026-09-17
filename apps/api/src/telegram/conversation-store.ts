import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// S12 (docs/feature.md) — per-chat conversation history for the Telegram bot's free-text handler.
// The web chat's history lives client-side (the browser resends the whole array every turn), but
// Telegram has no equivalent — the bot itself must remember each chat's history to support
// multi-turn references like "pay the first one" after "what do I owe." Same in-memory-only
// tradeoff as session.ts's chatToCustomer map (ADR-004) — not persisted across a restart, fine at
// this project's scale.
const histories = new Map<number, ChatCompletionMessageParam[]>();

export function getConversationHistory(chatId: number): ChatCompletionMessageParam[] {
  return histories.get(chatId) ?? [];
}

export function setConversationHistory(chatId: number, messages: ChatCompletionMessageParam[]): void {
  histories.set(chatId, messages);
}

// Called on a successful (re-)link — stale history discussing a previous customer's invoices must
// not leak into a newly-linked chat's context.
export function clearConversationHistory(chatId: number): void {
  histories.delete(chatId);
}

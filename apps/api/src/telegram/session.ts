// The only persisted state in this app beyond Stripe itself (ADR-004) — a single in-memory map,
// sufficient for local dev with a handful of chats. The reverse lookup (is this customerId
// already linked to some other chat?) is done by scanning `.values()` rather than keeping a
// second map in sync — premature at this scale, and a second piece of state that could drift.
const chatToCustomer = new Map<number, string>();

export type LinkResult =
  | "linked" // newly linked, or an idempotent re-send of the same chat+customer pair
  | "already_linked_elsewhere" // this customerId is linked to a different chat
  | "chat_linked_to_other_customer"; // this chat is already linked to a different customerId

// Does not validate that customerId actually exists in Stripe — that's the caller's job
// (telegram/bot.ts's handleStart), keeping this module Stripe-free and trivially testable.
export function linkChat(chatId: number, customerId: string): LinkResult {
  const existingForChat = chatToCustomer.get(chatId);
  if (existingForChat === customerId) {
    return "linked"; // idempotent no-op
  }
  if (existingForChat !== undefined) {
    return "chat_linked_to_other_customer";
  }

  for (const linkedCustomerId of chatToCustomer.values()) {
    if (linkedCustomerId === customerId) {
      return "already_linked_elsewhere";
    }
  }

  chatToCustomer.set(chatId, customerId);
  return "linked";
}

export function getCustomerId(chatId: number): string | undefined {
  return chatToCustomer.get(chatId);
}

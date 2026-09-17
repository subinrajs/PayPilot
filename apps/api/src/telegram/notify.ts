import { Api } from "grammy";

// S13 (docs/feature.md) — sends a Telegram message OUTSIDE of a ctx.reply() call, for the Stripe
// webhook route (routes/stripe-webhook.ts) to proactively notify a customer. Deliberately a
// lightweight standalone Api client rather than reaching into bot.ts's long-polling Bot instance —
// that instance is a local variable inside startTelegramBot, never exported, and grammY's own Api
// class (what Bot uses internally to send messages) works identically without it. Same lazy,
// per-call construction as createStripeClient/createOpenAIClient elsewhere in this codebase.
export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN — cannot send a Telegram message.");
  }
  const api = new Api(token);
  await api.sendMessage(chatId, text);
}

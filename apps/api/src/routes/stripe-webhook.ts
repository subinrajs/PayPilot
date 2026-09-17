import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { createStripeClient, getStripeWebhookSecret } from "../stripe.js";
import { getChatIdForCustomer } from "../telegram/session.js";
import { sendTelegramMessage } from "../telegram/notify.js";
import { isAtOrAboveCap } from "../policies/payment-policy.js";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// S13 (docs/feature.md) — Stripe's at-least-once delivery guarantee means the same event id can
// arrive more than once; without this, a redelivered invoice.paid would send the customer a second
// "payment received" message for the same payment. In-memory only, same accepted tradeoff as
// pending-action-store.ts/session.ts — this app is single-instance, local-dev scale.
const processedEventIds = new Set<string>();

// The ONLY reason this route needs to exist at all: an invoice at/above the $2,000 cap can never be
// paid through the bot's own Confirm button (invoice-payment.ts's executeInvoicePayment calls
// assertBelowCap and would throw first) — the customer's only path to pay one is the hosted invoice
// link in handoffMessage (bot.ts), which happens entirely outside this app. A below-cap invoice, by
// contrast, can only be paid via the bot's own Confirm button in this app's current UI (the hosted
// link is never shown to the customer for those) — and that flow already sends its own confirmation
// synchronously in the same turn. So this cap check is what keeps the two notification paths
// mutually exclusive BY CONSTRUCTION, not by tracking "did the bot already tell them" as state.
export async function stripeWebhookRoutes(app: FastifyInstance) {
  // Scoped to this plugin's own encapsulation context (Fastify's register() calls in server.ts are
  // each independently encapsulated) — /api/assistant and /api/dashboard/* keep normal JSON
  // parsing. Stripe's signature is an HMAC over the exact raw request bytes, so the default parser
  // (which would discard them) can't be used here.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/api/stripe/webhook", async (request, reply) => {
    const signature = request.headers["stripe-signature"];
    if (typeof signature !== "string") {
      return reply.status(400).send({ error: "Missing stripe-signature header" });
    }

    let webhookSecret: string;
    try {
      webhookSecret = getStripeWebhookSecret();
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: "Webhook is not configured" });
    }

    const stripe = createStripeClient();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(request.body as Buffer, signature, webhookSecret);
    } catch (err) {
      // A bad/forged signature — never business logic beyond this point. Logged as a warning
      // (not an error) since a stale/misconfigured secret during local dev is expected, not a
      // real incident every time.
      request.log.warn(err, "Stripe webhook signature verification failed");
      return reply.status(400).send({ error: "Invalid signature" });
    }

    if (event.type === "invoice.paid") {
      await handleInvoicePaid(event, request.log);
    }

    return reply.status(200).send({ received: true });
  });
}

async function handleInvoicePaid(event: Stripe.Event, logger: { info: (msg: string) => void }): Promise<void> {
  if (processedEventIds.has(event.id)) return;

  const invoice = event.data.object as Stripe.Invoice;
  if (!isAtOrAboveCap(invoice.amount_paid)) {
    // Paid below the cap — only reachable via the bot's own Confirm button, which already told
    // the customer in the same turn. Nothing to do here.
    return;
  }

  const customerId = typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? null);
  const chatId = customerId ? getChatIdForCustomer(customerId) : undefined;
  if (chatId === undefined) {
    // No linked Telegram chat for this customer — nothing to notify.
    return;
  }

  processedEventIds.add(event.id);
  await sendTelegramMessage(chatId, `✅ Payment of ${formatCents(invoice.amount_paid)} received. Thank you!`);
  logger.info(`Notified chat ${chatId} of payment for invoice ${invoice.id}`);
}

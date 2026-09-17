import Stripe from "stripe";

export function createStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "Missing STRIPE_SECRET_KEY. Copy apps/api/.env.example to apps/api/.env and fill in a Stripe test-mode secret key.",
    );
  }
  return new Stripe(key);
}

// S13 (docs/feature.md) — signs/verifies the Stripe webhook route's payload. Same lazy,
// throw-on-missing pattern as createStripeClient above, rather than validated at server startup:
// a missing key should only break the one route that needs it (routes/stripe-webhook.ts), not
// server boot or every other route.
export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "Missing STRIPE_WEBHOOK_SECRET. Copy apps/api/.env.example to apps/api/.env and fill in the signing " +
        "secret printed by `stripe listen --forward-to localhost:3000/api/stripe/webhook` (see docs/onboarding.md).",
    );
  }
  return secret;
}

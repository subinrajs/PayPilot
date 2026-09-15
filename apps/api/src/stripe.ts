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

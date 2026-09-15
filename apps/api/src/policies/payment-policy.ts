// Amounts are in cents (Stripe's native unit). The cap boundary is "$2,000 or more" — an amount
// of exactly 200000 is capped, not payable. This is a plain conditional, not a prompt
// instruction: every Telegram payment path must call assertBelowCap before touching Stripe.
export const PAYMENT_CAP_CENTS = 200_000;

export class PaymentCapExceededError extends Error {
  constructor(public readonly amountCents: number) {
    super(`Amount ${amountCents} is at or above the ${PAYMENT_CAP_CENTS}-cent payment cap`);
    this.name = "PaymentCapExceededError";
  }
}

export function isAtOrAboveCap(amountCents: number): boolean {
  return amountCents >= PAYMENT_CAP_CENTS;
}

export function assertBelowCap(amountCents: number): void {
  if (isAtOrAboveCap(amountCents)) {
    throw new PaymentCapExceededError(amountCents);
  }
}

import type Stripe from "stripe";

export class AuthorizationError extends Error {
  constructor(message = "Resource does not belong to this customer") {
    super(message);
    this.name = "AuthorizationError";
  }
}

// Every Telegram-scoped tool must run this before returning or acting on any resource fetched by
// id — customerId comes from the server-side session, never from the LLM, so this is the check
// that actually stops one customer's chat from reading or acting on another customer's data.
export function assertOwnedByCustomer(
  customerId: string,
  resource: { customer: string | Stripe.Customer | Stripe.DeletedCustomer | null },
): void {
  const resourceCustomerId =
    typeof resource.customer === "string" ? resource.customer : (resource.customer?.id ?? null);

  if (resourceCustomerId !== customerId) {
    throw new AuthorizationError();
  }
}

export function scopeListParams(customerId: string): { customer: string } {
  return { customer: customerId };
}

import type Stripe from "stripe";
import type { ChargeLike } from "./aggregation.js";

// Shared by daily-summary.ts and revenue-comparison.ts — both fetch charges over a date range and
// reduce them to the same plain shape aggregation.ts operates on.
export async function fetchChargesInRange(stripe: Stripe, startSec: number, endSec: number): Promise<ChargeLike[]> {
  const charges: ChargeLike[] = [];
  for await (const charge of stripe.charges.list({
    created: { gte: startSec, lt: endSec },
    limit: 100,
    expand: ["data.customer"],
  })) {
    charges.push(toChargeLike(charge));
  }
  return charges;
}

function toChargeLike(charge: Stripe.Charge): ChargeLike {
  const customer = charge.customer;
  const customerName =
    customer && typeof customer === "object" && !("deleted" in customer && customer.deleted)
      ? (customer.name ?? null)
      : null;

  return {
    id: charge.id,
    amountCents: charge.amount,
    status: charge.status,
    customerName,
    description: charge.description,
  };
}

// Interprets the date at UTC midnight — "today" is a UTC day, not the owner's local timezone.
// Fine for a single test-mode account with no timezone requirement in spec.md; revisit if this
// ever needs to match a specific owner's calendar day.
export function isoDateToUnixSeconds(isoDate: string): number {
  return Math.floor(new Date(`${isoDate}T00:00:00.000Z`).getTime() / 1000);
}

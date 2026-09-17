import "dotenv/config";
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error(
    "Missing STRIPE_SECRET_KEY. Copy apps/api/.env.example to apps/api/.env and fill in a Stripe *test-mode* secret key before running `pnpm seed`.",
  );
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAY_OFFSET = 4;
// Stripe caps a test clock at 3 customers — split the customers to seed into groups this size
// or smaller, each on its own clock, rather than one shared clock for everyone.
const MAX_CUSTOMERS_PER_CLOCK = 3;
const now = new Date();

type CustomerKey = "maya" | "acme" | "john" | "sarah";

const CUSTOMERS: Array<{ key: CustomerKey; name: string; email: string }> = [
  { key: "maya", name: "Maya Rodriguez", email: "maya.rodriguez@example.com" },
  { key: "acme", name: "Acme Corp", email: "billing@acmecorp.example.com" },
  { key: "john", name: "John Smith", email: "john.smith@example.com" },
  { key: "sarah", name: "Sarah Johnson", email: "sarah.johnson@example.com" },
];

// [dayOffset, customerKey, amountCents, outcome, description] — dayOffset counts back from today.
const CHARGE_SCHEDULE: Array<{
  dayOffset: number;
  customerKey: CustomerKey;
  amountCents: number;
  outcome: "success" | "decline";
  description: string;
}> = [
  { dayOffset: 4, customerKey: "maya", amountCents: 8000, outcome: "success", description: "Consulting session" },
  { dayOffset: 4, customerKey: "acme", amountCents: 25000, outcome: "success", description: "Monthly retainer" },
  { dayOffset: 3, customerKey: "john", amountCents: 4500, outcome: "decline", description: "Product purchase" },
  { dayOffset: 3, customerKey: "sarah", amountCents: 12000, outcome: "success", description: "Design work" },
  { dayOffset: 2, customerKey: "maya", amountCents: 6000, outcome: "success", description: "Follow-up session" },
  { dayOffset: 2, customerKey: "acme", amountCents: 9000, outcome: "decline", description: "Add-on service" },
  { dayOffset: 1, customerKey: "sarah", amountCents: 15000, outcome: "success", description: "Design revision" },
  { dayOffset: 0, customerKey: "john", amountCents: 5000, outcome: "success", description: "Repair job" },
  { dayOffset: 0, customerKey: "maya", amountCents: 7000, outcome: "success", description: "Latest session" },
];

// dueOffsetMs is added to `now` to get due_date — Stripe requires due_date to be strictly after
// the invoice's creation time (even for a deliberately "overdue" invoice), so John's can't use a
// negative offset. Instead it's due just under a minute out: that satisfies Stripe's validation at
// creation time, and since due_date is a fixed real-world timestamp (not tied to any test clock),
// it will already be in the real past within about a minute of seeding — John's invoice will read
// as "outstanding, not yet overdue" for that brief window right after `pnpm seed` finishes.
const INVOICE_PLAN: Record<CustomerKey, { amountCents: number; dueOffsetMs: number; pay: boolean; description: string }> = {
  maya: { amountCents: 15000, dueOffsetMs: 14 * DAY_MS, pay: true, description: "Website maintenance" }, // paid
  acme: { amountCents: 45000, dueOffsetMs: 14 * DAY_MS, pay: false, description: "Q3 services" }, // outstanding, under cap
  john: { amountCents: 32000, dueOffsetMs: 60 * 1000, pay: false, description: "Repair follow-up" }, // overdue
  sarah: { amountCents: 250000, dueOffsetMs: 14 * DAY_MS, pay: false, description: "Brand redesign package" }, // at/above cap
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForClockReady(clockId: string) {
  const timeoutAt = Date.now() + 60_000;
  while (Date.now() < timeoutAt) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === "ready") return;
    if (clock.status === "internal_failure") {
      throw new Error(`Test clock ${clockId} entered internal_failure`);
    }
    await sleep(2000);
  }
  throw new Error(`Test clock ${clockId} did not become ready in time`);
}

async function advanceClockTo(clockId: string, date: Date) {
  await stripe.testHelpers.testClocks.advance(clockId, {
    frozen_time: Math.floor(date.getTime() / 1000),
  });
  await waitForClockReady(clockId);
}

async function createSeedInvoice(
  customerId: string,
  opts: { amountCents: number; dueOffsetMs: number; pay: boolean; description: string },
) {
  await stripe.invoiceItems.create({
    customer: customerId,
    amount: opts.amountCents,
    currency: "usd",
    description: opts.description,
  });

  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: "send_invoice",
    due_date: Math.floor((now.getTime() + opts.dueOffsetMs) / 1000),
    // The invoice ITEM's description (above) doesn't carry over to the invoice object itself —
    // without this, invoice.description is null and any caller listing invoices (e.g. the
    // Telegram bot) falls back to displaying the raw Stripe id instead of something readable.
    description: opts.description,
    // Without this, the invoice is created with no line items at all (the pending invoice item
    // created above stays unattached, `invoice: null`), so it finalizes as a $0 invoice that
    // Stripe immediately marks "paid" regardless of `pay` below — the pending item is only
    // pulled in if this is explicit.
    pending_invoice_items_behavior: "include",
  });

  await stripe.invoices.finalizeInvoice(invoice.id);

  if (opts.pay) {
    try {
      await stripe.invoices.pay(invoice.id);
    } catch (err) {
      // The Stripe SDK auto-retries on network issues using the same idempotency key; if the
      // first attempt actually succeeded server-side but the client didn't see the response in
      // time, the retry lands on an already-paid invoice and throws this specific error. Treat
      // it as success rather than aborting the run.
      const alreadyPaid = err instanceof Stripe.errors.StripeInvalidRequestError && err.message.includes("already paid");
      if (!alreadyPaid) throw err;
    }
  }
}

async function customerHasInvoice(customerId: string): Promise<boolean> {
  const invoices = await stripe.invoices.list({ customer: customerId, limit: 1 });
  return invoices.data.length > 0;
}

// disputes.list has no `customer` filter, so existence is checked the same way
// getDisputesSummary (agent/dashboard.ts) already scans disputes — via the expanded charge. Cheap
// at this project's scale (a handful of disputes at most), same ADR-004 reasoning.
async function customerHasDispute(customerId: string): Promise<boolean> {
  for await (const dispute of stripe.disputes.list({ limit: 100, expand: ["data.charge"] })) {
    const charge = typeof dispute.charge === "object" && dispute.charge !== null ? dispute.charge : null;
    if (charge?.customer === customerId) return true;
  }
  return false;
}

// S11 (docs/feature.md) needs a real dispute to demonstrate the AI dispute assistant against —
// Stripe's ordinary test charges never generate one on their own. "pm_card_createDisputeProductNotReceived"
// is Stripe's documented test PaymentMethod for this: the charge succeeds, then Stripe disputes it
// as "product_not_received" shortly after (asynchronously, not instantly).
// https://docs.stripe.com/testing#disputes. This needs the PaymentIntents API, unlike the rest of
// this script's charges (which use the older Charges API with source tokens) — the dispute-
// triggering payment methods aren't usable through that older API.
async function createSeedDispute(customerId: string) {
  await stripe.paymentIntents.create({
    amount: 89000,
    currency: "usd",
    customer: customerId,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    payment_method: "pm_card_createDisputeProductNotReceived",
    confirm: true,
    description: "Office equipment order",
  });
}

// Customers attached to a test clock are NOT returned by a plain `customers.list()` (with or
// without an `email` filter) — Stripe only returns them when the list call is filtered by that
// specific test_clock id. Since every seed customer is attached to a clock, checking existence
// means checking ordinary (clock-less) customers AND every existing clock's customers.
async function findExistingCustomersByEmail(): Promise<Map<string, Stripe.Customer>> {
  const byEmail = new Map<string, Stripe.Customer>();

  for await (const c of stripe.customers.list({ limit: 100 })) {
    if (c.email) byEmail.set(c.email, c);
  }

  for await (const clock of stripe.testHelpers.testClocks.list({ limit: 100 })) {
    // `test_clock` is a documented filter on customers.list
    // (https://stripe.com/docs/api/customers/list#list_customers-test_clock) that the installed
    // stripe SDK's TS types don't declare — the cast below only adds this field via intersection
    // rather than loosening the existing param checks, so it won't mask an unrelated type error.
    for await (const c of stripe.customers.list({
      limit: 100,
      test_clock: clock.id,
    } as Stripe.CustomerListParams & { test_clock: string })) {
      if (c.email) byEmail.set(c.email, c);
    }
  }

  return byEmail;
}

async function main() {
  console.log("Seeding Stripe test-mode sandbox...\n");

  // Idempotency: a customer with a seed email already existing means a previous run got at least
  // as far as creating this customer — skip re-creating them rather than making a duplicate.
  // Invoices are checked independently per customer (below) since a previous run can have
  // crashed between creating a customer's charges and creating their invoice; if that happens,
  // this only repairs the missing invoice. It does NOT re-check or repair missing charges for an
  // already-existing customer — a run that crashed mid-way through a customer's charge loop will
  // leave that customer permanently short some charges on every future rerun. If that happens,
  // delete the affected test clock (which cascades to its customers) and rerun from scratch.
  console.log("Checking for already-seeded customers...");
  const existingByEmail = await findExistingCustomersByEmail();
  const customers = {} as Record<CustomerKey, Stripe.Customer>;
  const toSeed: CustomerKey[] = [];

  for (const c of CUSTOMERS) {
    const existing = existingByEmail.get(c.email);
    if (existing) {
      customers[c.key] = existing;
      console.log(`  ${c.name}: already exists (${existing.id}) — skipping`);
    } else {
      toSeed.push(c.key);
    }
  }

  if (toSeed.length === 0) {
    console.log("\nAll seed customers already exist — nothing new to create.");
  } else {
    console.log(`Creating ${toSeed.length} new customer(s): ${toSeed.join(", ")}`);

    const clockGroups: CustomerKey[][] = [];
    for (let i = 0; i < toSeed.length; i += MAX_CUSTOMERS_PER_CLOCK) {
      clockGroups.push(toSeed.slice(i, i + MAX_CUSTOMERS_PER_CLOCK));
    }

    for (const group of clockGroups) {
      console.log(`Creating test clock for ${group.join(", ")} (so their payments can be backdated)...`);
      const startDate = new Date(now.getTime() - MAX_DAY_OFFSET * DAY_MS);
      const clock = await stripe.testHelpers.testClocks.create({
        frozen_time: Math.floor(startDate.getTime() / 1000),
        name: `paypilot-seed-${group.join("-")}`,
      });
      await waitForClockReady(clock.id);

      for (const key of group) {
        const c = CUSTOMERS.find((x) => x.key === key)!;
        const customer = await stripe.customers.create({
          name: c.name,
          email: c.email,
          test_clock: clock.id,
        });
        customers[key] = customer;

        // "pm_card_visa" is one of Stripe's special test PaymentMethod ids, documented as safe
        // to attach to multiple different test customers (unlike a real PaymentMethod, which is
        // single-customer): https://stripe.com/docs/testing#cards
        const paymentMethod = await stripe.paymentMethods.attach("pm_card_visa", {
          customer: customer.id,
        });
        await stripe.customers.update(customer.id, {
          invoice_settings: { default_payment_method: paymentMethod.id },
        });
      }

      console.log(`Creating payments for ${group.join(", ")} across the last few days...`);
      const schedule = CHARGE_SCHEDULE.filter((c) => group.includes(c.customerKey));
      const dayOffsets = Array.from(new Set(schedule.map((c) => c.dayOffset))).sort((a, b) => b - a);

      for (const offset of dayOffsets) {
        if (offset !== MAX_DAY_OFFSET) {
          await advanceClockTo(clock.id, new Date(now.getTime() - offset * DAY_MS));
        }

        for (const charge of schedule.filter((c) => c.dayOffset === offset)) {
          const customer = customers[charge.customerKey];
          try {
            if (charge.outcome === "success") {
              // Charging a `customer` with a raw token in the same call only works for a
              // single-use token — this special reusable test token must be attached as a card
              // on the customer first, then charged by that card's id.
              const card = await stripe.customers.createSource(customer.id, { source: "tok_visa" });
              await stripe.charges.create({
                amount: charge.amountCents,
                currency: "usd",
                customer: customer.id,
                source: card.id,
                description: charge.description,
              });
            } else {
              // "tok_chargeDeclined" can't be attached to a customer at all (the attach call
              // itself throws, before any Charge exists) — so a declined charge here is
              // deliberately NOT linked to a customer. Passed as a bare source with no customer,
              // Stripe still records a real "failed" Charge, just without customer attribution.
              // A future per-customer "payment history" feature won't find this decline under
              // john/acme's customer record in Stripe — only in an unscoped charge list.
              await stripe.charges.create({
                amount: charge.amountCents,
                currency: "usd",
                source: "tok_chargeDeclined",
                description: charge.description,
              });
            }
          } catch (err) {
            if (charge.outcome === "decline" && err instanceof Stripe.errors.StripeCardError) {
              continue;
            }
            throw err;
          }
        }
      }

      // The loop above already advances the clock to `now` if the filtered schedule has a
      // dayOffset-0 entry — advancing to the same frozen_time twice is rejected by Stripe ("must
      // be after the current frozen time"), so only advance here if that didn't happen.
      if (!dayOffsets.includes(0)) {
        await advanceClockTo(clock.id, now);
      }
    }
  }

  // Checked per-customer and independently of whether the customer was just created or already
  // existed, so a run that got a customer's charges seeded but crashed before their invoice (as
  // happened once) is repaired by the next run rather than skipped as "already seeded."
  console.log("Creating invoices where missing...");
  for (const c of CUSTOMERS) {
    const customer = customers[c.key];
    if (await customerHasInvoice(customer.id)) {
      console.log(`  ${c.name}: already has an invoice — skipping`);
      continue;
    }
    await createSeedInvoice(customer.id, INVOICE_PLAN[c.key]);
  }

  console.log("Creating a test dispute (if not already present)...");
  const disputeCustomer = CUSTOMERS.find((c) => c.key === "acme")!;
  if (await customerHasDispute(customers[disputeCustomer.key].id)) {
    console.log(`  ${disputeCustomer.name}: already has a dispute — skipping`);
  } else {
    await createSeedDispute(customers[disputeCustomer.key].id);
    console.log(
      `  Triggered a "product not received" test dispute for ${disputeCustomer.name} — Stripe creates it ` +
        "asynchronously, so it may take a few seconds to appear.",
    );
  }

  console.log("\nSeed complete.\n");
  console.log("Telegram link-tokens (link-token is the Stripe customer id — use with /start <token>):\n");
  for (const c of CUSTOMERS) {
    console.log(`  ${c.name.padEnd(16)} ${customers[c.key].id}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});

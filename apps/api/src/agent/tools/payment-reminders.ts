import { z } from "zod";

// S14 (docs/feature.md) — the model composes subject/body per item itself (from real facts it
// already has via get_outstanding_invoices/get_failed_payments — enforced by system-prompt.ts
// guidance, not by this schema); this tool just validates the shape and echoes it back structured
// for the frontend's PaymentReminderCard to render. No pending action: nothing external is
// mutated by drafting — only the separate, deterministic POST /api/reminders/send route (which
// this tool never calls) has any effect at all, and even that is a simulated log, not a real send.
const ReminderItemSchema = z
  .object({
    // invoiceId for an overdue invoice, or the charge id for a failed payment — whichever the
    // corresponding lookup tool returned, so /api/reminders/send's log line can reference the
    // real Stripe object even though nothing is actually looked up again there.
    targetId: z.string().min(1),
    targetType: z.enum(["overdue_invoice", "failed_payment"]),
    customerName: z.string().min(1),
    customerEmail: z.string().nullable(),
    amountCents: z.number().int().positive(),
    // The real hosted-invoice link (if any), carried through unchanged from get_outstanding_invoices'/
    // get_failed_payments' own result — never something the model composes itself. subject/body must
    // never contain a URL or markdown link syntax (enforced by system-prompt.ts guidance, not this
    // schema); the UI renders this field as a real, friendly link instead.
    invoiceUrl: z.string().nullable(),
    subject: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();
export type ReminderItem = z.infer<typeof ReminderItemSchema>;

export const DraftPaymentRemindersArgsSchema = z
  .object({
    reminders: z.array(ReminderItemSchema).min(1),
  })
  .strict();
export type DraftPaymentRemindersArgs = z.infer<typeof DraftPaymentRemindersArgsSchema>;

export interface DraftPaymentRemindersResult {
  reminders: ReminderItem[];
}

// The model reliably writes a URL (sometimes as markdown [text](url), sometimes bare) into
// subject/body despite the explicit "never do this, invoiceUrl is a separate field" instruction
// in system-prompt.ts/this tool's own description — the same "prompt wording alone doesn't
// reliably hold" pattern already seen and fixed deterministically for the reply-duplication issue
// (routes/assistant.ts). Since invoiceUrl is already rendered as its own real link by
// PaymentReminderCard, any URL the model still embeds in free text is pure redundancy at best and
// a repeat of the exact "broken UI" bug report at worst — stripped here so the guarantee doesn't
// depend on the model complying.
function stripEmbeddedLinks(text: string, fallback: string): string {
  const stripped = text
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+(?=\n)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Guards the rare case the original text was nothing but a URL — the schema's .min(1) was
  // already satisfied before stripping, but nothing re-validates the result afterward.
  return stripped.length > 0 ? stripped : fallback;
}

// async despite doing no I/O — every ToolRegistryEntry handler is `(stripe, args) => Promise<unknown>`
// (tool-registry.ts), and this tool takes no Stripe client at all, so the handler in tool-registry.ts
// wraps this directly; keeping this itself async lets that wrapping stay a plain reference, no extra
// Promise.resolve() wrapper needed at the call site.
export async function draftPaymentReminders(args: DraftPaymentRemindersArgs): Promise<DraftPaymentRemindersResult> {
  const parsed = DraftPaymentRemindersArgsSchema.parse(args);
  const reminders = parsed.reminders.map((reminder) => ({
    ...reminder,
    subject: stripEmbeddedLinks(reminder.subject, "Payment reminder"),
    body: stripEmbeddedLinks(reminder.body, "Please see the invoice link below for details."),
  }));
  return { reminders };
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";

// S14 (docs/feature.md) — deterministic, LLM-free: once a reminder's subject/body is finalized
// (drafted by the model, or edited by the owner in PaymentReminderCard), actually "sending" it
// requires no reasoning, only logging a fixed string. Explicitly simulated per the owner's own
// request — no real email provider is configured anywhere in this app (the same honest gap S10's
// invoice-send already has), so this only logs and reports success, never touching Stripe or any
// external service. No pending-action/confirm gate: unlike every money-moving action in this app,
// nothing real happens here — the review-then-edit step in the chat tile already is the checkpoint.
const ReminderItemSchema = z
  .object({
    targetId: z.string().min(1),
    targetType: z.enum(["overdue_invoice", "failed_payment"]),
    customerName: z.string().min(1),
    customerEmail: z.string().nullable(),
    amountCents: z.number().int().positive(),
    invoiceUrl: z.string().nullable(),
    subject: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();

const SendRemindersBodySchema = z
  .object({
    reminders: z.array(ReminderItemSchema).min(1),
  })
  .strict();

export async function remindersRoutes(app: FastifyInstance) {
  app.post("/api/reminders/send", async (request, reply) => {
    const parsed = SendRemindersBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const results = parsed.data.reminders.map((reminder) => {
      request.log.info(
        {
          targetId: reminder.targetId,
          targetType: reminder.targetType,
          customerName: reminder.customerName,
          customerEmail: reminder.customerEmail,
          subject: reminder.subject,
        },
        "Simulated payment reminder email sent — no real email provider is configured, nothing was actually sent",
      );
      return { targetId: reminder.targetId, status: "sent" as const };
    });

    return { results };
  });
}

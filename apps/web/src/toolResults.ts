import type {
  ChatMessage,
  CustomerInvoicesFound,
  DailySummary,
  InvoiceDraft,
  OutstandingInvoicesResult,
  RefundLookupResult,
  RevenueComparison,
} from "./api.js";

export type RenderItem =
  | { kind: "message"; key: string; message: ChatMessage }
  | { kind: "daily-summary"; key: string; data: DailySummary }
  | { kind: "revenue-comparison"; key: string; data: RevenueComparison }
  | { kind: "customer-invoices"; key: string; data: CustomerInvoicesFound }
  | { kind: "refunds"; key: string; data: RefundLookupResult }
  | { kind: "outstanding-invoices"; key: string; data: OutstandingInvoicesResult }
  | { kind: "invoice-draft"; key: string; data: InvoiceDraft };

function isDisplayableMessage(message: ChatMessage): boolean {
  if (message.role === "user") return true;
  if (message.role === "assistant") return typeof message.content === "string" && message.content.length > 0;
  return false;
}

function isDailySummary(value: unknown): value is DailySummary {
  const v = value as Partial<DailySummary> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.succeededCount === "number" &&
    typeof v.netTotalCents === "number" &&
    Array.isArray(v.charges)
  );
}

function isRevenueComparison(value: unknown): value is RevenueComparison {
  const v = value as Partial<RevenueComparison> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.current === "object" &&
    typeof v.previous === "object" &&
    typeof v.differenceCents === "number"
  );
}

function isCustomerInvoicesFound(value: unknown): value is CustomerInvoicesFound {
  const v = value as Partial<CustomerInvoicesFound> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    v.kind === "found" &&
    typeof v.customerName === "string" &&
    Array.isArray(v.invoices)
  );
}

function isRefundLookupResult(value: unknown): value is RefundLookupResult {
  const v = value as Partial<RefundLookupResult> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.count === "number" &&
    typeof v.totalCents === "number" &&
    Array.isArray(v.refunds)
  );
}

function isOutstandingInvoicesResult(value: unknown): value is OutstandingInvoicesResult {
  const v = value as Partial<OutstandingInvoicesResult> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.status === "string" &&
    typeof v.count === "number" &&
    typeof v.totalCents === "number" &&
    Array.isArray(v.invoices)
  );
}

function isInvoiceDraft(value: unknown): value is InvoiceDraft {
  const v = value as Partial<InvoiceDraft> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    v.kind === "created" &&
    typeof v.draftInvoiceId === "string" &&
    Array.isArray(v.items) &&
    Array.isArray(v.reviewFlags)
  );
}

// Only these seven read-only-or-draft-only tools get structured tiles. propose_refund/
// send_invoice results are deliberately never matched here — those already surface through
// PendingActionPanel, driven by the response's separate `pendingAction` field, not by parsing
// the raw message transcript. create_invoice_draft/update_invoice_draft's ambiguous/not-found
// variants (no draftInvoiceId) fall through and stay invisible, same as every other tool here.
const TILE_TOOLS = new Set([
  "get_daily_summary",
  "get_revenue_comparison",
  "get_customer_invoices",
  "get_refunds",
  "get_outstanding_invoices",
  "create_invoice_draft",
  "update_invoice_draft",
]);

type PendingRenderItem = RenderItem & { turn: number; dedupeKey?: string };

// Converts the raw message transcript into what actually gets rendered. A tool-calling assistant
// message (content is usually null) contributes no bubble of its own but registers its
// tool_call ids so the matching role:"tool" result — which appears later in the array — can be
// identified by tool name and, for the three tools above, rendered as a tile instead of staying
// invisible. Any other tool-role message (an unrecognized tool, or a result whose shape didn't
// match its own tool's expected fields — e.g. an {error: ...} result, or an ambiguous/not-found
// invoice lookup with nothing structured to show) stays invisible, exactly as before this
// feature existed.
export function buildRenderItems(messages: ChatMessage[]): RenderItem[] {
  const toolNameById = new Map<string, string>();
  const items: PendingRenderItem[] = [];
  let turn = 0;

  messages.forEach((message, index) => {
    if (message.role === "user") turn++;

    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        toolNameById.set(call.id, call.function.name);
      }
    }

    if (message.role === "tool") {
      const toolName = message.tool_call_id ? toolNameById.get(message.tool_call_id) : undefined;

      if (toolName && TILE_TOOLS.has(toolName) && typeof message.content === "string") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(message.content);
        } catch {
          parsed = undefined;
        }

        if (toolName === "get_daily_summary" && isDailySummary(parsed)) {
          items.push({ kind: "daily-summary", key: `tool-${index}`, data: parsed, turn, dedupeKey: `daily-summary:${parsed.date}` });
          return;
        }
        if (toolName === "get_revenue_comparison" && isRevenueComparison(parsed)) {
          items.push({
            kind: "revenue-comparison",
            key: `tool-${index}`,
            data: parsed,
            turn,
            dedupeKey: `revenue-comparison:${parsed.current.startDate}_${parsed.current.endDate}_${parsed.previous.startDate}_${parsed.previous.endDate}`,
          });
          return;
        }
        if (toolName === "get_customer_invoices" && isCustomerInvoicesFound(parsed)) {
          items.push({
            kind: "customer-invoices",
            key: `tool-${index}`,
            data: parsed,
            turn,
            dedupeKey: `customer-invoices:${parsed.customerName}`,
          });
          return;
        }
        if (toolName === "get_refunds" && isRefundLookupResult(parsed)) {
          items.push({
            kind: "refunds",
            key: `tool-${index}`,
            data: parsed,
            turn,
            dedupeKey: `refunds:${parsed.startDate}_${parsed.endDate}`,
          });
          return;
        }
        if (toolName === "get_outstanding_invoices" && isOutstandingInvoicesResult(parsed)) {
          items.push({
            kind: "outstanding-invoices",
            key: `tool-${index}`,
            data: parsed,
            turn,
            dedupeKey: `outstanding-invoices:${parsed.status}`,
          });
          return;
        }
        if ((toolName === "create_invoice_draft" || toolName === "update_invoice_draft") && isInvoiceDraft(parsed)) {
          items.push({
            kind: "invoice-draft",
            key: `tool-${index}`,
            data: parsed,
            turn,
            dedupeKey: `invoice-draft:${parsed.draftInvoiceId}`,
          });
          return;
        }
      }
      return;
    }

    if (isDisplayableMessage(message)) {
      items.push({ kind: "message", key: `msg-${index}`, message, turn });
    }
  });

  // Within a single reply, a read-only tool can end up called more than once for the same
  // underlying question — e.g. the model retrying a customer's invoice lookup with a different
  // status filter because the owner asked for a date range the tool can't actually filter by.
  // Stripe data can't meaningfully change within one reply, so only the *last* tile for a given
  // (turn, tool, identity) reflects what the model's own final narration is describing — keep
  // that one and drop the earlier one rather than showing the owner the same card twice. This
  // only collapses duplicates within the same turn; the same customer's invoices shown again in
  // a later turn (a legitimate repeat question) still gets its own tile.
  const lastIndexByKey = new Map<string, number>();
  items.forEach((item, i) => {
    if (item.dedupeKey) lastIndexByKey.set(`${item.turn}:${item.dedupeKey}`, i);
  });

  return items
    .filter((item, i) => !item.dedupeKey || lastIndexByKey.get(`${item.turn}:${item.dedupeKey}`) === i)
    .map(({ turn: _turn, dedupeKey: _dedupeKey, ...rest }) => rest);
}

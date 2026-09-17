import type { ChatMessage } from "../api.js";
import { buildRenderItems } from "../toolResults.js";
import { MessageBubble } from "./MessageBubble.js";
import { DailySummaryTile } from "./DailySummaryTile.js";
import { RevenueComparisonTile } from "./RevenueComparisonTile.js";
import { CustomerInvoicesTile } from "./CustomerInvoicesTile.js";
import { RefundsTile } from "./RefundsTile.js";
import { OutstandingInvoicesTile } from "./OutstandingInvoicesTile.js";
import { InvoiceReviewCard } from "./InvoiceReviewCard.js";
import { DisputeResponseCard } from "./DisputeResponseCard.js";
import { PaymentReminderCard } from "./PaymentReminderCard.js";
import { TypingIndicator } from "./TypingIndicator.js";

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
  onSendText: (text: string) => void;
  onRequestEdit: (hint: string) => void;
}

export function MessageList({ messages, loading, onSendText, onRequestEdit }: MessageListProps) {
  const items = buildRenderItems(messages);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-2">
      {items.map((item) => {
        switch (item.kind) {
          case "message":
            return <MessageBubble key={item.key} message={item.message} />;
          case "daily-summary":
            return <DailySummaryTile key={item.key} data={item.data} />;
          case "revenue-comparison":
            return <RevenueComparisonTile key={item.key} data={item.data} />;
          case "customer-invoices":
            return <CustomerInvoicesTile key={item.key} data={item.data} />;
          case "refunds":
            return <RefundsTile key={item.key} data={item.data} />;
          case "outstanding-invoices":
            return <OutstandingInvoicesTile key={item.key} data={item.data} />;
          case "invoice-draft":
            return (
              <InvoiceReviewCard
                key={item.key}
                data={item.data}
                onSendText={onSendText}
                onEditRequest={() => onRequestEdit('Describe what to change, e.g. "make it due in 15 days"…')}
              />
            );
          case "dispute-response":
            return (
              <DisputeResponseCard
                key={item.key}
                data={item.data}
                onSendText={onSendText}
                onEditRequest={() =>
                  onRequestEdit('Describe the evidence you have, e.g. "we shipped it via UPS, tracking 1Z999, delivered Sept 13"…')
                }
              />
            );
          case "payment-reminders":
            return <PaymentReminderCard key={item.key} data={item.data} />;
        }
      })}
      {loading && <TypingIndicator />}
    </div>
  );
}

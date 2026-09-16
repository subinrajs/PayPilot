import type { ChatMessage } from "../api.js";
import { buildRenderItems } from "../toolResults.js";
import { MessageBubble } from "./MessageBubble.js";
import { DailySummaryTile } from "./DailySummaryTile.js";
import { RevenueComparisonTile } from "./RevenueComparisonTile.js";
import { CustomerInvoicesTile } from "./CustomerInvoicesTile.js";
import { RefundsTile } from "./RefundsTile.js";
import { OutstandingInvoicesTile } from "./OutstandingInvoicesTile.js";
import { TypingIndicator } from "./TypingIndicator.js";

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
}

export function MessageList({ messages, loading }: MessageListProps) {
  const items = buildRenderItems(messages);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-1 py-2">
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
        }
      })}
      {loading && <TypingIndicator />}
    </div>
  );
}

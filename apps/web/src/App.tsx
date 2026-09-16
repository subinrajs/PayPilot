import { useState } from "react";
import { type ChatMessage, type PendingAction, confirmPendingAction, sendMessage } from "./api.js";
import { PendingActionPanel } from "./components/PendingActionPanel.js";
import { Sidebar } from "./components/Sidebar.js";
import { TodaysSummaryPanel } from "./components/TodaysSummaryPanel.js";
import { PaymentActivityPanel } from "./components/PaymentActivityPanel.js";
import { NeedsAttentionPanel } from "./components/NeedsAttentionPanel.js";
import { RecentActivityPanel } from "./components/RecentActivityPanel.js";
import { UserProfile } from "./components/UserProfile.js";
import { MessageList } from "./components/MessageList.js";
import { ChatInput } from "./components/ChatInput.js";
import { SuggestedPrompts } from "./components/SuggestedPrompts.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { formatCents } from "./format.js";

export function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | undefined>(undefined);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendText(text: string) {
    if (!text || loading || pendingAction) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await sendMessage(nextMessages);
      setMessages(res.messages);
      setPendingAction(res.pendingAction);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInput(text);
      setMessages(messages);
    } finally {
      setLoading(false);
    }
  }

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    await sendText(input.trim());
  }

  async function handleConfirm() {
    if (!pendingAction) return;
    const action = pendingAction;
    try {
      const result = await confirmPendingAction(action.id, "confirm");
      const outcome =
        result.status === "executed"
          ? action.tool === "refund"
            ? `✅ Refund of ${formatCents(action.arguments.amountCents)} issued to ${action.arguments.customerName}.`
            : `✅ Invoice for ${formatCents(action.arguments.amountCents)} created for ${action.arguments.customerName}.`
          : "Cancelled.";
      setMessages((prev) => [...prev, { role: "assistant", content: outcome }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(undefined);
    }
  }

  async function handleCancel() {
    if (!pendingAction) return;
    try {
      await confirmPendingAction(pendingAction.id, "cancel");
      setMessages((prev) => [...prev, { role: "assistant", content: "Cancelled." }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(undefined);
    }
  }

  return (
    <div className="flex min-h-screen justify-center p-4 sm:p-8">
      <div className="flex w-full max-w-7xl flex-col overflow-hidden rounded-3xl bg-white/[0.04] shadow-2xl ring-1 ring-white/10 lg:flex-row">
        <div className="flex w-full flex-shrink-0 flex-col gap-3 overflow-y-auto border-b border-white/10 p-4 lg:w-80 lg:border-b-0 lg:border-r">
          <Sidebar />
          <TodaysSummaryPanel />
          <PaymentActivityPanel />
          <UserProfile />
        </div>

        <main className="flex min-h-[70vh] min-w-0 flex-1 flex-col p-5 sm:p-6">
          <MessageList messages={messages} loading={loading} />

          <div className="mt-3 flex flex-col gap-3">
            {pendingAction && (
              <PendingActionPanel action={pendingAction} onConfirm={handleConfirm} onCancel={handleCancel} />
            )}

            {error && <ErrorBanner message={error} />}

            {messages.length === 0 && !pendingAction && (
              <SuggestedPrompts onSelect={sendText} disabled={loading} />
            )}

            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={handleSend}
              disabled={loading || Boolean(pendingAction)}
              placeholder={
                pendingAction
                  ? "Confirm or cancel the pending action above before sending another message…"
                  : "Ask about your day, refund a payment, create an invoice…"
              }
            />
          </div>
        </main>

        <div className="flex w-full flex-shrink-0 flex-col gap-3 overflow-y-auto border-t border-white/10 p-4 lg:w-72 lg:border-t-0 lg:border-l">
          <NeedsAttentionPanel />
          <RecentActivityPanel />
        </div>
      </div>
    </div>
  );
}

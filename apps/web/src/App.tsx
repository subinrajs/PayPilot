import { useState } from "react";
import { type ChatMessage, type PendingAction, confirmPendingAction, sendMessage } from "./api.js";
import { PendingActionPanel } from "./components/PendingActionPanel.js";
import { formatCents } from "./format.js";
import "./App.css";

function isDisplayable(message: ChatMessage): boolean {
  if (message.role === "user") return true;
  if (message.role === "assistant") return typeof message.content === "string" && message.content.length > 0;
  return false;
}

export function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | undefined>(undefined);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
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
      // Put the message back in the compose box rather than losing it silently — the failed
      // send is also still in `messages` as a sent bubble, but the user gets to retry as typed.
      setInput(text);
      setMessages(messages);
    } finally {
      setLoading(false);
    }
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
    <main className="chat">
      <h1>PayPilot</h1>

      <div className="chat__history">
        {messages.filter(isDisplayable).map((message, index) => (
          <div key={index} className={`bubble bubble--${message.role}`}>
            {message.content}
          </div>
        ))}
        {loading && (
          <div className="bubble bubble--assistant bubble--loading" aria-live="polite">
            Thinking…
          </div>
        )}
      </div>

      {pendingAction && (
        <PendingActionPanel action={pendingAction} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <form className="chat__input" onSubmit={handleSend}>
        <input
          type="text"
          aria-label="Message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            pendingAction
              ? "Confirm or cancel the pending action above before sending another message…"
              : "Ask about your day, refund a payment, create an invoice…"
          }
          disabled={loading || Boolean(pendingAction)}
        />
        <button type="submit" disabled={loading || Boolean(pendingAction) || !input.trim()}>
          Send
        </button>
      </form>
    </main>
  );
}

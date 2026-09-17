import { useState } from "react";
import {
  type ChatMessage,
  type DisputeActionPendingArgs,
  type PendingAction,
  type SendInvoicePendingArgs,
  type SentInvoice,
  confirmPendingAction,
  sendMessage,
} from "./api.js";
import { PendingActionPanel } from "./components/PendingActionPanel.js";
import { Sidebar } from "./components/Sidebar.js";
import { TodaysSummaryPanel } from "./components/TodaysSummaryPanel.js";
import { PaymentActivityPanel } from "./components/PaymentActivityPanel.js";
import { NeedsAttentionPanel } from "./components/NeedsAttentionPanel.js";
import { RecentActivityPanel } from "./components/RecentActivityPanel.js";
import { UserProfile } from "./components/UserProfile.js";
import { LoginScreen } from "./components/LoginScreen.js";
import { MessageList } from "./components/MessageList.js";
import { ChatInput } from "./components/ChatInput.js";
import { SuggestedPrompts } from "./components/SuggestedPrompts.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { formatCents } from "./format.js";

function describeSentInvoice(args: SendInvoicePendingArgs, sent: SentInvoice): string {
  const number = sent.number ? ` ${sent.number}` : "";
  return (
    `✅ Invoice${number} for ${formatCents(args.totalCents)} sent to ${args.customerName}, due ${args.dueDate}. ` +
    "You'll see it in Needs Attention if it becomes overdue."
  );
}

function describeSubmittedDispute(args: DisputeActionPendingArgs): string {
  return (
    `✅ Evidence submitted for the ${formatCents(args.amountCents)} dispute from ${args.customerName ?? "the customer"} ` +
    `(${args.reason.replace(/_/g, " ")}). Stripe will notify you once the card issuer decides — PayPilot can't ` +
    "guarantee the outcome."
  );
}

function describeDeclinedDispute(args: DisputeActionPendingArgs): string {
  return (
    `Declined to contest the ${formatCents(args.amountCents)} dispute from ${args.customerName ?? "the customer"}. ` +
    "This is final and can't be undone."
  );
}

const LOGIN_STORAGE_KEY = "paypilot_username";

// localStorage can throw (private browsing, blocked site data) — never let that break login/logout.
function readStoredUsername(): string | null {
  try {
    return localStorage.getItem(LOGIN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function App() {
  // No real authentication (see UserProfile.tsx/LoginScreen.tsx) — any non-empty username/
  // password is accepted. Persisted to localStorage purely so a page refresh doesn't force
  // re-login; this is a UI convenience, not a security boundary.
  const [username, setUsername] = useState<string | null>(readStoredUsername);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | undefined>(undefined);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editHint, setEditHint] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);

  function handleLogin(name: string) {
    setUsername(name);
    try {
      localStorage.setItem(LOGIN_STORAGE_KEY, name);
    } catch {
      // Fine to no-op — the session still works for this page load, just won't survive a refresh.
    }
  }

  function handleLogout() {
    setUsername(null);
    try {
      localStorage.removeItem(LOGIN_STORAGE_KEY);
    } catch {
      // Ignored — see handleLogin.
    }
    // A fresh login starts a fresh session rather than carrying over the previous one's chat.
    setMessages([]);
    setPendingAction(undefined);
    setInput("");
    setError(null);
    setEditHint(null);
  }

  async function sendText(text: string) {
    if (!text || loading || pendingAction) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setEditHint(null);
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

  function handleInputChange(value: string) {
    setInput(value);
    setEditHint(null);
  }

  // Shared by InvoiceReviewCard's Edit/Prepare button and DisputeResponseCard's — each passes its
  // own contextual placeholder text; the underlying focus + hint mechanism is identical.
  function handleRequestEdit(hint: string) {
    setEditHint(hint);
    setFocusSignal((s) => s + 1);
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
      if (result.status !== "executed") {
        setMessages((prev) => [...prev, { role: "assistant", content: "Cancelled." }]);
        return;
      }

      if (action.tool === "refund") {
        const outcome = `✅ Refund of ${formatCents(action.arguments.amountCents)} issued to ${action.arguments.customerName}.`;
        setMessages((prev) => [...prev, { role: "assistant", content: outcome }]);
      } else if (action.tool === "send_invoice") {
        const sent = result.result as SentInvoice;
        const outcome = describeSentInvoice(action.arguments, sent);
        setMessages((prev) => [...prev, { role: "assistant", content: outcome, invoiceUrl: sent.hosted_invoice_url ?? undefined }]);
      } else if (action.tool === "submit_dispute_evidence") {
        const outcome = describeSubmittedDispute(action.arguments);
        setMessages((prev) => [...prev, { role: "assistant", content: outcome }]);
      } else {
        const outcome = describeDeclinedDispute(action.arguments);
        setMessages((prev) => [...prev, { role: "assistant", content: outcome }]);
      }
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

  if (!username) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="flex min-h-screen justify-center p-4 sm:p-8 lg:h-screen">
      <div className="flex w-full max-w-7xl flex-col overflow-hidden rounded-3xl bg-white/[0.04] shadow-2xl ring-1 ring-white/10 lg:h-full lg:flex-row">
        <div className="flex w-full flex-shrink-0 flex-col gap-3 overflow-y-auto border-b border-white/10 p-4 lg:h-full lg:w-80 lg:border-b-0 lg:border-r">
          <Sidebar />
          <TodaysSummaryPanel />
          <PaymentActivityPanel />
          <UserProfile username={username} onLogout={handleLogout} />
        </div>

        <main className="flex min-h-[70vh] min-w-0 flex-1 flex-col p-5 sm:p-6 lg:h-full lg:min-h-0">
          <MessageList messages={messages} loading={loading} onSendText={sendText} onRequestEdit={handleRequestEdit} />

          <div className="mt-3 flex flex-shrink-0 flex-col gap-3">
            {pendingAction && (
              <PendingActionPanel action={pendingAction} onConfirm={handleConfirm} onCancel={handleCancel} />
            )}

            {error && <ErrorBanner message={error} />}

            {messages.length === 0 && !pendingAction && (
              <SuggestedPrompts onSelect={sendText} disabled={loading} />
            )}

            <ChatInput
              value={input}
              onChange={handleInputChange}
              onSubmit={handleSend}
              disabled={loading || Boolean(pendingAction)}
              focusSignal={focusSignal}
              placeholder={
                pendingAction
                  ? "Confirm or cancel the pending action above before sending another message…"
                  : (editHint ?? "Ask about your day, refund a payment, create an invoice…")
              }
            />
          </div>
        </main>

        <div className="flex w-full flex-shrink-0 flex-col gap-3 overflow-y-auto border-t border-white/10 p-4 lg:h-full lg:w-72 lg:border-t-0 lg:border-l">
          <NeedsAttentionPanel onSendText={sendText} />
          <RecentActivityPanel />
        </div>
      </div>
    </div>
  );
}

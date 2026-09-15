// Wire types mirroring apps/api/src/routes/assistant.ts's request/response shapes exactly. The
// message array is otherwise opaque to the UI — it's stored and resent verbatim (including
// tool/tool_call entries), never trimmed, since the backend's loop needs the full transcript.
// "system" is deliberately excluded — the backend's AssistantRequestSchema rejects it too, so a
// client can't inject a fake system-level message; the real system prompt is always injected
// fresh server-side.
export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content?: string | null;
  [key: string]: unknown;
}

export interface RefundPendingArgs {
  chargeId: string;
  customerId: string;
  customerName: string;
  amountCents: number;
}

export interface InvoiceCreationPendingArgs {
  customerId: string;
  customerName: string;
  amountCents: number;
  dueDate: string;
  description: string;
}

export type PendingAction =
  | { id: string; tool: "refund"; arguments: RefundPendingArgs; expiresAt: number }
  | { id: string; tool: "create_invoice"; arguments: InvoiceCreationPendingArgs; expiresAt: number };

export interface AssistantResponse {
  // Convenience copy of the final assistant message's content — `messages` already contains it
  // (as the last displayable entry) and is what the UI actually renders from.
  reply: string;
  messages: ChatMessage[];
  pendingAction?: PendingAction;
}

export type ConfirmResult = { status: "cancelled" } | { status: "executed"; result: unknown };

export async function sendMessage(messages: ChatMessage[]): Promise<AssistantResponse> {
  return postJson("/api/assistant", { messages });
}

export async function confirmPendingAction(
  pendingActionId: string,
  action: "confirm" | "cancel",
): Promise<ConfirmResult> {
  return postJson("/api/assistant/confirm", { pendingActionId, action });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const parsed = await safeJson(res);
    throw new Error(parsed?.error ?? `Request to ${url} failed (${res.status})`);
  }

  return res.json();
}

async function safeJson(res: Response): Promise<{ error?: string } | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

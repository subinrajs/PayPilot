import type { ChatMessage } from "../api.js";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  // A raw URL embedded in plain narrated text sits right next to trailing prose with nothing to
  // delimit it, making it easy to mis-select when copying — a real link avoids that entirely.
  const invoiceUrl = typeof message.invoiceUrl === "string" ? message.invoiceUrl : undefined;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-3xl px-4 py-2.5 text-[0.95rem] leading-relaxed text-white shadow-sm ${
          isUser ? "bg-bubble-user" : "bg-bubble-assistant"
        }`}
      >
        {message.content}
        {invoiceUrl && (
          <a
            href={invoiceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 block text-sm font-medium text-blue-300 hover:underline"
          >
            View invoice ↗
          </a>
        )}
      </div>
    </div>
  );
}

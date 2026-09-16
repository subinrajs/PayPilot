import type { ChatMessage } from "../api.js";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-3xl px-4 py-2.5 text-[0.95rem] leading-relaxed text-white shadow-sm ${
          isUser ? "bg-bubble-user" : "bg-bubble-assistant"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

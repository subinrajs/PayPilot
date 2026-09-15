import type { ChatMessage } from "../api.js";
import { MessageBubble } from "./MessageBubble.js";
import { TypingIndicator } from "./TypingIndicator.js";

function isDisplayable(message: ChatMessage): boolean {
  if (message.role === "user") return true;
  if (message.role === "assistant") return typeof message.content === "string" && message.content.length > 0;
  return false;
}

interface MessageListProps {
  messages: ChatMessage[];
  loading: boolean;
}

export function MessageList({ messages, loading }: MessageListProps) {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-1 py-2">
      {messages.filter(isDisplayable).map((message, index) => (
        <MessageBubble key={index} message={message} />
      ))}
      {loading && <TypingIndicator />}
    </div>
  );
}

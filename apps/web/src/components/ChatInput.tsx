import { useEffect, useRef } from "react";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  disabled: boolean;
  placeholder: string;
}

export function ChatInput({ value, onChange, onSubmit, disabled, placeholder }: ChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // A disabled input can't hold focus, so it's dropped entirely while a send/confirm is in
  // flight — re-enabling it doesn't bring focus back on its own, forcing an extra click before
  // every follow-up message. Restore it the moment the input becomes usable again.
  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2 pt-3">
      <input
        ref={inputRef}
        type="text"
        aria-label="Message"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm text-white placeholder:text-slate-400 focus:border-white/25 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        aria-label="Send message"
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-bubble-user text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path
            fillRule="evenodd"
            d="M4.72 3.22a.75.75 0 011.06 0l7.25 7.25a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06-1.06L11.44 11 4.72 4.28a.75.75 0 010-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </form>
  );
}

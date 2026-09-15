export function TypingIndicator() {
  return (
    <div className="flex justify-start" aria-live="polite" aria-label="Assistant is thinking">
      <div className="flex items-center gap-1.5 rounded-3xl bg-bubble-assistant px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/70"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

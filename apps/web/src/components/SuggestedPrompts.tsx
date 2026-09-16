const PROMPTS = [
  "Summarize my day",
  "Refund Maya's last payment",
  "Create a $250 invoice for Acme Corp due next Friday",
];

interface SuggestedPromptsProps {
  onSelect: (prompt: string) => void;
  disabled: boolean;
}

export function SuggestedPrompts({ onSelect, disabled }: SuggestedPromptsProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PROMPTS.map((prompt) => (
        <button
          key={prompt}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(prompt)}
          className="rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          "{prompt}"
        </button>
      ))}
    </div>
  );
}

interface UserProfileProps {
  username: string;
  onLogout: () => void;
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

// "Owner" stays static — this app models exactly one owner role, no real auth/roles system
// (single owner, test-mode Stripe account). The username itself now comes from the login gate
// (App.tsx/LoginScreen.tsx) rather than being hardcoded.
export function UserProfile({ username, onLogout }: UserProfileProps) {
  return (
    <div className="mt-auto flex items-center gap-3 border-t border-white/10 pt-4">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
        {initials(username)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{username}</p>
        <p className="text-xs text-slate-400">Owner</p>
      </div>
      <button
        type="button"
        onClick={onLogout}
        aria-label="Log out"
        title="Log out"
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
        </svg>
      </button>
    </div>
  );
}

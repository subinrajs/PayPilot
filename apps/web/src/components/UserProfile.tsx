// Placeholder identity display — this app has no auth system (single owner, test-mode Stripe
// account), so "Admin" / "Owner" are static for now rather than driven by a real session.
export function UserProfile() {
  return (
    <div className="mt-auto flex items-center gap-3 border-t border-white/10 pt-4">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
        AD
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">Admin</p>
        <p className="text-xs text-slate-400">Owner</p>
      </div>
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-slate-400">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
        </svg>
      </span>
    </div>
  );
}

import { useState } from "react";

interface LoginScreenProps {
  onLogin: (username: string) => void;
}

// No real authentication exists in this app (single owner, test-mode Stripe account, matching
// UserProfile.tsx's own "no auth system" framing) — this is a UI gate only. Any non-empty
// username/password is accepted; the password is never stored, sent anywhere, or even passed out
// of this component, since nothing downstream needs it.
export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = username.trim();
    if (!trimmed || !password.trim()) return;
    onLogin(trimmed);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white/[0.04] p-8 shadow-2xl ring-1 ring-white/10">
        <div className="flex flex-col items-center gap-3 pb-6 text-center">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-bubble-user to-violet-600 text-white shadow-lg shadow-black/30">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3.25c-4.83 0-8.75 3.47-8.75 7.75 0 2.02.87 3.86 2.3 5.24-.12 1.13-.58 2.15-1.28 2.92a.45.45 0 00.42.75c1.5-.3 2.76-.9 3.71-1.57A10.3 10.3 0 0012 19c4.83 0 8.75-3.47 8.75-7.75S16.83 3.25 12 3.25z"
              />
              <text x="12" y="14.7" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor" stroke="none">
                $
              </text>
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight tracking-tight text-white">PayPilot</h1>
            <p className="text-xs text-slate-400">AI Payment Assistant</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="login-username" className="mb-1.5 block text-xs font-medium text-slate-400">
              Username
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter any username"
              className="w-full rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm text-white placeholder:text-slate-400 focus:border-white/25 focus:outline-none focus:ring-2 focus:ring-white/10"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-xs font-medium text-slate-400">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter any password"
              className="w-full rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm text-white placeholder:text-slate-400 focus:border-white/25 focus:outline-none focus:ring-2 focus:ring-white/10"
            />
          </div>

          <button
            type="submit"
            disabled={!username.trim() || !password.trim()}
            className="mt-2 w-full rounded-full bg-accent-confirm px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Log in
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-slate-500">Demo only — any username and password is accepted.</p>
      </div>
    </div>
  );
}

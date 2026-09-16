export function Sidebar() {
  return (
    <div className="flex items-center gap-3 pb-5">
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-bubble-user to-violet-600 text-white shadow-lg shadow-black/30">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6">
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
  );
}

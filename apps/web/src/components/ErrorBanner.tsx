interface ErrorBannerProps {
  message: string;
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-2xl bg-danger/15 px-4 py-3 text-sm text-red-200 ring-1 ring-danger/25"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 flex-shrink-0">
        <path
          fillRule="evenodd"
          d="M18 10A8 8 0 11 2 10a8 8 0 0116 0Zm-7-4a1 1 0 10-2 0v4a1 1 0 002 0V6Zm-1 8a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5Z"
          clipRule="evenodd"
        />
      </svg>
      <span>{message}</span>
    </div>
  );
}

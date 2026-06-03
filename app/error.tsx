'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // TODO(observability): forward to Sentry/structured logging in Tier 1.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-2xl font-semibold text-purple-100">Something went wrong</h2>
      <p className="max-w-md text-sm text-purple-100/60">
        We couldn&apos;t load this data. The market data provider may be rate-limiting or
        temporarily unavailable. Please try again in a moment.
      </p>
      {error.digest ? (
        <p className="text-xs text-purple-100/30">Reference: {error.digest}</p>
      ) : null}
      <button
        onClick={reset}
        className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
      >
        Try again
      </button>
    </main>
  );
}

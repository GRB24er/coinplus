'use client';

import { useEffect } from 'react';

// global-error replaces the root layout when an error is thrown there, so it has
// to render its own <html>/<body>.
export default function GlobalError({
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
    <html lang="en" className="dark">
      <body className="antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <h2 className="text-2xl font-semibold text-purple-100">Something went wrong</h2>
          <p className="max-w-md text-sm text-purple-100/60">
            The application hit an unexpected error. Please try again.
          </p>
          <button
            onClick={reset}
            className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

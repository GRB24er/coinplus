'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function CoinError({
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
      <h2 className="text-2xl font-semibold text-purple-100">Couldn&apos;t load this coin</h2>
      <p className="max-w-md text-sm text-purple-100/60">
        This token may not exist, or the market data provider is temporarily unavailable.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/coins"
          className="rounded-md border border-purple-100/20 px-4 py-2 text-sm font-medium text-purple-100 transition hover:bg-purple-100/5"
        >
          All coins
        </Link>
      </div>
    </main>
  );
}

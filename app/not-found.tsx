import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-2xl font-semibold text-purple-100">404 — Page not found</h2>
      <p className="max-w-md text-sm text-purple-100/60">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link
        href="/"
        className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
      >
        Back to dashboard
      </Link>
    </main>
  );
}

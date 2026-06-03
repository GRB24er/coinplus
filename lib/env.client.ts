import { z } from 'zod';

/**
 * Client-safe environment variables (the `NEXT_PUBLIC_*` prefix means Next.js
 * inlines them into the browser bundle, so these must never hold secrets).
 *
 * Each value is referenced statically below so the Next.js compiler can replace
 * it at build time — accessing `process.env` dynamically would not get inlined.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_COINGECKO_WEBSOCKET_URL: z
    .string()
    .url('NEXT_PUBLIC_COINGECKO_WEBSOCKET_URL must be a valid URL'),
  NEXT_PUBLIC_COINGECKO_API_KEY: z.string().min(1, 'NEXT_PUBLIC_COINGECKO_API_KEY is required'),
});

const parsed = clientEnvSchema.safeParse({
  NEXT_PUBLIC_COINGECKO_WEBSOCKET_URL: process.env.NEXT_PUBLIC_COINGECKO_WEBSOCKET_URL,
  NEXT_PUBLIC_COINGECKO_API_KEY: process.env.NEXT_PUBLIC_COINGECKO_API_KEY,
});

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  throw new Error(`Invalid client environment variables:\n${issues}`);
}

export const clientEnv = parsed.data;

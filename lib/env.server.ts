import 'server-only';
import { z } from 'zod';

/**
 * Server-only environment variables.
 *
 * These hold secrets (the CoinGecko Pro API key) and MUST NOT reach the browser.
 * The `server-only` import makes the build fail loudly if this module is ever
 * imported from a Client Component instead of failing silently at runtime.
 */
const serverEnvSchema = z.object({
  COINGECKO_BASE_URL: z.string().url('COINGECKO_BASE_URL must be a valid URL'),
  COINGECKO_API_KEY: z.string().min(1, 'COINGECKO_API_KEY is required'),
});

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  throw new Error(`Invalid server environment variables:\n${issues}`);
}

export const serverEnv = parsed.data;

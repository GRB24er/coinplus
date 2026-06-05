import { z } from 'zod';

/**
 * Realtime-hub configuration. Note these are plain (server-side) variables — the
 * CoinGecko key lives here, never in a browser bundle. That key exposure is the
 * whole reason this service exists (see ADR 0001).
 */
const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  COINGECKO_WEBSOCKET_URL: z.string().url('COINGECKO_WEBSOCKET_URL must be a valid URL'),
  COINGECKO_API_KEY: z.string().min(1, 'COINGECKO_API_KEY is required'),
  /** Drop a browser socket if it misses two of these ping cycles. */
  CLIENT_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid realtime-hub configuration:\n${issues}`);
  }

  return parsed.data;
}

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // Deterministic values so env validation passes without a real .env file.
    env: {
      COINGECKO_BASE_URL: 'https://pro-api.coingecko.test/api/v3',
      COINGECKO_API_KEY: 'test-key',
      NEXT_PUBLIC_COINGECKO_WEBSOCKET_URL: 'wss://stream.coingecko.test',
      NEXT_PUBLIC_COINGECKO_API_KEY: 'test-public-key',
    },
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws when imported outside a React Server Components
      // build; the test runner has no such boundary, so swap it for a no-op.
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
});

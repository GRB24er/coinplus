'use client';

import { useCoinGeckoWebSocket } from './useCoinGeckoWebSocket';
import { useMarketDataStream } from './useMarketDataStream';

// Build-time feature flag (ADR 0001, Step 3): when the realtime hub URL is set,
// route live data through our hub; otherwise keep the legacy direct CoinGecko
// connection. Both hooks share the same signature, so this is a safe swap. The
// selection happens once at module load, never conditionally per render.
export const useLiveMarketData = process.env.NEXT_PUBLIC_REALTIME_HUB_URL
  ? useMarketDataStream
  : useCoinGeckoWebSocket;

import 'server-only';
import { getCache } from './cache';
import { CachedMarketDataProvider } from './cached-provider';
import { CoinGeckoProvider } from './coingecko';
import type { MarketDataProvider } from './provider';

declare global {
  // Reuse a single composed provider across module reloads in dev.
  var __marketDataProvider: MarketDataProvider | undefined;
}

/**
 * The composed market-data provider the rest of the app should use: CoinGecko
 * wrapped in the caching/coalescing layer. Swapping the upstream source or the
 * cache backend happens only here.
 */
export function getMarketDataProvider(): MarketDataProvider {
  if (!globalThis.__marketDataProvider) {
    globalThis.__marketDataProvider = new CachedMarketDataProvider(
      new CoinGeckoProvider(),
      getCache(),
    );
  }
  return globalThis.__marketDataProvider;
}

export type { MarketDataProvider, MarketDataRequestOptions } from './provider';
export type { CacheStore } from './cache';

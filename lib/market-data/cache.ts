import 'server-only';

/**
 * Cache abstraction for the market-data layer.
 *
 * The interface is intentionally async so a Redis-backed implementation can be
 * dropped in later (see the Tier 2 ADR) without touching any caller. Today the
 * only implementation is process-local and in-memory.
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class InMemoryCacheStore implements CacheStore {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

declare global {
  // Reuse a single cache instance across module reloads in dev.
  var __marketDataCache: CacheStore | undefined;
}

export function getCache(): CacheStore {
  // TODO(tier-2): select a RedisCacheStore here when REDIS_URL is configured.
  // Callers depend only on the CacheStore interface, so that swap is localized.
  if (!globalThis.__marketDataCache) {
    globalThis.__marketDataCache = new InMemoryCacheStore();
  }
  return globalThis.__marketDataCache;
}

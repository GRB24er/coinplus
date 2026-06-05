import 'server-only';
import qs from 'query-string';
import type { CacheStore } from './cache';
import type { MarketDataProvider, MarketDataRequestOptions } from './provider';

const DEFAULT_TTL_SECONDS = 60;

/**
 * Wraps another provider with a read-through cache plus in-flight request
 * coalescing, so N concurrent identical misses collapse into a single upstream
 * call (cache-stampede protection). This is where one upstream request ends up
 * serving every user.
 */
export class CachedMarketDataProvider implements MarketDataProvider {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly inner: MarketDataProvider,
    private readonly cache: CacheStore,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  private cacheKey(endpoint: string, options: MarketDataRequestOptions): string {
    // query-string sorts keys, so the key is stable regardless of param order.
    const suffix = qs.stringifyUrl(
      { url: endpoint, query: options.params },
      { skipEmptyString: true, skipNull: true },
    );
    return `${this.inner.name}:${suffix}`;
  }

  async request<T>(endpoint: string, options: MarketDataRequestOptions = {}): Promise<T> {
    const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

    if (ttl <= 0) {
      return this.inner.request<T>(endpoint, options);
    }

    const key = this.cacheKey(endpoint, options);

    const cached = await this.cache.get<T>(key);
    if (cached !== undefined) return cached;

    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = this.inner
      .request<T>(endpoint, options)
      .then(async (value) => {
        await this.cache.set(key, value, ttl);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }
}

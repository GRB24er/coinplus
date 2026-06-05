import 'server-only';

export interface MarketDataRequestOptions {
  params?: QueryParams;
  /** Cache TTL in seconds. 0 (or less) bypasses the cache for this request. */
  ttlSeconds?: number;
}

/**
 * The seam between the app and any upstream market-data source. CoinGecko is the
 * only implementation today; a second provider (for failover or extra coverage)
 * would implement this same interface, and nothing else in the app would change.
 */
export interface MarketDataProvider {
  readonly name: string;
  request<T>(endpoint: string, options?: MarketDataRequestOptions): Promise<T>;
}

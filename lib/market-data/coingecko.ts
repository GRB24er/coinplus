import 'server-only';
import qs from 'query-string';
import { serverEnv } from '@/lib/env.server';
import type { MarketDataProvider, MarketDataRequestOptions } from './provider';

const MAX_RETRIES = 3;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Talks to the CoinGecko Pro REST API. Owns request building and the transient-
 * failure retry policy; caching is layered on separately by CachedMarketDataProvider.
 *
 * `cache: 'no-store'` opts out of Next's per-fetch cache so this layer's own cache
 * is the single source of truth (and so production builds don't call CoinGecko while
 * prerendering).
 */
export class CoinGeckoProvider implements MarketDataProvider {
  readonly name = 'coingecko';

  private buildUrl(endpoint: string, params?: QueryParams): string {
    return qs.stringifyUrl(
      {
        url: `${serverEnv.COINGECKO_BASE_URL}/${endpoint}`,
        query: params,
      },
      { skipEmptyString: true, skipNull: true },
    );
  }

  async request<T>(endpoint: string, options: MarketDataRequestOptions = {}): Promise<T> {
    const url = this.buildUrl(endpoint, options.params);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let response: Response;

      try {
        response = await fetch(url, {
          headers: {
            'x-cg-pro-api-key': serverEnv.COINGECKO_API_KEY,
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
        });
      } catch (error) {
        // Network-level failure (DNS, reset, timeout): retry with exponential backoff.
        if (attempt < MAX_RETRIES) {
          await delay(500 * 2 ** attempt);
          continue;
        }

        throw new Error(
          `Network error calling ${endpoint}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }

      if (response.ok) return response.json() as Promise<T>;

      // Retry transient failures (rate limiting + upstream 5xx); honor Retry-After.
      const isRetryable = response.status === 429 || response.status >= 500;

      if (isRetryable && attempt < MAX_RETRIES) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const backoff =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;

        await delay(backoff);
        continue;
      }

      const errorBody: CoinGeckoErrorBody = await response.json().catch(() => ({}));

      throw new Error(`API Error: ${response.status}: ${errorBody.error || response.statusText}`);
    }

    // Unreachable: the final attempt always either returns or throws above.
    throw new Error(`API Error: request to ${endpoint} failed after ${MAX_RETRIES + 1} attempts`);
  }
}

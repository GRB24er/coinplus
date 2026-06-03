'use server';

import qs from 'query-string';
import { serverEnv } from '@/lib/env.server';

const MAX_RETRIES = 3;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetcher<T>(
  endpoint: string,
  params?: QueryParams,
  revalidate = 60,
): Promise<T> {
  const url = qs.stringifyUrl(
    {
      url: `${serverEnv.COINGECKO_BASE_URL}/${endpoint}`,
      query: params,
    },
    { skipEmptyString: true, skipNull: true },
  );

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          'x-cg-pro-api-key': serverEnv.COINGECKO_API_KEY,
          'Content-Type': 'application/json',
        },
        next: { revalidate },
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

    // Retry transient failures (rate limiting + upstream 5xx); honor Retry-After when present.
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

export async function getPools(
  id: string,
  network?: string | null,
  contractAddress?: string | null,
): Promise<PoolData> {
  const fallback: PoolData = {
    id: '',
    address: '',
    name: '',
    network: '',
  };

  if (network && contractAddress) {
    try {
      const poolData = await fetcher<{ data: PoolData[] }>(
        `/onchain/networks/${network}/tokens/${contractAddress}/pools`,
      );

      return poolData.data?.[0] ?? fallback;
    } catch (error) {
      console.log(error);
      return fallback;
    }
  }

  try {
    const poolData = await fetcher<{ data: PoolData[] }>('/onchain/search/pools', { query: id });

    return poolData.data?.[0] ?? fallback;
  } catch {
    return fallback;
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetcher } from '@/lib/coingecko.actions';

const okResponse = (body: unknown) => ({
  ok: true,
  json: async () => body,
});

const errorResponse = (status: number, headers: HeadersInit = {}, body: unknown = {}) => ({
  ok: false,
  status,
  statusText: `status ${status}`,
  headers: new Headers(headers),
  json: async () => body,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// The retry/error tests pass a TTL of 0 so they exercise the HTTP layer without
// the cache short-circuiting a second call.
describe('fetcher (HTTP behaviour, cache bypassed)', () => {
  it('returns parsed JSON on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ hello: 'world' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetcher('/ping', undefined, 0)).resolves.toEqual({ hello: 'world' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('targets the configured base URL with the API key header and query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await fetcher('/coins/markets', { vs_currency: 'usd' }, 0);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('https://pro-api.coingecko.test/api/v3');
    expect(url).toContain('vs_currency=usd');
    expect((init.headers as Record<string, string>)['x-cg-pro-api-key']).toBe('test-key');
  });

  it('retries a 429 and resolves once the next attempt succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse({ value: 42 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetcher<{ value: number }>('/retry-429', undefined, 0);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('waits for the Retry-After interval instead of the default backoff', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(okResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetcher('/retry-after', undefined, 0);

    // Default backoff for the first retry is 500ms; Retry-After of 1s must win.
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(600);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('retries transient network errors before giving up', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(okResponse({ recovered: true }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetcher('/retry-network', undefined, 0);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries on a persistent 5xx', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(503, {}, { error: 'down' }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetcher('/persistent-5xx', undefined, 0);
    const assertion = expect(promise).rejects.toThrow(/503/);
    await vi.runAllTimersAsync();
    await assertion;

    // Initial attempt + 3 retries.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not retry non-retryable client errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(404, {}, { error: 'not found' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetcher('/client-404', undefined, 0)).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetcher (caching)', () => {
  it('serves a second identical request from cache within the TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ n: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetcher('/cache-hit', undefined, 60);
    const second = await fetcher('/cache-hit', undefined, 60);

    expect(first).toEqual({ n: 1 });
    expect(second).toEqual({ n: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent identical requests into a single upstream call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ n: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      fetcher('/coalesce', undefined, 60),
      fetcher('/coalesce', undefined, 60),
    ]);

    expect(a).toEqual({ n: 2 });
    expect(b).toEqual({ n: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

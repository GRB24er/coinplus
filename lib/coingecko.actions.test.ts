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

describe('fetcher', () => {
  it('returns parsed JSON on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ hello: 'world' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetcher('/ping')).resolves.toEqual({ hello: 'world' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('targets the configured base URL with the API key header and query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    await fetcher('/coins/markets', { vs_currency: 'usd' });

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

    const promise = fetcher<{ value: number }>('/coins/markets');
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

    const promise = fetcher('/x');

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

    const promise = fetcher('/x');
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries on a persistent 5xx', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(503, {}, { error: 'down' }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetcher('/coins/markets');
    const assertion = expect(promise).rejects.toThrow(/503/);
    await vi.runAllTimersAsync();
    await assertion;

    // Initial attempt + 3 retries.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not retry non-retryable client errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(404, {}, { error: 'not found' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetcher('/coins/nope')).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

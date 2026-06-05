import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMarketDataStream } from '@/hooks/useMarketDataStream';

// Minimal controllable WebSocket stand-in (jsdom has no WebSocket).
class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMarketDataStream', () => {
  it('subscribes on open and surfaces price + connection state', () => {
    const { result } = renderHook(() =>
      useMarketDataStream({ coinId: 'bitcoin', poolId: '', liveInterval: '1s' }),
    );

    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeDefined();

    act(() => ws.simulateOpen());

    expect(result.current.isConnected).toBe(true);
    expect(JSON.parse(ws.sent[0])).toMatchObject({
      type: 'subscribe',
      coinId: 'bitcoin',
      interval: '1s',
    });

    act(() =>
      ws.emit({ type: 'price', coinId: 'bitcoin', data: { price: 64000, changePercent24h: 1.5 } }),
    );

    expect(result.current.price?.usd).toBe(64000);
    expect(result.current.price?.change24h).toBe(1.5);
  });

  it('appends trades newest-first and maps side to b/s', () => {
    const { result } = renderHook(() =>
      useMarketDataStream({ coinId: 'bitcoin', poolId: '', liveInterval: '1s' }),
    );

    const ws = FakeWebSocket.instances[0];
    act(() => ws.simulateOpen());

    act(() => ws.emit({ type: 'trade', poolAddress: 'eth:0x', data: { price: 1, side: 'buy' } }));
    act(() => ws.emit({ type: 'trade', poolAddress: 'eth:0x', data: { price: 2, side: 'sell' } }));

    expect(result.current.trades.map((trade) => trade.type)).toEqual(['s', 'b']);
  });
});

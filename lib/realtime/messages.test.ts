import { describe, expect, it } from 'vitest';
import {
  applyServerMessage,
  initialStreamState,
  parseServerMessage,
  toPriceData,
  toTrade,
  type ServerMessage,
  type StreamState,
} from '@/lib/realtime/messages';

describe('parseServerMessage', () => {
  it('parses a known message type', () => {
    const msg = parseServerMessage('{"type":"pong"}');
    expect(msg).toEqual({ type: 'pong' });
  });

  it('rejects invalid JSON, non-objects, and unknown types', () => {
    expect(parseServerMessage('not json')).toBeNull();
    expect(parseServerMessage('123')).toBeNull();
    expect(parseServerMessage('{"type":"bogus"}')).toBeNull();
    expect(parseServerMessage('{"no":"type"}')).toBeNull();
  });
});

describe('mappers', () => {
  it('maps a hub price update onto ExtendedPriceData', () => {
    expect(toPriceData('bitcoin', { price: 64000, changePercent24h: 1.5, marketCap: 9 })).toEqual({
      usd: 64000,
      coin: 'bitcoin',
      price: 64000,
      change24h: 1.5,
      marketCap: 9,
      volume24h: undefined,
      timestamp: undefined,
    });
  });

  it('maps trade side to the b/s code the table expects', () => {
    expect(toTrade({ price: 1, side: 'buy' }).type).toBe('b');
    expect(toTrade({ price: 1, side: 'sell' }).type).toBe('s');
    expect(toTrade({ price: 1 }).type).toBe('s');
  });
});

describe('applyServerMessage', () => {
  it('sets price from a snapshot, but ignores an empty snapshot', () => {
    const withPrice = applyServerMessage(initialStreamState, {
      type: 'snapshot',
      coinId: 'btc',
      price: { price: 100 },
    });
    expect(withPrice.price?.usd).toBe(100);

    const empty = applyServerMessage(initialStreamState, {
      type: 'snapshot',
      coinId: 'btc',
      price: null,
    });
    expect(empty.price).toBeNull();
  });

  it('updates price on a price message', () => {
    const next = applyServerMessage(initialStreamState, {
      type: 'price',
      coinId: 'btc',
      data: { price: 250 },
    });
    expect(next.price?.usd).toBe(250);
  });

  it('prepends trades newest-first and caps the list at 7', () => {
    let state: StreamState = initialStreamState;
    for (let i = 1; i <= 9; i += 1) {
      state = applyServerMessage(state, {
        type: 'trade',
        poolAddress: 'eth:0x',
        data: { price: i, side: i % 2 === 0 ? 'buy' : 'sell' },
      });
    }
    expect(state.trades).toHaveLength(7);
    expect(state.trades[0].price).toBe(9);
    expect(state.trades.at(-1)?.price).toBe(3);
  });

  it('sets the live candle on an ohlcv message', () => {
    const candle: [number, number, number, number, number] = [1700, 1, 2, 0.5, 1.5];
    const next = applyServerMessage(initialStreamState, {
      type: 'ohlcv',
      poolAddress: 'eth:0x',
      interval: '1s',
      data: candle,
    });
    expect(next.ohlcv).toEqual(candle);
  });

  it('leaves state untouched for pong and error', () => {
    const pong: ServerMessage = { type: 'pong' };
    const error: ServerMessage = { type: 'error', message: 'nope' };
    expect(applyServerMessage(initialStreamState, pong)).toBe(initialStreamState);
    expect(applyServerMessage(initialStreamState, error)).toBe(initialStreamState);
  });
});

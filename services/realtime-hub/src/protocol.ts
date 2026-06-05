import { z } from 'zod';

export type LiveInterval = '1s' | '1m';

// ---------------------------------------------------------------------------
// Payloads (normalised, provider-agnostic shapes sent to browsers)
// ---------------------------------------------------------------------------

export interface PriceUpdate {
  price: number;
  changePercent24h?: number;
  marketCap?: number;
  volume24h?: number;
  timestamp?: number;
}

export interface TradeUpdate {
  price?: number;
  amount?: number;
  value?: number;
  side?: 'buy' | 'sell';
  timestamp?: number;
}

/** [time, open, high, low, close] — matches the chart's OHLC tuple. */
export type Candle = [number, number, number, number, number];

// ---------------------------------------------------------------------------
// Client -> hub messages (untrusted input, validated with zod)
// ---------------------------------------------------------------------------

export const liveIntervalSchema = z.enum(['1s', '1m']);

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    coinId: z.string().min(1),
    poolId: z.string().optional(),
    interval: liveIntervalSchema.optional(),
  }),
  z.object({ type: z.literal('unsubscribe') }),
  z.object({ type: z.literal('ping') }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------------------
// Hub -> client messages
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: 'snapshot'; coinId: string; price: PriceUpdate | null }
  | { type: 'price'; coinId: string; data: PriceUpdate }
  | { type: 'trade'; poolAddress: string; data: TradeUpdate }
  | { type: 'ohlcv'; poolAddress: string; interval: LiveInterval; data: Candle }
  | { type: 'pong' }
  | { type: 'error'; message: string };

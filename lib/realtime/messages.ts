// Client-side mirror of the realtime hub's wire protocol
// (services/realtime-hub/src/protocol.ts). The wire format is the contract; each
// side keeps its own types. These map hub messages onto the shapes the existing
// live-data UI already consumes (ExtendedPriceData, Trade, OHLCData).

export type LiveInterval = '1s' | '1m';

export interface HubPriceUpdate {
  price: number;
  changePercent24h?: number;
  marketCap?: number;
  volume24h?: number;
  timestamp?: number;
}

export interface HubTradeUpdate {
  price?: number;
  amount?: number;
  value?: number;
  side?: 'buy' | 'sell';
  timestamp?: number;
}

export type ServerMessage =
  | { type: 'snapshot'; coinId: string; price: HubPriceUpdate | null }
  | { type: 'price'; coinId: string; data: HubPriceUpdate }
  | { type: 'trade'; poolAddress: string; data: HubTradeUpdate }
  | { type: 'ohlcv'; poolAddress: string; interval: LiveInterval; data: OHLCData }
  | { type: 'pong' }
  | { type: 'error'; message: string };

export interface StreamState {
  price: ExtendedPriceData | null;
  trades: Trade[];
  ohlcv: OHLCData | null;
}

export const initialStreamState: StreamState = { price: null, trades: [], ohlcv: null };

const MAX_TRADES = 7;
const KNOWN_TYPES = new Set(['snapshot', 'price', 'trade', 'ohlcv', 'pong', 'error']);

/** Parse + lightly validate an inbound frame; returns null for anything unexpected. */
export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null) return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) return null;

  return value as ServerMessage;
}

export function toPriceData(coinId: string, update: HubPriceUpdate): ExtendedPriceData {
  return {
    usd: update.price ?? 0,
    coin: coinId,
    price: update.price,
    change24h: update.changePercent24h,
    marketCap: update.marketCap,
    volume24h: update.volume24h,
    timestamp: update.timestamp,
  };
}

export function toTrade(update: HubTradeUpdate): Trade {
  return {
    price: update.price,
    amount: update.amount,
    value: update.value,
    // The existing trades table keys off 'b' / 's'.
    type: update.side === 'buy' ? 'b' : 's',
    timestamp: update.timestamp,
  };
}

/** Fold an inbound hub message into the live-data state. Pure. */
export function applyServerMessage(state: StreamState, message: ServerMessage): StreamState {
  switch (message.type) {
    case 'snapshot':
      return message.price
        ? { ...state, price: toPriceData(message.coinId, message.price) }
        : state;
    case 'price':
      return { ...state, price: toPriceData(message.coinId, message.data) };
    case 'trade':
      return { ...state, trades: [toTrade(message.data), ...state.trades].slice(0, MAX_TRADES) };
    case 'ohlcv':
      return { ...state, ohlcv: message.data };
    case 'pong':
    case 'error':
      return state;
  }
}

import WebSocket from 'ws';
import type { Candle, LiveInterval, PriceUpdate, TradeUpdate } from './protocol';
import type { UpstreamSubscription } from './subscription-registry';

const INITIAL_RECONNECT_DELAY = 1_000;
const MAX_RECONNECT_DELAY = 30_000;
const HEARTBEAT_TIMEOUT = 35_000;

export interface UpstreamHandlers {
  onPrice: (coinId: string, update: PriceUpdate) => void;
  onTrade: (poolAddress: string, update: TradeUpdate) => void;
  onOhlcv: (poolAddress: string, interval: LiveInterval, candle: Candle) => void;
  onStatusChange?: (connected: boolean) => void;
}

/** Subset of the CoinGecko frame fields this service reads. */
interface UpstreamMessage {
  type?: string;
  identifier?: string;
  c?: string;
  ch?: string;
  i?: string;
  p?: number;
  pp?: number;
  m?: number;
  v?: number;
  t?: number;
  pu?: number;
  vo?: number;
  to?: number;
  ty?: string;
  o?: number;
  h?: number;
  l?: number;
}

/**
 * Holds a single connection to CoinGecko's WebSocket and keeps it subscribed to
 * the *union* of what every browser wants. CoinGecko's channels are set-based
 * (`set_tokens` / `set_pools` replace the whole list), so on any change — or after
 * a reconnect — we re-send the full desired set per channel.
 *
 * Routing note: price frames carry the coin id in `i` (confirmed by the existing
 * client hook). The exact pool identifier on trade/OHLCV frames must be verified
 * against the live stream before multi-pool fan-out is trusted — see
 * `poolAddressFromMessage`.
 */
export class UpstreamClient {
  private ws: WebSocket | null = null;
  private shouldRun = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private readonly subscribedChannels = new Set<string>();
  private desired: UpstreamSubscription[] = [];

  constructor(
    private readonly options: { url: string; apiKey: string; handlers: UpstreamHandlers },
  ) {}

  start(): void {
    this.shouldRun = true;
    this.connect();
  }

  stop(): void {
    this.shouldRun = false;
    this.clearReconnect();
    this.clearHeartbeat();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  setDesiredSubscriptions(subs: UpstreamSubscription[]): void {
    this.desired = subs;
    this.flushSubscriptions();
  }

  private url(): string {
    const separator = this.options.url.includes('?') ? '&' : '?';
    return `${this.options.url}${separator}x_cg_pro_api_key=${this.options.apiKey}`;
  }

  private connect(): void {
    const ws = new WebSocket(this.url());
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectAttempts = 0;
      this.subscribedChannels.clear();
      this.bumpHeartbeat();
      this.options.handlers.onStatusChange?.(true);
      this.flushSubscriptions();
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      this.bumpHeartbeat();
      this.handleMessage(raw.toString());
    });

    ws.on('error', () => {
      // 'error' is always followed by 'close', which schedules the reconnect.
      ws.close();
    });

    ws.on('close', () => {
      this.clearHeartbeat();
      this.options.handlers.onStatusChange?.(false);
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun) return;
    const backoff = Math.min(
      INITIAL_RECONNECT_DELAY * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY,
    );
    this.reconnectAttempts += 1;
    this.clearReconnect();
    // Full jitter to avoid every hub instance reconnecting in lockstep.
    this.reconnectTimer = setTimeout(() => this.connect(), Math.random() * backoff);
  }

  private bumpHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      // No traffic (not even pings) for a while: assume the socket is dead.
      this.ws?.close();
    }, HEARTBEAT_TIMEOUT);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private subscribeChannel(channel: string, data?: Record<string, unknown>): void {
    if (!this.subscribedChannels.has(channel)) {
      this.send({ command: 'subscribe', identifier: JSON.stringify({ channel }) });
      this.subscribedChannels.add(channel);
    }
    if (data) {
      this.send({
        command: 'message',
        identifier: JSON.stringify({ channel }),
        data: JSON.stringify(data),
      });
    }
  }

  /** (Re)send the set-based subscription messages for the current desired union. */
  private flushSubscriptions(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    const coinIds = new Set<string>();
    const tradePools = new Set<string>();
    // Map of interval -> pools; CoinGecko's OHLCV channel carries one interval.
    const ohlcvPoolsByInterval = new Map<LiveInterval, Set<string>>();

    for (const sub of this.desired) {
      if (sub.kind === 'price') coinIds.add(sub.coinId);
      if (sub.kind === 'trade') tradePools.add(sub.poolAddress);
      if (sub.kind === 'ohlcv') {
        const pools = ohlcvPoolsByInterval.get(sub.interval) ?? new Set<string>();
        pools.add(sub.poolAddress);
        ohlcvPoolsByInterval.set(sub.interval, pools);
      }
    }

    if (coinIds.size > 0) {
      this.subscribeChannel('CGSimplePrice', { coin_id: [...coinIds], action: 'set_tokens' });
    }
    if (tradePools.size > 0) {
      this.subscribeChannel('OnchainTrade', {
        'network_id:pool_addresses': [...tradePools],
        action: 'set_pools',
      });
    }
    // NOTE: one OnchainOHLCV channel = one interval. Mixed intervals across pools
    // is a known limitation pending live-stream verification; we send the most
    // recently requested interval's set.
    const lastInterval = [...ohlcvPoolsByInterval.keys()].at(-1);
    if (lastInterval) {
      this.subscribeChannel('OnchainOHLCV', {
        'network_id:pool_addresses': [...(ohlcvPoolsByInterval.get(lastInterval) ?? [])],
        interval: lastInterval,
        action: 'set_pools',
      });
    }
  }

  private handleMessage(raw: string): void {
    let msg: UpstreamMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      this.send({ type: 'pong' });
      return;
    }
    if (msg.type === 'confirm_subscription') return;

    if (msg.c === 'C1' && msg.i) {
      this.options.handlers.onPrice(msg.i, {
        price: msg.p ?? 0,
        changePercent24h: msg.pp,
        marketCap: msg.m,
        volume24h: msg.v,
        timestamp: msg.t,
      });
      return;
    }

    if (msg.c === 'G2') {
      const poolAddress = this.poolAddressFromMessage(msg);
      if (poolAddress) {
        this.options.handlers.onTrade(poolAddress, {
          price: msg.pu,
          amount: msg.to,
          value: msg.vo,
          side: msg.ty === 'b' ? 'buy' : 'sell',
          timestamp: msg.t,
        });
      }
      return;
    }

    if (msg.ch === 'G3') {
      const poolAddress = this.poolAddressFromMessage(msg);
      if (poolAddress) {
        const candle: Candle = [
          msg.t ?? 0,
          Number(msg.o ?? 0),
          Number(msg.h ?? 0),
          Number(msg.l ?? 0),
          Number(msg.c ?? 0),
        ];
        // Interval is not echoed per-frame; '1s' is the hub default.
        this.options.handlers.onOhlcv(poolAddress, '1s', candle);
      }
    }
  }

  /**
   * TODO(integration): confirm which field carries the pool address on trade/OHLCV
   * frames against a live CoinGecko stream. The single-pool client hook never had to
   * route, so this is currently a best-effort read of the frame identifier.
   */
  private poolAddressFromMessage(msg: UpstreamMessage): string | undefined {
    return msg.identifier ?? undefined;
  }
}

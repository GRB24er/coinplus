import type {
  Candle,
  ClientMessage,
  LiveInterval,
  PriceUpdate,
  ServerMessage,
  TradeUpdate,
} from './protocol';
import { SubscriptionRegistry, subscriptionKey } from './subscription-registry';
import type { UpstreamSubscription } from './subscription-registry';
import { UpstreamClient } from './upstream-client';

/** Anything the hub can push messages to (a browser connection in practice). */
export interface ClientSink {
  send(message: ServerMessage): void;
}

/**
 * The core fan-out engine. Maps the union of client interest onto a single
 * upstream connection, routes upstream frames back to the interested clients, and
 * hands newly-subscribed clients an immediate price snapshot.
 *
 * Pure of any socket details (it talks to clients through {@link ClientSink}), so
 * it can be driven from tests without real network I/O.
 */
export class Hub {
  private readonly registry = new SubscriptionRegistry();
  private readonly clients = new Map<string, ClientSink>();
  private readonly latestPriceByCoin = new Map<string, PriceUpdate>();
  private readonly upstream: UpstreamClient;

  constructor(options: { upstreamUrl: string; apiKey: string }) {
    this.upstream = new UpstreamClient({
      url: options.upstreamUrl,
      apiKey: options.apiKey,
      handlers: {
        onPrice: (coinId, update) => this.broadcastPrice(coinId, update),
        onTrade: (poolAddress, update) => this.broadcastTrade(poolAddress, update),
        onOhlcv: (poolAddress, interval, candle) =>
          this.broadcastOhlcv(poolAddress, interval, candle),
      },
    });
  }

  start(): void {
    this.upstream.start();
  }

  stop(): void {
    this.upstream.stop();
  }

  addClient(clientId: string, sink: ClientSink): void {
    this.clients.set(clientId, sink);
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    const { unionChanged } = this.registry.removeClient(clientId);
    if (unionChanged) this.upstream.setDesiredSubscriptions(this.registry.getUnion());
  }

  handleClientMessage(clientId: string, message: ClientMessage): void {
    const sink = this.clients.get(clientId);
    if (!sink) return;

    switch (message.type) {
      case 'ping':
        sink.send({ type: 'pong' });
        return;

      case 'unsubscribe': {
        const { unionChanged } = this.registry.setClientSubscriptions(clientId, []);
        if (unionChanged) this.upstream.setDesiredSubscriptions(this.registry.getUnion());
        return;
      }

      case 'subscribe': {
        const subs = subscriptionsForRequest(message.coinId, message.poolId, message.interval);
        const { unionChanged } = this.registry.setClientSubscriptions(clientId, subs);
        if (unionChanged) this.upstream.setDesiredSubscriptions(this.registry.getUnion());

        // Bootstrap the new subscriber with the last known price immediately.
        sink.send({
          type: 'snapshot',
          coinId: message.coinId,
          price: this.latestPriceByCoin.get(message.coinId) ?? null,
        });
        return;
      }
    }
  }

  private broadcastPrice(coinId: string, update: PriceUpdate): void {
    this.latestPriceByCoin.set(coinId, update);
    this.fanOut(subscriptionKey({ kind: 'price', coinId }), {
      type: 'price',
      coinId,
      data: update,
    });
  }

  private broadcastTrade(poolAddress: string, update: TradeUpdate): void {
    this.fanOut(subscriptionKey({ kind: 'trade', poolAddress }), {
      type: 'trade',
      poolAddress,
      data: update,
    });
  }

  private broadcastOhlcv(poolAddress: string, interval: LiveInterval, candle: Candle): void {
    this.fanOut(subscriptionKey({ kind: 'ohlcv', poolAddress, interval }), {
      type: 'ohlcv',
      poolAddress,
      interval,
      data: candle,
    });
  }

  private fanOut(key: string, message: ServerMessage): void {
    for (const clientId of this.registry.clientsForKey(key)) {
      this.clients.get(clientId)?.send(message);
    }
  }
}

export function subscriptionsForRequest(
  coinId: string,
  poolId?: string,
  interval?: LiveInterval,
): UpstreamSubscription[] {
  const subs: UpstreamSubscription[] = [{ kind: 'price', coinId }];

  if (poolId) {
    // Mirrors the existing client hook's pool-address formatting.
    const poolAddress = poolId.replace('_', ':');
    subs.push({ kind: 'trade', poolAddress });
    subs.push({ kind: 'ohlcv', poolAddress, interval: interval ?? '1s' });
  }

  return subs;
}

import type { LiveInterval } from './protocol';

/**
 * A single upstream subscription, independent of which/how many clients want it.
 */
export type UpstreamSubscription =
  | { kind: 'price'; coinId: string }
  | { kind: 'trade'; poolAddress: string }
  | { kind: 'ohlcv'; poolAddress: string; interval: LiveInterval };

export function subscriptionKey(sub: UpstreamSubscription): string {
  switch (sub.kind) {
    case 'price':
      return `price:${sub.coinId}`;
    case 'trade':
      return `trade:${sub.poolAddress}`;
    case 'ohlcv':
      return `ohlcv:${sub.poolAddress}:${sub.interval}`;
  }
}

export interface UnionChange {
  /** True when the deduplicated upstream set changed (something must (un)subscribe). */
  unionChanged: boolean;
}

/**
 * Reference-counts what every connected client is subscribed to, so the hub holds
 * exactly one upstream subscription per distinct target no matter how many browsers
 * want it. Pure and synchronous — no I/O — so it is trivially unit-testable.
 */
export class SubscriptionRegistry {
  private readonly refCounts = new Map<string, number>();
  private readonly subByKey = new Map<string, UpstreamSubscription>();
  private readonly keysByClient = new Map<string, Set<string>>();
  private readonly clientsByKey = new Map<string, Set<string>>();

  /** Replace a client's full subscription set; returns whether the union changed. */
  setClientSubscriptions(clientId: string, subs: UpstreamSubscription[]): UnionChange {
    const nextKeys = new Map<string, UpstreamSubscription>();
    for (const sub of subs) nextKeys.set(subscriptionKey(sub), sub);

    const prevKeys = this.keysByClient.get(clientId) ?? new Set<string>();
    let unionChanged = false;

    for (const [key, sub] of nextKeys) {
      if (prevKeys.has(key)) continue;
      this.addClientToKey(clientId, key);
      const count = (this.refCounts.get(key) ?? 0) + 1;
      this.refCounts.set(key, count);
      this.subByKey.set(key, sub);
      if (count === 1) unionChanged = true;
    }

    for (const key of prevKeys) {
      if (nextKeys.has(key)) continue;
      this.removeClientFromKey(clientId, key);
      const count = (this.refCounts.get(key) ?? 0) - 1;
      if (count <= 0) {
        this.refCounts.delete(key);
        this.subByKey.delete(key);
        unionChanged = true;
      } else {
        this.refCounts.set(key, count);
      }
    }

    if (nextKeys.size === 0) {
      this.keysByClient.delete(clientId);
    } else {
      this.keysByClient.set(clientId, new Set(nextKeys.keys()));
    }

    return { unionChanged };
  }

  removeClient(clientId: string): UnionChange {
    return this.setClientSubscriptions(clientId, []);
  }

  /** The deduplicated set of subscriptions to hold upstream. */
  getUnion(): UpstreamSubscription[] {
    return [...this.subByKey.values()];
  }

  /** Clients currently interested in a given subscription key (for fan-out routing). */
  clientsForKey(key: string): string[] {
    const clients = this.clientsByKey.get(key);
    return clients ? [...clients] : [];
  }

  private addClientToKey(clientId: string, key: string): void {
    let set = this.clientsByKey.get(key);
    if (!set) {
      set = new Set<string>();
      this.clientsByKey.set(key, set);
    }
    set.add(clientId);
  }

  private removeClientFromKey(clientId: string, key: string): void {
    const set = this.clientsByKey.get(key);
    if (!set) return;
    set.delete(clientId);
    if (set.size === 0) this.clientsByKey.delete(key);
  }
}

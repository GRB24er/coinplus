import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SubscriptionRegistry,
  subscriptionKey,
  type UpstreamSubscription,
} from '../src/subscription-registry';

const price = (coinId: string): UpstreamSubscription => ({ kind: 'price', coinId });

describe('SubscriptionRegistry', () => {
  it('flags a union change only when the first client wants a target', () => {
    const registry = new SubscriptionRegistry();

    assert.equal(registry.setClientSubscriptions('a', [price('btc')]).unionChanged, true);
    // Second client wanting the same coin does not change the upstream union.
    assert.equal(registry.setClientSubscriptions('b', [price('btc')]).unionChanged, false);

    assert.deepEqual(registry.getUnion(), [price('btc')]);
  });

  it('keeps a target until the last interested client leaves', () => {
    const registry = new SubscriptionRegistry();
    registry.setClientSubscriptions('a', [price('btc')]);
    registry.setClientSubscriptions('b', [price('btc')]);

    // One of two leaves: still wanted, no change.
    assert.equal(registry.removeClient('a').unionChanged, false);
    assert.deepEqual(registry.getUnion(), [price('btc')]);

    // Last one leaves: target drops out of the union.
    assert.equal(registry.removeClient('b').unionChanged, true);
    assert.deepEqual(registry.getUnion(), []);
  });

  it('routes a key to exactly the clients subscribed to it', () => {
    const registry = new SubscriptionRegistry();
    registry.setClientSubscriptions('a', [price('btc')]);
    registry.setClientSubscriptions('b', [price('btc'), price('eth')]);

    assert.deepEqual(registry.clientsForKey(subscriptionKey(price('btc'))).sort(), ['a', 'b']);
    assert.deepEqual(registry.clientsForKey(subscriptionKey(price('eth'))), ['b']);
  });

  it('replaces a client subscription set and updates routing + union', () => {
    const registry = new SubscriptionRegistry();
    registry.setClientSubscriptions('a', [price('btc')]);

    // Client switches coins: btc drops (last interested), eth is added.
    const change = registry.setClientSubscriptions('a', [price('eth')]);
    assert.equal(change.unionChanged, true);
    assert.deepEqual(registry.getUnion(), [price('eth')]);
    assert.deepEqual(registry.clientsForKey(subscriptionKey(price('btc'))), []);
    assert.deepEqual(registry.clientsForKey(subscriptionKey(price('eth'))), ['a']);
  });

  it('deduplicates pool trade and OHLCV subscriptions across clients', () => {
    const registry = new SubscriptionRegistry();
    const subs: UpstreamSubscription[] = [
      { kind: 'trade', poolAddress: 'eth:0xabc' },
      { kind: 'ohlcv', poolAddress: 'eth:0xabc', interval: '1s' },
    ];

    assert.equal(registry.setClientSubscriptions('a', subs).unionChanged, true);
    assert.equal(registry.setClientSubscriptions('b', subs).unionChanged, false);
    assert.equal(registry.getUnion().length, 2);
  });
});

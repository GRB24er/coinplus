# Realtime Hub

A standalone, long-lived Node service that sits between browsers and CoinGecko's
WebSocket. It is **Step 2** of the Tier 2 backend-for-frontend
([ADR 0001](../../docs/adr/0001-backend-for-frontend-for-market-data.md)).

## Why it exists

- **Hide the key.** The CoinGecko WebSocket key stays server-side; browsers connect
  only to this hub.
- **Decouple connections from users.** The hub holds **one** upstream connection and
  subscribes to the _union_ of what all clients want, ref-counted. 10,000 browsers no
  longer mean 10,000 upstream connections.
- **Snapshots.** New subscribers get the last known price immediately, then live deltas.

```
Browsers ──ws /stream──▶  Realtime Hub  ──1 pooled conn──▶  CoinGecko WS
                          (this service)
```

## Client protocol

Connect to `ws://<host>:<port>/stream`. All frames are JSON.

**Client → hub**

```jsonc
{ "type": "subscribe", "coinId": "bitcoin", "poolId": "eth_0xabc", "interval": "1s" }
{ "type": "unsubscribe" }
{ "type": "ping" }
```

**Hub → client**

```jsonc
{ "type": "snapshot", "coinId": "bitcoin", "price": { "price": 64000, ... } | null }
{ "type": "price",  "coinId": "bitcoin", "data": { "price": 64010, "changePercent24h": 1.2, ... } }
{ "type": "trade",  "poolAddress": "eth:0xabc", "data": { "price": 64010, "side": "buy", ... } }
{ "type": "ohlcv",  "poolAddress": "eth:0xabc", "interval": "1s", "data": [t, o, h, l, c] }
{ "type": "pong" }
{ "type": "error", "message": "..." }
```

`GET /healthz` returns `{ "status": "ok" }` for platform health probes.

## Run locally

```bash
cd services/realtime-hub
npm install
cp .env.example .env   # fill in COINGECKO_WEBSOCKET_URL + COINGECKO_API_KEY
npm run dev            # tsx watch
npm test               # registry unit tests (node:test)
npm run typecheck
```

## Deploy

Designed for any long-lived Node host (Fly.io, Railway, Render, ECS) — **not**
serverless/edge, which cannot hold persistent sockets. A `Dockerfile` is included:

```bash
docker build -t realtime-hub services/realtime-hub
docker run -p 8080:8080 --env-file services/realtime-hub/.env realtime-hub
```

## Status & known gaps

This is a deploy-ready **scaffold**. Solid and tested today:

- subscription ref-counting / union management (unit-tested)
- one-connection upstream pooling with reconnect (jittered backoff) + heartbeat
- client fan-out, snapshots, health check, graceful shutdown
- live **price** routing (frames carry the coin id in `i`, confirmed by the app's hook)

Needs live-stream verification before relying on it (search `TODO(integration)`):

- **Trade / OHLCV pool routing** — the exact field carrying the pool address on those
  frames must be confirmed against the live stream; the single-pool client hook never
  had to route by pool. See `poolAddressFromMessage` in `upstream-client.ts`.
- **Mixed OHLCV intervals** — CoinGecko's OHLCV channel carries a single interval, so
  per-pool intervals are not yet supported.

## Next (Step 3)

Point the app's `hooks/useCoinGeckoWebSocket.ts` at this hub's protocol and delete the
`NEXT_PUBLIC_COINGECKO_*` variables. See ADR 0001 for the full migration plan.

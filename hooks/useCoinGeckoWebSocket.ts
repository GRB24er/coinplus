'use client';

import { useEffect, useRef, useState } from 'react';
import { clientEnv } from '@/lib/env.client';

const WS_BASE = `${clientEnv.NEXT_PUBLIC_COINGECKO_WEBSOCKET_URL}?x_cg_pro_api_key=${clientEnv.NEXT_PUBLIC_COINGECKO_API_KEY}`;

// Reconnection / liveness tuning.
const INITIAL_RECONNECT_DELAY = 1000; // 1s
const MAX_RECONNECT_DELAY = 30000; // 30s cap
const HEARTBEAT_TIMEOUT = 35000; // no message for 35s => assume the socket is dead

export const useCoinGeckoWebSocket = ({
  coinId,
  poolId,
  liveInterval,
}: UseCoinGeckoWebSocketProps): UseCoinGeckoWebSocketReturn => {
  const wsRef = useRef<WebSocket | null>(null);
  const subscribed = useRef(<Set<string>>new Set());

  // Reconnection bookkeeping (kept in refs so they survive re-renders).
  const shouldReconnect = useRef(true);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [price, setPrice] = useState<ExtendedPriceData | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [ohlcv, setOhlcv] = useState<OHLCData | null>(null);

  const [isWsReady, setIsWsReady] = useState(false);

  useEffect(() => {
    shouldReconnect.current = true;
    // Captured for the cleanup closure (the ref object itself is stable for the
    // component's lifetime, so this always points at the live subscription set).
    const subscribedChannels = subscribed.current;

    function clearReconnectTimer() {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    }

    function clearHeartbeat() {
      if (heartbeatTimer.current) {
        clearTimeout(heartbeatTimer.current);
        heartbeatTimer.current = null;
      }
    }

    // Any inbound message resets the watchdog; if it ever fires, the connection
    // is stalled (no pings/data), so we drop it and let onclose reconnect.
    function bumpHeartbeat() {
      clearHeartbeat();
      heartbeatTimer.current = setTimeout(() => {
        console.warn('[CoinGeckoWS] heartbeat timeout — forcing reconnect');
        wsRef.current?.close();
      }, HEARTBEAT_TIMEOUT);
    }

    function scheduleReconnect() {
      if (!shouldReconnect.current) return;

      const backoff = Math.min(
        INITIAL_RECONNECT_DELAY * 2 ** reconnectAttempts.current,
        MAX_RECONNECT_DELAY,
      );
      // Full jitter avoids a thundering herd of clients reconnecting in lockstep.
      const jittered = Math.random() * backoff;
      reconnectAttempts.current += 1;

      clearReconnectTimer();
      reconnectTimer.current = setTimeout(connect, jittered);
    }

    function connect() {
      const ws = new WebSocket(WS_BASE);
      wsRef.current = ws;

      const send = (payload: Record<string, unknown>) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
      };

      ws.onopen = () => {
        reconnectAttempts.current = 0;
        // A fresh socket knows nothing about prior subscriptions; re-subscribe clean.
        subscribed.current.clear();
        bumpHeartbeat();
        setIsWsReady(true);
      };

      ws.onmessage = (event: MessageEvent) => {
        bumpHeartbeat();

        let msg: WebSocketMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === 'ping') {
          send({ type: 'pong' });
          return;
        }
        if (msg.type === 'confirm_subscription') {
          try {
            const { channel } = JSON.parse(msg?.identifier ?? '');
            subscribed.current.add(channel);
          } catch {
            // Ignore a malformed identifier rather than killing the connection.
          }
          return;
        }
        if (msg.c === 'C1') {
          setPrice({
            usd: msg.p ?? 0,
            coin: msg.i,
            price: msg.p,
            change24h: msg.pp,
            marketCap: msg.m,
            volume24h: msg.v,
            timestamp: msg.t,
          });
        }
        if (msg.c === 'G2') {
          const newTrade: Trade = {
            price: msg.pu,
            value: msg.vo,
            timestamp: msg.t ?? 0,
            type: msg.ty,
            amount: msg.to,
          };

          setTrades((prev) => [newTrade, ...prev].slice(0, 7));
        }
        if (msg.ch === 'G3') {
          const timestamp = msg.t ?? 0;

          const candle: OHLCData = [
            timestamp,
            Number(msg.o ?? 0),
            Number(msg.h ?? 0),
            Number(msg.l ?? 0),
            Number(msg.c ?? 0),
          ];

          setOhlcv(candle);
        }
      };

      ws.onerror = () => {
        // onerror is always followed by onclose, which handles the reconnect.
        console.error('[CoinGeckoWS] socket error');
        ws.close();
      };

      ws.onclose = () => {
        clearHeartbeat();
        setIsWsReady(false);
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      // Tear down without triggering a reconnect on unmount.
      shouldReconnect.current = false;
      clearReconnectTimer();
      clearHeartbeat();

      const ws = wsRef.current;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
      subscribedChannels.clear();
    };
  }, []);

  useEffect(() => {
    if (!isWsReady) return;
    const ws = wsRef.current;
    if (!ws) return;

    const send = (payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    };

    const unsubscribeAll = () => {
      subscribed.current.forEach((channel) => {
        send({
          command: 'unsubscribe',
          identifier: JSON.stringify({ channel }),
        });
      });

      subscribed.current.clear();
    };

    const subscribe = (channel: string, data?: Record<string, unknown>) => {
      if (subscribed.current.has(channel)) return;

      send({ command: 'subscribe', identifier: JSON.stringify({ channel }) });

      if (data) {
        send({
          command: 'message',
          identifier: JSON.stringify({ channel }),
          data: JSON.stringify(data),
        });
      }
    };

    queueMicrotask(() => {
      setPrice(null);
      setTrades([]);
      setOhlcv(null);

      unsubscribeAll();

      subscribe('CGSimplePrice', { coin_id: [coinId], action: 'set_tokens' });
    });

    const poolAddress = poolId.replace('_', ':') ?? '';

    if (poolAddress) {
      subscribe('OnchainTrade', {
        'network_id:pool_addresses': [poolAddress],
        action: 'set_pools',
      });

      subscribe('OnchainOHLCV', {
        'network_id:pool_addresses': [poolAddress],
        interval: liveInterval,
        action: 'set_pools',
      });
    }
  }, [coinId, poolId, isWsReady, liveInterval]);

  return {
    price,
    trades,
    ohlcv,
    isConnected: isWsReady,
  };
};

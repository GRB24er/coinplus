'use client';

import { useEffect, useRef, useState } from 'react';
import {
  applyServerMessage,
  initialStreamState,
  parseServerMessage,
  type StreamState,
} from '@/lib/realtime/messages';

// Read directly (not via clientEnv) so this hook has no dependency on the legacy
// CoinGecko client vars — when the cutover removes them, this keeps working.
const HUB_URL = process.env.NEXT_PUBLIC_REALTIME_HUB_URL;

const PING_INTERVAL = 15_000;
const HEARTBEAT_TIMEOUT = 35_000;
const INITIAL_RECONNECT_DELAY = 1_000;
const MAX_RECONNECT_DELAY = 30_000;

/**
 * Live market data via our realtime hub (ADR 0001, Step 3). Drop-in compatible
 * with useCoinGeckoWebSocket — same props and return shape — so the two can be
 * swapped behind a flag. The browser connects only to the hub, never CoinGecko.
 */
export const useMarketDataStream = ({
  coinId,
  poolId,
  liveInterval,
}: UseCoinGeckoWebSocketProps): UseCoinGeckoWebSocketReturn => {
  const [state, setState] = useState<StreamState>(initialStreamState);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const shouldReconnect = useRef(true);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Latest target, read by the (re)subscribe-on-open path after a reconnect.
  // Kept current by the resubscribe effect below (never written during render).
  const target = useRef({ coinId, poolId, liveInterval });

  // Clear accumulated data the moment the watched target changes (React's
  // "adjust state during render" pattern, preferred over resetting in an effect).
  const [watched, setWatched] = useState({ coinId, poolId, liveInterval });
  if (
    watched.coinId !== coinId ||
    watched.poolId !== poolId ||
    watched.liveInterval !== liveInterval
  ) {
    setWatched({ coinId, poolId, liveInterval });
    setState(initialStreamState);
  }

  useEffect(() => {
    if (!HUB_URL) return;
    shouldReconnect.current = true;

    function clearHeartbeat() {
      if (heartbeatTimer.current) {
        clearTimeout(heartbeatTimer.current);
        heartbeatTimer.current = null;
      }
    }

    function stopPing() {
      if (pingTimer.current) {
        clearInterval(pingTimer.current);
        pingTimer.current = null;
      }
    }

    function sendRaw(payload: Record<string, unknown>) {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    }

    // Any inbound frame (including the hub's pong) resets the watchdog.
    function bumpHeartbeat() {
      clearHeartbeat();
      heartbeatTimer.current = setTimeout(() => wsRef.current?.close(), HEARTBEAT_TIMEOUT);
    }

    function startPing() {
      stopPing();
      pingTimer.current = setInterval(() => sendRaw({ type: 'ping' }), PING_INTERVAL);
    }

    function scheduleReconnect() {
      if (!shouldReconnect.current) return;
      const backoff = Math.min(
        INITIAL_RECONNECT_DELAY * 2 ** reconnectAttempts.current,
        MAX_RECONNECT_DELAY,
      );
      reconnectAttempts.current += 1;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(connect, Math.random() * backoff);
    }

    function connect() {
      const ws = new WebSocket(HUB_URL as string);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempts.current = 0;
        setIsConnected(true);
        bumpHeartbeat();
        sendRaw({
          type: 'subscribe',
          coinId: target.current.coinId,
          poolId: target.current.poolId,
          interval: target.current.liveInterval,
        });
        startPing();
      };

      ws.onmessage = (event: MessageEvent) => {
        bumpHeartbeat();
        const message = parseServerMessage(
          typeof event.data === 'string' ? event.data : String(event.data),
        );
        if (message) setState((prev) => applyServerMessage(prev, message));
      };

      ws.onerror = () => ws.close();

      ws.onclose = () => {
        setIsConnected(false);
        stopPing();
        clearHeartbeat();
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      shouldReconnect.current = false;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      clearHeartbeat();
      stopPing();
      const ws = wsRef.current;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
    };
  }, []);

  // Reset and re-subscribe whenever the watched coin/pool/interval changes.
  // Re-subscribe (and remember the target for reconnects) on any change.
  useEffect(() => {
    target.current = { coinId, poolId, liveInterval };
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', coinId, poolId, interval: liveInterval }));
    }
  }, [coinId, poolId, liveInterval]);

  return { price: state.price, trades: state.trades, ohlcv: state.ohlcv, isConnected };
};

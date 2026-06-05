import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { Config } from './config';
import { Hub } from './hub';
import { clientMessageSchema, type ServerMessage } from './protocol';

interface RunningServer {
  close: () => Promise<void>;
}

/** Boot the HTTP + WebSocket server and the fan-out hub. */
export function startServer(config: Config): RunningServer {
  const hub = new Hub({
    upstreamUrl: config.COINGECKO_WEBSOCKET_URL,
    apiKey: config.COINGECKO_API_KEY,
  });
  hub.start();

  const httpServer = createServer(handleHttp);
  const wss = new WebSocketServer({ server: httpServer, path: '/stream' });

  // Liveness of each browser socket: ws-protocol ping every interval; terminate
  // any connection that did not pong since the last cycle.
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (socket: WebSocket) => {
    const clientId = randomUUID();
    alive.set(socket, true);

    const sink = {
      send: (message: ServerMessage) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      },
    };
    hub.addClient(clientId, sink);

    socket.on('pong', () => alive.set(socket, true));

    socket.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        sink.send({ type: 'error', message: 'Invalid JSON' });
        return;
      }

      const result = clientMessageSchema.safeParse(parsed);
      if (!result.success) {
        sink.send({ type: 'error', message: 'Unrecognised message' });
        return;
      }

      hub.handleClientMessage(clientId, result.data);
    });

    socket.on('close', () => hub.removeClient(clientId));
    socket.on('error', () => socket.close());
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, config.CLIENT_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  httpServer.listen(config.PORT, config.HOST, () => {
    console.log(`[realtime-hub] listening on ${config.HOST}:${config.PORT} (ws path /stream)`);
  });

  return {
    close: () => shutdown({ httpServer, wss, hub, heartbeat }),
  };
}

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

function shutdown(parts: {
  httpServer: Server;
  wss: WebSocketServer;
  hub: Hub;
  heartbeat: NodeJS.Timeout;
}): Promise<void> {
  clearInterval(parts.heartbeat);
  parts.hub.stop();
  for (const socket of parts.wss.clients) socket.close(1001, 'server shutting down');

  return new Promise((resolve) => {
    parts.wss.close(() => parts.httpServer.close(() => resolve()));
  });
}

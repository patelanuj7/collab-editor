import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import sirv from 'sirv';
import { WS_PATH } from '@collab/shared';
import { config } from './config';
import { handleConnection } from './connection';
import { log } from './log';
import { RoomManager } from './RoomManager';

const roomManager = new RoomManager();
const staticHandler = config.isProd ? sirv(config.clientDist, { single: true }) : null;

const httpServer = createServer((req, res) => {
  const pathname = (req.url ?? '/').split('?')[0];
  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (staticHandler && (req.method === 'GET' || req.method === 'HEAD')) {
    staticHandler(req, res, () => {
      res.writeHead(404).end();
    });
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: httpServer, path: WS_PATH, maxPayload: 512 * 1024 });

function isOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  // Non-browser clients send no Origin; browsers always do, and that is what this check guards.
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host; // same-origin (production)
  } catch {
    return false;
  }
}

const alive = new WeakSet<WebSocket>();

wss.on('connection', (socket, req) => {
  if (!isOriginAllowed(req)) {
    log.warn(`rejected connection from origin ${req.headers.origin}`);
    socket.close(1008, 'Origin not allowed');
    return;
  }
  alive.add(socket);
  socket.on('pong', () => alive.add(socket));
  handleConnection(socket, roomManager);
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!alive.has(socket)) {
      socket.terminate();
      continue;
    }
    alive.delete(socket);
    socket.ping();
  }
}, config.heartbeatMs);

httpServer.listen(config.port, () => {
  log.info(`server listening on http://localhost:${config.port} (${config.isProd ? 'production' : 'development'})`);
});

function shutdown(): void {
  log.info('shutting down');
  clearInterval(heartbeat);
  roomManager.dispose();
  for (const socket of wss.clients) socket.close(1001, 'Server shutting down');
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

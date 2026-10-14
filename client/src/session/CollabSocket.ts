import { FATAL_CLOSE_CODE, encode, type ClientMessage, type ErrorCode, type ServerMessage } from '@collab/shared';

export type SocketStatus = 'connecting' | 'open' | 'closed';

export interface CollabSocketHandlers {
  onOpen(): void;
  onMessage(msg: ServerMessage): void;
  onStatus(s: SocketStatus): void;
}

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
const RESYNC: ErrorCode = 'RESYNC_REQUIRED';

function isServerMessage(v: unknown): v is ServerMessage {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';
}

/** A WebSocket that reconnects with backoff. Never queues: messages sent while not open are dropped. */
export class CollabSocket {
  private readonly url: string;
  private readonly handlers: CollabSocketHandlers;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set by close(); after that no handler is ever called again. */
  private closed = false;

  constructor(url: string, handlers: CollabSocketHandlers) {
    this.url = url;
    this.handlers = handlers;
    this.connect();
  }

  send(msg: ClientMessage): void {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(encode(msg));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    if (ws.readyState === WebSocket.CONNECTING) {
      // Closing a socket that is still connecting logs a browser warning (common under
      // StrictMode's mount/unmount/mount), so let it finish opening and close it then.
      ws.onopen = () => ws.close(1000);
    } else {
      ws.onopen = null;
      ws.close(1000);
    }
  }

  private connect(): void {
    if (this.closed) return;
    this.handlers.onStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.closed) return;
      this.attempt = 0;
      this.handlers.onStatus('open');
      this.handlers.onOpen();
    };

    ws.onmessage = (event) => {
      if (this.closed || typeof event.data !== 'string') return;
      let msg: unknown;
      try {
        msg = JSON.parse(event.data);
      } catch {
        console.warn('[collab] ignoring non-JSON message from server');
        return;
      }
      if (isServerMessage(msg)) this.handlers.onMessage(msg);
    };

    ws.onclose = (event) => {
      if (this.closed) return;
      this.ws = null;
      this.handlers.onStatus('closed');
      // A fatal close is final (room full, bad client…) unless the server just wants us to reload.
      if (event.code === FATAL_CLOSE_CODE && event.reason !== RESYNC) return;
      this.scheduleReconnect();
    };

    // onclose always follows onerror, so reconnect logic lives there.
    ws.onerror = () => {};
  }

  private scheduleReconnect(): void {
    const base = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** this.attempt);
    this.attempt += 1;
    const delay = base + Math.random() * base * 0.3;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

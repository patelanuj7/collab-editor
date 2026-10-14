import type { WebSocket } from 'ws';
import type { ClientMessage } from '@collab/shared';
import { config } from './config';
import { log } from './log';
import { parseClientMessage } from './schemas';
import { Room, RoomFullError, sendError } from './Room';
import type { RoomManager } from './RoomManager';

const MAX_BAD_MESSAGES = 5;

export function handleConnection(socket: WebSocket, roomManager: RoomManager): void {
  let room: Room | null = null;
  let clientId: string | null = null;
  let badMessages = 0;
  let tokens = config.maxMessagesPerSecond;
  let lastRefill = Date.now();

  const joinTimer = setTimeout(() => {
    if (!room) sendError(socket, 'JOIN_TIMEOUT', 'Did not join a room in time', true);
  }, config.joinTimeoutMs);

  const takeToken = (): boolean => {
    const now = Date.now();
    tokens = Math.min(
      config.maxMessagesPerSecond,
      tokens + ((now - lastRefill) / 1000) * config.maxMessagesPerSecond,
    );
    lastRefill = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };

  const route = (msg: ClientMessage): void => {
    if (msg.type === 'join') {
      if (room) {
        sendError(socket, 'ALREADY_JOINED', 'Already joined a room', false);
        return;
      }
      const target = roomManager.getOrCreate(msg.roomId);
      try {
        const user = target.join(socket, msg.name);
        room = target;
        clientId = user.clientId;
        clearTimeout(joinTimer);
      } catch (err) {
        if (err instanceof RoomFullError) {
          sendError(socket, 'ROOM_FULL', 'This room is full', true);
        } else {
          throw err;
        }
      }
      return;
    }
    if (!room || !clientId) {
      sendError(socket, 'NOT_JOINED', 'Send a join message first', true);
      return;
    }
    switch (msg.type) {
      case 'op':
        room.handleOp(clientId, msg.revision, msg.ops);
        break;
      case 'selection':
        room.handleSelection(clientId, msg.revision, msg.selection);
        break;
      case 'set-language':
        room.handleLanguage(clientId, msg.language);
        break;
    }
  };

  socket.on('message', (data, isBinary) => {
    try {
      if (!takeToken()) {
        sendError(socket, 'RATE_LIMITED', 'Too many messages', false);
        return;
      }
      const msg = isBinary ? null : parseClientMessage(data.toString());
      if (!msg) {
        badMessages += 1;
        const fatal = badMessages >= MAX_BAD_MESSAGES;
        sendError(socket, 'BAD_MESSAGE', 'Invalid message', fatal);
        return;
      }
      route(msg);
    } catch (err) {
      log.error('connection handler error', err);
      sendError(socket, 'BAD_MESSAGE', 'Internal error handling message', false);
    }
  });

  const cleanup = (): void => {
    clearTimeout(joinTimer);
    if (room && clientId) {
      room.leave(clientId);
      room = null;
      clientId = null;
    }
  };

  socket.on('close', cleanup);
  socket.on('error', (err) => {
    log.warn('socket error', err.message);
    cleanup();
  });
}

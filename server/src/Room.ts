import { WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import {
  DEFAULT_LANGUAGE,
  MAX_HISTORY,
  MAX_USERS_PER_ROOM,
  FATAL_CLOSE_CODE,
  OTError,
  OTServer,
  TextOperation,
  encode,
  isValidSelection,
  type ErrorCode,
  type LanguageId,
  type Selection,
  type SerializedOperation,
  type ServerMessage,
  type UserInfo,
} from '@collab/shared';
import { pickColor } from './colors';
import { log } from './log';

const WELCOME_DOC = '// Welcome! Share this URL to code together.\n';

interface Member {
  user: UserInfo;
  socket: WebSocket;
}

export class RoomFullError extends Error {
  constructor() {
    super('Room is full');
  }
}

export function sendMessage(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(encode(msg));
}

/** Sends an error; fatal errors also close the socket with the application close code. */
export function sendError(socket: WebSocket, code: ErrorCode, message: string, fatal: boolean): void {
  sendMessage(socket, { type: 'error', code, message, fatal });
  if (fatal) socket.close(FATAL_CLOSE_CODE, code);
}

export class Room {
  id: string;
  ot: OTServer;
  language: LanguageId = DEFAULT_LANGUAGE;
  members = new Map<string, Member>();
  /** Called when the last member leaves. */
  onEmpty: (() => void) | null = null;

  constructor(id: string) {
    this.id = id;
    this.ot = new OTServer(WELCOME_DOC, MAX_HISTORY);
  }

  get isEmpty(): boolean {
    return this.members.size === 0;
  }

  join(socket: WebSocket, name: string): UserInfo {
    if (this.members.size >= MAX_USERS_PER_ROOM) throw new RoomFullError();
    const user: UserInfo = {
      clientId: nanoid(12),
      name,
      color: pickColor([...this.members.values()].map((m) => m.user.color)),
    };
    const others = [...this.members.values()].map((m) => m.user);
    this.members.set(user.clientId, { user, socket });
    sendMessage(socket, {
      type: 'joined',
      roomId: this.id,
      you: user,
      revision: this.ot.revision,
      document: this.ot.document,
      language: this.language,
      users: others,
    });
    this.broadcast({ type: 'user-joined', user }, user.clientId);
    return user;
  }

  leave(clientId: string): void {
    if (!this.members.delete(clientId)) return;
    this.broadcast({ type: 'user-left', clientId });
    if (this.isEmpty) this.onEmpty?.();
  }

  handleOp(clientId: string, revision: number, ops: SerializedOperation): void {
    const member = this.members.get(clientId);
    if (!member) return;
    try {
      const op = TextOperation.fromJSON(ops);
      const transformed = this.ot.receiveOperation(revision, op);
      sendMessage(member.socket, { type: 'ack', revision: this.ot.revision });
      this.broadcast(
        { type: 'op', revision: this.ot.revision, clientId, ops: transformed.toJSON() },
        clientId,
      );
    } catch (err) {
      if (err instanceof OTError) {
        // The client has already applied this op locally, so it can't just be dropped:
        // force a reconnect so the client reloads the authoritative document.
        log.warn(`room ${this.id}: op from ${clientId} rejected (${err.code}): ${err.message}`);
        sendError(member.socket, 'RESYNC_REQUIRED', err.message, true);
      } else {
        log.error(`room ${this.id}: unexpected error handling op`, err);
        sendError(member.socket, 'RESYNC_REQUIRED', 'Could not process operation', true);
      }
    }
  }

  handleSelection(clientId: string, revision: number, selection: Selection | null): void {
    if (!this.members.has(clientId)) return;
    if (selection === null) {
      this.broadcast({ type: 'selection', clientId, selection: null }, clientId);
      return;
    }
    try {
      const transformed = this.ot.transformSelection(revision, selection);
      if (!isValidSelection(transformed, this.ot.document.length)) return;
      this.broadcast({ type: 'selection', clientId, selection: transformed }, clientId);
    } catch (err) {
      // A stale selection is harmless; the next one will correct it.
      if (!(err instanceof OTError)) log.error(`room ${this.id}: selection error`, err);
    }
  }

  handleLanguage(clientId: string, language: LanguageId): void {
    if (!this.members.has(clientId)) return;
    this.language = language;
    this.broadcast({ type: 'language', language, clientId });
  }

  broadcast(msg: ServerMessage, exceptClientId?: string): void {
    const data = encode(msg);
    for (const [id, member] of this.members) {
      if (id === exceptClientId) continue;
      if (member.socket.readyState === WebSocket.OPEN) member.socket.send(data);
    }
  }
}

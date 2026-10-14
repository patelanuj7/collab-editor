import type { LanguageId } from './languages';
import type { Selection } from './ot/selection';
import type { SerializedOperation } from './ot/TextOperation';

/**
 * Wire protocol: JSON text frames over one WebSocket at path `/ws`.
 * Every message has a `type` discriminator.
 */

export const WS_PATH = '/ws';

export interface UserInfo {
  clientId: string;
  name: string;
  color: string;
}

// ------------------------------------------------------------ client → server

export type ClientMessage =
  | { type: 'join'; roomId: string; name: string }
  /** `revision` = the server revision the op was made against. */
  | { type: 'op'; revision: number; ops: SerializedOperation }
  /** Only sent while synchronized, so the selection is in server coordinates at `revision`. */
  | { type: 'selection'; revision: number; selection: Selection | null }
  | { type: 'set-language'; language: LanguageId };

// ------------------------------------------------------------ server → client

export type ErrorCode =
  | 'BAD_MESSAGE'
  | 'NOT_JOINED'
  | 'ALREADY_JOINED'
  | 'ROOM_FULL'
  | 'INVALID_ROOM'
  | 'INVALID_NAME'
  | 'RESYNC_REQUIRED'
  | 'DOC_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'JOIN_TIMEOUT';

export type ServerMessage =
  | {
      type: 'joined';
      roomId: string;
      you: UserInfo;
      revision: number;
      document: string;
      language: LanguageId;
      /** Everyone else in the room (excludes `you`). */
      users: UserInfo[];
    }
  /** Your op was accepted; `revision` is the server revision AFTER it. */
  | { type: 'ack'; revision: number }
  /** Someone else's (already transformed) op; `revision` is the server revision AFTER it. */
  | { type: 'op'; revision: number; clientId: string; ops: SerializedOperation }
  /** Already transformed to the current server revision. */
  | { type: 'selection'; clientId: string; selection: Selection | null }
  | { type: 'user-joined'; user: UserInfo }
  | { type: 'user-left'; clientId: string }
  | { type: 'language'; language: LanguageId; clientId: string }
  | { type: 'error'; code: ErrorCode; message: string; fatal: boolean };

/** WebSocket close code used for fatal protocol errors (4000–4999 is application-defined). */
export const FATAL_CLOSE_CODE = 4000;

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

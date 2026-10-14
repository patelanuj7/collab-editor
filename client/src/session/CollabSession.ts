import type * as monaco from 'monaco-editor';
import {
  DEFAULT_LANGUAGE,
  OTClient,
  TextOperation,
  transformSelection,
  type ErrorCode,
  type LanguageId,
  type Selection,
  type ServerMessage,
  type UserInfo,
} from '@collab/shared';
import { MonacoBinding } from '../editor/MonacoBinding';
import { getWebSocketUrl } from '../lib/config';
import { CollabSocket, type SocketStatus } from './CollabSocket';

export type SessionStatus = 'connecting' | 'joining' | 'ready' | 'reconnecting' | 'error';

/** `selection` is in LOCAL document coordinates. */
export interface RemoteUser extends UserInfo {
  selection: Selection | null;
}

export interface SessionSnapshot {
  status: SessionStatus;
  me: UserInfo | null;
  users: RemoteUser[];
  language: LanguageId;
  error: { code: ErrorCode; message: string } | null;
  notice: string | null;
}

export const INITIAL_SNAPSHOT: SessionSnapshot = {
  status: 'connecting',
  me: null,
  users: [],
  language: DEFAULT_LANGUAGE,
  error: null,
  notice: null,
};

const LOST_EDITS_NOTICE = 'You were disconnected — your last few unsynced edits were discarded.';

function sameSelection(a: Selection, b: Selection): boolean {
  return (
    a.ranges.length === b.ranges.length &&
    a.ranges.every((r, i) => r.anchor === b.ranges[i]?.anchor && r.head === b.ranges[i]?.head)
  );
}

/**
 * Orchestrates one user's presence in one room: the socket, the OT client state machine,
 * the editor binding, and the presence list. React only reads `getSnapshot()`.
 */
export class CollabSession {
  private readonly roomId: string;
  private readonly name: string;
  private socket: CollabSocket;
  private otClient: OTClient | null = null;
  private binding: MonacoBinding | null = null;
  /** Server document (plus applied remote ops) held while no editor is attached yet. */
  private detachedDoc: string | null = null;
  private users = new Map<string, RemoteUser>();
  private hasJoined = false;
  /** Our selection changed while we couldn't send it (op in flight or not ready). */
  private selectionDirty = false;
  private disposed = false;
  private snapshot: SessionSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();

  constructor(roomId: string, name: string) {
    this.roomId = roomId;
    this.name = name;
    this.socket = this.createSocket();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  attachEditor(editor: monaco.editor.IStandaloneCodeEditor, monacoNs: typeof monaco): void {
    if (this.disposed) return;
    const reattaching = this.binding !== null;
    this.binding?.dispose();
    this.binding = new MonacoBinding(editor, monacoNs, {
      onLocalOperation: (op) => this.handleLocalOperation(op),
      onLocalSelection: (sel) => this.sendSelection(sel),
    });
    this.binding.setLanguage(this.snapshot.language);
    this.binding.setReadOnly(this.snapshot.status !== 'ready');

    if (!this.otClient) return; // `joined` will load the document.
    if (reattaching) {
      // The previous editor's model (holding any unsent edits) may already be gone,
      // so the only safe source of truth is a fresh `joined` from the server.
      this.resync();
      return;
    }
    this.binding.setDocument(this.detachedDoc ?? '');
    this.detachedDoc = null;
    this.sendSelection(this.binding.getSelection());
  }

  setLanguage(language: LanguageId): void {
    // The server echoes `language` to everyone, including us; the UI updates then.
    if (this.snapshot.status === 'ready') this.socket.send({ type: 'set-language', language });
  }

  dismissNotice(): void {
    if (this.snapshot.notice !== null) this.commit({ notice: null });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.socket.close();
    this.binding?.dispose();
    this.binding = null;
    this.otClient = null;
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ socket

  private createSocket(): CollabSocket {
    return new CollabSocket(getWebSocketUrl(), {
      onOpen: () => {
        this.setStatus('joining');
        this.socket.send({ type: 'join', roomId: this.roomId, name: this.name });
      },
      onMessage: (msg) => this.handleMessage(msg),
      onStatus: (s) => this.handleSocketStatus(s),
    });
  }

  private handleSocketStatus(s: SocketStatus): void {
    if (this.disposed || this.snapshot.status === 'error' || s === 'open') return;
    // 'connecting' or 'closed': either way we are waiting for a (re)connection.
    this.setStatus(this.hasJoined ? 'reconnecting' : 'connecting');
  }

  /** Throw away the connection and OT state; the next `joined` reloads the document. */
  private resync(): void {
    if (this.disposed) return;
    this.socket.close();
    this.setStatus(this.hasJoined ? 'reconnecting' : 'connecting');
    this.socket = this.createSocket();
  }

  private handleMessage(msg: ServerMessage): void {
    if (this.disposed) return;
    try {
      this.route(msg);
    } catch (err) {
      // Any inconsistency means our replica can't be trusted any more.
      console.error('[collab] resyncing after error handling', msg.type, err);
      this.resync();
    }
  }

  private route(msg: ServerMessage): void {
    switch (msg.type) {
      case 'joined':
        this.handleJoined(msg);
        return;

      case 'ack': {
        const client = this.requireClient();
        client.serverAck();
        if (client.revision !== msg.revision) {
          throw new Error(`ack revision ${msg.revision} but client is at ${client.revision}`);
        }
        if (this.selectionDirty && client.isSynchronized && this.binding) {
          this.sendSelection(this.binding.getSelection());
        }
        return;
      }

      case 'op': {
        const client = this.requireClient();
        if (msg.revision !== client.revision + 1) {
          throw new Error(`op for revision ${msg.revision} but client is at ${client.revision}`);
        }
        client.applyServer(TextOperation.fromJSON(msg.ops));
        return;
      }

      case 'selection': {
        const client = this.requireClient();
        const user = this.users.get(msg.clientId);
        if (!user) return;
        // Server coords (at our revision, since the channel is ordered) → local coords.
        const selection = msg.selection ? client.transformSelection(msg.selection) : null;
        this.users.set(msg.clientId, { ...user, selection });
        this.commitUsers();
        return;
      }

      case 'user-joined':
        if (msg.user.clientId === this.snapshot.me?.clientId) return;
        this.users.set(msg.user.clientId, { ...msg.user, selection: null });
        this.commitUsers();
        // Selections are only sent on movement, so tell the newcomer where we are now.
        if (this.binding) this.sendSelection(this.binding.getSelection());
        return;

      case 'user-left':
        if (this.users.delete(msg.clientId)) this.commitUsers();
        return;

      case 'language':
        this.binding?.setLanguage(msg.language);
        this.commit({ language: msg.language });
        return;

      case 'error':
        this.handleServerError(msg.code, msg.message, msg.fatal);
        return;
    }
  }

  private handleJoined(msg: Extract<ServerMessage, { type: 'joined' }>): void {
    const lostEdits = this.otClient?.hasPendingChanges ?? false;
    this.otClient = new OTClient(msg.revision, {
      sendOperation: (revision, op) => this.socket.send({ type: 'op', revision, ops: op.toJSON() }),
      applyOperation: (op) => this.applyRemoteOperation(op),
    });
    this.hasJoined = true;
    this.selectionDirty = false;
    this.users = new Map(msg.users.map((u) => [u.clientId, { ...u, selection: null }]));

    if (this.binding) {
      this.binding.setDocument(msg.document);
      this.binding.setLanguage(msg.language);
    } else {
      this.detachedDoc = msg.document;
    }

    this.commit({
      me: msg.you,
      users: [...this.users.values()],
      language: msg.language,
      error: null,
      notice: lostEdits ? LOST_EDITS_NOTICE : this.snapshot.notice,
    });
    this.setStatus('ready');
    if (this.binding) this.sendSelection(this.binding.getSelection());
  }

  private handleServerError(code: ErrorCode, message: string, fatal: boolean): void {
    if (fatal) {
      // RESYNC_REQUIRED: the socket closes and reconnects by itself; `joined` restores us.
      if (code === 'RESYNC_REQUIRED') return;
      this.commit({ error: { code, message } });
      this.setStatus('error');
      return;
    }
    console.warn(`[collab] server error ${code}: ${message}`);
    // The server dropped one of our messages. If it might have been our in-flight op,
    // we'd wait for its ack forever, so start over from the server's document.
    if (this.otClient?.hasPendingChanges) this.resync();
  }

  // ------------------------------------------------------------------ OT glue

  private requireClient(): OTClient {
    if (!this.otClient) throw new Error('message received before joined');
    return this.otClient;
  }

  private applyRemoteOperation(op: TextOperation): void {
    if (this.binding) {
      this.binding.applyRemote(op);
    } else if (this.detachedDoc !== null) {
      this.detachedDoc = op.apply(this.detachedDoc);
    }
    this.transformRemoteSelections(op);
  }

  private handleLocalOperation(op: TextOperation): void {
    if (this.disposed || !this.otClient) return; // Not joined: `joined` will overwrite the doc.
    try {
      this.otClient.applyClient(op);
      this.transformRemoteSelections(op);
    } catch (err) {
      console.error('[collab] resyncing after local edit error', err);
      this.resync();
    }
  }

  /** Remote cursors are kept in local coordinates, so every applied op must move them. */
  private transformRemoteSelections(op: TextOperation): void {
    let changed = false;
    for (const [id, user] of this.users) {
      if (!user.selection) continue;
      const next = transformSelection(user.selection, op);
      if (sameSelection(next, user.selection)) continue;
      this.users.set(id, { ...user, selection: next });
      changed = true;
    }
    if (changed) this.commitUsers();
  }

  private sendSelection(selection: Selection): void {
    const client = this.otClient;
    // Only while synchronized is our local document identical to the server's at
    // `client.revision`, which is what the server assumes when transforming it.
    if (!client || this.snapshot.status !== 'ready' || !client.isSynchronized) {
      this.selectionDirty = true;
      return;
    }
    this.selectionDirty = false;
    this.socket.send({ type: 'selection', revision: client.revision, selection });
  }

  // ------------------------------------------------------------------ store

  private setStatus(status: SessionStatus): void {
    this.binding?.setReadOnly(status !== 'ready');
    if (this.snapshot.status !== status) this.commit({ status });
  }

  private commitUsers(): void {
    this.commit({ users: [...this.users.values()] });
  }

  private commit(changes: Partial<SessionSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...changes };
    for (const listener of this.listeners) listener();
  }
}

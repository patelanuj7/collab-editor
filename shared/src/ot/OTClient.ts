import { OTError } from './errors';
import { transformSelection, type Selection } from './selection';
import { TextOperation } from './TextOperation';

/**
 * The client's sync state. At most ONE operation is in flight to the server at
 * any time; edits made while waiting are composed into `buffer`.
 */
export type ClientState =
  | { kind: 'synchronized' }
  | { kind: 'awaitingConfirm'; outstanding: TextOperation }
  | { kind: 'awaitingWithBuffer'; outstanding: TextOperation; buffer: TextOperation };

export interface OTClientCallbacks {
  /** Send a local operation, made against server `revision`, to the server. */
  sendOperation(revision: number, op: TextOperation): void;
  /** Apply a (transformed) server operation to the local document/editor. */
  applyOperation(op: TextOperation): void;
}

/**
 * Client half of the Jupiter / ot.js protocol.
 *
 * Invariant: the local document = server document at `revision`,
 * then `outstanding` (if any), then `buffer` (if any).
 */
export class OTClient {
  /** Last server revision this client has incorporated. */
  revision: number;
  state: ClientState;
  private readonly callbacks: OTClientCallbacks;

  constructor(revision: number, callbacks: OTClientCallbacks) {
    this.revision = revision;
    this.state = { kind: 'synchronized' };
    this.callbacks = callbacks;
  }

  get isSynchronized(): boolean {
    return this.state.kind === 'synchronized';
  }

  get hasPendingChanges(): boolean {
    return this.state.kind !== 'synchronized';
  }

  /** The user edited the local document. */
  applyClient(op: TextOperation): void {
    if (op.isNoop()) return;
    const s = this.state;
    switch (s.kind) {
      case 'synchronized':
        this.callbacks.sendOperation(this.revision, op);
        this.state = { kind: 'awaitingConfirm', outstanding: op };
        return;
      case 'awaitingConfirm':
        this.state = { kind: 'awaitingWithBuffer', outstanding: s.outstanding, buffer: op };
        return;
      case 'awaitingWithBuffer':
        this.state = { kind: 'awaitingWithBuffer', outstanding: s.outstanding, buffer: s.buffer.compose(op) };
        return;
    }
  }

  /** Another client's operation arrived from the server (in server-revision order). */
  applyServer(op: TextOperation): void {
    this.revision++;
    const s = this.state;
    switch (s.kind) {
      case 'synchronized':
        this.callbacks.applyOperation(op);
        return;
      case 'awaitingConfirm': {
        // Client op is always `a` so tie-breaking matches the server.
        const [outstanding, opPrime] = TextOperation.transform(s.outstanding, op);
        this.callbacks.applyOperation(opPrime);
        this.state = { kind: 'awaitingConfirm', outstanding };
        return;
      }
      case 'awaitingWithBuffer': {
        const [outstanding, op1] = TextOperation.transform(s.outstanding, op);
        const [buffer, op2] = TextOperation.transform(s.buffer, op1);
        this.callbacks.applyOperation(op2);
        this.state = { kind: 'awaitingWithBuffer', outstanding, buffer };
        return;
      }
    }
  }

  /** The server accepted our outstanding operation. */
  serverAck(): void {
    const s = this.state;
    switch (s.kind) {
      case 'synchronized':
        throw new OTError('INVALID_REVISION', 'Received an ack with no operation in flight');
      case 'awaitingConfirm':
        this.revision++;
        this.state = { kind: 'synchronized' };
        return;
      case 'awaitingWithBuffer':
        this.revision++;
        this.callbacks.sendOperation(this.revision, s.buffer);
        this.state = { kind: 'awaitingConfirm', outstanding: s.buffer };
        return;
    }
  }

  /**
   * Maps a selection expressed in server coordinates (at `this.revision`) into
   * local coordinates by running it through our not-yet-acknowledged edits.
   */
  transformSelection(sel: Selection): Selection {
    const s = this.state;
    switch (s.kind) {
      case 'synchronized':
        return sel;
      case 'awaitingConfirm':
        return transformSelection(sel, s.outstanding);
      case 'awaitingWithBuffer':
        return transformSelection(transformSelection(sel, s.outstanding), s.buffer);
    }
  }
}

import { MAX_DOC_LENGTH, MAX_HISTORY } from '../constants';
import { OTError } from './errors';
import { transformSelection, type Selection } from './selection';
import { TextOperation } from './TextOperation';

/**
 * Server half of the Jupiter / ot.js protocol: holds the authoritative document
 * and defines the single global order of operations (the revision number).
 */
export class OTServer {
  document: string;
  /** history[i] took the document from revision (historyOffset + i) to (historyOffset + i + 1). */
  history: TextOperation[];
  /** Revision of history[0]. Grows when old history is trimmed. */
  historyOffset: number;
  maxHistory: number;
  maxDocLength: number;

  constructor(initialDoc = '', maxHistory = MAX_HISTORY, maxDocLength = MAX_DOC_LENGTH) {
    this.document = initialDoc;
    this.history = [];
    this.historyOffset = 0;
    this.maxHistory = maxHistory;
    this.maxDocLength = maxDocLength;
  }

  get revision(): number {
    return this.historyOffset + this.history.length;
  }

  /** Operations applied after `revision`, i.e. the ones a client at `revision` hasn't seen. */
  private concurrentOps(revision: number): TextOperation[] {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > this.revision) {
      throw new OTError('INVALID_REVISION', `Revision ${revision} is outside 0..${this.revision}`);
    }
    if (revision < this.historyOffset) {
      throw new OTError(
        'STALE_REVISION',
        `Revision ${revision} is older than retained history (${this.historyOffset}); client must resync`,
      );
    }
    return this.history.slice(revision - this.historyOffset);
  }

  /**
   * Accepts an operation a client made against `revision`. Transforms it past
   * every operation the client hadn't seen yet, applies it, and returns the
   * transformed operation (which is what gets broadcast to other clients).
   */
  receiveOperation(revision: number, op: TextOperation): TextOperation {
    let transformed = op;
    for (const concurrent of this.concurrentOps(revision)) {
      // Incoming client op is always `a` (same tie-break as OTClient).
      transformed = TextOperation.transform(transformed, concurrent)[0];
    }
    if (transformed.targetLength > this.maxDocLength) {
      throw new OTError('DOC_TOO_LARGE', `Document would exceed ${this.maxDocLength} characters`);
    }
    // apply() throws LENGTH_MISMATCH if the client and server disagree on the doc.
    this.document = transformed.apply(this.document);
    this.history.push(transformed);
    if (this.history.length > this.maxHistory) {
      const drop = this.history.length - this.maxHistory;
      this.history.splice(0, drop);
      this.historyOffset += drop;
    }
    return transformed;
  }

  /** Moves a selection made at `revision` forward to the current revision. */
  transformSelection(revision: number, sel: Selection): Selection {
    let result = sel;
    for (const op of this.concurrentOps(revision)) {
      result = transformSelection(result, op);
    }
    return result;
  }
}

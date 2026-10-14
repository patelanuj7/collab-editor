import { OTError } from './errors';

/**
 * One component of an operation:
 *   > 0  retain n characters (keep them, move past them)
 *   < 0  delete -n characters
 *   string  insert this text
 */
export type OpComponent = number | string;
export type SerializedOperation = OpComponent[];

// Only isInsert is a type guard: "not an insert" really does mean "a number".
// isRetain/isDelete are plain booleans, because "not a retain" can still be a number.
export const isRetain = (c: OpComponent | undefined): boolean => typeof c === 'number' && c > 0;
export const isDelete = (c: OpComponent | undefined): boolean => typeof c === 'number' && c < 0;
export const isInsert = (c: OpComponent | undefined): c is string => typeof c === 'string';

function assertCount(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new OTError('INVALID_OPERATION', `${what} count must be a non-negative integer, got ${n}`);
  }
}

/**
 * A text operation that walks the ENTIRE base document from start to end.
 * Semantics follow ot.js (Tim Baumann, MIT): every character of the base doc is
 * either retained or deleted exactly once, and inserts are interleaved.
 *
 * Lengths are UTF-16 code units (JS `string.length`), which is also what Monaco uses.
 */
export class TextOperation {
  ops: OpComponent[];
  /** Length of the document this operation can be applied to. */
  baseLength: number;
  /** Length of the document after applying this operation. */
  targetLength: number;

  constructor() {
    this.ops = [];
    this.baseLength = 0;
    this.targetLength = 0;
  }

  // ---------------------------------------------------------------- builders
  // Builders keep the op list in canonical form (no zero-length parts, no two
  // adjacent parts of the same kind, inserts before deletes) so that two ops
  // with the same effect also have the same representation.

  retain(n: number): this {
    assertCount(n, 'retain');
    if (n === 0) return this;
    this.baseLength += n;
    this.targetLength += n;
    const last = this.ops[this.ops.length - 1];
    if (typeof last === 'number' && last > 0) this.ops[this.ops.length - 1] = last + n;
    else this.ops.push(n);
    return this;
  }

  insert(str: string): this {
    if (typeof str !== 'string') throw new OTError('INVALID_OPERATION', 'insert expects a string');
    if (str === '') return this;
    this.targetLength += str.length;
    const ops = this.ops;
    const last = ops[ops.length - 1];
    if (isInsert(last)) {
      ops[ops.length - 1] = last + str;
    } else if (typeof last === 'number' && last < 0) {
      // "insert then delete" and "delete then insert" have the same effect;
      // we always store the insert first so equal ops compare equal.
      const beforeLast = ops[ops.length - 2];
      if (isInsert(beforeLast)) {
        ops[ops.length - 2] = beforeLast + str;
      } else {
        ops[ops.length - 1] = str;
        ops.push(last);
      }
    } else {
      ops.push(str);
    }
    return this;
  }

  /** Delete `n` characters. `n` is a positive count. */
  delete(n: number): this {
    assertCount(n, 'delete');
    if (n === 0) return this;
    this.baseLength += n;
    const last = this.ops[this.ops.length - 1];
    if (typeof last === 'number' && last < 0) this.ops[this.ops.length - 1] = last - n;
    else this.ops.push(-n);
    return this;
  }

  // ---------------------------------------------------------------- queries

  /** True if applying this op changes nothing. */
  isNoop(): boolean {
    return this.ops.length === 0 || (this.ops.length === 1 && isRetain(this.ops[0]));
  }

  equals(other: TextOperation): boolean {
    if (this.baseLength !== other.baseLength || this.targetLength !== other.targetLength) return false;
    if (this.ops.length !== other.ops.length) return false;
    return this.ops.every((c, i) => c === other.ops[i]);
  }

  toString(): string {
    return this.ops
      .map((c) => (isInsert(c) ? `insert ${JSON.stringify(c)}` : c > 0 ? `retain ${c}` : `delete ${-c}`))
      .join(', ');
  }

  // ---------------------------------------------------------------- apply

  apply(doc: string): string {
    if (doc.length !== this.baseLength) {
      throw new OTError(
        'LENGTH_MISMATCH',
        `Operation base length ${this.baseLength} does not match document length ${doc.length}`,
      );
    }
    const parts: string[] = [];
    let index = 0;
    for (const c of this.ops) {
      if (isInsert(c)) {
        parts.push(c);
      } else if (c > 0) {
        parts.push(doc.slice(index, index + c));
        index += c;
      } else {
        index -= c; // c is negative: skip deleted characters
      }
    }
    return parts.join('');
  }

  // ---------------------------------------------------------------- compose

  /**
   * Returns a single operation equivalent to applying `this` and then `next`.
   * Used by the client to merge buffered local edits into one pending op.
   */
  compose(next: TextOperation): TextOperation {
    if (this.targetLength !== next.baseLength) {
      throw new OTError(
        'LENGTH_MISMATCH',
        `compose: first op target length ${this.targetLength} !== second op base length ${next.baseLength}`,
      );
    }
    const result = new TextOperation();
    const ops1 = this.ops;
    const ops2 = next.ops;
    let i1 = 0;
    let i2 = 0;
    let op1 = ops1[i1++];
    let op2 = ops2[i2++];

    for (;;) {
      if (op1 === undefined && op2 === undefined) break;

      // Deletes in the first op happen before the second op ever sees the text.
      if (typeof op1 === 'number' && op1 < 0) {
        result.delete(-op1);
        op1 = ops1[i1++];
        continue;
      }
      // Inserts in the second op don't consume anything from the first op.
      if (isInsert(op2)) {
        result.insert(op2);
        op2 = ops2[i2++];
        continue;
      }

      if (op1 === undefined) throw new OTError('INVALID_OPERATION', 'compose: first operation is too short');
      if (op2 === undefined) throw new OTError('INVALID_OPERATION', 'compose: first operation is too long');

      // From here on op1 is a retain or an insert, and op2 is a retain or a delete.
      if (typeof op1 === 'number' && op2 > 0) {
        if (op1 > op2) {
          result.retain(op2);
          op1 -= op2;
          op2 = ops2[i2++];
        } else if (op1 === op2) {
          result.retain(op1);
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          result.retain(op1);
          op2 -= op1;
          op1 = ops1[i1++];
        }
      } else if (isInsert(op1) && op2 < 0) {
        // Text inserted by the first op and deleted by the second cancels out.
        if (op1.length > -op2) {
          op1 = op1.slice(-op2);
          op2 = ops2[i2++];
        } else if (op1.length === -op2) {
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          op2 += op1.length;
          op1 = ops1[i1++];
        }
      } else if (isInsert(op1)) {
        if (op1.length > op2) {
          result.insert(op1.slice(0, op2));
          op1 = op1.slice(op2);
          op2 = ops2[i2++];
        } else if (op1.length === op2) {
          result.insert(op1);
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          result.insert(op1);
          op2 -= op1.length;
          op1 = ops1[i1++];
        }
      } else {
        // retain in op1, delete in op2
        if (op1 > -op2) {
          result.delete(-op2);
          op1 += op2;
          op2 = ops2[i2++];
        } else if (op1 === -op2) {
          result.delete(-op2);
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          result.delete(op1);
          op2 += op1;
          op1 = ops1[i1++];
        }
      }
    }
    return result;
  }

  // ---------------------------------------------------------------- transform

  /**
   * Given two operations `a` and `b` made concurrently on the same document,
   * returns `[a', b']` such that applying `a` then `b'` gives the same result as
   * applying `b` then `a'` (convergence property TP1).
   *
   * Tie-break: if both insert at the same position, `a`'s text ends up first.
   * Callers must always pass the CLIENT's op as `a` and the SERVER's op as `b`
   * (on both the client and the server) so every replica breaks ties the same way.
   */
  static transform(a: TextOperation, b: TextOperation): [TextOperation, TextOperation] {
    if (a.baseLength !== b.baseLength) {
      throw new OTError(
        'LENGTH_MISMATCH',
        `transform: base lengths differ (${a.baseLength} vs ${b.baseLength})`,
      );
    }
    const aPrime = new TextOperation();
    const bPrime = new TextOperation();
    const ops1 = a.ops;
    const ops2 = b.ops;
    let i1 = 0;
    let i2 = 0;
    let op1 = ops1[i1++];
    let op2 = ops2[i2++];

    for (;;) {
      if (op1 === undefined && op2 === undefined) break;

      // Inserts go first. Checking `a` before `b` is what makes `a` win ties.
      if (isInsert(op1)) {
        aPrime.insert(op1);
        bPrime.retain(op1.length);
        op1 = ops1[i1++];
        continue;
      }
      if (isInsert(op2)) {
        aPrime.retain(op2.length);
        bPrime.insert(op2);
        op2 = ops2[i2++];
        continue;
      }

      if (op1 === undefined) throw new OTError('INVALID_OPERATION', 'transform: first operation is too short');
      if (op2 === undefined) throw new OTError('INVALID_OPERATION', 'transform: first operation is too long');

      // From here on both are numbers: retains (> 0) or deletes (< 0).
      let min: number;
      if (op1 > 0 && op2 > 0) {
        // Both keep this text: both keep it.
        if (op1 > op2) {
          min = op2;
          op1 -= op2;
          op2 = ops2[i2++];
        } else if (op1 === op2) {
          min = op2;
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          min = op1;
          op2 -= op1;
          op1 = ops1[i1++];
        }
        aPrime.retain(min);
        bPrime.retain(min);
      } else if (op1 < 0 && op2 < 0) {
        // Both deleted the same text: nothing left for either transformed op to do.
        if (-op1 > -op2) {
          op1 -= op2;
          op2 = ops2[i2++];
        } else if (op1 === op2) {
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          op2 -= op1;
          op1 = ops1[i1++];
        }
      } else if (op1 < 0) {
        // a deletes text b kept: a' still deletes it.
        if (-op1 > op2) {
          min = op2;
          op1 += op2;
          op2 = ops2[i2++];
        } else if (-op1 === op2) {
          min = op2;
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          min = -op1;
          op2 += op1;
          op1 = ops1[i1++];
        }
        aPrime.delete(min);
      } else {
        // b deletes text a kept: b' still deletes it.
        if (op1 > -op2) {
          min = -op2;
          op1 += op2;
          op2 = ops2[i2++];
        } else if (op1 === -op2) {
          min = op1;
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        } else {
          min = op1;
          op2 += op1;
          op1 = ops1[i1++];
        }
        bPrime.delete(min);
      }
    }
    return [aPrime, bPrime];
  }

  // ---------------------------------------------------------------- serialization

  toJSON(): SerializedOperation {
    return this.ops.slice();
  }

  /** Parses untrusted input (e.g. from the network). Throws OTError('INVALID_OPERATION'). */
  static fromJSON(data: unknown): TextOperation {
    if (!Array.isArray(data)) throw new OTError('INVALID_OPERATION', 'operation must be an array');
    const op = new TextOperation();
    for (const c of data as unknown[]) {
      if (typeof c === 'string') {
        if (c === '') throw new OTError('INVALID_OPERATION', 'empty insert');
        op.insert(c);
      } else if (typeof c === 'number' && Number.isSafeInteger(c) && c !== 0) {
        if (c > 0) op.retain(c);
        else op.delete(-c);
      } else {
        throw new OTError('INVALID_OPERATION', `invalid component: ${JSON.stringify(c)}`);
      }
    }
    return op;
  }
}

import { TextOperation, isInsert } from '@collab/shared';

/** The subset of Monaco's IModelContentChange that we need. */
export interface ContentChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

export interface OffsetEdit {
  offset: number;
  length: number;
  text: string;
}

/** All ranges refer to the document BEFORE the event and do not overlap. */
export function changesToOperation(changes: readonly ContentChange[], docLengthBefore: number): TextOperation {
  // Monaco reports multi-cursor changes from the end of the document backwards;
  // a TextOperation must walk the document front to back.
  const sorted = [...changes].sort((a, b) => a.rangeOffset - b.rangeOffset);
  const op = new TextOperation();
  let pos = 0;
  for (const change of sorted) {
    op.retain(change.rangeOffset - pos);
    op.delete(change.rangeLength);
    op.insert(change.text);
    pos = change.rangeOffset + change.rangeLength;
  }
  op.retain(docLengthBefore - pos);
  return op;
}

/** Returns edits whose offsets all refer to the document BEFORE the op (Monaco applyEdits semantics). */
export function operationToEdits(op: TextOperation): OffsetEdit[] {
  const edits: OffsetEdit[] = [];
  let pos = 0;
  for (const c of op.ops) {
    if (isInsert(c)) {
      edits.push({ offset: pos, length: 0, text: c });
    } else if (c > 0) {
      pos += c;
    } else {
      const last = edits[edits.length - 1];
      // Canonical form stores "insert, delete" at the same spot; merge them into one
      // replace so Monaco never sees two edits touching the same offset.
      if (last && last.offset === pos && last.length === 0) {
        last.length = -c;
      } else {
        edits.push({ offset: pos, length: -c, text: '' });
      }
      pos -= c;
    }
  }
  return edits;
}

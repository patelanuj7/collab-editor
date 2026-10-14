import { TextOperation, isInsert } from './TextOperation';

/** A cursor (anchor === head) or a selected range, as character offsets into the document. */
export interface SelectionRange {
  anchor: number;
  head: number;
}

/** All of one user's cursors/selections. `ranges[0]` is the primary cursor. */
export interface Selection {
  ranges: SelectionRange[];
}

export const MAX_SELECTION_RANGES = 32;

/**
 * Moves a document offset through `op`.
 * Text inserted exactly at the offset pushes the offset to the right
 * (so another user's caret stays after text typed right in front of it).
 */
export function transformIndex(index: number, op: TextOperation): number {
  // `remaining` counts how far into the BASE doc we still have to walk to reach the offset.
  let remaining = Math.max(0, Math.min(index, op.baseLength));
  let newIndex = remaining;
  for (const c of op.ops) {
    if (isInsert(c)) {
      newIndex += c.length;
    } else if (c > 0) {
      remaining -= c;
    } else {
      // Deleted text before the offset shifts it left; deletion spanning the
      // offset collapses it to the start of the deleted range.
      newIndex -= Math.min(remaining, -c);
      remaining += c;
    }
    if (remaining < 0) break;
  }
  return newIndex;
}

export function transformSelection(sel: Selection, op: TextOperation): Selection {
  return {
    ranges: sel.ranges.map((r) => ({
      anchor: transformIndex(r.anchor, op),
      head: transformIndex(r.head, op),
    })),
  };
}

function isOffset(v: unknown, docLength: number): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= docLength;
}

/** Validates untrusted selection data against a document length. */
export function isValidSelection(sel: unknown, docLength: number): sel is Selection {
  if (typeof sel !== 'object' || sel === null) return false;
  const ranges = (sel as { ranges?: unknown }).ranges;
  if (!Array.isArray(ranges) || ranges.length === 0 || ranges.length > MAX_SELECTION_RANGES) return false;
  return ranges.every((r: unknown) => {
    if (typeof r !== 'object' || r === null) return false;
    const { anchor, head } = r as { anchor?: unknown; head?: unknown };
    return isOffset(anchor, docLength) && isOffset(head, docLength);
  });
}

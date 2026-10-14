import { describe, expect, it } from 'vitest';
import { isValidSelection, transformIndex, transformSelection } from '../src/ot/selection';
import { TextOperation } from '../src/ot/TextOperation';

const op = () => new TextOperation();

describe('transformIndex', () => {
  // doc: "hello world" (11 chars), cursor at 6 (before "w")
  it('shifts right for an insert before the cursor', () => {
    expect(transformIndex(6, op().insert('>> ').retain(11))).toBe(9);
  });

  it('shifts right for an insert exactly at the cursor', () => {
    expect(transformIndex(6, op().retain(6).insert('big ').retain(5))).toBe(10);
  });

  it('does not move for an insert after the cursor', () => {
    expect(transformIndex(6, op().retain(8).insert('!').retain(3))).toBe(6);
  });

  it('shifts left for a delete before the cursor', () => {
    expect(transformIndex(6, op().delete(6).retain(5))).toBe(0);
    expect(transformIndex(6, op().retain(1).delete(2).retain(8))).toBe(4);
  });

  it('collapses to the start of a delete that spans the cursor', () => {
    expect(transformIndex(6, op().retain(4).delete(4).retain(3))).toBe(4);
  });

  it('does not move for a delete after the cursor', () => {
    expect(transformIndex(6, op().retain(7).delete(4))).toBe(6);
  });

  it('handles cursor at the very end', () => {
    expect(transformIndex(11, op().retain(11).insert('!'))).toBe(12);
    expect(transformIndex(11, op().retain(5).delete(6))).toBe(5);
  });
});

describe('transformSelection', () => {
  it('transforms every range', () => {
    const sel = { ranges: [{ anchor: 0, head: 5 }, { anchor: 8, head: 8 }] };
    const o = op().insert('ab').retain(11);
    expect(transformSelection(sel, o)).toEqual({ ranges: [{ anchor: 2, head: 7 }, { anchor: 10, head: 10 }] });
  });
});

describe('isValidSelection', () => {
  it('accepts in-bounds selections', () => {
    expect(isValidSelection({ ranges: [{ anchor: 0, head: 3 }] }, 3)).toBe(true);
  });

  it('rejects bad shapes and out-of-bounds offsets', () => {
    expect(isValidSelection(null, 3)).toBe(false);
    expect(isValidSelection({ ranges: [] }, 3)).toBe(false);
    expect(isValidSelection({ ranges: [{ anchor: 0, head: 4 }] }, 3)).toBe(false);
    expect(isValidSelection({ ranges: [{ anchor: -1, head: 0 }] }, 3)).toBe(false);
    expect(isValidSelection({ ranges: [{ anchor: '0', head: 0 }] }, 3)).toBe(false);
    const tooMany = { ranges: Array.from({ length: 33 }, () => ({ anchor: 0, head: 0 })) };
    expect(isValidSelection(tooMany, 3)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { OTError } from '../src/ot/errors';
import { TextOperation } from '../src/ot/TextOperation';
import { mulberry32, randomOperation, randomString } from './helpers';

const op = () => new TextOperation();

describe('TextOperation builders', () => {
  it('tracks base and target lengths', () => {
    const o = op().retain(5).insert('abc').delete(2).retain(1);
    expect(o.baseLength).toBe(8);
    expect(o.targetLength).toBe(9);
  });

  it('merges adjacent components of the same kind', () => {
    expect(op().retain(2).retain(3).ops).toEqual([5]);
    expect(op().insert('ab').insert('cd').ops).toEqual(['abcd']);
    expect(op().delete(1).delete(2).ops).toEqual([-3]);
  });

  it('ignores zero-length components', () => {
    expect(op().retain(0).insert('').delete(0).ops).toEqual([]);
  });

  it('stores inserts before deletes (canonical form)', () => {
    expect(op().delete(2).insert('x').ops).toEqual(['x', -2]);
    expect(op().insert('a').delete(2).insert('b').ops).toEqual(['ab', -2]);
  });

  it('rejects negative or fractional counts', () => {
    expect(() => op().retain(-1)).toThrow(OTError);
    expect(() => op().delete(1.5)).toThrow(OTError);
  });

  it('detects no-ops and equality', () => {
    expect(op().isNoop()).toBe(true);
    expect(op().retain(4).isNoop()).toBe(true);
    expect(op().retain(4).insert('a').isNoop()).toBe(false);
    expect(op().retain(1).insert('a').equals(op().retain(1).insert('a'))).toBe(true);
    expect(op().retain(1).insert('a').equals(op().retain(1).insert('b'))).toBe(false);
  });
});

describe('apply', () => {
  it('applies retains, inserts and deletes', () => {
    expect(op().retain(6).insert('big ').retain(5).apply('hello world')).toBe('hello big world');
    expect(op().delete(6).retain(5).apply('hello world')).toBe('world');
    expect(op().insert('// ').retain(3).apply('abc')).toBe('// abc');
  });

  it('handles surrogate pairs as two UTF-16 units', () => {
    expect(op().retain(2).insert('!').apply('😀')).toBe('😀!');
  });

  it('throws LENGTH_MISMATCH on the wrong document', () => {
    try {
      op().retain(3).apply('ab');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(OTError);
      expect((e as OTError).code).toBe('LENGTH_MISMATCH');
    }
  });
});

describe('JSON', () => {
  it('round-trips', () => {
    const o = op().retain(3).insert('hi').delete(4).retain(1);
    const back = TextOperation.fromJSON(JSON.parse(JSON.stringify(o)));
    expect(back.equals(o)).toBe(true);
  });

  it('rejects malformed input', () => {
    for (const bad of [null, 'x', {}, [0], [''], [1.5], [true], [Number.NaN], [[1]]]) {
      expect(() => TextOperation.fromJSON(bad)).toThrow(OTError);
    }
  });
});

describe('compose', () => {
  it('composes a simple pair', () => {
    const a = op().retain(5).insert(' there');
    const b = op().retain(11).insert('!');
    expect(a.compose(b).apply('hello')).toBe('hello there!');
  });

  it('cancels text inserted then deleted', () => {
    const a = op().insert('abc');
    const b = op().delete(3);
    expect(a.compose(b).isNoop()).toBe(true);
  });

  it('requires matching lengths', () => {
    expect(() => op().retain(2).compose(op().retain(3))).toThrow(OTError);
  });

  it('b(a(S)) === (a∘b)(S) for random ops', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const rng = mulberry32(seed);
      const s = randomString(rng, 40);
      const a = randomOperation(s, rng);
      const afterA = a.apply(s);
      const b = randomOperation(afterA, rng);
      const ab = a.compose(b);
      expect(ab.apply(s), `seed ${seed}`).toBe(b.apply(afterA));
    }
  });
});

describe('transform', () => {
  it('satisfies TP1 for random concurrent ops', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const rng = mulberry32(seed);
      const s = randomString(rng, 40);
      const a = randomOperation(s, rng);
      const b = randomOperation(s, rng);
      const [aPrime, bPrime] = TextOperation.transform(a, b);
      expect(bPrime.apply(a.apply(s)), `seed ${seed}`).toBe(aPrime.apply(b.apply(s)));
    }
  });

  it("puts a's insert first when both insert at the same position", () => {
    const a = op().retain(2).insert('A').retain(1);
    const b = op().retain(2).insert('B').retain(1);
    const [aPrime, bPrime] = TextOperation.transform(a, b);
    expect(bPrime.apply(a.apply('xyz'))).toBe('xyABz');
    expect(aPrime.apply(b.apply('xyz'))).toBe('xyABz');
  });

  it('handles overlapping deletes', () => {
    const s = 'abcdefgh';
    const a = op().retain(1).delete(4).retain(3); // removes bcde
    const b = op().retain(3).delete(4).retain(1); // removes defg
    const [aPrime, bPrime] = TextOperation.transform(a, b);
    expect(bPrime.apply(a.apply(s))).toBe('ah');
    expect(aPrime.apply(b.apply(s))).toBe('ah');
  });

  it('requires equal base lengths', () => {
    expect(() => TextOperation.transform(op().retain(1), op().retain(2))).toThrow(OTError);
  });
});

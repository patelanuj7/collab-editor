import { TextOperation } from '../src/ot/TextOperation';

export type Rng = () => number;

/** Small seeded PRNG so every failing case can be reproduced from its seed. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (rng: Rng, maxExclusive: number): number => Math.floor(rng() * maxExclusive);

const ALPHABET = ['a', 'b', 'c', 'x', 'y', 'z', ' ', '\n', '{', '}', '😀'];

/** Random text including newlines and a surrogate pair (2 UTF-16 units). */
export function randomString(rng: Rng, maxLen: number): string {
  const len = randInt(rng, maxLen + 1);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[randInt(rng, ALPHABET.length)];
  return s;
}

/** A random valid operation whose baseLength === doc.length. */
export function randomOperation(doc: string, rng: Rng): TextOperation {
  const op = new TextOperation();
  let left = doc.length;
  while (left > 0) {
    const chunk = 1 + randInt(rng, Math.min(left, 20));
    const r = rng();
    if (r < 0.2) {
      op.insert(randomString(rng, 8));
    } else if (r < 0.4) {
      op.delete(chunk);
      left -= chunk;
    } else {
      op.retain(chunk);
      left -= chunk;
    }
  }
  if (rng() < 0.3) op.insert(randomString(rng, 8));
  return op;
}

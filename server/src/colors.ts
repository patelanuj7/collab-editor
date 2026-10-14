import { USER_COLORS } from '@collab/shared';

/** Returns the palette color used by the fewest current members (first one wins ties). */
export function pickColor(inUse: Iterable<string>): string {
  const counts = new Map<string, number>(USER_COLORS.map((c) => [c, 0]));
  for (const c of inUse) {
    if (counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: string = USER_COLORS[0];
  let bestCount = Infinity;
  for (const color of USER_COLORS) {
    const n = counts.get(color) ?? 0;
    if (n < bestCount) {
      best = color;
      bestCount = n;
    }
  }
  return best;
}

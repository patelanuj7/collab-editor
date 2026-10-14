import { NAME_REGEX } from '@collab/shared';

const KEY = 'collab.name';

export function getStoredName(): string | null {
  try {
    const name = window.localStorage.getItem(KEY);
    // A hand-edited value that the server would reject is treated as "no name yet".
    return name !== null && NAME_REGEX.test(name) ? name : null;
  } catch {
    return null;
  }
}

export function setStoredName(name: string): void {
  try {
    window.localStorage.setItem(KEY, name);
  } catch {
    // Storage blocked (private mode, policy): the name just isn't remembered across visits.
  }
}

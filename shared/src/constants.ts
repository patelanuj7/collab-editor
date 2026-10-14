/** Room ids appear in URLs (/r/:roomId). nanoid(10) output always matches. */
export const ROOM_ID_REGEX = /^[A-Za-z0-9_-]{6,32}$/;
/** Display names: letters (any language), digits, space, dot, underscore, hyphen. */
export const NAME_REGEX = /^[\p{L}\p{N} ._-]{1,24}$/u;
export const ROOM_ID_LENGTH = 10;
export const MAX_DOC_LENGTH = 500_000;
export const MAX_USERS_PER_ROOM = 20;
export const MAX_HISTORY = 5_000;
export const USER_COLORS = [
  '#f87171',
  '#fb923c',
  '#facc15',
  '#4ade80',
  '#2dd4bf',
  '#60a5fa',
  '#a78bfa',
  '#f472b6',
  '#94a3b8',
  '#e879f9',
] as const;

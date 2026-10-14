import { WS_PATH } from '@collab/shared';

/** VITE_WS_URL overrides; otherwise the socket lives on the same host as the page (Vite proxies /ws in dev). */
export function getWebSocketUrl(): string {
  const fromEnv: unknown = import.meta.env.VITE_WS_URL;
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}${WS_PATH}`;
}

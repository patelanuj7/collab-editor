import { fileURLToPath } from 'node:url';

export const config = {
  port: Number(process.env.PORT ?? 8080),
  isProd: process.env.NODE_ENV === 'production',
  // fileURLToPath (not URL.pathname) so Windows drive-letter paths come out right.
  clientDist: fileURLToPath(new URL('../../client/dist', import.meta.url)),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(','),
  roomIdleTtlMs: 10 * 60_000,
  heartbeatMs: 30_000,
  joinTimeoutMs: 5_000,
  maxMessagesPerSecond: 60,
};

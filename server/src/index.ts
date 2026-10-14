// Placeholder so `npm run dev` and `npm run typecheck` work before Phase 3.
// Phase 3 (see architecture.md §7) replaces this file with the real server.
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 8080);

createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  res.writeHead(404).end();
}).listen(port, () => {
  console.log(`[server] placeholder listening on http://localhost:${port} (GET /health)`);
});

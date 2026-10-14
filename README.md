# Collab Editor

A browser-based collaborative code editor. Several people open the same room link and edit one document
at the same time, seeing each other's cursors and selections live. Edits made at the same moment are
reconciled with operational transformation (OT), using a central server that decides the order of
changes, so everyone always ends up with exactly the same text.

<!-- TODO: replace with a screenshot or GIF of two windows editing the same room -->
> 📸 *Screenshot / GIF placeholder — add `docs/demo.gif` and link it here.*

## Features

- **Rooms by link** — create a room, share the URL (`/r/<id>`), anyone with it can join.
- **Real-time editing** — concurrent typing in the same place converges without conflicts or lost text.
- **Monaco Editor** — the editor from VS Code, with syntax highlighting for 14 languages plus plain text.
- **Shared language setting** — switching the language changes it for everyone in the room.
- **Live cursors and selections** — each person gets a color, a caret, a highlight and a name label.
- **Presence** — a people list and a connection status indicator.
- **Tested core** — the OT logic is plain TypeScript with unit tests and a randomized multi-client
  convergence simulation.

## Tech stack

| Area | Choice |
|---|---|
| Monorepo | npm workspaces: `shared`, `server`, `client` |
| Language | TypeScript (strict) everywhere |
| Client | React, Vite, React Router, Monaco Editor (`@monaco-editor/react`) |
| Server | Node.js, `ws`, `zod`, `nanoid`, `sirv`, run with `tsx` |
| Shared | Plain TypeScript, no runtime dependencies (the OT core and the wire protocol) |
| Tests | Vitest |

## How it works

### Operations

Instead of sending "the whole document" on every keystroke, the editor sends small **operations**. An
operation describes how to turn one version of the document into the next by walking it from start to
end and, for each stretch, doing one of three things: **retain** it (keep those characters),
**insert** some new text, or **delete** some characters. Typing `x` at position 5 of a 20-character
document is "retain 5, insert `x`, retain 15".

### Transform

The trouble starts when two people edit at once. Alice and Bob both start from the same text. Alice
inserts at the start; Bob deletes a word near the end. Each applies their own change locally and sends
it over. If Bob's operation were simply applied after Alice's, it would point at the wrong characters,
because Alice's insert shifted everything to the right.

**Transform** fixes this. Given two operations made against the same document, it produces adjusted
versions of both, such that applying "mine, then the other's adjusted one" gives the same text as
"theirs, then my adjusted one". Everyone can apply the changes in a different order and still arrive at
the same document. When two people insert at the exact same spot, a fixed rule (the client's insert
goes first) breaks the tie, so every replica breaks it the same way.

### The server decides the order

Transform alone is tricky with many peers, so this project uses a central server, as in Google Docs and
the classic Jupiter system. The server keeps the one authoritative document and a numbered history of
every operation it accepted. When an operation arrives, it says which revision it was based on; the
server transforms it against everything accepted since then, applies it, gives it the next revision
number, and broadcasts the result. That makes the server the **single source of ordering**: there is
only ever one sequence of changes, and every client eventually applies exactly that sequence.

### The client's three states

Each client keeps at most **one** operation in flight to the server, which keeps the logic small:

1. **Synchronized** — nothing is waiting. A local edit is sent immediately and the client moves to
   state 2. An incoming remote operation is applied directly.
2. **Awaiting confirm** — one operation is sent and not yet acknowledged. Further local edits are held
   back and merged together into a single *buffer*, moving to state 3. An incoming remote operation is
   transformed against the in-flight operation, so it applies correctly to the local text, and the
   in-flight operation is adjusted to match.
3. **Awaiting with buffer** — one operation in flight plus a buffer of newer local edits. Remote
   operations are transformed against both. When the server acknowledges the in-flight operation, the
   buffer is sent as the next (and only) in-flight operation, returning to state 2.

When the server's acknowledgement arrives and there is no buffer, the client is back to synchronized.
Remote cursors are moved through the same operations, so a collaborator's caret stays on the same
characters while text changes around it.

### Where to look

- `shared/src/ot/TextOperation.ts` — operations, apply, compose, transform
- `shared/src/ot/OTClient.ts` — the three-state client
- `shared/src/ot/OTServer.ts` — the authoritative document and history
- `client/src/session/CollabSession.ts` — glues the socket, OT client, editor and presence together
- `server/src/Room.ts` — one room: members, ordering, broadcast

## Running locally

You need **Node.js 22.12 or newer**.

**macOS / Linux**

```bash
npm install
npm run dev
```

**Windows (PowerShell or Command Prompt)**

```powershell
npm install
npm run dev
```

`npm run dev` starts the server on http://localhost:8080 and the client on http://localhost:5173. Open
http://localhost:5173, create a room, then open the same room URL in a second window (a private window
gives you a separate name).

Use `localhost` rather than `127.0.0.1`: the server only accepts browser connections from
`http://localhost:5173` unless you set `ALLOWED_ORIGINS`.

### Production build

```bash
npm run build
npm start
```

`npm run build` builds the client; `npm start` runs the server, which serves the built client and the
WebSocket on the same port when `NODE_ENV=production`. Set it as follows:

| Shell | Command |
|---|---|
| macOS / Linux | `NODE_ENV=production npm start` |
| PowerShell | `$env:NODE_ENV = "production"; npm start` |
| Command Prompt | `set NODE_ENV=production && npm start` |

Configuration: `PORT` (default `8080`), `ALLOWED_ORIGINS` (comma-separated, default
`http://localhost:5173`), `NODE_ENV`. The Monaco editor itself is loaded from a CDN at runtime, so the
browser needs internet access.

## Tests

```bash
npm test          # OT core: unit, property and randomized convergence tests
npm run typecheck # all workspaces
```

## Known limitations

- **Rooms are in memory.** There is no database. Rooms disappear when the server restarts, and an empty
  room is deleted after 10 minutes. On free hosting that sleeps, rooms reset whenever it wakes.
- **Unsynced edits are discarded on reconnect.** If the connection drops, anything typed but not yet
  acknowledged is lost when the client reconnects and reloads the room's document. A notice tells you
  when this happens.
- **Undo is local only.** Undo/redo is Monaco's own: it reverts your own recent edits in your editor,
  and is not aware of other people's changes.
- **No accounts or permissions.** Anyone with a room link can join and edit, up to 20 people per room.
- **Single server instance.** Rooms live in one process, so the server can't be scaled horizontally.

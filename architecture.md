# architecture.md — Real-Time Collaborative Code Editor

> **For the AI agent reading this file:** this document is the single source of truth.
> Implement only the phase you are asked for (see §13). Do not add libraries that are not
> listed in §2. Do not rename files or change the file tree in §3 without being told to.
> When a section gives a type signature, match it exactly. After every phase, run
> `npm run typecheck` and `npm test` from the repo root and fix all errors before stopping.
>
> **Current status:** Phases 1 and 2 are DONE. Everything in `shared/` (the OT core, protocol,
> constants, languages) is implemented and covered by 35 passing tests, including a randomized
> multi-client convergence simulation. **Do not modify `shared/src/ot/*`** unless explicitly asked;
> import from `@collab/shared` instead. `server/src/index.ts` is a placeholder that Phase 3 replaces.
> The developer works on **Windows** (see §0).

---

## 0. Environment notes (Windows)

- Node.js **22.12 or newer** is required (Vite 8 and Vitest 5 refuse older versions). `.nvmrc` says `22`.
- Cursor's built-in terminal on Windows is PowerShell. All npm scripts in this repo are written to work
  in PowerShell and Command Prompt. When giving the developer commands, give PowerShell syntax:
  one command per line (Windows PowerShell 5.1 has no `&&`), no `rm -rf` (use `Remove-Item -Recurse -Force`),
  no `export VAR=` (use `$env:VAR = "value"`), no `mkdir -p` (PowerShell's `mkdir` already creates parents).
- `.gitattributes` forces LF line endings in the repo. Monaco is also forced to LF (§8.7), so a Windows user
  and a Mac user never disagree about document length because of `\r\n`.
- Paths in server code must use `node:path` / `fileURLToPath`, never hand-built `/` strings.

---

## 1. Overview

A browser-based collaborative code editor. Several people open the same room URL and edit
one document at the same time. Every user sees everyone else's cursor and selection live.
Concurrent edits are reconciled with **operational transformation (OT)** using a central
server that defines the canonical order of operations (the Jupiter / ot.js model).

### Goals (v1)
- Rooms identified by a short URL-safe ID (`/r/:roomId`), created from the home page, shareable by link.
- Monaco Editor with syntax highlighting for 14 languages (+ plain text); the language is a room-wide setting.
- Real-time text sync via WebSockets with OT (insert/delete/retain operations).
- Live remote cursors and selections, colored per user, with a name label.
- Presence list (who is in the room) and a connection status indicator.
- Pure, framework-free OT core with unit tests and a randomized convergence simulation.

### Non-goals (v1)
- Persistence (rooms live in server memory; deleted after being empty for 10 minutes).
- Authentication / accounts.
- OT-aware undo (undo is Monaco's local undo; see §15).
- Offline editing / lossless reconnect (unsynced edits are discarded on reconnect; see §8.7).

---

## 2. Tech stack (do not add anything else)

| Area | Choice |
|---|---|
| Monorepo | npm workspaces: `shared`, `server`, `client` |
| Language | TypeScript (strict) everywhere |
| Client | React + Vite (`react-ts` template), `react-router-dom`, `@monaco-editor/react`, `monaco-editor` (types), `nanoid` |
| Server | Node.js (`node:http`), `ws`, `zod`, `nanoid`, `sirv` (serves the built client in production), run with `tsx` |
| Shared | Plain TypeScript, no runtime dependencies |
| Tests | `vitest` 5 (in `shared`) |
| TypeScript | `~6.0` everywhere (matches the Vite template; do not upgrade to 7) |
| Lint | `oxlint` (came with the Vite template, client only) |
| Dev runner | `concurrently` at the root |
| Styling | Plain CSS (`client/src/styles/*.css`), dark theme, no CSS framework |

### Cross-cutting TypeScript rules
The Vite template enables `erasableSyntaxOnly` and `verbatimModuleSyntax`, and the client
type-checks `shared` source files it imports. Therefore, in **all** packages:
- No `enum` — use string-literal unions and `as const` objects.
- No constructor parameter properties (`constructor(private x: number)`) — declare fields explicitly.
- No `namespace`.
- Use `import type { ... }` for type-only imports.
- Relative imports are extensionless (`./TextOperation`), resolved with `moduleResolution: "Bundler"`.
- Strings are measured in UTF-16 code units (`string.length`). Monaco offsets are also UTF-16, so they agree. Do not "fix" this.

---

## 3. File tree

```
collab-editor/
├── package.json                 # root: private, workspaces, dev/test/typecheck/build/start scripts
├── architecture.md              # this file
├── README.md                    # written in Phase 6
├── .gitignore
├── .gitattributes               # LF line endings on every OS
├── .nvmrc                       # Node 22
│
├── shared/                      # pure TS, imported by both client and server
│   ├── package.json             # name "@collab/shared", exports ./src/index.ts
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts             # re-exports everything public
│   │   ├── ot/
│   │   │   ├── TextOperation.ts # retain/insert/delete, apply, compose, transform
│   │   │   ├── selection.ts     # Selection types, transformIndex, transformSelection
│   │   │   ├── OTClient.ts      # client state machine (Synchronized / AwaitingConfirm / AwaitingWithBuffer)
│   │   │   ├── OTServer.ts      # authoritative doc + history, receiveOperation
│   │   │   └── errors.ts        # OTError with codes
│   │   ├── protocol.ts          # ClientMessage / ServerMessage unions, UserInfo, ErrorCode
│   │   ├── languages.ts         # LANGUAGES list + LanguageId type
│   │   └── constants.ts         # limits, room-id regex, name regex, palette
│   └── test/
│       ├── helpers.ts           # seeded RNG (mulberry32), randomOperation(doc, rng)
│       ├── TextOperation.test.ts
│       ├── selection.test.ts
│       └── simulation.test.ts   # N clients + server with random message delivery → convergence
│
├── server/
│   ├── package.json             # name "@collab/server"
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             # http server, /health, static client (prod), WebSocketServer on /ws, heartbeat
│       ├── config.ts            # env-driven config
│       ├── schemas.ts           # zod schemas for every ClientMessage
│       ├── RoomManager.ts       # Map<roomId, Room>, create, idle cleanup
│       ├── Room.ts              # one room: OTServer, language, connected clients, broadcast
│       ├── connection.ts        # per-socket lifecycle: join handshake, parse, validate, route
│       ├── colors.ts            # assign least-used palette color
│       └── log.ts               # tiny timestamped logger
│
└── client/                      # created by `npm create vite@latest client -- --template react-ts`
    ├── package.json             # name "@collab/client"
    ├── index.html
    ├── vite.config.ts           # dev proxy /ws → ws://localhost:8080
    └── src/
        ├── main.tsx             # router setup
        ├── App.tsx              # routes
        ├── pages/
        │   ├── HomePage.tsx     # create room / join by code
        │   └── RoomPage.tsx     # name gate + editor layout
        ├── session/
        │   ├── CollabSocket.ts  # WebSocket wrapper with reconnect + typed messages
        │   └── CollabSession.ts # orchestrates socket + OTClient + MonacoBinding + presence; observable store
        ├── editor/
        │   ├── opConversion.ts  # Monaco changes ⇄ TextOperation (pure functions)
        │   ├── MonacoBinding.ts # binds a Monaco model/editor to a session
        │   └── RemoteCursors.ts # decorations + per-user CSS injection
        ├── hooks/
        │   └── useCollabSession.ts
        ├── components/
        │   ├── EditorPane.tsx
        │   ├── Toolbar.tsx
        │   ├── LanguageSelect.tsx
        │   ├── ShareButton.tsx
        │   ├── ConnectionStatus.tsx
        │   ├── UserList.tsx
        │   ├── NameDialog.tsx
        │   └── Toast.tsx
        ├── lib/
        │   ├── identity.ts      # display name in localStorage (try/catch)
        │   └── config.ts        # WebSocket URL resolution
        └── styles/
            ├── index.css        # tokens, layout, dark theme
            └── editor.css       # remote cursor base styles
```

Delete the Vite template's `App.css`, `assets/react.svg`, and demo counter code in Phase 4.

---

## 4. Config files (already in the repo — do not rewrite)

- `shared/tsconfig.json`, `server/tsconfig.json`: strict, `noUncheckedIndexedAccess`, `noUnusedLocals`,
  `noUnusedParameters`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `moduleResolution: "Bundler"`, `noEmit`.
  The server adds `"types": ["node"]`.
- `client/vite.config.ts`: dev proxy `/ws` → `ws://localhost:8080` (with `ws: true`).
- `client/tsconfig.app.json` etc.: unchanged from the Vite template.

Package scripts:
- root: `dev` (server + client together via concurrently), `test`, `typecheck` (all workspaces), `build` (client), `start` (server)
- shared: `test`, `test:watch`, `typecheck`
- server: `dev: tsx watch src/index.ts`, `start: tsx src/index.ts`, `typecheck`
- client: `dev`, `build`, `preview`, `lint`, `typecheck: tsc -b`

`tsx` is a regular dependency of the server (not dev-only) because production also starts with it.

---

## 5. Shared OT core (`shared/src/ot`)

### 5.1 `TextOperation.ts`
Follows the semantics of ot.js (MIT). An operation is a list of components that walks the
**entire** base document:

```ts
/** > 0: retain n chars · < 0: delete -n chars · string: insert */
export type OpComponent = number | string;
export type SerializedOperation = OpComponent[];

export class TextOperation {
  ops: OpComponent[];
  baseLength: number;    // length of the doc this op applies to
  targetLength: number;  // length of the doc after applying

  constructor();
  retain(n: number): this;   // n >= 0; 0 is a no-op; merges with a trailing retain
  insert(str: string): this; // '' is a no-op; merges with a trailing insert;
                             // if the last component is a delete, the insert is placed BEFORE it
                             // (canonical form: insert before delete), merging with an insert before that
  delete(n: number): this;   // accepts positive n, stores -n; merges with a trailing delete
  isNoop(): boolean;         // no components, or a single retain
  equals(other: TextOperation): boolean;
  apply(doc: string): string;               // throws OTError('LENGTH_MISMATCH') if doc.length !== baseLength
  compose(next: TextOperation): TextOperation;  // this then next; requires this.targetLength === next.baseLength
  static transform(a: TextOperation, b: TextOperation): [TextOperation, TextOperation];
  toJSON(): SerializedOperation;
  static fromJSON(data: unknown): TextOperation; // validates shape; throws OTError('INVALID_OPERATION')
}
```

Also exported: `isInsert(c): c is string` (a real type guard) and `isRetain(c)` / `isDelete(c)`, which
return plain `boolean` on purpose. A type guard there would make TypeScript assume "not a retain" means
"not a number", which is false. Narrow with `isInsert` or `typeof c === 'number'`.

**Invariants**
- Canonical form: no two adjacent components of the same kind; no zero retains/deletes, no empty inserts.
- `transform(a, b)` requires `a.baseLength === b.baseLength` and returns `[a', b']` such that
  `b'.apply(a.apply(S)) === a'.apply(b.apply(S))` for every `S` (property **TP1**).
- **Tie-break:** when `a` and `b` both insert at the same position, `a`'s insert goes first.
  Both the server and the client always pass the *client's* operation as `a`, so every replica
  breaks ties identically. Never swap the argument order.

### 5.2 `selection.ts`
```ts
export interface SelectionRange { anchor: number; head: number } // character offsets
export interface Selection { ranges: SelectionRange[] }          // ranges[0] is the primary cursor

/** Move an offset through op. An insert exactly at the offset pushes it right. */
export function transformIndex(index: number, op: TextOperation): number;
export function transformSelection(sel: Selection, op: TextOperation): Selection;
export function isValidSelection(sel: unknown, docLength: number): sel is Selection; // max 32 ranges
```

### 5.3 `OTClient.ts` — client state machine
```ts
export type ClientState =
  | { kind: 'synchronized' }
  | { kind: 'awaitingConfirm'; outstanding: TextOperation }
  | { kind: 'awaitingWithBuffer'; outstanding: TextOperation; buffer: TextOperation };

export interface OTClientCallbacks {
  sendOperation(revision: number, op: TextOperation): void; // send to server
  applyOperation(op: TextOperation): void;                  // apply a server-originated op to the local doc
}

export class OTClient {
  revision: number;      // last server revision this client has incorporated
  state: ClientState;
  constructor(revision: number, callbacks: OTClientCallbacks);
  applyClient(op: TextOperation): void;  // local edit happened
  applyServer(op: TextOperation): void;  // remote op arrived from server
  serverAck(): void;                     // our outstanding op was accepted
  transformSelection(sel: Selection): Selection; // server coords → local coords (through outstanding, then buffer)
  get isSynchronized(): boolean;
  get hasPendingChanges(): boolean;
}
```
Transitions (`rev` = `this.revision`):

| State | applyClient(op) | applyServer(op) | serverAck() |
|---|---|---|---|
| synchronized | send(rev, op) → awaitingConfirm(op) | rev++, apply(op) | error |
| awaitingConfirm(o) | → awaitingWithBuffer(o, op) | rev++; `[o', op'] = transform(o, op)`; apply(op'); → awaitingConfirm(o') | rev++ → synchronized |
| awaitingWithBuffer(o, b) | → awaitingWithBuffer(o, b.compose(op)) | rev++; `[o', op'] = transform(o, op)`; `[b', op''] = transform(b, op')`; apply(op''); → awaitingWithBuffer(o', b') | rev++; send(rev, b) → awaitingConfirm(b) |

At most one operation is ever in flight per client.

### 5.4 `OTServer.ts` — authoritative document
```ts
export class OTServer {
  document: string;
  history: TextOperation[];   // history[i] took the doc from revision (historyOffset + i) to (+1)
  historyOffset: number;      // revision of history[0]; > 0 once old history is trimmed
  maxHistory: number;         // default 5000
  constructor(initialDoc?: string, maxHistory?: number);
  get revision(): number;     // historyOffset + history.length
  /** Transform op (made at `revision`) against all later history, apply it, record it, return the transformed op. */
  receiveOperation(revision: number, op: TextOperation): TextOperation;
  /** Transform a selection made at `revision` up to the current revision. */
  transformSelection(revision: number, sel: Selection): Selection;
}
```
Errors (`OTError` codes): `INVALID_REVISION` (revision > current or < 0), `STALE_REVISION`
(revision < historyOffset — client must resync), `LENGTH_MISMATCH`, `DOC_TOO_LARGE`
(target length > `MAX_DOC_LENGTH`). On `receiveOperation`, `a` = incoming client op, `b` = each history op:
`op = TextOperation.transform(op, historyOp)[0]`.

### 5.5 `errors.ts`
```ts
export type OTErrorCode = 'INVALID_OPERATION' | 'LENGTH_MISMATCH' | 'INVALID_REVISION' | 'STALE_REVISION' | 'DOC_TOO_LARGE';
export class OTError extends Error { code: OTErrorCode; constructor(code: OTErrorCode, message: string); }
```

---

## 6. Protocol (`shared/src/protocol.ts`)

JSON text frames over one WebSocket at path `/ws`. Every message has a `type`.

```ts
export interface UserInfo { clientId: string; name: string; color: string }

export type ClientMessage =
  | { type: 'join'; roomId: string; name: string }
  | { type: 'op'; revision: number; ops: SerializedOperation }
  | { type: 'selection'; revision: number; selection: Selection | null }
  | { type: 'set-language'; language: LanguageId };

export type ErrorCode =
  | 'BAD_MESSAGE' | 'NOT_JOINED' | 'ALREADY_JOINED' | 'ROOM_FULL' | 'INVALID_ROOM'
  | 'INVALID_NAME' | 'RESYNC_REQUIRED' | 'DOC_TOO_LARGE' | 'RATE_LIMITED' | 'JOIN_TIMEOUT';

export type ServerMessage =
  | { type: 'joined'; roomId: string; you: UserInfo; revision: number; document: string;
      language: LanguageId; users: UserInfo[] }                      // users excludes `you`
  | { type: 'ack'; revision: number }                                 // revision AFTER your op
  | { type: 'op'; revision: number; clientId: string; ops: SerializedOperation } // revision AFTER this op
  | { type: 'selection'; clientId: string; selection: Selection | null } // already in current-revision coords
  | { type: 'user-joined'; user: UserInfo }
  | { type: 'user-left'; clientId: string }
  | { type: 'language'; language: LanguageId; clientId: string }
  | { type: 'error'; code: ErrorCode; message: string; fatal: boolean };

export function encode(msg: ClientMessage | ServerMessage): string; // JSON.stringify
export const WS_PATH = '/ws';
export const FATAL_CLOSE_CODE = 4000; // close code for fatal protocol errors
```

### 6.1 Flows
**Join:** socket opens → client sends `join` (must arrive within 5 s or server closes with `JOIN_TIMEOUT`)
→ server validates room id + name, assigns `clientId` (nanoid 12) and color → replies `joined`
→ broadcasts `user-joined` to others.

**Edit:** local edit → `OTClient.applyClient` → (if synchronized) `op {revision, ops}`
→ server `receiveOperation` → sends `ack {revision}` to sender, `op {revision, clientId, ops}` (transformed) to everyone else.
Receivers call `OTClient.applyServer`. Sanity check: if `msg.revision !== client.revision + 1`, treat as fatal and resync (§8.7).

**Selection:** a client sends `selection` only while its `OTClient` is synchronized, tagged with its
current revision (so the selection is in server coordinates). If it is not synchronized, it marks the
selection dirty and sends it right after the next `serverAck` that returns it to synchronized.
Server transforms it with `OTServer.transformSelection(revision, sel)` and broadcasts it to others.
Receivers run `OTClient.transformSelection` to map it into local coordinates. Because the
server→client channel is ordered, the receiver's `revision` equals the server's revision at broadcast time.
Remote cursor positions stored on a client are then transformed by every op the client applies
(local or remote) so they stay correct between selection messages.

**Language:** `set-language` → server updates room language → broadcasts `language` to **all** (including sender).

**Leave:** socket close → server removes user, broadcasts `user-left`, schedules room cleanup if empty.

---

## 7. Server (`server/src`)

### 7.1 `config.ts`
```ts
export const config = {
  port: Number(process.env.PORT ?? 8080),
  isProd: process.env.NODE_ENV === 'production',
  clientDist: new URL('../../client/dist', import.meta.url).pathname,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(','),
  roomIdleTtlMs: 10 * 60_000,
  heartbeatMs: 30_000,
  joinTimeoutMs: 5_000,
  maxMessagesPerSecond: 60,
};
```
(Use `fileURLToPath` for `clientDist` so it also works on Windows.)

### 7.2 `index.ts`
- `http.createServer`: `GET /health` → `200 ok`. In production, all other GETs go to
  `sirv(config.clientDist, { single: true })` (SPA fallback so `/r/abc` serves `index.html`).
- `new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 })`.
- On `connection`: reject if `Origin` header is not in `allowedOrigins` (skip the check when the
  origin equals the request host, i.e. same-origin production). Hand the socket to `handleConnection`.
- Heartbeat: every `heartbeatMs`, terminate sockets that did not answer the previous ping, then ping all.
- Graceful shutdown on SIGINT/SIGTERM.

### 7.3 `schemas.ts`
zod schemas for every `ClientMessage` variant combined in a discriminated union on `type`.
Room id must match `ROOM_ID_REGEX`; name is trimmed and must match `NAME_REGEX`; `revision` is a
non-negative integer; `ops` is an array of (non-zero integer | non-empty string) with max 10 000 entries;
selection validated structurally (bounds are checked later against the doc). Export
`parseClientMessage(raw: string): ClientMessage | null`. Add a compile-time check that the inferred
type is assignable to `ClientMessage`.

### 7.4 `connection.ts`
`handleConnection(socket, roomManager)`:
1. Start a join timer. Until joined, only `join` is accepted (others → `NOT_JOINED`, fatal).
2. Parse each frame with `parseClientMessage`; invalid → `error BAD_MESSAGE` (non-fatal), close after 5 bad messages.
3. Simple per-socket rate limit (token bucket, `maxMessagesPerSecond`); over limit → `RATE_LIMITED`, drop message.
4. Route: `join` → `roomManager.getOrCreate(roomId).join(...)`; `op` → `room.handleOp`; `selection` → `room.handleSelection`; `set-language` → `room.handleLanguage`.
5. On close/error → `room.leave(clientId)`.
Fatal errors: send the `error` message, then `socket.close(4000, code)`.

### 7.5 `Room.ts`
```ts
interface Member { user: UserInfo; socket: WebSocket }
export class Room {
  id: string;
  ot: OTServer;
  language: LanguageId;                 // default 'typescript'
  members: Map<string, Member>;
  join(socket: WebSocket, name: string): UserInfo;     // ROOM_FULL at MAX_USERS_PER_ROOM
  leave(clientId: string): void;
  handleOp(clientId: string, revision: number, ops: SerializedOperation): void;
  handleSelection(clientId: string, revision: number, selection: Selection | null): void;
  handleLanguage(clientId: string, language: LanguageId): void;
  broadcast(msg: ServerMessage, exceptClientId?: string): void; // only to OPEN sockets
  get isEmpty(): boolean;
}
```
`handleOp`: `TextOperation.fromJSON` → `ot.receiveOperation` → ack sender, broadcast op to others.
`OTError` mapping: `STALE_REVISION`/`INVALID_REVISION`/`LENGTH_MISMATCH` → `RESYNC_REQUIRED` (fatal for that
socket; the client reconnects and gets a fresh doc). `DOC_TOO_LARGE` → non-fatal error, op dropped... but the
client already applied it locally, so also treat it as `RESYNC_REQUIRED`.
`handleSelection`: drop if the selection fails `isValidSelection` after transformation.
Initial document: a short comment like `// Welcome! Share this URL to code together.\n`.

### 7.6 `RoomManager.ts`
`Map<string, Room>`; `getOrCreate(id)`; when a room becomes empty, start a `roomIdleTtlMs` timer that
deletes it (cancel the timer if someone joins). Expose `stats()` for logging.

### 7.7 `colors.ts`
Pick the palette color (from `USER_COLORS` in constants) least used by current members.

---

## 8. Client (`client/src`)

### 8.1 Routing (`main.tsx`, `App.tsx`)
`BrowserRouter` with routes: `/` → `HomePage`; `/r/:roomId` → `RoomPage`; `*` → redirect to `/`.
Import `styles/index.css` and `styles/editor.css` once in `main.tsx`. Do not use `React.StrictMode`'s double
effects as an excuse for leaks — sessions must dispose cleanly (StrictMode stays on).

### 8.2 `lib/config.ts`
```ts
export function getWebSocketUrl(): string // VITE_WS_URL if set, else `${wss|ws}://${location.host}/ws`
```

### 8.3 `lib/identity.ts`
`getStoredName(): string | null`, `setStoredName(name)`. Key `collab.name`. Wrap localStorage in try/catch.

### 8.4 `session/CollabSocket.ts`
```ts
export type SocketStatus = 'connecting' | 'open' | 'closed';
export class CollabSocket {
  constructor(url: string, handlers: { onOpen(): void; onMessage(msg: ServerMessage): void; onStatus(s: SocketStatus): void });
  send(msg: ClientMessage): void;  // drops (and returns) if not open — never queue ops
  close(): void;                   // permanent; disables reconnect
}
```
Reconnect with exponential backoff 500 ms → 8 s plus jitter; reset after a successful open.
Do not reconnect after a close with a fatal code other than `RESYNC_REQUIRED`.

### 8.5 `session/CollabSession.ts` — the brain (no React inside)
Owns `CollabSocket`, `OTClient | null`, `MonacoBinding | null`, presence, language, and status.
Exposes an observable snapshot for `useSyncExternalStore`:
```ts
export type SessionStatus = 'connecting' | 'joining' | 'ready' | 'reconnecting' | 'error';
export interface RemoteUser extends UserInfo { selection: Selection | null } // local coords
export interface SessionSnapshot {
  status: SessionStatus;
  me: UserInfo | null;
  users: RemoteUser[];
  language: LanguageId;
  error: { code: ErrorCode; message: string } | null;
  notice: string | null;           // toast text, e.g. lost-edits warning
}
export class CollabSession {
  constructor(roomId: string, name: string);
  subscribe(listener: () => void): () => void;
  getSnapshot(): SessionSnapshot;  // returns the SAME object until something changes
  attachEditor(editor: monaco.editor.IStandaloneCodeEditor, monacoNs: typeof monaco): void;
  setLanguage(language: LanguageId): void;
  dismissNotice(): void;
  dispose(): void;
}
```
Responsibilities:
- On socket open → send `join` (status `joining`).
- On `joined` → create a fresh `OTClient(revision, callbacks)`, load the document into the binding
  (as a remote change), set language, set presence, status `ready`, send current selection.
- On `op` → `otClient.applyServer`; on `ack` → `otClient.serverAck()`, then flush a dirty selection if synchronized.
- On `selection` → `otClient.transformSelection`, store on that user, re-render cursors.
- Callbacks: `sendOperation` → socket `op`; `applyOperation` → `binding.applyRemote(op)`.
- If the editor mounts after `joined`, `attachEditor` must load the current document then.

### 8.6 `editor/opConversion.ts` (pure, no Monaco runtime import)
```ts
interface ContentChange { rangeOffset: number; rangeLength: number; text: string } // subset of IModelContentChange
/** All ranges refer to the document BEFORE the event and do not overlap. */
export function changesToOperation(changes: readonly ContentChange[], docLengthBefore: number): TextOperation;
/** Returns edits whose offsets all refer to the document BEFORE the op (Monaco applyEdits semantics). */
export function operationToEdits(op: TextOperation): { offset: number; length: number; text: string }[];
```
`changesToOperation`: sort by `rangeOffset` ascending, then retain gaps / delete `rangeLength` / insert `text`,
retain the tail. `docLengthBefore = model.getValueLength() - Σ(text.length - rangeLength)`.

### 8.7 `editor/MonacoBinding.ts`
```ts
export class MonacoBinding {
  constructor(editor, monacoNs, hooks: {
    onLocalOperation(op: TextOperation): void;
    onLocalSelection(sel: Selection): void;   // debounced 50 ms
  });
  setDocument(text: string): void;            // full replace as remote change; resets undo stack is fine
  applyRemote(op: TextOperation): void;
  setLanguage(language: LanguageId): void;    // monaco.editor.setModelLanguage
  setReadOnly(readOnly: boolean): void;
  getSelection(): Selection;
  dispose(): void;
}
```
- On construct: `model.setEOL(monaco.editor.EndOfLineSequence.LF)` so all replicas use `\n`
  (a Windows user would otherwise produce CRLF offsets).
- `onDidChangeModelContent`: ignore while `applyingRemote` is true; otherwise build the op with
  `changesToOperation` and call `hooks.onLocalOperation`.
- `applyRemote`: set `applyingRemote = true`; convert offsets to ranges with `model.getPositionAt`
  **before** applying; `model.applyEdits(edits)`; `finally` reset the flag. Do not use `executeEdits`
  (that would put other users' edits on the local undo stack).
- Selection conversion uses `model.getOffsetAt` / `getPositionAt`; ranges[0] = primary selection.
- The editor is read-only unless session status is `ready`.

Reconnect policy (v1): on reconnect the server sends a fresh `joined`; the session discards the old
`OTClient`. If it had pending changes, set `notice` = "You were disconnected — your last few unsynced edits were discarded."

### 8.8 `editor/RemoteCursors.ts`
- One `IEditorDecorationsCollection` per remote user.
- Per user, inject CSS into a single `<style id="remote-cursor-styles">`:
  - `.rc-caret-<id>` — 2px left border in the user's color (use `beforeContentClassName` on a zero-width range at the head).
  - `.rc-sel-<id>` — background = user color at ~25% alpha (for non-empty ranges).
  - `.rc-label-<id>::after` — `content: "<name>"`, small pill above the caret in the user color.
    Escape `\` and `"` in names (names are already restricted by `NAME_REGEX`).
- Label hides 2 s after the user's last movement (toggle a class), reappears on movement.
- `update(users: RemoteUser[])`, `transformAll(op)` (called by the session for every applied op), `remove(id)`, `dispose()` (removes CSS rules too).
- Sanitize `clientId` for class names (nanoid alphabet is already safe; still strip non `[A-Za-z0-9_-]`).

### 8.9 `hooks/useCollabSession.ts`
Creates a `CollabSession` in an effect keyed by `roomId` + `name`, disposes on cleanup, returns
`{ snapshot, attachEditor, setLanguage, dismissNotice }` using `useSyncExternalStore`.

### 8.10 Components
- `HomePage` — title, short description, **Create room** (navigates to `/r/${nanoid(10)}`), and a **Join** input
  that accepts either a room id or a full room URL. Validate with `ROOM_ID_REGEX`.
- `RoomPage` — if no stored name, show `NameDialog`; invalid room id → redirect home. Layout: `Toolbar` on top,
  `EditorPane` filling the rest, `UserList` as a right sidebar (collapses under 768 px), `Toast` for notices.
  Fatal errors (`ROOM_FULL`, etc.) render a full-page message with a "Back home" link.
- `EditorPane` — `@monaco-editor/react` `<Editor>` with `theme="vs-dark"`, `options={{ automaticLayout: true, minimap: { enabled: false }, fontSize: 14 }}`; `onMount` → `attachEditor`.
- `Toolbar` — room id, `LanguageSelect`, `ShareButton`, `ConnectionStatus`.
- `LanguageSelect` — `<select>` over `LANGUAGES`; change → `setLanguage`.
- `ShareButton` — copies `location.href` via `navigator.clipboard.writeText`; shows "Copied!" for 1.5 s; fallback to a selectable input.
- `ConnectionStatus` — colored dot + text for each `SessionStatus`.
- `UserList` — "You" first, then others; color swatch + name.
- `NameDialog` — 1–24 chars, validated with `NAME_REGEX`, saved via `setStoredName`.
- `Toast` — bottom-center, auto-dismiss after 6 s.

Monaco loads from its CDN through `@monaco-editor/react`'s default loader (no worker config needed).
`monaco-editor` is installed for types only: `import type * as monaco from 'monaco-editor'`.

---

## 9. Constants (`shared/src/constants.ts`)
```ts
export const ROOM_ID_REGEX = /^[A-Za-z0-9_-]{6,32}$/;
export const NAME_REGEX = /^[\p{L}\p{N} ._-]{1,24}$/u;
export const MAX_DOC_LENGTH = 500_000;
export const MAX_USERS_PER_ROOM = 20;
export const USER_COLORS = ['#f87171','#fb923c','#facc15','#4ade80','#2dd4bf','#60a5fa','#a78bfa','#f472b6','#94a3b8','#e879f9'] as const;
export const ROOM_ID_LENGTH = 10;   // nanoid(ROOM_ID_LENGTH) for new rooms
export const MAX_HISTORY = 5_000;   // OTServer default
```
Also exported from `@collab/shared`: `DEFAULT_LANGUAGE` ('typescript'), `MAX_SELECTION_RANGES` (32).

## 10. Languages (`shared/src/languages.ts`)
```ts
export const LANGUAGES = [
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'sql', label: 'SQL' },
  { id: 'plaintext', label: 'Plain text' },
] as const;
export type LanguageId = (typeof LANGUAGES)[number]['id'];
export const isLanguageId = (v: unknown): v is LanguageId => LANGUAGES.some(l => l.id === v);
```
(Ids are Monaco language ids — 14 highlighted languages + plain text.)

---

## 11. Error handling & limits (summary)
- Max WebSocket frame 512 KB; max doc 500 000 chars; max 20 users/room; max 32 selection ranges; 60 msgs/s/socket.
- Any OT inconsistency on either side → resync (server closes with `RESYNC_REQUIRED`; client reconnects and reloads).
- Client never throws into React: session catches errors, sets `status: 'error'` or a notice.
- Server never crashes on bad input: every handler is wrapped; log and send `BAD_MESSAGE`.

---

## 12. Testing (`shared/test`, vitest)
- `helpers.ts`: `mulberry32(seed)`; `randomString(rng, maxLen)` (include `\n` and a non-BMP char like `😀`);
  `randomOperation(doc, rng)` producing a valid op with `baseLength === doc.length`.
- `TextOperation.test.ts`: builder merging/canonical form, `apply` on hand-written cases, length-mismatch throws,
  JSON round-trip, `fromJSON` rejects bad input; property tests over 1 000 seeds:
  - compose: `b.apply(a.apply(S)) === a.compose(b).apply(S)`
  - TP1 for `transform`
  - tie-break: two inserts at the same index → `a`'s text first on both sides.
- `selection.test.ts`: insert before/at/after cursor, delete spanning cursor, multi-range.
- `simulation.test.ts`: one `OTServer`, 3 `OTClient`s each with a local doc string and in-memory queues
  (client→server per client, server→client per client). Each step randomly: a client makes a random local edit,
  or deliver the head of one client→server queue (server responds with ack to sender + op to others), or deliver
  the head of one server→client queue. Run 300 seeds × 200 steps, then drain all queues;
  assert every client doc === server doc. Also exercise `transformSelection` round trips without throwing.

Acceptance for the OT core = all of the above pass.

---

## 13. Build phases and commit checkpoints

Each phase = **one new Cursor Agent chat** + **one or more git commits**. Paste this prompt, replacing N:
> Read @architecture.md. Implement **Phase N only**, exactly as specified. Only touch the files listed for
> this phase. When done, run `npm run typecheck` and `npm test` from the repo root, fix every error, and give
> me a short summary plus anything I should check manually. Do not run git commands.

Then do the manual check in the "Done when" column yourself. Only when it passes, commit.

| Phase | Status | Scope (sections) | Files | Done when |
|---|---|---|---|---|
| 1 | ✅ done | OT primitives §5.1, §5.2, §5.5, §9, §10 | `shared/**` | 35 tests + typecheck pass |
| 2 | ✅ done | OTClient + OTServer §5.3, §5.4, protocol §6 | `shared/**` | convergence simulation passes |
| 3 | todo | Server §7 | `server/src/**` (replace the placeholder `index.ts`) | `npm run dev -w server` starts; http://localhost:8080/health shows `ok` |
| 4 | todo | Client core §8.1–8.7, §8.9, EditorPane, HomePage, RoomPage (minimal), NameDialog | `client/**` | two browser windows on the same room edit in sync; typing on the same line at once converges |
| 5 | todo | Presence & cursors §8.8, UserList, ConnectionStatus, Toast | `client/src/editor/RemoteCursors.ts`, components | colored carets/selections/labels follow edits in both windows |
| 6 | todo | Polish: Toolbar, LanguageSelect, ShareButton, styles, error pages, `README.md` (screenshot/GIF placeholder, how OT works here, how to run) | `client/**`, `README.md` | every goal in §1 works; `npm run typecheck`, `npm test`, `npm run build` all pass |
| 7 | todo | Deploy §16 | config only | public URL works from your phone + laptop at the same time |

### 🛑 Commit checkpoints

Stop and commit at every 🛑. Small, working commits with clear messages show recruiters how you build
software; one giant "final" commit hides it. Never commit a broken state on `main`.

```powershell
git add -A
git commit -m "<message>"
git push
```

| When | Commit message |
|---|---|
| 🛑 After unzipping the starter, `npm install`, and `npm test` passes | `chore: scaffold npm workspaces (shared, server, client)` |
| 🛑 (same session) | Optional split: commit `shared/` separately as `feat(shared): OT core with randomized convergence tests` |
| 🛑 Phase 3 done | `feat(server): WebSocket rooms with OT, validation, rate limiting` |
| 🛑 Phase 4 done | `feat(client): Monaco editor with live OT sync` |
| 🛑 Phase 5 done | `feat(client): remote cursors, selections, and presence list` |
| 🛑 Phase 6 done | `feat(client): language picker, share links, UI polish` then `docs: README` |
| 🛑 Phase 7 done | `chore: deploy to Render` |
| 🛑 Any time you fix a bug you found while testing | `fix(<area>): <what was wrong>` (separate commit) |

To split a phase into smaller commits, stage only some files: `git add server/src/Room.ts server/src/RoomManager.ts`
then commit, then stage the rest. If a phase goes badly and you want to start it over:
`git restore .` and `git clean -fd` (discards everything since the last commit).

---

## 14. Conventions
- Named exports only (React components included), except where a tool requires default (`vite.config.ts`).
- Files: `PascalCase.ts(x)` for classes/components, `camelCase.ts` otherwise.
- No `any`; use `unknown` + narrowing. No non-null `!` except on Monaco `getModel()` right after mount.
- Every class with listeners/timers has `dispose()` and it is called.
- Keep React components thin; logic lives in `CollabSession`, `MonacoBinding`, and `shared`.
- Comments explain *why* (especially in OT code), not *what*.

---

## 15. Stretch goals (only when asked)
1. **Lossless reconnect:** tag ops with `(clientId, seq)`; server dedupes by last seq per client; client rejoins with
   `lastRevision`, receives missed ops, and resends outstanding/buffer.
2. **Persistence:** snapshot doc + language to SQLite/Redis every N ops and on room cleanup.
3. **OT-aware undo:** keep a local undo stack of inverted ops, transformed against incoming remote ops.
4. **Code execution** sandbox, chat sidebar, read-only share links, follow-a-user mode.
5. Playwright end-to-end test with two browser contexts.

---

## 16. Deployment — Render (free tier)

One Node service on Render serves both the built client and the WebSocket server (same origin, so no CORS
and `/ws` works unchanged). Render's free web services support WebSockets and only run one instance, which
is exactly right here because rooms live in that one process's memory.

Render dashboard → **New → Web Service** → connect the GitHub repo:
- Runtime: Node · Branch: `main` · Root directory: (blank) · Instance type: **Free**
- Build command: `npm install --include=dev && npm run build`
  (`--include=dev` because `NODE_ENV=production` would otherwise skip TypeScript/Vite, which the build needs)
- Start command: `npm start`
- Environment variables: `NODE_ENV=production`, `NODE_VERSION=22`,
  `ALLOWED_ORIGINS=https://<your-service>.onrender.com`
- Health check path: `/health`

Free-tier behavior to mention in the README: the service sleeps after ~15 minutes with no traffic and takes
about a minute to wake on the next visit. Rooms are in memory, so they reset whenever it sleeps or redeploys.

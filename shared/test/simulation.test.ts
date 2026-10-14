import { describe, expect, it } from 'vitest';
import { OTClient } from '../src/ot/OTClient';
import { OTError } from '../src/ot/errors';
import { OTServer } from '../src/ot/OTServer';
import { isValidSelection, type Selection } from '../src/ot/selection';
import { TextOperation, type SerializedOperation } from '../src/ot/TextOperation';
import { mulberry32, randInt, randomOperation, type Rng } from './helpers';

// Messages are JSON round-tripped to mimic the real wire.
type ToServer =
  | { type: 'op'; revision: number; ops: SerializedOperation }
  | { type: 'selection'; revision: number; selection: Selection };
type ToClient =
  | { type: 'ack' }
  | { type: 'op'; ops: SerializedOperation }
  | { type: 'selection'; selection: Selection };

interface SimClient {
  doc: string;
  client: OTClient;
  toServer: string[];
  fromServer: string[];
}

function makeClient(server: OTServer): SimClient {
  const sim: SimClient = {
    doc: server.document,
    toServer: [],
    fromServer: [],
    client: undefined as unknown as OTClient,
  };
  sim.client = new OTClient(server.revision, {
    sendOperation: (revision, op) => {
      const msg: ToServer = { type: 'op', revision, ops: op.toJSON() };
      sim.toServer.push(JSON.stringify(msg));
    },
    applyOperation: (op) => {
      sim.doc = op.apply(sim.doc);
    },
  });
  return sim;
}

function randomSelection(doc: string, rng: Rng): Selection {
  const n = 1 + randInt(rng, 3);
  return {
    ranges: Array.from({ length: n }, () => ({ anchor: randInt(rng, doc.length + 1), head: randInt(rng, doc.length + 1) })),
  };
}

function deliverToServer(server: OTServer, clients: SimClient[], from: SimClient): void {
  const raw = from.toServer.shift();
  if (raw === undefined) return;
  const msg = JSON.parse(raw) as ToServer;
  const others = clients.filter((c) => c !== from);
  if (msg.type === 'op') {
    const applied = server.receiveOperation(msg.revision, TextOperation.fromJSON(msg.ops));
    from.fromServer.push(JSON.stringify({ type: 'ack' } satisfies ToClient));
    const out: ToClient = { type: 'op', ops: applied.toJSON() };
    for (const c of others) c.fromServer.push(JSON.stringify(out));
  } else {
    const sel = server.transformSelection(msg.revision, msg.selection);
    expect(isValidSelection(sel, server.document.length)).toBe(true);
    const out: ToClient = { type: 'selection', selection: sel };
    for (const c of others) c.fromServer.push(JSON.stringify(out));
  }
}

function deliverToClient(sim: SimClient): void {
  const raw = sim.fromServer.shift();
  if (raw === undefined) return;
  const msg = JSON.parse(raw) as ToClient;
  if (msg.type === 'ack') sim.client.serverAck();
  else if (msg.type === 'op') sim.client.applyServer(TextOperation.fromJSON(msg.ops));
  else {
    // Remote selection must land inside this client's current local document.
    const local = sim.client.transformSelection(msg.selection);
    expect(isValidSelection(local, sim.doc.length)).toBe(true);
  }
}

function runSimulation(seed: number, steps: number): void {
  const rng = mulberry32(seed);
  const server = new OTServer('function hello() {\n  return 42;\n}\n');
  const clients: SimClient[] = [makeClient(server), makeClient(server), makeClient(server)];

  for (let step = 0; step < steps; step++) {
    const c = clients[randInt(rng, clients.length)]!;
    const r = rng();
    if (r < 0.35) {
      // Local edit: applied to the local doc immediately, then handed to OTClient.
      const op = randomOperation(c.doc, rng);
      c.doc = op.apply(c.doc);
      c.client.applyClient(op);
    } else if (r < 0.45) {
      // Selections are only sent while synchronized (see architecture.md §6.1).
      if (c.client.isSynchronized) {
        const msg: ToServer = { type: 'selection', revision: c.client.revision, selection: randomSelection(c.doc, rng) };
        c.toServer.push(JSON.stringify(msg));
      }
    } else if (r < 0.7) {
      deliverToServer(server, clients, c);
    } else if (r < 0.98) {
      deliverToClient(c);
    } else if (clients.length < 6) {
      // A late joiner starts from the server's current snapshot.
      clients.push(makeClient(server));
    }
  }

  // Drain every queue until the network is quiet.
  let busy = true;
  while (busy) {
    busy = false;
    for (const c of clients) {
      while (c.toServer.length > 0) {
        deliverToServer(server, clients, c);
        busy = true;
      }
    }
    for (const c of clients) {
      while (c.fromServer.length > 0) {
        deliverToClient(c);
        busy = true;
      }
    }
  }

  for (const [i, c] of clients.entries()) {
    expect(c.client.isSynchronized, `seed ${seed}, client ${i} synchronized`).toBe(true);
    expect(c.client.revision, `seed ${seed}, client ${i} revision`).toBe(server.revision);
    expect(c.doc, `seed ${seed}, client ${i} converged`).toBe(server.document);
  }
}

describe('convergence simulation', () => {
  it('all clients converge to the server document (300 seeds × 200 steps)', () => {
    for (let seed = 1; seed <= 300; seed++) runSimulation(seed, 200);
  });
});

describe('OTClient state machine', () => {
  it('holds one op in flight and buffers the rest', () => {
    const sent: [number, TextOperation][] = [];
    const client = new OTClient(0, { sendOperation: (r, o) => sent.push([r, o]), applyOperation: () => {} });

    client.applyClient(new TextOperation().insert('a'));
    expect(client.state.kind).toBe('awaitingConfirm');
    client.applyClient(new TextOperation().retain(1).insert('b'));
    client.applyClient(new TextOperation().retain(2).insert('c'));
    expect(client.state.kind).toBe('awaitingWithBuffer');
    expect(sent).toHaveLength(1);

    client.serverAck();
    expect(client.revision).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[1]![0]).toBe(1);
    expect(sent[1]![1].apply('a')).toBe('abc'); // buffered edits were composed into one op

    client.serverAck();
    expect(client.isSynchronized).toBe(true);
    expect(client.revision).toBe(2);
  });

  it('ignores no-op edits and rejects an unexpected ack', () => {
    const client = new OTClient(0, { sendOperation: () => {}, applyOperation: () => {} });
    client.applyClient(new TextOperation().retain(5));
    expect(client.isSynchronized).toBe(true);
    expect(() => client.serverAck()).toThrow(OTError);
  });
});

describe('OTServer', () => {
  it('transforms an op made against an older revision', () => {
    const server = new OTServer('abc');
    server.receiveOperation(0, new TextOperation().insert('X').retain(3)); // Xabc
    const applied = server.receiveOperation(0, new TextOperation().retain(3).insert('Y')); // made against "abc"
    expect(server.document).toBe('XabcY');
    expect(applied.baseLength).toBe(4);
    expect(server.revision).toBe(2);
  });

  it('rejects revisions from the future and from trimmed history', () => {
    const server = new OTServer('', 2);
    for (let i = 0; i < 4; i++) server.receiveOperation(i, new TextOperation().retain(i).insert('x'));
    expect(server.historyOffset).toBe(2);
    expect(() => server.receiveOperation(9, new TextOperation())).toThrowError(
      expect.objectContaining({ code: 'INVALID_REVISION' }),
    );
    expect(() => server.receiveOperation(1, new TextOperation().retain(1))).toThrowError(
      expect.objectContaining({ code: 'STALE_REVISION' }),
    );
  });

  it('enforces the maximum document length', () => {
    const server = new OTServer('', 100, 5);
    expect(() => server.receiveOperation(0, new TextOperation().insert('123456'))).toThrowError(
      expect.objectContaining({ code: 'DOC_TOO_LARGE' }),
    );
    expect(server.document).toBe('');
  });
});

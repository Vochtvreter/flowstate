// Cached lookup tables for the node graph, shared by the simulation, Flow, goals and orders. DOM-free.
import { Game, GNode, Wire } from './state';

export interface Graph {
  rev: number;
  byId: Map<number, GNode>;
  /** Outgoing wires per node, grouped by output port. */
  outs: Map<number, Wire[][]>;
  ins: Map<number, Wire[]>;
}

const graphs = new WeakMap<Game, Graph>();

export function graph(g: Game): Graph {
  let c = graphs.get(g);
  if (c && c.rev === g.rev && c.byId.size === g.nodes.length) return c;
  c = { rev: g.rev, byId: new Map(), outs: new Map(), ins: new Map() };
  for (const n of g.nodes) c.byId.set(n.id, n);
  for (const w of g.wires) {
    let ports = c.outs.get(w.from);
    if (!ports) c.outs.set(w.from, (ports = []));
    (ports[w.port] ??= []).push(w);
    let ins = c.ins.get(w.to);
    if (!ins) c.ins.set(w.to, (ins = []));
    ins.push(w);
  }
  graphs.set(g, c);
  return c;
}

export const isMachine = (n: GNode) => n.type === 'refiner' || n.type === 'assembler' || n.type === 'fabricator';
export const isPass = (n: GNode) => n.type === 'router' || n.type === 'merger' || n.type === 'silo';
export const isSink = (n: GNode) => n.type === 'market' || n.type === 'lab' || n.type === 'void';

/** Per graph: the Routers, Mergers and Silos from which a machine can be reached through other Routers, Mergers and Silos. */
const feeders = new WeakMap<Graph, Set<number>>();

/**
 * Does this Router, Merger or Silo lead on to a machine, directly or through any chain of other
 * pass-through nodes? A loop of junctions leads nowhere by itself. Worked out once per graph,
 * backwards from the machines, so loops cost nothing.
 */
export function leadsToMachine(c: Graph, id: number): boolean {
  let set = feeders.get(c);
  if (!set) {
    set = new Set();
    const queue: number[] = [];
    const visit = (to: number) => {
      for (const w of c.ins.get(to) ?? []) {
        const src = c.byId.get(w.from);
        if (src && isPass(src) && !set!.has(src.id)) {
          set!.add(src.id);
          queue.push(src.id);
        }
      }
    };
    for (const n of c.byId.values()) if (isMachine(n)) visit(n.id);
    while (queue.length) visit(queue.pop()!);
    feeders.set(c, set);
  }
  return set.has(id);
}

/** Per graph: every node from which a Market or a Lab can be reached along wires. */
const useful = new WeakMap<Graph, Set<number>>();

/**
 * Can anything this node sends out end up sold or studied? True when some path of wires leads from it to
 * a Market or a Lab, through machines, Routers, Mergers and Silos alike. (Markets and Labs themselves count.)
 */
export function reachesUse(g: Game, n: GNode): boolean {
  const c = graph(g);
  let set = useful.get(c);
  if (!set) {
    set = new Set();
    const queue: number[] = [];
    for (const x of c.byId.values()) {
      if (x.type === 'market' || x.type === 'lab') {
        set.add(x.id);
        queue.push(x.id);
      }
    }
    while (queue.length) {
      const to = queue.pop()!;
      for (const w of c.ins.get(to) ?? []) {
        if (!set.has(w.from)) {
          set.add(w.from);
          queue.push(w.from);
        }
      }
    }
    useful.set(c, set);
  }
  return set.has(n.id);
}

/** Does the node have any wire at all, in or out? */
export function isWired(g: Game, n: GNode): boolean {
  const c = graph(g);
  if (c.ins.get(n.id)?.length) return true;
  const ports = c.outs.get(n.id);
  return !!ports && ports.some((ws) => ws && ws.length > 0);
}

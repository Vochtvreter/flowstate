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

/** Does the node have any wire at all, in or out? */
export function isWired(g: Game, n: GNode): boolean {
  const c = graph(g);
  if (c.ins.get(n.id)?.length) return true;
  const ports = c.outs.get(n.id);
  return !!ports && ports.some((ws) => ws && ws.length > 0);
}

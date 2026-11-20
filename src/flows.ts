// The ledger: for each material on the board, how much is made, where it goes and whether that is enough. DOM-free.
//
// A supply line is easy to build and hard to read: twenty cards, each with a rate of its own, say little about
// whether there is enough Copper. The ledger turns the board round and asks of each material in turn: how much is
// made a second, how much the machines that use it would take, and what becomes of the rest (sold, studied, dumped).
// One row a material, in the order of the recipes, so the list reads from Sand down to the Phone. A row is in one of
// four states, and says where to look:
//
//   short   a machine that uses it stands waiting for it: more is wanted than arrives. `at` is the Drill or machine
//           that makes it and cannot keep up; where nothing wired in makes it at all, the machine that waits.
//   stuck   it has no exit: a port that gives it has no wire, and what makes it is full and has stopped. `at` is
//           that maker.
//   spare   more could be made than anything takes: a maker stands full although its port is wired. That is no fault
//           (a Drill is often ahead of its Lab); it says where there is room for more.
//   ok      what is made is taken.
//
// The Flows panel (src/ui/flows.ts) draws it, and traces a material on the board at a press on its row.
import { MAT_IDS, MatId } from './content';
import { cycleTime, recipeOf, wellRate } from './economy';
import { graph, isMachine } from './graph';
import { Game, GNode } from './state';

export type FlowState = 'ok' | 'short' | 'stuck' | 'spare';

export interface MatFlow {
  mat: MatId;
  /** Items a second being made right now, and what its makers would make running flat out. */
  made: number;
  can: number;
  /** Items a second the machines that use it take right now, and what they would take running flat out. */
  used: number;
  wanted: number;
  /** Items a second sold at Markets, studied in Labs and sent to Dumps. */
  sold: number;
  studied: number;
  dumped: number;
  /** The Drills and machines that make it, and the machines that use it. */
  makers: number[];
  users: number[];
  state: FlowState;
  /** The node to look at for a row that is short or stuck (see above); null for one that is not. */
  at: number | null;
}

/** From this share of its time at work a Drill or machine counts as running flat out. */
const FLAT_OUT = 0.9;

/** What a node makes of a material a second, running flat out (0 when it makes none). */
function canMake(n: GNode, m: MatId): number {
  if (n.type === 'well') return n.material === m ? wellRate(n) : 0;
  const r = isMachine(n) ? recipeOf(n) : null;
  const out = r?.outputs.find((o) => o[0] === m);
  return r && out ? out[1] / cycleTime(n, r) : 0;
}

/** What leaves a port right now, in items a second: the rates of its wires (each measured over whole deliveries, so steady). */
const leaving = (g: Game, id: number, port: number): number => {
  let sum = 0;
  for (const w of graph(g).outs.get(id)?.[port] ?? []) sum += w.rate;
  return sum;
};

/** What a machine receives of a material right now, in items a second: the rates of the wires that bring it. */
export function arriving(g: Game, n: GNode, m: MatId): number {
  let sum = 0;
  for (const w of graph(g).ins.get(n.id) ?? []) if (w.mat === m) sum += w.rate;
  return sum;
}

/**
 * The ledger: a row for every material that anything on the board makes or uses, in the order of the content table.
 * Amounts are read off the wires, not off the machines: a machine works in bursts and its own rate swings with them,
 * while a wire's rate is measured over whole deliveries and stands still.
 */
export function flows(g: Game): MatFlow[] {
  const c = graph(g);
  const rows = new Map<MatId, MatFlow>();
  const row = (m: MatId): MatFlow => {
    let r = rows.get(m);
    if (!r) rows.set(m, (r = { mat: m, made: 0, can: 0, used: 0, wanted: 0, sold: 0, studied: 0, dumped: 0, makers: [], users: [], state: 'ok', at: null }));
    return r;
  };
  for (const n of g.nodes) {
    if (n.type === 'well' && n.material) {
      const r = row(n.material);
      r.makers.push(n.id);
      r.can += wellRate(n);
      r.made += leaving(g, n.id, 0);
    } else if (isMachine(n)) {
      const rec = recipeOf(n);
      if (!rec) continue;
      const flat = 1 / cycleTime(n, rec);
      rec.outputs.forEach(([m, q], port) => {
        const r = row(m);
        r.makers.push(n.id);
        r.can += q * flat;
        r.made += leaving(g, n.id, port);
      });
      for (const [m, q] of rec.inputs) {
        const r = row(m);
        r.users.push(n.id);
        r.wanted += q * flat;
        r.used += arriving(g, n, m);
      }
    }
  }
  // Where the rest goes: by the wires into Markets, Labs and Dumps. (A wire that carries several materials is
  // counted for the one it carried last: a mixed stream into a Lab is rare, and this is a reading, not a rule.)
  for (const w of g.wires) {
    if (!w.mat || !(w.rate > 0)) continue;
    const to = c.byId.get(w.to);
    const r = rows.get(w.mat);
    if (!to || !r) continue;
    if (to.type === 'market') r.sold += w.rate;
    else if (to.type === 'lab') r.studied += w.rate;
    else if (to.type === 'void') r.dumped += w.rate;
  }
  for (const r of rows.values()) judge(g, r);
  return MAT_IDS.filter((m) => rows.has(m)).map((m) => rows.get(m)!);
}

/** A row's state, and the node to look at. */
function judge(g: Game, r: MatFlow) {
  const c = graph(g);
  const m = r.mat;
  // Short: a user stands waiting for it (settled, not just built), and gets clearly less of it than it would take.
  let waiting: GNode | null = null;
  let least = Infinity;
  for (const id of r.users) {
    const n = c.byId.get(id);
    if (!n || n.grace > 0 || n.status !== 'starved' || n.missing !== m) continue;
    const rec = recipeOf(n);
    const want = rec ? (rec.inputs.find((i) => i[0] === m)?.[1] ?? 0) / cycleTime(n, rec) : 0;
    const share = want > 0 ? arriving(g, n, m) / want : 1;
    if (share >= FLAT_OUT || share >= least) continue;
    waiting = n;
    least = share;
  }
  if (waiting) {
    r.state = 'short';
    // The maker that works flat out and still does not give enough; failing that any maker; failing that, who waits.
    let limit: GNode | null = null;
    for (const id of r.makers) {
      const n = c.byId.get(id);
      if (!n) continue;
      if (!limit || (n.util >= FLAT_OUT && limit.util < FLAT_OUT) || (n.util >= FLAT_OUT === limit.util >= FLAT_OUT && canMake(n, m) < canMake(limit, m))) limit = n;
    }
    r.at = (limit ?? waiting).id;
    return;
  }
  // Stuck or spare: a maker is full of it.
  let spare: GNode | null = null;
  for (const id of r.makers) {
    const n = c.byId.get(id);
    if (!n || n.grace > 0 || n.status !== 'blocked') continue;
    const rec = n.type === 'well' ? null : recipeOf(n);
    if (rec && n.blockedOn && n.blockedOn !== m) continue;
    const port = rec ? Math.max(0, rec.outputs.findIndex((o) => o[0] === m)) : 0;
    const wired = (c.outs.get(n.id)?.[port]?.length ?? 0) > 0;
    if (!wired) {
      r.state = 'stuck';
      r.at = n.id;
      return;
    }
    spare ??= n;
  }
  if (spare) r.state = 'spare';
}

/** The nodes and wires a material runs through: its makers, the machines that use it, every wire that carries it and what those wires end at. */
export function traceOf(g: Game, m: MatId): { nodes: Set<number>; wires: Set<number> } {
  const nodes = new Set<number>();
  const wires = new Set<number>();
  for (const n of g.nodes) {
    if (canMake(n, m) > 0) nodes.add(n.id);
    else if (isMachine(n) && recipeOf(n)?.inputs.some((i) => i[0] === m)) nodes.add(n.id);
  }
  const c = graph(g);
  // A wire carries it when it leaves a port that gives it, straight or through Routers, Mergers and Silos.
  const seen = new Set<string>();
  const follow = (from: number, port: number) => {
    const key = `${from}:${port}`;
    if (seen.has(key)) return;
    seen.add(key);
    for (const w of c.outs.get(from)?.[port] ?? []) {
      const to = c.byId.get(w.to);
      if (!to) continue;
      // (A Router's filtered wire carries one material only.)
      const src = c.byId.get(from);
      if (src?.type === 'router' && src.mode === 'filter' && w.filter && w.filter !== m) continue;
      wires.add(w.id);
      nodes.add(to.id);
      if (to.type === 'router' || to.type === 'merger' || to.type === 'silo') follow(to.id, 0);
    }
  };
  for (const n of g.nodes) {
    if (n.type === 'well' && n.material === m) follow(n.id, 0);
    else if (isMachine(n)) {
      const port = recipeOf(n)?.outputs.findIndex((o) => o[0] === m) ?? -1;
      if (port >= 0) follow(n.id, port);
    }
  }
  return { nodes, wires };
}

// Deterministic, DOM-free simulation. tick(game, dt) advances everything.
import { DataTier, MATERIALS, MatId, Recipe } from './content';
import {
  bufMult, cycleTime, dataYield, effEvery, grantTech, labRate, pipeCap, price, recipeOf, research, wellRate,
} from './economy';
import { Bag, Game, GNode, Status, Wire } from './state';

const EPS = 1e-9;

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

export function bagTotal(b: Bag): number {
  let t = 0;
  for (const k in b) t += b[k as MatId] ?? 0;
  return t;
}

export function passCap(n: GNode): number {
  return n.type === 'silo' ? 200 * bufMult(n) : 4;
}

/** How much of material m the node can take right now. */
export function room(g: Game, n: GNode, m: MatId): number {
  switch (n.type) {
    case 'well':
      return 0;
    case 'refiner':
    case 'assembler':
    case 'fabricator': {
      const r = recipeOf(n);
      if (!r) return 0;
      const need = r.inputs.find((i) => i[0] === m)?.[1] ?? 0;
      if (!need) return 0;
      return Math.max(0, need * 2 * bufMult(n) - (n.inb[m] ?? 0));
    }
    case 'router':
    case 'merger':
    case 'silo':
      // Each material gets its own space, so a surplus of one can never lock the others out.
      return Math.max(0, passCap(n) - (n.inb[m] ?? 0));
    case 'lab':
      return Math.max(0, Math.max(2, labRate(g, n)) - bagTotal(n.inb));
    case 'market':
    case 'void':
      return Infinity;
  }
}

export function outPortCount(n: GNode): number {
  if (isSink(n)) return 0;
  if (isMachine(n)) return recipeOf(n)?.outputs.length ?? 1;
  return 1;
}

/** Materials currently waiting at an output port. */
function portMats(n: GNode, port: number): MatId[] {
  if (n.type === 'well') return n.material ? [n.material] : [];
  if (isMachine(n)) {
    const m = recipeOf(n)?.outputs[port]?.[0];
    return m ? [m] : [];
  }
  if (isPass(n)) return (Object.keys(n.inb) as MatId[]).filter((m) => (n.inb[m] ?? 0) > EPS);
  return [];
}

function ema(prev: number, value: number, dt: number, tau: number) {
  return prev + (value - prev) * (1 - Math.exp(-dt / tau));
}

function markMade(g: Game, m: MatId) {
  if (g.made[m]) return;
  g.made[m] = true;
  const mat = MATERIALS[m];
  if (mat.tier >= 1) {
    const reward = Math.round(mat.value * 30);
    g.credits += reward;
    g.lifetime += reward;
    g.events.push({ kind: 'milestone', mat: m, reward });
  }
}

function setStatus(n: GNode, worked: number, inst: Status, dt: number) {
  const frac = dt > 0 ? worked / dt : 0;
  n.util = ema(n.util, frac, dt, 3);
  if (n.grace > 0 && inst !== 'idle') {
    n.grace -= dt;
    n.status = 'working';
    return;
  }
  n.fBlocked = ema(n.fBlocked, inst === 'blocked' ? 1 - frac : 0, dt, 3);
  n.fStarved = ema(n.fStarved, inst === 'starved' ? 1 - frac : 0, dt, 3);
  if (inst === 'idle') n.status = 'idle';
  else if (n.util >= 0.95 || (n.fBlocked < 0.03 && n.fStarved < 0.03)) n.status = 'working';
  else n.status = n.fBlocked >= n.fStarved ? 'blocked' : 'starved';
  // What it is waiting on stays set while the problem lasts, so the UI can name it.
  if (n.status === 'working') {
    n.missing = null;
    n.blockedOn = null;
  }
}

function produceWell(g: Game, n: GNode, dt: number) {
  if (!n.material) return setStatus(n, 0, 'idle', dt);
  const rate = wellRate(n);
  const cap = Math.max(2, rate * 2);
  const cur = n.outb[n.material] ?? 0;
  const add = Math.max(0, Math.min(rate * dt, cap - cur));
  n.outb[n.material] = cur + add;
  if (add > 0) markMade(g, n.material);
  n.rate = ema(n.rate, add / dt, dt, 1.5);
  if (add < rate * dt - EPS) n.blockedOn = n.material;
  setStatus(n, add / rate, add < rate * dt - EPS ? 'blocked' : 'working', dt);
}

function produceMachine(g: Game, n: GNode, r: Recipe | null, dt: number, hasInputs: boolean) {
  if (!r) {
    n.rate = 0;
    return setStatus(n, 0, 'idle', dt);
  }
  const T = cycleTime(n, r);
  const mult = bufMult(n);
  let left = dt;
  let worked = 0;
  let inst: Status = 'working';
  for (let guard = 0; left > EPS && guard < 64; guard++) {
    if (!n.crafting) {
      const full = r.outputs.find(([m, q]) => (n.outb[m] ?? 0) + q > q * 2 * mult + EPS);
      if (full) {
        inst = 'blocked';
        n.blockedOn = full[0];
        break;
      }
      const every = effEvery(n);
      const free = every > 0 && (n.cycles + 1) % every === 0;
      if (!free) {
        const lack = r.inputs.find(([m, q]) => (n.inb[m] ?? 0) < q - EPS);
        if (lack) {
          inst = hasInputs ? 'starved' : 'idle';
          n.missing = lack[0];
          break;
        }
        for (const [m, q] of r.inputs) n.inb[m] = (n.inb[m] ?? 0) - q;
      }
      n.crafting = true;
      n.prog = 0;
    }
    const step = Math.min(left, (1 - n.prog) * T);
    n.prog += step / T;
    left -= step;
    worked += step;
    if (n.prog >= 1 - 1e-6) {
      for (const [m, q] of r.outputs) {
        n.outb[m] = (n.outb[m] ?? 0) + q;
        markMade(g, m);
      }
      n.crafting = false;
      n.prog = 0;
      n.cycles++;
    }
  }
  setStatus(n, worked, inst, dt);
  // Crafting is bursty, so derive the displayed rate from utilisation instead of counting outputs.
  n.rate = (n.util * r.outputs[0][1]) / T;
}

function produceLab(g: Game, n: GNode, dt: number, hasInputs: boolean) {
  const budget = labRate(g, n) * dt;
  let left = budget;
  for (const k in n.inb) {
    const m = k as MatId;
    const have = n.inb[m] ?? 0;
    if (have <= EPS || left <= EPS) continue;
    const take = Math.min(have, left);
    n.inb[m] = have - take;
    left -= take;
    const y = dataYield(g, m);
    const amount = take * y.amount;
    g.data[y.tier] += amount;
    g.tickAcc.data[y.tier] += amount;
    n.gainB[y.tier] = (n.gainB[y.tier] ?? 0) + amount;
  }
  const used = budget - left;
  n.rate = ema(n.rate, used / dt, dt, 1.5);
  setStatus(n, (used / budget) * dt, !hasInputs ? 'idle' : used < budget - EPS ? 'starved' : 'working', dt);
  // A Lab that is merely under-fed is not a problem worth flagging.
  if (n.status === 'starved') n.status = n.rate > 0.01 ? 'working' : hasInputs ? 'starved' : 'idle';
}

function deliver(g: Game, w: Wire, dest: GNode, m: MatId, amt: number) {
  w.budget -= amt;
  w.flow += amt;
  if (w.mat && w.mat !== m && w.flow - amt > EPS) w.mixed = true;
  w.mat = m;
  if (dest.type === 'market') {
    const p = price(g, m);
    const earned = amt * p;
    g.credits += earned;
    g.lifetime += earned;
    g.tickAcc.credits += earned;
    g.tickAcc.sold[m] = (g.tickAcc.sold[m] ?? 0) + amt;
    g.sold[m] = (g.sold[m] ?? 0) + amt;
    dest.gain += earned;
    dest.prog += amt;
  } else if (dest.type === 'void') {
    dest.prog += amt;
  } else {
    dest.inb[m] = (dest.inb[m] ?? 0) + amt;
    if (dest.type !== 'lab') dest.prog += isMachine(dest) ? 0 : amt;
  }
}

/** Split `avail` of material m across the wires of one output port. Returns the amount moved. */
function distribute(g: Game, c: Graph, src: GNode, wires: Wire[], m: MatId, avail: number): number {
  const mode = src.type === 'router' ? src.mode : 'even';
  const n = wires.length;
  const dests: GNode[] = new Array(n);
  const demand: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const w = wires[i];
    const d = c.byId.get(w.to)!;
    dests[i] = d;
    if (mode === 'filter' && w.filter && w.filter !== m) demand[i] = 0;
    else demand[i] = Math.min(w.budget, room(g, d, m));
  }
  let remaining = avail;
  if (mode === 'priority') {
    for (let i = 0; i < n && remaining > EPS; i++) {
      const give = Math.min(remaining, demand[i]);
      if (give > EPS) {
        deliver(g, wires[i], dests[i], m, give);
        remaining -= give;
      }
    }
    return avail - remaining;
  }
  const given: number[] = new Array(n).fill(0);
  for (let pass = 0; pass < n && remaining > EPS; pass++) {
    let sumW = 0;
    for (let i = 0; i < n; i++) if (demand[i] - given[i] > EPS) sumW += mode === 'ratio' ? Math.max(0, wires[i].weight) : 1;
    if (sumW <= EPS) break;
    const pool = remaining;
    for (let i = 0; i < n; i++) {
      const open = demand[i] - given[i];
      if (open <= EPS) continue;
      const wgt = mode === 'ratio' ? Math.max(0, wires[i].weight) : 1;
      const give = Math.min(open, (pool * wgt) / sumW);
      given[i] += give;
      remaining -= give;
    }
  }
  for (let i = 0; i < n; i++) if (given[i] > EPS) deliver(g, wires[i], dests[i], m, given[i]);
  return avail - remaining;
}

function transferFrom(g: Game, c: Graph, n: GNode) {
  const ports = c.outs.get(n.id);
  if (!ports) return;
  const bag = isPass(n) ? n.inb : n.outb;
  for (let p = 0; p < ports.length; p++) {
    const wires = ports[p];
    if (!wires || !wires.length) continue;
    for (const m of portMats(n, p)) {
      const avail = bag[m] ?? 0;
      if (avail <= EPS) continue;
      const moved = distribute(g, c, n, wires, m, avail);
      bag[m] = avail - moved;
    }
  }
}

let rot = 0;

export function tick(g: Game, dt: number) {
  const c = graph(g);
  g.time += dt;
  const acc = g.tickAcc;
  acc.credits = 0;
  acc.data.a = acc.data.b = acc.data.g = 0;
  acc.sold = {};

  for (const w of g.wires) {
    w.budget = pipeCap(w.tier) * dt;
    w.flow = 0;
    w.mixed = false;
  }

  for (const n of g.nodes) {
    const hasInputs = (c.ins.get(n.id)?.length ?? 0) > 0;
    if (n.type === 'well') produceWell(g, n, dt);
    else if (isMachine(n)) produceMachine(g, n, recipeOf(n), dt, hasInputs);
    else if (n.type === 'lab') produceLab(g, n, dt, hasInputs);
    else n.prog = 0; // pass-through and sinks use prog as a per-tick throughput counter
  }

  const N = g.nodes.length;
  rot = (rot + 1) % Math.max(1, N);
  for (let i = 0; i < N; i++) transferFrom(g, c, g.nodes[(i + rot) % N]);

  for (const n of g.nodes) {
    if (isPass(n) || n.type === 'market' || n.type === 'void') {
      n.rate = ema(n.rate, n.prog / dt, dt, 1.5);
      const connected = (c.ins.get(n.id)?.length ?? 0) > 0;
      n.status = connected ? 'working' : 'idle';
      n.util = connected ? 1 : 0;
    }
  }

  for (const w of g.wires) w.rate = ema(w.rate, w.flow / dt, dt, 1.5);

  for (const k in MATERIALS) {
    const m = k as MatId;
    const sold = acc.sold[m] ?? 0;
    const prev = g.soldRate[m] ?? 0;
    if (sold > 0 || prev > 1e-4) g.soldRate[m] = ema(prev, sold / dt, dt, 4);
    else if (prev) g.soldRate[m] = 0;
  }
  g.creditRate = ema(g.creditRate, acc.credits / dt, dt, 3);
  for (const k of ['a', 'b', 'g'] as DataTier[]) g.dataRate[k] = ema(g.dataRate[k], acc.data[k] / dt, dt, 3);

  progress(g);
}

/** Milestone unlocks and the research queue. */
function progress(g: Game) {
  if (!g.techs.includes('P1') && g.lifetime >= 50) grantTech(g, 'P1');
  if (!g.techs.includes('R1') && (g.sold.shard ?? 0) > 0) grantTech(g, 'R1');
  if (g.queue.length) for (const id of [...g.queue]) research(g, id);
}

/**
 * Estimate earnings for time away: run the line briefly to reach steady state,
 * measure, then scale. Cheap and close enough for an idle game.
 */
export function offlineGains(g: Game, seconds: number) {
  const before = { credits: g.credits, a: g.data.a, b: g.data.b, g: g.data.g, lifetime: g.lifetime };
  const warm = 90;
  const dt = 0.1;
  for (let t = 0; t < warm; t += dt) tick(g, dt);
  const mid = { credits: g.credits, a: g.data.a, b: g.data.b, g: g.data.g };
  const sample = 60;
  for (let t = 0; t < sample; t += dt) tick(g, dt);
  const per = {
    credits: (g.credits - mid.credits) / sample,
    a: (g.data.a - mid.a) / sample,
    b: (g.data.b - mid.b) / sample,
    g: (g.data.g - mid.g) / sample,
  };
  const gains = { credits: per.credits * seconds, a: per.a * seconds, b: per.b * seconds, g: per.g * seconds };
  g.credits = before.credits + gains.credits;
  g.lifetime = before.lifetime + gains.credits;
  g.data.a = before.a + gains.a;
  g.data.b = before.b + gains.b;
  g.data.g = before.g + gains.g;
  for (const n of g.nodes) {
    n.gain = 0;
    n.gainB = {};
  }
  return gains;
}

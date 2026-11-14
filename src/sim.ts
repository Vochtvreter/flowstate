// Deterministic, DOM-free simulation. tick(game, dt) advances everything.
import { DataTier, MATERIALS, MatId, RULES, Recipe } from './content';
import {
  bufMult, cycleTime, dataYield, demandBurst, effEvery, endDemo, labRate, offlineCap, pipeCap, recipeOf, refillDemand, research, sellValue, wellRate,
} from './economy';
import { updateFlow } from './flow';
import { tickGoal } from './goals';
import { Graph, graph, isMachine, isPass, isSink, leadsToMachine } from './graph';
import { tickOrders } from './orders';
import { Bag, Game, GNode, Status, Wire, cloneGame } from './state';

export { graph, isMachine, isPass, isSink };
export type { Graph };

const EPS = 1e-9;

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
  g.madeAt[m] = g.time;
  // Goals pay for firsts now; this only lets the UI announce a new material.
  g.events.push({ kind: 'milestone', mat: m, reward: 0 });
  if (m === RULES.capstone) endDemo(g);
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

/** Per game: for each material, when its current run of over-demand sales began and when the latest one was. */
const surplusRuns = new WeakMap<Game, Map<MatId, { since: number; last: number }>>();

/**
 * Called with every sale that went (partly) over demand. The first material to keep that up for a few
 * seconds sets g.seenSurplus and raises the one-off 'surplus' event (RULES.demand.notice).
 */
function noteSurplus(g: Game, m: MatId) {
  if (g.seenSurplus) return;
  const N = RULES.demand.notice;
  let runs = surplusRuns.get(g);
  if (!runs) surplusRuns.set(g, (runs = new Map()));
  const run = runs.get(m);
  if (!run || g.time - run.last > N.gap) {
    runs.set(m, { since: g.time, last: g.time });
    return;
  }
  run.last = g.time;
  if (g.time - run.since < N.seconds) return;
  g.seenSurplus = true;
  surplusRuns.delete(g);
  const share = Math.round(RULES.demand.surplusShare * 100);
  g.events.push({
    kind: 'surplus', mat: m,
    text: `${MATERIALS[m].name} is selling faster than Markets want it: the extra goes for ${share}% of the price.`,
  });
}

function deliver(g: Game, w: Wire, dest: GNode, m: MatId, amt: number) {
  w.budget -= amt;
  w.flow += amt;
  if (w.mat && w.mat !== m && w.flow - amt > EPS) w.mixed = true;
  w.mat = m;
  if (dest.type === 'market') {
    // The one place sales are paid: full price up to demand, the surplus price beyond, times the Flow bonus.
    if (!g.seenSurplus && amt > (g.demandLeft[m] ?? demandBurst(g, m)) + EPS) noteSurplus(g, m);
    const earned = sellValue(g, m, amt);
    g.credits += earned;
    g.lifetime += earned;
    g.stats.fromSales += earned;
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

/**
 * Water-fill `remaining` across the wires picked by `include`, by weight, never past what each can take.
 * Adds to `given` and returns what is left over.
 */
function share(
  wires: Wire[], demand: number[], given: number[], remaining: number, weighted: boolean, include: (i: number) => boolean,
): number {
  const n = wires.length;
  for (let pass = 0; pass < n && remaining > EPS; pass++) {
    let sumW = 0;
    for (let i = 0; i < n; i++) {
      if (include(i) && demand[i] - given[i] > EPS) sumW += weighted ? Math.max(0, wires[i].weight) : 1;
    }
    if (sumW <= EPS) break;
    const pool = remaining;
    for (let i = 0; i < n; i++) {
      if (!include(i)) continue;
      const open = demand[i] - given[i];
      if (open <= EPS) continue;
      const wgt = weighted ? Math.max(0, wires[i].weight) : 1;
      const give = Math.min(open, (pool * wgt) / sumW);
      given[i] += give;
      remaining -= give;
    }
  }
  return remaining;
}

/**
 * Is this destination served before Markets, Labs and Voids on a plain port? (RULES.fanOut)
 * Machines always are. A Router, Merger or Silo is when it leads on to a machine; one whose every path ends
 * at Markets, Labs, Voids or nowhere waits with them (unless RULES.fanOut.deadEndJunctionsLast is off).
 */
function fedFirst(c: Graph, d: GNode): boolean {
  if (isMachine(d)) return true;
  if (!isPass(d)) return false;
  return !RULES.fanOut.deadEndJunctionsLast || leadsToMachine(c, d.id);
}

/**
 * Split `avail` of material m across the wires of one output port. Returns the amount moved.
 *
 * A plain port (anything but a Router) feeds machines first, evenly, together with any Router, Merger or
 * Silo that leads on to a machine; Markets, Labs, Voids and the junctions that only lead to those share
 * whatever is left. A Router follows its mode; its Even mode is truly even.
 */
function distribute(g: Game, c: Graph, src: GNode, wires: Wire[], m: MatId, avail: number): number {
  const router = src.type === 'router';
  const mode = router ? src.mode : 'even';
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
  if (router) remaining = share(wires, demand, given, remaining, mode === 'ratio', () => true);
  else {
    const first = dests.map((d) => fedFirst(c, d));
    remaining = share(wires, demand, given, remaining, false, (i) => first[i]);
    remaining = share(wires, demand, given, remaining, false, (i) => !first[i]);
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

/**
 * The rate over a run of whole gulps (items, seconds, items, seconds..., oldest first), and the longest of them.
 * If the gulps repeat in rounds of k, the newest k are one round of the pattern and its rate is exact: a
 * Refiner feeding an Assembler and a Market hands over items every 4, 2, 4, 2 seconds. With no repeat, the
 * most recent gulps lasting RULES.wires.rate.window together are averaged.
 */
function gulpRate(past: number[], dt: number): { est: number; max: number } {
  const R = RULES.wires.rate;
  const m = past.length / 2;
  let max = 0;
  for (let i = 1; i < past.length; i += 2) max = Math.max(max, past[i]);
  const same = (a: number, b: number) =>
    Math.abs(past[2 * a] - past[2 * b]) <= 0.02 * past[2 * a] + 1e-6 && Math.abs(past[2 * a + 1] - past[2 * b + 1]) <= 2 * dt + 1e-6;
  // How many of the newest gulps make up the last `window` seconds (all of them, if they are shorter than that).
  let recent = 0;
  for (let seconds = 0; recent < m && seconds < R.window; recent++) seconds += past[2 * (m - 1 - recent) + 1];
  // A round of k gulps must repeat at least once, and hold over the last six gulps and over everything in the
  // window: two equal gulps in a row are not yet a pattern of one, and neither are six when the seventh of
  // every round is a different one (a Router topping up a full Silo).
  let take = 0;
  for (let k = 1; k <= m / 2 && !take; k++) {
    const back = Math.min(m, Math.max(2 * k, 6, recent));
    let repeats = true;
    for (let i = m - back + k; i < m && repeats; i++) repeats = same(i, i - k);
    if (repeats) take = k;
  }
  let items = 0;
  let seconds = 0;
  for (let i = m - 1; i >= 0 && (take ? i >= m - take : seconds < R.window); i--) {
    items += past[2 * i];
    seconds += past[2 * i + 1];
  }
  return { est: seconds > 0 ? items / seconds : 0, max };
}

/**
 * Update a wire's displayed rate from what it carried this tick (w.flow). Display only: nothing reads it back.
 *
 * Steady flow is smoothed directly, as it always was. Flow that comes in gulps (a machine taking two inputs
 * per craft, a Refiner handing over one whole item) is measured gulp by gulp instead: from one start of flow
 * to the next, and the rate is the items over the seconds of one round of the pattern (gulpRate). For a
 * pattern that repeats that is exactly the long-run rate, with no swing; it settles one gulp after the
 * pattern starts and lets go when the next gulp is overdue (the flow stopped, or stopped pausing).
 */
function measureWire(w: Wire, dt: number) {
  const R = RULES.wires.rate;
  const u = (w.gulp ??= { n: 0, t: 0, on: 0, idle: 1, armed: false, past: [], est: 0, max: 0 });
  const flowing = w.flow > EPS;
  if (flowing) {
    if (u.idle > 0) {
      // Flow starts after a pause: the gulp that began at the last start is whole.
      if (u.armed && u.t <= R.longest) {
        u.past.push(u.n, u.t);
        if (u.past.length > 2 * R.gulps) u.past.splice(0, u.past.length - 2 * R.gulps);
        const r = gulpRate(u.past, dt);
        u.est = r.est;
        u.max = r.max;
      } else u.past.length = 0;
      u.armed = true;
      u.n = 0;
      u.t = 0;
      u.on = 0;
    }
    u.on += dt;
    u.idle = 0;
  } else u.idle += dt;
  u.n += w.flow;
  u.t += dt;
  if (u.on > R.steadyAfter) {
    // No pause for a long while: steady flow. Whatever comes after the next pause is not a whole gulp.
    u.past.length = 0;
    u.armed = false;
  }
  // The next gulp is overdue: the pattern is gone, measure directly again.
  if (u.past.length && u.t > R.overdue * u.max + dt) u.past.length = 0;
  w.rate = ema(w.rate, u.past.length ? u.est : w.flow / dt, dt, R.smooth);
}

/** Ticks run per game, so the order nodes hand items on rotates the same way for every game. */
const tickCount = new WeakMap<Game, number>();

export function tick(g: Game, dt: number) {
  // Every rate divides by dt: a zero, negative or broken step would turn them all into NaN.
  if (!(dt > 0) || !isFinite(dt)) return;
  const c = graph(g);
  g.time += dt;
  const acc = g.tickAcc;
  acc.credits = 0;
  acc.data.a = acc.data.b = acc.data.g = 0;
  acc.sold = {};
  refillDemand(g, dt);

  for (const w of g.wires) {
    // What the wire may carry this tick: its capacity for the tick, plus what it left unused over the last moment.
    const cap = pipeCap(w.tier);
    w.budget = Math.min(cap * Math.max(dt, RULES.wires.burstSeconds), Math.max(0, w.budget || 0) + cap * dt);
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
  const ticks = (tickCount.get(g) ?? 0) + 1;
  tickCount.set(g, ticks);
  const rot = ticks % Math.max(1, N);
  for (let i = 0; i < N; i++) transferFrom(g, c, g.nodes[(i + rot) % N]);

  for (const n of g.nodes) {
    if (isPass(n) || n.type === 'market' || n.type === 'void') {
      n.rate = ema(n.rate, n.prog / dt, dt, 1.5);
      const connected = (c.ins.get(n.id)?.length ?? 0) > 0;
      n.status = connected ? 'working' : 'idle';
      n.util = connected ? 1 : 0;
    }
  }

  for (const w of g.wires) measureWire(w, dt);

  for (const k in MATERIALS) {
    const m = k as MatId;
    const sold = acc.sold[m] ?? 0;
    const prev = g.soldRate[m] ?? 0;
    if (sold > 0 || prev > 1e-4) g.soldRate[m] = ema(prev, sold / dt, dt, 4);
    else if (prev) g.soldRate[m] = 0;
  }
  g.creditRate = ema(g.creditRate, acc.credits / dt, dt, 3);
  for (const k of ['a', 'b', 'g'] as DataTier[]) g.dataRate[k] = ema(g.dataRate[k], acc.data[k] / dt, dt, 3);

  progress(g, dt);
}

/** The research queue, Flow, the active order and the active goal. */
function progress(g: Game, dt: number) {
  if (g.queue.length) for (const id of [...g.queue]) research(g, id);
  updateFlow(g, dt);
  tickOrders(g);
  tickGoal(g);
}

export interface AwayGains { credits: number; a: number; b: number; g: number }

/**
 * Earnings for time away. Pays nothing until the demo has ended (a pitch is one sitting).
 * After that a COPY of the game is run briefly to reach steady state and measured; the live game
 * only receives the result: RULES.away.share of the measured rate for `seconds`, capped by offlineCap().
 */
export function offlineGains(g: Game, seconds: number): AwayGains {
  const gains: AwayGains = { credits: 0, a: 0, b: 0, g: 0 };
  if (!g.ended || !(seconds > 0)) return gains;
  const copy = cloneGame(g);
  if (!copy) return gains;
  const A = RULES.away;
  copy.queue = []; // the estimate must not research anything
  for (let t = 0; t < A.warmup; t += A.step) tick(copy, A.step);
  const sum: AwayGains = { credits: 0, a: 0, b: 0, g: 0 };
  let sampled = 0;
  for (; sampled < A.sample; sampled += A.step) {
    tick(copy, A.step);
    sum.credits += copy.tickAcc.credits;
    sum.a += copy.tickAcc.data.a;
    sum.b += copy.tickAcc.data.b;
    sum.g += copy.tickAcc.data.g;
  }
  const k = (A.share * Math.min(seconds, offlineCap(g))) / sampled;
  gains.credits = sum.credits * k;
  gains.a = sum.a * k;
  gains.b = sum.b * k;
  gains.g = sum.g * k;
  g.credits += gains.credits;
  g.lifetime += gains.credits;
  g.stats.fromAway += gains.credits;
  g.data.a += gains.a;
  g.data.b += gains.b;
  g.data.g += gains.g;
  return gains;
}

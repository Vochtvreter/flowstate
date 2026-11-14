// The adviser: when the player is waiting (saving credits or Data for what the goal card asks, holding
// Flow, or filling an order), name the single most useful thing they can do right now. DOM-free.
//
// A tip is never a rule of thumb. Every candidate is tried on a copy of the game (src/forecast.ts): one copy
// gets the action, an untouched copy gets nothing, both run forward with the real rules, and the tip is only
// given if the wait really ends sooner with it. Tips are ranked by the seconds they save. That costs
// simulation time, so a verdict is kept for a while (ADVICE.refresh) and until the board changes: a call
// that has to work one out takes some tens of milliseconds, every other call is free.
//
//   waitInfo(g)       what the goal card is waiting for, and how long that takes at the current income
//   advice(g)         one tip, or null
//   applyAdvice(g, a) do what the tip says, through the normal actions (for bots and tests)
//
// In the copies nobody plays: nothing is bought or researched, the order the game has is claimed the moment
// it fills, and no new order is rolled (what the next one asks for is luck).
import {
  act, connect, cutWire, favour, favouredWire, freeDeposits, materialsAt, pickRecipe, placeNode, upgrade, upgradeAll,
} from './actions';
import { DATA_NAMES, DATA_YIELD, DataTier, MATERIALS, MAT_IDS, MatId, NODE_DEFS, NodeType, TECHS, Track } from './content';
import {
  costText, dataYield, demandInfo, has, labRate, maxLevel, nodeCost, recipeOf, research, techAffordable, techAvailable, trackAvailable,
  upgradeCost, wellRate,
} from './economy';
import { countsForFlow, isFlowing } from './flow';
import { Forecast, forecast, lookahead } from './forecast';
import { activeGoal } from './goals';
import { graph, isMachine } from './graph';
import { claimOrder, orderReachesMarket } from './orders';
import { tick } from './sim';
import { Game, GNode, Wire } from './state';

export interface Advice {
  /** What is short: credits, Data, or Flow. (A tip about the order counts as credits: orders are filled by selling.) */
  kind: 'credits' | 'data' | 'flow';
  /** One short sentence for mouse and keyboard, and one for touch (no key names, "tap" not "click"). */
  text: { mouse: string; touch: string };
  /** The node to show the player, if the advice is about one: the node to upgrade, the node whose port to wire or build from, the Router. */
  node?: number;
  /** A node type to build, if the advice is to build something. */
  build?: string;
  /** Seconds the current wait would take if nothing changed (Infinity when it would never end). */
  eta: number;
  /**
   * Seconds the tip saves on the current wait, as measured (Infinity when the wait would not end without it).
   * Absent for a Flow tip that helps without finishing the goal on its own.
   */
  saves?: number;
  /** Credits the action costs (0 for a wire or a Router setting; a tech's price is in its text). */
  cost?: number;
  /** The upgrade track to highlight on `node`. With `all`, the tip is the "upgrade all" button for that kind of node. */
  upgrade?: Track;
  all?: boolean;
  /** Connect two existing nodes: from `from`'s output port `port` (0 when absent) to `to`. */
  wire?: { from: number; to: number; port?: number };
  /** With `build`: the output port of `node` to build from, or the deposit to put a Well on... */
  port?: number;
  deposit?: number;
  /** ...the recipe of a machine that is built, and the existing node the new one is then wired to. */
  recipe?: string;
  to?: number;
  /** Press Favour on this wire of this Router (`node` is the Router too). */
  favour?: { router: number; wire: number };
  /** Research this tech. */
  research?: string;
  /** Remove this wire (it runs from `from` to `to`; `node` is `from`). */
  cut?: { wire: number; from: number; to: number };
  /** Gestures the tip takes: 1, or 2 when something is built and then wired on. */
  steps?: number;
}

export interface WaitInfo {
  /** What is being waited for: credits or one kind of Data. For a tech with two prices, the one that takes longest. */
  unit: '¢' | 'α' | 'β' | 'γ';
  have: number;
  need: number;
  /** Seconds until `have` reaches `need` at the current income from sales and Labs. Infinity at zero income. */
  eta: number;
}

/** Tunables of the adviser. Times are game seconds. */
export const ADVICE = {
  /** Step of the look-ahead copies. The simulation gives the same totals at any step up to a second. */
  step: 0.5,
  /** Every candidate is tried for this long; the best two are then run on until the wait ends... */
  screen: 40,
  /** ...or until this long has passed. Beyond it the end of the wait is worked out from the income at that point. */
  horizon: 300,
  /** Flow tips are judged over this long: a fix, 20 s for anything new to count, and the goal's 10 s. */
  flowScreen: 50,
  /** No tip for a wait that ends within this time anyway. */
  minWait: 12,
  /** A tip must save at least this many seconds, and this share of the wait. */
  minSaves: 5,
  minShare: 0.03,
  /** A verdict (a tip, or none) is kept this long while the board does not change. */
  refresh: 15,
  /** At most this many candidates are tried. */
  candidates: 14,
  /** A Lab or machine at this utilisation or more is "full": faster would help. */
  full: 0.85,
};

// =====================================================================================
// What is being waited for
// =====================================================================================

type Purse = { credits: number; a: number; b: number; g: number };
const TIERS: DataTier[] = ['a', 'b', 'g'];
const UNIT: Record<keyof Purse, WaitInfo['unit']> = { credits: '¢', a: 'α', b: 'β', g: 'γ' };
const KEYS = ['credits', 'a', 'b', 'g'] as (keyof Purse)[];

interface Wait {
  kind: 'credits' | 'data' | 'flow' | 'order';
  /** Index of the goal the wait belongs to. */
  goal: number;
  /** For credits and Data: what has to be in hand. */
  need: Purse;
  /** For an order: how many had been filled when the wait was looked at. */
  filled: number;
}

const have = (g: Game, k: keyof Purse) => (k === 'credits' ? g.credits : g.data[k]);

/** The wait the active goal is in, or null: it is ready, asks for an action, or can be paid for right now. */
function currentWait(g: Game): Wait | null {
  const goal = activeGoal(g);
  if (!goal || g.goal.ready) return null;
  const need: Purse = { credits: 0, a: 0, b: 0, g: 0 };
  const base = { goal: g.goal.i, need, filled: g.stats.ordersFilled };
  const step = goal.step?.(g) ?? null;
  if (step) {
    if ('tech' in step) {
      const t = TECHS[step.tech];
      if (!t || techAffordable(g, t)) return null;
      for (const k of TIERS) need[k] = t.cost[k] ?? 0;
      return { kind: 'data', ...base };
    }
    if (g.credits >= step.credits - 1e-6) return null;
    need.credits = step.credits;
    return { kind: 'credits', ...base };
  }
  // A goal that counts credits or Data without a purchase behind it ("Study Glyph for β").
  const p = goal.progress?.(g) ?? null;
  if (p && p[0] < p[1] - 1e-9) {
    const k = KEYS.find((x) => UNIT[x] === p[2]);
    if (k) {
      need[k] = p[1];
      return { kind: k === 'credits' ? 'credits' : 'data', ...base };
    }
  }
  if (goal.id === 'hold-flow') return { kind: 'flow', ...base };
  if ((goal.id === 'first-order' || goal.id === 'three-orders') && g.ordersOn && g.order && !g.order.ready) return { kind: 'order', ...base };
  return null;
}

/**
 * What the active goal is waiting on, if anything: 'credits' or 'data' (saving for what the card asks: see
 * waitInfo), 'flow' (the Flow goal) or 'order' (an order goal whose order is still being filled). null when
 * the card asks for an action, or is ready to claim. The interface can start its "show a tip" timer on this.
 */
export function waitKind(g: Game): 'credits' | 'data' | 'flow' | 'order' | null {
  return currentWait(g)?.kind ?? null;
}

/** Has this wait ended in `g` (a copy that has been run forward)? */
function over(g: Game, w: Wait): boolean {
  if (g.goal.i !== w.goal || g.goal.ready) return true;
  if (w.kind === 'order') return g.stats.ordersFilled > w.filled;
  if (w.kind === 'flow') return false;
  const now = currentWait(g);
  return !now || now.kind !== w.kind;
}

/** The income a wait is measured against, kept for a while so that a card showing the ETA does not pay for a forecast per frame. */
const steady = new WeakMap<Game, { rev: number; time: number; f: Forecast }>();
function income(g: Game): Forecast {
  const hit = steady.get(g);
  if (hit && hit.rev === g.rev && g.time >= hit.time && g.time - hit.time < ADVICE.refresh) return hit.f;
  const f = forecast(g);
  steady.set(g, { rev: g.rev, time: g.time, f });
  return f;
}

/**
 * When the active goal is a wait for credits or Data: what is being waited for and how long it will take at
 * the current income. null when the goal is ready, asks for something else, or can be paid for now.
 */
export function waitInfo(g: Game): WaitInfo | null {
  const w = currentWait(g);
  if (!w || (w.kind !== 'credits' && w.kind !== 'data')) return null;
  const f = income(g);
  let worst: WaitInfo | null = null;
  let worstShare = Infinity;
  for (const k of KEYS) {
    if (w.need[k] <= 0) continue;
    const got = Math.min(have(g, k), w.need[k]);
    const rate = k === 'credits' ? f.credits : f.data[k];
    const missing = w.need[k] - got;
    const eta = missing <= 1e-9 ? 0 : rate > 1e-6 ? missing / rate : Infinity;
    const share = got / w.need[k];
    if (!worst || eta > worst.eta || (eta === worst.eta && share < worstShare)) {
      worst = { unit: UNIT[k], have: got, need: w.need[k], eta };
      worstShare = share;
    }
  }
  return worst;
}

// =====================================================================================
// Looking at the board
// =====================================================================================

interface Port { n: GNode; port: number; mat: MatId }

const node = (g: Game, id: number) => graph(g).byId.get(id) ?? null;
const outs = (g: Game, n: GNode, port = 0): Wire[] => graph(g).outs.get(n.id)?.[port] ?? [];
const ins = (g: Game, n: GNode): Wire[] => graph(g).ins.get(n.id) ?? [];
const machineAt = (g: Game, id: number) => {
  const n = node(g, id);
  return !!n && isMachine(n);
};

/** Every output port of a Well or machine, with the material it gives. */
function ports(g: Game): Port[] {
  const list: Port[] = [];
  for (const n of g.nodes) {
    if (n.type === 'well') {
      if (n.material) list.push({ n, port: 0, mat: n.material });
    } else if (isMachine(n)) {
      (recipeOf(n)?.outputs ?? []).forEach(([mat], port) => list.push({ n, port, mat }));
    }
  }
  return list;
}

/** Items per second this port could still give: what it sends to anything but a machine, plus what its node holds back. */
function spare(g: Game, p: Port): number {
  let s = 0;
  for (const w of outs(g, p.n, p.port)) if (!machineAt(g, w.to)) s += w.rate;
  const r = recipeOf(p.n);
  const full = p.n.type === 'well' ? wellRate(p.n) : r ? (r.outputs[p.port]?.[1] ?? 1) / (r.time * Math.pow(0.85, p.n.lv.speed)) : 0;
  return s + Math.max(0, full * (1 - p.n.util));
}

function nounOf(n: GNode): string {
  if (n.type === 'well') return `${n.material ? MATERIALS[n.material].name + ' ' : ''}Well`;
  const r = recipeOf(n);
  return `${r ? r.name + ' ' : ''}${NODE_DEFS[n.type].name}`;
}

/** "the Ink Refiner", or "a Glint Well" when the board has several of that name. */
function the(g: Game, n: GNode): string {
  const noun = nounOf(n);
  let same = 0;
  for (const x of g.nodes) if (nounOf(x) === noun) same++;
  return same > 1 ? an(noun) : `the ${noun}`;
}

/** "the Ink Refiner's port", or "...'s Silt port" on a machine with two outputs. */
function portName(g: Game, p: Port): string {
  const many = (recipeOf(p.n)?.outputs.length ?? 1) > 1;
  return `${the(g, p.n)}'s ${many ? MATERIALS[p.mat].name + ' ' : ''}port`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const an = (noun: string) => `${/^[AEIOU]/.test(noun) ? 'an' : 'a'} ${noun}`;
const price = (c: number) => `${Math.round(c)}¢`;

/** Does a wire from this port to this node exist already? Does the port feed any node of this type? */
const wired = (g: Game, p: Port, to: GNode) => outs(g, p.n, p.port).some((w) => w.to === to.id);
const feeds = (g: Game, p: Port, type: NodeType) => outs(g, p.n, p.port).some((w) => node(g, w.to)?.type === type);

/** Nodes from which a node of one of these types can be reached along wires. */
function upstreamOf(g: Game, types: NodeType[]): Set<number> {
  const c = graph(g);
  const seen = new Set<number>();
  const queue = g.nodes.filter((n) => types.includes(n.type)).map((n) => n.id);
  while (queue.length) {
    for (const w of c.ins.get(queue.pop()!) ?? []) {
      if (!seen.has(w.from)) {
        seen.add(w.from);
        queue.push(w.from);
      }
    }
  }
  return seen;
}

/** A material selling over its demand right now, if any: the one losing the most to the surplus price. */
function overDemand(g: Game): MatId | null {
  let worst: MatId | null = null;
  let loss = 0.02;
  for (const m of MAT_IDS) {
    const d = demandInfo(g, m);
    const l = d.surplusRate * (d.unitPrice - d.surplusPrice);
    if (d.surplusRate > 0.02 && l > loss) {
      worst = m;
      loss = l;
    }
  }
  return worst;
}

// =====================================================================================
// Candidates: everything that might help, each with the words for it
// =====================================================================================

type Act =
  | { t: 'upgrade'; node: number; track: Track; all: boolean }
  | { t: 'wire'; from: number; port: number; to: number }
  | { t: 'build'; type: NodeType; from?: number; port?: number; deposit?: number; to?: number; recipe?: string }
  | { t: 'favour'; router: number; wire: number }
  | { t: 'research'; tech: string }
  | { t: 'cut'; wire: number };

interface Cand {
  act: Act;
  /** Credits it costs. */
  cost: number;
  /** A rough guess at how much it helps. Only decides which candidates get tried when there are too many. */
  hope: number;
  /** The words: `mouse` and `touch` say how, `why` what for. A Flow tip names the culprit first (`lead`), and `why` is what is wrong with it. */
  mouse: string;
  touch: string;
  why: string;
  lead?: string;
  /** The node the tip points at. */
  show?: number;
}

/** Do what a candidate says. A build with its wires is one undo step and is rolled back if any part fails. */
function perform(g: Game, a: Act): boolean {
  switch (a.t) {
    case 'upgrade': {
      const n = node(g, a.node);
      if (!n) return false;
      return a.all ? upgradeAll(g, n.type, a.track) > 0 : upgrade(g, a.node, a.track);
    }
    case 'wire':
      return !!connect(g, a.from, a.port, a.to);
    case 'favour':
      return favour(g, a.router, a.wire);
    case 'research':
      return research(g, a.tech);
    case 'cut':
      return cutWire(g, a.wire);
    case 'build':
      return act(g, () => {
        const src = a.from != null ? node(g, a.from) : null;
        const dep = a.deposit != null ? g.deposits.find((d) => d.id === a.deposit) : null;
        const at = dep ? { x: dep.x, y: dep.y } : { x: Math.min(g.board.w - 200, (src?.x ?? 300) + 240), y: (src?.y ?? 100) + 40 };
        const n = placeNode(g, a.type, at.x, at.y, { depositId: a.deposit, recipe: a.recipe });
        if (!n) return false;
        if (src && !connect(g, src.id, a.port ?? 0, n.id)) return false;
        if (a.to != null && !connect(g, n.id, 0, a.to)) return false;
        return 0;
      });
  }
}

/** A wire from a port to an existing node. */
function wireCand(g: Game, p: Port, to: GNode, hope: number, why: string): Cand {
  return {
    act: { t: 'wire', from: p.n.id, port: p.port, to: to.id }, cost: 0, hope, show: p.n.id, why,
    mouse: `Drag from ${portName(g, p)} to ${the(g, to)}`,
    touch: `Tap ${portName(g, p)}, then tap ${the(g, to)}`,
  };
}

function speedCand(g: Game, n: GNode, hope: number, why: string): Cand | null {
  if (!trackAvailable(g, n, 'speed') || n.lv.speed >= maxLevel(g, 'speed')) return null;
  const cost = upgradeCost(n, 'speed');
  if (cost > g.credits + 1e-6) return null;
  return {
    act: { t: 'upgrade', node: n.id, track: 'speed', all: false }, cost, hope, show: n.id, why,
    mouse: `Click ${the(g, n)} and buy Speed (${price(cost)})`,
    touch: `Tap ${the(g, n)} and buy Speed (${price(cost)})`,
  };
}

/** "Upgrade all" on Speed for one kind of node (needs Bulk Upgrade): one level each, cheapest first, while credits last. */
function bulkCand(g: Game, type: NodeType, hope: number, why: string): Cand | null {
  if (!has(g, 'S1')) return null;
  const nodes = g.nodes.filter((n) => n.type === type && n.lv.speed < maxLevel(g, 'speed')).sort((a, b) => a.lv.speed - b.lv.speed);
  let cost = 0;
  let count = 0;
  for (const n of nodes) {
    const c = upgradeCost(n, 'speed');
    if (cost + c > g.credits + 1e-6) continue;
    cost += c;
    count++;
  }
  if (count < 2) return null;
  const name = NODE_DEFS[type].name;
  return {
    act: { t: 'upgrade', node: nodes[0].id, track: 'speed', all: true }, cost, hope, show: nodes[0].id, why,
    mouse: `Click ${an(name)} and press Upgrade all on Speed (${price(cost)})`,
    touch: `Tap ${an(name)} and tap Upgrade all on Speed (${price(cost)})`,
  };
}

function favourCand(g: Game, router: GNode, w: Wire, hope: number, why: string): Cand {
  const to = nounOf(node(g, w.to)!);
  return {
    act: { t: 'favour', router: router.id, wire: w.id }, cost: 0, hope, show: router.id, why,
    mouse: `Select the Router and press Favour on the ${to}'s wire`,
    touch: `Tap the Router, then tap Favour on the ${to}'s wire`,
  };
}

function researchCand(g: Game, id: string, hope: number, why: string): Cand | null {
  const t = TECHS[id];
  if (!t || !techAvailable(g, t) || !techAffordable(g, t)) return null;
  return {
    act: { t: 'research', tech: id }, cost: 0, hope, why,
    mouse: `Open the Tech tree and research ${t.name} (${costText(t)})`,
    touch: `Tap Tech and research ${t.name} (${costText(t)})`,
  };
}

/** Take a wire away: what went down it goes to the port's other wires instead. */
function cutCand(g: Game, w: Wire, hope: number, why: string): Cand {
  const from = node(g, w.from)!;
  const to = node(g, w.to)!;
  return {
    act: { t: 'cut', wire: w.id }, cost: 0, hope, show: from.id, why,
    mouse: `Select the wire from ${the(g, from)} to ${the(g, to)} and remove it`,
    touch: `Tap the wire from ${the(g, from)} to ${the(g, to)} and remove it`,
  };
}

/**
 * Is there still something to research with this kind of Data that the player cannot pay for yet? Only techs
 * that could be researched now count, and only if the player has met every kind of Data they cost (nothing
 * priced in γ can be bought before the first Lens, however much α is studied).
 */
function dataWanted(g: Game, tier: DataTier): boolean {
  const known = (k: DataTier) => k === 'a' || MAT_IDS.some((m) => g.made[m] && DATA_YIELD[MATERIALS[m].tier].tier === k);
  for (const t of Object.values(TECHS)) {
    if (!techAvailable(g, t) || (t.cost[tier] ?? 0) <= g.data[tier]) continue;
    if (TIERS.every((k) => !t.cost[k] || known(k))) return true;
  }
  return false;
}

/** A Lab built from a port: one gesture. */
function labCand(g: Game, p: Port, hope: number, why: string): Cand | null {
  const cost = nodeCost(g, 'lab');
  if (!has(g, NODE_DEFS.lab.tech) || cost > g.credits + 1e-6) return null;
  return {
    act: { t: 'build', type: 'lab', from: p.n.id, port: p.port }, cost, hope, show: p.n.id, why,
    mouse: `Drag from ${portName(g, p)} into empty space and pick Lab (${price(cost)})`,
    touch: `Tap ${portName(g, p)}, tap an empty spot and pick Lab (${price(cost)})`,
  };
}

/** A Well on a free deposit, wired to something that wants what it gives: two gestures. */
function wellCand(g: Game, deposit: { id: number; mat: MatId }, to: GNode, hope: number, why: string): Cand | null {
  const cost = nodeCost(g, 'well');
  if (cost > g.credits + 1e-6) return null;
  const mat = MATERIALS[deposit.mat].name;
  return {
    act: { t: 'build', type: 'well', deposit: deposit.id, to: to.id }, cost, hope, why,
    mouse: `Place a Well on the free ${mat} deposit (${price(cost)}) and drag from its port to ${the(g, to)}`,
    touch: `Place a Well on the free ${mat} deposit (${price(cost)}), then tap its port and tap ${the(g, to)}`,
  };
}

/** A Refiner built from a Well that sells its raw material, wired on to the Market: two gestures. */
function refinerCand(g: Game, p: Port, to: GNode, hope: number): Cand | null {
  const r = pickRecipe(g, 'refiner', [p.mat]);
  const cost = nodeCost(g, 'refiner');
  if (!r || r.inputs.length !== 1 || !has(g, NODE_DEFS.refiner.tech) || cost > g.credits + 1e-6) return null;
  return {
    act: { t: 'build', type: 'refiner', from: p.n.id, port: p.port, recipe: r.id, to: to.id }, cost, hope, show: p.n.id,
    why: `${MATERIALS[r.outputs[0][0]].name} sells for more than the ${MATERIALS[p.mat].name} it is made of`,
    mouse: `Drag from ${portName(g, p)} into empty space, pick Refiner (${price(cost)}) and wire it to ${the(g, to)}`,
    touch: `Tap ${portName(g, p)}, tap an empty spot and pick Refiner (${price(cost)}), then wire it to ${the(g, to)}`,
  };
}

const push = (list: Cand[], c: Cand | null) => {
  if (c) list.push(c);
};
const top = (list: Cand[], n: number) => [...list].sort((a, b) => b.hope - a.hope).slice(0, n);

/** Faster Wells and machines: those running flat out on the way to a sink of the given kind. */
function fasterProducers(g: Game, toward: NodeType, what: string): Cand[] {
  const list: Cand[] = [];
  const on = upstreamOf(g, [toward]);
  const flatOut = new Map<NodeType, number>();
  for (const n of g.nodes) {
    if ((n.type !== 'well' && !isMachine(n)) || !on.has(n.id) || n.util < 0.9) continue;
    const direct = (graph(g).outs.get(n.id) ?? []).some((ws) => (ws ?? []).some((w) => node(g, w.to)?.type === toward));
    // What it makes is worth more the further down the line it sits: a Glyph Assembler before a Glint Well.
    const made = n.type === 'well' ? n.material : recipeOf(n)?.outputs[0][0];
    const each = !made ? 1 : toward === 'market' ? MATERIALS[made].value : dataYield(g, made).amount;
    push(list, speedCand(g, n, (direct ? 2 : 1) * each * Math.max(0.1, n.rate), `it is running flat out, and more of what it makes means more ${what}`));
    flatOut.set(n.type, (flatOut.get(n.type) ?? 0) + 1);
  }
  const out = top(list, 4);
  for (const [type, count] of flatOut) {
    if (count >= 2) push(out, bulkCand(g, type, 1.5, `they are running flat out, and more of what they make means more ${what}`));
  }
  return out;
}

/** A Well on a free deposit feeding a machine that is short of that material. */
function wellsForHungryMachines(g: Game, what: string): Cand[] {
  const list: Cand[] = [];
  for (const d of freeDeposits(g)) {
    const hungry = g.nodes.find((n) => isMachine(n) && n.util < ADVICE.full && n.status !== 'blocked' && !!recipeOf(n)?.inputs.some((i) => i[0] === d.mat)
      && ins(g, n).some((w) => materialsAt(g, w.from, w.port).includes(d.mat)));
    if (hungry) push(list, wellCand(g, d, hungry, 2, `it is short of ${MATERIALS[d.mat].name}, and what it makes means more ${what}`));
  }
  return top(list, 1);
}

/** Ways to get more of the ordered material to a Market. */
function orderCands(g: Game): Cand[] {
  const o = g.order;
  const market = g.nodes.find((n) => n.type === 'market');
  if (!g.ordersOn || !o || o.ready || !market) return [];
  const list: Cand[] = [];
  const name = MATERIALS[o.mat].name;
  const stuck = !orderReachesMarket(g);
  const why = stuck ? `the order counts what is sold, and no ${name} reaches a Market` : `the order counts ${name} sold at a Market`;
  for (const p of ports(g)) {
    if (p.mat !== o.mat) continue;
    if (!feeds(g, p, 'market')) push(list, wireCand(g, p, market, 5, why));
    else if (p.n.util >= 0.9) {
      // It is sold already: only making more of it fills the order sooner.
      const shared = outs(g, p.n, p.port).some((x) => machineAt(g, x.to));
      push(list, speedCand(g, p.n, 1, shared ? `the order wants ${name} sold, and your machines use most of what it makes` : `the order wants ${name}, and it is running flat out`));
    }
  }
  for (const r of g.nodes) {
    if (r.type !== 'router' || !materialsAt(g, r.id).includes(o.mat)) continue;
    const toMarket = outs(g, r).find((w) => node(g, w.to)?.type === 'market');
    if (toMarket && outs(g, r).length > 1 && favouredWire(g, r.id) !== toMarket.id) push(list, favourCand(g, r, toMarket, 4, `the order counts ${name} sold at a Market`));
  }
  return top(list, 3);
}

/** Candidates for a wait on Data of the kinds still missing. */
function dataCands(g: Game, w: Wait): Cand[] {
  const list: Cand[] = [];
  const lacking = TIERS.filter((k) => w.need[k] > g.data[k] + 1e-9);
  const labs = g.nodes.filter((n) => n.type === 'lab');
  const all = ports(g);
  for (const tier of lacking) {
    const unit = DATA_NAMES[tier];
    const mine = all.filter((p) => dataYield(g, p.mat).tier === tier);
    const studied = (lab: GNode) => ins(g, lab).flatMap((x) => materialsAt(g, x.from, x.port)).filter((m) => dataYield(g, m).tier === tier);
    const room = (lab: GNode) => Math.max(0, labRate(g, lab) - lab.rate);
    const roomy = [...labs].sort((a, b) => room(b) - room(a))[0];
    // Wire something a Lab turns into this Data into the Lab with the most room.
    const wires: Cand[] = [];
    if (roomy) {
      for (const p of mine) {
        if (wired(g, p, roomy)) continue;
        const y = dataYield(g, p.mat).amount;
        const worse = studied(roomy).find((m) => dataYield(g, m).amount < y);
        const sinks = outs(g, p.n, p.port).filter((x) => !machineAt(g, x.to)).length;
        const name = MATERIALS[p.mat].name;
        const why = feeds(g, p, 'void') ? `${name} is worth ${y} ${unit} each in a Lab, and you are throwing it away`
          : worse ? `${name} is worth more Data than ${MATERIALS[worse].name}`
            : `${name} is worth ${y} ${unit} each in a Lab`;
        wires.push(wireCand(g, p, roomy, y * Math.min(spare(g, p) / (sinks + 1), Math.max(0.1, room(roomy))), why));
      }
    }
    list.push(...top(wires, 4));
    const fed = labs.filter((lab) => studied(lab).length > 0);
    for (const lab of fed) {
      if (lab.util >= ADVICE.full) push(list, speedCand(g, lab, lab.rate, `it is full, and studying faster brings the ${unit} sooner`));
    }
    // Every Lab that gets this Data is full: a second Lab from the port with the most to give, or Labs twice as fast.
    if (fed.length && fed.every((lab) => lab.util >= ADVICE.full)) {
      const best = [...mine].sort((a, b) => dataYield(g, b.mat).amount * spare(g, b) - dataYield(g, a.mat).amount * spare(g, a))[0];
      if (best) push(list, labCand(g, best, dataYield(g, best.mat).amount * spare(g, best) * 0.5, `your Lab is full, and a second one studies the ${MATERIALS[best.mat].name} it cannot take`));
      push(list, researchCand(g, 'R2', 3, 'your Lab is full, and this doubles how fast Labs study'));
    }
    if (fed.length) push(list, researchCand(g, 'R3', 2, 'every item studied gives half as much Data again'));
    // A Router that leads to a Lab: send it the bigger share.
    for (const r of g.nodes) {
      if (r.type !== 'router' || !materialsAt(g, r.id).some((m) => dataYield(g, m).tier === tier)) continue;
      const toLab = outs(g, r).find((x) => node(g, x.to)?.type === 'lab');
      if (toLab && outs(g, r).length > 1 && favouredWire(g, r.id) !== toLab.id) push(list, favourCand(g, r, toLab, 2, `more of what passes is studied for ${unit}`));
    }
    // Raw material is worth 1 α in a Lab: a Well on a free deposit, straight into a Lab with room.
    if (tier === 'a' && roomy && room(roomy) >= 0.3) {
      const d = freeDeposits(g)[0];
      if (d) push(list, wellCand(g, d, roomy, Math.min(1, room(roomy)), `raw ${MATERIALS[d.mat].name} is worth 1 α each in a Lab, and yours has room`));
    }
    list.push(...fasterProducers(g, 'lab', unit));
    list.push(...wellsForHungryMachines(g, unit));
    if (g.order && !g.order.ready && g.order.reward[tier] > 0) list.push(...orderCands(g));
  }
  return list;
}

/** Candidates for a wait on credits. */
function creditCands(g: Game): Cand[] {
  const list: Cand[] = [];
  const market = g.nodes.find((n) => n.type === 'market');
  const all = ports(g);
  const glutted = overDemand(g);
  // When something sells over demand, say so: it is why selling more of it would not help.
  const glut = glutted ? `${MATERIALS[glutted].name} is over demand, so the extra sells at a quarter; ` : '';
  const too = (mat: MatId) => (glutted && glutted !== mat ? ' too,' : '');
  if (market) {
    // Something made and not sold: no wire at all, backing up, or only studied or thrown away.
    const sells: Cand[] = [];
    for (const p of all) {
      if (feeds(g, p, 'market') || MATERIALS[p.mat].value <= 0) continue;
      const ws = outs(g, p.n, p.port);
      const backing = p.n.status === 'blocked' || p.n.blockedOn === p.mat || (p.n.type === 'well' && p.n.util < 0.9);
      const onlySinks = ws.length > 0 && ws.every((x) => !machineAt(g, x.to));
      if (ws.length && !backing && !onlySinks) continue;
      const name = MATERIALS[p.mat].name;
      const each = `${MATERIALS[p.mat].value}¢ each`;
      const why = !ws.length ? `${glut}nothing is done with its ${name}, which sells${too(p.mat)} for ${each}`
        : onlySinks ? `${glut}${name} sells${too(p.mat)} for ${each}`
          : `${glut}it is backing up, and the ${name} its machines cannot take sells${too(p.mat)} for ${each}`;
      sells.push(wireCand(g, p, market, MATERIALS[p.mat].value * Math.max(0.05, spare(g, p)), why));
    }
    list.push(...top(sells, 4));
    // A Well on a free deposit, selling raw.
    const d = [...freeDeposits(g)].filter((x) => x.mat !== glutted).sort((a, b) => MATERIALS[b.mat].value - MATERIALS[a.mat].value)[0];
    if (d) push(list, wellCand(g, d, market, MATERIALS[d.mat].value, `${glut}raw ${MATERIALS[d.mat].name} sells${too(d.mat)} for ${MATERIALS[d.mat].value}¢ each`));
    // A Refiner on a Well that sells everything raw.
    const raw = all.filter((p) => p.n.type === 'well' && feeds(g, p, 'market') && !outs(g, p.n).some((x) => machineAt(g, x.to)))
      .sort((a, b) => spare(g, b) - spare(g, a))[0];
    if (raw) push(list, refinerCand(g, raw, market, spare(g, raw)));
  }
  for (const r of g.nodes) {
    if (r.type !== 'router') continue;
    const toMarket = outs(g, r).find((x) => node(g, x.to)?.type === 'market');
    if (toMarket && outs(g, r).length > 1 && favouredWire(g, r.id) !== toMarket.id) push(list, favourCand(g, r, toMarket, 2, 'more of what passes is sold'));
  }
  // Studying something the Market would buy, for Data there is nothing left to spend on right now: sell it instead.
  const cuts: Cand[] = [];
  for (const p of all) {
    if (!feeds(g, p, 'market') || MATERIALS[p.mat].value <= 0) continue;
    const tier = dataYield(g, p.mat).tier;
    if (dataWanted(g, tier)) continue;
    for (const x of outs(g, p.n, p.port)) {
      if (node(g, x.to)?.type !== 'lab') continue;
      cuts.push(cutCand(g, x, MATERIALS[p.mat].value * Math.max(0.02, x.rate),
        `${glut}${MATERIALS[p.mat].name} sells${too(p.mat)} for ${MATERIALS[p.mat].value}¢ each, and you have the ${DATA_NAMES[tier]} you need for now`));
    }
  }
  list.push(...top(cuts, 3));
  if (glutted) push(list, researchCand(g, 'C2', 3, `${MATERIALS[glutted].name} is over demand, and with this Markets buy half as much again at full price`));
  list.push(...fasterProducers(g, 'market', 'credits'));
  list.push(...wellsForHungryMachines(g, 'credits'));
  list.push(...orderCands(g));
  return list;
}

/** Candidates for the Flow goal: for the producers furthest from flowing, whatever holds each one back. */
function flowCands(g: Game): Cand[] {
  const list: Cand[] = [];
  const market = g.nodes.find((n) => n.type === 'market');
  const all = ports(g);
  const slow = g.nodes.filter((n) => countsForFlow(g, n) && !isFlowing(n)).sort((a, b) => a.util - b.util).slice(0, 4);
  slow.forEach((n, i) => {
    const hope = 10 - i;
    const lead = `${cap(the(g, n))} is holding Flow back`;
    const add = (c: Cand | null) => push(list, c && { ...c, lead });
    const starved = isMachine(n) && n.status !== 'blocked' && !n.blockedOn && (n.status === 'starved' || !!n.missing);
    if (starved) {
      const m = n.missing ?? recipeOf(n)?.inputs[0][0] ?? null;
      if (!m) return;
      const name = MATERIALS[m].name;
      const sources = ins(g, n).filter((w) => materialsAt(g, w.from, w.port).includes(m)).map((w) => node(g, w.from)!);
      if (!sources.length) {
        const from = all.find((p) => p.mat === m && p.n !== n);
        if (from) add(wireCand(g, from, n, hope, `it gets no ${name}`));
      }
      for (const s of sources) {
        if (s.util >= 0.9) add(speedCand(g, s, hope, `it is short of ${name}`));
      }
      const d = freeDeposits(g).find((x) => x.mat === m);
      if (d) add(wellCand(g, d, n, hope - 0.5, `it is short of ${name}`));
      return;
    }
    // Its output has nowhere to go, or not all of it does.
    const mine = all.filter((p) => p.n === n);
    for (const p of mine) {
      if (n.blockedOn && n.blockedOn !== p.mat && mine.length > 1) continue;
      const ws = outs(g, n, p.port);
      const name = MATERIALS[p.mat].name;
      if (market && !feeds(g, p, 'market')) {
        add(wireCand(g, p, market, hope, ws.some((x) => machineAt(g, x.to))
          ? `it makes more ${name} than its machines take`
          : `its ${name} has nowhere to go`));
      }
      for (const x of ws) {
        const c = node(g, x.to)!;
        if (isMachine(c) && c.util >= 0.9) add(speedCand(g, c, hope - 1, `it makes more ${name} than ${the(g, c)} can take`));
      }
    }
  });
  return list;
}

// =====================================================================================
// Trying them
// =====================================================================================

interface Outcome {
  /** Seconds until the wait ended, or Infinity if it did not within the run. */
  t: number;
  /** Lower is better: `t` when it ended, otherwise an estimate of when it will (or of how far off it is). */
  score: number;
}

/**
 * What the copy has of the things the wait is NOT for: Data when it waits for credits, credits otherwise.
 * Two tips that save the same time are told apart by it: studying Silt that was being thrown away beats
 * studying Ink that was being sold.
 */
const purse = (copy: Game, w: Wait) => (w.kind === 'credits' ? copy.data.a + 4 * copy.data.b + 12 * copy.data.g : copy.credits);

/** Sooner first; within a second or two per cent of each other, the one that leaves the player richer. */
function sooner(a: { o: Outcome; rest: number }, b: { o: Outcome; rest: number }): number {
  const close = Math.max(1, 0.02 * Math.min(a.o.score, b.o.score));
  if (Math.abs(a.o.score - b.o.score) <= close || (a.o.score === Infinity && b.o.score === Infinity)) return b.rest - a.rest;
  return a.o.score - b.o.score;
}

/** Run a copy until the wait ends or `seconds` pass, claiming its order when it fills, and say how it went. */
function tryOut(copy: Game, w: Wait, seconds: number): Outcome {
  const step = ADVICE.step;
  const half = seconds / 2;
  // Income over the second half of the run, for the estimate if the wait does not end.
  const earned: Purse = { credits: 0, a: 0, b: 0, g: 0 };
  let sampled = 0;
  let orderAtHalf = copy.order;
  let gotAtHalf = orderAtHalf?.got ?? 0;
  for (let t = step; t <= seconds + 1e-9; t += step) {
    tick(copy, step);
    if (copy.order?.ready) claimOrder(copy);
    if (over(copy, w)) return { t, score: t };
    if (t > half) {
      earned.credits += copy.tickAcc.credits;
      for (const k of TIERS) earned[k] += copy.tickAcc.data[k];
      sampled += step;
    } else {
      orderAtHalf = copy.order;
      gotAtHalf = orderAtHalf?.got ?? 0;
    }
  }
  if (w.kind === 'flow') {
    // Not held yet: how close is it? A smaller share of producers short of flowing is better.
    let producers = 0;
    let flowing = 0;
    for (const n of copy.nodes) {
      if (!countsForFlow(copy, n)) continue;
      producers++;
      if (isFlowing(n)) flowing++;
    }
    return { t: Infinity, score: seconds + 1000 * (producers ? 1 - flowing / producers : 1) };
  }
  const o = copy.order;
  const orderRate = o && o === orderAtHalf && sampled > 0 ? (o.got - gotAtHalf) / sampled : 0;
  const orderIn = o && orderRate > 1e-9 ? (o.need - o.got) / orderRate : Infinity;
  if (w.kind === 'order') return { t: Infinity, score: seconds + orderIn };
  // Credits or Data: when will everything be in hand at this income, counting the order's pay when it lands?
  const need = currentWait(copy)?.need ?? w.need;
  const until = (bonus: Purse | null) => {
    let worst = 0;
    for (const k of KEYS) {
      const missing = need[k] - have(copy, k) - (bonus ? bonus[k] : 0);
      if (missing <= 1e-9) continue;
      const rate = sampled > 0 ? earned[k] / sampled : 0;
      worst = Math.max(worst, rate > 1e-9 ? missing / rate : Infinity);
    }
    return worst;
  };
  const plain = until(null);
  const withOrder = o && orderIn < plain ? Math.max(orderIn, until(o.reward)) : plain;
  return { t: Infinity, score: seconds + Math.min(plain, withOrder) };
}

/** Is `tip` enough better than `base` to be worth saying? */
function worth(base: number, tip: number): boolean {
  if (!isFinite(tip)) return false;
  if (!isFinite(base)) return true;
  return base - tip >= Math.max(ADVICE.minSaves, ADVICE.minShare * base);
}

interface Verdict { cand: Cand; base: number; tip: number; cut?: { wire: number; from: number; to: number } }

/** Try the candidates against doing nothing and return the one that ends the wait soonest, if any is worth saying. */
function judge(g: Game, w: Wait, cands: Cand[]): Verdict | null {
  const idle = lookahead(g);
  if (!idle || !cands.length) return null;
  const screen = w.kind === 'flow' ? ADVICE.flowScreen : ADVICE.screen;
  const base = tryOut(idle, w, screen);
  if (base.t <= ADVICE.minWait) return null;
  const tried: { c: Cand; o: Outcome; copy: Game; rest: number }[] = [];
  // The same action can be proposed twice (a wire to the Market for the credits and for the order).
  const seen = new Set<string>();
  for (const c of top(cands, cands.length)) {
    const key = JSON.stringify(c.act);
    if (seen.has(key) || seen.size >= ADVICE.candidates) continue;
    seen.add(key);
    const copy = lookahead(g);
    if (!copy || !perform(copy, c.act)) continue;
    const o = tryOut(copy, w, isFinite(base.t) ? base.t : screen);
    if (worth(base.score, o.score)) tried.push({ c, o, copy, rest: purse(copy, w) });
  }
  if (!tried.length) return null;
  tried.sort(sooner);
  if (w.kind === 'flow' || isFinite(base.t)) {
    // Everything that matters happened inside the first run: nothing was estimated.
    return { cand: tried[0].c, base: base.t, tip: tried[0].o.t };
  }
  // The wait outlasts the first look: run the untouched copy and the best two on until it ends.
  const rest = ADVICE.horizon - screen;
  const baseOn = tryOut(idle, w, rest);
  const baseTime = screen + baseOn.score;
  const finals: { c: Cand; o: Outcome; rest: number }[] = [];
  for (const x of tried.slice(0, 2)) {
    const time = isFinite(x.o.t) ? x.o.t : screen + tryOut(x.copy, w, isFinite(baseOn.t) ? baseOn.t : rest).score;
    if (worth(baseTime, time)) finals.push({ c: x.c, o: { t: time, score: time }, rest: purse(x.copy, w) });
  }
  if (!finals.length) return null;
  finals.sort(sooner);
  return { cand: finals[0].c, base: baseTime, tip: finals[0].o.score };
}

// =====================================================================================
// The public face
// =====================================================================================

const verdicts = new WeakMap<Game, { key: string; time: number; advice: Advice | null }>();

function toAdvice(w: Wait, v: Verdict): Advice {
  const c = v.cand;
  const a: Advice = {
    kind: w.kind === 'data' ? 'data' : w.kind === 'flow' ? 'flow' : 'credits',
    // A Flow tip names the culprit first: "The Murk Well is holding Flow back because it makes more Murk than its machines take: drag from...".
    text: c.lead
      ? { mouse: `${c.lead} because ${c.why}: ${low(c.mouse)}.`, touch: `${c.lead} because ${c.why}: ${low(c.touch)}.` }
      : { mouse: `${c.mouse}: ${c.why}.`, touch: `${c.touch}: ${c.why}.` },
    eta: v.base,
    cost: c.cost,
    steps: 1,
  };
  if (isFinite(v.tip)) a.saves = isFinite(v.base) ? Math.max(0, v.base - v.tip) : Infinity;
  if (c.show != null) a.node = c.show;
  const x = c.act;
  if (x.t === 'upgrade') {
    a.node = x.node;
    a.upgrade = x.track;
    if (x.all) a.all = true;
  } else if (x.t === 'wire') a.wire = { from: x.from, to: x.to, port: x.port };
  else if (x.t === 'favour') {
    a.node = x.router;
    a.favour = { router: x.router, wire: x.wire };
  } else if (x.t === 'research') a.research = x.tech;
  else if (x.t === 'cut') {
    const wire = v.cut;
    if (wire) a.cut = wire;
  } else {
    a.build = x.type;
    if (x.from != null) a.node = x.from;
    if (x.port != null) a.port = x.port;
    if (x.deposit != null) a.deposit = x.deposit;
    if (x.recipe) a.recipe = x.recipe;
    if (x.to != null) {
      a.to = x.to;
      a.steps = 2;
    }
  }
  return a;
}

/**
 * The best next step while waiting, or null when there is nothing worth saying: no wait, a wait that is
 * nearly over, or nothing affordable that would really shorten it.
 *
 * Only actions the player can afford and do right now; ranked by the seconds they save on the current wait;
 * and true: the tip was tried on a copy of the game and the wait ended sooner than on an untouched copy.
 */
export function advice(g: Game): Advice | null {
  const w = currentWait(g);
  if (!w) return null;
  const key = `${g.rev}|${g.goal.i}|${w.kind}|${g.order?.created ?? -1}|${g.order?.ready ?? ''}`;
  const hit = verdicts.get(g);
  if (hit && hit.key === key && g.time >= hit.time && g.time - hit.time < ADVICE.refresh) return hit.advice;
  const cands = w.kind === 'data' ? dataCands(g, w) : w.kind === 'credits' ? creditCands(g) : w.kind === 'flow' ? flowCands(g) : orderCands(g);
  const v = judge(g, w, cands);
  if (v && v.cand.act.t === 'cut') {
    const id = v.cand.act.wire;
    const wire = g.wires.find((x) => x.id === id);
    if (wire) v.cut = { wire: id, from: wire.from, to: wire.to };
  }
  const a = v ? toAdvice(w, v) : null;
  verdicts.set(g, { key, time: g.time, advice: a });
  return a;
}

export interface AdviceTrial {
  /** The tip as it would read (mouse wording), its price, and whether trying it on a copy worked at all. */
  text: string;
  cost: number;
  doable: boolean;
  /** Seconds until the wait ended in the first look (Infinity if it did not), and the score it was ranked by: lower is better. */
  ends: number;
  score: number;
  /** Did it beat doing nothing by enough to be worth saying? */
  worth: boolean;
}

/**
 * For tuning and debugging, not for the interface: every candidate the adviser would consider right now and
 * how each one did in the first look (ADVICE.screen seconds), next to doing nothing. Works the trials out
 * afresh on every call. null when the active goal is not a wait.
 */
export function adviceTrials(g: Game): { kind: string; idle: { ends: number; score: number }; trials: AdviceTrial[] } | null {
  const w = currentWait(g);
  const idle = w && lookahead(g);
  if (!w || !idle) return null;
  const screen = w.kind === 'flow' ? ADVICE.flowScreen : ADVICE.screen;
  const base = tryOut(idle, w, screen);
  const cands = w.kind === 'data' ? dataCands(g, w) : w.kind === 'credits' ? creditCands(g) : w.kind === 'flow' ? flowCands(g) : orderCands(g);
  const trials = top(cands, cands.length).map((c): AdviceTrial => {
    const copy = lookahead(g);
    const text = c.lead ? `${c.lead} because ${c.why}: ${low(c.mouse)}.` : `${c.mouse}: ${c.why}.`;
    if (!copy || !perform(copy, c.act)) return { text, cost: c.cost, doable: false, ends: Infinity, score: Infinity, worth: false };
    const o = tryOut(copy, w, isFinite(base.t) ? base.t : screen);
    return { text, cost: c.cost, doable: true, ends: o.t, score: o.score, worth: worth(base.score, o.score) };
  });
  return { kind: w.kind, idle: { ends: base.t, score: base.score }, trials };
}

/** Do what a tip says, through the normal actions. Returns false if it can no longer be done (the board has changed). */
export function applyAdvice(g: Game, a: Advice): boolean {
  let x: Act | null = null;
  if (a.research) x = { t: 'research', tech: a.research };
  else if (a.cut) x = { t: 'cut', wire: a.cut.wire };
  else if (a.favour) x = { t: 'favour', router: a.favour.router, wire: a.favour.wire };
  else if (a.build) x = { t: 'build', type: a.build as NodeType, from: a.node, port: a.port, deposit: a.deposit, to: a.to, recipe: a.recipe };
  else if (a.upgrade && a.node != null) x = { t: 'upgrade', node: a.node, track: a.upgrade, all: !!a.all };
  else if (a.wire) x = { t: 'wire', from: a.wire.from, port: a.wire.port ?? 0, to: a.wire.to };
  if (!x || (x.t === 'build' && !NODE_DEFS[x.type])) return false;
  return perform(g, x);
}

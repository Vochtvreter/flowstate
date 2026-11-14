import { DataTier, MATERIALS, MatId, NodeType, RECIPES, RULES, TECHS } from './content';

export type Status = 'working' | 'blocked' | 'starved' | 'idle';
export type RouterMode = 'even' | 'ratio' | 'priority' | 'filter';
export type Bag = Partial<Record<MatId, number>>;

export interface GNode {
  id: number;
  type: NodeType;
  x: number;
  y: number;
  recipe: string | null;
  /** Raw material extracted (wells only). */
  material: MatId | null;
  depositId: number | null;
  lv: { speed: number; eff: number; buffer: number };
  /** Credits spent on this node (purchase + upgrades). Informational: refunds are worked out by refundOf(). */
  paid: number;
  mode: RouterMode;
  /** Game time when the node was built or its recipe last changed. Flow ignores producers younger than RULES.flow.minAge. */
  born: number;
  // --- runtime ---
  inb: Bag;
  outb: Bag;
  prog: number;
  crafting: boolean;
  cycles: number;
  status: Status;
  util: number;
  fBlocked: number;
  fStarved: number;
  /** Smoothed primary output (items/s), or throughput for sinks. */
  rate: number;
  missing: MatId | null;
  blockedOn: MatId | null;
  /** Credits or data earned since the UI last showed a floating gain. */
  gain: number;
  gainB: Partial<Record<DataTier, number>>;
  /** Seconds left before problems are reported (new or rewired nodes need a moment to fill). */
  grace: number;
}

export interface Wire {
  id: number;
  from: number;
  /** Output port index on the source node. */
  port: number;
  to: number;
  tier: number;
  paid: number;
  weight: number;
  filter: MatId | null;
  // --- runtime ---
  rate: number;
  mat: MatId | null;
  mixed: boolean;
  budget: number;
  flow: number;
}

export interface Deposit {
  id: number;
  x: number;
  y: number;
  mat: MatId;
}

/** Credits and Data paid out by a goal or an order. */
export interface Reward { credits?: number; a?: number; b?: number; g?: number }

export type Unlock = 'orders' | 'flow' | 'end';

/** What a goal pays when claimed (see src/goals.ts). */
export interface GoalReward extends Reward {
  /** Techs granted for free. */
  techs?: string[];
  /** A feature switched on: Orders, the Flow meter, or the end of the demo. */
  unlock?: Unlock;
}

/** The one active order (see src/orders.ts): "deliver `need` of `mat`", counted from sales at any Market. */
export interface Order {
  mat: MatId;
  need: number;
  /** g.sold[mat] when the order appeared. */
  base: number;
  /** Delivered so far, 0..need. */
  got: number;
  reward: Required<Reward>;
  /** Game time when it appeared. */
  created: number;
  /** Game time of the last delivery (or `created`). */
  lastProgress: number;
  /** Filled and waiting for claimOrder(). */
  ready: boolean;
}

export interface Stats {
  /** Credits earned by selling at Markets, by claiming orders, by claiming goals and while away. */
  fromSales: number;
  fromOrders: number;
  fromGoals: number;
  fromAway: number;
  /** Nodes placed and wires connected by the player, ever (undo does not take them back). */
  nodesBuilt: number;
  wiresMade: number;
  /** Orders claimed. */
  ordersFilled: number;
  /** Times Flow State was reached. */
  flowStates: number;
  /** Game time of the first Lens (the end of the demo), or null. */
  firstLensAt: number | null;
}

/**
 * Things the UI should react to, drained from g.events every frame.
 * Every kind except 'milestone' and 'tech' carries a plain-English `text` a UI can fall back on.
 */
export type GameEvent =
  /** A material was made for the first time. `reward` is always 0 now (goals pay instead). */
  | { kind: 'milestone'; mat: MatId; reward: number }
  | { kind: 'tech'; id: string }
  /** A refusal or notice with nothing else attached. */
  | { kind: 'toast'; text: string }
  /** The active goal's condition holds: show Claim. `goal` is the goal id, `index` its position in GOALS. */
  | { kind: 'goal-ready'; text: string; goal: string; index: number }
  /** A goal was claimed and paid. `big` marks one of the big celebrations. */
  | { kind: 'goal-claimed'; text: string; goal: string; index: number; reward: GoalReward; big: boolean }
  /** A feature was switched on by a goal. */
  | { kind: 'unlock'; text: string; what: 'orders' | 'flow' }
  /** A new order appeared. `quiet` = it silently replaced a stale one. */
  | { kind: 'order-new'; text: string; order: Order; quiet: boolean }
  | { kind: 'order-ready'; text: string; order: Order }
  | { kind: 'order-claimed'; text: string; order: Order; reward: Required<Reward> }
  /** Flow State reached (once per streak). `first` = the first time ever: a big celebration. */
  | { kind: 'flow-state'; text: string; first: boolean }
  /** The first Lens was made: the demo is complete. Raised once per save. */
  | { kind: 'demo-end'; text: string };

export interface Game {
  v: 1;
  nextId: number;
  nodes: GNode[];
  wires: Wire[];
  deposits: Deposit[];
  board: { w: number; h: number; expansions: number };
  credits: number;
  lifetime: number;
  data: Record<DataTier, number>;
  techs: string[];
  queue: string[];
  made: Partial<Record<MatId, boolean>>;
  sold: Bag;
  soldRate: Bag;
  paused: boolean;
  time: number;
  savedAt: number;
  creditRate: number;
  dataRate: Record<DataTier, number>;
  /** Game time each material was first made (order generation prefers the newest). */
  madeAt: Bag;
  /** Full-price demand still banked per material (see RULES.demand). A missing entry means "full". */
  demandLeft: Bag;
  // --- flow ---
  /** Share of counted producers that are flowing, 0..1, smoothed over RULES.flow.smooth seconds. */
  flow: number;
  /** The Flow meter is unlocked: sales are multiplied by flowMult(g). */
  flowOn: boolean;
  /** Seconds the raw share has been at 100% with enough producers (0 when not). Flow State is on from RULES.flow.stateSeconds. */
  flowStreak: number;
  /** Longest flowStreak ever, for the end screen. */
  flowBest: number;
  /** Seconds the smoothed Flow has stayed at or above RULES.flow.holdShare (the "hold Flow" goal). */
  flowHold: number;
  // --- goals and orders ---
  /** Active goal: index into GOALS (GOALS.length when all are claimed) and whether it is waiting for claimGoal(). */
  goal: { i: number; ready: boolean };
  ordersOn: boolean;
  order: Order | null;
  /** Running seed of the order generator. */
  orderSeed: number;
  /** The first Lens has been made. Set once. */
  ended: boolean;
  stats: Stats;
  // --- not saved ---
  rev: number;
  events: GameEvent[];
  tickAcc: { credits: number; data: Record<DataTier, number>; sold: Bag };
}

export const GRID = 20;
export const snap = (v: number) => Math.round(v / GRID) * GRID;

export function makeNode(g: Game, type: NodeType, x: number, y: number): GNode {
  return {
    id: g.nextId++, type, x, y,
    recipe: null, material: null, depositId: null,
    lv: { speed: 0, eff: 0, buffer: 0 },
    paid: 0, mode: 'even', born: g.time,
    inb: {}, outb: {}, prog: 0, crafting: false, cycles: 0,
    status: 'idle', util: 0, fBlocked: 0, fStarved: 0, rate: 0,
    missing: null, blockedOn: null, gain: 0, gainB: {}, grace: 6,
  };
}

export function makeWire(g: Game, from: number, port: number, to: number): Wire {
  return {
    id: g.nextId++, from, port, to, tier: 0, paid: 0, weight: 1, filter: null,
    rate: 0, mat: null, mixed: false, budget: 0, flow: 0,
  };
}

/** Starting layout. The Market sits diagonally below-right of the first Well so both fit a phone screen (about 430 × 250). */
export const START = {
  wellDeposit: 1,
  market: { x: 360, y: 300 },
};

export const newStats = (): Stats => ({
  fromSales: 0, fromOrders: 0, fromGoals: 0, fromAway: 0,
  nodesBuilt: 0, wiresMade: 0, ordersFilled: 0, flowStates: 0, firstLensAt: null,
});

export function newGame(): Game {
  const g: Game = {
    v: 1, nextId: 1,
    nodes: [], wires: [],
    deposits: [
      { id: 1, x: 100, y: 120, mat: 'glint' },
      { id: 2, x: 100, y: 260, mat: 'glint' },
      { id: 3, x: 100, y: 400, mat: 'murk' },
      { id: 4, x: 100, y: 540, mat: 'ember' },
      { id: 5, x: 380, y: 620, mat: 'breeze' },
    ],
    board: { w: 1240, h: 760, expansions: 0 },
    credits: 0, lifetime: 0,
    data: { a: 0, b: 0, g: 0 },
    techs: [], queue: [],
    // The starting Well is already extracting Glint, so it is not announced as a new material.
    made: { glint: true }, sold: {}, soldRate: {},
    paused: false, time: 0, savedAt: Date.now(),
    creditRate: 0, dataRate: { a: 0, b: 0, g: 0 },
    madeAt: { glint: 0 }, demandLeft: {},
    flow: 0, flowOn: false, flowStreak: 0, flowBest: 0, flowHold: 0,
    goal: { i: 0, ready: false },
    ordersOn: false, order: null, orderSeed: RULES.orders.seed >>> 0,
    ended: false,
    stats: newStats(),
    rev: 1, events: [],
    tickAcc: { credits: 0, data: { a: 0, b: 0, g: 0 }, sold: {} },
  };
  g.nextId = 10;
  const dep = g.deposits.find((d) => d.id === START.wellDeposit)!;
  const well = makeNode(g, 'well', dep.x, dep.y);
  well.material = dep.mat;
  well.depositId = dep.id;
  const market = makeNode(g, 'market', START.market.x, START.market.y);
  g.nodes.push(well, market);
  return g;
}

// ---------- save / load ----------

const KEY = 'flowstate-save-v1';

/** True while the page is in a background tab. Always false outside a browser. */
const pageHidden = () => typeof document !== 'undefined' && !!document.hidden;

export function serialize(g: Game): string {
  // A hidden tab is not simulating, so the time away starts at the last save made while visible.
  if (!pageHidden()) g.savedAt = Date.now();
  const { rev, events, tickAcc, ...rest } = g;
  return JSON.stringify(rest);
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && isFinite(v) ? v : fallback);

/** A saved order, with every field checked. null if it is missing or asks for something that no longer exists. */
function loadOrder(o: Partial<Order> | null | undefined): Order | null {
  if (!o || typeof o !== 'object' || !MATERIALS[o.mat as MatId] || !(num(o.need, 0) > 0)) return null;
  const r: Reward = o.reward ?? {};
  return {
    mat: o.mat as MatId, need: num(o.need, 0), base: num(o.base, 0), got: num(o.got, 0),
    reward: { credits: num(r.credits, 0), a: num(r.a, 0), b: num(r.b, 0), g: num(r.g, 0) },
    created: num(o.created, 0), lastProgress: num(o.lastProgress, 0), ready: !!o.ready,
  };
}

/** Load a save. Saves from before goals, orders and Flow load too: every missing field gets its new-game default. */
export function deserialize(json: string): Game | null {
  try {
    const raw = JSON.parse(json);
    if (!raw || raw.v !== 1 || !Array.isArray(raw.nodes)) return null;
    const base = newGame();
    const g: Game = { ...base, ...raw, rev: 1, events: [], tickAcc: base.tickAcc };
    // Drop anything that references content that no longer exists.
    for (const n of g.nodes) {
      if (n.recipe && !RECIPES[n.recipe]) n.recipe = null;
      n.gain = 0;
      n.gainB = {};
      n.grace = 3;
      n.born = num(n.born, 0);
    }
    const ids = new Set(g.nodes.map((n) => n.id));
    g.wires = (Array.isArray(g.wires) ? g.wires : []).filter((w) => ids.has(w.from) && ids.has(w.to));
    const known = (list: unknown) => [...new Set(Array.isArray(list) ? list : [])].filter((id) => typeof id === 'string' && !!TECHS[id]) as string[];
    g.techs = known(g.techs);
    g.queue = known(g.queue).filter((id) => !g.techs.includes(id));
    // Nested objects are rebuilt field by field so that later additions get defaults too.
    const stats = newStats();
    for (const k of Object.keys(stats) as (keyof Stats)[]) {
      if (k === 'firstLensAt') stats[k] = typeof raw.stats?.[k] === 'number' ? raw.stats[k] : null;
      else stats[k] = num(raw.stats?.[k], 0);
    }
    g.stats = stats;
    g.goal = { i: Math.max(0, Math.floor(num(raw.goal?.i, 0))), ready: !!raw.goal?.ready };
    const bag = (v: unknown): Bag => (v && typeof v === 'object' ? { ...(v as Bag) } : {});
    g.madeAt = bag(raw.madeAt);
    for (const m in g.made) if (g.made[m as MatId] && g.madeAt[m as MatId] == null) g.madeAt[m as MatId] = 0;
    g.demandLeft = bag(raw.demandLeft);
    g.flowOn = !!raw.flowOn;
    g.ordersOn = !!raw.ordersOn;
    g.flow = Math.max(0, Math.min(1, num(raw.flow, 0)));
    g.flowStreak = num(raw.flowStreak, 0);
    g.flowBest = num(raw.flowBest, 0);
    g.flowHold = num(raw.flowHold, 0);
    g.orderSeed = num(raw.orderSeed, base.orderSeed) >>> 0;
    g.order = loadOrder(raw.order);
    // A save from before the `ended` flag that already has a Lens is past the demo.
    g.ended = typeof raw.ended === 'boolean' ? raw.ended : !!g.made[RULES.capstone];
    return g;
  } catch {
    return null;
  }
}

export function saveGame(g: Game) {
  try {
    localStorage.setItem(KEY, serialize(g));
  } catch {
    /* storage unavailable: play on without saving */
  }
}

export function loadGame(): Game | null {
  try {
    const json = localStorage.getItem(KEY);
    return json ? deserialize(json) : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// ---------- structure snapshots (undo) ----------

export interface Snapshot {
  nodes: Pick<GNode, 'id' | 'type' | 'x' | 'y' | 'recipe' | 'material' | 'depositId' | 'lv' | 'paid' | 'mode'>[];
  wires: Pick<Wire, 'id' | 'from' | 'port' | 'to' | 'tier' | 'paid' | 'weight' | 'filter'>[];
}

export function snapshot(g: Game): Snapshot {
  return {
    nodes: g.nodes.map((n) => ({
      id: n.id, type: n.type, x: n.x, y: n.y, recipe: n.recipe, material: n.material,
      depositId: n.depositId, lv: { ...n.lv }, paid: n.paid, mode: n.mode,
    })),
    wires: g.wires.map((w) => ({
      id: w.id, from: w.from, port: w.port, to: w.to, tier: w.tier, paid: w.paid, weight: w.weight, filter: w.filter,
    })),
  };
}

/** Restore structure from a snapshot, keeping runtime buffers of nodes that survive unchanged. */
export function restore(g: Game, s: Snapshot) {
  const oldN = new Map(g.nodes.map((n) => [n.id, n]));
  const oldW = new Map(g.wires.map((w) => [w.id, w]));
  g.nodes = s.nodes.map((sn) => {
    const prev = oldN.get(sn.id);
    const fresh = makeNode(g, sn.type, sn.x, sn.y);
    g.nextId--; // makeNode consumed an id we do not need
    const keepRuntime = prev && prev.recipe === sn.recipe && prev.type === sn.type;
    return { ...(keepRuntime ? prev : fresh), ...sn, lv: { ...sn.lv } };
  });
  g.wires = s.wires.map((sw) => {
    const prev = oldW.get(sw.id);
    const fresh = makeWire(g, sw.from, sw.port, sw.to);
    g.nextId--;
    return { ...(prev ?? fresh), ...sw };
  });
  g.rev++;
}

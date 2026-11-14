import { DataTier, MATERIALS, MatId, NODE_DEFS, NodeType, RECIPES, RULES, TECHS } from './content';

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
  /** Items per second, smoothed. Steady and exact when the wire carries its items in regular gulps (measureWire in src/sim.ts). */
  rate: number;
  mat: MatId | null;
  mixed: boolean;
  budget: number;
  flow: number;
  /**
   * Bookkeeping for `rate` (absent on a wire from an older save, which simply starts measuring afresh):
   * the gulp in progress, and the last few whole gulps. A gulp runs from the moment items start moving after a
   * pause to the next such moment.
   */
  gulp?: {
    /** Items and seconds since the gulp in progress began. */
    n: number; t: number;
    /** Seconds it has flowed without a pause, and seconds since anything last moved (0 while flowing). */
    on: number; idle: number;
    /** A start has been seen, so the next start completes a whole gulp. */
    armed: boolean;
    /** Whole gulps, oldest first: items, seconds, items, seconds... Empty while the flow is steady or unknown. */
    past: number[];
    /** Worked out from `past` each time a gulp completes: the rate over the pattern, and the longest gulp in it. */
    est: number; max: number;
  };
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
  | { kind: 'demo-end'; text: string }
  /**
   * A material has been selling over its demand for a few seconds, for the first time in this save
   * (g.seenSurplus): the moment to introduce the demand gauge. Raised once per save.
   */
  | { kind: 'surplus'; mat: MatId; text: string };

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
  /** Something has sold over its demand for a few seconds (RULES.demand.notice). Set once, with a 'surplus' event. */
  seenSurplus: boolean;
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
    ended: false, seenSurplus: false,
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

/** The game as JSON, without the fields that are rebuilt on load. Does not touch the game. */
function toJson(g: Game): string {
  const { rev, events, tickAcc, ...rest } = g;
  return JSON.stringify(rest);
}

export function serialize(g: Game): string {
  // A hidden tab is not simulating, so the time away starts at the last save made while visible.
  if (!pageHidden()) g.savedAt = Date.now();
  return toJson(g);
}

/** An independent copy of the game, exactly what saving and loading would give. The original is not touched (not even its save time). */
export function cloneGame(g: Game): Game | null {
  return deserialize(toJson(g));
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && isFinite(v) ? v : fallback);
/** A finite number that is not negative. */
const pos = (v: unknown, fallback = 0) => Math.max(0, num(v, fallback));

/** A per-material table from a save: known materials with finite, non-negative numbers only. */
function loadBag(v: unknown): Bag {
  const out: Bag = {};
  if (!v || typeof v !== 'object') return out;
  for (const k in v as Record<string, unknown>) {
    const n = (v as Record<string, unknown>)[k];
    if (MATERIALS[k as MatId] && typeof n === 'number' && isFinite(n) && n >= 0) out[k as MatId] = n;
  }
  return out;
}

/** A saved order, with every field checked. null if it is missing or asks for something that no longer exists. */
function loadOrder(o: Partial<Order> | null | undefined): Order | null {
  if (!o || typeof o !== 'object' || !MATERIALS[o.mat as MatId] || !(num(o.need, 0) > 0)) return null;
  const r: Reward = o.reward && typeof o.reward === 'object' ? o.reward : {};
  const need = num(o.need, 0);
  return {
    mat: o.mat as MatId, need, base: pos(o.base), got: Math.min(need, pos(o.got)),
    // A reward can never take anything away.
    reward: { credits: pos(r.credits), a: pos(r.a), b: pos(r.b), g: pos(r.g) },
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
    // Totals must be numbers whatever the save says, and never negative: the build before this one could
    // leave α thousands below zero after time away (which would lock the tech tree for good) and credits
    // below zero after an undo.
    g.credits = pos(raw.credits);
    g.lifetime = pos(raw.lifetime);
    g.time = pos(raw.time);
    g.savedAt = num(raw.savedAt, base.savedAt);
    g.data = { a: pos(raw.data?.a), b: pos(raw.data?.b), g: pos(raw.data?.g) };
    g.sold = loadBag(raw.sold);
    g.soldRate = loadBag(raw.soldRate);
    // Drop anything that references content that no longer exists.
    for (const n of g.nodes) {
      if (n.recipe && !RECIPES[n.recipe]) n.recipe = null;
      if (n.material && !MATERIALS[n.material]) n.material = null;
      n.gain = 0;
      n.gainB = {};
      n.grace = 3;
      n.born = num(n.born, 0);
    }
    const ids = new Set(g.nodes.map((n) => n.id));
    g.wires = (Array.isArray(g.wires) ? g.wires : []).filter((w) => ids.has(w.from) && ids.has(w.to));
    for (const w of g.wires) {
      // The rate and its bookkeeping are display only: anything odd is dropped and measured afresh.
      w.rate = pos(w.rate);
      const u = w.gulp;
      const sound = !!u && typeof u === 'object' && Array.isArray(u.past) && u.past.length % 2 === 0
        && [u.n, u.t, u.on, u.idle, u.est, u.max, ...u.past].every((v) => typeof v === 'number' && isFinite(v) && v >= 0);
      if (!sound) delete w.gulp;
    }
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
    // The index is checked against the goal list, and the unlocks of claimed goals re-applied, by tickGoal() (src/goals.ts).
    g.goal = { i: Math.max(0, Math.floor(num(raw.goal?.i, 0))), ready: !!raw.goal?.ready };
    const made: Game['made'] = {};
    if (raw.made && typeof raw.made === 'object') for (const m in raw.made) if (MATERIALS[m as MatId] && raw.made[m]) made[m as MatId] = true;
    g.made = made;
    g.madeAt = loadBag(raw.madeAt);
    for (const m in g.made) if (g.madeAt[m as MatId] == null) g.madeAt[m as MatId] = 0;
    g.demandLeft = loadBag(raw.demandLeft);
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
    g.seenSurplus = !!raw.seenSurplus;
    // The build before this one let the last Well be deleted. A board with no Well and no money for one is stuck: pay for one.
    if (!g.nodes.some((n) => n.type === 'well')) g.credits = Math.max(g.credits, NODE_DEFS.well.base);
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

// ---------- look-ahead copies ----------

/**
 * Games made to try something out and be thrown away: the copies a forecast or the adviser runs ahead of the
 * live game (lookahead() in src/forecast.ts). The undo and redo history belongs to the game the player is
 * playing (src/actions.ts keeps one history), so nothing done to a look-ahead copy is ever recorded in it:
 * otherwise every tip the adviser weighed would become an Undo step that hands back credits nobody spent.
 */
const lookaheads = new WeakSet<Game>();

/** Mark a game as a look-ahead copy: its edits are not recorded for undo, and it cannot be undone or redone. */
export function markLookahead(g: Game) {
  lookaheads.add(g);
}

export const isLookahead = (g: Game) => lookaheads.has(g);

// ---------- structure snapshots (undo) ----------

export interface Snapshot {
  nodes: Pick<GNode, 'id' | 'type' | 'x' | 'y' | 'recipe' | 'material' | 'depositId' | 'lv' | 'paid' | 'mode' | 'born'>[];
  wires: Pick<Wire, 'id' | 'from' | 'port' | 'to' | 'tier' | 'paid' | 'weight' | 'filter'>[];
}

export function snapshot(g: Game): Snapshot {
  return {
    nodes: g.nodes.map((n) => ({
      id: n.id, type: n.type, x: n.x, y: n.y, recipe: n.recipe, material: n.material,
      depositId: n.depositId, lv: { ...n.lv }, paid: n.paid, mode: n.mode, born: n.born,
    })),
    wires: g.wires.map((w) => ({
      id: w.id, from: w.from, port: w.port, to: w.to, tier: w.tier, paid: w.paid, weight: w.weight, filter: w.filter,
    })),
  };
}

/**
 * Nodes that have left the board (deleted, taken off by an undo or redo, or re-tooled), kept so that
 * bringing one back restores it exactly as it was: buffers, progress, utilisation and age.
 * Without this a node that came back was brand new, which emptied a Silo on undo and let "delete, undo"
 * reset a machine's age so that Flow stopped counting it.
 * One entry per node id, and a node comes off the shelf when it goes back on the board, so its contents
 * exist in exactly one place and can never be duplicated.
 */
const shelves = new WeakMap<Game, Map<number, GNode>>();
const SHELF_SIZE = 400;

/** Remember a node (as it is right now) that is about to leave the board or be wiped. */
export function shelve(g: Game, n: GNode) {
  let shelf = shelves.get(g);
  if (!shelf) shelves.set(g, (shelf = new Map()));
  shelf.delete(n.id);
  shelf.set(n.id, n);
  if (shelf.size > SHELF_SIZE) shelf.delete(shelf.keys().next().value as number);
}

/** Restore structure from a snapshot, keeping the runtime state (buffers, progress, age) of every node that is unchanged or comes back. */
export function restore(g: Game, s: Snapshot) {
  const oldN = new Map(g.nodes.map((n) => [n.id, n]));
  const oldW = new Map(g.wires.map((w) => [w.id, w]));
  const shelf = shelves.get(g);
  const matches = (n: GNode | undefined, sn: Snapshot['nodes'][number]) => !!n && n.recipe === sn.recipe && n.type === sn.type;
  const kept = new Set<number>();
  g.nodes = s.nodes.map((sn) => {
    const live = oldN.get(sn.id);
    const shelved = shelf?.get(sn.id);
    let from: GNode;
    if (matches(live, sn)) {
      from = live!;
      kept.add(sn.id);
    } else if (matches(shelved, sn)) {
      from = shelved!;
      shelf!.delete(sn.id);
    } else {
      // Never seen in this shape: a new node, with the age the snapshot recorded.
      from = makeNode(g, sn.type, sn.x, sn.y);
      g.nextId--; // makeNode consumed an id we do not need
    }
    return { ...from, ...sn, lv: { ...sn.lv } };
  });
  // Whatever this took off the board goes on the shelf as it is now.
  for (const n of oldN.values()) if (!kept.has(n.id)) shelve(g, n);
  g.wires = s.wires.map((sw) => {
    const prev = oldW.get(sw.id);
    const fresh = makeWire(g, sw.from, sw.port, sw.to);
    g.nextId--;
    return { ...(prev ?? fresh), ...sw };
  });
  g.rev++;
}

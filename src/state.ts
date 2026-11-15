import { DataTier, MATERIALS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, RULES, TECHS } from './content';

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
  /**
   * For a node from a save of the public version (which priced things lower): what it cost there, plus what has
   * been spent on it since. Its refund is never more than that (refundOf in src/actions.ts).
   */
  legacyPaid?: number;
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

/**
 * A change the player made to the board, as the adviser needs to remember it: when, and what kind of thing was
 * done to what kind of node ("upgrade:speed:Lab", "wire:Ink Refiner>Lab", "build:well:glint", "research:R2",
 * or plain "edit" for anything no tip ever asks for).
 */
export interface Edit { at: number; what: string }

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
  /** Since when it has looked out of reach (src/orders.ts, RULES.orders.retire), if it does. */
  slowSince?: number;
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
   * (g.seenSurplus): the moment to introduce the demand gauge. Raised once per save, right after the 'tech'
   * event that grants Market Lens (C1).
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
  /**
   * Seconds the smoothed Flow has stayed at or above "all but one producer flowing" (nearShare in src/flow.ts):
   * the bar the "hold Flow" goal also accepts once it has been on the card for RULES.flow.valveAfter seconds.
   */
  flowNear: number;
  /** The same for "all but two producers flowing" (nearShare(producers, 2)), the valve's second step (RULES.flow.valveAfter2). */
  flowNear2?: number;
  // --- goals and orders ---
  /** Active goal: index into GOALS (GOALS.length when all are claimed) and whether it is waiting for claimGoal(). */
  goal: { i: number; ready: boolean };
  /**
   * When the active goal became the active one: its index and the game time. Kept by src/goals.ts (goalAge).
   * A save from before this field starts counting when it is loaded, a goal index set by hand on the next tick.
   */
  goalAt?: { i: number; t: number };
  ordersOn: boolean;
  order: Order | null;
  /** Running seed of the order generator. */
  orderSeed: number;
  /** The first Lens has been made. Set once. */
  ended: boolean;
  /** Something has sold over its demand for a few seconds (RULES.demand.notice). Set once, with Market Lens and a 'surplus' event. */
  seenSurplus: boolean;
  stats: Stats;
  /**
   * The player's last changes to the board, oldest first (noteEdit below; nothing older than
   * RULES.tips.repeatAfter is kept). The adviser reads it: it says nothing for a while after a change and does
   * not ask again for what has just been done. Part of the save, so the adviser gives the same answer on a
   * copy of the game as on the game itself (a look-ahead copy, or one handed to a worker).
   */
  edits?: Edit[];
  /**
   * Game time of the last press of Upgrade all on Wells (src/actions.ts upgradeAll; a press on any other kind
   * leaves it alone). "Upgrade all your Wells at once" is met by such a press made since the goal came up; `edits`
   * cannot carry that, as it forgets anything older than a minute, and the Claim then went with the next undo or
   * reload. It is part of the undo step (Snapshot.bulkAt): undoing the press takes the goal's readiness back.
   */
  bulkAt?: number;
  // --- not saved ---
  rev: number;
  events: GameEvent[];
  tickAcc: { credits: number; data: Record<DataTier, number>; sold: Bag };
}

/** "Glint Well", "Ink Refiner", "Lab": what a node is called in a sentence. */
export function nodeNoun(n: GNode): string {
  if (n.type === 'well') return `${n.material ? MATERIALS[n.material].name + ' ' : ''}Well`;
  const r = n.recipe ? RECIPES[n.recipe] : null;
  return `${r ? r.name + ' ' : ''}${NODE_DEFS[n.type].name}`;
}

/** Remember a change the player has just made to the board (see Game.edits). */
export function noteEdit(g: Game, what: string) {
  const keep = RULES.tips.repeatAfter;
  const list = (g.edits ?? []).filter((e) => g.time - e.at < keep && e.at <= g.time);
  list.push({ at: g.time, what });
  if (list.length > 32) list.splice(0, list.length - 32);
  g.edits = list;
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
    flow: 0, flowOn: false, flowStreak: 0, flowBest: 0, flowHold: 0, flowNear: 0, flowNear2: 0,
    goal: { i: 0, ready: false }, goalAt: { i: 0, t: 0 },
    ordersOn: false, order: null, orderSeed: RULES.orders.seed >>> 0,
    ended: false, seenSurplus: false,
    stats: newStats(), edits: [],
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
    ...(typeof o.slowSince === 'number' && isFinite(o.slowSince) ? { slowSince: o.slowSince } : {}),
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
    // The board's shape and its deposits: rebuilt from the new-game defaults where the save has none that make sense.
    const b = raw.board && typeof raw.board === 'object' ? raw.board : {};
    g.board = { w: pos(b.w, base.board.w) || base.board.w, h: pos(b.h, base.board.h) || base.board.h, expansions: Math.floor(pos(Number(b.expansions), 0)) };
    const deposits = (Array.isArray(raw.deposits) ? raw.deposits : base.deposits)
      .filter((d: Partial<Deposit> | null) => !!d && typeof d === 'object' && typeof d.id === 'number' && isFinite(d.id) && !!MATERIALS[d.mat as MatId])
      .map((d: Deposit) => ({ id: d.id, x: num(d.x, 0), y: num(d.y, 0), mat: d.mat }));
    g.deposits = deposits.length ? deposits : base.deposits;
    // Nodes: a node of a kind this version does not know (a save from a later one), or an entry that is not a
    // node at all, is dropped rather than refusing the whole save; every field gets a sound value; a second node
    // with an id already in use is dropped. Anything that references content that no longer exists is cleared.
    const legacy = !('goal' in raw);
    const seen = new Set<number>();
    g.nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).filter((n: Partial<GNode> | null) => {
      if (!n || typeof n !== 'object' || !NODE_DEFS[n.type as NodeType] || typeof n.id !== 'number' || !isFinite(n.id) || seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    }).map((n: GNode) => {
      const fresh = makeNode(base, n.type, 0, 0);
      const lv = n.lv && typeof n.lv === 'object' ? n.lv : fresh.lv;
      const level = (v: unknown) => Math.floor(pos(v, 0));
      const out: GNode = {
        ...fresh, ...n,
        x: num(n.x, 0), y: num(n.y, 0),
        recipe: typeof n.recipe === 'string' && RECIPES[n.recipe] ? n.recipe : null,
        material: n.material && MATERIALS[n.material] ? n.material : null,
        depositId: typeof n.depositId === 'number' && isFinite(n.depositId) ? n.depositId : null,
        lv: { speed: level(lv.speed), eff: level(lv.eff), buffer: level(lv.buffer) },
        paid: pos(n.paid), mode: (['even', 'ratio', 'priority', 'filter'] as RouterMode[]).includes(n.mode) ? n.mode : 'even',
        born: num(n.born, 0), inb: loadBag(n.inb), outb: loadBag(n.outb),
        prog: pos(n.prog), crafting: !!n.crafting, cycles: pos(n.cycles), util: Math.min(1, pos(n.util)), rate: pos(n.rate),
        fBlocked: Math.min(1, pos(n.fBlocked)), fStarved: Math.min(1, pos(n.fStarved)),
        status: (['working', 'blocked', 'starved', 'idle'] as Status[]).includes(n.status) ? n.status : 'idle',
        missing: n.missing && MATERIALS[n.missing] ? n.missing : null, blockedOn: n.blockedOn && MATERIALS[n.blockedOn] ? n.blockedOn : null,
        gain: 0, gainB: {}, grace: 3,
      };
      // A save from the public version, which charged less: what was paid there caps the refund (refundOf).
      if (legacy) out.legacyPaid = out.paid;
      else if (typeof n.legacyPaid === 'number' && isFinite(n.legacyPaid)) out.legacyPaid = Math.max(0, n.legacyPaid);
      else delete out.legacyPaid;
      return out;
    });
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    /** Output ports a node has: one per output of its recipe, one for a Well or a junction, none for a sink. */
    const portsOf = (n: GNode) => (n.type === 'market' || n.type === 'lab' || n.type === 'void' ? 0 : n.recipe ? RECIPES[n.recipe].outputs.length : 1);
    g.wires = (Array.isArray(raw.wires) ? raw.wires : []).filter((w: Partial<Wire> | null) => {
      if (!w || typeof w !== 'object' || typeof w.id !== 'number' || !isFinite(w.id) || seen.has(w.id)) return false;
      const from = byId.get(w.from as number);
      if (!from || !byId.has(w.to as number) || w.from === w.to) return false;
      const port = num(w.port, 0);
      if (port < 0 || port >= Math.max(1, portsOf(from))) return false;
      seen.add(w.id);
      return true;
    }).map((w: Wire): Wire => ({
      ...w, port: Math.floor(num(w.port, 0)),
      // A pipe tier this version does not have is the best one it has.
      tier: Math.min(PIPES.length - 1, Math.floor(pos(w.tier))), paid: pos(w.paid), weight: Math.min(99, Math.floor(pos(w.weight, 1))),
      filter: w.filter && MATERIALS[w.filter] ? w.filter : null, mat: w.mat && MATERIALS[w.mat] ? w.mat : null,
      mixed: !!w.mixed, budget: num(w.budget, 0), flow: num(w.flow, 0),
    }));
    // Ids are handed out from nextId: never one that is already in use.
    let top = 0;
    for (const x of [...g.nodes, ...g.wires, ...g.deposits]) top = Math.max(top, x.id);
    g.nextId = Math.max(Math.floor(num(raw.nextId, 0)), top + 1, base.nextId);
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
    // Since when that goal has been the active one. Without it (an older save) the count starts now.
    const at = raw.goalAt;
    const since = at && typeof at === 'object' && at.i === g.goal.i && typeof at.t === 'number' && isFinite(at.t) ? Math.max(0, Math.min(at.t, g.time)) : g.time;
    g.goalAt = { i: g.goal.i, t: since };
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
    g.flowNear = pos(raw.flowNear);
    g.flowNear2 = pos(raw.flowNear2);
    g.orderSeed = num(raw.orderSeed, base.orderSeed) >>> 0;
    g.order = loadOrder(raw.order);
    // A save from before the `ended` flag that already has a Lens is past the demo.
    g.ended = typeof raw.ended === 'boolean' ? raw.ended : !!g.made[RULES.capstone];
    g.seenSurplus = !!raw.seenSurplus;
    // Market Lens comes with the first sale over demand (src/sim.ts). A save that saw one before that rule gets it now.
    if (g.seenSurplus && !g.techs.includes('C1')) g.techs.push('C1');
    // The last press of Upgrade all: a time in the game, none from the future.
    if (typeof raw.bulkAt === 'number' && isFinite(raw.bulkAt) && raw.bulkAt >= 0) g.bulkAt = Math.min(raw.bulkAt, g.time);
    else delete g.bulkAt;
    // The adviser's memory of the last changes: plain notes, none from the future.
    g.edits = (Array.isArray(raw.edits) ? raw.edits : [])
      .filter((e: Partial<Edit> | null) => !!e && typeof e.what === 'string' && typeof e.at === 'number' && isFinite(e.at) && e.at <= g.time)
      .map((e: Edit) => ({ at: e.at, what: e.what.slice(0, 80) }))
      .slice(-32);
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

/** Where a save that cannot be read is kept, before anything can overwrite it (a new game saves under KEY). */
export const BACKUP_KEY = `${KEY}.bak`;

export function loadGame(): Game | null {
  try {
    const json = localStorage.getItem(KEY);
    if (!json) return null;
    const g = deserialize(json);
    if (!g) {
      // Not readable by this version (damaged, or from one that is too different): keep it, so that the new game
      // the start screen offers does not destroy it.
      try {
        localStorage.setItem(BACKUP_KEY, json);
      } catch {
        /* storage full or unavailable */
      }
    }
    return g;
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
  nodes: Pick<GNode, 'id' | 'type' | 'x' | 'y' | 'recipe' | 'material' | 'depositId' | 'lv' | 'paid' | 'legacyPaid' | 'mode' | 'born'>[];
  wires: Pick<Wire, 'id' | 'from' | 'port' | 'to' | 'tier' | 'paid' | 'weight' | 'filter'>[];
  /** The board's size and its deposits: an expansion is undone with the rest (actions.ts expandBoard). */
  board?: Game['board'];
  deposits?: Deposit[];
  /**
   * The last press of Upgrade all on Wells (Game.bulkAt), null for none: undoing the press takes back "Upgrade
   * all your Wells at once" with it, which is met by that press alone (actions.ts unready).
   */
  bulkAt?: number | null;
}

export function snapshot(g: Game): Snapshot {
  return {
    nodes: g.nodes.map((n) => ({
      id: n.id, type: n.type, x: n.x, y: n.y, recipe: n.recipe, material: n.material,
      depositId: n.depositId, lv: { ...n.lv }, paid: n.paid, ...(n.legacyPaid != null ? { legacyPaid: n.legacyPaid } : {}), mode: n.mode, born: n.born,
    })),
    wires: g.wires.map((w) => ({
      id: w.id, from: w.from, port: w.port, to: w.to, tier: w.tier, paid: w.paid, weight: w.weight, filter: w.filter,
    })),
    board: { ...g.board },
    deposits: g.deposits.map((d) => ({ ...d })),
    bulkAt: g.bulkAt ?? null,
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
  if (s.board) g.board = { ...s.board };
  if (s.deposits) g.deposits = s.deposits.map((d) => ({ ...d }));
  if (s.bulkAt !== undefined) {
    if (s.bulkAt == null) delete g.bulkAt;
    else g.bulkAt = s.bulkAt;
  }
  g.rev++;
}

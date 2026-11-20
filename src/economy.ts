import {
  DATA_YIELD, DataTier, MATERIALS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, RULES, Recipe, TECHS, Tech, Track,
} from './content';
import { graph, isMachine, isPass } from './graph';
import { Game, GNode, noteEdit } from './state';

export const has = (g: Game, tech: string | undefined) => !tech || g.techs.includes(tech);

export const nodeUnlocked = (g: Game, type: NodeType) => has(g, NODE_DEFS[type].tech);
export const recipeUnlocked = (g: Game, r: Recipe) => has(g, r.tech) && nodeUnlocked(g, r.machine);
export const matUnlocked = (g: Game, m: MatId) => has(g, MATERIALS[m].tech);

export function nodeCount(g: Game, type: NodeType) {
  let c = 0;
  for (const n of g.nodes) if (n.type === type) c++;
  return c;
}

/** Price of a node of this type when `owned` of them are already on the board. */
export function nodeCostAt(type: NodeType, owned: number): number {
  const def = NODE_DEFS[type];
  if (def.firstFree) {
    if (owned <= 0) return 0;
    owned -= 1;
  }
  return Math.round(def.base * Math.pow(def.growth, Math.max(0, owned)));
}

export const nodeCost = (g: Game, type: NodeType): number => nodeCostAt(type, nodeCount(g, type));

/** What it would cost to buy one node of this type back after deleting it: the refund for the node itself. */
export const buyBackPrice = (g: Game, type: NodeType): number => nodeCostAt(type, nodeCount(g, type) - 1);

export function trackAvailable(g: Game, n: GNode, track: Track): boolean {
  if (!NODE_DEFS[n.type].tracks.includes(track)) return false;
  if (track === 'eff') return has(g, 'U1');
  return true;
}

export function maxLevel(g: Game, track: Track): number {
  if (track === 'speed') return has(g, 'U2') ? 25 : 10;
  if (track === 'eff') return 4;
  return 5;
}

/** Price of taking a track from `level` to `level + 1`. */
export function upgradeCostAt(type: NodeType, track: Track, level: number): number {
  const U = RULES.upgrade;
  const first = U[track][type] ?? U.fallback * Math.max(10, NODE_DEFS[type].base);
  return Math.round(first * Math.pow(U.growth, level));
}

export const upgradeCost = (n: GNode, track: Track): number => upgradeCostAt(n.type, track, n.lv[track]);

/** Credits spent on a node's upgrades, worked out from its levels. Refunded in full on delete. */
export function upgradeValue(n: GNode): number {
  let v = 0;
  for (const track of NODE_DEFS[n.type].tracks) for (let l = 0; l < n.lv[track]; l++) v += upgradeCostAt(n.type, track, l);
  return v;
}

export const TRACK_INFO: Record<Track, { name: string; desc: (n: GNode) => string }> = {
  speed: { name: 'Speed', desc: (n) => (n.type === 'well' ? '+25% extraction rate' : n.type === 'lab' ? '+25% study rate' : '−15% craft time') },
  eff: { name: 'Efficiency', desc: (n) => `every ${6 - n.lv.eff}${ord(6 - n.lv.eff)} craft is free` },
  buffer: { name: 'Buffer', desc: () => '+100% internal storage' },
};

function ord(n: number) {
  return n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
}

// ---------- rates ----------

export const wellRate = (n: GNode) => (n.material && MATERIALS[n.material].value > 1 ? 0.8 : 1) * Math.pow(1.25, n.lv.speed);
export const cycleTime = (n: GNode, r: Recipe) => r.time * Math.pow(0.85, n.lv.speed);
export const labRate = (g: Game, n: GNode) => (has(g, 'R2') ? 2 : 1) * Math.pow(1.25, n.lv.speed);
export const bufMult = (n: GNode) => 1 + n.lv.buffer;
/** A machine at efficiency level k skips inputs on every (7-k)th craft. */
export const effEvery = (n: GNode) => (n.lv.eff > 0 ? 7 - n.lv.eff : 0);

export function recipeOf(n: GNode): Recipe | null {
  return n.recipe ? RECIPES[n.recipe] ?? null : null;
}

/** Materials that can come out of a node's output port, following pass-through nodes upstream. */
export function materialsAt(g: Game, id: number, port = 0, seen = new Set<number>()): MatId[] {
  const n = graph(g).byId.get(id);
  if (!n || seen.has(id)) return [];
  seen.add(id);
  if (n.type === 'well') return n.material ? [n.material] : [];
  if (isMachine(n)) {
    const m = recipeOf(n)?.outputs[port]?.[0];
    return m ? [m] : [];
  }
  if (isPass(n)) {
    const out = new Set<MatId>();
    for (const w of graph(g).ins.get(id) ?? []) for (const m of materialsAt(g, w.from, w.port, seen)) out.add(m);
    return [...out];
  }
  return [];
}

export function recipesFor(g: Game, type: NodeType): Recipe[] {
  return Object.values(RECIPES).filter((r) => r.machine === type && recipeUnlocked(g, r));
}

/**
 * The unlocked recipe a machine of this type takes from the materials wired into it: of those that use any of
 * them, the one that uses the largest share of its inputs from them, then the one with the fewest inputs, then
 * the earliest in the tech tree (RECIPES order). So a Fabricator built from the Screen Assembler's port makes
 * Phone even once Laptop is researched, and an Assembler built from the Copper Refiner's port makes Circuit after
 * Reclamation: what the cards say. (It used to be the dearest output, which picked Laptop and Cable there.)
 */
export function pickRecipe(g: Game, type: NodeType, mats: MatId[]): Recipe | null {
  const order = Object.keys(RECIPES);
  const share = (r: Recipe) => r.inputs.filter((i) => mats.includes(i[0])).length / r.inputs.length;
  const fits = recipesFor(g, type).filter((r) => r.inputs.some((i) => mats.includes(i[0])));
  fits.sort((a, b) => share(b) - share(a) || a.inputs.length - b.inputs.length || order.indexOf(a.id) - order.indexOf(b.id));
  return fits[0] ?? null;
}

/**
 * Machines that stand without a recipe with something wired into them take the recipe that research has since
 * made possible for what they get (a Refiner on the Tar port picks Rubber once Reclamation is researched).
 * Called after every grant of a tech, and once a tick (src/sim.ts) for a board loaded or changed otherwise: it
 * costs a look at each machine without a recipe, and there are hardly ever any.
 */
export function adoptRecipes(g: Game) {
  const c = graph(g);
  for (const n of g.nodes) {
    if (!isMachine(n) || n.recipe || !(c.ins.get(n.id)?.length)) continue;
    const mats = new Set<MatId>();
    for (const w of c.ins.get(n.id) ?? []) for (const m of materialsAt(g, w.from, w.port)) mats.add(m);
    const r = mats.size ? pickRecipe(g, n.type, [...mats]) : null;
    if (!r) continue;
    n.recipe = r.id;
    n.born = g.time;
    g.rev++;
  }
}

// ---------- market ----------

export const demandMult = (g: Game) => (has(g, 'C2') ? 1.5 : 1) * (has(g, 'C5') ? 2 : 1);
/** Full price of one item, before the Flow bonus. */
export const valueOf = (g: Game, m: MatId) => MATERIALS[m].value * (MATERIALS[m].tier >= 2 && has(g, 'C4') ? 1.25 : 1);
/** Items per second the Markets buy at full price. */
export const demandRate = (g: Game, m: MatId) => MATERIALS[m].demand * demandMult(g);
/** How much unused demand a Market banks, in items, so that bursty deliveries still get full price. */
export const demandBurst = (g: Game, m: MatId) => Math.max(RULES.demand.minBurst, demandRate(g, m) * RULES.demand.burstSeconds);

/** Sale price multiplier from Flow: 1 until the Flow meter is unlocked, then 1 + bonus × Flow. */
export const flowMult = (g: Game) => (g.flowOn ? 1 + RULES.flow.bonus * g.flow : 1);

export interface DemandInfo {
  /** Items per second being sold right now (smoothed). */
  rate: number;
  /** Items per second that sell at full price. */
  demand: number;
  /** The part of `rate` sold at full price, and the part sold as surplus. rate = fullRate + surplusRate. */
  fullRate: number;
  surplusRate: number;
  /** Credits per item at full price and for the surplus, before the Flow bonus. */
  unitPrice: number;
  surplusPrice: number;
  /** Current Flow multiplier on both prices (1 when Flow is locked). */
  mult: number;
  /** Credits per second this material earns right now, Flow bonus included. */
  income: number;
}

/**
 * Everything the Market inspector shows for one material, ready to print:
 * "{fullRate}/s at {unitPrice}¢ · {surplusRate}/s surplus at {surplusPrice}¢".
 */
export function demandInfo(g: Game, m: MatId): DemandInfo {
  const rate = g.soldRate[m] ?? 0;
  const demand = demandRate(g, m);
  const fullRate = Math.min(rate, demand);
  const surplusRate = Math.max(0, rate - demand);
  const unitPrice = valueOf(g, m);
  const surplusPrice = unitPrice * RULES.demand.surplusShare;
  const mult = flowMult(g);
  return { rate, demand, fullRate, surplusRate, unitPrice, surplusPrice, mult, income: (fullRate * unitPrice + surplusRate * surplusPrice) * mult };
}

/** Average price as a share of the full price: 1 while everything sells at full price, falling toward the surplus share. */
export function saturation(g: Game, m: MatId): number {
  const d = demandInfo(g, m);
  return d.rate > 1e-9 ? (d.fullRate + d.surplusRate * RULES.demand.surplusShare) / d.rate : 1;
}

/** Average credits per item at the current sell rate, before the Flow bonus. */
export const price = (g: Game, m: MatId) => valueOf(g, m) * saturation(g, m);

/**
 * Sell `amt` items: the banked demand is used up at full price, the rest goes at the surplus price.
 * Returns the credits earned (Flow bonus included). The caller pays them out.
 */
export function sellValue(g: Game, m: MatId, amt: number): number {
  const left = g.demandLeft[m] ?? demandBurst(g, m);
  const full = Math.min(amt, left);
  g.demandLeft[m] = left - full;
  return (full + (amt - full) * RULES.demand.surplusShare) * valueOf(g, m) * flowMult(g);
}

/** Refill the banked demand. Called once per tick, before anything is sold. */
export function refillDemand(g: Game, dt: number) {
  for (const k in g.demandLeft) {
    const m = k as MatId;
    const next = (g.demandLeft[m] ?? 0) + demandRate(g, m) * dt;
    if (next >= demandBurst(g, m)) delete g.demandLeft[m];
    else g.demandLeft[m] = next;
  }
}

export function dataYield(g: Game, m: MatId): { tier: DataTier; amount: number } {
  const y = DATA_YIELD[MATERIALS[m].tier];
  return { tier: y.tier, amount: (MATERIALS[m].study ?? y.amount) * (has(g, 'R3') ? 1.5 : 1) };
}

// ---------- pipes / board ----------

export const pipeCap = (tier: number) => PIPES[tier].cap;
export const maxPipeTier = (g: Game) => {
  let t = 0;
  for (let i = 1; i < PIPES.length; i++) if (has(g, PIPES[i].tech)) t = i;
  return t;
};

export const expansionCost = (g: Game) => Math.round(RULES.expansion.base * Math.pow(RULES.expansion.growth, g.board.expansions));
export const offlineCap = (g: Game) => (has(g, 'R4') ? RULES.away.capHoursLong : RULES.away.capHours) * 3600;

// ---------- tech ----------

/**
 * Demand has shown itself: something has sold over its demand, which is when Market Lens is granted. A save
 * from before that rule that was given Market Lens by a goal (or went on to buy Wider Demand) counts too:
 * nothing a player has seen in the tree is taken away again.
 */
export const demandShown = (g: Game) => g.seenSurplus || g.techs.includes('C1') || g.techs.includes('C2');
/**
 * Not shown in the tree yet: Long Absence stays hidden until the demo has ended, and the Commerce branch
 * (Market Lens, Wider Demand and what hangs on it) until demand has shown itself.
 */
export const techHidden = (g: Game, t: Tech) => (!!t.needsEnd && !g.ended) || (!!t.needsSurplus && !demandShown(g));
/** Can be researched now if affordable. Goal-granted techs (`auto`) are never purchasable. */
export const techAvailable = (g: Game, t: Tech) =>
  !g.techs.includes(t.id) && !t.auto && !techHidden(g, t) && t.requires.every((r) => g.techs.includes(r));
export const techAffordable = (g: Game, t: Tech) =>
  (Object.keys(t.cost) as DataTier[]).every((k) => g.data[k] >= (t.cost[k] ?? 0));

export function readyTechs(g: Game): Tech[] {
  return Object.values(TECHS).filter((t) => techAvailable(g, t) && techAffordable(g, t));
}

/** Seconds until affordable at current data rates, or Infinity. */
export function techEta(g: Game, t: Tech): number {
  let eta = 0;
  for (const k of Object.keys(t.cost) as DataTier[]) {
    const missing = (t.cost[k] ?? 0) - g.data[k];
    if (missing <= 0) continue;
    const rate = g.dataRate[k];
    if (rate <= 1e-6) return Infinity;
    eta = Math.max(eta, missing / rate);
  }
  return eta;
}

export function techProgress(g: Game, t: Tech): number {
  let p = 1;
  for (const k of Object.keys(t.cost) as DataTier[]) {
    const c = t.cost[k] ?? 0;
    if (c > 0) p = Math.min(p, g.data[k] / c);
  }
  return Math.max(0, Math.min(1, p));
}

export function research(g: Game, id: string): boolean {
  const t = TECHS[id];
  if (!t || !techAvailable(g, t) || !techAffordable(g, t)) return false;
  for (const k of Object.keys(t.cost) as DataTier[]) g.data[k] -= t.cost[k] ?? 0;
  grantTech(g, id);
  noteEdit(g, `research:${id}`);
  return true;
}

export function grantTech(g: Game, id: string) {
  if (!TECHS[id] || g.techs.includes(id)) return;
  g.techs.push(id);
  g.queue = g.queue.filter((q) => q !== id);
  g.events.push({ kind: 'tech', id });
  g.rev++;
  adoptRecipes(g);
}

/** The demo is complete (first Phone). Sets `ended` once and raises 'demo-end'; later calls do nothing. */
export function endDemo(g: Game) {
  if (g.ended) return;
  g.ended = true;
  g.stats.firstLensAt = g.time;
  g.events.push({ kind: 'demo-end', text: 'Demo complete: you made your first Phone.' });
  g.rev++;
}

export interface EndStats {
  /** Seconds played (game time; time away is not counted). */
  playTime: number;
  /** Game time of the first Phone, or null before it. */
  firstLensAt: number | null;
  /** Credits earned, by source. */
  fromSales: number;
  fromOrders: number;
  fromGoals: number;
  fromAway: number;
  totalEarned: number;
  nodesBuilt: number;
  wiresMade: number;
  ordersFilled: number;
  /** Longest unbroken time at 100% Flow, in seconds, and how often Flow State was reached. */
  bestFlowStreak: number;
  flowStates: number;
  techs: number;
  /** Different materials made so far. */
  materials: number;
}

/** Everything the end-of-demo summary shows. */
export function endStats(g: Game): EndStats {
  const s = g.stats;
  return {
    playTime: g.time, firstLensAt: s.firstLensAt,
    fromSales: s.fromSales, fromOrders: s.fromOrders, fromGoals: s.fromGoals, fromAway: s.fromAway,
    totalEarned: s.fromSales + s.fromOrders + s.fromGoals + s.fromAway,
    nodesBuilt: s.nodesBuilt, wiresMade: s.wiresMade, ordersFilled: s.ordersFilled,
    bestFlowStreak: g.flowBest, flowStates: s.flowStates,
    techs: g.techs.length, materials: Object.values(g.made).filter(Boolean).length,
  };
}

// ---------- formatting ----------

export function fmt(n: number): string {
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return Math.floor(n).toLocaleString('en-US');
  if (a >= 100) return Math.floor(n).toLocaleString('en-US');
  if (a >= 10) return (Math.floor(n * 10) / 10).toString();
  return (Math.floor(n * 100) / 100).toString();
}

export const fmtInt = (n: number) => Math.floor(n).toLocaleString('en-US');
export const fmtRate = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));

export function fmtTime(s: number): string {
  if (!isFinite(s)) return '—';
  if (s < 60) return `${Math.ceil(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function costText(t: Tech): string {
  const parts: string[] = [];
  if (t.cost.a) parts.push(`${t.cost.a}α`);
  if (t.cost.b) parts.push(`${t.cost.b}β`);
  if (t.cost.g) parts.push(`${t.cost.g}γ`);
  return parts.join(' ');
}

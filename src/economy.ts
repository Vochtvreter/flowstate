import {
  DATA_YIELD, DataTier, MATERIALS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, Recipe, TECHS, Tech, Track,
} from './content';
import { Game, GNode } from './state';

export const has = (g: Game, tech: string | undefined) => !tech || g.techs.includes(tech);

export const nodeUnlocked = (g: Game, type: NodeType) => has(g, NODE_DEFS[type].tech);
export const recipeUnlocked = (g: Game, r: Recipe) => has(g, r.tech) && nodeUnlocked(g, r.machine);
export const matUnlocked = (g: Game, m: MatId) => has(g, MATERIALS[m].tech);

export function nodeCount(g: Game, type: NodeType) {
  let c = 0;
  for (const n of g.nodes) if (n.type === type) c++;
  return c;
}

export function nodeCost(g: Game, type: NodeType): number {
  const def = NODE_DEFS[type];
  let owned = nodeCount(g, type);
  if (def.firstFree) {
    if (owned === 0) return 0;
    owned -= 1;
  }
  return Math.round(def.base * Math.pow(def.growth, owned));
}

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

export function upgradeCost(n: GNode, track: Track): number {
  const base = Math.max(10, NODE_DEFS[n.type].base);
  const mult = track === 'speed' ? 0.5 : track === 'eff' ? 1.5 : 0.4;
  return Math.round(mult * base * Math.pow(1.6, n.lv[track]));
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

// ---------- market ----------

export const demandMult = (g: Game) => (has(g, 'C2') ? 1.5 : 1) * (has(g, 'C5') ? 2 : 1);
export const valueOf = (g: Game, m: MatId) => MATERIALS[m].value * (MATERIALS[m].tier >= 2 && has(g, 'C4') ? 1.25 : 1);

/** 1 = full price, falls toward 0 as the market floods. */
export function saturation(g: Game, m: MatId): number {
  return 1 / (1 + (g.soldRate[m] ?? 0) / (MATERIALS[m].demand * demandMult(g)));
}

export const price = (g: Game, m: MatId) => valueOf(g, m) * saturation(g, m);

export function dataYield(g: Game, m: MatId): { tier: DataTier; amount: number } {
  const y = DATA_YIELD[MATERIALS[m].tier];
  return { tier: y.tier, amount: y.amount * (has(g, 'R3') ? 1.5 : 1) };
}

// ---------- pipes / board ----------

export const pipeCap = (tier: number) => PIPES[tier].cap;
export const maxPipeTier = (g: Game) => {
  let t = 0;
  for (let i = 1; i < PIPES.length; i++) if (has(g, PIPES[i].tech)) t = i;
  return t;
};

export const expansionCost = (g: Game) => Math.round(100 * Math.pow(2.2, g.board.expansions));
export const offlineCap = (g: Game) => (has(g, 'R4') ? 8 : 2) * 3600;

// ---------- tech ----------

export const techAvailable = (g: Game, t: Tech) => !g.techs.includes(t.id) && !t.auto && t.requires.every((r) => g.techs.includes(r));
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
  return true;
}

export function grantTech(g: Game, id: string) {
  if (g.techs.includes(id)) return;
  g.techs.push(id);
  g.queue = g.queue.filter((q) => q !== id);
  g.events.push({ kind: 'tech', id });
  g.rev++;
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

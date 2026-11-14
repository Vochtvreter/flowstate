/**
 * Pacing bot: a headless, DOM-free simulated FIRST-TIME player.
 *
 *   npm run pacing                          play 30 minutes of the current build and print the report
 *   npm run pacing -- --policy=mainline     a focused player who saves Data for the Processing branch
 *   npm run pacing -- --profile=<name>      what-if numbers from tools/pacing-profiles.ts
 *   npm run pacing -- --seed=3 --minutes=45 --quiet
 *   other flags: --patience=<s>  --sharedLab  --noExpand
 *
 * The bot imports the game's own modules, so it always plays the real rules. It models a human,
 * not an optimiser: one action every few seconds, no look-ahead, and a greedy policy
 *   claim what is ready -> research what is affordable -> fix what is red -> build the new toy -> grow the bottleneck.
 * It plays the game's real goal chain (src/goals.ts) and real orders (src/orders.ts): it claims both as
 * they become ready, and does the few goals its own policy would never stumble into (upgrade a Well,
 * expand, set a Router toward a Lab). Everything worth tweaking is in CFG below. Profiles
 * (tools/pacing-profiles.ts) can change content numbers in memory and add per-tick `hooks`, so a tuning
 * idea can be measured before anyone edits src/.
 *
 * The report: (a) event timeline, (b) per-minute table, (c) when each tech was researched and each
 * material first made, (d) dead stretches, (e) where the content runs out, then the goal chain,
 * where the credits came from, and key times.
 *
 * NOTE (stage 1 of the pitch build): this file was only adapted enough to run against the new rules.
 * The slow policy and the section 1 targets of docs/PITCH_PLAN.md are still to be wired in.
 */
declare const process: { argv: string[]; stdout: { write(s: string): void } };

import { DATA_YIELD, DataTier, MATERIALS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, TECHS, Tech, Track } from '../src/content';
import {
  claimGoal, claimOrder, clearHistory, connect, cutWire, expandBoard, freeDeposits, materialsAt, placeNode, setMode, setWeight, upgrade,
  upgradeWire,
} from '../src/actions';
import {
  expansionCost, fmt, has, maxLevel, maxPipeTier, nodeCost, pipeCap, readyTechs, recipeOf, recipeUnlocked, research, saturation,
  techAvailable, techEta, trackAvailable, upgradeCost, wellRate,
} from '../src/economy';
import { GOALS, MAIN_GOALS, activeGoal, rewardText } from '../src/goals';
import { graph, isMachine, tick } from '../src/sim';
import { Game, GNode, Stats, Status, Wire, newGame } from '../src/state';
import { HookCtx, PROFILES, Profile, Reward } from './pacing-profiles';

// =====================================================================================
// Tunables
// =====================================================================================

export const CFG = {
  minutes: 30,
  dt: 0.05, // the game's own step (20 ticks per second)
  seed: 1,
  profile: 'current',

  // --- the player's hands ---
  firstActionDelay: 6, // seconds spent looking at the screen before the first drag
  /** [min, max] game seconds each kind of action keeps the player busy. */
  actionSeconds: {
    wire: [3, 4], build: [3, 4], upgrade: [3, 4], cut: [3, 4], expand: [3, 4], research: [5, 7], claim: [1.5, 2.5],
  } as Record<string, [number, number]>,
  noticeDelay: 4, // a red or yellow ring must last this long before the player reacts to it
  settleTime: 10, // after touching a problem, wait this long before judging that node again
  thinkEvery: 0.5, // how often an idle player re-checks what they can afford

  // --- research policy ---
  /** greedy: buy the cheapest affordable tech at once. mainline: save Data for the Processing branch. */
  techPolicy: 'greedy' as 'greedy' | 'mainline',
  techSkip: ['R4'], // no effect inside one sitting (offline cap)
  impulseShare: 0.35, // mainline: a side tech is still bought if it costs under this share of the next Processing tech

  // --- spending policy ---
  patience: 150, // if the next new toy is this many seconds of income away (or less), save for it
  pettyShare: 0.03, // ...while saving, only buy things under this share of the toy's price
  growShareOfTarget: 0.25, // while the toy is further away than that, upgrades may cost up to this share of its price
  saturationFloor: 0.9, // do not push a line whose product already averages below this share of its full price (i.e. sells a real surplus)
  expand: true, // expand the board whenever no unlocked deposit is free
  labPerTier: true, // one Lab per Data tier (false: everything goes into the first Lab)
  efficiency: true, // buy Efficiency upgrades once Efficiency Tuning is researched

  // --- reporting ---
  deadStretch: 45, // seconds with free hands and nothing useful to do
  quiet: false, // skip the event timeline
};

// =====================================================================================
// Small helpers
// =====================================================================================

const TIERS: DataTier[] = ['a', 'b', 'g'];
const GREEK: Record<DataTier, string> = { a: 'α', b: 'β', g: 'γ' };

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const pad = (s: string | number, n: number) => String(s).padStart(n);
const padR = (s: string | number, n: number) => String(s).padEnd(n);
const f1 = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2));
const techWeight = (t: Tech) => (t.cost.a ?? 0) + 4 * (t.cost.b ?? 0) + 12 * (t.cost.g ?? 0);
const costStr = (t: Tech) => TIERS.filter((k) => t.cost[k]).map((k) => `${t.cost[k]}${GREEK[k]}`).join('+') || 'free';
const matTier = (m: MatId) => DATA_YIELD[MATERIALS[m].tier].tier;
const isJunk = (m: MatId) => MATERIALS[m].value < 1;

type Cls = 'fix' | 'new' | 'grow';
interface Want {
  cls: Cls;
  kind: string;
  label: string;
  cost: number;
  run: () => boolean;
  /** A thing the player has never had (a machine for a new recipe, a Lab for a new Data tier): worth saving for. */
  novel?: boolean;
  /** Nodes whose status should be left to settle after this action. */
  settle?: number[];
}
interface Port { n: GNode; port: number }

interface Minute {
  t: number; credits: number; income: number; data: Record<DataTier, number>; dataRate: Record<DataTier, number>;
  nodes: number; techs: number; actions: number; idle: number; spent: number;
}

// =====================================================================================
// The simulated player
// =====================================================================================

class Bot {
  g: Game;
  profile: Profile;
  rnd: () => number;
  /** When the player's hands are next free. */
  freeAt = CFG.firstActionDelay;
  lastThink = -1;
  idleSince: number | null = null;
  idleWhy = '';
  seen = new Map<number, { s: Status; t: number }>();
  ignoreUntil = new Map<number, number>();
  /** Output ports whose Market / Lab wire was cut on purpose: never put it back. */
  noSink = new Set<string>();
  labTier = new Map<number, DataTier>();

  timeline: { t: number; text: string }[] = [];
  dead: { from: number; to: number; why: string; endedBy: string }[] = [];
  waits: { from: number; to: number }[] = [];
  techAt: Record<string, number> = {};
  madeAt: Partial<Record<MatId, number>> = {};
  firstNode: Partial<Record<NodeType, number>> = {};
  minutes: Minute[] = [];
  actions = 0;
  // per-minute accumulators
  mIncome = 0; mData: Record<DataTier, number> = { a: 0, b: 0, g: 0 }; mActions = 0; mIdle = 0; mSpent = 0;
  rewardTotal: Required<Reward> = { credits: 0, a: 0, b: 0, g: 0 };
  lastNewAt = 0;
  lastNewWhat = '';
  /** Per goal id: when it became ready and when it was claimed. */
  goalReadyAt: Record<string, number> = {};
  goalClaimedAt: Record<string, number> = {};
  orderLog: { t: number; text: string }[] = [];
  flowStates: number[] = [];
  /** Credit sources at the moment of the first Lens. */
  statsAtEnd: Stats | null = null;

  constructor(profile: Profile) {
    this.profile = profile;
    profile.apply?.();
    clearHistory();
    this.g = newGame();
    this.g.credits += profile.startCredits ?? 0;
    this.g.orderSeed = (this.g.orderSeed + CFG.seed * 7919) >>> 0;
    this.rnd = rng(CFG.seed);
  }

  log(text: string) {
    this.timeline.push({ t: this.g.time, text });
  }

  // ---------- prices (profile overrides for formulas hard-coded in the game) ----------

  expandPrice() {
    return this.profile.expansionCost ? this.profile.expansionCost(this.g.board.expansions) : expansionCost(this.g);
  }
  upgradePrice(n: GNode, track: Track) {
    const game = upgradeCost(n, track);
    return this.profile.upgradeCost ? Math.round(this.profile.upgradeCost(n, track, game)) : game;
  }
  /** Run a purchase the game prices at `game` so that the player ends up paying `mine`. */
  payAs<T>(game: number, mine: number, fn: () => T): T {
    this.g.credits += game - mine;
    const before = this.g.credits;
    const r = fn();
    if (this.g.credits === before) this.g.credits -= game - mine; // purchase failed: undo the adjustment
    return r;
  }

  // ---------- board queries ----------

  outs(n: GNode, port = 0): Wire[] { return graph(this.g).outs.get(n.id)?.[port] ?? []; }
  ins(n: GNode): Wire[] { return graph(this.g).ins.get(n.id) ?? []; }
  node(id: number): GNode { return graph(this.g).byId.get(id)!; }
  portMat(n: GNode, port: number): MatId | null { return materialsAt(this.g, n.id, port)[0] ?? null; }
  key(p: Port, sink: string) { return `${p.n.id}:${p.port}:${sink}`; }

  ports(n: GNode): Port[] {
    if (n.type === 'well') return [{ n, port: 0 }];
    if (isMachine(n)) return (recipeOf(n)?.outputs ?? []).map((_, port) => ({ n, port }));
    return [];
  }

  producers(m: MatId): Port[] {
    const out: Port[] = [];
    for (const n of this.g.nodes) for (const p of this.ports(n)) if (this.portMat(n, p.port) === m) out.push(p);
    return out;
  }

  /** Best port to feed a new consumer from: one that is selling its surplus, then the least shared. */
  bestProducer(m: MatId, consumer?: GNode): Port | null {
    const score = (p: Port) => {
      const ws = this.outs(p.n, p.port);
      let s = 0;
      if (ws.some((w) => this.node(w.to).type === 'market')) s -= 10;
      if (p.n.status === 'blocked') s -= 5;
      s += ws.filter((w) => isMachine(this.node(w.to))).length * 3;
      return s;
    };
    const list = this.producers(m).filter((p) => !consumer || !this.outs(p.n, p.port).some((w) => w.to === consumer.id));
    list.sort((a, b) => score(a) - score(b));
    return list[0] ?? null;
  }

  tierNeeded(tier: DataTier): boolean {
    let remaining = 0;
    for (const t of Object.values(TECHS)) {
      if (this.g.techs.includes(t.id) || t.auto || CFG.techSkip.includes(t.id)) continue;
      remaining += t.cost[tier] ?? 0;
    }
    return this.g.data[tier] < remaining;
  }

  labFor(tier: DataTier): GNode | null {
    for (const n of this.g.nodes) {
      if (n.type !== 'lab') continue;
      if (!CFG.labPerTier || this.labTier.get(n.id) === tier) return n;
    }
    return null;
  }

  /** A status the player has had time to notice and has not just dealt with. */
  problem(n: GNode): Status | null {
    if (n.grace > 0 || (n.status !== 'starved' && n.status !== 'blocked')) return null;
    const rec = this.seen.get(n.id);
    if (!rec || rec.s !== n.status || this.g.time - rec.t < CFG.noticeDelay) return null;
    if ((this.ignoreUntil.get(n.id) ?? 0) > this.g.time) return null;
    return n.status;
  }

  trackStatus() {
    for (const n of this.g.nodes) {
      const rec = this.seen.get(n.id);
      if (!rec || rec.s !== n.status) this.seen.set(n.id, { s: n.status, t: this.g.time });
    }
  }

  /** Do all the things this well's line sells already go for a poor price? */
  lineSaturated(n: GNode): boolean {
    const sold: MatId[] = [];
    const visit = (x: GNode, depth: number) => {
      if (depth > 4) return;
      for (const p of this.ports(x)) {
        const m = this.portMat(x, p.port);
        for (const w of this.outs(x, p.port)) {
          const d = this.node(w.to);
          if (d.type === 'market' && m && x !== n) sold.push(m);
          else if (isMachine(d)) visit(d, depth + 1);
        }
      }
    };
    visit(n, 0);
    return sold.length > 0 && sold.every((m) => saturation(this.g, m) < CFG.saturationFloor);
  }

  // ---------- actions ----------

  nextY = 60;
  spot(from: GNode | null): { x: number; y: number } {
    this.nextY = (this.nextY + 110) % Math.max(200, this.g.board.h - 120);
    return { x: Math.min(this.g.board.w - 200, (from?.x ?? 300) + 240), y: from ? from.y + 30 : this.nextY };
  }

  /** The "drag from a port into empty space and pick" gesture: place a node and wire it in one action. */
  buildFrom(from: Port, type: NodeType, recipe: string | null = null): GNode | null {
    const at = this.spot(from.n);
    const n = placeNode(this.g, type, at.x, at.y, { recipe });
    if (!n) return null;
    connect(this.g, from.n.id, from.port, n.id);
    this.noteNode(type, recipe);
    return n;
  }

  noteNode(type: NodeType, recipe: string | null = null) {
    if (this.firstNode[type] == null) {
      this.firstNode[type] = this.g.time;
      this.markNew(`first ${NODE_DEFS[type].name}`);
    }
    if (recipe && !this.g.nodes.some((n) => n.recipe === recipe && n.cycles > 0)) this.markNew(`${RECIPES[recipe].name} line`);
  }

  markNew(what: string) {
    this.lastNewAt = this.g.time;
    this.lastNewWhat = what;
  }

  name(n: GNode): string {
    if (n.type === 'well') return `${n.material ? MATERIALS[n.material].name : ''} Well`;
    return `${NODE_DEFS[n.type].name}${n.recipe ? ` (${RECIPES[n.recipe].name})` : ''}`;
  }

  // ---------- research ----------

  pickTech(): Tech | null {
    const g = this.g;
    const ready = readyTechs(g).filter((t) => !CFG.techSkip.includes(t.id)).sort((a, b) => techWeight(a) - techWeight(b));
    if (!ready.length) return null;
    if (CFG.techPolicy === 'greedy') return ready[0];
    const mainline = (t: Tech) => /^P\d/.test(t.id);
    const main = ready.find(mainline);
    if (main) return main;
    const next = Object.values(TECHS).filter((t) => mainline(t) && techAvailable(g, t)).sort((a, b) => techWeight(a) - techWeight(b))[0];
    if (!next) return ready[0];
    const shares = (t: Tech) => TIERS.some((k) => (t.cost[k] ?? 0) > 0 && (next.cost[k] ?? 0) > g.data[k]);
    return ready.find((t) => !shares(t) || techWeight(t) <= CFG.impulseShare * techWeight(next)) ?? null;
  }

  // ---------- what the player wants right now ----------

  wants(): Want[] {
    const g = this.g;
    const W: Want[] = [];
    const market = g.nodes.find((n) => n.type === 'market') ?? null;
    const speedWant = (n: GNode, why: string, settle: number[] = []): void => {
      if (n.lv.speed >= maxLevel(g, 'speed')) return;
      const cost = this.upgradePrice(n, 'speed');
      W.push({
        cls: 'grow', kind: 'upgrade', cost, settle: [n.id, ...settle],
        label: `upgrade ${this.name(n)} speed to L${n.lv.speed + 1} (${why})`,
        run: () => this.payAs(upgradeCost(n, 'speed'), cost, () => upgrade(g, n.id, 'speed')),
      });
    };
    const wireWant = (w: Wire, why: string, settle: number[] = []): boolean => {
      if (w.tier >= maxPipeTier(g)) return false;
      const cost = PIPES[w.tier + 1].cost;
      W.push({
        cls: 'grow', kind: 'upgrade', cost, settle,
        label: `upgrade wire ${this.name(this.node(w.from))} → ${this.name(this.node(w.to))} to ${PIPES[w.tier + 1].name} (${why})`,
        run: () => upgradeWire(g, w.id),
      });
      return true;
    };
    const saturated = (w: Wire) => w.rate >= pipeCap(w.tier) * 0.95;

    // --- G1: output ports with no wire at all ---
    for (const n of g.nodes) {
      for (const p of this.ports(n)) {
        if (this.outs(n, p.port).length) continue;
        const m = this.portMat(n, p.port);
        if (!m) continue;
        const fits = Object.values(RECIPES).filter((r) => recipeUnlocked(g, r) && r.inputs.some((i) => i[0] === m));
        // an existing machine that still lacks this input
        const hungry = g.nodes.find((c) => isMachine(c) && c.id !== n.id && fits.some((r) => r.id === c.recipe)
          && (!this.ins(c).some((w) => materialsAt(g, w.from, w.port).includes(m)) || (c.status === 'starved' && c.missing === m)));
        if (hungry) {
          W.push({ cls: 'fix', kind: 'wire', cost: 0, settle: [n.id, hungry.id], label: `wire ${this.name(n)} → ${this.name(hungry)}`, run: () => !!connect(g, n.id, p.port, hungry.id) });
          continue;
        }
        const single = fits.filter((r) => r.inputs.length === 1).sort((a, b) => MATERIALS[b.outputs[0][0]].value - MATERIALS[a.outputs[0][0]].value)[0];
        if (single && nodeCost(g, single.machine) <= g.credits) {
          W.push({
            cls: 'new', kind: 'build', cost: nodeCost(g, single.machine), settle: [n.id], novel: !g.nodes.some((x) => x.recipe === single.id),
            label: `build ${NODE_DEFS[single.machine].name} (${single.name}) from ${this.name(n)}`,
            run: () => !!this.buildFrom(p, single.machine, single.id),
          });
          continue;
        }
        if (isJunk(m)) {
          // A byproduct is ignored until it visibly blocks the machine.
          if (!(this.problem(n) === 'blocked' && n.blockedOn === m)) continue;
          const type: NodeType = has(g, NODE_DEFS.void.tech) ? 'void' : 'market';
          if (type === 'void') W.push({ cls: 'fix', kind: 'build', cost: 0, settle: [n.id], label: `dump ${MATERIALS[m].name} from ${this.name(n)} into a Void`, run: () => !!this.buildFrom(p, 'void') });
          else if (market) W.push({ cls: 'fix', kind: 'wire', cost: 0, settle: [n.id], label: `wire ${MATERIALS[m].name} → Market`, run: () => !!connect(g, n.id, p.port, market.id) });
          continue;
        }
        if (market) W.push({ cls: 'fix', kind: 'wire', cost: 0, settle: [n.id], label: `wire ${this.name(n)} → Market`, run: () => !!connect(g, n.id, p.port, market.id) });
      }
    }

    // --- G2: a raw material sold straight to the Market while a recipe for it is unlocked ---
    for (const n of g.nodes) {
      if (n.type !== 'well' || !n.material) continue;
      const ws = this.outs(n);
      if (!ws.length || ws.some((w) => isMachine(this.node(w.to)))) continue;
      const r = Object.values(RECIPES).find((x) => recipeUnlocked(g, x) && x.inputs.length === 1 && x.inputs[0][0] === n.material);
      if (!r) continue;
      W.push({
        cls: 'new', kind: 'build', cost: nodeCost(g, r.machine), settle: [n.id], novel: !g.nodes.some((x) => x.recipe === r.id),
        label: `build ${NODE_DEFS[r.machine].name} (${r.name}) from ${this.name(n)}`,
        run: () => !!this.buildFrom({ n, port: 0 }, r.machine, r.id),
      });
    }

    // --- G3: Labs. One per Data tier that still buys something; feed them from ports that sell their surplus ---
    if (has(g, 'R1')) {
      for (const tier of TIERS) {
        const needed = this.tierNeeded(tier);
        const lab = this.labFor(tier);
        const feeders: Port[] = [];
        for (const n of g.nodes) {
          if (!isMachine(n)) continue;
          for (const p of this.ports(n)) {
            const m = this.portMat(n, p.port);
            if (!m || isJunk(m) || MATERIALS[m].tier === 0 || matTier(m) !== tier) continue;
            if (this.noSink.has(this.key(p, 'lab'))) continue;
            if (!this.outs(n, p.port).some((w) => this.node(w.to).type === 'market')) continue;
            feeders.push(p);
          }
        }
        feeders.sort((a, b) => MATERIALS[this.portMat(b.n, b.port)!].value - MATERIALS[this.portMat(a.n, a.port)!].value);
        if (!needed) {
          // Nothing left to buy with this Data: stop studying, sell instead.
          if (lab && CFG.labPerTier) {
            const w = this.ins(lab).find((x) => this.outs(this.node(x.from), x.port).length > 1);
            if (w) W.push({ cls: 'fix', kind: 'cut', cost: 0, label: `cut ${this.name(this.node(w.from))} → Lab (no ${GREEK[tier]} left to spend)`, run: () => { this.noSink.add(`${w.from}:${w.port}:lab`); return cutWire(g, w.id); } });
          }
          continue;
        }
        if (!lab) {
          if (!feeders.length || (!CFG.labPerTier && g.nodes.some((n) => n.type === 'lab'))) continue;
          const from = feeders[0];
          W.push({
            cls: 'new', kind: 'build', cost: nodeCost(g, 'lab'), settle: [from.n.id], novel: true,
            label: `build Lab (${GREEK[tier]}) from ${this.name(from.n)}`,
            run: () => {
              const n = this.buildFrom(from, 'lab');
              if (n) this.labTier.set(n.id, tier);
              return !!n;
            },
          });
          continue;
        }
        if (lab.grace <= 0 && lab.util < 0.9 && (this.ignoreUntil.get(lab.id) ?? 0) <= g.time) {
          const from = feeders.find((p) => !this.outs(p.n, p.port).some((w) => w.to === lab.id));
          if (from) W.push({ cls: 'fix', kind: 'wire', cost: 0, settle: [lab.id], label: `wire ${this.name(from.n)} → Lab (${GREEK[tier]})`, run: () => !!connect(g, from.n.id, from.port, lab.id) });
        }
        // A Lab that is full while its feeders still sell the rest: study faster.
        if (lab.util >= 0.9 && lab.lv.speed < maxLevel(g, 'speed') && feeders.length) {
          speedWant(lab, `Lab is full, more ${GREEK[tier]}`);
        }
      }
    }

    // --- G4: an unlocked recipe nobody makes yet (assemblers, fabricators, byproduct refiners) ---
    for (const r of Object.values(RECIPES)) {
      if (!recipeUnlocked(g, r) || g.nodes.some((n) => n.recipe === r.id)) continue;
      if (r.inputs.length === 1 && MATERIALS[r.inputs[0][0]].tier === 0) continue; // wells bring their own refiner (G1/G2)
      const feeds = r.inputs.map((i) => this.bestProducer(i[0]));
      if (feeds.some((f) => !f)) continue;
      W.push({
        cls: 'new', kind: 'build', cost: nodeCost(g, r.machine), settle: [feeds[0]!.n.id], novel: true,
        label: `build ${NODE_DEFS[r.machine].name} (${r.name}) from ${this.name(feeds[0]!.n)}`,
        run: () => !!this.buildFrom(feeds[0]!, r.machine, r.id),
      });
    }

    // --- G5: a machine with an input nobody is wired to ---
    for (const n of g.nodes) {
      if (!isMachine(n)) continue;
      const r = recipeOf(n);
      if (!r) continue;
      for (const [m] of r.inputs) {
        if (this.ins(n).some((w) => materialsAt(g, w.from, w.port).includes(m))) continue;
        const from = this.bestProducer(m, n);
        if (!from) continue;
        W.push({ cls: 'fix', kind: 'wire', cost: 0, settle: [n.id, from.n.id], label: `wire ${this.name(from.n)} → ${this.name(n)}`, run: () => !!connect(g, from.n.id, from.port, n.id) });
      }
    }

    // --- G6: free deposits get a Well; G7: no free deposit, expand the board ---
    const free = freeDeposits(g);
    for (const d of free) {
      W.push({
        cls: 'new', kind: 'build', cost: nodeCost(g, 'well'), novel: !g.nodes.some((x) => x.type === 'well' && x.material === d.mat),
        label: `place ${MATERIALS[d.mat].name} Well`,
        run: () => {
          const n = placeNode(g, 'well', d.x, d.y, { depositId: d.id });
          if (n) this.noteNode('well');
          return !!n;
        },
      });
    }
    if (CFG.expand && !free.length && g.wires.length > 0) {
      const cost = this.expandPrice();
      W.push({
        cls: 'new', kind: 'expand', cost, label: `expand the board (#${g.board.expansions + 1})`,
        run: () => this.payAs(expansionCost(g), cost, () => expandBoard(g)),
      });
    }

    // --- G8: bottlenecks the player can see (red = starved, yellow = blocked) ---
    for (const n of g.nodes) {
      const st = this.problem(n);
      if (!st) continue;
      if (st === 'starved' && isMachine(n)) {
        const r = recipeOf(n)!;
        const m = n.missing ?? r.inputs[0][0];
        for (const w of this.ins(n)) {
          if (!materialsAt(g, w.from, w.port).includes(m)) continue;
          const s = this.node(w.from);
          const src: Port = { n: s, port: w.port };
          if (saturated(w)) {
            wireWant(w, `${this.name(n)} is starved`, [n.id]);
            continue;
          }
          const sib = this.outs(s, w.port).filter((x) => x.id !== w.id);
          const cutSink = (type: 'market' | 'lab' | 'void'): boolean => {
            const x = sib.find((y) => this.node(y.to).type === type);
            if (!x) return false;
            if (type === 'lab') {
              const lab = this.node(x.to);
              const tier = matTier(m);
              if (this.tierNeeded(tier) && this.ins(lab).length < 2) return false; // the only source of that Data
            }
            W.push({
              cls: 'fix', kind: 'cut', cost: 0, settle: [n.id, s.id],
              label: `cut ${this.name(s)} → ${NODE_DEFS[type].name} (${this.name(n)} is starved of ${MATERIALS[m].name})`,
              run: () => { this.noSink.add(this.key(src, type)); return cutWire(g, x.id); },
            });
            return true;
          };
          // A plain port feeds machines first, so cutting a sink only helps when a Router does the splitting.
          if (s.type === 'router' && (cutSink('market') || cutSink('void') || cutSink('lab'))) continue;
          if (s.grace > 0 || s.status === 'starved' || s.status === 'blocked') continue; // the cause is further up or elsewhere
          if (s.type === 'well') speedWant(s, `${this.name(n)} is starved`, [n.id]);
          else if (isMachine(s) && s.util >= 0.9) speedWant(s, `${this.name(n)} is starved of ${MATERIALS[m].name}`, [n.id]);
        }
      }
      if (st === 'blocked' && (n.type === 'well' || isMachine(n))) {
        const r = recipeOf(n);
        const m = n.type === 'well' ? n.material : n.blockedOn ?? r?.outputs[0][0] ?? null;
        if (!m) continue;
        const port = n.type === 'well' ? 0 : Math.max(0, r!.outputs.findIndex((o) => o[0] === m));
        const ws = this.outs(n, port);
        if (!ws.length) continue; // G1
        let handled = false;
        for (const w of ws) {
          const c = this.node(w.to);
          if (saturated(w)) {
            if (wireWant(w, `${this.name(n)} is blocked`, [n.id])) handled = true;
            continue;
          }
          if (isMachine(c) && c.grace <= 0 && c.status === 'working' && c.util >= 0.9) {
            speedWant(c, `${this.name(n)} is blocked`, [n.id]);
            handled = true;
          }
        }
        // Only Labs downstream and they are full: sell the rest.
        const p: Port = { n, port };
        if (!handled && market && !isJunk(m) && ws.every((w) => this.node(w.to).type === 'lab') && !this.noSink.has(this.key(p, 'market'))) {
          W.push({ cls: 'fix', kind: 'wire', cost: 0, settle: [n.id], label: `wire ${this.name(n)} → Market (Lab is full)`, run: () => !!connect(g, n.id, port, market.id) });
        }
      }
    }

    // --- G9: everything is green, so push more through ---
    for (const n of g.nodes) {
      if ((this.ignoreUntil.get(n.id) ?? 0) > g.time || n.grace > 0) continue;
      if (n.type === 'well' && n.status === 'working') {
        const ws = this.outs(n);
        const cons = ws.map((w) => this.node(w.to));
        if (!cons.some(isMachine)) continue;
        if (cons.some((c) => isMachine(c) && (c.status !== 'working' || c.grace > 0))) continue;
        const cap = ws.reduce((s, w) => s + pipeCap(Math.max(w.tier, maxPipeTier(g))), 0);
        if (wellRate(n) * 1.25 > cap + 1e-6) continue;
        if (this.lineSaturated(n)) continue;
        speedWant(n, 'push more through');
      }
      if (CFG.efficiency && isMachine(n) && n.status === 'working' && n.util >= 0.8 && trackAvailable(g, n, 'eff') && n.lv.eff < maxLevel(g, 'eff')) {
        const cost = this.upgradePrice(n, 'eff');
        W.push({
          cls: 'grow', kind: 'upgrade', cost, settle: [n.id], label: `upgrade ${this.name(n)} efficiency to L${n.lv.eff + 1}`,
          run: () => this.payAs(upgradeCost(n, 'eff'), cost, () => upgrade(g, n.id, 'eff')),
        });
      }
    }
    this.goalWants(W);
    return W;
  }

  /** The goals this policy would never do by itself: the goal card asks, so the player does them. */
  goalWants(W: Want[]) {
    const g = this.g;
    const goal = activeGoal(g);
    if (!goal || g.goal.ready) return;
    if (goal.id === 'upgrade-well') {
      const n = g.nodes.find((x) => x.type === 'well');
      if (n) W.push({ cls: 'new', kind: 'upgrade', cost: upgradeCost(n, 'speed'), novel: true, settle: [n.id], label: `upgrade ${this.name(n)} speed (goal)`, run: () => upgrade(g, n.id, 'speed') });
    } else if (goal.id === 'expand') {
      const cost = this.expandPrice();
      W.push({ cls: 'new', kind: 'expand', cost, novel: true, label: 'expand the board (goal)', run: () => this.payAs(expansionCost(g), cost, () => expandBoard(g)) });
    } else if (goal.id === 'route-lab') {
      const market = g.nodes.find((n) => n.type === 'market');
      const lab = g.nodes.find((n) => n.type === 'lab');
      if (!market || !lab) return;
      const router = g.nodes.find((n) => n.type === 'router');
      if (!router) {
        // from a machine port that already feeds that Lab
        const w = this.ins(lab).find((x) => isMachine(this.node(x.from)));
        if (!w) return;
        const from: Port = { n: this.node(w.from), port: w.port };
        W.push({ cls: 'new', kind: 'build', cost: nodeCost(g, 'router'), novel: true, label: `build Router from ${this.name(from.n)} (goal)`, run: () => !!this.buildFrom(from, 'router') });
        return;
      }
      const toLab = this.outs(router).find((w) => this.node(w.to).type === 'lab');
      const toMarket = this.outs(router).find((w) => this.node(w.to).type === 'market');
      if (!toLab) W.push({ cls: 'fix', kind: 'wire', cost: 0, label: 'wire Router → Lab (goal)', run: () => !!connect(g, router.id, 0, lab.id) });
      else if (!toMarket) W.push({ cls: 'fix', kind: 'wire', cost: 0, label: 'wire Router → Market (goal)', run: () => !!connect(g, router.id, 0, market.id) });
      else if (router.mode !== 'ratio' || toLab.weight <= toMarket.weight) {
        W.push({
          cls: 'fix', kind: 'upgrade', cost: 0, label: 'set Router to Ratio, Lab 3 : Market 1 (goal)',
          run: () => { setMode(g, router.id, 'ratio'); return setWeight(g, toLab.id, 3); },
        });
      }
    }
  }

  // ---------- one decision ----------

  decide(): Want | null {
    const g = this.g;
    if (g.goal.ready) {
      const goal = activeGoal(g)!;
      return { cls: 'new', kind: 'claim', cost: 0, label: `claim goal ${g.goal.i + 1} "${goal.title}"`, run: () => claimGoal(g) };
    }
    if (g.order?.ready) {
      const o = g.order;
      return { cls: 'new', kind: 'claim', cost: 0, label: `claim order: ${o.need} ${MATERIALS[o.mat].name}`, run: () => claimOrder(g) };
    }
    const tech = this.pickTech();
    if (tech) {
      return {
        cls: 'new', kind: 'research', cost: 0, label: `research ${tech.id} ${tech.name} (${costStr(tech)})`,
        run: () => research(g, tech.id),
      };
    }
    const wants = this.wants();
    const can = (w: Want) => w.cost <= g.credits + 1e-6;
    const fix = wants.find((w) => w.cls === 'fix' && can(w));
    if (fix) return fix;
    const news = wants.filter((w) => w.cls === 'new').sort((a, b) => a.cost - b.cost);
    const novel = news.find((w) => w.novel && can(w));
    if (novel) return novel;
    // What the player is saving for: a never-had toy first, else the cheapest thing on the list.
    const unaff = news.filter((w) => !can(w));
    const target = unaff.find((w) => w.novel) ?? unaff[0] ?? null;
    let cap = Infinity;
    let saving = false;
    if (target) {
      const eta = (target.cost - g.credits) / Math.max(g.creditRate, 1e-6);
      // Only a never-had toy is worth sitting on credits for; for "one more of the same" the player keeps tinkering.
      saving = !!target.novel && eta <= CFG.patience;
      cap = target.cost * (saving ? CFG.pettyShare : CFG.growShareOfTarget);
    }
    const buy = news.find((w) => can(w) && (!target || !target.novel || w.cost <= cap));
    if (buy) return buy;
    const grows = wants.filter((w) => w.cls === 'grow').sort((a, b) => a.cost - b.cost);
    const grow = grows.find((w) => can(w) && w.cost <= cap);
    if (grow) return grow;
    // Nothing to do: remember what we are waiting for.
    const parts: string[] = [];
    if (target) parts.push(`${saving ? 'saving for' : 'cannot afford'} "${target.label}" ${fmt(target.cost)}¢ (have ${fmt(g.credits)}¢, +${f1(g.creditRate)}¢/s)`);
    const g0 = grows[0];
    if (g0) parts.push(`${can(g0) ? 'holding back' : 'cannot afford'} "${g0.label}" ${fmt(g0.cost)}¢`);
    const nextTech = Object.values(TECHS)
      .filter((t) => techAvailable(g, t) && !CFG.techSkip.includes(t.id))
      .map((t) => ({ t, eta: techEta(g, t) }))
      .sort((a, b) => a.eta - b.eta)[0];
    if (nextTech) parts.push(`next tech ${nextTech.t.id} ${nextTech.t.name} ${costStr(nextTech.t)} in ${isFinite(nextTech.eta) ? Math.ceil(nextTech.eta) + 's' : 'never (no Data income)'}`);
    if (!parts.length) parts.push('nothing left that the player wants');
    this.idleWhy = parts.join('; ');
    return null;
  }

  step() {
    const g = this.g;
    if (g.time < this.freeAt) return;
    if (g.time - this.lastThink < CFG.thinkEvery) {
      if (this.idleSince != null) this.mIdle += CFG.dt;
      return;
    }
    this.lastThink = g.time;
    const want = this.decide();
    if (!want) {
      if (this.idleSince == null) {
        this.idleSince = g.time;
        this.idleFirstWhy = this.idleWhy;
      }
      this.mIdle += CFG.dt;
      return;
    }
    const before = g.credits;
    const ok = want.run();
    if (!ok) {
      // Should not happen; make it loud so the policy gets fixed rather than silently stalling.
      this.log(`!! FAILED: ${want.label}`);
      this.freeAt = g.time + 1;
      return;
    }
    if (this.idleSince != null) {
      const len = g.time - this.idleSince;
      this.waits.push({ from: this.idleSince, to: g.time });
      if (len >= CFG.deadStretch) this.dead.push({ from: this.idleSince, to: g.time, why: this.idleFirstWhy, endedBy: want.label });
      this.idleSince = null;
    }
    const spent = before - g.credits;
    this.mSpent += Math.max(0, spent);
    this.actions++;
    this.mActions++;
    this.log(`${want.label}${spent > 0.5 ? `  [−${fmt(spent)}¢ → ${fmt(g.credits)}¢]` : ''}`);
    for (const id of want.settle ?? []) this.ignoreUntil.set(id, g.time + CFG.settleTime);
    const [lo, hi] = CFG.actionSeconds[want.kind] ?? [3, 4];
    this.freeAt = g.time + lo + this.rnd() * (hi - lo);
  }
  idleFirstWhy = '';

  // ---------- game events, rewards, sampling ----------

  grant(r: Reward, why: string) {
    const g = this.g;
    g.credits += r.credits ?? 0;
    g.lifetime += r.credits ?? 0;
    for (const k of TIERS) g.data[k] += r[k] ?? 0;
    this.rewardTotal.credits += r.credits ?? 0;
    for (const k of TIERS) this.rewardTotal[k] += r[k] ?? 0;
    const parts = [r.credits ? `+${fmt(r.credits)}¢` : '', ...TIERS.map((k) => (r[k] ? `+${r[k]}${GREEK[k]}` : ''))].filter(Boolean);
    this.log(`★ reward ${parts.join(' ')}  (${why})`);
  }

  drainEvents() {
    const g = this.g;
    const pay = (r: Reward) => {
      this.rewardTotal.credits += r.credits ?? 0;
      for (const k of TIERS) this.rewardTotal[k] += r[k] ?? 0;
    };
    const payText = (r: Reward) =>
      [r.credits ? `+${fmt(r.credits)}¢` : '', ...TIERS.map((k) => (r[k] ? `+${r[k]}${GREEK[k]}` : ''))].filter(Boolean).join(' ');
    for (const ev of g.events.splice(0)) {
      if (ev.kind === 'milestone') {
        this.log(`· first ${MATERIALS[ev.mat].name}`);
        this.markNew(`first ${MATERIALS[ev.mat].name}`);
      } else if (ev.kind === 'tech') {
        this.techAt[ev.id] = g.time;
        this.markNew(`tech ${ev.id} ${TECHS[ev.id].name}`);
        if (TECHS[ev.id].auto) this.log(`· ${ev.id} ${TECHS[ev.id].name} unlocked (${TECHS[ev.id].auto})`);
      } else if (ev.kind === 'goal-ready') {
        this.goalReadyAt[ev.goal] = g.time;
        this.log(`· goal ${ev.index + 1} ready: ${GOALS[ev.index].title}`);
      } else if (ev.kind === 'goal-claimed') {
        this.goalClaimedAt[ev.goal] = g.time;
        pay(ev.reward);
        this.log(`★ goal ${ev.index + 1} claimed${ev.big ? ' (BIG)' : ''}: ${rewardText(ev.reward)}`);
      } else if (ev.kind === 'order-new') {
        this.orderLog.push({ t: g.time, text: `${ev.quiet ? 'swapped in' : 'new'}: ${ev.order.need} ${MATERIALS[ev.order.mat].name} for ${payText(ev.order.reward)}` });
        this.log(`· order${ev.quiet ? ' (swapped, no deliveries)' : ''}: deliver ${ev.order.need} ${MATERIALS[ev.order.mat].name} for ${payText(ev.order.reward)}`);
      } else if (ev.kind === 'order-ready') {
        this.log(`· order filled: ${ev.order.need} ${MATERIALS[ev.order.mat].name} after ${Math.round(g.time - ev.order.created)}s`);
      } else if (ev.kind === 'order-claimed') {
        pay(ev.reward);
        this.orderLog.push({ t: g.time, text: `claimed: ${ev.order.need} ${MATERIALS[ev.order.mat].name} ${payText(ev.reward)} (${Math.round(g.time - ev.order.created)}s after it appeared)` });
        this.log(`★ order claimed: ${payText(ev.reward)}`);
      } else if (ev.kind === 'flow-state') {
        this.flowStates.push(g.time);
        this.log(`★ FLOW STATE${ev.first ? ' (first)' : ''}`);
      } else if (ev.kind === 'unlock') {
        this.log(`· unlocked: ${ev.what}`);
        this.markNew(`${ev.what} unlocked`);
      } else if (ev.kind === 'demo-end') {
        this.statsAtEnd = { ...g.stats };
        this.log('★ DEMO COMPLETE: first Lens');
      }
    }
    for (const k in g.made) if (this.madeAt[k as MatId] == null) this.madeAt[k as MatId] = g.time;
  }

  hookCtx(): HookCtx {
    const g = this.g;
    return {
      g, t: g.time, income: 0, dataIncome: { a: 0, b: 0, g: 0 },
      grant: (r, why) => this.grant(r, why),
      count: (type) => g.nodes.filter((n) => n.type === type).length,
      made: (mat) => !!g.made[mat as MatId],
    };
  }

  run() {
    const g = this.g;
    const steps = Math.round((CFG.minutes * 60) / CFG.dt);
    const ctx = this.hookCtx();
    let nextSample = 60;
    for (let i = 0; i < steps; i++) {
      tick(g, CFG.dt);
      this.mIncome += g.tickAcc.credits;
      for (const k of TIERS) this.mData[k] += g.tickAcc.data[k];
      // 30-second averages: the game's own rates (3 s) jump every time a buffer empties into the Market
      const k = 1 - Math.exp(-CFG.dt / 30);
      ctx.income += (g.tickAcc.credits / CFG.dt - ctx.income) * k;
      for (const d of TIERS) ctx.dataIncome[d] += (g.tickAcc.data[d] / CFG.dt - ctx.dataIncome[d]) * k;
      ctx.t = g.time;
      for (const h of this.profile.hooks ?? []) h.onTick(ctx);
      this.drainEvents();
      this.trackStatus();
      this.step();
      if (g.time >= nextSample - 1e-9) {
        this.minutes.push({
          t: nextSample, credits: g.credits, income: this.mIncome / 60,
          data: { ...g.data }, dataRate: { a: this.mData.a / 60, b: this.mData.b / 60, g: this.mData.g / 60 },
          nodes: g.nodes.length, techs: g.techs.length, actions: this.mActions, idle: this.mIdle, spent: this.mSpent,
        });
        this.mIncome = 0;
        this.mData = { a: 0, b: 0, g: 0 };
        this.mActions = 0;
        this.mIdle = 0;
        this.mSpent = 0;
        nextSample += 60;
      }
    }
    if (this.idleSince != null && g.time - this.idleSince >= CFG.deadStretch) {
      this.dead.push({ from: this.idleSince, to: g.time, why: this.idleFirstWhy, endedBy: '(still waiting when the session ended)' });
    }
  }
}

// =====================================================================================
// Report
// =====================================================================================

function report(bot: Bot) {
  const g = bot.g;
  const out: string[] = [];
  const P = (s = '') => out.push(s);
  P(`FLOWSTATE PACING BOT — profile "${CFG.profile}" (${bot.profile.describe})`);
  P(`policy: tech=${CFG.techPolicy}, one action per ~${CFG.actionSeconds.wire.join('–')}s, patience ${CFG.patience}s, seed ${CFG.seed}, ${CFG.minutes} min`);

  if (!CFG.quiet) {
    P();
    P('== (a) EVENT TIMELINE ==');
    for (const e of bot.timeline) P(`${mmss(e.t)}  ${e.text}`);
  }

  P();
  P('== (b) PER MINUTE (rates are averages over that minute; idle = seconds with free hands and nothing useful to do) ==');
  P(' min  credits    ¢/s  spent      α    α/s      β    β/s      γ    γ/s  nodes techs  acts  idle');
  for (const m of bot.minutes) {
    P(`${pad(m.t / 60, 4)} ${pad(fmt(m.credits), 8)} ${pad(f1(m.income), 6)} ${pad(fmt(m.spent), 6)} ${pad(Math.floor(m.data.a), 6)} ${pad(f1(m.dataRate.a), 6)} ${pad(Math.floor(m.data.b), 6)} ${pad(f1(m.dataRate.b), 6)} ${pad(Math.floor(m.data.g), 6)} ${pad(f1(m.dataRate.g), 6)} ${pad(m.nodes, 6)} ${pad(m.techs, 5)} ${pad(m.actions, 5)} ${pad(Math.round(m.idle), 5)}`);
  }

  P();
  P('== (c) FIRSTS ==');
  P('Techs researched:');
  const techs = Object.entries(bot.techAt).sort((a, b) => a[1] - b[1]);
  for (const [id, t] of techs) P(`  ${mmss(t)}  ${padR(id, 3)} ${padR(TECHS[id].name, 20)} ${costStr(TECHS[id])}`);
  const missing = Object.values(TECHS).filter((t) => !g.techs.includes(t.id));
  P(`  not researched after ${CFG.minutes} min: ${missing.map((t) => `${t.id} ${t.name} (${costStr(t)})`).join(', ') || 'none'}`);
  P('Materials first made:');
  const mats = (Object.entries(bot.madeAt) as [MatId, number][]).sort((a, b) => a[1] - b[1]);
  for (const [m, t] of mats) P(`  ${mmss(t)}  T${MATERIALS[m].tier} ${MATERIALS[m].name}`);
  const never = (Object.keys(MATERIALS) as MatId[]).filter((m) => bot.madeAt[m] == null);
  P(`  never made: ${never.map((m) => `T${MATERIALS[m].tier} ${MATERIALS[m].name}`).join(', ') || 'none'}`);
  P('First node of each kind:');
  for (const [type, t] of (Object.entries(bot.firstNode) as [NodeType, number][]).sort((a, b) => a[1] - b[1])) P(`  ${mmss(t)}  ${NODE_DEFS[type].name}`);

  P();
  P(`== (d) DEAD STRETCHES (≥ ${CFG.deadStretch}s with nothing useful to do) ==`);
  if (!bot.dead.length) P('  none');
  let deadTotal = 0;
  for (const d of bot.dead) {
    deadTotal += d.to - d.from;
    P(`  ${mmss(d.from)} → ${mmss(d.to)}  (${Math.round(d.to - d.from)}s)  waiting: ${d.why}`);
    P(`        ended by: ${d.endedBy}`);
  }
  const idleAll = bot.minutes.reduce((s, m) => s + m.idle, 0);
  P(`  total in dead stretches: ${Math.round(deadTotal)}s; total idle time: ${Math.round(idleAll)}s of ${CFG.minutes * 60}s; actions: ${bot.actions}`);
  const waits = bot.waits.filter((w) => w.to - w.from >= 20).sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 10).sort((a, b) => a.from - b.from);
  P(`  longest waits (≥ 20s, top 10): ${waits.map((w) => `${mmss(w.from)} ${Math.round(w.to - w.from)}s`).join(' · ') || 'none'}`);
  const firstTen = bot.minutes.slice(0, 10).reduce((s, m) => s + m.actions, 0);
  const lastTen = bot.minutes.slice(-10).reduce((s, m) => s + m.actions, 0);
  P(`  actions in the first 10 minutes: ${firstTen}; in the last 10: ${lastTen}`);

  P();
  P('== (e) WHERE THE CONTENT RUNS OUT ==');
  P(`  last new thing: ${mmss(bot.lastNewAt)} (${bot.lastNewWhat})`);
  const highest = mats.length ? Math.max(...mats.map(([m]) => MATERIALS[m].tier)) : 0;
  P(`  highest tier made: T${highest}; techs owned ${g.techs.length}/${Object.keys(TECHS).length}; board expansions ${g.board.expansions}`);
  P(`  at the end: ${fmt(g.credits)}¢ banked, +${f1(g.creditRate)}¢/s, α ${Math.floor(g.data.a)} (+${f1(g.dataRate.a)}/s), β ${Math.floor(g.data.b)} (+${f1(g.dataRate.b)}/s), γ ${Math.floor(g.data.g)} (+${f1(g.dataRate.g)}/s)`);
  const avail = Object.values(TECHS).filter((t) => techAvailable(g, t) && !CFG.techSkip.includes(t.id)).map((t) => ({ t, eta: techEta(g, t) })).sort((a, b) => a.eta - b.eta);
  P('  techs the player could research next, and how long they are away at the current Data income:');
  for (const { t, eta } of avail) P(`    ${padR(t.id, 3)} ${padR(t.name, 20)} ${padR(costStr(t), 12)} ${isFinite(eta) ? (eta <= 0 ? 'now' : `${Math.ceil(eta / 60)} min`) : 'never (no income of that Data)'}`);
  const wants = bot.wants().filter((w) => w.cls === 'new').sort((a, b) => a.cost - b.cost).slice(0, 4);
  P('  credit purchases the player still wants:');
  for (const w of wants) P(`    ${padR(fmt(w.cost) + '¢', 9)} ${w.label}  (${w.cost <= g.credits ? 'affordable' : `${Math.ceil((w.cost - g.credits) / Math.max(g.creditRate, 1e-6) / 60)} min away`})`);
  if (!wants.length) P('    none');
  P();
  P('== GOAL CHAIN (ready → claimed; "stuck" is the time since the previous claim) ==');
  let prevClaim = 0;
  let worstStuck = 0;
  let worstGoal = '';
  GOALS.forEach((goal, i) => {
    const ready = bot.goalReadyAt[goal.id];
    const claimed = bot.goalClaimedAt[goal.id];
    const stuck = (ready ?? CFG.minutes * 60) - prevClaim;
    if (ready != null || i === g.goal.i) {
      if (stuck > worstStuck) { worstStuck = stuck; worstGoal = goal.title; }
      P(`  ${pad(i + 1, 2)}${goal.free ? '*' : ' '} ${padR(goal.title, 40)} ${ready == null ? 'not done ' : mmss(ready) + ' → ' + (claimed == null ? 'unclaimed' : mmss(claimed))}  stuck ${pad(Math.round(stuck), 4)}s  ${rewardText(goal.reward)}`);
    }
    if (claimed != null) prevClaim = claimed;
  });
  P(`  goals claimed: ${Math.min(g.goal.i, MAIN_GOALS)}/${MAIN_GOALS} (+${Math.max(0, g.goal.i - MAIN_GOALS)} free play); longest on one goal: ${Math.round(worstStuck)}s (${worstGoal})`);
  P(`  orders claimed: ${g.stats.ordersFilled}; Flow States: ${bot.flowStates.length}${bot.flowStates.length ? ` (first at ${mmss(bot.flowStates[0])})` : ''}; best Flow streak ${Math.round(g.flowBest)}s; Flow now ${Math.round(g.flow * 100)}%${g.flowOn ? '' : ' (locked)'}`);
  if (!CFG.quiet) for (const o of bot.orderLog) P(`    ${mmss(o.t)}  order ${o.text}`);

  P();
  P('== WHERE CREDITS CAME FROM ==');
  const sources = (label: string, st: Stats) => {
    const total = st.fromSales + st.fromOrders + st.fromGoals + st.fromAway || 1;
    const pct = (n: number) => `${Math.round((100 * n) / total)}%`;
    P(`  ${padR(label, 22)} sales ${fmt(st.fromSales)}¢ (${pct(st.fromSales)}) · orders ${fmt(st.fromOrders)}¢ (${pct(st.fromOrders)}) · goals ${fmt(st.fromGoals)}¢ (${pct(st.fromGoals)}) → sales + orders ${pct(st.fromSales + st.fromOrders)}`);
  };
  if (bot.statsAtEnd) sources('at the first Lens:', bot.statsAtEnd);
  sources(`after ${CFG.minutes} min:`, g.stats);
  P(`  Data from goals and orders: ${bot.rewardTotal.a}α, ${bot.rewardTotal.b}β, ${bot.rewardTotal.g}γ`);

  P();
  P('== KEY TIMES ==');
  const key = (label: string, t: number | undefined) => P(`  ${padR(label, 34)} ${t == null ? 'not reached' : mmss(t)}`);
  key('first Refiner', bot.firstNode.refiner);
  key('first Lab', bot.firstNode.lab);
  key('first tech bought', techs.find(([id]) => !TECHS[id].auto)?.[1]);
  key('first Ink (Murk line)', bot.madeAt.ink);
  key('first Spark (Ember line)', bot.madeAt.spark);
  key('Assembly researched (P4)', bot.techAt.P4);
  key('first Tier 2 item (Glyph)', bot.madeAt.glyph);
  key('first Prism', bot.madeAt.prism);
  key('Fabrication researched (P7)', bot.techAt.P7);
  key('first Tier 3 item (Lens)', bot.madeAt.lens);
  key('first Dynamo', bot.madeAt.dynamo);
  key('first Paradox', bot.madeAt.paradox);
  key('Orders unlocked', bot.goalClaimedAt['make-spark']);
  key('Flow meter unlocked', bot.goalClaimedAt['make-glyph']);
  process.stdout.write(out.join('\n') + '\n');
}

// =====================================================================================
// CLI
// =====================================================================================

function main() {
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-zA-Z]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'profile' && v) CFG.profile = v;
    else if (k === 'policy' && (v === 'greedy' || v === 'mainline')) CFG.techPolicy = v;
    else if (k === 'seed' && v) CFG.seed = Number(v);
    else if (k === 'minutes' && v) CFG.minutes = Number(v);
    else if (k === 'quiet') CFG.quiet = true;
    else if (k === 'sharedLab') CFG.labPerTier = false;
    else if (k === 'noExpand') CFG.expand = false;
    else if (k === 'patience' && v) CFG.patience = Number(v);
  }
  const profile = PROFILES[CFG.profile];
  if (!profile) {
    process.stdout.write(`Unknown profile "${CFG.profile}". Known: ${Object.keys(PROFILES).join(', ')}\n`);
    return;
  }
  const bot = new Bot(profile);
  bot.run();
  report(bot);
}

main();

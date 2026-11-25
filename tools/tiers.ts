/**
 * The tiers' scripted players (docs/TIERS.md §9): a new game of tiers, played on the real rules through the guided
 * start and the three tiers' contracts, by players who build in different ways. What it answers: does a bigger
 * factory fill a contract sooner, does the player who builds least still fill it, and does it pay to rebuild what
 * the last tier left when a new one opens?
 *
 *   npx vite-node tools/tiers.ts -- x/tiers.ts                          every player on seeds 0–7, one table a tier
 *   npx vite-node tools/tiers.ts -- --player=wide --seed=0 x/tiers.ts   one run, with its timeline
 *   other flags: --seeds=0,1,2   --through=2 (stop after Tier 2)   --hands=<s> (seconds per action; 4 otherwise)
 *                --contract1=shard:400,ink:250,spark:150   --contract2=glyph:200,prism:100   --contract3=lens:30,coil:40
 *                (what-if: the contracts)
 *                --set=rules.tiers.assemblerGrowth=1.3 (what-if numbers, as the pacing tool's --set)
 *
 * (The trailing x/tiers.ts is there because vite-node does not pass the script's own path on to it: see the
 * check at the bottom.)
 *
 * The players. All of them play the guided start the same way, by the card (its how, and a growth goal's line), and
 * claim goals and orders the moment they are ready. They differ in the tiers.
 *  - minimal: the least that fills a contract. Tier 1: one line of each material, wired to the Dock alone. Tier 2: one
 *    Assembler of each part, fed from the lines it has, wired to the Dock alone. Then it waits: no upgrade, no land.
 *  - wide: the same, then more of whatever is furthest from done (Tier 1: lines and land; Tier 2: Assemblers, and a
 *    line for an input an Assembler waits for). What it adds goes to the Dock and a Market (half each), so it pays
 *    for the next.
 *  - tuner: the same, but Speed on the slowest material first (the makers, or what feeds them), additions after.
 *  - sellfirst: wide, but what it adds goes to the Market alone until it has three lines (Tier 2: two Assemblers) of
 *    each, and only then to the Dock: build first, deliver after.
 *  - mixed: wide, and Speed whenever nothing can be added.
 *  - rebuilder: mixed, but when Tier 2 opens it first rebuilds Tier 1's lines around the Foundry (docs/TIERS.md §15):
 *    for each of Sand, Oil and Ore, a Foundry, the Drills wired into it (as many as it can take), and the Refiners
 *    they fed deleted (a full refund). The Foundry's product goes to a Market and to the Assemblers. A new Drill goes
 *    into a Foundry with room. In Tiers 1 and 3 it plays as mixed.
 *
 * Tier 3 (Phones and Cable) is played as Tier 2 is: one Fabricator and one Cable Assembler each, fed (Rubber from a
 * Refiner on a Plastic line's Tar port), then more of whatever the slowest product waits for.
 */
import { claimGoal, claimOrder, connect, deleteNode, expandBoard, freeDeposits, placeNode, upgrade } from '../src/actions';
import { applyAdvice, lineAdvice } from '../src/advice';
import { EXPANSION_DEPOSITS, MATERIALS, MatId, NODE_DEFS, NodeType, RECIPES } from '../src/content';

const NODE_DEFS_NAME = (t: NodeType) => NODE_DEFS[t].name;
import { cycleTime, expansionCost, maxLevel, nodeCost, recipeOf, trackAvailable, upgradeCost, wellRate } from '../src/economy';
import { GOALS, activeGoal, meanwhileOf } from '../src/goals';
import { isMachine } from '../src/graph';
import { tick } from '../src/sim';
import { Bag, Game, GNode, newGame } from '../src/state';
import { applyOverrides } from './pacing-profiles';

declare const process: { argv: string[]; env: Record<string, string | undefined>; stdout: { write(s: string): void } };

export type Player = 'minimal' | 'wide' | 'tuner' | 'sellfirst' | 'mixed' | 'rebuilder';
export const PLAYERS: Player[] = ['minimal', 'wide', 'tuner', 'sellfirst', 'mixed', 'rebuilder'];

/** One tier of a run. */
export interface TierStat {
  /** The contract came up (the goal before it was claimed). */
  at: number | null;
  /** The contract was delivered in full (its goal ready). */
  doneAt: number | null;
  /** doneAt − at. */
  seconds: number | null;
  /** Seconds with nothing this player would do: no step it could pay for. */
  idle: number;
  /** Credits spent, and Speed levels bought, in the tier. */
  spent: number;
  speed: number;
  /** When each material of the contract was delivered in full, from the start of the tier. */
  filled: Partial<Record<MatId, number>>;
  /** At the end of the tier: what stands on the board, and the plots bought. */
  board: Partial<Record<NodeType, number>> & { plots: number };
}

export interface TierRun {
  player: Player;
  seed: number;
  t1: TierStat;
  t2: TierStat;
  t3: TierStat;
  log: string[];
  /** The game as it stands at the end of the run (for a save to look at). */
  game: Game;
}

const DT = 0.1;
/** The raw material of each refined one, and the recipe that makes each thing. */
const RAW: Partial<Record<MatId, MatId>> = { shard: 'glint', ink: 'murk', spark: 'ember', mist: 'breeze' };
const RECIPE: Partial<Record<MatId, string>> = { shard: 'shard', ink: 'ink', spark: 'spark', mist: 'mist', glyph: 'glyph', prism: 'prism', lens: 'lens', coil: 'coil', clay: 'clay' };
type Tier = 1 | 2 | 3;
const TIER_GOAL: Record<Tier, string> = { 1: 'tier-refining', 2: 'tier-parts', 3: 'tier-devices' };

const newStat = (): TierStat => ({ at: null, doneAt: null, seconds: null, idle: 0, spent: 0, speed: 0, filled: {}, board: { plots: 0 } });

export function playTiers(
  player: Player,
  seed: number,
  opts: { contract1?: Bag; contract2?: Bag; contract3?: Bag; hands?: number; minutes?: number; through?: Tier } = {},
): TierRun {
  const g = newGame({ tiers: true });
  g.orderSeed = (g.orderSeed + seed * 7919) >>> 0;
  if (opts.contract1) GOALS.find((x) => x.id === 'tier-refining')!.contract = { ...opts.contract1 };
  if (opts.contract2) GOALS.find((x) => x.id === 'tier-parts')!.contract = { ...opts.contract2 };
  if (opts.contract3) GOALS.find((x) => x.id === 'tier-devices')!.contract = { ...opts.contract3 };
  const HANDS = opts.hands ?? 4;
  const through = opts.through ?? 3;
  const end = (opts.minutes ?? 60) * 60;
  const log: string[] = [];
  const say = (s: string) => log.push(`${clock(g.time)}  ${s}`);
  const market = g.nodes.find((n) => n.type === 'market')!;
  let dock: GNode | null = null;
  let next = 6; // the time of the next action
  const stats: Record<Tier, TierStat> = { 1: newStat(), 2: newStat(), 3: newStat() };
  let tier: 0 | Tier = 0;
  const stat = () => stats[(tier || 1) as Tier];
  let y = 40;
  const spot = () => ({ x: 600 + (g.nodes.length % 6) * 160, y: (y += 70) % 1400 });

  const pay = <T>(before: number, r: T): T => {
    if (tier) stat().spent += Math.max(0, before - g.credits);
    return r;
  };
  const build = (type: NodeType, o: { depositId?: number; recipe?: string } = {}): GNode | null => {
    const before = g.credits;
    const { x, y: yy } = spot();
    return pay(before, placeNode(g, type, x, yy, o));
  };
  const fromPort = (src: GNode, port: number, type: NodeType, recipe?: string): GNode | null => {
    const n = build(type, recipe ? { recipe } : {});
    if (n) connect(g, src.id, port, n.id);
    return n;
  };
  const node = (id: number) => g.nodes.find((n) => n.id === id) ?? null;
  const wired = (a: GNode, port: number, b: GNode) => g.wires.some((w) => w.from === a.id && w.port === port && w.to === b.id);
  /** What makes m: a Refiner or Assembler of its recipe, or a Foundry of it. */
  const makers = (m: MatId) => g.nodes.filter((n) => n.recipe != null && (n.recipe === RECIPE[m] || n.recipe === `f-${RECIPE[m]}`));
  const drillsOf = (raw: MatId) => g.nodes.filter((n) => n.type === 'well' && n.material === raw);
  const feeds = (d: GNode) => g.wires.some((w) => w.from === d.id && (node(w.to)?.type === 'refiner' || node(w.to)?.type === 'foundry'));
  /** Machines a node's first port is wired to. */
  const machineUsers = (r: GNode) => g.wires.filter((w) => w.from === r.id && w.port === 0 && isMachine(node(w.to)!)).length;
  const step1 = (fn: () => boolean) => fn;

  /** The card's how in the guided start, and a growth goal's line: what a card player does there. */
  const guided = (): (() => boolean) | null => {
    const goal = activeGoal(g);
    if (!goal) return null;
    const w = g.nodes.filter((n) => n.type === 'well');
    switch (goal.id) {
      case 'wire-market':
      case 'wire-all-wells': {
        const d = w.find((x) => !g.wires.some((k) => k.from === x.id));
        return d ? () => !!connect(g, d.id, 0, market.id) : null;
      }
      case 'second-well':
        return g.credits >= nodeCost(g, 'well') ? () => !!build('well', { depositId: 2 }) : null;
      case 'build-refiner':
        return g.credits >= nodeCost(g, 'refiner') ? () => !!fromPort(w[0], 0, 'refiner', 'shard') : null;
      case 'sell-shard': {
        const r = makers('shard')[0];
        return r && !wired(r, 0, market) ? () => !!connect(g, r.id, 0, market.id) : null;
      }
      case 'dock-glass': {
        // "...pick Dock, then wire your other Glass Refiner to it too."
        const r = makers('shard')[0];
        if (!dock) return r ? () => !!(dock = fromPort(r, 0, 'dock')) : null;
        const other = makers('shard').find((x) => !wired(x, 0, dock!));
        return other ? () => !!connect(g, other.id, 0, dock!.id) : null;
      }
    }
    if (meanwhileOf(g)?.way) {
      const a = lineAdvice(g);
      if (a && (a.cost ?? 0) <= g.credits + 1e-6) return () => pay(g.credits, applyAdvice(g, a));
    }
    return null;
  };

  /** How long the contract's rest of m takes at the rate the Dock takes it now (Infinity: it takes none; 0: done). */
  const left = (m: MatId) => {
    const k = g.contract!;
    const rest = (k.need[m] ?? 0) - (k.got[m] ?? 0);
    if (rest <= 0) return 0;
    const r = k.rate[m] ?? 0;
    return r > 0.02 ? rest / r : Infinity;
  };
  const contractMats = () => (Object.keys(g.contract?.need ?? {}) as MatId[]);
  /** The contract's materials not done yet, the furthest from done first. */
  const slowest = () => contractMats().filter((m) => left(m) > 0).sort((a, b) => left(b) - left(a) || a.localeCompare(b));

  /**
   * A new line of a refined material: a Drill on a free deposit of its raw material, then (the next action) a Refiner
   * from it, wired to each of `to` (and its Tar to a Dump). null when there is no free deposit or not the credits.
   */
  const lineStep = (m: MatId, to: GNode[], label: string): (() => boolean) | null => {
    const raw = RAW[m]!;
    const bare = drillsOf(raw).find((d) => !feeds(d));
    if (bare) {
      if (g.credits < nodeCost(g, 'refiner')) return null;
      return () => {
        const r = fromPort(bare, 0, 'refiner', RECIPE[m]);
        if (!r) return false;
        for (const t of to) connect(g, r.id, 0, t.id);
        if (m === 'ink') {
          const dump = g.nodes.find((n) => n.type === 'void');
          if (dump) connect(g, r.id, 1, dump.id);
          else fromPort(r, 1, 'void');
        }
        say(`${player}: a ${MATERIALS[m].name} line (${label})`);
        return true;
      };
    }
    const dep = freeDeposits(g).find((d) => d.mat === raw);
    if (dep) {
      if (g.credits < nodeCost(g, 'well') + nodeCost(g, 'refiner')) return null;
      return () => !!build('well', { depositId: dep.id });
    }
    return null;
  };
  /** The next plot, where it brings a deposit of m's raw material. */
  const landStep = (m: MatId): (() => boolean) | null => {
    const brings = EXPANSION_DEPOSITS[g.board.expansions % EXPANSION_DEPOSITS.length];
    if (!brings.includes(RAW[m]!)) return null;
    if (g.credits < expansionCost(g)) return null;
    return () => {
      const before = g.credits;
      const ok = expandBoard(g);
      if (ok) say(`${player}: land (${Math.round(before - g.credits)}¢)`);
      return pay(before, ok);
    };
  };
  /** A level of Speed on n, if it can be bought now. */
  const speedOn = (n: GNode | null): (() => boolean) | null => {
    if (!n || !trackAvailable(g, n, 'speed') || n.lv.speed >= maxLevel(g, 'speed') || g.credits < upgradeCost(n, 'speed')) return null;
    return () => {
      const before = g.credits;
      const ok = upgrade(g, n.id, 'speed');
      if (ok) stat().speed++;
      return pay(before, ok);
    };
  };
  const cheapest = (ns: GNode[]) => ns.filter((n) => trackAvailable(g, n, 'speed') && n.lv.speed < maxLevel(g, 'speed')).sort((a, b) => upgradeCost(a, 'speed') - upgradeCost(b, 'speed'))[0] ?? null;
  /** What feeds a machine: the nodes wired into it (through a Merger, the Refiners behind the Merger). */
  const feeders = (n: GNode, m?: MatId): GNode[] => {
    const out: GNode[] = [];
    for (const w of g.wires) {
      if (w.to !== n.id) continue;
      const f = node(w.from);
      if (!f) continue;
      if (f.type === 'merger') out.push(...feeders(f, m));
      else if (!m || f.type === 'well' || makers(m).includes(f)) out.push(f);
    }
    return out;
  };
  /** A level of Speed where it brings more of m: on a maker that runs flat out, or on what starves one. */
  const speedStep = (m: MatId): (() => boolean) | null => {
    const picks: GNode[] = [];
    for (const r of makers(m)) {
      if (r.status === 'starved') {
        const missing = r.missing ?? RAW[m] ?? null;
        const from = missing ? feeders(r).filter((f) => f.type === 'well' || makers(missing).includes(f)) : [];
        picks.push(...(from.length ? from : [r]));
      } else picks.push(r);
    }
    return speedOn(cheapest(picks));
  };

  // ---------- Tier 1 ----------

  const tier1 = (): (() => boolean) | null => {
    const mats = contractMats();
    const lines = (m: MatId) => makers(m).length;
    // Every material gets a line to the Dock (the Glass lines of the start: each wired to the Dock too).
    for (const m of mats) {
      if (left(m) === 0) continue;
      const own = makers(m);
      if (own.length && !own.some((r) => wired(r, 0, dock!))) {
        const r = own[0];
        return () => !!connect(g, r.id, 0, dock!.id);
      }
      if (!own.length) return lineStep(m, player === 'minimal' ? [dock!] : [dock!, market], player === 'minimal' ? 'dock' : 'both');
    }
    if (player === 'minimal') return null;
    const order = slowest();
    if (player === 'sellfirst' && mats.some((m) => lines(m) < 3)) {
      const m = [...mats].sort((a, b) => lines(a) - lines(b))[0];
      return lineStep(m, [market], 'market') ?? landStep(m);
    }
    if (player === 'sellfirst') {
      for (const m of order) {
        const r = makers(m).find((x) => !wired(x, 0, dock!));
        if (r) return () => !!connect(g, r.id, 0, dock!.id);
      }
    }
    for (const m of order) {
      const both = () => lineStep(m, [dock!, market], 'both');
      const step = player === 'tuner' ? speedStep(m) ?? both() ?? landStep(m)
        : player === 'mixed' || player === 'rebuilder' ? both() ?? landStep(m) ?? speedStep(m)
        : both() ?? landStep(m);
      if (step) return step;
    }
    return null;
  };

  // ---------- Tiers 2 and 3: things made of things ----------

  const PART_INPUTS = (p: MatId) => RECIPES[RECIPE[p]!].inputs.map(([m]) => m);
  /** What a new maker of p is built from: a Screen from the Silicon port, a Circuit from the Plastic one, a Phone from
   * a Screen Assembler's, a Cable from a Rubber Refiner's. */
  const BUILT_FROM: Partial<Record<MatId, MatId>> = { prism: 'mist', glyph: 'ink', lens: 'prism', coil: 'clay' };
  const machineOf = (p: MatId) => RECIPES[RECIPE[p]!].machine;
  /** Where a contract product's makers send it: the Dock, and (wide and the rest) a Market too; sellfirst's to a Market until built up. */
  const partTargets = (p: MatId): GNode[] => {
    if (!contractMats().includes(p)) return [];
    if (player === 'minimal') return [dock!];
    if (player === 'sellfirst' && makers(p).length < (tier === 2 ? 2 : 1)) return [market];
    return [dock!, market];
  };
  /** The maker of m that a new consumer takes it from: the one that feeds fewest machines. */
  const sourceOf = (m: MatId): GNode | null => makers(m).sort((a, b) => machineUsers(a) - machineUsers(b) || b.lv.speed - a.lv.speed)[0] ?? null;

  // The Foundry (docs/TIERS.md §15): what it takes of its raw material a second flat out, and what its Drills bring.
  const foundriesOf = (m: MatId) => makers(m).filter((n) => n.type === 'foundry');
  const foundryCap = (f: GNode) => {
    const r = recipeOf(f);
    return r ? r.inputs[0][1] / cycleTime(f, r) : 0;
  };
  const foundryLoad = (f: GNode) => feeders(f).filter((d) => d.type === 'well').reduce((sum, d) => sum + wellRate(d), 0);
  const roomIn = (m: MatId, add: number) => foundriesOf(m).find((f) => foundryLoad(f) + add <= foundryCap(f) * 1.05) ?? null;
  /** A Foundry of m, built from a Drill's port, its product to a Market (and its Tar to a Dump). */
  const foundryFrom = (d: GNode, m: MatId): (() => boolean) | null => {
    if (g.credits < nodeCost(g, 'foundry')) return null;
    return () => {
      const f = fromPort(d, 0, 'foundry', `f-${RECIPE[m]}`);
      if (!f) return false;
      connect(g, f.id, 0, market.id);
      if (m === 'ink') {
        const dump = g.nodes.find((n) => n.type === 'void');
        if (dump) connect(g, f.id, 1, dump.id);
      }
      say(`${player}: a ${MATERIALS[m].name} Foundry (${nodeCost(g, 'foundry')}¢ for the next)`);
      return true;
    };
  };

  /**
   * The rebuilder's first actions in Tier 2: for each of Glass, Plastic and Copper, its Drills into Foundries (as
   * many as each can take), and the Refiner each Drill fed deleted, a step at a time.
   */
  const rebuildStep = (): (() => boolean) | null => {
    for (const m of ['shard', 'ink', 'spark'] as MatId[]) {
      const raw = RAW[m]!;
      const drills = drillsOf(raw);
      if (drills.length < 2) continue;
      for (const d of drills) {
        const old = g.wires.map((w) => (w.from === d.id ? node(w.to) : null)).find((n) => n?.type === 'refiner') ?? null;
        const into = g.wires.some((w) => w.from === d.id && node(w.to)?.type === 'foundry');
        if (into) {
          if (old) return () => deleteNode(g, old.id);
          continue;
        }
        const f = roomIn(m, wellRate(d));
        if (f) return () => !!connect(g, d.id, 0, f.id);
        return foundryFrom(d, m);
      }
    }
    return null;
  };

  /** More of m for a consumer (or for whoever wants it): a new line, a Rubber Refiner, another maker of a part. */
  const supplyStep = (m: MatId, consumer: GNode | null): (() => boolean) | null => {
    if (RAW[m]) {
      if (player === 'rebuilder' && foundriesOf(m).length) {
        // A new Drill goes into a Foundry with room, or a new Foundry is built from it.
        const bare = drillsOf(RAW[m]!).find((d) => !feeds(d));
        if (bare) {
          const f = roomIn(m, wellRate(bare));
          return f ? () => !!connect(g, bare.id, 0, f.id) : foundryFrom(bare, m);
        }
        const dep = freeDeposits(g).find((x) => x.mat === RAW[m]);
        if (dep) return g.credits >= nodeCost(g, 'well') ? () => !!build('well', { depositId: dep.id }) : null;
        return landStep(m);
      }
      return lineStep(m, consumer ? [consumer, market] : [market], consumer ? `for ${MATERIALS[consumer.recipe ? RECIPES[consumer.recipe].outputs[0][0] : m].name}` : 'more') ?? landStep(m);
    }
    if (m === 'clay') {
      // Rubber: a Refiner on the Tar port of a Plastic maker whose Tar no Rubber Refiner takes yet.
      const plastic = makers('ink').find((r) => !g.wires.some((w) => w.from === r.id && w.port === 1 && node(w.to)?.recipe === 'clay'));
      if (!plastic) return supplyStep('ink', null);
      if (g.credits < nodeCost(g, 'refiner')) return null;
      return () => {
        const r = fromPort(plastic, 1, 'refiner', 'clay');
        if (r) say(`${player}: a Rubber Refiner on a Tar port`);
        return !!r;
      };
    }
    return makerStep(m);
  };

  /** Another maker of p (an Assembler, a Fabricator, a Rubber Refiner), built from the source of what it is built from. */
  const makerStep = (p: MatId): (() => boolean) | null => {
    if (p === 'clay') return supplyStep('clay', null);
    const first = BUILT_FROM[p] ?? PART_INPUTS(p)[0];
    const src = sourceOf(first);
    if (!src) return supplyStep(first, null);
    const type = machineOf(p);
    if (g.credits < nodeCost(g, type)) return null;
    return () => {
      const a = fromPort(src, 0, type, RECIPE[p]);
      if (a) say(`${player}: a ${NODE_DEFS_NAME(type)} for ${MATERIALS[p].name} (${nodeCost(g, type)}¢ for the next)`);
      return !!a;
    };
  };

  /** A maker of p wants an input nothing brings it, or its product goes nowhere it should: the wire, or the supply. */
  const fixStep = (a: GNode, p: MatId): (() => boolean) | null => {
    for (const t of partTargets(p)) if (!wired(a, 0, t)) return () => !!connect(g, a.id, 0, t.id);
    for (const m of PART_INPUTS(p)) {
      if (feeders(a, m).some((f) => makers(m).includes(f))) continue;
      const src = sourceOf(m);
      if (src) return () => !!connect(g, src.id, 0, a.id);
      return supplyStep(m, a);
    }
    return null;
  };

  /** A maker waits for an input: a maker of it that feeds no machine yet, wired in, or more of it. */
  const starvedStep = (p: MatId): (() => boolean) | null => {
    for (const a of makers(p)) {
      if (a.status !== 'starved' || !a.missing) continue;
      const m = a.missing;
      const spare = makers(m).find((r) => machineUsers(r) === 0 && !wired(r, 0, a));
      if (spare) return () => !!connect(g, spare.id, 0, a.id);
      return supplyStep(m, a);
    }
    return null;
  };
  /** Speed on p's makers that run flat out, or on what feeds one that waits (its Drills, where that waits too). */
  const partSpeedStep = (p: MatId): (() => boolean) | null => {
    const picks: GNode[] = [];
    for (const a of makers(p)) {
      if (a.status === 'starved' && a.missing) {
        for (const f of feeders(a, a.missing).filter((x) => makers(a.missing!).includes(x))) {
          if (f.status === 'starved') picks.push(...feeders(f).filter((d) => d.type === 'well' || d.type === 'refiner' || d.type === 'foundry'));
          else picks.push(f);
        }
      } else picks.push(a);
    }
    return speedOn(cheapest(picks));
  };

  /**
   * A maker backed up behind a contract line that is delivered in full (the Dock takes no more of it): a wire to a
   * Market. Without it a line can stop the machines behind it: Phones done, the Fabricator stops, then the Circuit
   * Assembler, then the Plastic Refiner, and with it the Tar that Rubber is made of. Every player does this, the minimal
   * one too: "Backed up" is on the card.
   */
  const unjamStep = (): (() => boolean) | null => {
    for (const n of g.nodes) {
      if (n.status !== 'blocked' || !n.recipe || !isMachine(n)) continue;
      const out = RECIPES[n.recipe].outputs[0][0];
      // (Only behind a line the Dock is done with: one still being delivered is not jammed for good.)
      if (!contractMats().includes(out) || left(out) > 0) continue;
      if (!wired(n, 0, market)) return () => !!connect(g, n.id, 0, market.id);
    }
    return null;
  };

  const tierParts = (): (() => boolean) | null => {
    if (player === 'rebuilder' && tier === 2) {
      const r = rebuildStep();
      if (r) return r;
    }
    const jam = unjamStep();
    if (jam) return jam;
    const parts = contractMats();
    // One maker of each product, fed and wired on; and every maker on the board fed (a Refiner deleted in a rebuild
    // leaves an Assembler without its input).
    for (const p of parts) {
      if (left(p) === 0) continue;
      if (!makers(p).length) return makerStep(p);
    }
    for (const n of g.nodes) {
      if (n.type !== 'assembler' && n.type !== 'fabricator') continue;
      const out = n.recipe ? RECIPES[n.recipe].outputs[0][0] : null;
      if (!out || (parts.includes(out) && left(out) === 0)) continue;
      const fix = fixStep(n, out);
      if (fix) return fix;
    }
    if (player === 'minimal') return null;
    const built = (p: MatId) => makers(p).length >= (tier === 2 ? 2 : 1);
    if (player === 'sellfirst' && parts.every(built)) {
      // Built up: every maker delivers.
      for (const p of parts) for (const a of makers(p)) if (!wired(a, 0, dock!)) return () => !!connect(g, a.id, 0, dock!.id);
    }
    const order = player === 'sellfirst' && !parts.every(built) ? [...parts].sort((a, b) => makers(a).length - makers(b).length) : slowest();
    for (const p of order) {
      const add = () => starvedStep(p) ?? makerStep(p);
      const step = player === 'tuner' ? partSpeedStep(p) ?? add()
        : player === 'mixed' || player === 'rebuilder' ? add() ?? partSpeedStep(p)
        : add();
      if (step) return step;
    }
    return null;
  };

  const boardNow = (): TierStat['board'] => {
    const b: TierStat['board'] = { plots: g.board.expansions };
    for (const n of g.nodes) b[n.type] = (b[n.type] ?? 0) + 1;
    return b;
  };

  while (g.time < end) {
    tick(g, DT);
    const goal = activeGoal(g);
    if (tier && goal?.id === TIER_GOAL[tier]) {
      for (const m of contractMats()) if (stat().filled[m] == null && left(m) === 0) stat().filled[m] = g.time - stat().at!;
    }
    if (tier && g.goal.ready && goal?.id === TIER_GOAL[tier] && stat().doneAt == null) {
      const s = stat();
      s.doneAt = g.time;
      s.seconds = g.time - s.at!;
      s.board = boardNow();
      say(`Tier ${tier} contract delivered`);
      if (tier >= through) break;
    }
    if (g.time < next) continue;
    // Claim what is ready (a card player's 8–16 s are not modelled: these players watch the card).
    if (g.goal.ready) {
      const id = activeGoal(g)!.id;
      claimGoal(g);
      say(`claimed ${id}`);
      const opens: Record<string, Tier> = { 'dock-glass': 1, 'tier-refining': 2, 'tier-parts': 3 };
      if (opens[id]) {
        tier = opens[id];
        stat().at = g.time;
        say(`Tier ${tier} begins with ${Math.round(g.credits)}¢`);
      }
      next = g.time + HANDS;
      continue;
    }
    if (g.order?.ready) {
      claimOrder(g);
      next = g.time + HANDS;
      continue;
    }
    const step = tier === 0 ? guided() : tier === 1 ? tier1() : activeGoal(g)?.id === TIER_GOAL[tier] ? tierParts() : null;
    if (step && step()) next = g.time + HANDS;
    else {
      next = g.time + 1;
      if (tier) stat().idle += 1;
    }
  }
  return { player, seed, t1: stats[1], t2: stats[2], t3: stats[3], log, game: g };
}

/** mm:ss */
export const clock = (t: number | null) => (t == null ? '—' : `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`);

function main() {
  let only: Player | null = null;
  let seed: number | null = null;
  let seeds = [0, 1, 2, 3, 4, 5, 6, 7];
  let contract1: Bag | undefined;
  let contract2: Bag | undefined;
  let contract3: Bag | undefined;
  let hands: number | undefined;
  let through: Tier = 3;
  const out = (s: string) => process.stdout.write(s + '\n');
  const bag = (v: string): Bag => {
    const b: Bag = {};
    for (const part of v.split(',')) {
      const [mat, n] = part.split(':');
      if (!MATERIALS[mat as MatId]) throw new Error(`Unknown material "${mat}"`);
      b[mat as MatId] = Number(n);
    }
    return b;
  };
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-zA-Z0-9]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'player' && v) only = v as Player;
    else if (k === 'seed' && v) seed = Number(v);
    else if (k === 'seeds' && v) seeds = v.split(',').map(Number);
    else if (k === 'hands' && v) hands = Number(v);
    else if (k === 'through' && v) through = Math.min(3, Math.max(1, Number(v))) as Tier;
    else if ((k === 'contract1' || k === 'contract') && v) contract1 = bag(v);
    else if (k === 'contract2' && v) contract2 = bag(v);
    else if (k === 'contract3' && v) contract3 = bag(v);
    else if (k === 'set' && v) {
      applyOverrides(v);
      out(`WHAT-IF: --set=${v}`);
    }
  }
  const opts = { contract1, contract2, contract3, hands, through };
  if (only && seed != null) {
    const r = playTiers(only, seed, opts);
    for (const l of r.log) out(l);
    out('');
    for (const t of [1, 2, 3] as const) out(row(r, t));
    return;
  }
  const players = only ? [only] : PLAYERS;
  const all: TierRun[] = [];
  for (const p of players) for (const s of seed != null ? [seed] : seeds) all.push(playTiers(p, s, opts));
  for (const t of [1, 2, 3] as const) {
    if (t > through) break;
    const goal = GOALS.find((x) => x.id === TIER_GOAL[t])!;
    out(`\nTier ${t} contract: ${Object.entries(goal.contract!).map(([m, n]) => `${n} ${MATERIALS[m as MatId].name}`).join(', ')}; one action every ${hands ?? 4} s`);
    out(HEAD);
    for (const r of all) out(row(r, t));
    out('');
    out('player      takes (min–max)    median   idle share');
    for (const p of players) {
      const rs = all.filter((r) => r.player === p && r[`t${t}`].seconds != null).map((r) => r[`t${t}`]);
      const ts = rs.map((r) => r.seconds!).sort((a, b) => a - b);
      const idle = rs.reduce((s, r) => s + r.idle, 0) / Math.max(1, rs.reduce((s, r) => s + r.seconds!, 0));
      out(`${p.padEnd(10)}  ${ts.length ? `${clock(ts[0])}–${clock(ts[ts.length - 1])}` : 'never'.padEnd(11)}        ${ts.length ? clock(ts[Math.floor(ts.length / 2)]) : '—'}    ${Math.round(idle * 100)}%   (${rs.length}/${all.filter((r) => r.player === p).length} filled)`);
    }
  }
}

const HEAD = 'player     seed  begins   filled at  takes   each material filled at     idle  Drills Refiners Foundries Assemblers Fabs plots Speed  spent¢';
function row(r: TierRun, t: Tier): string {
  const s = r[`t${t}`];
  const mats = Object.entries(s.filled).map(([m, at]) => `${MATERIALS[m as MatId].name} ${clock(at!)}`).join(' ');
  const b = s.board;
  return `${r.player.padEnd(10)} ${String(r.seed).padStart(4)}  ${clock(s.at).padStart(6)}  ${clock(s.doneAt).padStart(9)}  ${clock(s.seconds).padStart(5)}   ${mats.padEnd(26)}  ${String(Math.round(s.idle)).padStart(4)}s  ${String(b.well ?? 0).padStart(5)}  ${String(b.refiner ?? 0).padStart(7)}  ${String(b.foundry ?? 0).padStart(8)}  ${String(b.assembler ?? 0).padStart(9)}  ${String(b.fabricator ?? 0).padStart(3)}  ${String(b.plots).padStart(4)}  ${String(s.speed).padStart(4)}  ${String(Math.round(s.spent)).padStart(6)}`;
}

if (!process.env.VITEST && process.argv.some((a) => /(^|[\\/])tiers\.ts$/.test(a))) main();

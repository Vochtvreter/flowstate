/**
 * The tiers' scripted players (docs/TIERS.md §9): a new game of tiers, played on the real rules through the guided
 * start and Tier 1's contract by players who build in different ways. What it answers: does a bigger factory fill
 * the contract sooner, and does the player who builds least still fill it?
 *
 *   npx vite-node tools/tiers.ts -- x/tiers.ts                      every player on seeds 0–7, one table
 *   npx vite-node tools/tiers.ts -- --player=wide --seed=0 x/tiers.ts   one run, with its timeline
 *   other flags: --seeds=0,1,2   --contract=shard:400,ink:250,spark:150 (what-if: Tier 1's contract)
 *                --hands=<s> (seconds per action; 4 otherwise)   --set=rules.expansion.growth=1.6 (what-if numbers,
 *                as the pacing tool's --set)
 *
 * (The trailing x/tiers.ts is there because vite-node does not pass the script's own path on to it: see the
 * check at the bottom.)
 *
 * The players. All of them play the guided start the same way, by the card (its how, and a growth goal's line), and
 * take a Router, a Merger, orders and research as they come to nothing: what they differ in is Tier 1.
 *  - minimal: one line of each material the contract asks for, every new line wired to the Dock alone, and then it
 *    waits. It never upgrades and never buys land. The floor: if it cannot fill the contract, nobody is sure to.
 *  - wide: the same lines, and then more of them for whichever material is furthest from done: a Drill and a
 *    Refiner on a free deposit, or the next plot when none is free. Each new line goes to the Dock and a Market
 *    (half each), so that it pays for the next.
 *  - tuner: the same lines, then Speed on the slowest material's makers and their Drills before any new line.
 *  - sellfirst: wide, but its new lines go to the Market alone until it has three lines of each material, and only
 *    then to the Dock: build first, deliver after.
 *  - mixed: wide, and Speed on the slowest material whenever no new line or plot can be paid for.
 */
import { claimGoal, claimOrder, connect, expandBoard, freeDeposits, placeNode, upgrade } from '../src/actions';
import { applyAdvice, lineAdvice } from '../src/advice';
import { EXPANSION_DEPOSITS, MATERIALS, MatId, NodeType, RECIPES } from '../src/content';
import { expansionCost, nodeCost, upgradeCost, maxLevel, trackAvailable } from '../src/economy';
import { GOALS, activeGoal, making, meanwhileOf } from '../src/goals';
import { tick } from '../src/sim';
import { Bag, Game, GNode, newGame } from '../src/state';
import { applyOverrides } from './pacing-profiles';

declare const process: { argv: string[]; env: Record<string, string | undefined>; stdout: { write(s: string): void } };

export type Player = 'minimal' | 'wide' | 'tuner' | 'sellfirst' | 'mixed';
export const PLAYERS: Player[] = ['minimal', 'wide', 'tuner', 'sellfirst', 'mixed'];

export interface TierRun {
  player: Player;
  seed: number;
  /** The guided start's contract claimed: Tier 1 begins. */
  tier1At: number | null;
  /** Tier 1's contract delivered (its goal ready). */
  doneAt: number | null;
  /** doneAt − tier1At. */
  seconds: number | null;
  /** Seconds of Tier 1 with nothing this player would do: no step it could pay for. */
  idle: number;
  /** At the end of Tier 1: Drills, machines, plots bought, Speed levels bought. */
  drills: number;
  refiners: number;
  expansions: number;
  speed: number;
  /** Credits spent in Tier 1, and what was in hand at its end. */
  spent: number;
  credits: number;
  /** When each material of the contract was delivered in full, from the start of Tier 1. */
  filled: Partial<Record<MatId, number>>;
  log: string[];
  /** The game as it stands at the end of the run (for a save to look at: --save). */
  game: Game;
}

const DT = 0.1;
const RAW: Partial<Record<MatId, MatId>> = { shard: 'glint', ink: 'murk', spark: 'ember' };
const RECIPE: Partial<Record<MatId, string>> = { shard: 'shard', ink: 'ink', spark: 'spark' };

export function playTiers(player: Player, seed: number, opts: { contract?: Bag; hands?: number; minutes?: number } = {}): TierRun {
  const g = newGame({ tiers: true });
  g.orderSeed = (g.orderSeed + seed * 7919) >>> 0;
  if (opts.contract) {
    const goal = GOALS.find((x) => x.id === 'tier-refining')!;
    goal.contract = { ...opts.contract };
  }
  const HANDS = opts.hands ?? 4;
  const end = (opts.minutes ?? 40) * 60;
  const log: string[] = [];
  const say = (s: string) => log.push(`${clock(g.time)}  ${s}`);
  const market = g.nodes.find((n) => n.type === 'market')!;
  let dock: GNode | null = null;
  let next = 6; // the time of the next action
  let readyAt: number | null = null;
  let tier1At: number | null = null;
  let doneAt: number | null = null;
  let idle = 0;
  let spentAt1 = 0;
  let spent = 0;
  let speed = 0;
  const filled: Partial<Record<MatId, number>> = {};
  let y = 40;
  const spot = () => ({ x: 600 + (g.nodes.length % 6) * 160, y: (y += 70) % 1400 });

  const pay = <T>(before: number, r: T): T => {
    spent += Math.max(0, before - g.credits);
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
  const wired = (a: GNode, port: number, b: GNode) => g.wires.some((w) => w.from === a.id && w.port === port && w.to === b.id);
  const makers = (m: MatId) => g.nodes.filter((n) => n.recipe === RECIPE[m]);
  const drillsOf = (raw: MatId) => g.nodes.filter((n) => n.type === 'well' && n.material === raw);
  const feeds = (d: GNode) => g.wires.some((w) => w.from === d.id && g.nodes.find((n) => n.id === w.to)?.type === 'refiner');

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

  /** How long the contract's rest of each material takes at what is made of it now (Infinity: nothing is). */
  const left = (m: MatId) => {
    const k = g.contract!;
    const rest = (k.need[m] ?? 0) - (k.got[m] ?? 0);
    if (rest <= 0) return 0;
    const r = k.rate[m] ?? 0;
    return r > 0.02 ? rest / r : Infinity;
  };
  const contractMats = () => (Object.keys(g.contract?.need ?? {}) as MatId[]);
  const linesOf = (m: MatId) => makers(m).length;

  /** A new line for m: a Drill on a free deposit of its raw material, then (next action) a Refiner from it. */
  const lineStep = (m: MatId, to: 'dock' | 'both' | 'market'): (() => boolean) | null => {
    const raw = RAW[m]!;
    // A Drill standing with no Refiner: the Refiner from it, wired on.
    const bare = drillsOf(raw).find((d) => !feeds(d));
    if (bare) {
      if (g.credits < nodeCost(g, 'refiner')) return null;
      return () => {
        const r = fromPort(bare, 0, 'refiner', RECIPE[m]);
        if (!r) return false;
        if (bare.material === 'glint' && g.wires.some((w) => w.from === bare.id && w.to === market.id)) {
          // (A Sand Drill that sold its Sand: what it sells now is Glass.)
        }
        if (to !== 'market') connect(g, r.id, 0, dock!.id);
        if (to !== 'dock') connect(g, r.id, 0, market.id);
        if (m === 'ink') {
          const dump = g.nodes.find((n) => n.type === 'void');
          if (dump) connect(g, r.id, 1, dump.id);
          else fromPort(r, 1, 'void');
        }
        say(`${player}: a ${MATERIALS[m].name} line (${to})`);
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
  /** A level of Speed where it brings more of m: the Drill of a Refiner that waits for it, or else the Refiner. */
  const speedStep = (m: MatId): (() => boolean) | null => {
    const raw = RAW[m]!;
    let best: GNode | null = null;
    for (const r of makers(m)) {
      const drill = g.wires.map((w) => (w.to === r.id ? g.nodes.find((n) => n.id === w.from) : null)).find((n) => n?.type === 'well' && n.material === raw) ?? null;
      // A Refiner flat out on what it is given: speed it up; one that waits for its raw material: speed up its Drill.
      const pick = r.status === 'starved' && drill ? drill : r;
      if (!trackAvailable(g, pick, 'speed') || pick.lv.speed >= maxLevel(g, 'speed')) continue;
      if (!best || upgradeCost(pick, 'speed') < upgradeCost(best, 'speed')) best = pick;
    }
    if (!best || g.credits < upgradeCost(best, 'speed')) return null;
    const n = best;
    return () => {
      const before = g.credits;
      const ok = upgrade(g, n.id, 'speed');
      if (ok) speed++;
      return pay(before, ok);
    };
  };

  /** What this player does in Tier 1, or null for nothing it can do now. */
  const tier1 = (): (() => boolean) | null => {
    const mats = contractMats();
    // Every material gets a line to the Dock (the Glass lines of the start: each wired to the Dock too).
    for (const m of mats) {
      if (left(m) === 0) continue;
      const own = makers(m);
      if (own.length && !own.some((r) => wired(r, 0, dock!))) {
        const r = own[0];
        return () => !!connect(g, r.id, 0, dock!.id);
      }
      if (!own.length) return lineStep(m, player === 'minimal' ? 'dock' : 'both');
    }
    if (player === 'minimal') return null;
    // The material furthest from done.
    const order = mats.filter((m) => left(m) > 0).sort((a, b) => left(b) - left(a) || a.localeCompare(b));
    if (player === 'sellfirst' && mats.some((m) => linesOf(m) < 3)) {
      const m = [...mats].sort((a, b) => linesOf(a) - linesOf(b))[0];
      return lineStep(m, 'market') ?? landStep(m);
    }
    if (player === 'sellfirst') {
      // Built up: every line delivers.
      for (const m of order) {
        const r = makers(m).find((x) => !wired(x, 0, dock!));
        if (r) return () => !!connect(g, r.id, 0, dock!.id);
      }
    }
    for (const m of order) {
      const step = player === 'tuner' ? speedStep(m) ?? lineStep(m, 'both') ?? landStep(m)
        : player === 'mixed' ? lineStep(m, 'both') ?? landStep(m) ?? speedStep(m)
        : lineStep(m, 'both') ?? landStep(m);
      if (step) return step;
    }
    return null;
  };

  while (g.time < end) {
    tick(g, DT);
    const goal = activeGoal(g);
    if (goal?.id === 'tier-refining') {
      for (const m of contractMats()) if (filled[m] == null && left(m) === 0) filled[m] = g.time - tier1At!;
    }
    if (g.goal.ready && readyAt == null) {
      readyAt = g.time;
      if (goal?.id === 'tier-refining') {
        doneAt = g.time;
        say(`Tier 1 contract delivered`);
        break;
      }
    }
    if (g.time < next) continue;
    // Claim what is ready (a card player's 8–16 s are not modelled: these players watch the card).
    if (g.goal.ready) {
      const id = activeGoal(g)!.id;
      claimGoal(g);
      readyAt = null;
      say(`claimed ${id}`);
      if (id === 'dock-glass') {
        tier1At = g.time;
        spentAt1 = spent;
        say(`Tier 1 begins with ${Math.round(g.credits)}¢`);
      }
      next = g.time + HANDS;
      continue;
    }
    if (g.order?.ready) {
      claimOrder(g);
      next = g.time + HANDS;
      continue;
    }
    const step = tier1At == null ? guided() : tier1();
    if (step && step()) next = g.time + HANDS;
    else {
      next = g.time + 1;
      if (tier1At != null) idle += 1;
    }
  }
  const count = (t: NodeType) => g.nodes.filter((n) => n.type === t).length;
  return {
    player, seed, tier1At, doneAt, seconds: doneAt != null && tier1At != null ? doneAt - tier1At : null, idle,
    drills: count('well'), refiners: count('refiner'), expansions: g.board.expansions, speed,
    spent: spent - spentAt1, credits: g.credits, filled, log, game: g,
  };
}

/** mm:ss */
export const clock = (t: number | null) => (t == null ? '—' : `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`);

function main() {
  let only: Player | null = null;
  let seed: number | null = null;
  let seeds = [0, 1, 2, 3, 4, 5, 6, 7];
  let contract: Bag | undefined;
  let hands: number | undefined;
  const out = (s: string) => process.stdout.write(s + '\n');
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-zA-Z]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'player' && v) only = v as Player;
    else if (k === 'seed' && v) seed = Number(v);
    else if (k === 'seeds' && v) seeds = v.split(',').map(Number);
    else if (k === 'hands' && v) hands = Number(v);
    else if (k === 'set' && v) {
      applyOverrides(v);
      out(`WHAT-IF: --set=${v}`);
    }
    else if (k === 'contract' && v) {
      contract = {};
      for (const part of v.split(',')) {
        const [mat, n] = part.split(':');
        if (!MATERIALS[mat as MatId]) throw new Error(`Unknown material "${mat}"`);
        contract[mat as MatId] = Number(n);
      }
    }
  }
  if (only && seed != null) {
    const r = playTiers(only, seed, { contract, hands });
    for (const l of r.log) out(l);
    out('');
    out(row(r));
    return;
  }
  const players = only ? [only] : PLAYERS;
  out(`Tier 1 contract: ${Object.entries(contract ?? GOALS.find((x) => x.id === 'tier-refining')!.contract!).map(([m, n]) => `${n} ${MATERIALS[m as MatId].name}`).join(', ')}; one action every ${hands ?? 4} s`);
  out(HEAD);
  const all: TierRun[] = [];
  for (const p of players) {
    for (const s of seed != null ? [seed] : seeds) {
      const r = playTiers(p, s, { contract, hands });
      all.push(r);
      out(row(r));
    }
  }
  out('');
  out('player      Tier 1 (min–max)   median   idle share');
  for (const p of players) {
    const rs = all.filter((r) => r.player === p && r.seconds != null);
    const t = rs.map((r) => r.seconds!).sort((a, b) => a - b);
    const idle = rs.reduce((s, r) => s + r.idle, 0) / Math.max(1, rs.reduce((s, r) => s + r.seconds!, 0));
    out(`${p.padEnd(10)}  ${t.length ? `${clock(t[0])}–${clock(t[t.length - 1])}` : 'never'.padEnd(11)}        ${t.length ? clock(t[Math.floor(t.length / 2)]) : '—'}    ${Math.round(idle * 100)}%   (${rs.length}/${all.filter((r) => r.player === p).length} filled)`);
  }
}

const HEAD = 'player     seed  Tier 1 at  filled at  Tier 1   Glass  Plastic Copper  idle  Drills Refiners plots Speed  spent¢';
function row(r: TierRun): string {
  const f = (m: MatId) => clock(r.filled[m] ?? null).padStart(6);
  return `${r.player.padEnd(10)} ${String(r.seed).padStart(4)}  ${clock(r.tier1At).padStart(8)}  ${clock(r.doneAt).padStart(9)}  ${clock(r.seconds).padStart(6)}  ${f('shard')}  ${f('ink')}  ${f('spark')}  ${String(Math.round(r.idle)).padStart(4)}s  ${String(r.drills).padStart(5)}  ${String(r.refiners).padStart(7)}  ${String(r.expansions).padStart(4)}  ${String(r.speed).padStart(4)}  ${String(Math.round(r.spent)).padStart(6)}`;
}

if (!process.env.VITEST && process.argv.some((a) => /(^|[\\/])tiers\.ts$/.test(a))) main();

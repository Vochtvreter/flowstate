/**
 * What-if profiles for the pacing bot (tools/pacing.ts).
 *
 * A profile changes NUMBERS ONLY, in memory, for one bot run. Nothing under src/ is edited:
 *  - `apply()` mutates the content tables the game reads (TECHS, NODE_DEFS, MATERIALS, RECIPES, PIPES, DATA_YIELD);
 *  - formulas that are hard-coded in src/economy.ts and src/sim.ts (expansion price, upgrade price,
 *    milestone bonus, starting credits) are emulated by the bot through the optional functions below;
 *  - `hooks` inject rewards while the bot plays (a goal chain, delivery orders, ...).
 *
 * `current` is the build as shipped. Add your own profile and run:
 *   npm run pacing -- --profile=<name>
 */
import { DataTier, MATERIALS, MatId, NODE_DEFS, TECHS, Track } from '../src/content';
import { grantTech } from '../src/economy';
import { Game, GNode } from '../src/state';

export interface Reward { credits?: number; a?: number; b?: number; g?: number }

export interface HookCtx {
  g: Game;
  /** Game time in seconds. */
  t: number;
  /** Pay the player. Shows up in the timeline as a reward line. */
  grant(r: Reward, why: string): void;
  /** Number of nodes of a type on the board. */
  count(type: string): number;
  /** True once this material has been produced. */
  made(mat: string): boolean;
}

export interface RewardHook {
  name: string;
  /** Called once per simulation tick, after the game has advanced. */
  onTick(ctx: HookCtx): void;
}

export interface Profile {
  describe: string;
  /** Mutate content tables for this run. */
  apply?(): void;
  startCredits?: number;
  /** Price of board expansion number n (0-based). Default: the game's 100 × 2.2^n. */
  expansionCost?(n: number): number;
  /** Price of the next upgrade level. Default: the game's own formula (passed in as `game`). */
  upgradeCost?(n: GNode, track: Track, game: number): number;
  /** The "first time you make X" bonus. Default: the game's value × 30 (passed in as `game`). */
  milestone?(mat: MatId, game: number): number;
  hooks?: RewardHook[];
}

// ---------- helpers for writing reward hooks ----------

export interface Goal { text: string; done(c: HookCtx): boolean; reward: Reward }

/** A linear goal chain: the first unfinished goal is the active one; finishing it pays out and moves on. */
export function goalChain(goals: Goal[]): RewardHook {
  let i = 0;
  return {
    name: 'goal chain',
    onTick(c) {
      // one goal per tick, so a reward can never complete the next goal in the same instant
      if (i < goals.length && goals[i].done(c)) {
        c.grant(goals[i].reward, `goal ${i + 1}: ${goals[i].text}`);
        i++;
      }
    },
  };
}

/**
 * Delivery orders: every `every` seconds after `from`, an order pays `seconds` worth of the current
 * market income, plus `dataSeconds` worth of each Data income. Scales with the factory by itself.
 */
export function orders(opts: { from: number; every: number; seconds: number; dataSeconds?: number }): RewardHook {
  let next = opts.from;
  return {
    name: 'delivery orders',
    onTick(c) {
      if (c.t < next) return;
      next += opts.every;
      const credits = Math.round(c.g.creditRate * opts.seconds);
      if (credits < 1) return;
      const d = opts.dataSeconds ?? 0;
      c.grant(
        { credits, a: Math.round(c.g.dataRate.a * d), b: Math.round(c.g.dataRate.b * d), g: Math.round(c.g.dataRate.g * d) },
        `order delivered (${opts.seconds}s of income)`,
      );
    },
  };
}

/** Grant an auto tech at a different trigger than the game's own (the game still grants it at its own, later, trigger). */
export function earlyUnlock(id: string, when: (c: HookCtx) => boolean): RewardHook {
  return { name: `early ${id}`, onTick(c) { if (!c.g.techs.includes(id) && when(c)) grantTech(c.g, id); } };
}

const cost = (id: string, c: Partial<Record<DataTier, number>>) => { TECHS[id].cost = c; };
const techs = (c: HookCtx) => c.g.techs.filter((t) => !TECHS[t].auto).length;

// ---------- profiles ----------

export const PROFILES: Record<string, Profile> = {
  current: { describe: 'The build as shipped. No changes.' },

  /** Recommended first-pass tuning from the pacing analysis. Re-measure after every content change. */
  proposed: {
    describe: 'Recommended numbers: goal chain + orders, steeper Data prices, smaller late milestones.',
    startCredits: 0,
    apply() {
      // --- α techs: cheap side techs every ~40-70 s, the Processing spine carries the weight ---
      cost('C1', { a: 10 });
      cost('L1', { a: 20 });
      cost('P2', { a: 30 });
      cost('L2', { a: 50 });
      cost('R2', { a: 60 });
      cost('L5', { a: 80 });
      cost('P3', { a: 90 });
      cost('L3', { a: 100 });
      cost('S1', { a: 100 });
      cost('R4', { a: 100 });
      cost('C2', { a: 150 });
      cost('L4', { a: 200 });
      cost('U1', { a: 280 });
      cost('P4', { a: 500 });
      // --- α + β ---
      cost('P6', { a: 300, b: 40 });
      cost('P5', { a: 600 });
      cost('L6', { a: 300, b: 40 });
      cost('R3', { b: 80 });
      cost('L7', { b: 120 });
      cost('U2', { b: 150 });
      cost('C4', { b: 160 });
      cost('S3', { b: 200 });
      cost('P7', { a: 900, b: 400 });
      // --- γ ---
      cost('P8', { b: 600, g: 150 });
      cost('C5', { g: 120 });
      cost('L8', { g: 250 });
      cost('P9', { b: 1200, g: 500 });
      void NODE_DEFS;
    },
    // T1 firsts keep value × 30 (they fund the next step); T2 pays × 15, T3 × 10.
    milestone: (mat, game) => {
      const tier = MATERIALS[mat].tier;
      return tier >= 3 ? Math.round(game / 3) : tier === 2 ? Math.round(game / 2) : game;
    },
    hooks: [
      earlyUnlock('P1', (c) => c.g.lifetime >= 30),
      goalChain([
        { text: 'wire the Well to the Market', done: (c) => c.g.wires.length >= 1, reward: { credits: 15 } },
        { text: 'place a second Well and wire it', done: (c) => c.count('well') >= 2 && c.g.wires.length >= 2, reward: { credits: 15 } },
        { text: 'build a Refiner', done: (c) => c.count('refiner') >= 1, reward: { credits: 20 } },
        { text: 'build a Lab', done: (c) => c.count('lab') >= 1, reward: { a: 10 } },
        { text: 'research your first tech', done: (c) => techs(c) >= 1, reward: { credits: 40 } },
        { text: 'make Ink', done: (c) => c.made('ink'), reward: { a: 20 } },
        { text: 'get rid of the Silt', done: (c) => c.count('void') >= 1, reward: { credits: 60 } },
        { text: 'expand the board', done: (c) => c.g.board.expansions >= 1, reward: { credits: 80 } },
        { text: 'own 5 Wells', done: (c) => c.count('well') >= 5, reward: { a: 40 } },
        { text: 'make Spark', done: (c) => c.made('spark'), reward: { credits: 150 } },
        { text: 'research 8 techs', done: (c) => techs(c) >= 8, reward: { credits: 200 } },
        { text: 'earn 5¢ per second', done: (c) => c.g.creditRate >= 5, reward: { a: 100 } },
        { text: 'research Assembly', done: (c) => c.g.techs.includes('P4'), reward: { credits: 300 } },
        { text: 'make Glyph', done: (c) => c.made('glyph'), reward: { b: 20 } },
        { text: 'build a second Lab', done: (c) => c.count('lab') >= 2, reward: { credits: 300 } },
        { text: 'make Clay', done: (c) => c.made('clay'), reward: { b: 30 } },
        { text: 'make Prism', done: (c) => c.made('prism'), reward: { credits: 500 } },
        { text: 'make Coil', done: (c) => c.made('coil'), reward: { b: 60 } },
        { text: 'earn 25¢ per second', done: (c) => c.g.creditRate >= 25, reward: { credits: 800 } },
        { text: 'research Fabrication', done: (c) => c.g.techs.includes('P7'), reward: { credits: 1500 } },
        { text: 'make Lens', done: (c) => c.made('lens'), reward: { g: 30 } },
        { text: 'make Dynamo', done: (c) => c.made('dynamo'), reward: { credits: 3000 } },
      ]),
      orders({ from: 240, every: 100, seconds: 30, dataSeconds: 15 }),
    ],
  },
};

/**
 * What-if profiles for the pacing bot (tools/pacing.ts).
 *
 * The bot always plays the real game: the goal chain (src/goals.ts), orders (src/orders.ts) and the
 * numbers in src/content.ts. A profile changes NUMBERS ONLY, in memory, for one bot run:
 *  - `apply()` mutates what the game reads (TECHS, NODE_DEFS, MATERIALS, RECIPES, PIPES, DATA_YIELD, RULES,
 *    and the reward fields of GOALS);
 *  - `expansionCost` / `upgradeCost` let the bot pay a different price than the game's formula;
 *  - `hooks` run once per tick and may grant extra credits or Data (helpers below).
 *
 * `current` is the build as shipped. The old `proposed` profile is gone: its tech prices and the 3,000¢
 * Fabricator are now the defaults in src/content.ts, and its goal chain and orders were replaced by the
 * real ones. Add your own profile and run:
 *   npm run pacing -- --profile=<name>
 */
import { DataTier, TECHS, Track } from '../src/content';
import { grantTech } from '../src/economy';
import { Game, GNode } from '../src/state';

export interface Reward { credits?: number; a?: number; b?: number; g?: number }

export interface HookCtx {
  g: Game;
  /** Game time in seconds. */
  t: number;
  /** Market income in credits per second, averaged over about 30 seconds. */
  income: number;
  /** Data income per second by tier, averaged over about 30 seconds. */
  dataIncome: Record<DataTier, number>;
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
  hooks?: RewardHook[];
}

// ---------- helpers for writing reward hooks ----------

export interface Goal { text: string; done(c: HookCtx): boolean; reward: Reward }

/** An EXTRA linear goal chain on top of the game's own (src/goals.ts): the first unfinished goal is active; finishing it pays out and moves on. */
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
 * EXTRA payouts on top of the game's own orders (src/orders.ts): every `every` seconds after `from`, pay
 * `seconds` worth of the current market income, plus `dataSeconds` worth of each Data income.
 */
export function orders(opts: { from: number; every: number; seconds: number; dataSeconds?: number }): RewardHook {
  let next = opts.from;
  return {
    name: 'delivery orders',
    onTick(c) {
      if (c.t < next) return;
      next += opts.every;
      const credits = Math.round(c.income * opts.seconds);
      if (credits < 1) return;
      const d = opts.dataSeconds ?? 0;
      c.grant(
        { credits, a: Math.round(c.dataIncome.a * d), b: Math.round(c.dataIncome.b * d), g: Math.round(c.dataIncome.g * d) },
        `order delivered (${opts.seconds}s of income)`,
      );
    },
  };
}

/** Grant a tech at a trigger of your own, e.g. to try a goal-granted tech earlier than its goal. */
export function earlyUnlock(id: string, when: (c: HookCtx) => boolean): RewardHook {
  return { name: `early ${id}`, onTick(c) { if (!c.g.techs.includes(id) && when(c)) grantTech(c.g, id); } };
}

/** Set a tech price for this run. */
export const cost = (id: string, c: Partial<Record<DataTier, number>>) => { TECHS[id].cost = c; };

// ---------- profiles ----------

export const PROFILES: Record<string, Profile> = {
  current: { describe: 'The build as shipped. No changes.' },

  /** Example what-if: how much of the curve do the Data prices of the Processing spine carry? */
  'cheap-spine': {
    describe: 'Assembly, Breeze Deposits and Fabrication at half their Data price.',
    apply() {
      cost('P4', { a: 500 });
      cost('P5', { a: 750 });
      cost('P7', { a: 1000, b: 400 });
    },
  },
};

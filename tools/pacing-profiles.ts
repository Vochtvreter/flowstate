/**
 * What-if profiles for the pacing bot (tools/pacing.ts).
 *
 * The bot always plays the real game: the goal chain (src/goals.ts), orders (src/orders.ts), Flow
 * (src/flow.ts) and the numbers in src/content.ts. A profile changes NUMBERS ONLY, in memory, for one
 * process: `apply()` mutates what the game reads (TECHS, NODE_DEFS, MATERIALS, RECIPES, PIPES, DATA_YIELD,
 * the fields of RULES, and the reward fields of GOALS). Nothing is emulated here any more: if a rule is
 * not in src/, the bot cannot play it.
 *
 *   npm run pacing -- --profile=<name>            every policy, seeds 1–3, with those numbers
 *   npm run pacing -- --profile=<name> --policy=slow --seed=2
 *
 * Mutate fields in place (RULES.orders.minSeconds = 30), never replace a whole object
 * (RULES.orders = {...}): modules in src/ keep references to the originals.
 */
import { DataTier, NODE_DEFS, NodeType, RULES, TECHS } from '../src/content';
import { goalById } from '../src/goals';
import { GoalReward } from '../src/state';

export interface Profile {
  describe: string;
  /** Mutate content tables for this run. Called once, before the first game is created. */
  apply?(): void;
}

// ---------- helpers for writing profiles ----------

/** Set a tech price. */
export const cost = (id: string, c: Partial<Record<DataTier, number>>) => { TECHS[id].cost = c; };

/** Set a node's base price. */
export const base = (type: NodeType, price: number) => { NODE_DEFS[type].base = price; };

/** Change what a goal pays: the given fields replace the same fields of the real reward. */
export function reward(goalId: string, r: Partial<GoalReward>) {
  const goal = goalById(goalId);
  if (!goal) throw new Error(`No goal "${goalId}"`);
  Object.assign(goal.reward, r);
}

// ---------- profiles ----------

export const PROFILES: Record<string, Profile> = {
  current: { describe: 'The build as shipped. No changes.' },

  /** Example: how much of the curve do the Data prices of the Processing spine carry? */
  'cheap-spine': {
    describe: 'Assembly, Breeze Deposits and Fabrication at half their Data price.',
    apply() {
      for (const id of ['P4', 'P5', 'P7']) {
        const c = TECHS[id].cost;
        cost(id, { ...(c.a ? { a: Math.round(c.a / 2) } : {}), ...(c.b ? { b: Math.round(c.b / 2) } : {}) });
      }
    },
  },

  /** Example: what do goal rewards buy? The chain still unlocks things, but pays no credits or Data. */
  'no-rewards': {
    describe: 'Goals keep their tech grants and unlocks but pay no credits and no Data.',
    apply() {
      for (const id of [
        'wire-market', 'second-well', 'wire-all-wells', 'build-refiner', 'sell-shard', 'upgrade-well', 'feed-lab', 'research-murk',
        'make-ink', 'silt-exit', 'make-spark', 'first-order', 'route-lab', 'expand', 'make-glyph', 'hold-flow', 'study-glyph',
        'make-mist', 'make-prism', 'three-orders', 'build-fabricator', 'make-lens',
      ]) reward(id, { credits: 0, a: 0, b: 0, g: 0 });
    },
  },

  /** Example: orders half as long. */
  'short-orders': {
    describe: 'Orders ask for half as much.',
    apply() {
      RULES.orders.minSeconds /= 2;
      RULES.orders.maxSeconds /= 2;
    },
  },
};

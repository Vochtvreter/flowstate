/**
 * What-if profiles for the pacing bot (tools/pacing.ts).
 *
 * The bot always plays the real game: the goal chain (src/goals.ts), orders (src/orders.ts), Flow
 * (src/flow.ts) and the numbers in src/content.ts. A profile changes NUMBERS ONLY, in memory, for one
 * process: `apply()` mutates what the game reads (TECHS, NODE_DEFS, MATERIALS, RECIPES, PIPES, DATA_YIELD,
 * the fields of RULES, and the reward fields of GOALS). Nothing is emulated here any more: if a rule is
 * not in src/, the bot cannot play it.
 *
 *   npm run pacing -- --profile=<name>            every default policy, seeds 0–3, with those numbers
 *   npm run pacing -- --profile=<name> --policy=newcomer --seed=2
 *
 * Mutate fields in place (RULES.orders.minSeconds = 30), never replace a whole object
 * (RULES.orders = {...}): modules in src/ keep references to the originals.
 */
import { DataTier, MATERIALS, MatId, NODE_DEFS, NodeType, RULES, TECHS } from '../src/content';
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

/**
 * One-off overrides from the command line, on top of a profile:
 *   npm run pacing -- --set=tech.P4=a800,node.assembler.base=1000,rules.expansion.growth=2.5,goal.make-prism.credits=600
 *
 *   tech.<id>=a<n>[+b<n>][+g<n>]      a tech's whole price (tech.P7=a1000+b250)
 *   node.<type>.base|growth=<n>       a node's price
 *   mat.<id>.value|demand|study=<n>   a material (study: the Data a Lab makes from one item, where it is not the tier's)
 *   goal.<id>.credits|a|b|g=<n>       one field of a goal's reward
 *   rules.<path>=<n>                  any number in RULES (rules.orders.maxSeconds=60, rules.upgrade.speed.well=50)
 */
export function applyOverrides(spec: string) {
  for (const item of spec.split(',').filter(Boolean)) {
    const eq = item.indexOf('=');
    const path = item.slice(0, eq).split('.');
    const raw = item.slice(eq + 1);
    const fail = () => { throw new Error(`Cannot apply "--set=${item}"`); };
    if (eq < 0) fail();
    const [kind, id, ...rest] = path;
    if (kind === 'tech') {
      if (!TECHS[id]) fail();
      const c: Partial<Record<DataTier, number>> = {};
      for (const part of raw.split('+')) c[part[0] as DataTier] = Number(part.slice(1));
      cost(id, c);
      continue;
    }
    let target: Record<string, unknown> | undefined;
    let keys = rest;
    if (kind === 'node') target = NODE_DEFS[id as NodeType] as unknown as Record<string, unknown>;
    else if (kind === 'mat') target = MATERIALS[id as MatId] as unknown as Record<string, unknown>;
    else if (kind === 'goal') target = goalById(id)?.reward as unknown as Record<string, unknown> | undefined;
    else if (kind === 'rules') {
      target = RULES as unknown as Record<string, unknown>;
      keys = [id, ...rest];
    }
    if (!target || !keys.length || !isFinite(Number(raw))) fail();
    for (const k of keys.slice(0, -1)) {
      target = target![k] as Record<string, unknown> | undefined;
      if (!target || typeof target !== 'object') fail();
    }
    target![keys[keys.length - 1]] = Number(raw);
  }
}

// ---------- profiles ----------

export const PROFILES: Record<string, Profile> = {
  current: { describe: 'The build as shipped. No changes.' },

  /** Example: how much of the curve do the Data prices of the Processing spine carry? */
  'cheap-spine': {
    describe: 'Assembly, Quartz Deposits and Fabrication at half their Data price.',
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
        'make-mist', 'make-prism', 'bulk-upgrade', 'build-fabricator', 'make-lens',
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

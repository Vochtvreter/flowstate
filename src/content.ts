// All game content as plain data, plus RULES: every tunable number that is not a content table.
// Goal rewards and wording live in src/goals.ts.

export type MatId =
  | 'glint' | 'murk' | 'ember' | 'breeze'
  | 'shard' | 'ink' | 'silt' | 'spark' | 'mist' | 'clay'
  | 'prism' | 'glyph' | 'coil'
  | 'lens' | 'dynamo' | 'paradox';

export interface Material {
  id: MatId;
  name: string;
  tier: 0 | 1 | 2 | 3;
  value: number;
  /** Items per second a Market buys at full price; anything beyond sells at RULES.demand.surplusShare. */
  demand: number;
  color: string;
  /** Tech needed before a Well can extract it (raw materials only). */
  tech?: string;
  /** Data a Lab makes from one item, when that is not the usual amount for its tier (DATA_YIELD). */
  study?: number;
}

export const MATERIALS: Record<MatId, Material> = {
  glint: { id: 'glint', name: 'Glint', tier: 0, value: 1, demand: 2, color: '#FFD84D' },
  murk: { id: 'murk', name: 'Murk', tier: 0, value: 1, demand: 2, color: '#A78BFA', tech: 'P2' },
  ember: { id: 'ember', name: 'Ember', tier: 0, value: 2, demand: 1.5, color: '#FF8A3D', tech: 'P3' },
  breeze: { id: 'breeze', name: 'Breeze', tier: 0, value: 2, demand: 1.5, color: '#5CE1FF', tech: 'P5' },
  shard: { id: 'shard', name: 'Shard', tier: 1, value: 3, demand: 1.5, color: '#B8F26B' },
  ink: { id: 'ink', name: 'Ink', tier: 1, value: 4, demand: 1.2, color: '#6F93FF' },
  // A by-product is poor study material: 1 α, not the 3 α of a refined item (three Silt make one Clay, which is worth 3 α).
  silt: { id: 'silt', name: 'Silt', tier: 1, value: 0.5, demand: 0.5, color: '#C2C8D2', study: 1 },
  spark: { id: 'spark', name: 'Spark', tier: 1, value: 6, demand: 1, color: '#FF5A4E' },
  mist: { id: 'mist', name: 'Mist', tier: 1, value: 6, demand: 1, color: '#3FD6B5' },
  clay: { id: 'clay', name: 'Clay', tier: 1, value: 3, demand: 0.8, color: '#C08A5B' },
  prism: { id: 'prism', name: 'Prism', tier: 2, value: 24, demand: 0.6, color: '#E0C3FF' },
  glyph: { id: 'glyph', name: 'Glyph', tier: 2, value: 20, demand: 0.6, color: '#FF5ACD' },
  coil: { id: 'coil', name: 'Coil', tier: 2, value: 22, demand: 0.5, color: '#E59A57' },
  lens: { id: 'lens', name: 'Lens', tier: 3, value: 130, demand: 0.25, color: '#FFFFFF' },
  dynamo: { id: 'dynamo', name: 'Dynamo', tier: 3, value: 180, demand: 0.2, color: '#4FC3FF' },
  paradox: { id: 'paradox', name: 'Paradox', tier: 3, value: 750, demand: 0.1, color: '#F0ABFC' },
};

export const MAT_IDS = Object.keys(MATERIALS) as MatId[];

export type MachineType = 'refiner' | 'assembler' | 'fabricator';

export interface Recipe {
  id: string;
  name: string;
  machine: MachineType;
  inputs: [MatId, number][];
  outputs: [MatId, number][];
  time: number;
  tech: string;
}

export const RECIPES: Record<string, Recipe> = {
  shard: { id: 'shard', name: 'Shard', machine: 'refiner', inputs: [['glint', 2]], outputs: [['shard', 1]], time: 2, tech: 'P1' },
  ink: { id: 'ink', name: 'Ink', machine: 'refiner', inputs: [['murk', 2]], outputs: [['ink', 1], ['silt', 1]], time: 2, tech: 'P2' },
  spark: { id: 'spark', name: 'Spark', machine: 'refiner', inputs: [['ember', 2]], outputs: [['spark', 1]], time: 2, tech: 'P3' },
  mist: { id: 'mist', name: 'Mist', machine: 'refiner', inputs: [['breeze', 2]], outputs: [['mist', 1]], time: 2, tech: 'P5' },
  clay: { id: 'clay', name: 'Clay', machine: 'refiner', inputs: [['silt', 3]], outputs: [['clay', 1]], time: 3, tech: 'P6' },
  glyph: { id: 'glyph', name: 'Glyph', machine: 'assembler', inputs: [['ink', 1], ['spark', 1]], outputs: [['glyph', 1]], time: 3, tech: 'P4' },
  prism: { id: 'prism', name: 'Prism', machine: 'assembler', inputs: [['shard', 2], ['mist', 1]], outputs: [['prism', 1]], time: 4, tech: 'P5' },
  coil: { id: 'coil', name: 'Coil', machine: 'assembler', inputs: [['spark', 1], ['clay', 2]], outputs: [['coil', 1]], time: 4, tech: 'P6' },
  lens: { id: 'lens', name: 'Lens', machine: 'fabricator', inputs: [['prism', 1], ['glyph', 2]], outputs: [['lens', 1]], time: 6, tech: 'P7' },
  dynamo: { id: 'dynamo', name: 'Dynamo', machine: 'fabricator', inputs: [['coil', 2], ['glyph', 1], ['prism', 1]], outputs: [['dynamo', 1]], time: 8, tech: 'P8' },
  paradox: { id: 'paradox', name: 'Paradox', machine: 'fabricator', inputs: [['lens', 1], ['dynamo', 1], ['breeze', 4]], outputs: [['paradox', 1]], time: 12, tech: 'P9' },
};

export const RECIPE_IDS = Object.keys(RECIPES);

export type NodeType =
  | 'well' | 'refiner' | 'assembler' | 'fabricator'
  | 'router' | 'merger' | 'silo' | 'market' | 'lab' | 'void';

export type Track = 'speed' | 'eff' | 'buffer';

export interface NodeDef {
  type: NodeType;
  name: string;
  base: number;
  growth: number;
  tech?: string;
  firstFree?: boolean;
  tracks: Track[];
  verb: string;
  blurb: string;
}

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  well: { type: 'well', name: 'Well', base: 10, growth: 1.15, tracks: ['speed'], verb: 'extract', blurb: 'Extracts a raw material. Must sit on a deposit.' },
  refiner: { type: 'refiner', name: 'Refiner', base: 50, growth: 1.15, tech: 'P1', tracks: ['speed', 'eff', 'buffer'], verb: 'refine', blurb: 'One input in, something better out.' },
  assembler: { type: 'assembler', name: 'Assembler', base: 600, growth: 2.5, tech: 'P4', tracks: ['speed', 'eff', 'buffer'], verb: 'assemble', blurb: 'Combines two inputs.' },
  fabricator: { type: 'fabricator', name: 'Fabricator', base: 7100, growth: 1.15, tech: 'P7', tracks: ['speed', 'eff', 'buffer'], verb: 'fabricate', blurb: 'Combines up to three inputs.' },
  router: { type: 'router', name: 'Router', base: 25, growth: 1.1, tech: 'L1', tracks: [], verb: 'split', blurb: 'Splits a stream by ratio, priority or filter.' },
  merger: { type: 'merger', name: 'Merger', base: 25, growth: 1.1, tech: 'L2', tracks: [], verb: 'merge', blurb: 'A junction: many wires in, one stream out.' },
  silo: { type: 'silo', name: 'Silo', base: 200, growth: 1.2, tech: 'L5', tracks: ['buffer'], verb: 'store', blurb: 'A big buffer that smooths bursts.' },
  market: { type: 'market', name: 'Market', base: 150, growth: 1.5, firstFree: true, tracks: [], verb: 'sell', blurb: 'Sells anything for credits. Full price up to each material\'s demand; the surplus sells cheap.' },
  lab: { type: 'lab', name: 'Lab', base: 100, growth: 1.3, tech: 'R1', tracks: ['speed'], verb: 'study', blurb: 'Turns items into Data for the tech tree.' },
  void: { type: 'void', name: 'Void', base: 0, growth: 1, tech: 'P2', tracks: [], verb: 'destroy', blurb: 'Destroys whatever arrives. Free.' },
};

export const HOTBAR: NodeType[] = ['well', 'refiner', 'assembler', 'fabricator', 'router', 'merger', 'silo', 'market', 'lab', 'void'];

/** Wire capacity (items/s) and upgrade price per tier. */
export const PIPES = [
  { name: 'Mk I', cap: 4, cost: 0 },
  { name: 'Mk II', cap: 8, cost: 20, tech: 'L3' },
  { name: 'Mk III', cap: 16, cost: 300, tech: 'L7' },
  { name: 'Mk IV', cap: 32, cost: 4000, tech: 'L8' },
];

export type DataTier = 'a' | 'b' | 'g';
export const DATA_NAMES: Record<DataTier, string> = { a: 'α', b: 'β', g: 'γ' };
export const DATA_COLORS: Record<DataTier, string> = { a: '#5EEAD4', b: '#C4A1FF', g: '#FF8FB1' };

/** Data produced by a Lab per item, by item tier. A material's own `study` amount, where it has one, replaces the amount. */
export const DATA_YIELD: { tier: DataTier; amount: number }[] = [
  { tier: 'a', amount: 1 },
  { tier: 'a', amount: 3 },
  { tier: 'b', amount: 5 },
  { tier: 'g', amount: 8 },
];

export type Branch = 'processing' | 'logistics' | 'commerce' | 'research' | 'scale';

export const BRANCHES: { id: Branch; name: string; sub: string; rows: number }[] = [
  { id: 'processing', name: 'Processing', sub: 'Materials & machines', rows: 2 },
  { id: 'logistics', name: 'Logistics', sub: 'Routing & pipes', rows: 3 },
  { id: 'commerce', name: 'Commerce', sub: 'Prices & demand', rows: 1 },
  { id: 'research', name: 'Research', sub: 'Labs & offline', rows: 2 },
  { id: 'scale', name: 'Scale tools', sub: 'Big-factory help', rows: 1 },
];

export interface Tech {
  id: string;
  name: string;
  branch: Branch;
  col: number;
  row: number;
  cost: Partial<Record<DataTier, number>>;
  requires: string[];
  desc: string;
  unlocks: string[];
  /** Granted by a goal instead of bought; the text says which one. Never purchasable. */
  auto?: string;
  /** Hidden and not researchable until the demo has ended (first Lens). */
  needsEnd?: boolean;
}

const T = (
  id: string, name: string, branch: Branch, col: number, row: number,
  cost: Partial<Record<DataTier, number>>, requires: string[], desc: string, unlocks: string[],
  extra: Pick<Tech, 'auto' | 'needsEnd'> = {},
): Tech => ({ id, name, branch, col, row, cost, requires, desc, unlocks, ...extra });

/**
 * Tech prices as tuned with the pacing bot (`npm run pacing`, docs/CONTENT.md). The reasoning, so that the
 * next change keeps it:
 *  - The Processing spine the goal chain asks for (P2 → P3 → P4 → P5 → P7) is priced for the newcomer who
 *    does what the goal card says and follows the adviser's tips (src/advice.ts): each of its waits is three
 *    to three and a half minutes for that player, never four, and together they put the first Lens between
 *    20 and 25 minutes. The tips about double that player's α, so without them the same prices are a wait of
 *    seven to twenty minutes each: the spine is not priced for a player who ignores the adviser.
 *  - Ember Deposits is the cheap one because a fast player has nothing else to do while it is saved for:
 *    past about 220 α their hands are idle for more than a minute.
 *  - Side techs are impulse buys: cheap next to the spine tech they compete with, so every kind of player
 *    picks them up along the way. α for what is useful before the first Glyph (Lab Speed, Merger, Pipes
 *    Mk II: 150 α together), β after it. Wider Demand is β for that reason: nothing sells over demand before
 *    the first Glyph, and at 200 α it cost a fast player most of a minute there.
 *  - Anything that only matters after the demo costs γ, which does not exist before the first Lens, and the
 *    late Processing techs need all three kinds of Data, so studying Tier 1 items never stops paying.
 * P1, R1, L1, C1 and S1 are goal rewards (src/goals.ts) and cannot be bought. S1 (Bulk Upgrade) comes with
 * "Fill three orders", just before the save for the Fabricator, so nobody has to press Upgrade a hundred
 * times on a phone; upgrades are not balanced around dozens of tiny purchases.
 */
export const TECHS: Record<string, Tech> = Object.fromEntries([
  // Processing
  T('P1', 'Refining', 'processing', 0, 0, {}, [], 'Your first machine. Turn raw Glint into Shard, which sells for more.', ['Refiner', 'Recipe: 2 Glint → Shard'], { auto: 'Reward for the goal “Wire it to the Market too”' }),
  T('P2', 'Murk Deposits', 'processing', 1, 0, { a: 45 }, ['R1'], 'Extract Murk and refine it into Ink. It leaves Silt behind, so you also get the Void to dump it.', ['Murk Wells', 'Recipe: 2 Murk → Ink + Silt', 'Void node']),
  T('P3', 'Ember Deposits', 'processing', 2, 0, { a: 215 }, ['P2'], 'Extract Ember and refine it into Spark.', ['Ember Wells', 'Recipe: 2 Ember → Spark']),
  T('P4', 'Assembly', 'processing', 3, 0, { a: 1140 }, ['P3'], 'Machines with two inputs. Ink and Spark make Glyph, your first Tier 2 item and the source of β Data.', ['Assembler', 'Recipe: Ink + Spark → Glyph']),
  T('P5', 'Breeze Deposits', 'processing', 4, 0, { a: 1420 }, ['P4'], 'Extract Breeze, refine it into Mist, and combine Mist with Shard into Prism.', ['Breeze Wells', 'Recipe: 2 Breeze → Mist', 'Recipe: 2 Shard + Mist → Prism']),
  T('P7', 'Fabrication', 'processing', 5, 0, { a: 1180, b: 100 }, ['P5'], 'Three-input machines. Prism and Glyph become Lens, the first Tier 3 item and the source of γ Data.', ['Fabricator', 'Recipe: Prism + 2 Glyph → Lens']),
  T('P9', 'Paradox', 'processing', 6, 0, { a: 2500, b: 500, g: 450 }, ['P8'], 'The capstone. Lens, Dynamo and raw Breeze fold into a Paradox.', ['Recipe: Lens + Dynamo + 4 Breeze → Paradox']),
  // (Behind Assembly, not just Refining: it is priced in β, and Assembly is what brings the first β. Researchable
  // from the first visit to the tree, it sat there for ten minutes with "no β yet".)
  T('U1', 'Efficiency Tuning', 'processing', 1, 1, { b: 40 }, ['P1', 'P4'], 'A new upgrade track for machines: some crafts consume no inputs.', ['Efficiency upgrades on machines']),
  T('U2', 'Overclock', 'processing', 2, 1, { g: 60 }, ['U1'], 'Raises the level cap on Speed upgrades from 10 to 25.', ['Speed level cap 25']),
  T('P6', 'Reclamation', 'processing', 4, 1, { a: 300, g: 25 }, ['P4'], 'Turn Silt, the byproduct clogging your Ink line, into Clay, then into Coil.', ['Recipe: 3 Silt → Clay', 'Recipe: Spark + 2 Clay → Coil']),
  T('P8', 'Dynamo', 'processing', 5, 1, { a: 1200, b: 300, g: 100 }, ['P6', 'P7'], 'Coil, Glyph and Prism spin up a Dynamo.', ['Recipe: 2 Coil + Glyph + Prism → Dynamo']),
  // Logistics
  T('L1', 'Routing', 'logistics', 1, 0, {}, ['R1'], 'A Router splits one stream across several wires by weight, when an even split is not what you want.', ['Router node', 'Ratio mode'], { auto: 'Reward for the goal “Fill your first order”' }),
  T('L3', 'Pipes Mk II', 'logistics', 2, 0, { a: 60 }, ['L1'], 'Wires can be upgraded to carry 8 items per second.', ['Mk II wires (8/s)']),
  T('L7', 'Pipes Mk III', 'logistics', 3, 0, { b: 60 }, ['L3'], 'Wires can be upgraded to carry 16 items per second.', ['Mk III wires (16/s)']),
  T('L8', 'Pipes Mk IV', 'logistics', 4, 0, { g: 150 }, ['L7'], 'Wires can be upgraded to carry 32 items per second.', ['Mk IV wires (32/s)']),
  T('L4', 'Priority Routing', 'logistics', 2, 1, { b: 20 }, ['L1'], 'Routers can fill their first wire completely before anything overflows to the next.', ['Router: Priority mode']),
  T('L6', 'Filter Routing', 'logistics', 3, 1, { b: 30 }, ['L4'], 'Routers can send each material down its own wire, which untangles mixed streams.', ['Router: Filter mode']),
  T('L2', 'Merger', 'logistics', 2, 2, { a: 40 }, ['L1'], 'A junction node that gathers many wires into one tidy stream.', ['Merger node']),
  T('L5', 'Silo', 'logistics', 3, 2, { b: 15 }, ['L2'], 'A large buffer that keeps machines fed through uneven supply.', ['Silo node']),
  // Commerce
  T('C1', 'Market Lens', 'commerce', 1, 0, {}, ['R1'], 'See live prices and how much of each material your Markets buy at full price.', ['Price gauges on Markets'], { auto: 'Reward for the goal “Fill your first order”' }),
  T('C2', 'Wider Demand', 'commerce', 2, 0, { b: 40 }, ['C1'], 'Markets buy 50% more of everything at full price.', ['+50% demand, all materials']),
  T('C4', 'Luxury Buyers', 'commerce', 3, 0, { b: 300 }, ['C2'], 'Tier 2 and Tier 3 items sell for 25% more.', ['+25% value on T2 and T3']),
  T('C5', 'Exports', 'commerce', 4, 0, { g: 80 }, ['C4'], 'Markets buy twice as much of everything at full price.', ['+100% demand, all materials']),
  // Research
  T('R1', 'Lab', 'research', 0, 0, {}, [], 'Send items to a Lab instead of a Market to earn Data, the currency of this tree.', ['Lab node', 'Tech tree'], { auto: 'Reward for the goal “Sell your first Shard”' }),
  T('R2', 'Lab Speed', 'research', 1, 0, { a: 50 }, ['R1'], 'Labs study items twice as fast.', ['Labs 2× speed']),
  T('R3', 'Deep Analysis', 'research', 2, 0, { b: 80 }, ['R2'], 'Every item studied yields 50% more Data.', ['+50% Data per item']),
  T('R4', 'Long Absence', 'research', 1, 1, { a: 210 }, ['R1'], 'Your supply line keeps earning for up to 8 hours while you are away, instead of 2.', ['Offline cap 2h → 8h'], { needsEnd: true }),
  // Scale tools
  T('S1', 'Bulk Upgrade', 'scale', 1, 0, {}, ['L1'], 'Upgrade every node of the same kind with one click.', ['"Upgrade all" button'], { auto: 'Reward for the goal “Fill three orders”' }),
  T('S3', 'Auto-balance', 'scale', 2, 0, { b: 50 }, ['S1', 'L4'], 'One click sets a Router\'s weights to match what each destination can actually use.', ['Router: Auto-balance']),
].map((t) => [t.id, t]));

export const TECH_IDS = Object.keys(TECHS);

/** Deposits revealed by each board expansion, in order (cycles after the end). */
export const EXPANSION_DEPOSITS: MatId[][] = [
  ['glint', 'murk'],
  ['ember', 'glint'],
  ['breeze', 'murk'],
  ['glint', 'ember'],
  ['breeze', 'glint'],
  ['murk', 'ember', 'breeze'],
];

// =====================================================================================
// RULES: tunables. The rules are docs/PITCH_PLAN.md section 2; the numbers were tuned with `npm run pacing`.
// (Prices are in the tables above, goal rewards and wording in src/goals.ts.)
// =====================================================================================

/** Relative worth of one unit of each Data tier. Used to convert order pay between tiers. */
export const DATA_WORTH: Record<DataTier, number> = { a: 1, b: 4, g: 12 };

export const RULES = {
  /** Making this material for the first time ends the demo. */
  capstone: 'lens' as MatId,

  /**
   * Wires. A wire's capacity (PIPES) is items per second averaged over this many seconds, not a hard limit
   * per tick: unused capacity carries over for that long. A machine hands over whole items at once; with a
   * per-tick limit only a sliver of each item fitted down the wire to the next machine and the rest spilled to
   * the Market on the same port, which left that machine starved although everything it needed was being made
   * (2.1: machines are fed first). The long-run rate through a wire is still its capacity.
   */
  wires: {
    burstSeconds: 1,
    /**
     * How a wire's displayed rate (wire.rate) is measured. Nothing in the simulation reads it.
     * A machine takes its inputs in gulps, so a plain moving average of what passes swings by a third around
     * the true rate. Instead whole gulps are measured, from one start of flow to the next, and the rate shown
     * is items over seconds across the gulps that make up one round of the pattern: exact for any pattern
     * that repeats, close for one that does not.
     */
    rate: {
      /** Seconds of smoothing on the displayed number. */
      smooth: 1.5,
      /**
       * How many whole gulps are remembered. A pattern that repeats within half of them is measured exactly:
       * a machine with Efficiency skips its inputs on every third to sixth craft, which makes a round of up to
       * a dozen gulps on the wire that feeds it.
       */
      gulps: 32,
      /**
       * A round must hold over the gulps of the last this many seconds before it is believed. With no repeat
       * found, the most recent gulps that together last at least this long are averaged.
       */
      window: 8,
      /** Flow that has not paused for this long is steady, not a gulp: it is measured directly. */
      steadyAfter: 8,
      /** A gulp longer than this is not a pattern worth waiting for. */
      longest: 30,
      /** The next gulp is overdue after this many times the longest remembered one: the pattern is dropped. */
      overdue: 1.5,
    },
  },

  /**
   * 2.1 Fan-out: "machines are fed first; what is left goes on to selling and study".
   * A plain port feeds machines first. A Router, Merger or Silo counts as a machine when any path from it
   * leads to one; a junction whose every path ends at Markets, Labs, Silos, Voids or nowhere waits with the
   * Markets, Labs and Voids and shares what the machines leave.
   *
   * `deadEndJunctionsLast` is that last clause. It is on: the goal chain has the player hang a Router to a
   * Lab and a Market on a machine's port, and served first it took half of what the Assembler built on that
   * port later needed. Off gives the first reading of the plan (every junction is served with the machines);
   * it is kept as a switch for what-if runs (`npm run pacing -- --set=rules.fanOut.deadEndJunctionsLast=0`).
   */
  fanOut: { deadEndJunctionsLast: true },

  /** The one-press Router preset (favour() in src/actions.ts): Ratio mode, this weight on the chosen wire and `rest` on the others. */
  router: { favour: 3, rest: 1 },

  /** 2.2 Demand: full price up to a material's demand rate, a flat share of it for the surplus. */
  demand: {
    /** Surplus price as a share of the full price. */
    surplusShare: 0.25,
    /** Unused demand is banked for this many seconds, so machines that deliver in bursts are not short-changed... */
    burstSeconds: 8,
    /** ...and never for fewer items than this (one Paradox every 12 s must still sell whole at full price). */
    minBurst: 1,
    /**
     * The first time a material keeps selling over its demand for `seconds` (surplus sales no more than `gap`
     * apart), g.seenSurplus is set and a 'surplus' event raised: the interface introduces the demand gauge then.
     * The gap is longer than the slowest craft (a Paradox takes 12 s): a machine hands over whole items, so a
     * line that is over demand makes one surplus sale per craft, seconds apart, for as long as it runs.
     */
    notice: { seconds: 3, gap: 13 },
  },

  /** 2.3 Flow. */
  flow: {
    /** A Well or machine counts once it is this many seconds old (since built, or since its recipe was changed). */
    minAge: 20,
    /** Utilisation at or above this is "flowing". */
    flowing: 0.9,
    /** Seconds of smoothing on the displayed value. */
    smooth: 3,
    /** Once unlocked, sales pay × (1 + bonus × flow). */
    bonus: 0.2,
    /** Flow State: the raw share stays at 100% for this many seconds... */
    stateSeconds: 10,
    /** ...with at least this many counted producers. */
    stateProducers: 6,
    /**
     * The "hold Flow" goal: smoothed Flow at or above this share... On a board of fewer than nineteen
     * producers that is all of them. A newcomer arrives with seven of nine or nine of ten flowing (the Spark
     * Refiner is short of Ember, sometimes the Ink Refiner of Murk) and has to find and fix what is not: at
     * 75% the goal completed by itself, and at 90% it still did for anyone with ten producers.
     */
    holdShare: 0.95,
    /** ...for this many seconds. */
    holdSeconds: 10,
  },

  /** 2.4 Goal thresholds that are numbers rather than events (the Flow goal's are in `flow` above). */
  goals: {
    /**
     * "Study Glyph for β": this much β in hand. About a minute of one Assembler's Glyph in a Lab: a goal with
     * something to watch, between the first Glyph and the wait for Breeze Deposits.
     */
    studyBeta: 40,
  },

  /** 2.5 Orders. */
  orders: {
    /** Starting seed for order generation; the running seed is saved with the game. */
    seed: 0x5eed1e55,
    /** An order asks for between this many... */
    minSeconds: 45,
    /** ...and this many seconds of what currently reaches Markets of that material... */
    maxSeconds: 90,
    /** ...but never fewer items than this. */
    minNeed: 8,
    /**
     * Until the player has filled an order: something that is already selling, sized to this many seconds of it
     * (so it fills in 30 to 40 s with nothing rerouted), and at least `minNeed` items.
     */
    first: { seconds: [32, 37] as [number, number], minNeed: 3 },
    /** A material counts as "currently produced", or as reaching a Market, above this rate (items/s). */
    minRate: 0.02,
    /** orderView: the ordered material "reaches a Market" while its smoothed sales stay above this rate (items/s)... */
    sellingRate: 0.005,
    /** ...or for this many seconds after the order's last delivery, so that a slow trickle still counts. */
    sellingMemory: 30,
    /** Materials worth less than this are never asked for (Silt). */
    junkValue: 1,
    /** Chance of asking for the newest, second-newest and third-newest material the player makes. */
    pick: [0.55, 0.3, 0.15],
    /** Credits paid, as a share of the order's value at full price. */
    creditShare: 0.5,
    /** The same, when no Data is paid because nothing is left to research. */
    creditShareNoData: 1,
    /** Data paid, as a share of what studying the delivered items in a Lab would yield (converted with DATA_WORTH). */
    dataShare: 1,
    /**
     * The share of that which survives when the pay is in another kind of Data than the items would give in a
     * Lab (Glyph is β in a Lab; an order that pays α for it converts). At 1 a single Glyph order paid 400 α,
     * two minutes of a newcomer's Labs in one lump, and which material the next order happened to ask for
     * decided the pace of a run: the same player reached the Lens up to three minutes apart.
     */
    convertShare: 0.25,
    /** An unfilled order with no deliveries for this long is quietly replaced. */
    staleSeconds: 120,
  },

  /** 2.7 Time away. Pays nothing until the demo has ended. */
  away: {
    /** Share of the live rate that is paid. */
    share: 0.5,
    capHours: 2,
    /** With Long Absence (R4). */
    capHoursLong: 8,
    /** The estimate runs a copy of the game this long to settle, then measures for `sample` seconds. */
    warmup: 90,
    sample: 60,
    step: 0.1,
  },

  /** Board expansion number n (0-based) costs base × growth^n: 200, 500, 1,250, 3,125... */
  expansion: { base: 200, growth: 2.5 },

  /**
   * Upgrades. Level L of a track (0-based) costs its first-level price × growth^L; the tables give the
   * first-level price per node type (a type missing from a table falls back to `fallback` × its base price).
   * Speed is sized so that a first or second level pays for itself in one to three minutes when the extra
   * input exists (`npm run pacing` prints the table). Efficiency is a slower investment: three to five minutes.
   */
  upgrade: {
    growth: 1.6,
    speed: { well: 50, refiner: 32, assembler: 100, fabricator: 400, lab: 50 } as Partial<Record<NodeType, number>>,
    eff: { refiner: 75, assembler: 300, fabricator: 1200 } as Partial<Record<NodeType, number>>,
    buffer: { refiner: 20, assembler: 80, fabricator: 320, silo: 80 } as Partial<Record<NodeType, number>>,
    fallback: 0.5,
  },
};

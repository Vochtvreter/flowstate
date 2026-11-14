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
}

export const MATERIALS: Record<MatId, Material> = {
  glint: { id: 'glint', name: 'Glint', tier: 0, value: 1, demand: 2, color: '#FFD84D' },
  murk: { id: 'murk', name: 'Murk', tier: 0, value: 1, demand: 2, color: '#A78BFA', tech: 'P2' },
  ember: { id: 'ember', name: 'Ember', tier: 0, value: 2, demand: 1.5, color: '#FF8A3D', tech: 'P3' },
  breeze: { id: 'breeze', name: 'Breeze', tier: 0, value: 2, demand: 1.5, color: '#5CE1FF', tech: 'P5' },
  shard: { id: 'shard', name: 'Shard', tier: 1, value: 3, demand: 1.5, color: '#B8F26B' },
  ink: { id: 'ink', name: 'Ink', tier: 1, value: 4, demand: 1.2, color: '#6F93FF' },
  silt: { id: 'silt', name: 'Silt', tier: 1, value: 0.5, demand: 0.5, color: '#C2C8D2' },
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
  assembler: { type: 'assembler', name: 'Assembler', base: 400, growth: 1.15, tech: 'P4', tracks: ['speed', 'eff', 'buffer'], verb: 'assemble', blurb: 'Combines two inputs.' },
  fabricator: { type: 'fabricator', name: 'Fabricator', base: 3000, growth: 1.15, tech: 'P7', tracks: ['speed', 'eff', 'buffer'], verb: 'fabricate', blurb: 'Combines up to three inputs.' },
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

/** Data produced by a Lab per item, by item tier. */
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
 * Tech prices are the pacing bot's "proposed" numbers (see docs/PITCH_PLAN.md 2.6).
 * P1, R1, L1 and C1 are goal rewards (src/goals.ts) and cannot be bought.
 */
export const TECHS: Record<string, Tech> = Object.fromEntries([
  // Processing
  T('P1', 'Refining', 'processing', 0, 0, {}, [], 'Your first machine. Turn raw Glint into Shard, which sells for more.', ['Refiner', 'Recipe: 2 Glint → Shard'], { auto: 'Reward for the goal “Wire it to the Market too”' }),
  T('P2', 'Murk Deposits', 'processing', 1, 0, { a: 45 }, ['R1'], 'Extract Murk and refine it into Ink. It leaves Silt behind, so you also get the Void to dump it.', ['Murk Wells', 'Recipe: 2 Murk → Ink + Silt', 'Void node']),
  T('P3', 'Ember Deposits', 'processing', 2, 0, { a: 150 }, ['P2'], 'Extract Ember and refine it into Spark.', ['Ember Wells', 'Recipe: 2 Ember → Spark']),
  T('P4', 'Assembly', 'processing', 3, 0, { a: 1000 }, ['P3'], 'Machines with two inputs. Ink and Spark make Glyph, your first Tier 2 item and the source of β Data.', ['Assembler', 'Recipe: Ink + Spark → Glyph']),
  T('P5', 'Breeze Deposits', 'processing', 4, 0, { a: 1500 }, ['P4'], 'Extract Breeze, refine it into Mist, and combine Mist with Shard into Prism.', ['Breeze Wells', 'Recipe: 2 Breeze → Mist', 'Recipe: 2 Shard + Mist → Prism']),
  T('P7', 'Fabrication', 'processing', 5, 0, { a: 2000, b: 800 }, ['P5'], 'Three-input machines. Prism and Glyph become Lens, the first Tier 3 item and the source of γ Data.', ['Fabricator', 'Recipe: Prism + 2 Glyph → Lens']),
  T('P9', 'Paradox', 'processing', 6, 0, { b: 700, g: 400 }, ['P8'], 'The capstone. Lens, Dynamo and raw Breeze fold into a Paradox.', ['Recipe: Lens + Dynamo + 4 Breeze → Paradox']),
  T('U1', 'Efficiency Tuning', 'processing', 1, 1, { a: 310 }, ['P1'], 'A new upgrade track for machines: some crafts consume no inputs.', ['Efficiency upgrades on machines']),
  T('U2', 'Overclock', 'processing', 2, 1, { b: 180 }, ['U1'], 'Raises the level cap on Speed upgrades from 10 to 25.', ['Speed level cap 25']),
  T('P6', 'Reclamation', 'processing', 4, 1, { a: 300, b: 30 }, ['P4'], 'Turn Silt, the byproduct clogging your Ink line, into Clay, then into Coil.', ['Recipe: 3 Silt → Clay', 'Recipe: Spark + 2 Clay → Coil']),
  T('P8', 'Dynamo', 'processing', 5, 1, { b: 400, g: 80 }, ['P6', 'P7'], 'Coil, Glyph and Prism spin up a Dynamo.', ['Recipe: 2 Coil + Glyph + Prism → Dynamo']),
  // Logistics
  T('L1', 'Routing', 'logistics', 1, 0, {}, ['R1'], 'A Router splits one stream across several wires by weight, when an even split is not what you want.', ['Router node', 'Ratio mode'], { auto: 'Reward for the goal “Fill your first order”' }),
  T('L3', 'Pipes Mk II', 'logistics', 2, 0, { a: 190 }, ['L1'], 'Wires can be upgraded to carry 8 items per second.', ['Mk II wires (8/s)']),
  T('L7', 'Pipes Mk III', 'logistics', 3, 0, { b: 150 }, ['L3'], 'Wires can be upgraded to carry 16 items per second.', ['Mk III wires (16/s)']),
  T('L8', 'Pipes Mk IV', 'logistics', 4, 0, { g: 200 }, ['L7'], 'Wires can be upgraded to carry 32 items per second.', ['Mk IV wires (32/s)']),
  T('L4', 'Priority Routing', 'logistics', 2, 1, { a: 270 }, ['L1'], 'Routers can fill their first wire completely before anything overflows to the next.', ['Router: Priority mode']),
  T('L6', 'Filter Routing', 'logistics', 3, 1, { a: 400, b: 60 }, ['L4'], 'Routers can send each material down its own wire, which untangles mixed streams.', ['Router: Filter mode']),
  T('L2', 'Merger', 'logistics', 2, 2, { a: 100 }, ['L1'], 'A junction node that gathers many wires into one tidy stream.', ['Merger node']),
  T('L5', 'Silo', 'logistics', 3, 2, { a: 170 }, ['L2'], 'A large buffer that keeps machines fed through uneven supply.', ['Silo node']),
  // Commerce
  T('C1', 'Market Lens', 'commerce', 1, 0, {}, ['R1'], 'See live prices and how much of each material your Markets buy at full price.', ['Price gauges on Markets'], { auto: 'Reward for the goal “Fill your first order”' }),
  T('C2', 'Wider Demand', 'commerce', 2, 0, { a: 240 }, ['C1'], 'Markets buy 50% more of everything at full price.', ['+50% demand, all materials']),
  T('C4', 'Luxury Buyers', 'commerce', 3, 0, { b: 200 }, ['C2'], 'Tier 2 and Tier 3 items sell for 25% more.', ['+25% value on T2 and T3']),
  T('C5', 'Exports', 'commerce', 4, 0, { g: 60 }, ['C4'], 'Markets buy twice as much of everything at full price.', ['+100% demand, all materials']),
  // Research
  T('R1', 'Lab', 'research', 0, 0, {}, [], 'Send items to a Lab instead of a Market to earn Data, the currency of this tree.', ['Lab node', 'Tech tree'], { auto: 'Reward for the goal “Sell your first Shard”' }),
  T('R2', 'Lab Speed', 'research', 1, 0, { a: 80 }, ['R1'], 'Labs study items twice as fast.', ['Labs 2× speed']),
  T('R3', 'Deep Analysis', 'research', 2, 0, { b: 100 }, ['R2'], 'Every item studied yields 50% more Data.', ['+50% Data per item']),
  T('R4', 'Long Absence', 'research', 1, 1, { a: 210 }, ['R1'], 'Your supply line keeps earning for up to 8 hours while you are away, instead of 2.', ['Offline cap 2h → 8h'], { needsEnd: true }),
  // Scale tools
  T('S1', 'Bulk Upgrade', 'scale', 1, 0, { a: 210 }, ['L1'], 'Upgrade every node of the same kind with one click.', ['"Upgrade all" button']),
  T('S3', 'Auto-balance', 'scale', 2, 0, { b: 250 }, ['S1', 'L4'], 'One click sets a Router\'s weights to match what each destination can actually use.', ['Router: Auto-balance']),
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
// RULES: tunables. First-pass numbers from docs/PITCH_PLAN.md section 2; tune them here.
// (Prices are in the tables above, goal rewards and wording in src/goals.ts.)
// =====================================================================================

/** Relative worth of one unit of each Data tier. Used to convert order pay between tiers. */
export const DATA_WORTH: Record<DataTier, number> = { a: 1, b: 4, g: 12 };

export const RULES = {
  /** Making this material for the first time ends the demo. */
  capstone: 'lens' as MatId,

  /** 2.2 Demand: full price up to a material's demand rate, a flat share of it for the surplus. */
  demand: {
    /** Surplus price as a share of the full price. */
    surplusShare: 0.25,
    /** Unused demand is banked for this many seconds, so machines that deliver in bursts are not short-changed... */
    burstSeconds: 8,
    /** ...and never for fewer items than this (one Paradox every 12 s must still sell whole at full price). */
    minBurst: 1,
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
    /** The "hold Flow" goal: smoothed Flow at or above this share... */
    holdShare: 0.75,
    /** ...for this many seconds. */
    holdSeconds: 10,
  },

  /** 2.5 Orders. */
  orders: {
    /** Starting seed for order generation; the running seed is saved with the game. */
    seed: 0x5eed1e55,
    /** An order asks for between this many... */
    minSeconds: 45,
    /** ...and this many seconds of the material's current output... */
    maxSeconds: 90,
    /** ...but never fewer items than this. */
    minNeed: 8,
    /** A material counts as "currently produced" above this output (items/s). */
    minRate: 0.02,
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

  /** Board expansion number n (0-based) costs base × growth^n. */
  expansion: { base: 100, growth: 2.2 },

  /** Upgrade level L of a track costs share × max(minBase, node base price) × growth^L. */
  upgrade: { growth: 1.6, minBase: 10, speed: 0.5, eff: 1.5, buffer: 0.4 },
};

// All game content as plain data, plus RULES: every tunable number that is not a content table.
// Goal rewards and wording live in src/goals.ts.
//
// The names are things everyone knows: a Phone is made of Sand, Oil, Ore and Quartz, by way of Glass, Plastic,
// Copper and Silicon, a Screen and two Circuits. A player can guess what a recipe needs and see why a line stands
// still. The ids are older than the names (the materials were first called Glint, Murk, Ember...), and they are
// kept: saves hold them, and the rules and the tests are written in them. In the code an id is lower case
// ('glint'), and a name in a sentence or a comment is the one the player reads (Sand):
//
//   glint  Sand      shard  Glass      prism  Screen     lens     Phone
//   murk   Oil       ink    Plastic    glyph  Circuit    dynamo   Laptop
//   ember  Ore       silt   Tar        coil   Cable      paradox  Robot
//   breeze Quartz    spark  Copper
//                    mist   Silicon    The node type 'well' is the Drill, 'void' the Dump.
//                    clay   Rubber
//
// No name is longer than seven letters: the adviser's sentences are measured with the longest (tests/advice.test.ts).

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
  /** Tech needed before a Drill can extract it (raw materials only). */
  tech?: string;
  /** Data a Lab makes from one item, when that is not the usual amount for its tier (DATA_YIELD). */
  study?: number;
}

export const MATERIALS: Record<MatId, Material> = {
  glint: { id: 'glint', name: 'Sand', tier: 0, value: 1, demand: 2, color: '#FFD84D' },
  murk: { id: 'murk', name: 'Oil', tier: 0, value: 1, demand: 2, color: '#A78BFA', tech: 'P2' },
  ember: { id: 'ember', name: 'Ore', tier: 0, value: 2, demand: 1.5, color: '#FF8A3D', tech: 'P3' },
  breeze: { id: 'breeze', name: 'Quartz', tier: 0, value: 2, demand: 1.5, color: '#5CE1FF', tech: 'P5' },
  shard: { id: 'shard', name: 'Glass', tier: 1, value: 3, demand: 1.5, color: '#B8F26B' },
  ink: { id: 'ink', name: 'Plastic', tier: 1, value: 4, demand: 1.2, color: '#6F93FF' },
  // A by-product is poor study material: 1 α, not the 3 α of a refined item (three Tar make one Rubber, which is worth 3 α).
  silt: { id: 'silt', name: 'Tar', tier: 1, value: 0.5, demand: 0.5, color: '#C2C8D2', study: 1 },
  spark: { id: 'spark', name: 'Copper', tier: 1, value: 6, demand: 1, color: '#FF5A4E' },
  mist: { id: 'mist', name: 'Silicon', tier: 1, value: 6, demand: 1, color: '#3FD6B5' },
  clay: { id: 'clay', name: 'Rubber', tier: 1, value: 3, demand: 0.8, color: '#C08A5B' },
  prism: { id: 'prism', name: 'Screen', tier: 2, value: 24, demand: 0.6, color: '#E0C3FF' },
  glyph: { id: 'glyph', name: 'Circuit', tier: 2, value: 20, demand: 0.6, color: '#FF5ACD' },
  coil: { id: 'coil', name: 'Cable', tier: 2, value: 22, demand: 0.5, color: '#E59A57' },
  lens: { id: 'lens', name: 'Phone', tier: 3, value: 130, demand: 0.25, color: '#FFFFFF' },
  dynamo: { id: 'dynamo', name: 'Laptop', tier: 3, value: 180, demand: 0.2, color: '#4FC3FF' },
  paradox: { id: 'paradox', name: 'Robot', tier: 3, value: 750, demand: 0.1, color: '#F0ABFC' },
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
  shard: { id: 'shard', name: 'Glass', machine: 'refiner', inputs: [['glint', 2]], outputs: [['shard', 1]], time: 2, tech: 'P1' },
  ink: { id: 'ink', name: 'Plastic', machine: 'refiner', inputs: [['murk', 2]], outputs: [['ink', 1], ['silt', 1]], time: 2, tech: 'P2' },
  spark: { id: 'spark', name: 'Copper', machine: 'refiner', inputs: [['ember', 2]], outputs: [['spark', 1]], time: 2, tech: 'P3' },
  mist: { id: 'mist', name: 'Silicon', machine: 'refiner', inputs: [['breeze', 2]], outputs: [['mist', 1]], time: 2, tech: 'P5' },
  clay: { id: 'clay', name: 'Rubber', machine: 'refiner', inputs: [['silt', 3]], outputs: [['clay', 1]], time: 3, tech: 'P6' },
  glyph: { id: 'glyph', name: 'Circuit', machine: 'assembler', inputs: [['ink', 1], ['spark', 1]], outputs: [['glyph', 1]], time: 3, tech: 'P4' },
  prism: { id: 'prism', name: 'Screen', machine: 'assembler', inputs: [['shard', 2], ['mist', 1]], outputs: [['prism', 1]], time: 4, tech: 'P5' },
  coil: { id: 'coil', name: 'Cable', machine: 'assembler', inputs: [['spark', 1], ['clay', 2]], outputs: [['coil', 1]], time: 4, tech: 'P6' },
  lens: { id: 'lens', name: 'Phone', machine: 'fabricator', inputs: [['prism', 1], ['glyph', 2]], outputs: [['lens', 1]], time: 6, tech: 'P7' },
  dynamo: { id: 'dynamo', name: 'Laptop', machine: 'fabricator', inputs: [['coil', 2], ['glyph', 1], ['prism', 1]], outputs: [['dynamo', 1]], time: 8, tech: 'P8' },
  paradox: { id: 'paradox', name: 'Robot', machine: 'fabricator', inputs: [['lens', 1], ['dynamo', 1], ['breeze', 4]], outputs: [['paradox', 1]], time: 12, tech: 'P9' },
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
  well: { type: 'well', name: 'Drill', base: 10, growth: 1.15, tracks: ['speed'], verb: 'extract', blurb: 'Brings up a raw material. Must sit on a deposit.' },
  refiner: { type: 'refiner', name: 'Refiner', base: 50, growth: 1.15, tech: 'P1', tracks: ['speed', 'eff', 'buffer'], verb: 'refine', blurb: 'Turns one material into a better one.' },
  assembler: { type: 'assembler', name: 'Assembler', base: 600, growth: 2.5, tech: 'P4', tracks: ['speed', 'eff', 'buffer'], verb: 'assemble', blurb: 'Puts two things together.' },
  fabricator: { type: 'fabricator', name: 'Fabricator', base: 5000, growth: 1.15, tech: 'P7', tracks: ['speed', 'eff', 'buffer'], verb: 'fabricate', blurb: 'Puts up to three things together.' },
  router: { type: 'router', name: 'Router', base: 25, growth: 1.1, tech: 'L1', tracks: [], verb: 'split', blurb: 'Splits a stream by ratio, priority or filter.' },
  merger: { type: 'merger', name: 'Merger', base: 25, growth: 1.1, tech: 'L2', tracks: [], verb: 'merge', blurb: 'A junction: many wires in, one stream out.' },
  silo: { type: 'silo', name: 'Silo', base: 200, growth: 1.2, tech: 'L5', tracks: ['buffer'], verb: 'store', blurb: 'A big buffer that smooths bursts.' },
  market: { type: 'market', name: 'Market', base: 150, growth: 1.5, firstFree: true, tracks: [], verb: 'sell', blurb: 'Sells anything for credits. Takes any number of wires.' },
  lab: { type: 'lab', name: 'Lab', base: 100, growth: 1.1, tech: 'R1', tracks: ['speed'], verb: 'study', blurb: 'Turns items into Data for the tech tree.' },
  void: { type: 'void', name: 'Dump', base: 0, growth: 1, tech: 'P2', tracks: [], verb: 'destroy', blurb: 'Takes away whatever arrives. Free.' },
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
  { id: 'scale', name: 'Scale tools', sub: 'Big-factory help', rows: 2 },
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
  /** Hidden and not researchable until the demo has ended (first Phone). */
  needsEnd?: boolean;
  /**
   * Hidden and not researchable until demand has shown itself: something has sold over its demand
   * (g.seenSurplus), or the save already owns Market Lens from before that rule (demandShown in src/economy.ts).
   */
  needsSurplus?: boolean;
}

const T = (
  id: string, name: string, branch: Branch, col: number, row: number,
  cost: Partial<Record<DataTier, number>>, requires: string[], desc: string, unlocks: string[],
  extra: Pick<Tech, 'auto' | 'needsEnd' | 'needsSurplus'> = {},
): Tech => ({ id, name, branch, col, row, cost, requires, desc, unlocks, ...extra });

/**
 * Tech prices as tuned with the pacing bot (`npm run pacing`, docs/CONTENT.md). The reasoning, so that the
 * next change keeps it:
 *  - The Processing spine the goal chain asks for (P2 → P3 → P4 → P5 → P7) is priced for the newcomer who
 *    does what the goal card says, its "while you wait" lines included (Goal.meanwhile in src/goals.ts), so that
 *    the card keeps that player busy: nothing to do for at most 30% of the time to the first Phone, never for
 *    more than a minute at a stretch, never more than 75 s on one goal, and the first Phone at 17:30–21:00
 *    (the pacing rule: where a later first Phone would cost waits with nothing to do in them, the waits are
 *    kept short; `npm run pacing`, policy cardonly). The fast players are the floor (no first Phone before
 *    14:00), so the spine could not simply come down. What came
 *    down is what the card's player pays for and the fast players hardly do: the Labs of the lines (×1.1 a Lab,
 *    it was ×1.3) and the Fabricator; and "Make and sell Silicon" has a line for Lab Speed and Deep Analysis
 *    (the fast players buy Deep Analysis after Quartz Deposits, never before it). Assembly is 1,325α, Quartz
 *    Deposits 1,875α. (A player who reads only the hints and ignores the lines still needs most of an hour:
 *    the spine is not priced for that.)
 *  - Fabrication's α is the one spine price that is lower than the rest of the curve would suggest: by then
 *    the two Assemblers take the Glass, Plastic and Copper the Labs were studying, and a newcomer's α income falls
 *    by a third. At 720 α the card's last wait is for the Fabricator's credits, not for the research, for the
 *    card player who takes the adviser's tips and for the one who takes none (`npm run pacing`, policies
 *    newcomer and cardonly): that is what makes the card's line for that wait true ("cut the wire from the
 *    Circuit Assembler to the Lab", tests/meanwhile.test.ts). At 900 α the player who takes no tip had the
 *    Fabricator's price in hand before the research on every seed, and the line was worth nothing to them.
 *    The fast players wait for the Fabricator's credits whatever this costs, so it does not move their Phone.
 *  - Ore Deposits is the cheap one because a fast player has nothing else to do while it is saved for:
 *    past about 220 α their hands are idle for more than a minute. At 195α the card player's wait for it is
 *    under a minute (51–56 s); Oil Deposits at 40α keeps a player who claims at once within 30 s on goal 8.
 *  - Robot's α (2,800) keeps the fast players' first Robot after 24:00, now that their Phone comes sooner.
 *  - Side techs are impulse buys: cheap next to the spine tech they compete with, so every kind of player
 *    picks them up along the way. α for what is useful before the first Circuit (Lab Speed, Merger, Pipes
 *    Mk II: 150 α together), β after it. Wider Demand is β for that reason: nothing sells over demand before
 *    the first Circuit, and at 200 α it cost a fast player most of a minute there.
 *  - Anything that only matters after the demo costs γ, which does not exist before the first Phone, and the
 *    late Processing techs need all three kinds of Data, so studying Tier 1 items never stops paying.
 * P1, R1, L1 and S1 are goal rewards (src/goals.ts) and cannot be bought. S1 (Bulk Upgrade) comes with
 * "Make your first Screen", and the next goal has the player press it once ("Upgrade all your Drills at
 * once"), just before the save for the Fabricator, so nobody has to press Upgrade a hundred times on a phone;
 * upgrades are not balanced around dozens of tiny purchases.
 *
 * The Commerce branch is about demand, and demand stays out of sight until it bites: selling over demand
 * did not happen before the first Phone in 60 scripted runs, so a price gauge handed out at minute 7 was a
 * reward for nothing. C1 (Market Lens) cannot be bought either: the game grants it the first time something
 * sells over its demand (g.seenSurplus, src/sim.ts), and until then the whole branch is hidden (`needsSurplus`).
 */
export const TECHS: Record<string, Tech> = Object.fromEntries([
  // Processing
  T('P1', 'Refining', 'processing', 0, 0, {}, [], 'Your first machine. It melts Sand into Glass, which sells for more.', ['Refiner', 'Recipe: 2 Sand → Glass'], { auto: 'Reward for the goal “Sell that Sand too”' }),
  T('P2', 'Oil Deposits', 'processing', 1, 0, { a: 40 }, ['R1'], 'Drill for Oil and refine it into Plastic. That leaves Tar behind, so you also get the Dump to take it away.', ['Oil Drills', 'Recipe: 2 Oil → Plastic + Tar', 'Dump node']),
  T('P3', 'Ore Deposits', 'processing', 2, 0, { a: 195 }, ['P2'], 'Drill for Ore and refine it into Copper.', ['Ore Drills', 'Recipe: 2 Ore → Copper']),
  T('P4', 'Assembly', 'processing', 3, 0, { a: 1325 }, ['P3'], 'Machines with two inputs. Plastic and Copper make a Circuit, your first assembled part and the source of β Data.', ['Assembler', 'Recipe: Plastic + Copper → Circuit']),
  T('P5', 'Quartz Deposits', 'processing', 4, 0, { a: 1875 }, ['P4'], 'Drill for Quartz, refine it into Silicon, and put Silicon and Glass together into a Screen.', ['Quartz Drills', 'Recipe: 2 Quartz → Silicon', 'Recipe: 2 Glass + Silicon → Screen']),
  T('P7', 'Fabrication', 'processing', 5, 0, { a: 720, b: 100 }, ['P5'], 'Machines with three inputs. A Screen and two Circuits become a Phone, your first finished product and the source of γ Data.', ['Fabricator', 'Recipe: Screen + 2 Circuit → Phone']),
  T('P9', 'Robot', 'processing', 6, 0, { a: 2800, b: 250, g: 450 }, ['P8'], 'The capstone. A Phone for a brain, a Laptop for a body and raw Quartz for eyes: a Robot.', ['Recipe: Phone + Laptop + 4 Quartz → Robot']),
  // (Behind Assembly, not just Refining: it is priced in β, and Assembly is what brings the first β. Researchable
  // from the first visit to the tree, it sat there for ten minutes with "no β yet".)
  T('U1', 'Efficiency Tuning', 'processing', 1, 1, { b: 40 }, ['P1', 'P4'], 'A new upgrade track for machines: some crafts consume no inputs.', ['Efficiency upgrades on machines']),
  T('U2', 'Overclock', 'processing', 2, 1, { g: 60 }, ['U1'], 'Raises the level cap on Speed upgrades from 10 to 25.', ['Speed level cap 25']),
  T('P6', 'Reclamation', 'processing', 4, 1, { a: 300, g: 25 }, ['P4'], 'Turn Tar, the waste of your Plastic line, into Rubber, and wrap Copper in it to make Cable.', ['Recipe: 3 Tar → Rubber', 'Recipe: Copper + 2 Rubber → Cable']),
  T('P8', 'Laptop', 'processing', 5, 1, { a: 1200, b: 300, g: 100 }, ['P6', 'P7'], 'Two Cables, a Circuit and a Screen make a Laptop.', ['Recipe: 2 Cable + Circuit + Screen → Laptop']),
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
  T('C1', 'Market Lens', 'commerce', 1, 0, {}, ['R1'], 'See live prices and how much of each material your Markets buy at full price.', ['Price gauges on Markets'], { auto: 'Yours the first time something sells over its demand', needsSurplus: true }),
  T('C2', 'Wider Demand', 'commerce', 2, 0, { b: 40 }, ['C1'], 'Markets buy 50% more of everything at full price.', ['+50% demand, all materials'], { needsSurplus: true }),
  T('C4', 'Luxury Buyers', 'commerce', 3, 0, { b: 300 }, ['C2'], 'Assembled parts and finished products sell for 25% more.', ['+25% value on parts and products'], { needsSurplus: true }),
  T('C5', 'Exports', 'commerce', 4, 0, { g: 80 }, ['C4'], 'Markets buy twice as much of everything at full price.', ['+100% demand, all materials'], { needsSurplus: true }),
  // Research
  T('R1', 'Lab', 'research', 0, 0, {}, [], 'Send items to a Lab instead of a Market to earn Data, the currency of this tree.', ['Lab node', 'Tech tree'], { auto: 'Reward for the goal “Sell your first Glass”' }),
  T('R2', 'Lab Speed', 'research', 1, 0, { a: 50 }, ['R1'], 'Labs study items twice as fast.', ['Labs 2× speed']),
  T('R3', 'Deep Analysis', 'research', 2, 0, { b: 80 }, ['R2'], 'Every item studied yields 50% more Data.', ['+50% Data per item']),
  T('R4', 'Long Absence', 'research', 1, 1, { a: 210 }, ['R1'], 'Your supply line keeps earning for up to 8 hours while you are away, instead of 2.', ['Offline cap 2h → 8h'], { needsEnd: true }),
  // Scale tools
  T('S1', 'Bulk Upgrade', 'scale', 1, 0, {}, ['L1'], 'Upgrade every node of the same kind with one click.', ['"Upgrade all" button'], { auto: 'Reward for the goal “Make your first Screen”' }),
  T('S3', 'Auto-balance', 'scale', 2, 0, { b: 50 }, ['S1', 'L4'], 'One click sets a Router\'s weights to match what each destination can actually use.', ['Router: Auto-balance']),
  // (For the board, not the line: priced as the side techs before the first Circuit are, and behind Routing, which
  // is when a board has grown enough for where its Drills stand to matter.)
  T('S2', 'Mobile Drills', 'scale', 1, 1, { a: 80 }, ['L1'], 'A Drill can be moved like any other card, and its deposit goes with it. Set your sources down where the line needs them.', ['Drills can be dragged', 'Drills move in a block of cards']),
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
   * leads to one; a junction whose every path ends at Markets, Labs, Silos, Dumps or nowhere waits with the
   * Markets, Labs and Dumps and shares what the machines leave.
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
    /** ...and never for fewer items than this (one Robot every 12 s must still sell whole at full price). */
    minBurst: 1,
    /**
     * The first time a material keeps selling over its demand for `seconds` (surplus sales no more than `gap`
     * apart), g.seenSurplus is set, Market Lens is granted and a 'surplus' event raised: the interface
     * introduces the demand gauge then, and the Commerce branch appears in the tech tree.
     * The gap is longer than the slowest craft (a Robot takes 12 s): a machine hands over whole items, so a
     * line that is over demand makes one surplus sale per craft, seconds apart, for as long as it runs.
     */
    notice: { seconds: 3, gap: 13 },
  },

  /** 2.3 Flow. */
  flow: {
    /** A Drill or machine counts once it is this many seconds old (since built, or since its recipe was changed). */
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
     * producers that is all of them. A newcomer arrives with seven of nine or nine of ten flowing (the Copper
     * Refiner is short of Ore, sometimes the Plastic Refiner of Oil) and has to find and fix what is not: at
     * 75% the goal completed by itself, and at 90% it still did for anyone with ten producers.
     */
    holdShare: 0.95,
    /** ...for this many seconds. */
    holdSeconds: 10,
    /**
     * The goal's valve. Once the goal has been on the card for this many seconds it also passes with all but
     * one producer flowing, held for the same `holdSeconds`. The bar stays where it is for everyone who can
     * reach it; the valve is for a board with one producer nobody can get flowing (a machine starved through
     * a Router in a way the adviser has no fix for), which would otherwise hold the whole chain up for good.
     */
    valveAfter: 90,
    /**
     * ...and from this many seconds with all but two. A player who builds ahead (a second Circuit Assembler on
     * arrival, which the credits in hand pay for) can leave two producers short that each need two changes
     * upstream: no tip names those, and with "all but one" alone the chain stopped there for good.
     */
    valveAfter2: 180,
    /**
     * ...and after that, one more producer may be short every this many seconds (all but three at 300 s, all but
     * four at 420 s...), until one producer flowing is enough: every board on which anything flows passes in
     * the end. A save from the public version, played on by a player who follows only the tips, arrived three
     * short in a way no single tip puts right, and stopped there for good with two steps alone.
     */
    valveEvery: 120,
  },

  /** 2.4 Goal thresholds that are numbers rather than events (the Flow goal's are in `flow` above). */
  goals: {
    /**
     * "Study Circuits for β": this much β in hand. About a minute of one Assembler's Circuit in a Lab: a goal with
     * something to watch, between the first Circuit and the wait for Quartz Deposits.
     */
    studyBeta: 40,
  },

  /** 2.5 Orders. */
  orders: {
    /** Starting seed for order generation; the running seed is saved with the game. */
    seed: 0x5eed1e55,
    /**
     * An order asks for between this many... (It was 45 to 90 s. At about half the size, an order comes and is
     * claimed almost twice as often for the same pay a second: a Claim to press every minute or so through the long waits of
     * the middle game, which the card-following player otherwise spent with nothing to do; and a stretch of
     * nothing to do is broken by one more often.)
     */
    minSeconds: 25,
    /** ...and this many seconds of what currently reaches Markets of that material... */
    maxSeconds: 50,
    /** ...but never fewer items than this. */
    minNeed: 8,
    /**
     * Until the player has filled an order: something that is already selling, sized to this many seconds of it
     * (so it fills in 30 to 40 s with nothing rerouted), and at least `minNeed` items.
     */
    first: { seconds: [32, 37] as [number, number], minNeed: 3 },
    /** A material counts as "currently produced" above this rate (items/s). */
    minRate: 0.02,
    /**
     * ...and as reaching a Market, for the choice of what to ask for, from this rate: the smallest order
     * (`minNeed`) fills in 100 s at it. This used to be `minRate` too: a trickle of Silicon past a busy Assembler
     * counted as selling, an order for eight of it took four minutes or went stale, and a fast player saving
     * for the Fabricator sat with free hands for up to 157 s.
     */
    marketRate: 0.08,
    /** orderView: the ordered material "reaches a Market" while its smoothed sales stay above this rate (items/s)... */
    sellingRate: 0.005,
    /** ...or for this many seconds after the order's last delivery, so that a slow trickle still counts. */
    sellingMemory: 30,
    /** Materials worth less than this are never asked for (Tar). */
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
     * Lab (Circuit is β in a Lab; an order that pays α for it converts). At 1 a single Circuit order paid 400 α,
     * two minutes of a newcomer's Labs in one lump, and which material the next order happened to ask for
     * decided the pace of a run: the same player reached the Phone up to three minutes apart.
     */
    convertShare: 0.25,
    /** An unfilled order with no deliveries for this long is quietly replaced. */
    staleSeconds: 120,
    /**
     * ...and so is one that, at the rate its material sells right now, would take more than `eta` seconds to fill,
     * for `hold` seconds running, once it is `after` seconds old (a new order's material may only just be starting
     * to sell). A machine built on the line that feeds the Market takes the material first: the Copper an order
     * was counting goes into the Circuit Assembler, the Glass into the Screen Assembler.
     */
    retire: { eta: 300, hold: 20, after: 30 },
  },

  /**
   * The adviser's manners (src/advice.ts): what it owes to a player who is busy. The numbers that decide
   * whether a tip is worth saying at all are in ADVICE there.
   */
  tips: {
    /** After the player changes the board (by following a tip or in any other way), no tip for this many seconds. */
    quiet: 20,
    /**
     * For this many seconds after a change, no tip that asks for the same thing again on the same kind of node
     * ("buy Speed on a Lab" straight after buying Speed on a Lab). The board's last changes are remembered
     * this long (g.edits).
     */
    repeatAfter: 60,
    /** No tip sentence, and no "while you wait" line of a goal card, is longer than this: it has to fit the card on a phone. */
    maxLength: 90,
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

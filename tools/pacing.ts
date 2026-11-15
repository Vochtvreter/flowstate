/**
 * Pacing bot: a headless, DOM-free simulated player that plays the REAL game.
 *
 *   npm run pacing                                 every default policy, seeds 0–3: the tables against the
 *                                                  targets, then a full report for seed 0 of each policy
 *   npm run pacing -- --summary                    only the tables
 *   npm run pacing -- --policy=newcomer --seed=2   one run: full report with the event timeline
 *   npm run pacing -- --policies=mainline,slow     the table for these policies only (slow is not a default)
 *   npm run pacing -- --profile=<name>             what-if numbers from tools/pacing-profiles.ts
 *   npm run pacing -- --set=tech.P4=a800,node.assembler.base=1000    one-off what-if numbers (see applyOverrides)
 *   other flags: --minutes=<n>  --quiet (no timeline)  --seeds=4,5,6
 *                (a seed moves the bot's reaction times and the order generator; seed 0 leaves the order
 *                generator alone, so it plays the order sequence every real new game starts with)
 *                --spendShare=<0..1>   what-if for the fast players, not the game: how much of their income
 *                                      they still spend on other things while saving for a new toy
 *                                      (0 = bank everything, 1 = no limit); --patience=<seconds> likewise
 *                --noBulk              what-if: the fast players never press "Upgrade all"
 *                --noTips              what-if: the newcomer never follows a tip. The policy `cardonly` is that
 *                                      player, with targets of its own
 *                --noMeanwhile         what-if: the card players ignore the cards' "while you wait" lines
 *                --skipLine=<goal ids> what-if: they ignore the line of these goals only (make-glyph,make-mist):
 *                                      against the plain run, that is what one line is worth
 *                --lineDelay=<seconds> what-if: they get to a line only once it has been on the card that long
 *                --tipDelay=<seconds>  what-if: they follow a tip after this long on offer (15 otherwise)
 *                --tipEvery=<n>[,<k>]  what-if: they follow only every nth tip that comes due, starting with
 *                                      the kth (the nth when left out), and let the others pass
 *                --hands=<seconds>     what-if: seconds per action of every card player (cardonly at 10 s)
 *                --minShare=<0..1>     what-if: the share of a wait a tip has to save (ADVICE.minShare)
 *                --trials              with --policy=newcomer: for every wait that begins with no tip on offer,
 *                                      list what the adviser weighed and how each candidate did
 *
 * The bot imports the game's own modules and only ever calls what a player can do (src/actions.ts,
 * research, claimGoal, claimOrder, and the adviser's applyAdvice), so goals, orders, Flow, demand and
 * machines-first fan-out are the real rules, never a model of them.
 *
 * Two kinds of player (POLICIES below).
 *
 * The fast players are people who know the game, not optimisers: one action every few seconds, no look-ahead,
 * and a fixed order of attention:
 *   claim what is ready -> research what is affordable -> fix what is red -> build the new toy -> grow.
 *   mainline  one action per 3–4 s, saves Data for the Processing branch the goal card asks for
 *   greedy    the same hands, buys the cheapest affordable tech the moment it can
 * Three habits of these players move their clock by minutes, so they are spelled out:
 *  - they keep studying: a Lab keeps what it is getting for as long as any tech is left to buy with that
 *    Data. They only stop adding wires, Routers and Lab upgrades for Data they are not short of right now,
 *    and cut the feed when nothing at all is left to research with it;
 *  - they keep tinkering, within a budget: from the moment a new machine cannot be paid for, half of what
 *    comes in is banked for it and half may still go on upgrades (spendShare), in pieces of up to a quarter
 *    of its price while it is far off and under 3% of it (pettyShare) once it is within 150 s (patience).
 *    --spendShare measures a stricter or looser saver;
 *  - once they own Bulk Upgrade, nodes of a kind that want the same upgrade get one press of "Upgrade all"
 *    (which upgrades every node of that kind) instead of a press each, when they are at least half of the kind.
 *
 * The newcomer is the player the build is tuned for. They do ONLY what the goal card says (cardStep below
 * reads each card the way tests/cardPlayer.ts does), one action every 6 s, and claim 8–16 s late. That is the
 * hint and, while a goal makes them wait, the card's "while you wait" line (Goal.meanwhile in src/goals.ts,
 * meanwhileStep below): the line is on the card, so it is followed like a hint, before any tip. When they
 * are waiting, the line is done and the adviser (src/advice.ts) has had a tip on offer for 15 s, they follow
 * it: one action. They never build a Router, upgrade or wire anything unprompted.
 *   newcomer    6 s per action
 *   newcomer10  the same person at 10 s per action
 *   cardonly    the newcomer who never follows a tip, not even on the Flow goal: the cards and their lines
 *               alone. The cards have to carry the game by themselves, so this player has targets too. Their
 *               Flow goal is passed by its valve (RULES.flow.valveAfter): it opens at 90 s, its ten seconds
 *               are counted from there, and the Claim follows 8–16 s later, so about 110–116 s on the goal
 * For these players the report also counts the tips: how many came on offer, how many were followed, and the
 * smallest and the median saving the followed ones promised.
 *
 *   slow        the old floor (one action per 8–10 s, wires and builds Routers unprompted, ignores amber,
 *               never upgrades a Lab). Not in the default table any more; --policy=slow still runs it.
 *
 * The targets (docs/PITCH_PLAN.md section 1, as amended for the newcomer) are in TARGETS; every run is checked
 * against them.
 */
declare const process: { argv: string[]; env: Record<string, string | undefined>; stdout: { write(s: string): void } };

import { DATA_YIELD, DataTier, MATERIALS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, RULES, Recipe, TECHS, Tech, Track } from '../src/content';
import {
  claimGoal, claimOrder, clearHistory, connect, cutWire, deleteNode, expandBoard, favour, freeDeposits, materialsAt, placeNode, setMode,
  setWeight, upgrade, upgradeAll, upgradeWire,
} from '../src/actions';
import { ADVICE, Advice, advice, adviceTrials, applyAdvice, lineAdvice, waitInfo, waitKind } from '../src/advice';
import {
  cycleTime, demandRate, expansionCost, flowMult, fmt, has, maxLevel, maxPipeTier, nodeCost, pipeCap, readyTechs, recipeOf, recipeUnlocked, research,
  saturation, techAffordable, techAvailable, techEta, trackAvailable, upgradeCost, upgradeCostAt, valueOf, wellRate,
} from '../src/economy';
import { countsForFlow, isFlowing } from '../src/flow';
import { GOALS, MAIN_GOALS, activeGoal, meanwhileOf, rewardText, routerFavoursLab } from '../src/goals';
import { graph, isMachine, tick } from '../src/sim';
import { Game, GNode, Reward, Stats, Status, Wire, newGame } from '../src/state';
import { PROFILES, Profile, applyOverrides } from './pacing-profiles';

// =====================================================================================
// Policies: who is playing
// =====================================================================================

type Kind = 'wire' | 'build' | 'upgrade' | 'cut' | 'expand' | 'route' | 'research' | 'claim';

export interface Policy {
  name: string;
  describe: string;
  /** Which targets the run is judged against. */
  judge: 'fast' | 'newcomer' | 'newcomer10' | 'cardonly' | 'nolines' | 'slow';
  /** A card player who reads the cards' "while you wait" lines (the default). false: the hints and the tips only. */
  lines?: boolean;
  /** Judged against the fast targets. */
  fast: boolean;
  /**
   * The newcomer: does only what the goal card says (cardStep) and follows a tip that has been on offer for
   * `tipDelay` seconds of a wait. Nothing else in this policy's habits below is used then.
   */
  card: boolean;
  /** A card player who also follows the adviser's tips. */
  tips: boolean;
  tipDelay: number;
  /** Seconds spent looking at the screen before the first drag. */
  firstActionDelay: number;
  /** [min, max] game seconds each kind of action keeps the player busy. */
  actionSeconds: Record<Kind, [number, number]>;
  /** [min, max] seconds between a Claim button lighting up and the player going for it. */
  claimDelay: [number, number];
  /** A red or amber ring must last this long before the player reacts to it. */
  noticeDelay: number;
  /** After touching a problem, wait this long before judging that node again. */
  settleTime: number;
  /** greedy: buy the cheapest affordable tech at once. mainline: save Data for the Processing branch. */
  techPolicy: 'greedy' | 'mainline';
  /** mainline: a side tech is still bought if it costs under this share of the next Processing tech. */
  impulseShare: number;
  /** Reacts to amber (blocked) rings. A player who does not still follows a goal that asks for it. */
  fixesAmber: boolean;
  upgradesLabs: boolean;
  /** Expands the board before the goal chain has asked for it. */
  expandsUnasked: boolean;
  /** If the next new toy is this many seconds of income away (or less), save for it... */
  patience: number;
  /** ...and meanwhile only buy things under this share of its price... */
  pettyShare: number;
  /**
   * From the moment a new toy cannot be paid for, at most this share of what comes in goes on anything else
   * (1 = no limit): the rest is banked. Without it the player spent the bank down to nothing while the toy was
   * more than `patience` away, and the time on "Build a Fabricator" jumped between two minutes and seven
   * depending on a few credits.
   */
  spendShare: number;
  /** While the toy is further away than that, upgrades may cost up to this share of its price. */
  growShareOfTarget: number;
}

const hands = (s: [number, number], research = s, claim = s): Record<Kind, [number, number]> =>
  ({ wire: s, build: s, upgrade: s, cut: s, expand: s, route: s, research, claim });
const FAST_HANDS = hands([3, 4], [5, 7], [1.5, 2.5]);
const SLOW_HANDS = hands([8, 10]);

const FAST: Omit<Policy, 'name' | 'describe' | 'techPolicy' | 'impulseShare'> = {
  judge: 'fast', fast: true, card: false, tips: false, tipDelay: 15,
  firstActionDelay: 6, actionSeconds: FAST_HANDS, claimDelay: [1, 3], noticeDelay: 4, settleTime: 10,
  fixesAmber: true, upgradesLabs: true, expandsUnasked: true,
  patience: 150, pettyShare: 0.03, spendShare: 0.5, growShareOfTarget: 0.25,
};
/** The newcomer's hands. The habits after `tipDelay` belong to the fast players and are never read for a card player. */
const CARD: Omit<Policy, 'name' | 'describe' | 'judge' | 'actionSeconds' | 'firstActionDelay'> = {
  fast: false, card: true, tips: true, tipDelay: 15, claimDelay: [8, 16], noticeDelay: 8, settleTime: 20,
  techPolicy: 'mainline', impulseShare: 0,
  fixesAmber: false, upgradesLabs: false, expandsUnasked: false,
  patience: 150, pettyShare: 0, spendShare: 1, growShareOfTarget: 0,
};

export const POLICIES: Record<string, Policy> = {
  mainline: {
    ...FAST, name: 'mainline',
    describe: 'fast and focused: one action per 3–4 s, saves Data for the Processing techs the goal card asks for',
    techPolicy: 'mainline', impulseShare: 0.35,
  },
  greedy: {
    ...FAST, name: 'greedy',
    describe: 'fast and impulsive: one action per 3–4 s, buys the cheapest affordable tech at once',
    techPolicy: 'greedy', impulseShare: 1,
  },
  newcomer: {
    ...CARD, name: 'newcomer', judge: 'newcomer',
    describe: 'newcomer: only what the goal card says, one action per 6 s, claims 8–16 s late, follows a tip once it has been on offer for 15 s',
    firstActionDelay: 12, actionSeconds: hands([6, 6]),
  },
  newcomer10: {
    ...CARD, name: 'newcomer10', judge: 'newcomer10',
    describe: 'the newcomer at 10 s per action: a slower person',
    firstActionDelay: 16, actionSeconds: hands([10, 10]),
  },
  cardonly: {
    ...CARD, name: 'cardonly', judge: 'cardonly', tips: false,
    describe: 'the newcomer who never follows a tip: only the goal card and its "while you wait" lines, one action per 6 s, claims 8–16 s late',
    firstActionDelay: 12, actionSeconds: hands([6, 6]),
  },
  nolines: {
    ...CARD, name: 'nolines', judge: 'nolines', lines: false,
    describe: 'the newcomer who never reads a "while you wait" line: the hints and the tips only, one action per 6 s, claims 8–16 s late',
    firstActionDelay: 12, actionSeconds: hands([6, 6]),
  },
  slow: {
    name: 'slow', judge: 'slow', fast: false, card: false, tips: false, tipDelay: 15,
    describe: 'the old floor: one action per 8–10 s, claims late, ignores amber rings, never upgrades a Lab, expands only when asked',
    firstActionDelay: 12, actionSeconds: SLOW_HANDS, claimDelay: [8, 16], noticeDelay: 8, settleTime: 20,
    techPolicy: 'mainline', impulseShare: 0.35,
    fixesAmber: false, upgradesLabs: false, expandsUnasked: false,
    patience: 150, pettyShare: 0.03, spendShare: 1, growShareOfTarget: 0.25,
  },
};

/** The policies of the default table. */
const DEFAULT_POLICIES = ['mainline', 'greedy', 'newcomer', 'newcomer10', 'cardonly', 'nolines'];

/** Things that do not depend on who is playing. */
export const CFG = {
  dt: 0.05, // the game's own step (20 ticks per second)
  thinkEvery: 0.5, // how often an idle player re-checks what they can afford
  techSkip: ['R4'], // no effect inside one sitting (time away)
  saturationFloor: 0.9, // do not push a line whose product already averages below this share of its full price
  labPerTier: true, // one Lab per Data tier
  efficiency: true, // buy Efficiency upgrades once Efficiency Tuning is researched
  /** Router weights [Lab, Market]: when the Lab is short of that Data, and while an order asks for the material. */
  studyRatio: [3, 1] as [number, number],
  sellRatio: [1, 3] as [number, number],
  /** With Bulk Upgrade owned, nodes of a kind wanting the same upgrade make it one press of "Upgrade all": at least this many of them, and this share of the kind. */
  bulk: true,
  bulkFrom: 2,
  bulkShare: 0.5,
  /** The newcomer follows tips. */
  tips: true,
  /** Card players do what the card's "while you wait" line says. */
  meanwhile: true,
  /**
   * What-ifs that bend the model of the card players, not the game. They ignore the lines of these goals (ids);
   * they get to a line only once it has been on the card for `lineDelay` seconds; and of the tips that come
   * due they follow every `tipEvery`-th, starting with number `tipFirst`, and let the others pass.
   */
  skipLines: [] as string[],
  lineDelay: 0,
  tipEvery: 1,
  tipFirst: 1,
  /** For tests: called when a card player is about to make the first gesture of one of a goal's "while you wait" lines, with the game as it stands. */
  onLine: null as ((g: Game, goal: string, line: string) => void) | null,
  /** --trials: record what the adviser weighed whenever a wait begins with no tip on offer. */
  trials: false,
  deadStretch: 45, // seconds with free hands and nothing useful to do, listed in the report
  minutesFast: 30,
  minutesSlow: 36,
  /** A card player's run stops once the demo's last goal is claimed; it gets this long to get there. */
  minutesCard: 45,
  /** Seed 0 is the order sequence every real new game starts with. */
  seeds: [0, 1, 2, 3],
};

/** docs/PITCH_PLAN.md section 1 as amended for the newcomer, in seconds on the bot's clock. */
export const TARGETS = {
  fast: {
    firstMachineBy: 45,
    labBy: 90,
    firstResearchBy: 150,
    /** An action available at least this often in the first two minutes. */
    earlyIdleMax: 10,
    glyph: [360, 480] as [number, number],
    /** 14:30–18:00. */
    lens: [870, 1080] as [number, number],
    /** No more than this long on "Build a Fabricator". */
    fabricatorMax: 300,
    /** No dead stretch over 60 s before 10:00, none over 120 s before the first Lens. */
    deadBefore10: 60,
    deadBeforeLens: 120,
    /** Content after the Lens (through Paradox) must last at least this long... */
    contentUntil: 1440,
    /** ...and the Paradox, the last free-play goal, comes within half an hour. */
    paradoxBy: 1800,
  },
  newcomer: {
    /** 19:00–23:00. */
    lens: [1140, 1380] as [number, number],
    /** Never more than this long on one goal of the demo... */
    goalMax: 240,
    /** ...and "Build a Fabricator" has the same limit by name. */
    fabricatorMax: 240,
  },
  /** The newcomer at 10 s per action. */
  newcomer10: {
    lensBy: 1800,
    goalMax: 300,
  },
  /**
   * The newcomer who never follows a tip: the cards and their "while you wait" lines alone. The demo's twenty
   * minutes with something to do in them: no stretch of nothing to do (Bot.nothing) over a minute and a half,
   * and nothing to do for no more than 40% of the time to the first Lens.
   */
  cardonly: {
    lens: [1200, 1380] as [number, number],
    goalMax: 360,
    nothingStretch: 90,
    nothingShare: 0.4,
  },
  /** The newcomer who reads no line, only the hints and the tips: slower, never stranded. */
  nolines: {
    lensBy: 1920,
  },
  /** The old floor, for --policy=slow. */
  slow: {
    lensBy: 1680,
    /** Never more than this long on one goal of the demo. */
    goalMax: 240,
    /** No goal-path tech may cost more than this many seconds of the player's Data income at the time. */
    dataWall: 180,
  },
  /** Share of all credits earned before the first Lens that comes from sales and orders. */
  earnedShare: 0.65,
  /** A first or second Speed level pays for itself within this window where the input exists. */
  payback: [60, 180] as [number, number],
};

/** Techs the goal chain asks for, in order: the demo, then free play. */
const GOAL_TECHS = ['P2', 'P3', 'P4', 'P5', 'P7'];
const TECH_PATH = [...GOAL_TECHS, 'P6', 'P8', 'P9'];

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

const mmss = (t: number | null | undefined) =>
  t == null || !isFinite(t) ? '  —  ' : `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const pad = (s: string | number, n: number) => String(s).padStart(n);
const padR = (s: string | number, n: number) => String(s).padEnd(n);
const f1 = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2));
const techWeight = (t: Tech) => (t.cost.a ?? 0) + 4 * (t.cost.b ?? 0) + 12 * (t.cost.g ?? 0);
const costStr = (t: Tech) => TIERS.filter((k) => t.cost[k]).map((k) => `${t.cost[k]}${GREEK[k]}`).join('+') || 'free';
const matTier = (m: MatId) => DATA_YIELD[MATERIALS[m].tier].tier;
const isJunk = (m: MatId) => MATERIALS[m].value < 1;
const payText = (r: Reward) =>
  [r.credits ? `+${fmt(r.credits)}¢` : '', ...TIERS.map((k) => (r[k] ? `+${r[k]}${GREEK[k]}` : ''))].filter(Boolean).join(' ');
const goalIndex = (id: string) => GOALS.findIndex((x) => x.id === id);

type Cls = 'fix' | 'new' | 'grow';
interface Want {
  cls: Cls;
  kind: Kind;
  label: string;
  cost: number;
  run: () => boolean;
  /** A thing the player has never had (a machine for a new recipe, a Lab for a new Data tier), or something the goal card asks for: worth saving for. */
  novel?: boolean;
  /** Nodes whose status should be left to settle after this action. */
  settle?: number[];
  /** Cannot be bought yet (its tech is still being saved for), but the player knows it is coming and keeps credits back for it. */
  locked?: boolean;
  /** An upgrade of one node: with Bulk Upgrade, several of these on one kind of node become one press. */
  up?: { node: number; track: Track };
  /** This press is "Upgrade all". */
  bulk?: boolean;
  /** Gestures the action takes (1 when absent): a tip that builds something and then wires it on is two. */
  gestures?: number;
  /** The tip being followed, for the record. */
  tip?: Advice;
}
interface Port { n: GNode; port: number }

interface Minute {
  t: number; credits: number; income: number; data: Record<DataTier, number>; dataRate: Record<DataTier, number>;
  nodes: number; techs: number; actions: number; idle: number; spent: number; flow: number;
  /** Share of this minute's sales value that was paid at full price (the rest went as surplus). */
  full: number;
  /** Materials sold over their demand rate at the end of the minute. */
  glut: string;
}

// =====================================================================================
// The simulated player
// =====================================================================================

export class Bot {
  g: Game;
  P: Policy;
  seed: number;
  minutes: number;
  rnd: () => number;
  /** When the player's hands are next free. */
  freeAt: number;
  lastThink = -1;
  idleSince: number | null = null;
  idleWhy = '';
  idleFirstWhy = '';
  seen = new Map<number, { s: Status; t: number }>();
  ignoreUntil = new Map<number, number>();
  /** Output ports whose Market / Lab wire was cut on purpose: never put it back. */
  noSink = new Set<string>();
  /** Output ports the player took a Router off again (it was starving a machine): never put one back. */
  noRouter = new Set<string>();
  labTier = new Map<number, DataTier>();
  /** When the player will get round to the Claim buttons. */
  goalClaimAt = Infinity;
  orderClaimAt = Infinity;

  // --- records ---
  timeline: { t: number; text: string }[] = [];
  /** Every stretch with free hands and nothing useful to do. */
  waits: { from: number; to: number; why: string; endedBy: string }[] = [];
  techAt: Record<string, number> = {};
  techAvailAt: Record<string, number> = {};
  /** For each bought tech: its price in seconds of the Data income of the 3 minutes before. */
  techWall: Record<string, number> = {};
  madeAt: Partial<Record<MatId, number>> = {};
  firstNode: Partial<Record<NodeType, number>> = {};
  minutes_: Minute[] = [];
  actions = 0;
  mIncome = 0; mWorth = 0; mData: Record<DataTier, number> = { a: 0, b: 0, g: 0 }; mActions = 0; mIdle = 0; mSpent = 0;
  rewardTotal: Required<Reward> = { credits: 0, a: 0, b: 0, g: 0 };
  lastNewAt = 0;
  lastNewWhat = '';
  goalReadyAt: Record<string, number> = {};
  goalClaimedAt: Record<string, number> = {};
  orderLog: { t: number; text: string }[] = [];
  orderTimes: number[] = [];
  flowStates: number[] = [];
  /** Credit sources at the moment of the first Lens. */
  statsAtEnd: Stats | null = null;
  /** Data earned so far from every source (Labs, orders, goals), sampled once a second. */
  earned: Record<DataTier, number> = { a: 0, b: 0, g: 0 };
  earnedLog: Record<DataTier, number[]> = { a: [0], b: [0], g: [0] };
  firstDataAt: Partial<Record<DataTier, number>> = {};
  /** Presses of an Upgrade button so far: one node, "Upgrade all", a wire. `beforeLens` is their sum at the first Lens. */
  presses = { single: 0, bulk: 0, wire: 0 };
  pressesAtLens: { single: number; bulk: number; wire: number } | null = null;
  // --- the newcomer's records ---
  /** Since when a tip has been on offer without a break. */
  tipSince: number | null = null;
  tipOn = false;
  tipsTaken: { t: number; goal: number; text: string; kind: Advice['kind']; eta: number; saves: number | undefined; cost: number }[] = [];
  /** Every tip that came on offer: when, on which goal, what it said and what it promised then. */
  tipsOffered: { t: number; goal: number; text: string; saves: number | undefined }[] = [];
  /** The sentence on offer at the last look, '' when there was none. */
  tipShown = '';
  /** --tipEvery: tips that have come due so far, and the sentence of one the player let pass (while it stays on offer). */
  tipsDue = 0;
  tipPassed = '';
  /** --lineDelay: the goal whose "while you wait" line is showing, and since when. */
  lineSeen: { goal: number; t: number } | null = null;
  /** Stretches of waiting with nothing the card asks and no tip on offer. */
  tiplessSince: number | null = null;
  tipless: { from: number; to: number; goal: number; why: string; trials: string[] }[] = [];
  tiplessTrials: string[] = [];
  /** The board when the Flow meter unlocked, and when the Fabricator's goal and its saving began. */
  flowAtUnlock: { t: number; flow: number; producers: number; flowing: number; slow: string[] } | null = null;
  marks: { t: number; what: string; credits: number; income: number; a: number; b: number }[] = [];
  surplusAt: { t: number; goal: number; mat: MatId } | null = null;
  /**
   * "Nothing to do": seconds in which the player's hands are free, the goal is not ready, no order is ready to
   * claim, and no step of the card's "while you wait" line can be done right now (lineAdvice(g) is null, which it
   * is when the line is done, does not apply, or its step cannot be paid for yet). Up to the first Lens: in all,
   * per goal (by index), and every stretch.
   */
  nothing = { total: 0, perGoal: {} as Record<number, number>, stretches: [] as { from: number; to: number; goal: number }[] };
  nothingSince: number | null = null;
  nothingGoal = 0;

  constructor(policy: Policy, seed: number, minutes: number) {
    this.P = policy;
    this.seed = seed;
    this.minutes = minutes;
    clearHistory();
    this.g = newGame();
    this.g.orderSeed = (this.g.orderSeed + seed * 7919) >>> 0;
    this.rnd = rng(seed);
    this.freeAt = policy.firstActionDelay;
    this.noteAvailable();
  }

  /** Remember what the player had in hand at a moment worth knowing about. */
  mark(what: string) {
    const g = this.g;
    this.marks.push({ t: g.time, what, credits: g.credits, income: g.creditRate, a: g.data.a, b: g.data.b });
  }

  log(text: string) {
    this.timeline.push({ t: this.g.time, text });
  }

  // ---------- board queries ----------

  outs(n: GNode, port = 0): Wire[] { return graph(this.g).outs.get(n.id)?.[port] ?? []; }
  ins(n: GNode): Wire[] { return graph(this.g).ins.get(n.id) ?? []; }
  node(id: number): GNode { return graph(this.g).byId.get(id)!; }
  portMat(n: GNode, port: number): MatId | null { return materialsAt(this.g, n.id, port)[0] ?? null; }
  key(p: Port, what = '') { return `${p.n.id}:${p.port}:${what}`; }
  busy(n: GNode) { return (this.ignoreUntil.get(n.id) ?? 0) > this.g.time || n.grace > 0; }

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

  /** The Router this port feeds, if any. */
  routerOn(p: Port): GNode | null {
    for (const w of this.outs(p.n, p.port)) {
      const d = this.node(w.to);
      if (d.type === 'router') return d;
    }
    return null;
  }

  feedsMachine(p: Port): boolean {
    return this.outs(p.n, p.port).some((w) => isMachine(this.node(w.to)));
  }

  /** Items per second leaving this port for anything but a machine: what is sold, studied or dumped. */
  spare(p: Port): number {
    let s = 0;
    for (const w of this.outs(p.n, p.port)) if (!isMachine(this.node(w.to))) s += w.rate;
    return s;
  }

  /** Best port to feed a new consumer from: one that is selling its surplus, then the least shared. */
  bestProducer(m: MatId, consumer?: GNode): Port | null {
    const score = (p: Port) => {
      const ws = this.outs(p.n, p.port);
      let s = 0;
      if (ws.some((w) => this.node(w.to).type === 'market')) s -= 10;
      if (p.n.status === 'blocked') s -= 5;
      s += ws.filter((w) => isMachine(this.node(w.to))).length * 3;
      if (this.routerOn(p)) s += 50; // a Router shares evenly with a machine: it would starve the newcomer
      return s;
    };
    const list = this.producers(m).filter((p) => !consumer || !this.outs(p.n, p.port).some((w) => w.to === consumer.id));
    list.sort((a, b) => score(a) - score(b));
    return list[0] ?? null;
  }

  /**
   * The Data the player is short of right now: what the goal card shows them saving up
   * ("Research Breeze Deposits: 400 / 900 α"), plus
   *  - mainline: whatever the next tech of the Processing branch still lacks;
   *  - greedy: whatever any tech they could research now still lacks.
   * Data that is only wanted for techs further off is "for later": the Labs keep what they are getting,
   * but the player does not go out of their way for it, and Routers go back to selling.
   */
  shortTiers(): Set<DataTier> {
    const g = this.g;
    const short = new Set<DataTier>();
    const unit = g.goal.ready ? undefined : activeGoal(g)?.progress?.(g)?.[2];
    if (unit === 'α') short.add('a');
    if (unit === 'β') short.add('b');
    if (unit === 'γ') short.add('g');
    const lacking = (t: Tech) => { for (const k of TIERS) if ((t.cost[k] ?? 0) > g.data[k]) short.add(k); };
    if (this.P.techPolicy === 'mainline') {
      const next = this.nextPathTech();
      if (next && techAvailable(g, next)) lacking(next);
    } else {
      for (const t of Object.values(TECHS)) if (techAvailable(g, t) && !CFG.techSkip.includes(t.id)) lacking(t);
    }
    return short;
  }

  /** Is there still something to buy with this Data that the player does not have the Data for? */
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

  /** The goal card asks for attention to amber rings (the Flow goal), even from a player who ignores them. */
  amber(): boolean {
    return this.P.fixesAmber || (!this.g.goal.ready && activeGoal(this.g)?.id === 'hold-flow');
  }

  /** A status the player has had time to notice and has not just dealt with. */
  problem(n: GNode): Status | null {
    if (n.grace > 0 || (n.status !== 'starved' && n.status !== 'blocked')) return null;
    if (n.status === 'blocked' && !this.amber()) return null;
    const rec = this.seen.get(n.id);
    if (!rec || rec.s !== n.status || this.g.time - rec.t < this.P.noticeDelay) return null;
    if ((this.ignoreUntil.get(n.id) ?? 0) > this.g.time) return null;
    return n.status;
  }

  trackStatus() {
    for (const n of this.g.nodes) {
      const rec = this.seen.get(n.id);
      if (!rec || rec.s !== n.status) this.seen.set(n.id, { s: n.status, t: this.g.time });
    }
  }

  /** Does everything this node's line sells already go for a poor price? */
  lineSaturated(n: GNode): boolean {
    const sold: MatId[] = [];
    const visit = (x: GNode, depth: number) => {
      if (depth > 4) return;
      for (const p of this.ports(x)) {
        const m = this.portMat(x, p.port);
        for (const w of this.outs(x, p.port)) {
          const d = this.node(w.to);
          if (d.type === 'market' && m && (x !== n || isMachine(n)) && !isJunk(m)) sold.push(m);
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

  /** The next tech the goal chain will ask for. */
  nextPathTech(): Tech | null {
    return TECH_PATH.map((id) => TECHS[id]).find((t) => !this.g.techs.includes(t.id)) ?? null;
  }

  pickTech(): Tech | null {
    const g = this.g;
    const ready = readyTechs(g).filter((t) => !CFG.techSkip.includes(t.id)).sort((a, b) => techWeight(a) - techWeight(b));
    if (!ready.length) return null;
    if (this.P.techPolicy === 'greedy') return ready[0];
    // mainline: the tech the goal card is asking for comes first...
    const next = this.nextPathTech();
    if (!next) return ready[0];
    if (ready.includes(next)) return next;
    // ...and anything else is an impulse buy: fine if it costs none of the Data the next one is short of,
    // or only a small share of that tech's price in that Data.
    const short = TIERS.filter((k) => (next.cost[k] ?? 0) > g.data[k]);
    return ready.find((t) => short.every((k) => (t.cost[k] ?? 0) <= this.P.impulseShare * (next.cost[k] ?? 0))) ?? null;
  }

  // ---------- what the player wants right now ----------

  wants(): Want[] {
    const g = this.g;
    const P = this.P;
    const W: Want[] = [];
    const market = g.nodes.find((n) => n.type === 'market') ?? null;
    const goal = g.goal.ready ? null : activeGoal(g);
    const amber = this.amber();
    const speedWant = (n: GNode, why: string, settle: number[] = []): void => {
      if (n.lv.speed >= maxLevel(g, 'speed')) return;
      W.push({
        cls: 'grow', kind: 'upgrade', cost: upgradeCost(n, 'speed'), settle: [n.id, ...settle], up: { node: n.id, track: 'speed' },
        label: `upgrade ${this.name(n)} speed to L${n.lv.speed + 1} (${why})`,
        run: () => upgrade(g, n.id, 'speed'),
      });
    };
    const wireWant = (w: Wire, why: string, settle: number[] = []): boolean => {
      if (w.tier >= maxPipeTier(g)) return false;
      W.push({
        cls: 'grow', kind: 'upgrade', cost: PIPES[w.tier + 1].cost, settle,
        label: `upgrade wire ${this.name(this.node(w.from))} → ${this.name(this.node(w.to))} to ${PIPES[w.tier + 1].name} (${why})`,
        run: () => upgradeWire(g, w.id),
      });
      return true;
    };
    const saturated = (w: Wire) => w.rate >= pipeCap(w.tier) * 0.95;
    const short = this.shortTiers();
    // The Silt lesson: once the goal card has explained the Void, a byproduct port gets one straight away.
    const knowsVoid = g.goal.i > goalIndex('silt-exit') || goal?.id === 'silt-exit';

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
          // A byproduct is ignored until it visibly blocks the machine, or until the goal card has taught the Void.
          if (!knowsVoid && !(amber && this.problem(n) === 'blocked' && n.blockedOn === m)) continue;
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

    // --- G3: Labs. One per Data tier that still buys something; fed from ports that sell their surplus ---
    // A material that an unlocked recipe needs, with no machine built for it yet, is about to be wired into one.
    const spokenFor = (m: MatId) => Object.values(RECIPES).some((r) =>
      r.inputs.length > 1 && recipeUnlocked(g, r) && !g.nodes.some((n) => n.recipe === r.id) && r.inputs.some((i) => i[0] === m));
    if (has(g, 'R1')) {
      const knowsRouter = has(g, 'L1') && (g.goal.i > goalIndex('route-lab') || goal?.id === 'route-lab');
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
          // Nothing left to buy with this Data: stop studying, sell instead. Tidying up, so it waits its turn
          // behind anything red and any new toy. (Routers are turned by routerWants.)
          if (lab && CFG.labPerTier) {
            const w = this.ins(lab).find((x) => this.node(x.from).type !== 'router' && this.outs(this.node(x.from), x.port).length > 1);
            if (w) W.push({ cls: 'grow', kind: 'cut', cost: 0, label: `cut ${this.name(this.node(w.from))} → Lab (no ${GREEK[tier]} left to spend)`, run: () => { this.noSink.add(`${w.from}:${w.port}:lab`); return cutWire(g, w.id); } });
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
        const direct = (p: Port) => this.outs(p.n, p.port).some((w) => w.to === lab.id);
        // Only Data the player is short of right now is worth more wires, Routers or Lab upgrades.
        const forGoal = goal?.id === 'route-lab' && !g.nodes.some((n) => n.type === 'router') && tier === 'a';
        const urgent = short.has(tier) || !this.ins(lab).length;
        const hungryLab = urgent && !this.busy(lab) && lab.util < 0.9;
        const from = feeders.find((p) => !direct(p) && !this.routerOn(p));
        if (hungryLab && from) {
          W.push({ cls: 'fix', kind: 'wire', cost: 0, settle: [lab.id], label: `wire ${this.name(from.n)} → Lab (${GREEK[tier]})`, run: () => !!connect(g, from.n.id, from.port, lab.id) });
        }
        // Every feeder is wired and the Lab still has room: route more of a stream to it (the lesson of the Router goal).
        // Only on ports that feed no machine: a Router is served like a machine and would take half of its input.
        if (knowsRouter && ((hungryLab && !from) || forGoal)) {
          // Study the cheap stuff and sell the dear: the least valuable stream first, then the biggest.
          const cand = feeders.filter((p) => direct(p) && !this.routerOn(p) && !this.feedsMachine(p) && !this.noRouter.has(this.key(p)) && !spokenFor(this.portMat(p.n, p.port)!))
            .sort((a, b) => MATERIALS[this.portMat(a.n, a.port)!].value - MATERIALS[this.portMat(b.n, b.port)!].value || this.spare(b) - this.spare(a))[0];
          if (cand) {
            W.push({
              cls: 'new', kind: 'build', cost: nodeCost(g, 'router'), novel: true, settle: [lab.id],
              label: `build Router from ${this.name(cand.n)} (${forGoal ? 'goal' : `more ${GREEK[tier]}`})`,
              run: () => !!this.buildFrom(cand, 'router'),
            });
          }
        }
        // A Lab that is full while its feeders still sell the rest: study faster.
        if (P.upgradesLabs && urgent && !this.busy(lab) && lab.util >= 0.9 && lab.lv.speed < maxLevel(g, 'speed') && feeders.length) {
          speedWant(lab, `Lab is full, more ${GREEK[tier]}`);
        }
      }
    }
    this.routerWants(W, market);

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
    const asked = goal?.id === 'expand';
    const mayExpand = P.expandsUnasked || g.goal.i >= goalIndex('expand');
    if (asked || (mayExpand && !free.length && g.wires.length > 0)) {
      W.push({
        cls: 'new', kind: 'expand', cost: expansionCost(g), novel: asked,
        label: `expand the board (#${g.board.expansions + 1}${asked ? ', goal' : ''})`, run: () => expandBoard(g),
      });
    }

    // --- G8: bottlenecks the player can see (red = starved, amber = blocked) ---
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
          // A Router on the same port is served like a machine and takes an even share: take it off again.
          const router = this.routerOn(src);
          if (router) {
            W.push({
              cls: 'fix', kind: 'cut', cost: 0, settle: [n.id, s.id],
              label: `remove the Router on ${this.name(s)} (${this.name(n)} is starved of ${MATERIALS[m].name})`,
              run: () => { this.noRouter.add(this.key(src)); return deleteNode(g, router.id); },
            });
            continue;
          }
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
        const p: Port = { n, port };
        // Machines are fed first, so a wire to the Market only ever sells what they leave over.
        if (market && !isJunk(m) && !ws.some((w) => this.node(w.to).type === 'market') && !this.noSink.has(this.key(p, 'market'))) {
          W.push({ cls: 'fix', kind: 'wire', cost: 0, settle: [n.id], label: `wire ${this.name(n)} → Market (sell what backs up)`, run: () => !!connect(g, n.id, port, market.id) });
          continue;
        }
        for (const w of ws) {
          const c = this.node(w.to);
          if (saturated(w)) wireWant(w, `${this.name(n)} is blocked`, [n.id]);
          else if (isMachine(c) && c.grace <= 0 && c.status === 'working' && c.util >= 0.9) speedWant(c, `${this.name(n)} is blocked`, [n.id]);
        }
      }
    }

    // --- G9: everything is green, so push more through ---
    for (const n of g.nodes) {
      if (this.busy(n)) continue;
      if (n.type === 'well' && n.status === 'working') {
        const ws = this.outs(n);
        const cons = ws.map((w) => this.node(w.to));
        if (!cons.some(isMachine)) continue; // a raw seller gets a Refiner first (G2)
        if (cons.some((c) => isMachine(c) && (c.status !== 'working' || c.grace > 0))) continue;
        if (this.spare({ n, port: 0 }) > 0.1 * wellRate(n)) continue; // it already makes more than its machines take
        const cap = ws.reduce((s, w) => s + pipeCap(Math.max(w.tier, maxPipeTier(g))), 0);
        if (wellRate(n) * 1.25 > cap + 1e-6) continue;
        if (this.lineSaturated(n)) continue;
        speedWant(n, 'push more through');
      }
      if (isMachine(n) && n.status === 'working' && n.util >= 0.9) {
        const r = recipeOf(n);
        if (!r) continue;
        // "Where the input exists": every input is backing up or being sold off at its source.
        const inSurplus = r.inputs.every(([m, q]) => this.ins(n).some((w) => {
          if (!materialsAt(g, w.from, w.port).includes(m)) return false;
          const s = this.node(w.from);
          return s.status === 'blocked' || this.spare({ n: s, port: w.port }) > (0.15 * q) / cycleTime(n, r);
        }));
        if (inSurplus && !this.lineSaturated(n)) speedWant(n, 'its inputs are in surplus');
        if (CFG.efficiency && n.util >= 0.8 && trackAvailable(g, n, 'eff') && n.lv.eff < maxLevel(g, 'eff')) {
          W.push({
            cls: 'grow', kind: 'upgrade', cost: upgradeCost(n, 'eff'), settle: [n.id], up: { node: n.id, track: 'eff' },
            label: `upgrade ${this.name(n)} efficiency to L${n.lv.eff + 1}`,
            run: () => upgrade(g, n.id, 'eff'),
          });
        }
      }
    }

    // --- the goal card names a machine whose tech is still being saved for: keep the credits for it ---
    if (goal) {
      const ahead: Record<string, [NodeType, string]> = {
        'make-glyph': ['assembler', 'glyph'], 'make-prism': ['assembler', 'prism'], 'build-fabricator': ['fabricator', 'lens'],
        'make-coil': ['assembler', 'coil'], 'make-dynamo': ['fabricator', 'dynamo'], 'make-paradox': ['fabricator', 'paradox'],
      };
      const next = ahead[goal.id];
      if (next && !recipeUnlocked(g, RECIPES[next[1]]) && !g.nodes.some((n) => n.recipe === next[1])) {
        W.push({
          cls: 'new', kind: 'build', cost: nodeCost(g, next[0]), novel: true, locked: true,
          label: `build ${NODE_DEFS[next[0]].name} (${RECIPES[next[1]].name}) once ${TECHS[RECIPES[next[1]].tech].name} is researched`,
          run: () => false,
        });
      }
    }

    // --- the goal card asks for something this policy would not do unprompted ---
    if (goal?.id === 'upgrade-well') {
      const n = g.nodes.find((x) => x.type === 'well');
      if (n) W.push({ cls: 'new', kind: 'upgrade', cost: upgradeCost(n, 'speed'), novel: true, settle: [n.id], label: `upgrade ${this.name(n)} speed (goal)`, run: () => upgrade(g, n.id, 'speed') });
    }
    if (goal?.id === 'bulk-upgrade') {
      const n = g.nodes.find((x) => x.type === 'well' && x.lv.speed < maxLevel(g, 'speed'));
      if (n) W.push({ cls: 'new', kind: 'upgrade', bulk: true, cost: upgradeCost(n, 'speed'), novel: true, label: 'upgrade ALL Wells: speed (goal)', run: () => upgradeAll(g, 'well', 'speed') > 0 });
    }
    return this.bulked(W);
  }

  /**
   * With Bulk Upgrade owned, nodes of a kind that want the same upgrade get one press of "Upgrade all"
   * instead of a press each, when there are at least two of them and they are at least half of that kind.
   * The button upgrades EVERY node of the kind by a level (cheapest first), wanted or not, so the press is
   * priced at all of them: with two Refiners of ten wanting Speed, two presses are the sensible buy.
   */
  bulked(W: Want[]): Want[] {
    const g = this.g;
    if (!CFG.bulk || !has(g, 'S1')) return W;
    const groups = new Map<string, Want[]>();
    for (const w of W) {
      if (!w.up || w.cls !== 'grow') continue;
      const key = `${this.node(w.up.node).type}:${w.up.track}`;
      groups.set(key, [...(groups.get(key) ?? []), w]);
    }
    const upgradable = (key: string) => {
      const [type, track] = key.split(':') as [NodeType, Track];
      return g.nodes.filter((n) => n.type === type && trackAvailable(g, n, track) && n.lv[track] < maxLevel(g, track));
    };
    const bulk = new Set([...groups].filter(([key, list]) => list.length >= CFG.bulkFrom && list.length >= CFG.bulkShare * upgradable(key).length).map(([key]) => key));
    const out = W.filter((w) => !w.up || w.cls !== 'grow' || !bulk.has(`${this.node(w.up.node).type}:${w.up.track}`));
    for (const [key, list] of groups) {
      if (!bulk.has(key)) continue;
      const [type, track] = key.split(':') as [NodeType, Track];
      const all = upgradable(key);
      out.push({
        cls: 'grow', kind: 'upgrade', bulk: true, cost: all.reduce((sum, n) => sum + upgradeCost(n, track), 0), settle: all.map((n) => n.id),
        label: `upgrade ALL ${NODE_DEFS[type].name}s: ${track === 'eff' ? 'efficiency' : track} (${list.length} of ${all.length} wanted it)`,
        run: () => upgradeAll(g, type, track) > 0,
      });
    }
    return out;
  }

  // ---------- the newcomer: only what the goal card says ----------

  /** The first machine running this recipe, and the first Well on this material. */
  maker(recipe: string): GNode | null { return this.g.nodes.find((n) => n.recipe === recipe) ?? null; }
  wellOn(m: MatId): GNode | null { return this.g.nodes.find((n) => n.type === 'well' && n.material === m) ?? null; }
  wired(from: GNode, port: number, to: GNode): boolean { return this.outs(from, port).some((w) => w.to === to.id); }

  /**
   * What the goal card asks for next, read the way a newcomer reads it: the card's own words, one gesture at
   * a time, in the order the hint gives them (the same reading as tests/cardPlayer.ts). null = nothing to do
   * but wait: the next step cannot be paid for yet, or the card is waiting for the game. A step may cost
   * more credits than the player has; the caller waits for them.
   */
  cardStep(): Want | null {
    const g = this.g;
    const goal = activeGoal(g);
    const market = g.nodes.find((n) => n.type === 'market') ?? null;
    if (!goal || goal.free || !market) return null;
    const lab = g.nodes.find((n) => n.type === 'lab') ?? null;
    const wire = (from: GNode, port: number, to: GNode): Want => ({
      cls: 'fix', kind: 'wire', cost: 0, label: `card: wire ${this.name(from)} → ${this.name(to)}`, run: () => !!connect(g, from.id, port, to.id),
    });
    const wireIf = (from: GNode | null, port: number, to: GNode | null): Want | null => (from && to && !this.wired(from, port, to) ? wire(from, port, to) : null);
    const from = (src: GNode, port: number, type: NodeType, recipe: string | null = null): Want => ({
      cls: 'new', kind: 'build', cost: nodeCost(g, type),
      label: `card: build ${NODE_DEFS[type].name}${recipe ? ` (${RECIPES[recipe].name})` : ''} from ${this.name(src)}`,
      run: () => !!this.buildFrom({ n: src, port }, type, recipe),
    });
    const buy = (type: NodeType, recipe: string): Want => ({
      cls: 'new', kind: 'build', cost: nodeCost(g, type), label: `card: build ${NODE_DEFS[type].name} (${RECIPES[recipe].name})`,
      run: () => {
        const at = this.spot(null);
        const n = placeNode(g, type, at.x, at.y, { recipe });
        if (n) this.noteNode(type, recipe);
        return !!n;
      },
    });
    const well = (m: MatId): Want | null => {
      const d = freeDeposits(g).find((x) => x.mat === m);
      return !d ? null : {
        cls: 'new', kind: 'build', cost: nodeCost(g, 'well'), label: `card: place ${MATERIALS[m].name} Well`,
        run: () => {
          const n = placeNode(g, 'well', d.x, d.y, { depositId: d.id });
          if (n) this.noteNode('well');
          return !!n;
        },
      };
    };
    const study = (id: string): Want | null => (techAffordable(g, TECHS[id]) ? {
      cls: 'new', kind: 'research', cost: 0, label: `card: research ${id} ${TECHS[id].name} (${costStr(TECHS[id])})`, run: () => research(g, id),
    } : null);
    /** "Research X, then put a Well on the deposit, build a Refiner from its port and sell what it makes." */
    const rawLine = (tech: string, m: MatId, recipe: string): Want | null => {
      if (!has(g, tech)) return study(tech);
      const w = this.wellOn(m);
      if (!w) return well(m);
      const r = this.maker(recipe);
      return r ? wireIf(r, 0, market) : from(w, 0, 'refiner', recipe);
    };
    /** "Send what the order asks for to a Market." */
    const tendOrder = (): Want | null => {
      const o = g.order;
      if (!o || o.ready) return null;
      for (const n of g.nodes) {
        const port = n.recipe ? RECIPES[n.recipe].outputs.findIndex((out) => out[0] === o.mat) : -1;
        if (port >= 0 && !this.wired(n, port, market)) return wire(n, port, market);
      }
      return null;
    };
    const firstWell = g.nodes.find((n) => n.type === 'well') ?? null;
    switch (goal.id) {
      case 'wire-market': return wireIf(firstWell, 0, market);
      case 'second-well': return well('glint');
      case 'wire-all-wells': return wireIf(g.nodes.find((n) => n.type === 'well' && !this.outs(n).length) ?? null, 0, market);
      case 'build-refiner': return firstWell && !this.maker('shard') ? from(firstWell, 0, 'refiner', 'shard') : null;
      case 'sell-shard': return wireIf(this.maker('shard'), 0, market);
      case 'upgrade-well': return firstWell && {
        cls: 'new', kind: 'upgrade', cost: upgradeCost(firstWell, 'speed'), label: `card: upgrade ${this.name(firstWell)} speed`, run: () => upgrade(g, firstWell.id, 'speed'),
      };
      case 'feed-lab': {
        const shard = this.maker('shard');
        if (!shard) return null;
        return lab ? wireIf(shard, 0, lab) : from(shard, 0, 'lab');
      }
      case 'research-murk': return has(g, 'P2') ? null : study('P2');
      case 'make-ink': return rawLine('P2', 'murk', 'ink');
      case 'silt-exit': {
        const ink = this.maker('ink');
        if (!ink) return null;
        return wireIf(ink, 0, market) ?? (this.outs(ink, 1).length ? null : from(ink, 1, 'void'));
      }
      case 'make-spark': return rawLine('P3', 'ember', 'spark');
      case 'first-order': return tendOrder();
      case 'bulk-upgrade': {
        // "Select a Well and press Upgrade all beside Speed."
        const w = g.nodes.find((n) => n.type === 'well' && n.lv.speed < maxLevel(g, 'speed'));
        return w ? { cls: 'new', kind: 'upgrade', bulk: true, cost: upgradeCost(w, 'speed'), label: 'card: press Upgrade all on the Wells\' Speed', run: () => upgradeAll(g, 'well', 'speed') > 0 } : null;
      }
      case 'route-lab': {
        const router = g.nodes.find((n) => n.type === 'router') ?? null;
        const spark = this.maker('spark');
        if (!router) return spark && from(spark, 0, 'router'); // "Build a Router from the Spark Refiner's port...
        const step = wireIf(router, 0, lab) ?? wireIf(router, 0, market);
        if (step || routerFavoursLab(g) || !lab) return step;
        const toLab = this.outs(router).find((w) => w.to === lab.id)!;
        return { cls: 'fix', kind: 'route', cost: 0, label: 'card: press Favour on the Router\'s wire to the Lab', run: () => favour(g, router.id, toLab.id) };
      }
      case 'expand': return { cls: 'new', kind: 'expand', cost: expansionCost(g), label: 'card: expand the board', run: () => expandBoard(g) };
      case 'make-glyph': {
        if (!has(g, 'P4')) return study('P4');
        const a = this.maker('glyph');
        const ink = this.maker('ink');
        // "...build an Assembler from the Ink Refiner's Ink port, wire it to the Market, then wire Spark into it."
        if (!a) return ink ? from(ink, 0, 'assembler', 'glyph') : buy('assembler', 'glyph');
        const fed = (m: MatId) => this.ins(a).some((w) => materialsAt(g, w.from, w.port).includes(m));
        return (fed('ink') ? null : wireIf(this.maker('ink'), 0, a)) ?? wireIf(a, 0, market) ?? (fed('spark') ? null : wireIf(this.maker('spark'), 0, a));
      }
      case 'study-glyph': return wireIf(this.maker('glyph'), 0, lab);
      case 'make-mist': return rawLine('P5', 'breeze', 'mist');
      case 'make-prism': {
        const a = this.maker('prism');
        const mist = this.maker('mist');
        // "Build another Assembler from the Mist Refiner's port, wire it to the Market, then wire Shard into it."
        if (!a) return !has(g, 'P5') ? null : mist ? from(mist, 0, 'assembler', 'prism') : buy('assembler', 'prism');
        const fed = (m: MatId) => this.ins(a).some((w) => materialsAt(g, w.from, w.port).includes(m));
        return (fed('mist') ? null : wireIf(this.maker('mist'), 0, a)) ?? wireIf(a, 0, market) ?? (fed('shard') ? null : wireIf(this.maker('shard'), 0, a));
      }
      case 'build-fabricator': {
        // "Research Fabrication, then save up and build a Fabricator from the Prism Assembler's port."
        if (!has(g, 'P7')) return study('P7');
        const prism = this.maker('prism');
        return prism ? from(prism, 0, 'fabricator', 'lens') : buy('fabricator', 'lens');
      }
      case 'make-lens': {
        const f = this.maker('lens');
        if (!f) return null;
        const fed = (m: MatId) => this.ins(f).some((w) => materialsAt(g, w.from, w.port).includes(m));
        return (fed('prism') ? null : wireIf(this.maker('prism'), 0, f)) ?? (fed('glyph') ? null : wireIf(this.maker('glyph'), 0, f));
      }
      default: return null; // 'hold-flow': the card says where to look; what to do there is the adviser's
    }
  }

  /**
   * The card's "while you wait" line, read the way cardStep reads a hint: the next gesture it asks for. null
   * when the goal has no line, the line does not apply to this board, or it has been done. The lines come one at
   * a time (meanwhileOf); the gesture is the one the card's "Show me" acts out (lineAdvice in src/advice.ts),
   * which tests/meanwhile.test.ts holds to the line's own words.
   */
  meanwhileStep(): Want | null {
    const want = this.lineStep();
    const g = this.g;
    const id = activeGoal(g)?.id;
    const line = meanwhileOf(g);
    const key = id && line ? `${id}/${line.id}` : null;
    if (want && id && key && !this.linesBegun.has(key)) {
      this.linesBegun.add(key);
      CFG.onLine?.(g, id, line!.id);
    }
    return want;
  }

  /** Lines (goal/line) this player has begun to follow. */
  linesBegun = new Set<string>();

  lineStep(): Want | null {
    const g = this.g;
    const line = CFG.meanwhile && this.P.lines !== false ? meanwhileOf(g) : null;
    const goal = activeGoal(g);
    if (!line || !goal || line.done(g) || CFG.skipLines.includes(goal.id) || CFG.skipLines.includes(line.id)) return null;
    // --lineDelay: a person who reads the line late.
    if (CFG.lineDelay > 0 && (this.lineSeen?.goal !== g.goal.i || g.time - this.lineSeen.t < CFG.lineDelay)) return null;
    const a = lineAdvice(g);
    if (!a) return null;
    const kind: Kind = a.expand ? 'expand' : a.cut ? 'cut' : a.upgrade ? 'upgrade' : a.build ? 'build' : 'wire';
    return {
      cls: a.build || a.expand ? 'new' : 'fix', kind, cost: a.cost ?? 0, label: `card, meanwhile (${line.id}): ${a.text.mouse}`,
      run: () => {
        if (!applyAdvice(g, a)) return false;
        if (a.build) this.noteNode(a.build as NodeType, a.recipe ?? null);
        return true;
      },
    };
  }

  /** One decision of the newcomer: claim, then the card, then (in a wait) a tip that has been on offer long enough. */
  decideCard(): Want | null {
    const g = this.g;
    this.dawdling = false;
    this.tipOn = false;
    // Since when this goal's "while you wait" line has been on the card (for --lineDelay).
    if (this.lineSeen?.goal !== g.goal.i && CFG.meanwhile && this.P.lines !== false && meanwhileOf(g)) this.lineSeen = { goal: g.goal.i, t: g.time };
    if (g.goal.ready && g.time >= this.goalClaimAt) {
      const goal = activeGoal(g)!;
      return { cls: 'new', kind: 'claim', cost: 0, label: `claim goal ${g.goal.i + 1} "${goal.title}"`, run: () => claimGoal(g) };
    }
    if (g.order?.ready && g.time >= this.orderClaimAt) {
      const o = g.order;
      return { cls: 'new', kind: 'claim', cost: 0, label: `claim order: ${o.need} ${MATERIALS[o.mat].name}`, run: () => claimOrder(g) };
    }
    // The card's sentence is finished even if the goal completes half-way through it ("...and sell the Spark"):
    // the Claim button is only pressed 8–16 s after it lights up.
    const step = this.cardStep();
    if (step && step.cost <= g.credits + 1e-6 && (!g.goal.ready || step.kind === 'wire')) return step;
    if (g.goal.ready) {
      // The card says Claim; the player has not got to it yet.
      this.tipSince = null;
      this.dawdling = true;
      return null;
    }
    // Nothing the hint asks for can be done right now: the card's "while you wait" line, if it has one.
    const also = this.meanwhileStep();
    if (also && also.cost <= g.credits + 1e-6) return also;
    const goal = activeGoal(g);
    const kind = waitKind(g);
    this.idleWhy = `${step ? `saving for "${step.label}" ${fmt(step.cost)}¢ (have ${fmt(g.credits)}¢, +${f1(g.creditRate)}¢/s)` : kind ? `waiting (${kind})` : 'waiting for the game'}; goal ${g.goal.i + 1} "${goal?.title ?? '—'}"`;
    // A player who takes no tips takes none: on the Flow goal too, which its valve passes without one.
    const tip = CFG.tips && this.P.tips && goal && !goal.free ? advice(g) : null;
    if (!tip) {
      this.tipSince = null;
      this.tipShown = '';
      if (g.order?.ready) this.dawdling = true; // only a Claim button left
      return null;
    }
    if (tip.text.mouse !== this.tipShown) {
      this.tipShown = tip.text.mouse;
      this.tipsOffered.push({ t: g.time, goal: g.goal.i, text: tip.text.mouse, saves: tip.saves });
    }
    this.tipOn = true;
    // --tipEvery: a tip the player has let pass stays on the card, unfollowed, for as long as it is on offer.
    if (tip.text.mouse === this.tipPassed) return null;
    if (this.tipSince == null) this.tipSince = g.time;
    if (g.time - this.tipSince < this.P.tipDelay) return null;
    this.tipSince = null;
    if (CFG.tipEvery > 1 && (++this.tipsDue - CFG.tipFirst) % CFG.tipEvery !== 0) {
      this.tipPassed = tip.text.mouse;
      return null;
    }
    const index = g.goal.i;
    return {
      cls: 'grow', cost: tip.cost ?? 0, gestures: tip.steps ?? 1, tip, bulk: !!tip.all,
      kind: tip.upgrade ? 'upgrade' : tip.build ? 'build' : tip.research ? 'research' : tip.cut ? 'cut' : tip.favour ? 'route' : 'wire',
      label: `TIP (${tip.kind}; wait ${isFinite(tip.eta) ? Math.round(tip.eta) + 's' : '∞'}, saves ${tip.saves == null ? '?' : isFinite(tip.saves) ? Math.round(tip.saves) + 's' : 'the wait'}): ${tip.text.mouse}`,
      run: () => {
        if (!applyAdvice(g, tip)) return false;
        this.tipsTaken.push({ t: g.time, goal: index, text: tip.text.mouse, kind: tip.kind, eta: tip.eta, saves: tip.saves, cost: tip.cost ?? 0 });
        if (tip.build) this.noteNode(tip.build as NodeType, tip.recipe ?? null);
        return true;
      },
    };
  }

  endTipless() {
    if (this.tiplessSince == null) return;
    if (this.g.time - this.tiplessSince > 1e-6) this.tipless.push({ from: this.tiplessSince, to: this.g.time, goal: this.g.goal.i, why: this.idleFirstWhy, trials: this.tiplessTrials });
    this.tiplessSince = null;
  }

  /** --trials: what the adviser weighed, and how each candidate did, at the start of a wait with no tip. */
  trialLines(): string[] {
    const g = this.g;
    const w = waitInfo(g);
    const t = adviceTrials(g);
    if (!t) return ['(not a wait the adviser knows)'];
    const sec = (x: number) => (isFinite(x) ? `${Math.round(x)}s` : '∞');
    const lines = [`wait: ${t.kind}${w ? `, ${fmt(w.have)}/${fmt(w.need)} ${w.unit}, about ${sec(w.eta)} to go` : ''}; doing nothing ends in ${sec(t.idle.ends)} (score ${sec(t.idle.score)}); ${fmt(g.credits)}¢ in hand`];
    for (const x of t.trials) lines.push(`${x.worth ? 'WORTH' : '  –  '} ${x.doable ? `ends ${pad(sec(x.ends), 5)} score ${pad(sec(x.score), 5)}` : 'cannot be done          '} ${pad(x.cost ? fmt(x.cost) + '¢' : '', 6)}  ${x.text}`);
    if (!t.trials.length) lines.push('no candidates at all');
    if (t.kind === 'flow') {
      for (const n of g.nodes) {
        if (countsForFlow(g, n) && !isFlowing(n)) lines.push(`not flowing: ${this.name(n)} at ${Math.round(n.util * 100)}%, ${n.status}${n.missing ? `, missing ${n.missing}` : ''}${n.blockedOn ? `, blocked on ${n.blockedOn}` : ''}, ${Math.round(g.time - n.born)}s old; out → ${(graph(g).outs.get(n.id) ?? []).flat().map((w) => this.name(this.node(w.to))).join(', ') || 'nothing'}`);
      }
    }
    return lines;
  }

  /** Every Router the player has built: wire it to the Lab and the Market, and keep its ratio where it should be. */
  routerWants(W: Want[], market: GNode | null) {
    const g = this.g;
    const goal = g.goal.ready ? null : activeGoal(g);
    for (const r of g.nodes) {
      if (r.type !== 'router' || !this.ins(r).length) continue;
      const m = materialsAt(g, r.id)[0];
      if (!m || !market) continue;
      const tier = matTier(m);
      const lab = this.labFor(tier);
      if (!lab) continue;
      const toLab = this.outs(r).find((w) => w.to === lab.id);
      const toMarket = this.outs(r).find((w) => w.to === market.id);
      if (!toLab) {
        W.push({ cls: 'fix', kind: 'wire', cost: 0, label: 'wire Router → Lab', run: () => !!connect(g, r.id, 0, lab.id) });
        continue;
      }
      if (!toMarket) {
        W.push({ cls: 'fix', kind: 'wire', cost: 0, label: 'wire Router → Market', run: () => !!connect(g, r.id, 0, market.id) });
        continue;
      }
      // Study most of it while that Data is short; sell most of it while an order asks for the material,
      // or when the Data is only wanted for later; sell all of it when there is nothing left to research with it.
      const ordered = !!g.order && !g.order.ready && g.order.mat === m;
      let want: [number, number] = CFG.studyRatio;
      let why = `more ${GREEK[tier]}`;
      if (goal?.id === 'route-lab') why = 'goal';
      else if (!this.tierNeeded(tier)) { want = [0, 1]; why = `no ${GREEK[tier]} left to spend`; }
      else if (ordered) { want = CFG.sellRatio; why = `the order wants ${MATERIALS[m].name}`; }
      else if (!this.shortTiers().has(tier)) { want = CFG.sellRatio; why = `enough ${GREEK[tier]} for now`; }
      if (r.mode === 'ratio' && toLab.weight === want[0] && toMarket.weight === want[1]) continue;
      W.push({
        cls: want[0] === 0 ? 'grow' : 'fix', kind: 'route', cost: 0, settle: [lab.id],
        label: `set Router (${MATERIALS[m].name}) to Lab ${want[0]} : Market ${want[1]} (${why})`,
        run: () => {
          setMode(g, r.id, 'ratio');
          setWeight(g, toLab.id, want[0]);
          setWeight(g, toMarket.id, want[1]);
          return true;
        },
      });
    }
  }

  // ---------- one decision ----------

  /** True when the only thing left to do is tap a Claim button the player has not got round to yet. */
  dawdling = false;
  /** Saving for a new toy: its price, lifetime credits when the saving began, and what has gone on small things since. */
  savingFor: number | null = null;
  savingBase = 0;
  pettySpent = 0;

  decide(): Want | null {
    const g = this.g;
    if (this.P.card) return this.decideCard();
    this.dawdling = false;
    if (g.goal.ready && g.time >= this.goalClaimAt) {
      const goal = activeGoal(g)!;
      return { cls: 'new', kind: 'claim', cost: 0, label: `claim goal ${g.goal.i + 1} "${goal.title}"`, run: () => claimGoal(g) };
    }
    if (g.order?.ready && g.time >= this.orderClaimAt) {
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
    const can = (w: Want) => !w.locked && w.cost <= g.credits + 1e-6;
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
      const eta = Math.max(0, target.cost - g.credits) / Math.max(g.creditRate, 1e-6);
      // Only a never-had toy is worth sitting on credits for; for "one more of the same" the player keeps tinkering.
      saving = !!target.novel && eta <= this.P.patience;
      cap = target.cost * (saving ? this.P.pettyShare : this.P.growShareOfTarget);
    }
    // The toy cannot be bought yet (its tech is not researched) and its price is already in the bank:
    // keep that much back and spend the rest freely.
    const reserve = target?.locked && g.credits >= target.cost ? g.credits - target.cost : 0;
    if (reserve > 0) {
      saving = false;
      cap = Math.max(cap, reserve);
    }
    // A new toy that cannot be paid for yet: from then on everything else comes out of a budget, a share of
    // what has been earned since the saving began. (With its price already in the bank, the rest is free to spend.)
    const short = !!target?.novel && g.credits < target.cost;
    if (short && target) {
      if (this.savingFor !== target.cost) {
        this.savingFor = target.cost;
        this.savingBase = g.lifetime;
        this.pettySpent = 0;
      }
    } else this.savingFor = null;
    const budget = short && this.P.spendShare < 1 ? this.P.spendShare * (g.lifetime - this.savingBase) - this.pettySpent : Infinity;
    const petty = (w: Want): Want => (short ? { ...w, run: () => { const ok = w.run(); if (ok) this.pettySpent += w.cost; return ok; } } : w);
    // "One more of the same" (another Well, another Refiner, more board) never comes out of the money put aside for a new toy.
    const spare = target?.novel ? Math.max(target.cost * this.P.pettyShare, reserve) : Infinity;
    const buy = news.find((w) => can(w) && w.cost <= spare && w.cost <= budget);
    if (buy) return petty(buy);
    const grows = wants.filter((w) => w.cls === 'grow').sort((a, b) => a.cost - b.cost);
    const grow = grows.find((w) => can(w) && w.cost <= cap && w.cost <= budget);
    if (grow) return petty(grow);
    if ((g.goal.ready && isFinite(this.goalClaimAt)) || (g.order?.ready && isFinite(this.orderClaimAt))) {
      this.dawdling = true;
      return null;
    }
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
    if (g.order && !g.order.ready) parts.push(`order ${Math.floor(g.order.got)}/${g.order.need} ${MATERIALS[g.order.mat].name}`);
    const goal = activeGoal(g);
    if (goal) parts.push(`goal ${g.goal.i + 1} "${goal.title}"`);
    if (!parts.length) parts.push('nothing left that the player wants');
    this.idleWhy = parts.join('; ');
    return null;
  }

  endIdle(endedBy: string) {
    if (this.idleSince == null) return;
    if (this.g.time - this.idleSince > 1e-6) this.waits.push({ from: this.idleSince, to: this.g.time, why: this.idleFirstWhy, endedBy });
    this.idleSince = null;
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
      if (this.dawdling) {
        this.endIdle('(a Claim button lit up)');
        this.endTipless();
        return;
      }
      if (this.idleSince == null) {
        this.idleSince = g.time;
        this.idleFirstWhy = this.idleWhy;
      }
      // The newcomer: waiting with nothing the card asks. With no tip on offer either, that is a tip-less stretch.
      if (this.P.card) {
        if (this.tipOn) this.endTipless();
        else if (this.tiplessSince == null) {
          this.tiplessSince = g.time;
          this.tiplessTrials = CFG.trials ? this.trialLines() : [];
        }
      }
      this.mIdle += CFG.dt;
      return;
    }
    const before = g.credits;
    const rev = g.rev;
    const ok = want.run();
    if (!ok) {
      // Should not happen; make it loud so the policy gets fixed rather than silently stalling.
      this.log(`!! FAILED: ${want.label}`);
      this.freeAt = g.time + 1;
      return;
    }
    this.endTipless();
    this.endIdle(want.label);
    // The board has changed: whatever is on offer next is a new offer. (A claim changes nothing on the board:
    // the tip that was on the card before it is the same tip after it, and is not counted twice.)
    if (g.rev !== rev) {
      this.tipShown = '';
      this.tipPassed = '';
    }
    if (want.kind === 'upgrade') this.presses[want.bulk ? 'bulk' : want.label.startsWith('upgrade wire') ? 'wire' : 'single']++;
    const spent = before - g.credits;
    this.mSpent += Math.max(0, spent);
    this.actions++;
    this.mActions++;
    this.log(`${want.label}${spent > 0.5 ? `  [−${fmt(spent)}¢ → ${fmt(g.credits)}¢]` : ''}`);
    for (const id of want.settle ?? []) this.ignoreUntil.set(id, g.time + this.P.settleTime);
    const [lo, hi] = this.P.actionSeconds[want.kind];
    this.freeAt = g.time + (want.gestures ?? 1) * (lo + this.rnd() * (hi - lo));
  }

  // ---------- game events and sampling ----------

  /** Remember when each tech first became researchable (its prerequisites are owned). */
  noteAvailable() {
    for (const t of Object.values(TECHS)) {
      if (this.techAvailAt[t.id] == null && techAvailable(this.g, t)) this.techAvailAt[t.id] = this.g.time;
    }
  }

  /**
   * A tech's price in seconds of the Data income (Labs, orders and goals) of the three minutes before it was bought.
   * A tier the player could already afford three minutes earlier does not count: nobody was waiting on it.
   * Called right after the purchase, so g.data is already net of the price.
   */
  wallOf(t: Tech): number {
    const now = this.g.time;
    let worst = 0;
    for (const k of TIERS) {
      const c = t.cost[k] ?? 0;
      if (!c) continue;
      const since = Math.max(this.firstDataAt[k] ?? now, now - 180);
      const window = now - since;
      const log = this.earnedLog[k];
      const got = this.earned[k] - (log[Math.min(log.length - 1, Math.max(0, Math.floor(since)))] ?? 0);
      if (this.g.data[k] - got >= 0) continue; // had it all along
      const rate = window > 1 ? got / window : 0;
      worst = Math.max(worst, rate > 1e-9 ? c / rate : Infinity);
    }
    return worst;
  }

  drainEvents() {
    const g = this.g;
    const pay = (r: Reward) => {
      this.rewardTotal.credits += r.credits ?? 0;
      for (const k of TIERS) {
        this.rewardTotal[k] += r[k] ?? 0;
        this.earned[k] += r[k] ?? 0;
        if (r[k] && this.firstDataAt[k] == null) this.firstDataAt[k] = g.time;
      }
    };
    for (const ev of g.events.splice(0)) {
      if (ev.kind === 'milestone') {
        this.log(`· first ${MATERIALS[ev.mat].name}`);
        this.markNew(`first ${MATERIALS[ev.mat].name}`);
      } else if (ev.kind === 'tech') {
        this.techAt[ev.id] = g.time;
        this.markNew(`tech ${ev.id} ${TECHS[ev.id].name}`);
        if (ev.id === 'P7') this.mark('Fabrication researched: the saving begins');
        if (TECHS[ev.id].auto) this.log(`· ${ev.id} ${TECHS[ev.id].name} unlocked (${TECHS[ev.id].auto})`);
        else this.techWall[ev.id] = this.wallOf(TECHS[ev.id]);
        this.noteAvailable();
      } else if (ev.kind === 'goal-ready') {
        this.goalReadyAt[ev.goal] = g.time;
        const [lo, hi] = this.P.claimDelay;
        this.goalClaimAt = g.time + lo + this.rnd() * (hi - lo);
        this.log(`· goal ${ev.index + 1} ready: ${GOALS[ev.index].title}`);
      } else if (ev.kind === 'goal-claimed') {
        this.goalClaimedAt[ev.goal] = g.time;
        this.goalClaimAt = Infinity;
        pay(ev.reward);
        if (ev.goal === 'bulk-upgrade') this.mark('"Build a Fabricator" becomes the goal');
        this.markNew(`goal ${ev.index + 1} claimed`);
        this.log(`★ goal ${ev.index + 1} claimed${ev.big ? ' (BIG)' : ''}: ${rewardText(ev.reward)}`);
      } else if (ev.kind === 'order-new') {
        this.orderClaimAt = Infinity;
        this.orderLog.push({ t: g.time, text: `${ev.quiet ? 'swapped in' : 'new'}: ${ev.order.need} ${MATERIALS[ev.order.mat].name} for ${payText(ev.order.reward)}` });
        this.log(`· order${ev.quiet ? ' (swapped, no deliveries)' : ''}: deliver ${ev.order.need} ${MATERIALS[ev.order.mat].name} for ${payText(ev.order.reward)}`);
      } else if (ev.kind === 'order-ready') {
        const [lo, hi] = this.P.claimDelay;
        this.orderClaimAt = g.time + lo + this.rnd() * (hi - lo);
        this.orderTimes.push(g.time - ev.order.created);
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
        if (ev.what === 'flow') {
          const counted = g.nodes.filter((n) => countsForFlow(g, n));
          const slow = counted.filter((n) => !isFlowing(n));
          this.flowAtUnlock = { t: g.time, flow: g.flow, producers: counted.length, flowing: counted.length - slow.length, slow: slow.map((n) => `${this.name(n)} ${Math.round(n.util * 100)}%`) };
          this.log(`· Flow at the unlock: ${Math.round(g.flow * 100)}%, ${counted.length - slow.length} of ${counted.length} producers flowing${slow.length ? ` (not: ${this.flowAtUnlock.slow.join(', ')})` : ''}`);
        }
      } else if (ev.kind === 'surplus') {
        this.surplusAt = { t: g.time, goal: g.goal.i, mat: ev.mat };
        this.log(`· first sale over demand: ${MATERIALS[ev.mat].name}`);
      } else if (ev.kind === 'demo-end') {
        this.statsAtEnd = { ...g.stats };
        this.pressesAtLens = { ...this.presses };
        this.log('★ DEMO COMPLETE: first Lens');
      } else if (ev.kind === 'toast') {
        this.log(`!! refused: ${ev.text}`);
      }
    }
    // A goal or order that was already ready when the previous one was claimed raises its event inside the claim.
    if (g.goal.ready && !isFinite(this.goalClaimAt)) this.goalClaimAt = g.time + this.P.claimDelay[0];
    if (g.order?.ready && !isFinite(this.orderClaimAt)) this.orderClaimAt = g.time + this.P.claimDelay[0];
    for (const k in g.made) if (this.madeAt[k as MatId] == null) this.madeAt[k as MatId] = g.time;
  }

  run() {
    const g = this.g;
    const steps = Math.round((this.minutes * 60) / CFG.dt);
    let nextSample = 60;
    let nextSecond = 1;
    for (let i = 0; i < steps; i++) {
      // The newcomer's script ends with the demo: nothing on a free-play card is read.
      if (this.P.card && g.goal.i >= MAIN_GOALS) {
        this.drainEvents();
        this.minutes = Math.ceil(g.time / 60);
        break;
      }
      tick(g, CFG.dt);
      this.mIncome += g.tickAcc.credits;
      for (const m in g.tickAcc.sold) this.mWorth += (g.tickAcc.sold[m as MatId] ?? 0) * valueOf(g, m as MatId) * flowMult(g);
      for (const k of TIERS) {
        const d = g.tickAcc.data[k];
        this.mData[k] += d;
        this.earned[k] += d;
        if (d > 0 && this.firstDataAt[k] == null) this.firstDataAt[k] = g.time;
      }
      this.drainEvents();
      this.trackStatus();
      this.step();
      this.noteNothing();
      if (g.time >= nextSecond - 1e-9) {
        for (const k of TIERS) this.earnedLog[k].push(this.earned[k]);
        nextSecond += 1;
      }
      if (g.time >= nextSample - 1e-9) {
        this.minutes_.push({
          t: nextSample, credits: g.credits, income: this.mIncome / 60,
          data: { ...g.data }, dataRate: { a: this.mData.a / 60, b: this.mData.b / 60, g: this.mData.g / 60 },
          nodes: g.nodes.length, techs: g.techs.length, actions: this.mActions, idle: this.mIdle, spent: this.mSpent, flow: g.flow,
          // sales = full + surplusShare × rest, so full = (sales − share × worth) / (1 − share), as a share of all sales
          full: this.mWorth > 0 ? Math.max(0, Math.min(1, (this.mIncome - RULES.demand.surplusShare * this.mWorth) / ((1 - RULES.demand.surplusShare) * this.mIncome))) : 1,
          glut: (Object.keys(MATERIALS) as MatId[]).filter((m) => (g.soldRate[m] ?? 0) > demandRate(g, m) * 1.05)
            .map((m) => `${MATERIALS[m].name} ${f1(g.soldRate[m] ?? 0)}/${f1(demandRate(g, m))}`).join(', '),
        });
        this.mWorth = 0;
        this.mIncome = 0;
        this.mData = { a: 0, b: 0, g: 0 };
        this.mActions = 0;
        this.mIdle = 0;
        this.mSpent = 0;
        nextSample += 60;
      }
    }
    this.endTipless();
    this.endIdle('(still waiting when the session ended)');
    this.endNothing();
  }

  /** One tick of the "nothing to do" measure (see `nothing`). */
  noteNothing() {
    const g = this.g;
    const before = !g.ended;
    const none = before && this.idleSince != null && !this.dawdling && !g.goal.ready && !g.order?.ready && !lineAdvice(g);
    if (!none) {
      this.endNothing();
      return;
    }
    if (this.nothingSince == null) {
      this.nothingSince = g.time - CFG.dt;
      this.nothingGoal = g.goal.i;
    }
    this.nothing.total += CFG.dt;
    this.nothing.perGoal[g.goal.i] = (this.nothing.perGoal[g.goal.i] ?? 0) + CFG.dt;
  }

  endNothing() {
    if (this.nothingSince == null) return;
    this.nothing.stretches.push({ from: this.nothingSince, to: this.g.time - CFG.dt, goal: this.nothingGoal });
    this.nothingSince = null;
  }
}

// =====================================================================================
// Measuring a run against the targets
// =====================================================================================

interface GoalTime { index: number; id: string; title: string; free: boolean; activeAt: number; readyAt: number | null; claimedAt: number | null; spent: number }

interface Result {
  policy: Policy;
  seed: number;
  minutes: number;
  firstMachine: number | null;
  lab: number | null;
  firstResearch: number | null;
  glyph: number | null;
  lens: number | null;
  paradox: number | null;
  /** When the last new thing happened (tech, material, goal). */
  lastNew: number;
  /** Longest stretch with nothing to do that began in the first two minutes. */
  earlyIdle: number;
  deadBefore10: number;
  deadBeforeLens: number;
  goals: GoalTime[];
  /** Longest time on one goal of the demo, from the claim before it to its own claim. */
  goalMax: { seconds: number; title: string };
  /** Share of credits earned before the first Lens that came from sales and orders. */
  earnedShare: number | null;
  /** Worst goal-path tech: price in seconds of Data income at the time. */
  wall: { id: string; seconds: number };
  ordersFilled: number;
  orderMedian: number;
  flowStates: number;
  /** Seconds on "Build a Fabricator" (null if it was never claimed). */
  fabricator: number | null;
  /** Presses of an Upgrade button before the first Lens (or in the whole run without one): one node, "Upgrade all", a wire. */
  presses: { single: number; bulk: number; wire: number; total: number };
  /** The newcomer: longest stretch in a wait with no tip on offer and nothing the card asks, and the goal it fell in. */
  tipless: { seconds: number; goal: string };
  tips: number;
  /**
   * The newcomer's tips up to the first Lens: how many came on offer and how many were followed; among the
   * followed, how many were steps without which the wait would not have ended, and the smallest and the
   * median of the savings the others promised at the moment they were followed.
   */
  tipStats: { offered: number; followed: number; rescues: number; smallest: number | null; median: number | null };
  flowAtUnlock: Bot['flowAtUnlock'];
  /** Seconds on "Hold Flow", and the actions taken while it was the goal. */
  flowGoal: { seconds: number; actions: string[] } | null;
  surplusAt: Bot['surplusAt'];
  /**
   * "Nothing to do" up to the first Lens (Bot.nothing): seconds in all, their share of the time to the Lens, the
   * longest stretch and the goal it fell in, and the seconds on each goal (by index).
   */
  nothing: { total: number; share: number; longest: number; longestGoal: string; perGoal: Record<number, number> };
}

function measure(bot: Bot): Result {
  const g = bot.g;
  const end = bot.minutes * 60;
  const lens = bot.madeAt.lens ?? null;
  const longest = (before: number) => bot.waits.filter((w) => w.from < before).reduce((m, w) => Math.max(m, Math.min(w.to, before) - w.from), 0);
  const goals: GoalTime[] = [];
  let prev = 0;
  GOALS.forEach((goal, index) => {
    if (index > g.goal.i) return;
    const readyAt = bot.goalReadyAt[goal.id] ?? null;
    const claimedAt = bot.goalClaimedAt[goal.id] ?? null;
    goals.push({ index, id: goal.id, title: goal.title, free: !!goal.free, activeAt: prev, readyAt, claimedAt, spent: (claimedAt ?? end) - prev });
    if (claimedAt != null) prev = claimedAt;
  });
  const main = goals.filter((x) => !x.free);
  const worst = main.reduce((m, x) => (x.spent > m.spent ? x : m), main[0]);
  const st = bot.statsAtEnd;
  let wall = { id: '—', seconds: 0 };
  for (const id of GOAL_TECHS) {
    const s = bot.techWall[id];
    if (s != null && s > wall.seconds) wall = { id, seconds: s };
  }
  const times = [...bot.orderTimes].sort((a, b) => a - b);
  const fab = goals.find((x) => x.id === 'build-fabricator');
  const hold = goals.find((x) => x.id === 'hold-flow');
  const longestTipless = bot.tipless.reduce((m, x) => (x.to - x.from > m.to - m.from ? x : m), { from: 0, to: 0, goal: 0, why: '' });
  const p = bot.pressesAtLens ?? bot.presses;
  return {
    fabricator: fab && fab.claimedAt != null ? fab.spent : null,
    presses: { ...p, total: p.single + p.bulk + p.wire },
    tipless: { seconds: longestTipless.to - longestTipless.from, goal: GOALS[longestTipless.goal]?.title ?? '—' },
    tips: bot.tipsTaken.length,
    tipStats: (() => {
      const finite = bot.tipsTaken.map((t) => t.saves).filter((x): x is number => x != null && isFinite(x)).sort((a, b) => a - b);
      return {
        offered: bot.tipsOffered.length, followed: bot.tipsTaken.length, rescues: bot.tipsTaken.length - finite.length,
        smallest: finite.length ? finite[0] : null, median: finite.length ? finite[Math.floor(finite.length / 2)] : null,
      };
    })(),
    flowAtUnlock: bot.flowAtUnlock,
    flowGoal: hold && hold.claimedAt != null
      ? { seconds: hold.spent, actions: bot.timeline.filter((e) => e.t >= hold.activeAt && e.t < (hold.readyAt ?? hold.claimedAt!) && !/^[·★!]/.test(e.text)).map((e) => e.text) }
      : null,
    surplusAt: bot.surplusAt,
    nothing: (() => {
      const long = bot.nothing.stretches.reduce((m, x) => (x.to - x.from > m.to - m.from ? x : m), { from: 0, to: 0, goal: 0 });
      return {
        total: bot.nothing.total, share: bot.nothing.total / Math.max(1, lens ?? end), longest: long.to - long.from,
        longestGoal: GOALS[long.goal]?.title ?? '—', perGoal: { ...bot.nothing.perGoal },
      };
    })(),
    policy: bot.P, seed: bot.seed, minutes: bot.minutes,
    firstMachine: bot.firstNode.refiner ?? null,
    lab: bot.firstNode.lab ?? null,
    firstResearch: Object.entries(bot.techAt).filter(([id]) => !TECHS[id].auto).map(([, t]) => t).sort((a, b) => a - b)[0] ?? null,
    glyph: bot.madeAt.glyph ?? null,
    lens,
    paradox: bot.madeAt.paradox ?? null,
    lastNew: bot.lastNewAt,
    earlyIdle: longest(120),
    deadBefore10: longest(600),
    deadBeforeLens: longest(lens ?? end),
    goals,
    goalMax: { seconds: worst.spent, title: worst.title },
    earnedShare: st ? (st.fromSales + st.fromOrders) / Math.max(1, st.fromSales + st.fromOrders + st.fromGoals + st.fromAway) : null,
    wall,
    ordersFilled: g.stats.ordersFilled,
    orderMedian: times.length ? times[Math.floor(times.length / 2)] : 0,
    flowStates: bot.flowStates.length,
  };
}

interface Check { label: string; value: string; target: string; ok: boolean }

function checks(r: Result): Check[] {
  const out: Check[] = [];
  const add = (label: string, value: string, target: string, ok: boolean) => out.push({ label, value, target, ok });
  const by = (label: string, t: number | null, limit: number) => add(label, mmss(t), `by ${mmss(limit)}`, t != null && t <= limit);
  const within = (label: string, t: number | null, [lo, hi]: [number, number]) => add(label, mmss(t), `${mmss(lo)}–${mmss(hi)}`, t != null && t >= lo && t <= hi);
  const fabricator = (limit: number) => add('time on "Build a Fabricator"', r.fabricator == null ? '—' : `${Math.round(r.fabricator)}s`, `≤ ${limit}s`, r.fabricator != null && r.fabricator <= limit);
  const goalMax = (limit: number) => add('longest on one goal', `${Math.round(r.goalMax.seconds)}s (${r.goalMax.title})`, `≤ ${limit}s`, r.lens != null && r.goalMax.seconds <= limit);
  const judge = r.policy.judge;
  if (judge === 'fast') {
    const T = TARGETS.fast;
    by('first machine', r.firstMachine, T.firstMachineBy);
    by('first Lab', r.lab, T.labBy);
    by('first research', r.firstResearch, T.firstResearchBy);
    add('longest wait in the first 2 min', `${Math.round(r.earlyIdle)}s`, `≤ ${T.earlyIdleMax}s`, r.earlyIdle <= T.earlyIdleMax);
    within('first Glyph', r.glyph, T.glyph);
    within('first Lens', r.lens, T.lens);
    fabricator(T.fabricatorMax);
    add('longest dead stretch before 10:00', `${Math.round(r.deadBefore10)}s`, `≤ ${T.deadBefore10}s`, r.deadBefore10 <= T.deadBefore10);
    add('longest dead stretch before the Lens', `${Math.round(r.deadBeforeLens)}s`, `≤ ${T.deadBeforeLens}s`, r.lens != null && r.deadBeforeLens <= T.deadBeforeLens);
    add('content lasts (first Paradox)', r.paradox == null ? `not within ${r.minutes} min` : mmss(r.paradox), `${mmss(T.contentUntil)}–${mmss(T.paradoxBy)}`, r.paradox != null && r.paradox >= T.contentUntil && r.paradox <= T.paradoxBy);
  } else if (judge === 'newcomer') {
    const T = TARGETS.newcomer;
    within('first Lens', r.lens, T.lens);
    goalMax(T.goalMax);
    fabricator(T.fabricatorMax);
  } else if (judge === 'newcomer10') {
    const T = TARGETS.newcomer10;
    by('first Lens', r.lens, T.lensBy);
    goalMax(T.goalMax);
  } else if (judge === 'cardonly') {
    const T = TARGETS.cardonly;
    within('first Lens', r.lens, T.lens);
    goalMax(T.goalMax);
    add('longest stretch with nothing to do', `${Math.round(r.nothing.longest)}s (${r.nothing.longestGoal})`, `≤ ${T.nothingStretch}s`, r.nothing.longest <= T.nothingStretch);
    add('nothing to do, share of the time to the Lens', `${Math.round(r.nothing.share * 100)}%`, `≤ ${Math.round(T.nothingShare * 100)}%`, r.lens != null && r.nothing.share <= T.nothingShare);
  } else if (judge === 'nolines') {
    by('first Lens', r.lens, TARGETS.nolines.lensBy);
  } else {
    const T = TARGETS.slow;
    by('first Lens', r.lens, T.lensBy);
    goalMax(T.goalMax);
    add('dearest goal-path tech, in Data income', `${isFinite(r.wall.seconds) ? Math.round(r.wall.seconds) + 's' : 'never'} (${r.wall.id})`, `≤ about ${T.dataWall}s`, r.wall.seconds <= T.dataWall * 1.1);
  }
  add('credits from sales and orders at the Lens', r.earnedShare == null ? '—' : `${Math.round(r.earnedShare * 100)}%`, `≥ ${Math.round(TARGETS.earnedShare * 100)}%`, r.earnedShare != null && r.earnedShare >= TARGETS.earnedShare);
  return out;
}

// ---------- upgrade payback (worked out from the content tables, no bot needed) ----------

interface Payback { what: string; level: number; cost: number; gain: number; seconds: number; note: string; other: number; otherNote: string; demo: boolean }

/** Recipes the demo's goal chain asks for; the rest is free play and is listed without a verdict. */
const DEMO_RECIPES = ['shard', 'ink', 'spark', 'mist', 'glyph', 'prism', 'lens'];

/** What a first and second Speed level cost and earn, for every Well and machine. */
function paybacks(): Payback[] {
  const rows: Payback[] = [];
  const probe = newGame().nodes[0];
  const worth = (list: [MatId, number][]) => list.reduce((s, [m, q]) => s + (isJunk(m) ? 0 : MATERIALS[m].value * q), 0);
  for (const m of Object.keys(MATERIALS) as MatId[]) {
    if (MATERIALS[m].tier !== 0) continue;
    const r = Object.values(RECIPES).find((x) => x.inputs.length === 1 && x.inputs[0][0] === m && MATERIALS[x.outputs[0][0]].tier === 1);
    for (const level of [0, 1]) {
      const at = (lv: number) => wellRate({ ...probe, material: m, lv: { speed: lv, eff: 0, buffer: 0 } });
      const more = at(level + 1) - at(level);
      const cost = upgradeCostAt('well', 'speed', level);
      const refined = r ? (more / r.inputs[0][1]) * worth(r.outputs) : 0;
      const raw = more * MATERIALS[m].value;
      rows.push({
        what: `${MATERIALS[m].name} Well`, level: level + 1, cost, gain: refined, seconds: cost / refined, note: `refined into ${r ? r.name : '?'}`,
        other: cost / raw, otherNote: 'sold raw', demo: true,
      });
    }
  }
  for (const r of Object.values(RECIPES) as Recipe[]) {
    for (const level of [0, 1]) {
      const at = (lv: number) => 1 / cycleTime({ ...probe, lv: { speed: lv, eff: 0, buffer: 0 } }, r);
      const more = at(level + 1) - at(level);
      const cost = upgradeCostAt(r.machine, 'speed', level);
      const gross = more * worth(r.outputs);
      const net = more * (worth(r.outputs) - worth(r.inputs));
      rows.push({
        what: `${NODE_DEFS[r.machine].name} (${r.name})`, level: level + 1, cost, gain: gross, seconds: cost / gross, note: 'input was backing up',
        other: cost / net, otherNote: 'input was selling at full price', demo: DEMO_RECIPES.includes(r.id),
      });
    }
  }
  return rows;
}

// =====================================================================================
// Report
// =====================================================================================

function report(bot: Bot, profile: Profile, profileName: string, timeline: boolean): string {
  const g = bot.g;
  const r = measure(bot);
  const out: string[] = [];
  const P = (s = '') => out.push(s);
  P('='.repeat(110));
  P(`FLOWSTATE PACING BOT — policy "${bot.P.name}" (${bot.P.describe}), seed ${bot.seed}, ${bot.minutes} min`);
  if (profileName !== 'current') P(`profile "${profileName}": ${profile.describe}`);
  P('='.repeat(110));

  P();
  P('== AGAINST THE TARGETS (docs/PITCH_PLAN.md section 1, as amended for the newcomer) ==');
  for (const c of checks(r)) P(`  ${c.ok ? 'ok  ' : 'MISS'}  ${padR(c.label, 44)} ${padR(c.value, 34)} target ${c.target}`);

  if (timeline) {
    P();
    P('== EVENT TIMELINE ==');
    for (const e of bot.timeline) P(`${mmss(e.t)}  ${e.text}`);
  }

  P();
  P('== GOALS (on it = from the claim before to its own claim) ==');
  P('   #  goal                                      ready   claimed  on it  reward');
  for (const x of r.goals) {
    P(`  ${pad(x.index + 1, 2)}${x.free ? '*' : ' '} ${padR(x.title, 40)}  ${mmss(x.readyAt)}   ${mmss(x.claimedAt)}  ${pad(Math.round(x.spent), 4)}s  ${rewardText(GOALS[x.index].reward)}`);
  }
  P(`  claimed ${Math.min(g.goal.i, MAIN_GOALS)}/${MAIN_GOALS} (+${Math.max(0, g.goal.i - MAIN_GOALS)} free play, marked *); longest on one goal of the demo: ${Math.round(r.goalMax.seconds)}s (${r.goalMax.title})`);

  P();
  P('== TECHS (wait = since it could first be researched; "income" = its price in seconds of the Data income of the 3 minutes before) ==');
  const techs = Object.entries(bot.techAt).sort((a, b) => a[1] - b[1]);
  for (const [id, t] of techs) {
    const tech = TECHS[id];
    const wall = bot.techWall[id];
    const tail = tech.auto ? 'goal reward' : `${padR(costStr(tech), 12)} wait ${pad(Math.round(t - (bot.techAvailAt[id] ?? t)), 4)}s   income ${wall == null ? '—' : isFinite(wall) ? pad(Math.round(wall), 4) + 's' : 'never'}${GOAL_TECHS.includes(id) ? '   ← goal path' : ''}`;
    P(`  ${mmss(t)}  ${padR(id, 3)} ${padR(tech.name, 20)} ${tail}`);
  }
  const missing = Object.values(TECHS).filter((t) => !g.techs.includes(t.id));
  P(`  not researched after ${bot.minutes} min: ${missing.map((t) => `${t.id} ${t.name} (${costStr(t)})`).join(', ') || 'none'}`);

  P();
  P('== FIRSTS ==');
  const mats = (Object.entries(bot.madeAt) as [MatId, number][]).sort((a, b) => a[1] - b[1]);
  P(`  materials: ${mats.map(([m, t]) => `${MATERIALS[m].name} ${mmss(t)}`).join(' · ')}`);
  const never = (Object.keys(MATERIALS) as MatId[]).filter((m) => bot.madeAt[m] == null);
  P(`  never made: ${never.map((m) => MATERIALS[m].name).join(', ') || 'none'}`);
  P(`  nodes: ${(Object.entries(bot.firstNode) as [NodeType, number][]).sort((a, b) => a[1] - b[1]).map(([type, t]) => `${NODE_DEFS[type].name} ${mmss(t)}`).join(' · ')}`);

  P();
  P('== PER MINUTE (rates are averages over that minute; idle = seconds with free hands and nothing useful to do) ==');
  P(' min  credits    ¢/s  spent      α    α/s      β    β/s      γ    γ/s  flow nodes techs  acts  idle  full-price  sold over demand (sold/demand per s)');
  for (const m of bot.minutes_) {
    P(`${pad(m.t / 60, 4)} ${pad(fmt(m.credits), 8)} ${pad(f1(m.income), 6)} ${pad(fmt(m.spent), 6)} ${pad(Math.floor(m.data.a), 6)} ${pad(f1(m.dataRate.a), 6)} ${pad(Math.floor(m.data.b), 6)} ${pad(f1(m.dataRate.b), 6)} ${pad(Math.floor(m.data.g), 6)} ${pad(f1(m.dataRate.g), 6)} ${pad(Math.round(m.flow * 100) + '%', 5)} ${pad(m.nodes, 5)} ${pad(m.techs, 5)} ${pad(m.actions, 5)} ${pad(Math.round(m.idle), 5)} ${pad(Math.round(m.full * 100) + '%', 10)}   ${m.glut}`);
  }

  P();
  P(`== DEAD STRETCHES (${CFG.deadStretch}s or more with free hands and nothing useful to do) ==`);
  const dead = bot.waits.filter((w) => w.to - w.from >= CFG.deadStretch);
  if (!dead.length) P('  none');
  for (const d of dead) {
    P(`  ${mmss(d.from)} → ${mmss(d.to)}  (${Math.round(d.to - d.from)}s)  waiting: ${d.why}`);
    P(`        ended by: ${d.endedBy}`);
  }
  const idleAll = bot.minutes_.reduce((s, m) => s + m.idle, 0);
  P(`  longest before 10:00: ${Math.round(r.deadBefore10)}s; longest before the first Lens: ${Math.round(r.deadBeforeLens)}s; longest starting in the first 2 min: ${Math.round(r.earlyIdle)}s`);
  P(`  total idle: ${Math.round(idleAll)}s of ${bot.minutes * 60}s; actions: ${bot.actions}`);
  const top = [...bot.waits].sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 8).sort((a, b) => a.from - b.from);
  P(`  longest waits: ${top.map((w) => `${mmss(w.from)} ${Math.round(w.to - w.from)}s`).join(' · ') || 'none'}`);

  P();
  P('== UPGRADES, AND THE SAVE FOR THE FABRICATOR ==');
  P(`  presses of an Upgrade button ${bot.pressesAtLens ? 'before the first Lens' : 'in this run (no Lens)'}: ${r.presses.total} (${r.presses.single} on one node, ${r.presses.bulk} "Upgrade all", ${r.presses.wire} on a wire)${bot.pressesAtLens ? `; in the whole run: ${bot.presses.single + bot.presses.bulk + bot.presses.wire}` : ''}`);
  for (const m of bot.marks) P(`  ${mmss(m.t)}  ${padR(m.what, 46)} ${pad(fmt(m.credits), 7)}¢ in hand, +${f1(m.income)}¢/s, ${Math.floor(m.a)}α, ${Math.floor(m.b)}β`);
  P(`  time on "Build a Fabricator": ${r.fabricator == null ? '—' : Math.round(r.fabricator) + 's'}; first sale over demand: ${bot.surplusAt ? `${mmss(bot.surplusAt.t)} (${MATERIALS[bot.surplusAt.mat].name}, during goal ${bot.surplusAt.goal + 1})` : 'never'}`);

  if (bot.P.card) {
    P();
    P('== THE NEWCOMER: TIPS FOLLOWED ==');
    for (const t of bot.tipsTaken) {
      P(`  ${mmss(t.t)}  goal ${pad(t.goal + 1, 2)}  ${padR(t.kind, 7)} wait ${pad(isFinite(t.eta) ? Math.round(t.eta) + 's' : '∞', 5)}  saves ${pad(t.saves == null ? '?' : isFinite(t.saves) ? Math.round(t.saves) + 's' : 'all', 5)}  ${pad(t.cost ? fmt(t.cost) + '¢' : '', 6)}  ${t.text}`);
    }
    P(`  ${bot.tipsTaken.length} tips followed`);
    P();
    P('== THE NEWCOMER: WAITS WITH NO TIP ON OFFER AND NOTHING THE CARD ASKS (20 s or more) ==');
    const long = bot.tipless.filter((x) => x.to - x.from >= 20);
    if (!long.length) P('  none');
    for (const x of long) {
      P(`  ${mmss(x.from)} → ${mmss(x.to)}  (${Math.round(x.to - x.from)}s)  goal ${x.goal + 1}: ${x.why}`);
      for (const line of x.trials) P(`        ${line}`);
    }
    P(`  longest: ${Math.round(r.tipless.seconds)}s (${r.tipless.goal})`);
  }

  P();
  P('== WHERE CREDITS CAME FROM ==');
  const sources = (label: string, st: Stats) => {
    const total = st.fromSales + st.fromOrders + st.fromGoals + st.fromAway || 1;
    const pct = (n: number) => `${Math.round((100 * n) / total)}%`;
    P(`  ${padR(label, 20)} sales ${fmt(st.fromSales)}¢ (${pct(st.fromSales)}) · orders ${fmt(st.fromOrders)}¢ (${pct(st.fromOrders)}) · goals ${fmt(st.fromGoals)}¢ (${pct(st.fromGoals)}) → sales + orders ${pct(st.fromSales + st.fromOrders)}`);
  };
  if (bot.statsAtEnd) sources('at the first Lens:', bot.statsAtEnd);
  sources(`after ${bot.minutes} min:`, g.stats);
  P(`  Data from goals and orders: ${Math.round(bot.rewardTotal.a)}α, ${Math.round(bot.rewardTotal.b)}β, ${Math.round(bot.rewardTotal.g)}γ`);

  P();
  P('== ORDERS AND FLOW ==');
  P(`  orders claimed: ${g.stats.ordersFilled}; median time to fill: ${Math.round(r.orderMedian)}s; longest: ${Math.round(Math.max(0, ...bot.orderTimes))}s`);
  for (const o of bot.orderLog) P(`    ${mmss(o.t)}  ${o.text}`);
  P(`  Flow States: ${bot.flowStates.length}${bot.flowStates.length ? ` (first at ${mmss(bot.flowStates[0])})` : ''}; best streak ${Math.round(g.flowBest)}s; Flow now ${Math.round(g.flow * 100)}%${g.flowOn ? '' : ' (locked)'}`);

  P();
  P('== WHERE THE CONTENT RUNS OUT ==');
  P(`  last new thing: ${mmss(bot.lastNewAt)} (${bot.lastNewWhat}); techs owned ${g.techs.length}/${Object.keys(TECHS).length}; board expansions ${g.board.expansions}`);
  P(`  at the end: ${fmt(g.credits)}¢ banked, +${f1(g.creditRate)}¢/s, α ${Math.floor(g.data.a)} (+${f1(g.dataRate.a)}/s), β ${Math.floor(g.data.b)} (+${f1(g.dataRate.b)}/s), γ ${Math.floor(g.data.g)} (+${f1(g.dataRate.g)}/s)`);
  const avail = Object.values(TECHS).filter((t) => techAvailable(g, t) && !CFG.techSkip.includes(t.id)).map((t) => ({ t, eta: techEta(g, t) })).sort((a, b) => a.eta - b.eta);
  for (const { t, eta } of avail) P(`    could research ${padR(t.id, 3)} ${padR(t.name, 20)} ${padR(costStr(t), 12)} ${isFinite(eta) ? (eta <= 0 ? 'now' : `in ${Math.ceil(eta / 60)} min`) : 'never (no income of that Data)'}`);
  const wants = bot.wants().filter((w) => w.cls === 'new').sort((a, b) => a.cost - b.cost).slice(0, 4);
  for (const w of wants) P(`    still wants ${padR(fmt(w.cost) + '¢', 9)} ${w.label}  (${w.cost <= g.credits ? 'affordable' : `${Math.ceil((w.cost - g.credits) / Math.max(g.creditRate, 1e-6) / 60)} min away`})`);
  return out.join('\n');
}

function paybackReport(): string {
  const out: string[] = [];
  const [lo, hi] = TARGETS.payback;
  out.push(`== UPGRADE PAYBACK: what the first two Speed levels cost and earn (target ${lo}–${hi}s where the input exists; "—" = free play, not judged) ==`);
  for (const p of paybacks()) {
    const ok = Math.round(p.seconds) >= lo && Math.round(p.seconds) <= hi;
    out.push(`  ${!p.demo ? '—   ' : ok ? 'ok  ' : 'MISS'}  ${padR(p.what, 22)} L${p.level} ${pad(fmt(p.cost) + '¢', 7)}  +${pad(f1(p.gain), 5)}¢/s → ${pad(Math.round(p.seconds), 4)}s (${p.note})   ${pad(isFinite(p.other) ? Math.round(p.other) : '∞', 5)}s if ${p.otherNote}`);
  }
  return out.join('\n');
}

function summary(results: Result[]): string {
  const out: string[] = [];
  const P = (s = '') => out.push(s);
  const mark = (ok: boolean) => (ok ? ' ' : '!');
  const F = TARGETS.fast;
  const inW = (t: number | null, [lo, hi]: [number, number]) => t != null && t >= lo && t <= hi;
  const pressText = (r: Result) => `${r.presses.total}${r.presses.bulk ? ` (${r.presses.bulk} all)` : ''}`;
  const fast = results.filter((r) => r.policy.judge === 'fast');
  if (fast.length) {
    P('== FAST PLAYERS: every run against the targets ("!" marks a miss) ==');
    P('policy    seed  machine    Lab  research   Glyph    Lens  Fabricator  Paradox  idle<2m  dead<10m  dead<Lens  sales+orders  upgrade presses  orders     Flow States  first surplus  longest goal');
    P(`target           ≤${mmss(F.firstMachineBy)} ≤${mmss(F.labBy)}  ≤${mmss(F.firstResearchBy)}  ${mmss(F.glyph[0])}–${mmss(F.glyph[1]).slice(1)} ${mmss(F.lens[0])}–${mmss(F.lens[1]).slice(0, 2)}  ≤${F.fabricatorMax}s     ≥${mmss(F.contentUntil)}  ≤${F.earlyIdleMax}s    ≤${F.deadBefore10}s      ≤${F.deadBeforeLens}s       ≥${Math.round(TARGETS.earnedShare * 100)}%`);
    for (const r of fast) {
      P([
        padR(r.policy.name, 9), pad(r.seed, 4), ' ',
        pad(mmss(r.firstMachine), 6) + mark(r.firstMachine != null && r.firstMachine <= F.firstMachineBy),
        pad(mmss(r.lab), 6) + mark(r.lab != null && r.lab <= F.labBy),
        pad(mmss(r.firstResearch), 8) + mark(r.firstResearch != null && r.firstResearch <= F.firstResearchBy),
        pad(mmss(r.glyph), 7) + mark(inW(r.glyph, F.glyph)),
        pad(mmss(r.lens), 7) + mark(inW(r.lens, F.lens)),
        pad(r.fabricator == null ? '—' : Math.round(r.fabricator) + 's', 10) + mark(r.fabricator != null && r.fabricator <= F.fabricatorMax),
        pad(mmss(r.paradox), 8) + mark(r.paradox == null || r.paradox >= F.contentUntil),
        pad(Math.round(r.earlyIdle) + 's', 7) + mark(r.earlyIdle <= F.earlyIdleMax),
        pad(Math.round(r.deadBefore10) + 's', 8) + mark(r.deadBefore10 <= F.deadBefore10),
        pad(Math.round(r.deadBeforeLens) + 's', 9) + mark(r.lens != null && r.deadBeforeLens <= F.deadBeforeLens),
        pad(r.earnedShare == null ? '—' : Math.round(r.earnedShare * 100) + '%', 12) + mark(r.earnedShare != null && r.earnedShare >= TARGETS.earnedShare),
        pad(pressText(r), 15), ' ',
        pad(`${r.ordersFilled} (${Math.round(r.orderMedian)}s)`, 10),
        pad(r.flowStates, 11), ' ',
        pad(r.surplusAt ? `${mmss(r.surplusAt.t)} ${MATERIALS[r.surplusAt.mat].name}` : 'never', 13), ' ',
        `${Math.round(r.goalMax.seconds)}s ${r.goalMax.title}`,
      ].join(' '));
    }
    P();
  }
  const card = results.filter((r) => r.policy.judge !== 'fast');
  if (card.length) {
    const N = TARGETS.newcomer;
    const N10 = TARGETS.newcomer10;
    const C = TARGETS.cardonly;
    const S = TARGETS.slow;
    const limits = (r: Result): { lensOk: boolean; goal: number; fab: number } => {
      const j = r.policy.judge;
      if (j === 'newcomer') return { lensOk: inW(r.lens, N.lens), goal: N.goalMax, fab: N.fabricatorMax };
      if (j === 'cardonly') return { lensOk: inW(r.lens, C.lens), goal: C.goalMax, fab: C.goalMax };
      if (j === 'nolines') return { lensOk: r.lens != null && r.lens <= TARGETS.nolines.lensBy, goal: Infinity, fab: Infinity };
      const T = j === 'newcomer10' ? N10 : S;
      return { lensOk: r.lens != null && r.lens <= T.lensBy, goal: T.goalMax, fab: T.goalMax };
    };
    P('== THE NEWCOMER (the card, its "while you wait" lines, and the tips): every run against the targets ("!" marks a miss) ==');
    P('policy      seed    Lens   longest goal                        Fabricator  free hands   tips: offered  followed  smallest  median  upgrade presses  sales+orders  Flow at unlock  first surplus');
    P(`newcomer         ${mmss(N.lens[0])}–${mmss(N.lens[1]).slice(0, 2)}  ≤${N.goalMax}s                               ≤${N.fabricatorMax}s                                                                                    ≥${Math.round(TARGETS.earnedShare * 100)}%`);
    P(`newcomer10       ≤${mmss(N10.lensBy)}   ≤${N10.goalMax}s                               (≤${N10.goalMax}s)`);
    P(`cardonly         ${mmss(C.lens[0])}–${mmss(C.lens[1]).slice(0, 2)}  ≤${C.goalMax}s                               (≤${C.goalMax}s)`);
    P(`nolines          ≤${mmss(TARGETS.nolines.lensBy)}`);
    for (const r of card) {
      const L = limits(r);
      const flow = r.flowAtUnlock;
      const sec = (x: number | null) => (x == null ? '—' : `${Math.round(x)}s`);
      P([
        padR(r.policy.name, 11), pad(r.seed, 4), ' ',
        pad(mmss(r.lens), 6) + mark(L.lensOk), ' ',
        padR(`${Math.round(r.goalMax.seconds)}s ${r.goalMax.title}`.slice(0, 34), 34) + mark(r.lens != null && r.goalMax.seconds <= L.goal),
        pad(r.fabricator == null ? '—' : Math.round(r.fabricator) + 's', 9) + mark(r.fabricator != null && r.fabricator <= L.fab),
        pad(Math.round(r.deadBeforeLens) + 's', 11),
        pad(r.tipStats.offered, 16),
        pad(`${r.tipStats.followed}${r.tipStats.rescues ? ` (${r.tipStats.rescues} ∞)` : ''}`, 9),
        pad(sec(r.tipStats.smallest), 9),
        pad(sec(r.tipStats.median), 7),
        pad(pressText(r), 16), ' ',
        pad(r.earnedShare == null ? '—' : Math.round(r.earnedShare * 100) + '%', 12) + mark(r.earnedShare != null && r.earnedShare >= TARGETS.earnedShare),
        pad(flow ? `${Math.round(flow.flow * 100)}% (${flow.flowing}/${flow.producers})` : '—', 14), ' ',
        pad(r.surplusAt ? `${mmss(r.surplusAt.t)} ${MATERIALS[r.surplusAt.mat].name}` : 'never', 13),
      ].join(' '));
    }
    P('  "free hands" is the longest stretch with nothing the card asks, a tip on offer or not (a tip is followed 15 s after it appears).');
    P('  Tips: "offered" counts each tip that came on offer during a wait; "smallest" and "median" are the seconds the followed tips said they would save');
    P('  when they were followed; "(n ∞)" of them were steps without which the wait would not have ended (they have no number).');
    P();
  }
  P('== NOTHING TO DO, up to the first Lens: free hands, goal not ready, no order to claim, no step of the card\'s line that can be done now ==');
  P(`policy      seed    Lens  nothing   share  longest stretch                        seconds on each goal with nothing to do (goal: s, 10 s or more)`);
  for (const r of results) {
    const x = r.nothing;
    const per = Object.entries(x.perGoal).filter(([, s]) => s >= 10).map(([i, s]) => `${Number(i) + 1}: ${Math.round(s)}`).join(' · ');
    P([
      padR(r.policy.name, 11), pad(r.seed, 4), ' ', pad(mmss(r.lens), 6), pad(Math.round(x.total) + 's', 8), pad(Math.round(x.share * 100) + '%', 7), ' ',
      padR(`${Math.round(x.longest)}s ${x.longestGoal}`.slice(0, 38), 38), ' ', per,
    ].join(' '));
  }
  P();
  const misses = results.reduce((n, r) => n + checks(r).filter((c) => !c.ok).length, 0);
  P(misses ? `${misses} target(s) missed.` : 'Every target met.');
  P();
  P('== GOALS: when each was claimed, and the seconds spent on it, per run ==');
  P(`${padR('', 44)}${results.map((r) => pad(`${r.policy.name.replace('newcomer', 'new').slice(0, 5)}/${r.seed}`, 12)).join('')}`);
  GOALS.forEach((goal, i) => {
    const cells = results.map((r) => {
      const x = r.goals.find((y) => y.index === i);
      return pad(x && x.claimedAt != null ? `${mmss(x.claimedAt)} ${pad(Math.round(x.spent), 3)}s` : '—', 12);
    });
    P(`${pad(i + 1, 2)}${goal.free ? '*' : ' '} ${padR(goal.title, 40)}${cells.join('')}`);
  });
  const held = results.filter((r) => r.flowGoal);
  if (held.length) {
    P();
    P('== "HOLD FLOW": what each run did between the unlock and the goal completing ==');
    for (const r of held) {
      const f = r.flowAtUnlock;
      P(`  ${padR(`${r.policy.name}/${r.seed}`, 14)} ${f ? `${Math.round(f.flow * 100)}% at the unlock, ${f.flowing}/${f.producers} flowing${f.slow.length ? ` (not: ${f.slow.join(', ')})` : ''}` : ''}; ${Math.round(r.flowGoal!.seconds)}s on the goal; ${r.flowGoal!.actions.length} action(s)`);
      for (const a of r.flowGoal!.actions.slice(0, 6)) P(`      ${a.slice(0, 200)}`);
    }
  }
  return out.join('\n');
}

// =====================================================================================
// CLI
// =====================================================================================

function main() {
  let policy: string | null = null;
  let policies = DEFAULT_POLICIES;
  let seed: number | null = null;
  let minutes: number | null = null;
  let profileName = 'current';
  let quiet = false;
  let onlySummary = false;
  const overrides: string[] = [];
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-zA-Z0-9]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'profile' && v) profileName = v;
    else if (k === 'policy' && v) policy = v;
    else if (k === 'policies' && v) policies = v.split(',');
    else if (k === 'seed' && v) seed = Number(v);
    else if (k === 'seeds' && v) CFG.seeds = v.split(',').map(Number);
    else if (k === 'minutes' && v) minutes = Number(v);
    else if (k === 'quiet') quiet = true;
    else if (k === 'summary') onlySummary = true;
    else if (k === 'set' && v) overrides.push(v);
    else if (k === 'noBulk') CFG.bulk = false;
    else if (k === 'noTips') CFG.tips = false;
    else if (k === 'noMeanwhile') CFG.meanwhile = false;
    else if (k === 'minShare' && v) ADVICE.minShare = Number(v);
    else if (k === 'lineReserve' && v) ADVICE.lineReserve = v !== '0';
    else if (k === 'skipLine' && v) CFG.skipLines = v.split(',');
    else if (k === 'lineDelay' && v) CFG.lineDelay = Number(v);
    else if (k === 'tipDelay' && v) {
      for (const pol of Object.values(POLICIES)) if (pol.card) pol.tipDelay = Number(v);
    } else if (k === 'tipEvery' && v) {
      const [n, first] = v.split(',').map(Number);
      CFG.tipEvery = Math.max(1, n);
      CFG.tipFirst = first || CFG.tipEvery;
    } else if (k === 'hands' && v) {
      for (const pol of Object.values(POLICIES)) {
        if (!pol.card) continue;
        pol.actionSeconds = hands([Number(v), Number(v)]);
        pol.firstActionDelay = 6 + Number(v);
      }
    }
    else if (k === 'trials') CFG.trials = true;
    else if ((k === 'spendShare' || k === 'pettyBudget') && v) {
      for (const pol of Object.values(POLICIES)) if (!pol.card) pol.spendShare = Number(v);
    } else if (k === 'patience' && v) for (const pol of Object.values(POLICIES)) pol.patience = Number(v);
  }
  const say = (s: string) => process.stdout.write(s + '\n');
  const profile = PROFILES[profileName];
  if (!profile) {
    say(`Unknown profile "${profileName}". Known: ${Object.keys(PROFILES).join(', ')}`);
    return;
  }
  const unknown = [...(policy ? [policy] : []), ...policies].find((name) => !POLICIES[name]);
  if (unknown) {
    say(`Unknown policy "${unknown}". Known: ${Object.keys(POLICIES).join(', ')}`);
    return;
  }
  profile.apply?.();
  for (const o of overrides) applyOverrides(o);
  const what = [
    profileName !== 'current' ? `profile "${profileName}": ${profile.describe}` : '', ...overrides.map((o) => `--set=${o}`),
    CFG.bulk ? '' : '--noBulk', CFG.tips ? '' : '--noTips', CFG.meanwhile ? '' : '--noMeanwhile',
    ...process.argv.slice(2).filter((a) => /^--(skipLine|lineDelay|tipDelay|tipEvery|hands|minShare)=/.test(a)),
  ].filter(Boolean).join('  ');
  const play = (p: Policy, s: number) => {
    const bot = new Bot(p, s, minutes ?? (p.card ? CFG.minutesCard : p.fast ? CFG.minutesFast : CFG.minutesSlow));
    bot.run();
    return bot;
  };

  if (policy) {
    // One run in full.
    const bot = play(POLICIES[policy], seed ?? 0);
    if (what) say(`WHAT-IF: ${what}`);
    say(report(bot, profile, profileName, !quiet));
    say('');
    say(paybackReport());
    return;
  }
  // Every policy and seed.
  const results: Result[] = [];
  const firsts: Bot[] = [];
  for (const name of policies) {
    const p = POLICIES[name];
    for (const s of seed != null ? [seed] : CFG.seeds) {
      const bot = play(p, s);
      results.push(measure(bot));
      if (firsts.every((b) => b.P !== p)) firsts.push(bot);
    }
  }
  if (!onlySummary) for (const bot of firsts) say(report(bot, profile, profileName, false) + '\n');
  if (what) say(`WHAT-IF: ${what}`);
  say(summary(results));
  say('');
  say(paybackReport());
}

/** One run and its verdict against the targets, for tests/pacing.test.ts. */
export function playOnce(policy: string, seed: number): {
  lens: number | null;
  checks: { label: string; value: string; target: string; ok: boolean }[];
  /** Tips that came on offer and tips followed (card players; both 0 for a player who takes none). */
  tips: { offered: number; followed: number };
  /** Seconds on "Hold 95% Flow", from the claim before it to its own (null if it was never claimed). */
  flowGoal: number | null;
  /** "Nothing to do" up to the first Lens (Result.nothing). */
  nothing: Result['nothing'];
} {
  const p = POLICIES[policy];
  const bot = new Bot(p, seed, p.card ? CFG.minutesCard : p.fast ? CFG.minutesFast : CFG.minutesSlow);
  bot.run();
  const r = measure(bot);
  return { lens: r.lens, checks: checks(r), tips: { offered: r.tipStats.offered, followed: r.tipStats.followed }, flowGoal: r.flowGoal?.seconds ?? null, nothing: r.nothing };
}

// From the command line (npm run pacing) this file is the program; a test that imports it only wants the exports.
if (!process.env.VITEST) main();

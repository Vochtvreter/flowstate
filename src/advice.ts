// The adviser: when the player is waiting (saving credits or Data for what the goal card asks, holding
// Flow, or filling an order), name the single most useful thing they can do right now. DOM-free.
//
// A tip is never a rule of thumb. Every candidate is tried on a copy of the game (src/forecast.ts): one copy
// gets the action, an untouched copy gets nothing, both run forward with the real rules, and the tip is only
// given if the wait really ends sooner with it. Tips are ranked by the seconds they save. That costs
// simulation time, so a verdict is kept for a while (ADVICE.refresh) and until the board changes: a call
// that has to work one out takes some tens of milliseconds, every other call is free.
//
//   waitInfo(g)       what the goal card is waiting for, and how long that takes at the current income
//   savingFor(g)      the research the card is saving for; researchDelay(g, id) what another research costs it
//   advice(g)         one tip, or null
//   lineAdvice(g)     the next step of the goal card's "while you wait" line, in the shape of a tip, or null
//   applyAdvice(g, a) do what a tip or a line's step says, through the normal actions (for bots and tests)
//
// Few tips, and large ones. The moves that matter most are on the goal cards themselves (Goal.meanwhile in
// src/goals.ts), because the card is what every player reads. What is left for a tip:
//  - It saves at least ADVICE.minSaves seconds (15), or it ends a wait that would otherwise never end, or it is
//    a Flow tip that gets the producer it names flowing. A two-second tip costs more hand time than it saves.
//  - After the player changes the board (following a tip, or anything else) the adviser says nothing for
//    RULES.tips.quiet seconds (20): tips are for a player with free hands, and never arrive in a chain.
//  - It never asks again for what has just been done to the same kind of node, for RULES.tips.repeatAfter
//    seconds (60): no "buy Speed on a Lab" twice running.
//  - It never reverses a goal card. "Cut this wire" is only ever said when the active card says so too,
//    and a Router that a card had turned toward a Lab is never turned away from it.
//  - It never says what the card is saying already: while the card's "while you wait" line is up and not
//    done, the step that line asks for next (lineAdvice) is not offered as a tip as well.
//  - Every tip carries `saves` (a number of seconds, or Infinity when the wait would not end without it), and
//    every sentence fits RULES.tips.maxLength characters (90), for mouse and for touch.
//
// How it judges, each point learnt from a newcomer's run (`npm run pacing -- --policy=newcomer --trials`):
//  - A goal that asks for a research and then a machine is one wait, for credits and Data both: candidates
//    for either are tried, and the wait is over when the last of them is in hand.
//  - A Flow tip is about one producer, and is true when that producer flows with the fix and would not have
//    without it. It need not finish the goal: a board with three things wrong takes a tip for each.
//  - The look-ahead uses a coarse step, so a saving that is not large is checked again at a fine one.
//  - A tip does not come back: once it has left the card it is not offered again until the board changes.
//
// In the copies nobody plays: nothing is bought or researched, the order the game has is claimed the moment
// it fills, and no new order is rolled (what the next one asks for is luck). The orders to come are not left
// out, though: the copy is paid what they are worth per second on its own board, on average (ordersWorth in
// src/orders.ts). A wire that takes goods from the Markets makes every later order smaller, and a copy
// with no orders after the first could not see that cost.
import {
  act, buildNote, connect, cutNote, cutWire, expandBoard, favour, favourNote, favouredWire, freeDeposits, materialsAt, pickRecipe, placeNode,
  upgrade, upgradeAll, upgradeAllNote, upgradeNote, wireNote,
} from './actions';
import { DATA_NAMES, DATA_WORTH, DATA_YIELD, DataTier, MATERIALS, MAT_IDS, MatId, NODE_DEFS, NodeType, RECIPES, RULES, TECHS, Track } from './content';
import {
  costText, dataYield, demandInfo, demandShown, expansionCost, has, labRate, maxLevel, nodeCost, recipeOf, research, techAffordable,
  techAvailable, trackAvailable, upgradeCost, wellRate,
} from './economy';
import { countsForFlow, isFlowing } from './flow';
import { Forecast, forecast, lookahead } from './forecast';
import { activeGoal, depositsFrom, flowFix, goalAge, lensMaker, meanwhileAt, meanwhileOf, ownPairs, pairedWells, rawGlintWell } from './goals';
import { graph, isMachine, isPass } from './graph';
import { claimOrder, orderReachesMarket, ordersWorth } from './orders';
import { tick } from './sim';
import { Bag, Game, GNode, Wire, nodeNoun } from './state';

export interface Advice {
  /** What is short: credits, Data, or Flow. (A tip about the order counts as credits: orders are filled by selling.) */
  kind: 'credits' | 'data' | 'flow';
  /** One short sentence for mouse and keyboard, and one for touch (no key names, "tap" not "click"). */
  text: { mouse: string; touch: string };
  /** The node to show the player, if the advice is about one: the node to upgrade, the node whose port to wire or build from, the Router. */
  node?: number;
  /** A node type to build, if the advice is to build something. */
  build?: string;
  /** Seconds the current wait would take if nothing changed (Infinity when it would never end). */
  eta: number;
  /**
   * Seconds the tip saves on the current wait, as measured. Every tip advice() gives carries it: a number, or
   * Infinity when the wait would not end without the tip. That includes a tip that is one step of several
   * (a Flow tip that gets its producer flowing on a board with two more things wrong; a tip that gets one kind
   * of Data coming in while another the same research needs still has none): the wait cannot end without it.
   */
  saves?: number;
  /** Credits the action costs (0 for a wire or a Router setting; a tech's price is in its text). */
  cost?: number;
  /** The upgrade track to highlight on `node`. With `all`, the tip is the "upgrade all" button for that kind of node. */
  upgrade?: Track;
  all?: boolean;
  /** Connect two existing nodes: from `from`'s output port `port` (0 when absent) to `to`. */
  wire?: { from: number; to: number; port?: number };
  /** With `build`: the output port of `node` to build from, or the deposit to put a Well on... */
  port?: number;
  deposit?: number;
  /** ...the recipe of a machine that is built, and the existing node the new one is then wired to. */
  recipe?: string;
  to?: number;
  /** Press Favour on this wire of this Router (`node` is the Router too). */
  favour?: { router: number; wire: number };
  /** Research this tech. */
  research?: string;
  /** Cut this wire (it runs from `from` to `to`; `node` is `from`). */
  cut?: { wire: number; from: number; to: number };
  /** Expand the board (the Expand button; `cost` is its price). Only ever a step of a goal card's line (lineAdvice), never a tip. */
  expand?: true;
  /** A Flow tip: the Well or machine that is holding Flow back, which the tip gets flowing, or a good deal closer to it (`node` is what to act on). */
  culprit?: number;
  /** Gestures the tip takes: 1, or 2 when something is built and then wired on. */
  steps?: number;
}

export interface WaitInfo {
  /**
   * What is being waited for: credits or one kind of Data, whichever takes longest. That covers a tech with two
   * prices, and a goal that asks for a research and then a machine: while the machine's price is further off
   * than the Data, the wait is for credits, even though the card is still counting Data toward the research.
   */
  unit: '¢' | 'α' | 'β' | 'γ';
  have: number;
  need: number;
  /** Seconds until `have` reaches `need` at the current income from sales and Labs. Infinity at zero income. */
  eta: number;
  /**
   * What is being saved for, as the card would name it: the tech ("Assembly") while its Data is what takes
   * longest, the thing bought with the credits otherwise ("the Fabricator"). So that a card can say
   * "Assembly about 1 min 20 s sooner". Absent where the goal counts Data in hand and buys nothing.
   */
  name?: string;
}

/** Tunables of the adviser. Times are game seconds. */
export const ADVICE = {
  /**
   * Step of the look-ahead copies. Coarse on purpose: a dozen candidates are tried on every verdict. The
   * simulation gives nearly the same totals at any step up to a second, but only nearly: a saving of a few
   * seconds, or of a few per cent of a long wait, can be an artefact of the step. So unless a tip saves both
   * `checkBelow` seconds and `checkShare` of the wait, it is tried once more against doing nothing at `fine`,
   * close to the game's own pace: it is only given if the saving is still there, and that is the saving it
   * is given with.
   */
  step: 0.5,
  fine: 0.1,
  checkBelow: 10,
  checkShare: 0.2,
  /** Every candidate is tried for this long; the best two are then run on until the wait ends... */
  screen: 40,
  /** ...or until this long has passed. Beyond it the end of the wait is worked out from the income at that point. */
  horizon: 300,
  /** Flow tips are judged over this long: a fix, 20 s for anything new to count, and the goal's 10 s. */
  flowScreen: 50,
  /** A Flow tip that does not get its producer all the way to flowing must raise its utilisation by at least this much. */
  flowStep: 0.15,
  /** For the Flow goal the board is watched this long on a copy: a producer that dips under the mark in that time is one to fix. */
  flowWatch: 20,
  /** No tip for a wait that ends within this time anyway. */
  minWait: 12,
  /**
   * A tip must save at least this many seconds (and this share of a very long wait). Smaller savings are real
   * too, but a tip takes a player ten seconds to read and do: in a run of 19 followed tips, eight saved under
   * five seconds each and seven carried 313 of the 356 seconds promised. Two cases need no saving at all: a
   * wait that would never end without the tip, and a Flow tip that gets its producer flowing.
   *
   * The share stays at 1%. A share of 8%, up to 30 s (so that a promise of 15 or 20 s in a wait of five minutes,
   * which is inside what the orders' lumps of pay move the real outcome by, is not made) was tried and measured
   * in the real game on seeds 0 to 14, and not adopted. The card-following players are offered and follow exactly the
   * same tips either way. For the player who follows tips and ignores the cards' lines it did not reliably
   * make the tips truer (worse timings: 6 of 688 at 1% against 13 of 650 at 8% at 6 s an action, 10 of 644
   * against 4 of 632 at 10 s; on the boards of the hints as they were a commit earlier, 14 against 5 and 6
   * against 1), and it took a tenth of that player's tips away, true ones among them: their slowest Lens went
   * from 26:20 to 28:50, and from 27:49 to 31:00 at 10 s an action. `npm run pacing -- --minShare=0.08` tries a share.
   */
  minSaves: 15,
  minShare: 0.01,
  /**
   * When the wait outlasts the look-ahead its end is worked out from the income at the horizon, which is good
   * to a few per cent: a tip then has to save this share of the wait as well.
   */
  estSaves: 15,
  estShare: 0.04,
  /**
   * The tip on offer stays ahead of another unless that one ends the wait this many seconds sooner, and this
   * share of the wait sooner: two tips about equally good must not take turns on the card. (There is no lower
   * bar for a tip on offer any more: it has to keep saving `minSaves` like any other, and one that falls
   * below is gone until the board changes.)
   */
  keepWithin: 3,
  keepShare: 0.05,
  /**
   * A verdict (a tip, or none) is kept this long while the board does not change, and never for more than
   * `refreshShare` of the wait it was worked out for: near the end of a wait a tip goes stale in seconds.
   */
  refresh: 15,
  refreshShare: 0.15,
  /**
   * In a look-ahead copy no new order is rolled, but the orders to come are not left out: from this long after
   * the order the game has is filled, the copy is paid what orders are worth per second on its board
   * (ordersWorth in src/orders.ts, worked out again every `ordersEvery` seconds). Without that, a change that
   * takes goods away from the Markets looked better than it is: the orders that follow are smaller for it.
   */
  claimAfter: 10,
  ordersEvery: 5,
  /** At most this many candidates are tried (of each kind, when a wait is for credits and Data both). */
  candidates: 14,
  /** A Lab or machine at this utilisation or more is "full": faster would help. */
  full: 0.85,
  /** A step of a card's line is only given from the credits the card's own next purchase does not need (lineAdvice). */
  lineReserve: true,
};

// =====================================================================================
// What is being waited for
// =====================================================================================

type Purse = { credits: number; a: number; b: number; g: number };
const TIERS: DataTier[] = ['a', 'b', 'g'];
const UNIT: Record<keyof Purse, WaitInfo['unit']> = { credits: '¢', a: 'α', b: 'β', g: 'γ' };
const KEYS = ['credits', 'a', 'b', 'g'] as (keyof Purse)[];

interface Wait {
  kind: 'credits' | 'data' | 'flow' | 'order';
  /** Index of the goal the wait belongs to. */
  goal: number;
  /** For credits and Data: what has to be in hand. */
  need: Purse;
  /** For an order: how many had been filled when the wait was looked at. */
  filled: number;
}

const have = (g: Game, k: keyof Purse) => (k === 'credits' ? g.credits : g.data[k]);

/**
 * What the active goal still needs in hand before the card's purchases can be made: the Data for its research
 * and the credits for what is bought next. null when it needs nothing saved up, or everything is there, or
 * the research can be done right now (the card asks for an action then, not a wait).
 */
function needOf(g: Game): Purse | null {
  const goal = activeGoal(g);
  if (!goal || g.goal.ready) return null;
  const need: Purse = { credits: 0, a: 0, b: 0, g: 0 };
  const step = goal.step?.(g) ?? null;
  if (step) {
    if ('tech' in step) {
      const t = TECHS[step.tech];
      if (!t || techAffordable(g, t)) return null;
      for (const k of TIERS) need[k] = t.cost[k] ?? 0;
      // The machine the card asks for straight after the research: its price is part of the same wait.
      if ((step.then ?? 0) > g.credits + 1e-6) need.credits = step.then!;
      return need;
    }
    if (g.credits >= step.credits - 1e-6) return null;
    need.credits = step.credits;
    return need;
  }
  // A goal that counts credits or Data without a purchase behind it ("Study Glyph for β").
  const p = goal.progress?.(g) ?? null;
  if (p && p[0] < p[1] - 1e-9) {
    const k = KEYS.find((x) => UNIT[x] === p[2]);
    if (k) {
      need[k] = p[1];
      return need;
    }
  }
  return null;
}

/** Seconds until every part of `need` is in hand at the given income, and the part that takes longest. */
function longest(g: Game, need: Purse, f: Forecast): { key: keyof Purse; eta: number } {
  let worst: { key: keyof Purse; eta: number } | null = null;
  let worstShare = Infinity;
  for (const k of KEYS) {
    if (need[k] <= 0) continue;
    const got = Math.min(have(g, k), need[k]);
    const rate = k === 'credits' ? f.credits : f.data[k];
    const missing = need[k] - got;
    const eta = missing <= 1e-9 ? 0 : rate > 1e-6 ? missing / rate : Infinity;
    const share = got / need[k];
    if (!worst || eta > worst.eta || (eta === worst.eta && share < worstShare)) {
      worst = { key: k, eta };
      worstShare = share;
    }
  }
  return worst ?? { key: 'credits', eta: 0 };
}

/** The wait the active goal is in, or null: it is ready, asks for an action, or can be paid for right now. */
function currentWait(g: Game): Wait | null {
  const goal = activeGoal(g);
  if (!goal || g.goal.ready) return null;
  const base = { goal: g.goal.i, filled: g.stats.ordersFilled };
  const need = needOf(g);
  if (need) {
    const data = TIERS.some((k) => need[k] > 0);
    // Credits and Data both: the wait is for whichever is further off.
    const kind = !data ? 'credits' : need.credits <= 0 ? 'data' : longest(g, need, income(g)).key === 'credits' ? 'credits' : 'data';
    return { kind, need, ...base };
  }
  const none: Purse = { credits: 0, a: 0, b: 0, g: 0 };
  if (goal.id === 'hold-flow') return { kind: 'flow', need: none, ...base };
  if (goal.id === 'first-order' && g.ordersOn && g.order && !g.order.ready) return { kind: 'order', need: none, ...base };
  return null;
}

/**
 * What the active goal is waiting on, if anything: 'credits' or 'data' (saving for what the card asks: see
 * waitInfo), 'flow' (the Flow goal) or 'order' (an order goal whose order is still being filled). null when
 * the card asks for an action, or is ready to claim. The interface can start its "show a tip" timer on this.
 */
export function waitKind(g: Game): 'credits' | 'data' | 'flow' | 'order' | null {
  return currentWait(g)?.kind ?? null;
}

/**
 * Has this wait ended in `g` (a copy that has been run forward)? `need` is what the copy has to have in hand:
 * nobody plays in a copy, so nothing is researched or bought there.
 */
function over(g: Game, w: Wait, need: Purse): boolean {
  if (g.goal.i !== w.goal || g.goal.ready) return true;
  if (w.kind === 'order') return g.stats.ordersFilled > w.filled;
  if (w.kind === 'flow') return false;
  return KEYS.every((k) => need[k] <= 0 || have(g, k) >= need[k] - 1e-6);
}

/** The income a wait is measured against, kept for a while so that a card showing the ETA does not pay for a forecast per frame. */
const steady = new WeakMap<Game, { rev: number; time: number; f: Forecast }>();
function income(g: Game): Forecast {
  const hit = steady.get(g);
  if (hit && hit.rev === g.rev && g.time >= hit.time && g.time - hit.time < ADVICE.refresh) return hit.f;
  const f = forecast(g);
  steady.set(g, { rev: g.rev, time: g.time, f });
  return f;
}

/**
 * When the active goal is a wait for credits or Data: what is being waited for and how long it will take at
 * the current income. null when the goal is ready, asks for something else, or can be paid for now.
 */
export function waitInfo(g: Game): WaitInfo | null {
  const need = needOf(g);
  if (!need) return null;
  const { key, eta } = longest(g, need, income(g));
  const info: WaitInfo = { unit: UNIT[key], have: Math.min(have(g, key), need[key]), need: need[key], eta };
  const step = activeGoal(g)?.step?.(g) ?? null;
  const name = !step ? undefined : 'tech' in step ? (key === 'credits' ? step.thenWhat : TECHS[step.tech]?.name) : step.what;
  if (name) info.name = name;
  return info;
}

/**
 * The research the goal card is saving for right now (its step's tech, e.g. 'P4' while "Assemble your first
 * Glyph" waits for Assembly), or null: no such step, ready to claim, or already owned. For the tech tree, to
 * preselect it. Read from the goal's step, not its wording.
 */
export function savingFor(g: Game): string | null {
  const goal = activeGoal(g);
  if (!goal || g.goal.ready) return null;
  const step = goal.step?.(g) ?? null;
  return step && 'tech' in step && !g.techs.includes(step.tech) ? step.tech : null;
}

/**
 * Seconds by which researching `id` now would push back the research the card is saving for (savingFor), at the
 * income the card's own count uses (waitInfo): what it spends of the Data that research still lacks, divided by
 * how fast that Data comes in. 0 when it would not delay it (no such research, the same tech, or Data of another
 * kind or to spare); Infinity when the Data it spends has nothing coming in. For the tech tree's warning.
 */
export function researchDelay(g: Game, id: string): number {
  const goal = savingFor(g);
  const t = TECHS[id];
  if (!goal || !t || goal === id) return 0;
  const want = TECHS[goal].cost;
  const f = income(g);
  let delay = 0;
  for (const k of TIERS) {
    const spend = t.cost[k] ?? 0;
    const need = want[k] ?? 0;
    if (spend <= 0 || need <= 0) continue;
    const before = Math.max(0, need - g.data[k]);
    const after = Math.max(0, need - (g.data[k] - spend));
    if (after <= before) continue;
    const rate = f.data[k];
    delay = Math.max(delay, rate > 1e-6 ? (after - before) / rate : Infinity);
  }
  return delay;
}

// =====================================================================================
// Looking at the board
// =====================================================================================

interface Port { n: GNode; port: number; mat: MatId }

const node = (g: Game, id: number) => graph(g).byId.get(id) ?? null;
const outs = (g: Game, n: GNode, port = 0): Wire[] => graph(g).outs.get(n.id)?.[port] ?? [];
const ins = (g: Game, n: GNode): Wire[] => graph(g).ins.get(n.id) ?? [];
const machineAt = (g: Game, id: number) => {
  const n = node(g, id);
  return !!n && isMachine(n);
};

/** Every output port of a Well or machine, with the material it gives. */
function ports(g: Game): Port[] {
  const list: Port[] = [];
  for (const n of g.nodes) {
    if (n.type === 'well') {
      if (n.material) list.push({ n, port: 0, mat: n.material });
    } else if (isMachine(n)) {
      (recipeOf(n)?.outputs ?? []).forEach(([mat], port) => list.push({ n, port, mat }));
    }
  }
  return list;
}

/** Items per second this port could still give: what it sends to anything but a machine, plus what its node holds back. */
function spare(g: Game, p: Port): number {
  let s = 0;
  for (const w of outs(g, p.n, p.port)) if (!machineAt(g, w.to)) s += w.rate;
  const r = recipeOf(p.n);
  const full = p.n.type === 'well' ? wellRate(p.n) : r ? (r.outputs[p.port]?.[1] ?? 1) / (r.time * Math.pow(0.85, p.n.lv.speed)) : 0;
  return s + Math.max(0, full * (1 - p.n.util));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const an = (noun: string) => `${/^[AEIOU]/.test(noun) ? 'an' : 'a'} ${noun}`;

/** "the Ink Refiner", or "a Glint Well" when the board has several of that name. */
function the(g: Game, n: GNode): string {
  const noun = nodeNoun(n);
  let same = 0;
  for (const x of g.nodes) if (nodeNoun(x) === noun) same++;
  return same > 1 ? an(noun) : `the ${noun}`;
}

/** "the Ink Refiner's port", or "...'s Silt port" on a machine with two outputs. With `its`: "its port", "its Silt port". */
function portName(g: Game, p: Port, its = false): string {
  const many = (recipeOf(p.n)?.outputs.length ?? 1) > 1;
  return `${its ? 'its' : `${the(g, p.n)}'s`} ${many ? MATERIALS[p.mat].name + ' ' : ''}port`;
}

/** Does a wire from this port to this node exist already? Does the port feed any node of this type? */
const wired = (g: Game, p: Port, to: GNode) => outs(g, p.n, p.port).some((w) => w.to === to.id);
const feeds = (g: Game, p: Port, type: NodeType) => outs(g, p.n, p.port).some((w) => node(g, w.to)?.type === type);

/** Nodes from which a node of one of these types can be reached along wires. */
function upstreamOf(g: Game, types: NodeType[]): Set<number> {
  const c = graph(g);
  const seen = new Set<number>();
  const queue = g.nodes.filter((n) => types.includes(n.type)).map((n) => n.id);
  while (queue.length) {
    for (const w of c.ins.get(queue.pop()!) ?? []) {
      if (!seen.has(w.from)) {
        seen.add(w.from);
        queue.push(w.from);
      }
    }
  }
  return seen;
}

/**
 * A material selling over its demand right now, if any: the one losing the most to the surplus price.
 * None until demand has shown itself (the 'surplus' event, a few seconds into the first run over demand): a tip
 * does not name a rule the game has not introduced yet.
 */
function overDemand(g: Game): MatId | null {
  if (!demandShown(g)) return null;
  let worst: MatId | null = null;
  let loss = 0.02;
  for (const m of MAT_IDS) {
    const d = demandInfo(g, m);
    const l = d.surplusRate * (d.unitPrice - d.surplusPrice);
    if (d.surplusRate > 0.02 && l > loss) {
      worst = m;
      loss = l;
    }
  }
  return worst;
}

// =====================================================================================
// The words. Every sentence the adviser can say is built here and nowhere else, from names and numbers, so
// that the whole repertoire can be measured: none is longer than RULES.tips.maxLength characters with the
// longest names and prices the game has (tests/advice.test.ts goes through all of them). The wording names
// no click, drag, tap or key, so one sentence serves mouse and touch: by the time a tip appears the player
// has wired, built and upgraded by hand several times, and "Show me" acts the tip out.
//
// Arguments: `port` is "the Ink Refiner's Ink port", `node`/`lab`/`market` a node with its article ("the
// Lab", "a Lab"), `Who` the same with a capital, `mat` a material's name, `cost` credits, `unit` α, β or γ.
// =====================================================================================

const cents = (c: number) => `${Math.round(c)}¢`;

export const SAY = {
  // --- into a Lab ---
  study: (port: string, lab: string, mat: string, y: number, unit: string) => `Wire ${port} to ${lab}: ${mat} is ${y} ${unit} each in a Lab.`,
  studyWaste: (port: string, lab: string, y: number, unit: string) => `Wire ${port} to ${lab}: you are throwing away ${y} ${unit} each.`,
  studyBetter: (port: string, lab: string, worse: string) => `Wire ${port} to ${lab}: it gives more Data than ${worse}.`,
  // --- to a Market ---
  sellUnsold: (port: string, market: string, mat: string, value: number) => `Wire ${port} to ${market}: its ${mat} is not sold (${value}¢ each).`,
  sell: (port: string, market: string, mat: string, value: number) => `Wire ${port} to ${market}: ${mat} sells for ${value}¢ each.`,
  sellBacking: (port: string, market: string, mat: string, value: number) => `Wire ${port} to ${market}: ${mat} backs up there, at ${value}¢ each.`,
  /** Something else is selling over demand: this material is not. */
  sellNotGlut: (port: string, market: string, mat: string, glut: string) => `Wire ${port} to ${market}: ${glut} is over demand, ${mat} is not.`,
  sellGlut: (port: string, market: string, mat: string) => `Wire ${port} to ${market}: ${mat} is over demand, but still sells.`,
  order: (port: string, market: string, mat: string) => `Wire ${port} to ${market}: the order counts ${mat} sold.`,
  orderStuck: (port: string, market: string) => `Wire ${port} to ${market}: the order wants it sold, and none is.`,
  // --- Speed ---
  speed: (Who: string, cost: number, what: string) => `${Who} runs flat out: buy Speed (${cents(cost)}) for more ${what}.`,
  speedLab: (Who: string, cost: number, unit: string) => `${Who} is full: buy Speed (${cents(cost)}) for more ${unit}.`,
  speedOrder: (node: string, cost: number, mat: string) => `The order needs more ${mat} sold: buy Speed on ${node} (${cents(cost)}).`,
  bulk: (kind: string, cost: number, what: string) => `Your ${kind}s run flat out: use Upgrade all on Speed (${cents(cost)}) for more ${what}.`,
  bulkLabs: (cost: number, unit: string) => `Your Labs are full: use Upgrade all on Speed (${cents(cost)}) for more ${unit}.`,
  // --- a Router ---
  favourStudy: (to: string, unit: string) => `Favour the ${to}'s wire on the Router: more of what passes is studied for ${unit}.`,
  favourSell: (to: string) => `Favour the ${to}'s wire on the Router: more of what passes is sold.`,
  favourOrder: (to: string, mat: string) => `Favour the ${to}'s wire on the Router: the order counts ${mat} sold.`,
  // --- research ---
  labSpeed: (name: string, cost: string) => `Research ${name} (${cost}): your Lab is full, and Labs then study twice as fast.`,
  deepAnalysis: (name: string, cost: string) => `Research ${name} (${cost}): every item studied then gives half as much Data again.`,
  widerDemand: (name: string, cost: string, glut: string) => `Research ${name} (${cost}): ${glut} is over demand, and Markets then buy 50% more.`,
  // --- cut a wire: only ever what a goal card asks for as well ---
  cut: (from: string, to: string, mat: string, value: number) => `Cut the wire from ${from} to ${to}: sold, each ${mat} is ${value}¢.`,
  // --- build ---
  /** `full`: "the Lab you have", "the Lab it feeds", or "every Lab studying β": which Lab is full, named. */
  labFull: (port: string, cost: number, full: string) => `Build a Lab from ${port} (${cents(cost)}): ${full} is full.`,
  labNone: (port: string, cost: number, mat: string, unit: string) => `Build a Lab from ${port} (${cents(cost)}): a Lab turns ${mat} into ${unit}.`,
  market: (port: string, cost: number) => `Build a Market from ${port}${cost > 0 ? ` (${cents(cost)})` : ''}: nothing sells without one.`,
  refiner: (port: string, cost: number, out: string, value: number) => `Build a Refiner from ${port} (${cents(cost)}) and sell its ${out}: ${value}¢ each.`,
  wellStudy: (mat: string, cost: number, lab: string) => `Place a Well on the free ${mat} deposit (${cents(cost)}), wired to ${lab}: 1 α each.`,
  wellSell: (mat: string, cost: number, market: string, value: number) => `Place a Well on the free ${mat} deposit (${cents(cost)}), wired to ${market}: ${value}¢ each.`,
  wellFeed: (Who: string, mat: string, cost: number) => `${Who} is short: wire in a Well on the free ${mat} deposit (${cents(cost)}).`,
  // --- Flow: the producer that holds Flow back comes first, then its fix ---
  flowSell: (Who: string, mat: string, port: string, market: string) => `${Who} makes more ${mat} than is taken: wire ${port} to ${market}.`,
  flowNowhere: (Who: string, mat: string, port: string, market: string) => `${Who} has nowhere to send its ${mat}: wire ${port} to ${market}.`,
  flowSpeed: (Who: string, mat: string, node: string, cost: number) => `${Who} needs more ${mat}: buy Speed on ${node} (${cents(cost)}).`,
  flowWire: (Who: string, mat: string, port: string) => `${Who} needs more ${mat}: wire ${port} to it.`,
  flowNone: (Who: string, mat: string, port: string) => `${Who} gets no ${mat}: wire ${port} to it.`,
  flowFavour: (Who: string, mat: string) => `${Who} needs more ${mat}: favour its wire on the Router.`,
  flowBlank: (Who: string, port: string) => `${Who} has nothing to work on: wire ${port} to it.`,
  flowTaker: (Who: string, node: string, cost: number) => `${Who} is backed up: buy Speed on ${node} (${cents(cost)}).`,
  // --- the steps of a goal card's "while you wait" line (lineAdvice): a Well, its own Lab, the board ---
  lineWell: (mat: string, cost: number) => `Place a Well on the free ${mat} deposit (${cents(cost)}), then build a Lab from its port.`,
  lineLab: (mat: string, cost: number) => `Build a Lab from the new ${mat} Well's port (${cents(cost)}): a Lab of its own is 1 α a second.`,
  lineExpand: (cost: number) => `Expand the board (${cents(cost)}): it brings new deposits for a Well and a Lab of its own.`,
  // --- "Make your first Spark", second line: a Lab of its own for the Glint Well that only sells ---
  lineOwnLab: (port: string, cost: number) => `Build a Lab from ${port} (${cents(cost)}): Glint is 1 α each in a Lab.`,
  // --- "Make your first Lens": what the Fabricator is not fed yet ---
  lineFeed: (port: string, to: string, n: string, mat: string) => `Wire ${port} to ${to}: a Lens takes ${n} ${mat}.`,
  // --- "Make your first Mist", second line: Speed on a Well with a Lab of its own, then on the Lab ---
  linePairWell: (well: string, cost: number) => `Buy Speed on ${well} (${cents(cost)}): its Lab of its own then gets more to study.`,
  linePairLab: (mat: string, cost: number) => `Buy Speed on the ${mat} Well's own Lab (${cents(cost)}): the pair then gives more α.`,
  // --- "Build a Fabricator", second line: the Wells with Labs of their own sell half of what they give ---
  lineSell: (port: string, market: string, mat: string) => `Wire ${port} to ${market} too: half its ${mat} is then sold, not studied.`,
};

// =====================================================================================
// Candidates: everything that might help, each with the words for it
// =====================================================================================

type Act =
  | { t: 'upgrade'; node: number; track: Track; all: boolean }
  | { t: 'wire'; from: number; port: number; to: number }
  | { t: 'build'; type: NodeType; from?: number; port?: number; deposit?: number; to?: number; recipe?: string }
  | { t: 'favour'; router: number; wire: number }
  | { t: 'research'; tech: string }
  | { t: 'cut'; wire: number }
  /** Only as a step of a goal card's line: no tip ever expands the board. */
  | { t: 'expand' };

interface Cand {
  act: Act;
  /** Credits it costs. */
  cost: number;
  /** A rough guess at how much it helps. Only decides which candidates get tried when there are too many. */
  hope: number;
  /** The sentence, from SAY. */
  text: string;
  /** The node the tip points at. */
  show?: number;
  /** A Flow tip: the producer it is meant to get flowing. */
  culprit?: number;
  /** In a wait for credits and Data both: which of the two this candidate is meant to bring in. */
  brings?: 'credits' | 'data';
}

/** Do what a candidate says. A build with its wires is one undo step and is rolled back if any part fails. */
function perform(g: Game, a: Act): boolean {
  switch (a.t) {
    case 'upgrade': {
      const n = node(g, a.node);
      if (!n) return false;
      return a.all ? upgradeAll(g, n.type, a.track) > 0 : upgrade(g, a.node, a.track);
    }
    case 'wire':
      return !!connect(g, a.from, a.port, a.to);
    case 'favour':
      return favour(g, a.router, a.wire);
    case 'research':
      return research(g, a.tech);
    case 'cut':
      return cutWire(g, a.wire);
    case 'expand':
      return expandBoard(g);
    case 'build':
      return act(g, () => {
        const src = a.from != null ? node(g, a.from) : null;
        const dep = a.deposit != null ? g.deposits.find((d) => d.id === a.deposit) : null;
        const at = dep ? { x: dep.x, y: dep.y } : { x: Math.min(g.board.w - 200, (src?.x ?? 300) + 240), y: (src?.y ?? 100) + 40 };
        const n = placeNode(g, a.type, at.x, at.y, { depositId: a.deposit, recipe: a.recipe });
        if (!n) return false;
        if (src && !connect(g, src.id, a.port ?? 0, n.id)) return false;
        if (a.to != null && !connect(g, n.id, 0, a.to)) return false;
        return 0;
      });
  }
}

/**
 * What doing this would be noted as in g.edits (the same words src/actions.ts uses), or null if it cannot be
 * done on this board. A candidate the player has just done to the same kind of node is not said again.
 */
function noteOf(g: Game, a: Act): string | null {
  switch (a.t) {
    case 'upgrade': {
      const n = node(g, a.node);
      return !n ? null : a.all ? upgradeAllNote(n.type, a.track) : upgradeNote(n, a.track);
    }
    case 'wire': {
      const from = node(g, a.from);
      const to = node(g, a.to);
      return from && to ? wireNote(from, to) : null;
    }
    case 'favour': {
      const to = node(g, g.wires.find((w) => w.id === a.wire)?.to ?? -1);
      return to ? favourNote(to) : null;
    }
    case 'research':
      return `research:${a.tech}`;
    case 'cut': {
      const w = g.wires.find((x) => x.id === a.wire);
      const from = w && node(g, w.from);
      const to = w && node(g, w.to);
      return from && to ? cutNote(from, to) : null;
    }
    case 'expand':
      return 'edit';
    case 'build':
      return buildNote(a.type, a.deposit != null ? g.deposits.find((d) => d.id === a.deposit)?.mat ?? null : null);
  }
}

/** A wire from a port to an existing node. */
function wireCand(p: Port, to: GNode, hope: number, text: string): Cand {
  return { act: { t: 'wire', from: p.n.id, port: p.port, to: to.id }, cost: 0, hope, show: p.n.id, text };
}

/** One more level of Speed on a node, if it can be bought. `say` gets the price. */
function speedCand(g: Game, n: GNode, hope: number, say: (cost: number) => string): Cand | null {
  if (!trackAvailable(g, n, 'speed') || n.lv.speed >= maxLevel(g, 'speed')) return null;
  const cost = upgradeCost(n, 'speed');
  if (cost > g.credits + 1e-6) return null;
  return { act: { t: 'upgrade', node: n.id, track: 'speed', all: false }, cost, hope, show: n.id, text: say(cost) };
}

/** "Upgrade all" on Speed for one kind of node (needs Bulk Upgrade): one level each, cheapest first, while credits last. */
function bulkCand(g: Game, type: NodeType, hope: number, say: (cost: number) => string): Cand | null {
  if (!has(g, 'S1')) return null;
  const nodes = g.nodes.filter((n) => n.type === type && n.lv.speed < maxLevel(g, 'speed')).sort((a, b) => a.lv.speed - b.lv.speed);
  let cost = 0;
  let count = 0;
  for (const n of nodes) {
    const c = upgradeCost(n, 'speed');
    if (cost + c > g.credits + 1e-6) continue;
    cost += c;
    count++;
  }
  if (count < 2) return null;
  return { act: { t: 'upgrade', node: nodes[0].id, track: 'speed', all: true }, cost, hope, show: nodes[0].id, text: say(cost) };
}

/**
 * Press Favour on a Router's wire. Never away from a Lab: "Route more to a Lab than to the Market" had the
 * player favour the Lab's wire, and a tip does not take back what a goal card asked for.
 */
function favourCand(g: Game, router: GNode, w: Wire, hope: number, text: string): Cand | null {
  const now = favouredWire(g, router.id);
  if (now === w.id) return null;
  if (now != null && node(g, g.wires.find((x) => x.id === now)?.to ?? -1)?.type === 'lab') return null;
  return { act: { t: 'favour', router: router.id, wire: w.id }, cost: 0, hope, show: router.id, text };
}

function researchCand(g: Game, id: string, hope: number, say: (name: string, cost: string) => string): Cand | null {
  const t = TECHS[id];
  if (!t || !techAvailable(g, t) || !techAffordable(g, t)) return null;
  return { act: { t: 'research', tech: id }, cost: 0, hope, text: say(t.name, costText(t)) };
}

/** A Lab built from a port: one gesture. */
function labCand(g: Game, p: Port, hope: number, say: (port: string, cost: number) => string): Cand | null {
  const cost = nodeCost(g, 'lab');
  if (!has(g, NODE_DEFS.lab.tech) || cost > g.credits + 1e-6) return null;
  return { act: { t: 'build', type: 'lab', from: p.n.id, port: p.port }, cost, hope, show: p.n.id, text: say(portName(g, p), cost) };
}

/** A Market built from a port, on a board that has none (the first one is free): one gesture. */
function marketCand(g: Game, p: Port, hope: number): Cand | null {
  const cost = nodeCost(g, 'market');
  if (cost > g.credits + 1e-6) return null;
  return { act: { t: 'build', type: 'market', from: p.n.id, port: p.port }, cost, hope, show: p.n.id, text: SAY.market(portName(g, p), cost) };
}

/** A Well on a free deposit, wired to something that wants what it gives: two gestures. */
function wellCand(g: Game, deposit: { id: number; mat: MatId }, to: GNode, hope: number, say: (mat: string, cost: number) => string): Cand | null {
  const cost = nodeCost(g, 'well');
  if (cost > g.credits + 1e-6) return null;
  return { act: { t: 'build', type: 'well', deposit: deposit.id, to: to.id }, cost, hope, text: say(MATERIALS[deposit.mat].name, cost) };
}

/** A Refiner built from a Well that sells its raw material, wired on to the Market: two gestures. */
function refinerCand(g: Game, p: Port, to: GNode, hope: number): Cand | null {
  const r = pickRecipe(g, 'refiner', [p.mat]);
  const cost = nodeCost(g, 'refiner');
  if (!r || r.inputs.length !== 1 || !has(g, NODE_DEFS.refiner.tech) || cost > g.credits + 1e-6) return null;
  const out = MATERIALS[r.outputs[0][0]];
  return {
    act: { t: 'build', type: 'refiner', from: p.n.id, port: p.port, recipe: r.id, to: to.id }, cost, hope, show: p.n.id,
    text: SAY.refiner(portName(g, p), cost, out.name, out.value),
  };
}

/**
 * Cut a wire into a Lab so that what came down it is sold instead: only ever for a wire a goal card's line
 * lists (Meanwhile.cuts). The sentence names the dearest thing the wire carries.
 */
function cutCand(g: Game, wireId: number): Cand | null {
  const x = g.wires.find((w) => w.id === wireId);
  const from = x && node(g, x.from);
  const to = x && node(g, x.to);
  const mat = x && [...materialsAt(g, x.from, x.port)].sort((a, b) => MATERIALS[b].value - MATERIALS[a].value)[0];
  if (!x || !from || !to || !mat) return null;
  return {
    act: { t: 'cut', wire: x.id }, cost: 0, hope: MATERIALS[mat].value * Math.max(0.02, x.rate), show: from.id,
    text: SAY.cut(the(g, from), the(g, to), MATERIALS[mat].name, MATERIALS[mat].value),
  };
}

const push = (list: Cand[], c: Cand | null) => {
  if (c) list.push(c);
};
const top = (list: Cand[], n: number) => [...list].sort((a, b) => b.hope - a.hope).slice(0, n);

/** Faster Wells and machines: those running flat out on the way to a sink of the given kind. */
function fasterProducers(g: Game, toward: NodeType, what: string): Cand[] {
  const list: Cand[] = [];
  const on = upstreamOf(g, [toward]);
  const flatOut = new Map<NodeType, number>();
  for (const n of g.nodes) {
    if ((n.type !== 'well' && !isMachine(n)) || !on.has(n.id) || n.util < 0.9) continue;
    const direct = (graph(g).outs.get(n.id) ?? []).some((ws) => (ws ?? []).some((w) => node(g, w.to)?.type === toward));
    // What it makes is worth more the further down the line it sits: a Glyph Assembler before a Glint Well.
    const made = n.type === 'well' ? n.material : recipeOf(n)?.outputs[0][0];
    const each = !made ? 1 : toward === 'market' ? MATERIALS[made].value : dataYield(g, made).amount;
    push(list, speedCand(g, n, (direct ? 2 : 1) * each * Math.max(0.1, n.rate), (cost) => SAY.speed(cap(the(g, n)), cost, what)));
    flatOut.set(n.type, (flatOut.get(n.type) ?? 0) + 1);
  }
  const out = top(list, 4);
  for (const [type, count] of flatOut) {
    if (count >= 2) push(out, bulkCand(g, type, 1.5, (cost) => SAY.bulk(NODE_DEFS[type].name, cost, what)));
  }
  return out;
}

/** A Well on a free deposit feeding a machine that is short of that material. */
function wellsForHungryMachines(g: Game): Cand[] {
  const list: Cand[] = [];
  for (const d of freeDeposits(g)) {
    const hungry = g.nodes.find((n) => isMachine(n) && n.util < ADVICE.full && n.status !== 'blocked' && !!recipeOf(n)?.inputs.some((i) => i[0] === d.mat)
      && ins(g, n).some((w) => materialsAt(g, w.from, w.port).includes(d.mat)));
    if (hungry) push(list, wellCand(g, d, hungry, 2, (mat, cost) => SAY.wellFeed(cap(the(g, hungry)), mat, cost)));
  }
  return top(list, 1);
}

/** Ways to get more of the ordered material to a Market. */
function orderCands(g: Game): Cand[] {
  const o = g.order;
  const market = g.nodes.find((n) => n.type === 'market');
  if (!g.ordersOn || !o || o.ready || !market) return [];
  const list: Cand[] = [];
  const name = MATERIALS[o.mat].name;
  const stuck = !orderReachesMarket(g);
  for (const p of ports(g)) {
    if (p.mat !== o.mat) continue;
    if (!feeds(g, p, 'market')) push(list, wireCand(p, market, 5, stuck ? SAY.orderStuck(portName(g, p), the(g, market)) : SAY.order(portName(g, p), the(g, market), name)));
    // It is sold already: only making more of it fills the order sooner.
    else if (p.n.util >= 0.9) push(list, speedCand(g, p.n, 1, (cost) => SAY.speedOrder(the(g, p.n), cost, name)));
  }
  for (const r of g.nodes) {
    if (r.type !== 'router' || !materialsAt(g, r.id).includes(o.mat)) continue;
    const toMarket = outs(g, r).find((w) => node(g, w.to)?.type === 'market');
    if (toMarket && outs(g, r).length > 1) push(list, favourCand(g, r, toMarket, 4, SAY.favourOrder(nodeNoun(market), name)));
  }
  return top(list, 3);
}

/** Candidates for a wait on Data of the kinds still missing. */
function dataCands(g: Game, w: Wait): Cand[] {
  const list: Cand[] = [];
  const lacking = TIERS.filter((k) => w.need[k] > g.data[k] + 1e-9);
  const labs = g.nodes.filter((n) => n.type === 'lab');
  const all = ports(g);
  for (const tier of lacking) {
    const unit = DATA_NAMES[tier];
    const mine = all.filter((p) => dataYield(g, p.mat).tier === tier);
    const studied = (lab: GNode) => ins(g, lab).flatMap((x) => materialsAt(g, x.from, x.port)).filter((m) => dataYield(g, m).tier === tier);
    const room = (lab: GNode) => Math.max(0, labRate(g, lab) - lab.rate);
    const roomy = [...labs].sort((a, b) => room(b) - room(a))[0];
    // Wire something a Lab turns into this Data into the Lab with the most room.
    const wires: Cand[] = [];
    if (roomy) {
      for (const p of mine) {
        if (wired(g, p, roomy)) continue;
        const y = dataYield(g, p.mat).amount;
        const worse = studied(roomy).find((m) => dataYield(g, m).amount < y);
        const sinks = outs(g, p.n, p.port).filter((x) => !machineAt(g, x.to)).length;
        const text = feeds(g, p, 'void') ? SAY.studyWaste(portName(g, p), the(g, roomy), y, unit)
          : worse ? SAY.studyBetter(portName(g, p), the(g, roomy), MATERIALS[worse].name)
            : SAY.study(portName(g, p), the(g, roomy), MATERIALS[p.mat].name, y, unit);
        wires.push(wireCand(p, roomy, y * Math.min(spare(g, p) / (sinks + 1), Math.max(0.1, room(roomy))), text));
      }
    }
    list.push(...top(wires, 4));
    if (!labs.length) {
      // No Lab on the board at all: nothing can become Data until there is one. From the port with the most to give.
      const best = [...mine].sort((a, b) => dataYield(g, b.mat).amount * spare(g, b) - dataYield(g, a.mat).amount * spare(g, a))[0];
      if (best) push(list, labCand(g, best, 5, (port, cost) => SAY.labNone(port, cost, MATERIALS[best.mat].name, unit)));
    }
    const fed = labs.filter((lab) => studied(lab).length > 0);
    for (const lab of fed) {
      if (lab.util >= ADVICE.full) push(list, speedCand(g, lab, lab.rate, (cost) => SAY.speedLab(cap(the(g, lab)), cost, unit)));
    }
    // Several full Labs: with Bulk Upgrade, one press speeds them all up.
    if (fed.filter((lab) => lab.util >= ADVICE.full).length >= 2) push(list, bulkCand(g, 'lab', 1.5, (cost) => SAY.bulkLabs(cost, unit)));
    // Every Lab that gets this Data is full: a second Lab from the port with the most to give, or Labs twice as fast.
    if (fed.length && fed.every((lab) => lab.util >= ADVICE.full)) {
      const best = [...mine].sort((a, b) => dataYield(g, b.mat).amount * spare(g, b) - dataYield(g, a.mat).amount * spare(g, a))[0];
      // Which Lab is full, named: the one there is, the one this port already feeds, or all that study this Data.
      const full = labs.length === 1 ? 'the Lab you have' : best && fed.some((lab) => wired(g, best, lab)) ? 'the Lab it feeds' : `every Lab studying ${unit}`;
      if (best) push(list, labCand(g, best, dataYield(g, best.mat).amount * spare(g, best) * 0.5, (port, cost) => SAY.labFull(port, cost, full)));
      push(list, researchCand(g, 'R2', 3, SAY.labSpeed));
    }
    if (fed.length) push(list, researchCand(g, 'R3', 2, SAY.deepAnalysis));
    // A Router that leads to a Lab: send it the bigger share.
    for (const r of g.nodes) {
      if (r.type !== 'router' || !materialsAt(g, r.id).some((m) => dataYield(g, m).tier === tier)) continue;
      const toLab = outs(g, r).find((x) => node(g, x.to)?.type === 'lab');
      if (toLab && outs(g, r).length > 1) push(list, favourCand(g, r, toLab, 2, SAY.favourStudy('Lab', unit)));
    }
    // Raw material is worth 1 α in a Lab: a Well on a free deposit, straight into a Lab with room.
    if (tier === 'a' && roomy && room(roomy) >= 0.3) {
      const d = freeDeposits(g)[0];
      if (d) push(list, wellCand(g, d, roomy, Math.min(1, room(roomy)), (mat, cost) => SAY.wellStudy(mat, cost, the(g, roomy))));
    }
    list.push(...fasterProducers(g, 'lab', unit));
    list.push(...wellsForHungryMachines(g));
    if (g.order && !g.order.ready && g.order.reward[tier] > 0) list.push(...orderCands(g));
  }
  return list;
}

/** Candidates for a wait on credits. */
function creditCands(g: Game): Cand[] {
  const list: Cand[] = [];
  const market = g.nodes.find((n) => n.type === 'market');
  const all = ports(g);
  const glutted = overDemand(g);
  if (market) {
    const shop = the(g, market);
    // Something made and not sold: no wire at all, backing up, or only studied or thrown away.
    const sells: Cand[] = [];
    for (const p of all) {
      if (feeds(g, p, 'market') || MATERIALS[p.mat].value <= 0) continue;
      const ws = outs(g, p.n, p.port);
      const backing = p.n.status === 'blocked' || p.n.blockedOn === p.mat || (p.n.type === 'well' && p.n.util < 0.9);
      const onlySinks = ws.length > 0 && ws.every((x) => !machineAt(g, x.to));
      if (ws.length && !backing && !onlySinks) continue;
      const name = MATERIALS[p.mat].name;
      const value = MATERIALS[p.mat].value;
      const port = portName(g, p);
      // When something sells over demand, say so: it is why selling more of that would not help, and this would.
      const text = glutted === p.mat ? SAY.sellGlut(port, shop, name)
        : glutted ? SAY.sellNotGlut(port, shop, name, MATERIALS[glutted].name)
          : !ws.length ? SAY.sellUnsold(port, shop, name, value)
            : onlySinks ? SAY.sell(port, shop, name, value)
              : SAY.sellBacking(port, shop, name, value);
      sells.push(wireCand(p, market, value * Math.max(0.05, spare(g, p)), text));
    }
    list.push(...top(sells, 4));
    // A Well on a free deposit, selling raw.
    const d = [...freeDeposits(g)].filter((x) => x.mat !== glutted).sort((a, b) => MATERIALS[b.mat].value - MATERIALS[a.mat].value)[0];
    if (d) push(list, wellCand(g, d, market, MATERIALS[d.mat].value, (mat, cost) => SAY.wellSell(mat, cost, shop, MATERIALS[d.mat].value)));
    // A Refiner on a Well that sells everything raw.
    const raw = all.filter((p) => p.n.type === 'well' && feeds(g, p, 'market') && !outs(g, p.n).some((x) => machineAt(g, x.to)))
      .sort((a, b) => spare(g, b) - spare(g, a))[0];
    if (raw) push(list, refinerCand(g, raw, market, spare(g, raw)));
  }
  if (!market) {
    // No Market on the board at all: nothing can be sold until there is one. From the port with the most to sell.
    const best = [...all].filter((p) => MATERIALS[p.mat].value > 0)
      .sort((a, b) => MATERIALS[b.mat].value * Math.max(0.05, spare(g, b)) - MATERIALS[a.mat].value * Math.max(0.05, spare(g, a)))[0];
    if (best) push(list, marketCand(g, best, 5));
  }
  for (const r of g.nodes) {
    if (r.type !== 'router') continue;
    const toMarket = outs(g, r).find((x) => node(g, x.to)?.type === 'market');
    if (toMarket && outs(g, r).length > 1) push(list, favourCand(g, r, toMarket, 2, SAY.favourSell('Market')));
  }
  // Cut a wire: only where the goal card asks for it (its "while you wait" line), so that a tip never
  // reverses a card. (The wire the line's own "Show me" points at is then left to the line: see candidates.)
  const line = meanwhileOf(g);
  if (line?.cuts && !line.done(g)) for (const id of line.cuts(g).slice(0, 3)) push(list, cutCand(g, id));
  if (glutted) push(list, researchCand(g, 'C2', 3, (name, cost) => SAY.widerDemand(name, cost, MATERIALS[glutted].name)));
  list.push(...fasterProducers(g, 'market', 'credits'));
  list.push(...wellsForHungryMachines(g));
  list.push(...orderCands(g));
  return list;
}

/** Candidates for the Flow goal: for the producers furthest from flowing, whatever holds each one back. */
function flowCands(g: Game): Cand[] {
  const list: Cand[] = [];
  const market = g.nodes.find((n) => n.type === 'market');
  const all = ports(g);
  // Not flowing, or about to stop: a producer that hovers at the mark drops under it for a moment every few
  // seconds, and the goal's ten seconds never run out. So the board is watched for a while on a copy, and a
  // producer is judged by its lowest moment there, and by what it stopped for.
  const seen = new Map<number, { low: number; starved: number; blocked: number; missing: MatId | null }>();
  const watch = lookahead(g);
  for (let t = 0; watch && t < ADVICE.flowWatch; t += ADVICE.step) {
    tick(watch, ADVICE.step);
    for (const n of watch.nodes) {
      if (!countsForFlow(watch, n)) continue;
      const was = seen.get(n.id);
      seen.set(n.id, {
        low: Math.min(was?.low ?? 1, n.util), starved: Math.max(was?.starved ?? 0, n.fStarved), blocked: Math.max(was?.blocked ?? 0, n.fBlocked),
        missing: was?.missing ?? n.missing,
      });
    }
  }
  const low = (n: GNode) => Math.min(n.util, seen.get(n.id)?.low ?? 1);
  const slow = g.nodes.filter((n) => countsForFlow(g, n) && low(n) < RULES.flow.flowing).sort((a, b) => low(a) - low(b)).slice(0, 4);
  slow.forEach((n, i) => {
    const hope = 10 - i;
    const Who = cap(the(g, n));
    const add = (c: Cand | null) => push(list, c && { ...c, culprit: n.id });
    if (isMachine(n) && !recipeOf(n)) {
      // Placed without a recipe, and counted because its port is wired on: it takes its recipe from the first
      // thing wired into it that it can work on.
      const usable = all.filter((p) => p.n !== n && !wired(g, p, n) && !!pickRecipe(g, n.type, [p.mat])).sort((a, b) => spare(g, b) - spare(g, a));
      for (const p of usable.slice(0, 2)) add(wireCand(p, n, hope, SAY.flowBlank(Who, portName(g, p))));
      return;
    }
    // Short of an input: flagged as starved, or (hovering near the mark, which is not flagged) seen to stop
    // for want of input more than for want of room.
    const ahead = seen.get(n.id);
    const starved = isMachine(n) && n.status !== 'blocked' && !n.blockedOn
      && (n.status === 'starved' || !!n.missing || (!!ahead && ahead.starved > 0.01 && ahead.starved > ahead.blocked));
    if (starved) {
      // What it is short of: what it stopped for, or else the input it holds the least of.
      const inputs = recipeOf(n)?.inputs ?? [];
      const least = [...inputs].sort((a, b) => (n.inb[a[0]] ?? 0) / a[1] - (n.inb[b[0]] ?? 0) / b[1])[0];
      const m = n.missing ?? ahead?.missing ?? least?.[0] ?? null;
      if (!m) return;
      const name = MATERIALS[m].name;
      const fed = ins(g, n).filter((w) => materialsAt(g, w.from, w.port).includes(m));
      if (!fed.length) {
        const from = all.find((p) => p.mat === m && p.n !== n);
        if (from) add(wireCand(from, n, hope, SAY.flowNone(Who, name, portName(g, from))));
      }
      let junction = false;
      for (const w of fed) {
        const s = node(g, w.from)!;
        if (!isPass(s)) {
          if (s.util >= 0.9) add(speedCand(g, s, hope, (cost) => SAY.flowSpeed(Who, name, the(g, s), cost)));
          continue;
        }
        // It is fed through a Router, Merger or Silo. A Router that sends most of what passes elsewhere: Favour
        // (unless a card turned that Router toward a Lab: then its input straight from the source is the fix).
        junction = true;
        if (s.type === 'router' && outs(g, s).length > 1) add(favourCand(g, s, w, hope, SAY.flowFavour(Who, name)));
      }
      if (junction) {
        // ...or its input straight from what makes it, and more of that if the maker is flat out.
        for (const p of all.filter((x) => x.mat === m && x.n !== n)) {
          if (!wired(g, p, n)) add(wireCand(p, n, hope - 0.5, SAY.flowWire(Who, name, portName(g, p))));
          if (p.n.util >= 0.9) add(speedCand(g, p.n, hope - 1, (cost) => SAY.flowSpeed(Who, name, the(g, p.n), cost)));
        }
      }
      const d = freeDeposits(g).find((x) => x.mat === m);
      if (d) add(wellCand(g, d, n, hope - 0.5, (mat, cost) => SAY.wellFeed(Who, mat, cost)));
      return;
    }
    // Its output has nowhere to go, or not all of it does.
    const mine = all.filter((p) => p.n === n);
    for (const p of mine) {
      if (n.blockedOn && n.blockedOn !== p.mat && mine.length > 1) continue;
      const ws = outs(g, n, p.port);
      const name = MATERIALS[p.mat].name;
      if (market && !feeds(g, p, 'market')) {
        const say = ws.some((x) => machineAt(g, x.to)) ? SAY.flowSell : SAY.flowNowhere;
        add(wireCand(p, market, hope, say(Who, name, portName(g, p, true), the(g, market))));
      }
      for (const x of ws) {
        const c = node(g, x.to)!;
        if (isMachine(c) && c.util >= 0.9) add(speedCand(g, c, hope - 1, (cost) => SAY.flowTaker(Who, the(g, c), cost)));
      }
    }
  });
  return list;
}

/**
 * Everything worth trying for this wait: the most hoped-for first, each action once, no more than the limit.
 * A goal that still needs credits and Data both (a research, then the machine it unlocks) gets the candidates
 * for each. The wait ends when the last of them is in hand, so a tip for either can shorten it, and which of
 * the two is further off changes from one second to the next near the end: going by that alone, a tip
 * blinked on and off as the two swapped places.
 *
 * Left out: what the player has just done to the same kind of node (g.edits); `skip`, the tips (as they
 * read) that have already come and gone on this board; and the step the goal card's "while you wait" line is
 * asking for right now (lineStep): the card says that itself, with a "Show me" of its own. A player who
 * reads only the tips and never the lines is slower for it at the fast end and not at the slow end (first Lens
 * 24:23 to 26:20 over seeds 0 to 14, where it was 22:13 to 26:21), and no goal takes them longer than it did
 * (`npm run pacing -- --policies=newcomer --noMeanwhile`): slower, not stranded.
 */
function candidates(g: Game, w: Wait, skip: ReadonlySet<string> = new Set()): Cand[] {
  const recent = new Set((g.edits ?? []).filter((e) => g.time - e.at < RULES.tips.repeatAfter).map((e) => e.what));
  const line = lineStep(g);
  const lineAct = line && JSON.stringify(line.act);
  const lineReads = line && reads(line.text);
  /**
   * The line's step (the same action, or the same sentence about another node of the same name), or another
   * ending to its first gesture: a Well on the deposit the line wants a Well on, wired into the Lab the player
   * has; a wire from the Well the line wants a Lab of its own on. The card and the tip would point at the
   * same spot and say different things.
   */
  const theLines = (c: Cand): boolean => {
    if (!line) return false;
    if (JSON.stringify(c.act) === lineAct || reads(c.text) === lineReads) return true;
    if (line.act.t !== 'build') return false;
    if (line.act.deposit != null) return c.act.t === 'build' && c.act.deposit === line.act.deposit;
    const well = line.act.from;
    return (c.act.t === 'wire' || c.act.t === 'build') && c.act.from === well;
  };
  const best = (list: Cand[]): Cand[] => {
    const seen = new Set<string>();
    return top(list, list.length).filter((c) => {
      const key = JSON.stringify(c.act);
      if (theLines(c)) return false;
      if (seen.has(key) || seen.size >= ADVICE.candidates || skip.has(reads(c.text))) return false;
      const note = noteOf(g, c.act);
      if (!note || recent.has(note)) return false;
      seen.add(key);
      return true;
    });
  };
  if (w.kind === 'flow') return best(flowCands(g)).sort((a, b) => b.hope - a.hope);
  if (w.kind === 'order') return best(orderCands(g));
  const data = TIERS.some((k) => w.need[k] > g.data[k] + 1e-9);
  const credits = w.need.credits > g.credits + 1e-6;
  if (data && credits) {
    const forData = best(dataCands(g, w)).map((c): Cand => ({ ...c, brings: 'data' }));
    const had = new Set(forData.map((c) => JSON.stringify(c.act)));
    return [...forData, ...best(creditCands(g)).filter((c) => !had.has(JSON.stringify(c.act))).map((c): Cand => ({ ...c, brings: 'credits' }))];
  }
  return best(data ? dataCands(g, w) : creditCands(g));
}

// =====================================================================================
// Trying them
// =====================================================================================

interface Outcome {
  /** Seconds until the wait ended, or Infinity if it did not within the run. */
  t: number;
  /** Lower is better: `t` when it ended, otherwise an estimate of when it will (or of how far off it is). */
  score: number;
  /** A wait for credits or Data that did not end: how many of the things it needs have nothing at all coming in. */
  stalled?: number;
}

/**
 * What the copy has of the things the wait is NOT for: Data when it waits for credits, credits otherwise.
 * Two tips that save the same time are told apart by it: studying Silt that was being thrown away beats
 * studying Ink that was being sold.
 */
const purse = (copy: Game, w: Wait) =>
  (w.kind === 'credits' ? TIERS.reduce((sum, k) => sum + DATA_WORTH[k] * copy.data[k], 0) : copy.credits);

/** Sooner first; within a second or two per cent of each other, the one that leaves the player richer. */
function sooner(a: { o: Outcome; rest: number }, b: { o: Outcome; rest: number }): number {
  const close = Math.max(1, 0.02 * Math.min(a.o.score, b.o.score));
  if (Math.abs(a.o.score - b.o.score) <= close || (a.o.score === Infinity && b.o.score === Infinity)) return b.rest - a.rest;
  return a.o.score - b.o.score;
}

/**
 * Where a look-ahead copy stands with the orders to come: since when it has had none of its own, what they
 * pay per second, and the copy's sales when it was first run (what it sells is averaged from there: a
 * machine hands over whole items, and the smoothed rate of a moment swings across the line that decides
 * whether a material counts as selling at all).
 */
interface OrdersAhead { since: number | null; rate: Purse; next: number; from: number; sold: Bag }
const aheads = new WeakMap<Game, OrdersAhead>();

/** The copy's record of the orders to come, kept across the runs of one copy. null for the waits orders are not paid in (an order goal, the Flow goal). */
function ordersAhead(copy: Game, w: Wait): OrdersAhead | null {
  if (!copy.ordersOn || w.kind === 'order' || w.kind === 'flow') return null;
  let s = aheads.get(copy);
  if (!s) aheads.set(copy, (s = { since: null, rate: { credits: 0, a: 0, b: 0, g: 0 }, next: 0, from: copy.time, sold: { ...copy.sold } }));
  return s;
}

/** Items per second the copy has sold of each material since it was first run; the smoothed rate at first, the average once that means something. */
function soldSince(copy: Game, s: OrdersAhead): Bag {
  const seconds = copy.time - s.from;
  const weight = Math.min(1, seconds / 20);
  const out: Bag = {};
  for (const m of MAT_IDS) {
    const average = seconds > 1e-9 ? ((copy.sold[m] ?? 0) - (s.sold[m] ?? 0)) / seconds : 0;
    const rate = weight * average + (1 - weight) * (copy.soldRate[m] ?? 0);
    if (rate > 0) out[m] = rate;
  }
  return out;
}

/** One step of the orders to come: pays the copy what they are worth on its board for that long. */
function ordersPay(copy: Game, s: OrdersAhead, step: number) {
  if (copy.order) {
    s.since = null;
    return;
  }
  if (s.since == null) s.since = copy.time;
  if (copy.time - s.since < ADVICE.claimAfter) return;
  if (copy.time >= s.next) {
    s.rate = ordersWorth(copy, soldSince(copy, s), ADVICE.claimAfter);
    s.next = copy.time + ADVICE.ordersEvery;
  }
  copy.credits += s.rate.credits * step;
  for (const k of TIERS) copy.data[k] += s.rate[k] * step;
}

/** Run a copy until the wait ends or `seconds` pass, claiming its order when it fills, and say how it went. */
function tryOut(copy: Game, w: Wait, seconds: number, step = ADVICE.step): Outcome {
  const half = seconds / 2;
  // What this copy has to have in hand. Read from the copy: a tip that builds a Refiner makes the next one dearer.
  const need = needOf(copy) ?? w.need;
  // Income over the second half of the run, for the estimate if the wait does not end.
  const earned: Purse = { credits: 0, a: 0, b: 0, g: 0 };
  let sampled = 0;
  let orderAtHalf = copy.order;
  let gotAtHalf = orderAtHalf?.got ?? 0;
  // The orders to come: paid by the second, from a moment after the copy's own order is out of the way.
  const ahead = ordersAhead(copy, w);
  for (let t = step; t <= seconds + 1e-9; t += step) {
    tick(copy, step);
    if (copy.order?.ready) claimOrder(copy);
    if (ahead) ordersPay(copy, ahead, step);
    if (over(copy, w, need)) return { t, score: t };
    if (t > half) {
      earned.credits += copy.tickAcc.credits;
      for (const k of TIERS) earned[k] += copy.tickAcc.data[k];
      sampled += step;
    } else {
      orderAtHalf = copy.order;
      gotAtHalf = orderAtHalf?.got ?? 0;
    }
  }
  if (w.kind === 'flow') {
    // Not held yet: how close is it? A smaller share of producers short of flowing is better.
    let producers = 0;
    let flowing = 0;
    for (const n of copy.nodes) {
      if (!countsForFlow(copy, n)) continue;
      producers++;
      if (isFlowing(n)) flowing++;
    }
    return { t: Infinity, score: seconds + 1000 * (producers ? 1 - flowing / producers : 1) };
  }
  const o = copy.order;
  const orderRate = o && o === orderAtHalf && sampled > 0 ? (o.got - gotAtHalf) / sampled : 0;
  const orderIn = o && orderRate > 1e-9 ? (o.need - o.got) / orderRate : Infinity;
  if (w.kind === 'order') return { t: Infinity, score: seconds + orderIn };
  // Credits or Data: when will everything be in hand at this income, counting the order's pay when it lands?
  // The income is what the board earned over the second half of the run, plus what the orders to come are
  // worth on it per second (whether or not the copy had got as far as being paid for them: one whose own
  // order was still filling at the end must not look poorer for that).
  const orders = ahead ? ordersWorth(copy, soldSince(copy, ahead), ADVICE.claimAfter) : null;
  const rateOf = (k: keyof Purse) => (sampled > 0 ? earned[k] / sampled : 0) + (orders ? orders[k] : 0);
  const until = (bonus: Purse | null) => {
    let worst = 0;
    for (const k of KEYS) {
      const missing = need[k] - have(copy, k) - (bonus ? bonus[k] : 0);
      if (missing <= 1e-9) continue;
      const rate = rateOf(k);
      worst = Math.max(worst, rate > 1e-9 ? missing / rate : Infinity);
    }
    return worst;
  };
  const plain = until(null);
  const withOrder = o && orderIn < plain ? Math.max(orderIn, until(o.reward)) : plain;
  let stalled = 0;
  for (const k of KEYS) if (need[k] - have(copy, k) > 1e-9 && !(rateOf(k) > 1e-9)) stalled++;
  return { t: Infinity, score: seconds + Math.min(plain, withOrder), stalled };
}

/**
 * Is `tip` enough better than `base` to be worth saying? `measured`: both times are ends that were reached in
 * the look-ahead, not estimates from the income at its horizon.
 */
function worth(base: number, tip: number, measured = true): boolean {
  if (!isFinite(tip)) return false;
  if (!isFinite(base)) return true;
  return base - tip >= (measured ? Math.max(ADVICE.minSaves, ADVICE.minShare * base) : Math.max(ADVICE.estSaves, ADVICE.estShare * base));
}

interface Verdict { cand: Cand; base: number; tip: number; cut?: { wire: number; from: number; to: number } }

/** How far the Flow goal is looked ahead: long enough to see its valve open, if that is still to come (doing nothing may end the wait too). */
function flowHorizon(g: Game): number {
  const age = goalAge(g);
  let short = 0;
  for (const n of g.nodes) if (countsForFlow(g, n) && !isFlowing(n)) short++;
  // The valve's first step, or its second for a board two or more short (the first will not pass that one).
  const valve = age < RULES.flow.valveAfter ? RULES.flow.valveAfter - age : short >= 2 ? RULES.flow.valveAfter2 - age : 0;
  return Math.max(ADVICE.flowScreen, valve > 0 ? valve + RULES.flow.holdSeconds + 5 : 0);
}

/** Is this producer counted and flowing in `g`? */
const flows = (g: Game, id: number) => {
  const n = node(g, id);
  return !!n && countsForFlow(g, n) && isFlowing(n);
};

/**
 * Does this producer go on flowing? The copy is run for ADVICE.flowWatch seconds more, and the producer must
 * stay at the mark throughout: one that dips under it for a moment every few seconds still holds the goal's
 * ten seconds back, and is what made it a tip's subject in the first place (flowCands). Changes the copy.
 */
function flowsSteadily(copy: Game, id: number): boolean {
  if (!flows(copy, id)) return false;
  for (let t = 0; t < ADVICE.flowWatch; t += ADVICE.step) {
    tick(copy, ADVICE.step);
    if (!flows(copy, id)) return false;
  }
  return true;
}

/**
 * The Flow goal. A tip is about one producer, and it is true when that producer flows with the fix, and goes
 * on flowing, and would not have without it. Finishing the goal is better still, but is not asked of every tip: on a board with
 * two or three things wrong the first fix cannot finish it, and a fix can even push another producer under
 * (a faster Spark Refiner fills the Lab that a Well was feeding), which the next tip then deals with.
 * A fix that leaves its producer short of flowing is not a tip, however much closer it brings it: the goal's
 * valve (RULES.flow.valveAfter) is there for the board nobody can fix.
 * Best first: the fix that completes the goal soonest, then the one that leaves the fewest producers short,
 * then the one for the producer furthest from flowing.
 */
function judgeFlow(g: Game, w: Wait, cands: Cand[]): Verdict | null {
  const idle = lookahead(g);
  if (!idle || !cands.length) return null;
  const horizon = flowHorizon(g);
  const base = tryOut(idle, w, horizon);
  if (base.t <= ADVICE.minWait) return null;
  const tried: { c: Cand; o: Outcome; rank: number }[] = [];
  cands.forEach((c, rank) => {
    const copy = lookahead(g);
    if (!copy || !perform(copy, c.act)) return;
    const o = tryOut(copy, w, isFinite(base.t) ? base.t : horizon);
    // With the fix the goal must not end later than without it.
    if (isFinite(base.t) && !isFinite(o.t)) return;
    const saves = isFinite(o.t) && (!isFinite(base.t) || base.t - o.t >= ADVICE.minSaves);
    const fixed = !saves && c.culprit != null && !flows(idle, c.culprit) && flowsSteadily(copy, c.culprit);
    if (saves || fixed) tried.push({ c, o, rank });
  });
  if (!tried.length) return null;
  tried.sort((a, b) => (a.o.score === b.o.score ? a.rank - b.rank : a.o.score - b.o.score));
  return { cand: tried[0].c, base: base.t, tip: tried[0].o.t };
}

/**
 * Try the candidates against doing nothing and return the one that ends the wait soonest, if any is worth
 * saying. `keep` is the tip already on offer (its action as JSON): it stays ahead of one that is only a
 * little better.
 */
function judge(g: Game, w: Wait, cands: Cand[], keep: string | null = null): Verdict | null {
  if (w.kind === 'flow') return judgeFlow(g, w, cands);
  /**
   * The last word on a saving that is not large: the tip against doing nothing once more, at a fine step,
   * until both waits end. A bigger saving, or one that is only an estimate (and so had to be a good share of
   * the wait to count), is taken as it is.
   */
  const checked = (c: Cand, v: Verdict, measured: boolean): Verdict | null => {
    if (!measured || !isFinite(v.base) || v.base - v.tip >= Math.max(ADVICE.checkBelow, ADVICE.checkShare * v.base)) return v;
    const idle = lookahead(g);
    const copy = lookahead(g);
    if (!idle || !copy || !perform(copy, c.act)) return null;
    const limit = v.base * 1.2 + 5;
    const base = tryOut(idle, w, limit, ADVICE.fine);
    const tip = tryOut(copy, w, isFinite(base.t) ? base.t : limit, ADVICE.fine);
    if (!isFinite(base.t) || !isFinite(tip.t) || !worth(base.t, tip.t)) return null;
    return { cand: c, base: base.t, tip: tip.t };
  };
  /** The tip on offer goes first again if it is about as good as the best: two tips a second apart must not take turns. */
  const kept = <T extends { c: Cand; o: Outcome }>(list: T[]): T[] => {
    const i = list.findIndex((x) => keep != null && JSON.stringify(x.c.act) === keep);
    if (i <= 0 || !isFinite(list[i].o.score)) return list;
    if (list[i].o.score - list[0].o.score > Math.max(ADVICE.keepWithin, ADVICE.keepShare * list[0].o.score)) return list;
    return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
  };
  const idle = lookahead(g);
  if (!idle || !cands.length) return null;
  const screen = ADVICE.screen;
  const base = tryOut(idle, w, screen);
  if (base.t <= ADVICE.minWait) return null;
  const tried: { c: Cand; o: Outcome; copy: Game; rest: number }[] = [];
  /** Tips that do not end a wait which would never end, but leave fewer things with nothing coming in. */
  const unstuck: { c: Cand; o: Outcome }[] = [];
  for (const c of cands) {
    const copy = lookahead(g);
    if (!copy || !perform(copy, c.act)) continue;
    const o = tryOut(copy, w, isFinite(base.t) ? base.t : screen);
    if (worth(base.score, o.score)) tried.push({ c, o, copy, rest: purse(copy, w) });
    else if (!isFinite(base.score) && !isFinite(o.score) && (o.stalled ?? 0) < (base.stalled ?? 0)) unstuck.push({ c, o });
  }
  if (!tried.length) {
    // Nothing ends the wait. If it could never end as things are (two kinds of Data with nothing coming in,
    // say), a tip that gets one of them moving is still the next step: like a Flow tip, it is true of what it
    // names and need not finish the job. The first of the most helpful, in the order they were hoped for.
    if (!unstuck.length) return null;
    const best = unstuck.reduce((a, b) => ((b.o.stalled ?? 0) < (a.o.stalled ?? 0) ? b : a));
    return { cand: best.c, base: Infinity, tip: Infinity };
  }
  tried.sort(sooner);
  if (isFinite(base.t)) {
    // Everything that matters happened inside the first run: nothing was estimated.
    for (const x of kept(tried).slice(0, 3)) {
      const v = checked(x.c, { cand: x.c, base: base.t, tip: x.o.t }, true);
      if (v) return v;
    }
    return null;
  }
  // The wait outlasts the first look: run the untouched copy and the best two on until it ends.
  const rest = ADVICE.horizon - screen;
  const baseOn = tryOut(idle, w, rest);
  const baseTime = screen + baseOn.score;
  const finals: { c: Cand; o: Outcome; rest: number; measured: boolean }[] = [];
  for (const x of kept(tried).slice(0, 2)) {
    const on = isFinite(x.o.t) ? null : tryOut(x.copy, w, isFinite(baseOn.t) ? baseOn.t : rest);
    const time = on ? screen + on.score : x.o.t;
    // Measured when the tip's copy reached the end of the wait, and the untouched one did too (or never would have).
    const measured = (!on || isFinite(on.t)) && (isFinite(baseOn.t) || !isFinite(baseTime));
    if (worth(baseTime, time, measured)) finals.push({ c: x.c, o: { t: time, score: time }, rest: purse(x.copy, w), measured });
  }
  finals.sort(sooner);
  for (const x of kept(finals)) {
    const v = checked(x.c, { cand: x.c, base: baseTime, tip: x.o.score }, x.measured);
    if (v) return v;
  }
  return null;
}

// =====================================================================================
// The public face
// =====================================================================================

/**
 * What the adviser remembers about a game between calls. `key` is what the verdict was worked out for (the
 * board, the wait, the order); `board` is the board and the wait alone, and `gone` are the tips (their
 * actions, as JSON) that have been on offer for that board and left again: they do not come back until the
 * board changes, whatever the orders do in between.
 */
interface Memory { key: string; board: string; time: number; until: number; advice: Advice | null; act: string | null; said: string | null; gone: Set<string> }

/** A tip as the player reads it, prices aside: "Wire a Glint Well's port to the Lab" is one tip, whichever of the two Glint Wells it is about. */
const reads = (text: string) => text.replace(/\d+¢/g, '¢');
const verdicts = new WeakMap<Game, Memory>();

function toAdvice(w: Wait, v: Verdict): Advice {
  const a = shaped(v.cand, w.kind === 'flow' ? 'flow' : v.cand.brings ?? (w.kind === 'data' ? 'data' : 'credits'), v.base, v.cut);
  // Every tip says what it saves. Infinity: the wait would not end without it (which is also true of a tip
  // that is one step of several and does not end it alone).
  a.saves = isFinite(v.tip) && isFinite(v.base) ? Math.max(0, v.base - v.tip) : Infinity;
  return a;
}

/** A candidate in the shape the interface and applyAdvice read: what to point at and what to do. */
function shaped(c: Cand, kind: Advice['kind'], eta: number, cut?: { wire: number; from: number; to: number }): Advice {
  const a: Advice = { kind, text: { mouse: c.text, touch: c.text }, eta, cost: c.cost, steps: 1 };
  if (c.show != null) a.node = c.show;
  if (c.culprit != null) a.culprit = c.culprit;
  const x = c.act;
  if (x.t === 'upgrade') {
    a.node = x.node;
    a.upgrade = x.track;
    if (x.all) a.all = true;
  } else if (x.t === 'wire') a.wire = { from: x.from, to: x.to, port: x.port };
  else if (x.t === 'favour') {
    a.node = x.router;
    a.favour = { router: x.router, wire: x.wire };
  } else if (x.t === 'research') a.research = x.tech;
  else if (x.t === 'cut') {
    if (cut) a.cut = cut;
  } else if (x.t === 'expand') a.expand = true;
  else {
    a.build = x.type;
    if (x.from != null) a.node = x.from;
    if (x.port != null) a.port = x.port;
    if (x.deposit != null) a.deposit = x.deposit;
    if (x.recipe) a.recipe = x.recipe;
    if (x.to != null) {
      a.to = x.to;
      a.steps = 2;
    }
  }
  return a;
}

/** Seconds of quiet still owed after the player's last change to the board (0 when the adviser may speak). */
export function adviceQuiet(g: Game): number {
  const last = g.edits?.[g.edits.length - 1];
  if (!last || last.at > g.time) return 0;
  return Math.max(0, RULES.tips.quiet - (g.time - last.at));
}

/**
 * The best next step while waiting, or null when there is nothing worth saying: no wait, a wait that is
 * nearly over, the player has only just changed the board, or nothing affordable would shorten the wait by
 * enough (ADVICE.minSaves).
 *
 * Only actions the player can afford and do right now; ranked by the seconds they save on the current wait;
 * and true: the tip was tried on a copy of the game and the wait ended sooner than on an untouched copy.
 */
export function advice(g: Game): Advice | null {
  const w = currentWait(g);
  if (!w) return null;
  // The player has just done something: tips are for free hands, and never follow one another in a chain.
  if (adviceQuiet(g) > 0) return null;
  // Saving is one wait whether credits or Data is further off at this moment: the verdict does not turn on it.
  const what = w.kind === 'flow' || w.kind === 'order' ? w.kind : 'save';
  const board = `${g.rev}|${g.goal.i}|${what}`;
  const key = `${board}|${g.order?.created ?? -1}|${g.order?.ready ?? ''}`;
  const hit = verdicts.get(g);
  if (hit && hit.key === key && g.time >= hit.time && g.time < hit.until) return hit.advice;
  const same = !!hit && hit.board === board && g.time >= hit.time;
  const gone = same ? hit!.gone : new Set<string>();
  // The tip given last time, if the board and the wait are still the same: it stays while it is still worth saying.
  const v = judge(g, w, candidates(g, w, gone), same ? hit!.act : null);
  if (v && v.cand.act.t === 'cut') {
    const id = v.cand.act.wire;
    const wire = g.wires.find((x) => x.id === id);
    if (wire) v.cut = { wire: id, from: wire.from, to: wire.to };
  }
  const a = v ? toAdvice(w, v) : null;
  const act = v ? JSON.stringify(v.cand.act) : null;
  const said = v ? reads(v.cand.text) : null;
  // A tip that has left the card (for nothing, or for another tip) does not come back while the board is as it is.
  if (same && hit!.said && hit!.said !== said) gone.add(hit!.said);
  // A tip for a wait of a minute is looked at again within ten seconds; no verdict is kept for less than two.
  const life = v && isFinite(v.base) ? Math.min(ADVICE.refresh, Math.max(2, ADVICE.refreshShare * v.base)) : ADVICE.refresh;
  verdicts.set(g, { key, board, time: g.time, until: g.time + life, advice: a, act, said, gone });
  return a;
}

/**
 * How much longer, in game seconds, the verdict advice(g) last gave for this game stands while the board does
 * not change (see ADVICE.refresh); 0 when it gave none. For a caller that runs the adviser somewhere else and
 * has to know when to ask again (src/advice.worker.ts): asking sooner only gets the same answer back.
 */
export function adviceLife(g: Game): number {
  const hit = verdicts.get(g);
  return hit ? Math.max(0, hit.until - g.time) : 0;
}

/**
 * The next concrete step of the active goal's "while you wait" line (Goal.meanwhile in src/goals.ts), in the
 * shape of a tip: something the interface can point at with "Show me" exactly as it does for advice(g), and
 * that applyAdvice(g, a) can carry out. One step at a time: for "give each new deposit a Well and a Lab built
 * from its port" that is the Well first, then, once it stands, the Lab from its port. null when the goal has no
 * line, the line is done or does not apply, or its next step cannot be done right now (not affordable, nothing
 * to build it on). Unlike advice(g) it is not held back by the quiet after an edit, costs no look-ahead, and
 * promises no saving (`saves` is absent): the line's worth is tested once, in tests/meanwhile.test.ts.
 *
 * What comes back, by step. Each has `text` (one sentence, the same for mouse and touch), `kind`, `cost`
 * (0 for a wire) and `steps: 1`; `eta` is 0, because the wait is not looked at here at all.
 *  - a wire to make:      `wire { from, to, port }`, `node` = from
 *  - a Well on a deposit: `build: 'well'`, `deposit` (and no `to`: the Well is placed, nothing more)
 *  - a Lab from a Well:   `build: 'lab'`, `node` = the Well, `port: 0`
 *  - the board:           `expand: true` (`cost` is the price of the expansion)
 *  - a wire to cut:       `cut { wire, from, to }`, `node` = from
 * While a step is on offer here, advice(g) does not give it (or another ending to its first gesture) as a tip.
 */
export function lineAdvice(g: Game): Advice | null {
  const c = lineStep(g);
  if (!c) return null;
  let cut: Advice['cut'];
  if (c.act.t === 'cut') {
    const id = c.act.wire;
    const wire = g.wires.find((x) => x.id === id);
    if (!wire) return null;
    cut = { wire: id, from: wire.from, to: wire.to };
  }
  return shaped(c, c.brings ?? 'data', 0, cut);
}

/**
 * The next gesture the active goal's "while you wait" line asks for (the line meanwhileAt(g) shows), read to the
 * letter, as a candidate with its sentence. null: no line, done, not applicable, or the step cannot be paid for
 * or done right now. With `any`, a step that cannot be paid for yet is given all the same (goalFocus wants the
 * nodes it is about). Looks at the board only: no copy of the game is run.
 *
 *  - ink-lab (goal 11):     the Ink Refiner's Ink port to the Lab (the one with the most room, if several).
 *  - glint-lab (goal 11):   a Lab from the port of the Glint Well that only sells.
 *  - well-labs (goal 15):   a Well that stands unwired gets a Lab from its port; else a free deposit gets a Well.
 *  - expand-labs (goal 15): the same on the deposits of the second expansion on, and the board is expanded first
 *                           when none of those is free.
 *  - flow-fix (goal 16):    a level of Speed on what feeds the short producer, or its port wired to the Market.
 *  - speed-pairs (goal 18): a level of Speed on a Well with a Lab of its own, then on that Lab.
 *  - cut-glyph (goals 19 and 21): the first wire that still takes Glyph to a Lab is cut.
 *  - sell-raw (goal 21):    a Well with a Lab of its own wired to the Market too.
 *  - prism-fab, glyph-fab (goal 22): the maker's port wired to the Fabricator.
 */
function lineStep(g: Game, any = false): Cand | null {
  const at = meanwhileAt(g);
  if (!at || at.line.done(g)) return null;
  // A line spends what the card is not saving for: the credits for the card's own next purchase (the Assembler
  // after Assembly, say) stay put, so that a line never makes the goal itself wait.
  const keep = ADVICE.lineReserve ? cardReserve(g) : 0;
  const afford = (c: Cand | null) => (c && (any || c.cost <= Math.max(0, g.credits - keep) + 1e-6) ? c : null);
  switch (at.line.id) {
    case 'ink-lab': {
      const p = ports(g).find((x) => x.mat === 'ink' && isMachine(x.n));
      const room = (lab: GNode) => Math.max(0, labRate(g, lab) - lab.rate);
      const lab = p && g.nodes.filter((n) => n.type === 'lab' && !wired(g, p, n)).sort((a, b) => room(b) - room(a))[0];
      if (!p || !lab) return null;
      const y = dataYield(g, p.mat);
      return { ...wireCand(p, lab, 0, SAY.study(portName(g, p), the(g, lab), MATERIALS[p.mat].name, y.amount, DATA_NAMES[y.tier])), brings: 'data' };
    }
    case 'glint-lab': {
      const w = rawGlintWell(g);
      if (!w || !has(g, NODE_DEFS.lab.tech)) return null;
      const cost = nodeCost(g, 'lab');
      return afford({ act: { t: 'build', type: 'lab', from: w.id, port: 0 }, cost, hope: 0, show: w.id, brings: 'data', text: SAY.lineOwnLab(portName(g, { n: w, port: 0, mat: 'glint' }), cost) });
    }
    case 'well-labs': case 'expand-labs': {
      // Which deposits the line is about: any (goal 15's first line), or those of the second expansion on.
      const from = at.line.id === 'well-labs' ? null : 1;
      const later = from == null ? null : depositsFrom(g, from);
      const mine = (deposit: number | null | undefined) => deposit != null && (!later || later.has(deposit));
      if (!has(g, NODE_DEFS.lab.tech)) return null;
      const bare = g.nodes.find((n) => n.type === 'well' && !!n.material && mine(n.depositId) && !outs(g, n).length);
      if (bare) {
        const cost = nodeCost(g, 'lab');
        return afford({ act: { t: 'build', type: 'lab', from: bare.id, port: 0 }, cost, hope: 0, show: bare.id, brings: 'data', text: SAY.lineLab(MATERIALS[bare.material!].name, cost) });
      }
      const d = freeDeposits(g).find((x) => mine(x.id));
      if (d) {
        const cost = nodeCost(g, 'well');
        return afford({ act: { t: 'build', type: 'well', deposit: d.id }, cost, hope: 0, brings: 'data', text: SAY.lineWell(MATERIALS[d.mat].name, cost) });
      }
      if (!later) return null;
      const cost = expansionCost(g);
      return afford({ act: { t: 'expand' }, cost, hope: 0, brings: 'data', text: SAY.lineExpand(cost) });
    }
    case 'flow-fix': {
      const f = flowFix(g);
      if (!f) return null;
      const Who = cap(the(g, f.n));
      if ('speed' in f) {
        const s = f.speed;
        const cost = upgradeCost(s, 'speed');
        return afford({
          act: { t: 'upgrade', node: s.id, track: 'speed', all: false }, cost, hope: 0, show: s.id, culprit: f.n.id,
          text: SAY.flowSpeed(Who, MATERIALS[f.mat].name, the(g, s), cost),
        });
      }
      const p: Port = { n: f.n, port: f.port, mat: f.mat };
      const say = outs(g, f.n, f.port).some((x) => machineAt(g, x.to)) ? SAY.flowSell : SAY.flowNowhere;
      return { ...wireCand(p, f.market, 0, say(Who, MATERIALS[f.mat].name, portName(g, p, true), the(g, f.market))), culprit: f.n.id };
    }
    case 'speed-pairs': {
      // The first pair still at its old pace: a level on whichever side holds it back (the Well, or the Lab when
      // the Well already gives it all it can study).
      for (const p of ownPairs(g)) {
        if (p.sped) continue;
        const gives = p.wells.reduce((s, w) => s + wellRate(w), 0);
        const lab = p.lab;
        const well = [...p.wells].sort((a, b) => upgradeCost(a, 'speed') - upgradeCost(b, 'speed'))[0];
        const n = gives <= labRate(g, lab) + 1e-6 ? well : lab;
        if (n.lv.speed >= maxLevel(g, 'speed')) continue;
        const cost = upgradeCost(n, 'speed');
        const mat = well.material ? MATERIALS[well.material].name : 'raw';
        return afford({
          act: { t: 'upgrade', node: n.id, track: 'speed', all: false }, cost, hope: 0, show: n.id, brings: 'data',
          text: n === well ? SAY.linePairWell(the(g, well), cost) : SAY.linePairLab(mat, cost),
        });
      }
      return null;
    }
    case 'sell-raw': {
      const market = g.nodes.find((n) => n.type === 'market');
      const w = pairedWells(g).find((n) => !outs(g, n).some((x) => node(g, x.to)?.type === 'market'));
      if (!market || !w?.material) return null;
      const p: Port = { n: w, port: 0, mat: w.material };
      return { ...wireCand(p, market, 0, SAY.lineSell(portName(g, p), the(g, market), MATERIALS[w.material].name)), brings: 'credits' };
    }
    case 'cut-glyph': {
      const id = at.line.cuts?.(g)[0];
      const c = id == null ? null : cutCand(g, id);
      return c && { ...c, brings: 'credits' };
    }
    case 'prism-fab': case 'glyph-fab': {
      const mat: MatId = at.line.id === 'prism-fab' ? 'prism' : 'glyph';
      const fab = lensMaker(g);
      // The maker with the most to spare, so that a second Glyph Assembler that sells everything is the one wired.
      const p = fab && ports(g).filter((x) => x.mat === mat && x.n !== fab && !wired(g, x, fab)).sort((a, b) => spare(g, b) - spare(g, a))[0];
      if (!fab || !p) return null;
      const n = RECIPES.lens.inputs.find(([m]) => m === mat)?.[1] ?? 1;
      return { ...wireCand(p, fab, 0, SAY.lineFeed(portName(g, p), the(g, fab), n === 1 ? 'one' : n === 2 ? 'two' : String(n), MATERIALS[mat].name)), brings: 'credits' };
    }
    default:
      return null;
  }
}

/** Credits the card's own next purchase needs (the machine after a research, or the thing it is saving for), which a line leaves alone. */
function cardReserve(g: Game): number {
  const step = activeGoal(g)?.step?.(g) ?? null;
  if (!step) return 0;
  return 'tech' in step ? step.then ?? 0 : step.credits;
}

/** Does this port feed a Lab, straight or through Routers, Mergers and Silos? */
function feedsLab(g: Game, p: Port, seen = new Set<number>()): boolean {
  for (const w of outs(g, p.n, p.port)) {
    const to = node(g, w.to);
    if (!to) continue;
    if (to.type === 'lab') return true;
    if (isPass(to) && !seen.has(to.id)) {
      seen.add(to.id);
      if (feedsLab(g, { n: to, port: 0, mat: p.mat }, seen)) return true;
    }
  }
  return false;
}

/**
 * The nodes the next step of the card's line is about, in the order the gesture meets them (the port it starts
 * from, then where it goes; for a Flow fix, the short producer and then what feeds it), whether or not the step
 * can be paid for yet. For goalFocus in src/goals.ts. Empty when there is no step.
 */
export function lineFocus(g: Game): number[] {
  const c = lineStep(g, true);
  if (!c) return [];
  const x = c.act;
  const ids: (number | undefined)[] = [c.culprit];
  if (x.t === 'wire') ids.push(x.from, x.to);
  else if (x.t === 'build') ids.push(x.from, x.to);
  else if (x.t === 'upgrade') ids.push(x.node);
  else if (x.t === 'cut') {
    const w = g.wires.find((y) => y.id === x.wire);
    ids.push(w?.from, w?.to);
  }
  if (c.show != null) ids.push(c.show);
  const out: number[] = [];
  for (const id of ids) if (id != null && !out.includes(id)) out.push(id);
  return out;
}

export interface AdviceTrial {
  /** The tip as it would read, its price, and whether trying it on a copy worked at all. */
  text: string;
  cost: number;
  doable: boolean;
  /** Seconds until the wait ended in the first look (Infinity if it did not), and the score it was ranked by: lower is better. */
  ends: number;
  score: number;
  /** Did it beat doing nothing by enough to be worth saying? */
  worth: boolean;
}

/**
 * For tuning and debugging, not for the interface: every candidate the adviser would consider right now and
 * how each one did in the first look (ADVICE.screen seconds), next to doing nothing. Works the trials out
 * afresh on every call, and ignores the quiet after a change. null when the active goal is not a wait.
 */
export function adviceTrials(g: Game): { kind: string; idle: { ends: number; score: number }; trials: AdviceTrial[] } | null {
  const w = currentWait(g);
  const idle = w && lookahead(g);
  if (!w || !idle) return null;
  const screen = w.kind === 'flow' ? flowHorizon(g) : ADVICE.screen;
  const base = tryOut(idle, w, screen);
  const trials = candidates(g, w).map((c): AdviceTrial => {
    const copy = lookahead(g);
    if (!copy || !perform(copy, c.act)) return { text: c.text, cost: c.cost, doable: false, ends: Infinity, score: Infinity, worth: false };
    const o = tryOut(copy, w, isFinite(base.t) ? base.t : screen);
    // A Flow tip is worth saying when it ends the goal, or gets its producer flowing (judgeFlow).
    const good = w.kind !== 'flow' ? worth(base.score, o.score)
      : isFinite(o.t) && (!isFinite(base.t) || base.t - o.t >= ADVICE.minSaves) ? true
        : !(isFinite(base.t) && !isFinite(o.t)) && c.culprit != null && !flows(idle, c.culprit) && flowsSteadily(copy, c.culprit);
    return { text: c.text, cost: c.cost, doable: true, ends: o.t, score: o.score, worth: good };
  });
  return { kind: w.kind, idle: { ends: base.t, score: base.score }, trials };
}

/** Do what a tip (or a step from lineAdvice) says, through the normal actions. Returns false if it can no longer be done (the board has changed). */
export function applyAdvice(g: Game, a: Advice): boolean {
  let x: Act | null = null;
  if (a.expand) x = { t: 'expand' };
  else if (a.research) x = { t: 'research', tech: a.research };
  else if (a.cut) x = { t: 'cut', wire: a.cut.wire };
  else if (a.favour) x = { t: 'favour', router: a.favour.router, wire: a.favour.wire };
  else if (a.build) x = { t: 'build', type: a.build as NodeType, from: a.node, port: a.port, deposit: a.deposit, to: a.to, recipe: a.recipe };
  else if (a.upgrade && a.node != null) x = { t: 'upgrade', node: a.node, track: a.upgrade, all: !!a.all };
  else if (a.wire) x = { t: 'wire', from: a.wire.from, port: a.wire.port ?? 0, to: a.wire.to };
  if (!x || (x.t === 'build' && !NODE_DEFS[x.type])) return false;
  return perform(g, x);
}

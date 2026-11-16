// What is wrong with a node, and where the cause lies: the inspector's status box, the board's pill and the
// HUD's alert chip all read diagnose(). And what the inspector offers to do about it, worked out here because it
// only reads the game: the way on from a blocked node (wayOn), and what one press of "Upgrade all" would buy
// (bulkPlan).
import { MATERIALS, MatId, NODE_DEFS, NodeType, Track } from '../content';
import { materialsAt } from '../actions';
import { labRate, maxLevel, pipeCap, recipeOf, trackAvailable, upgradeCost } from '../economy';
import { activeGoal, goalAge, goalFocus } from '../goals';
import { graph, isMachine, isPass } from '../sim';
import { Game, GNode } from '../state';
import { freePlay } from './hud-screens';

export type Problem = 'starved' | 'blocked' | 'idle' | null;

export interface Diagnosis {
  problem: Problem;
  /** True when the real cause is somewhere else in the line. */
  victim: boolean;
  mat: MatId | null;
  /** Node to jump to for the fix, when there is one. */
  culprit: number | null;
  /** The blocked output has no wire at all. */
  openPort: boolean;
}

function troubledDownstream(g: Game, id: number, port: number, depth = 0): number | null {
  if (depth > 6) return null;
  for (const w of graph(g).outs.get(id)?.[port] ?? []) {
    const d = graph(g).byId.get(w.to);
    if (!d) continue;
    if (isMachine(d) && (d.status === 'blocked' || d.status === 'idle' && !d.recipe)) return d.id;
    if (isPass(d)) {
      const deeper = troubledDownstream(g, d.id, 0, depth + 1);
      if (deeper != null) return deeper;
    }
  }
  return null;
}

function supplier(g: Game, id: number, m: MatId, depth = 0): GNode | null {
  if (depth > 6) return null;
  for (const w of graph(g).ins.get(id) ?? []) {
    if (!materialsAt(g, w.from, w.port).includes(m)) continue;
    const s = graph(g).byId.get(w.from);
    if (!s) continue;
    if (isPass(s)) {
      const deeper = supplier(g, s.id, m, depth + 1);
      if (deeper) return deeper;
    } else return s;
  }
  return null;
}

/**
 * Between the first Lens and free play (the ending's celebration, the bow and the summary) the board is the ending's
 * picture: the demo has been done, and no machine is in trouble in it. Nothing is reported for
 * any node, so no pill, no alert and no problem in the inspector, until the player goes on into free play (Keep
 * playing, a save that had already left the summary, or at once under `?nosummary`: freePlay() in hud-screens.ts).
 * The board draws a node's ring from this too: no problem, no warning colour.
 */
export const victoryQuiet = (g: Game): boolean => g.ended && !freePlay();

// ---------- starved means starved ----------
// The simulation calls a machine starved whenever an input runs short at all: a Spark Refiner at 80% was STARVED in
// red, and the alert named it for whole goals. A machine is a problem only when it works less than
// STARVED_BELOW of its time; above that it is merely short, which the inspector says in amber (panels.ts) and which the
// Flow ring and the Flow goal still count (flow.ts, unchanged). A machine works in bursts (a craft, then a wait for the
// next input), so its utilization ripples by ten points or more about its mean: the line is judged on that share
// averaged over STARVED_AVG game seconds, and a machine that has crossed under it is cleared only once it is back over
// STARVED_CLEAR, so one that hovers at the line does not blink.

/** A starved machine is a problem below this share of its time at work. */
export const STARVED_BELOW = 0.6;
/** ...and stays one until it is back over this. */
export const STARVED_CLEAR = 0.65;
/** Game seconds over which that share is averaged. */
const STARVED_AVG = 3;

/** A machine's averaged utilization, when it was last brought up to date (game time), and whether it is under the line. */
interface WorkShare { u: number; t: number; under: boolean }
const workShare = new WeakMap<GNode, WorkShare>();

/** The machine's utilization averaged over the last few game seconds (see above). Kept up to date by diagnose. */
function averaged(g: Game, n: GNode): WorkShare {
  let m = workShare.get(n);
  // (First look, a game wound back, or a long gap since the last: from where it stands now.)
  if (!m || g.time < m.t || g.time - m.t > 30) {
    m = { u: n.util, t: g.time, under: n.util < STARVED_BELOW };
    workShare.set(n, m);
  } else if (g.time > m.t) {
    m.u += (n.util - m.u) * (1 - Math.exp(-(g.time - m.t) / STARVED_AVG));
    m.t = g.time;
  }
  return m;
}

/**
 * A machine the simulation calls starved is a problem: it works less than STARVED_BELOW of its time (averaged), and
 * not merely short of an input. False for anything that is not starved.
 */
export function starvedHard(g: Game, n: GNode): boolean {
  if (!isMachine(n)) return n.status === 'starved';
  const m = averaged(g, n);
  m.under = n.status === 'starved' && (m.under ? m.u < STARVED_CLEAR : m.u < STARVED_BELOW);
  return m.under;
}

/** A starved machine that works STARVED_BELOW of its time or more: short of an input, not a problem (said in amber). */
export const starvedShort = (g: Game, n: GNode): boolean => n.status === 'starved' && isMachine(n) && !victoryQuiet(g) && !starvedHard(g, n);

/** Is this node in trouble itself, as diagnose would say (blocked, idle, or starved below the line)? Without its causes. */
const inTrouble = (g: Game, n: GNode) => n.status === 'blocked' || n.status === 'idle' || (n.status === 'starved' && starvedHard(g, n));

export function diagnose(g: Game, n: GNode): Diagnosis {
  const none: Diagnosis = { problem: null, victim: false, mat: null, culprit: null, openPort: false };
  // (The average is kept up to date for every machine, working or not, so that it is right the moment one runs short.)
  if (isMachine(n) && n.status !== 'starved') averaged(g, n).under = false;
  if (n.status === 'working' || victoryQuiet(g)) return none;
  if (n.type === 'well') {
    if (n.status !== 'blocked') return none;
    const wired = (graph(g).outs.get(n.id)?.[0]?.length ?? 0) > 0;
    return { problem: 'blocked', victim: wired, mat: n.material, culprit: wired ? troubledDownstream(g, n.id, 0) : null, openPort: !wired };
  }
  if (!isMachine(n)) return none;
  const r = recipeOf(n);
  if (n.status === 'idle') return { ...none, problem: 'idle' };
  if (n.status === 'blocked' && r) {
    const mat = n.blockedOn ?? r.outputs[0][0];
    const port = Math.max(0, r.outputs.findIndex((o) => o[0] === mat));
    const wired = (graph(g).outs.get(n.id)?.[port]?.length ?? 0) > 0;
    const culprit = wired ? troubledDownstream(g, n.id, port) : null;
    return { problem: 'blocked', victim: culprit != null, mat, culprit, openPort: !wired };
  }
  if (n.status === 'starved' && r) {
    // Short, but working most of its time: not a problem (the inspector says how short, in amber).
    if (!starvedHard(g, n)) return none;
    const mat = n.missing ?? r.inputs[0][0];
    const s = supplier(g, n.id, mat);
    // (A victim of its supplier when that is in trouble itself: a supplier that is merely short is not the cause.)
    const victim = !!s && isMachine(s) && inTrouble(g, s);
    return { problem: 'starved', victim, mat, culprit: s?.id ?? null, openPort: false };
  }
  return none;
}

export const matName = (m: MatId | null) => (m ? MATERIALS[m].name : 'input');

// ---------- a blocked node: the way on ----------
// A starved machine's box offers Speed on its source in one press. A blocked node whose output is wired had nothing
// to offer unless a machine further down was in trouble itself: a Well feeding a Lab that studies as fast as it can
// said "whatever is downstream cannot keep up", and the player went looking for the Lab. wayOn names what is full
// downstream and whether Speed on it would take more. It decides nothing about what blocked means: diagnose does.

export interface WayOn {
  /** The Lab or machine downstream that takes no more of what the blocked node sends. */
  node: number;
  /** Speed on it would take more: it is at work flat out, and has a level left to buy. */
  speed: boolean;
  /** A machine that takes no more because it is waiting for another input: that input. */
  waits: MatId | null;
}

/** A wire counts as full from this share of what its pipe carries (as the wire's own inspector says "At capacity"). */
const WIRE_FULL = 0.97;
/** A Lab counts as full from this share of the rate it studies at. */
const LAB_FULL = 0.9;

/** The Labs and machines that `mat` reaches from this port, through Routers, Mergers and Silos, by wires that still have room. */
function consumers(g: Game, id: number, port: number, mat: MatId, out: GNode[], seen: Set<number>, depth = 0): GNode[] {
  if (depth > 6 || seen.has(id)) return out;
  seen.add(id);
  const c = graph(g);
  const src = c.byId.get(id);
  for (const w of c.outs.get(id)?.[port] ?? []) {
    // A wire that carries all its pipe can is the limit itself: what stands beyond it may have room to spare.
    if (w.rate >= pipeCap(w.tier) * WIRE_FULL) continue;
    // (A Router's filtered wire carries one material only.)
    if (src?.type === 'router' && src.mode === 'filter' && w.filter && w.filter !== mat) continue;
    const d = c.byId.get(w.to);
    if (!d) continue;
    if (isPass(d)) consumers(g, d.id, 0, mat, out, seen, depth + 1);
    else if (d.type === 'lab' || (isMachine(d) && !!recipeOf(d)?.inputs.some((i) => i[0] === mat))) out.push(d);
  }
  return out;
}

/** Would a Speed level on this Lab or machine take more in? It can be bought (whatever the credits), and what holds it is its own pace. */
function speedTakesMore(g: Game, d: GNode): boolean {
  if (!trackAvailable(g, d, 'speed') || d.lv.speed >= maxLevel(g, 'speed')) return false;
  return d.type === 'lab' ? d.rate >= labRate(g, d) * LAB_FULL : d.status === 'working';
}

/**
 * The way on from a blocked node, or null when there is none to name: its output has no wire (the box says to wire it),
 * a machine downstream is in trouble itself (the box jumps to that cause), or nothing downstream is a Lab or a machine
 * with room on its wire (a Market or a Void takes everything: then a wire is the limit).
 * Of several, the one whose Speed is cheapest; with no Speed to offer, the first, to be shown.
 */
export function wayOn(g: Game, n: GNode, dx: Diagnosis = diagnose(g, n)): WayOn | null {
  if (dx.problem !== 'blocked' || dx.openPort || dx.culprit != null || !dx.mat) return null;
  const port = n.type === 'well' ? 0 : Math.max(0, recipeOf(n)?.outputs.findIndex((o) => o[0] === dx.mat) ?? 0);
  const found = consumers(g, n.id, port, dx.mat, [], new Set());
  if (!found.length) return null;
  let best: GNode | null = null;
  for (const d of found) if (speedTakesMore(g, d) && (!best || upgradeCost(d, 'speed') < upgradeCost(best, 'speed'))) best = d;
  if (best) return { node: best.id, speed: true, waits: null };
  const d = found[0];
  const waits = isMachine(d) && d.status === 'starved' && d.missing && d.missing !== dx.mat ? d.missing : null;
  return { node: d.id, speed: false, waits };
}

// ---------- "Upgrade all": what one press would buy ----------

export interface BulkPlan {
  /** How many nodes one press would raise right now, and how many of the type have a level left on the track. */
  count: number;
  of: number;
  /** What that press would spend, and what raising all `of` would cost. */
  cost: number;
  total: number;
}

/**
 * What one press of "Upgrade all" would do at this moment, as upgradeAll (src/actions.ts) does it: every node of the
 * type, lowest level first, each raised one level while the credits last. The button says this price before the
 * press: unpriced, one press took a player from 936 credits to 117.
 */
export function bulkPlan(g: Game, type: NodeType, track: Track): BulkPlan {
  const nodes = g.nodes.filter((n) => n.type === type).sort((a, b) => a.lv[track] - b.lv[track]);
  const plan: BulkPlan = { count: 0, of: 0, cost: 0, total: 0 };
  let credits = g.credits;
  for (const n of nodes) {
    if (!trackAvailable(g, n, track) || n.lv[track] >= maxLevel(g, track)) continue;
    const cost = upgradeCost(n, track);
    plan.of++;
    plan.total += cost;
    if (cost > credits + 1e-6) continue;
    credits -= cost;
    plan.count++;
    plan.cost += cost;
  }
  return plan;
}

// ---------- the alert chip: which node it names ----------

/** Seconds at the start of a goal during which the alert keeps quiet about what the goal card is telling the player. */
export const ALERT_QUIET = 20;

/**
 * Is the goal card about this node? The nodes its hint or line is about (goalFocus), or, where the goal does
 * not say (an empty list), any node whose kind the card's title or hint names ("Drag from the Refiner's port").
 */
function cardIsAbout(g: Game, n: GNode, focus: number[]): boolean {
  if (focus.length) return focus.includes(n.id);
  const goal = activeGoal(g);
  if (!goal) return false;
  const name = NODE_DEFS[n.type].name;
  return goal.title.includes(name) || goal.hint.mouse.includes(name);
}

/**
 * The node the HUD's alert chip names, with what it says (`textOf`: the chip's words for a node, null when
 * there is nothing to say about it). In this order:
 *  1. a node the active goal or its line is about (goalFocus), in the order the player meets them: the alert
 *     points where the card points (at goal 22 it named the Mist Refiner while the
 *     Fabricator starved);
 *  2. the node it named last, while that is still in trouble (two machines about as badly off would swap
 *     places four times a second);
 *  3. the worst off of the rest.
 * For the first ALERT_QUIET seconds of a goal it says nothing about what the card is about: the card's hint
 * is saying it already (goals 3 and 5). A node the card is about that is in trouble then, or
 * at any time stands idle (nothing wired into it yet: getting it going is what the card is asking for) or is still
 * settling after the player changed it (its grace: the simulation calls it working until it can judge), is the
 * card's to speak of, and the alert names nothing at all meanwhile: at goal 22 it sent the player to the Mist
 * Refiner while the card asked for the Fabricator's wires. So is one merely short of an input
 * (starvedShort: at work most of its time, which is not a problem, but is what the Flow goal's line is about). (Once the
 * opening seconds are over, a node in trouble is itself named; the HUD leaves out what the card already says, so the
 * slot stays empty then too.)
 */
export function alertPick(
  g: Game, held: number, textOf: (n: GNode) => string | null, focus: number[] = goalFocus(g),
): { n: GNode; text: string } | null {
  const quiet = !g.goal.ready && goalAge(g) < ALERT_QUIET;
  const say = (n: GNode) => (quiet && cardIsAbout(g, n, focus) ? null : textOf(n));
  const byId = graph(g).byId;
  for (const id of focus) {
    const n = byId.get(id);
    if (!n) continue;
    const text = textOf(n);
    if (text) return quiet ? null : { n, text };
    // (Merely short of an input is the card's to speak of too: at goal 16 the Flow line is about exactly that Refiner,
    // and the slot stayed empty while it was called starved; it still does now that it is not a problem.)
    if (n.status === 'idle' || n.grace > 0 || starvedShort(g, n)) return null;
  }
  const h = held >= 0 ? byId.get(held) : undefined;
  const heldText = h ? say(h) : null;
  if (h && heldText) return { n: h, text: heldText };
  let worst: { n: GNode; text: string } | null = null;
  for (const n of g.nodes) {
    if (worst && worst.n.util <= n.util) continue;
    const text = say(n);
    if (text) worst = { n, text };
  }
  return worst;
}

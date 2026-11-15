// What is wrong with a node, and where the cause lies: the inspector's status box, the board's pill and the
// HUD's alert chip all read diagnose().
import { MATERIALS, MatId, NODE_DEFS } from '../content';
import { materialsAt } from '../actions';
import { recipeOf } from '../economy';
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
 * picture: the demo has been done, and no machine is in trouble in it (rev-consultant F7). Nothing is reported for
 * any node, so no pill, no alert and no problem in the inspector, until the player goes on into free play (Keep
 * playing, a save that had already left the summary, or at once under `?nosummary`: freePlay() in hud-screens.ts).
 * The board draws a node's ring from this too: no problem, no warning colour.
 */
export const victoryQuiet = (g: Game): boolean => g.ended && !freePlay();

export function diagnose(g: Game, n: GNode): Diagnosis {
  const none: Diagnosis = { problem: null, victim: false, mat: null, culprit: null, openPort: false };
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
    const mat = n.missing ?? r.inputs[0][0];
    const s = supplier(g, n.id, mat);
    const victim = !!s && isMachine(s) && s.status !== 'working';
    return { problem: 'starved', victim, mat, culprit: s?.id ?? null, openPort: false };
  }
  return none;
}

export const matName = (m: MatId | null) => (m ? MATERIALS[m].name : 'input');

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
 *     points where the card points (rev-consultant F1: at goal 22 it named the Mist Refiner while the
 *     Fabricator starved);
 *  2. the node it named last, while that is still in trouble (two machines about as badly off would swap
 *     places four times a second);
 *  3. the worst off of the rest.
 * For the first ALERT_QUIET seconds of a goal it says nothing about what the card is about: the card's hint
 * is saying it already (goals 3 and 5, rev-consultant F9). A node the card is about that is in trouble then, or
 * at any time stands idle (nothing wired into it yet: getting it going is what the card is asking for) or is still
 * settling after the player changed it (its grace: the simulation calls it working until it can judge), is the
 * card's to speak of, and the alert names nothing at all meanwhile: at goal 22 it sent the player to the Mist
 * Refiner while the card asked for the Fabricator's wires (rev-consultant F1). (Once the opening seconds are over,
 * a node in trouble is itself named; the HUD leaves out what the card already says, so the slot stays empty then too.)
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
    if (n.status === 'idle' || n.grace > 0) return null;
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

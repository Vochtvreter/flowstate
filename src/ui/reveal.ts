// What of the interface is on show yet. DOM-free: it only reads the game.
//
// The game starts with one Drill, one Market and one sentence, and the first screen shows that and little else: the
// credits, the goal card, sound and the menu. Everything else arrives with the goal that first gives it a use, so
// that what is new on screen is always what the card is talking about:
//
//   goal 2  "Dig up more Sand"       the Drill's slot in the build bar; Undo and Redo
//   goal 4  "Turn Sand into Glass"   the zoom buttons and Fit; the Delete tip; the row of keys (mouse and keyboard)
//   goal 6  "Speed up a Drill"       the Market's slot (or as soon as a second Market can be paid for)
//   the Lab (goal 5's reward)        locked deposits say "needs research": until then they are outlines with a lock
//   goal 9  "Turn Oil into Plastic"  the minimap (or once the board holds eight cards); the Flows button: with
//                                    a second raw material there is something to compare
//   goal 14 "Open up more land"      the plot's label, "Board · 1 plot"
//
// A save that is further on shows everything it has reached, at once. (The slots of machines that are still locked,
// the Tech tree button, the order chip, the Flow ring and the Expand button were already brought in this way, each by
// the goal that unlocks it: panels.ts, hud.ts, board.ts.)
import { NodeType } from '../content';
import { has, nodeCost, nodeCount, nodeUnlocked } from '../economy';
import { GOALS } from '../goals';
import { Game } from '../state';

const at = (id: string) => GOALS.findIndex((x) => x.id === id);
const FROM = {
  drillSlot: at('second-well'),
  undo: at('second-well'),
  zoom: at('build-refiner'),
  keys: at('build-refiner'),
  marketSlot: at('upgrade-well'),
  minimap: at('make-ink'),
  flows: at('make-ink'),
  plot: at('expand'),
};
/** The row of keys is for the first steps with something to edit: it goes again from this goal on. */
const KEYS_UNTIL = at('research-murk');
/** The minimap also comes once the board holds this many cards, whatever the goal. */
const MINIMAP_CARDS = 8;
/** ...and the Flows button once this many materials are being made. */
const FLOWS_MATS = 4;

export interface Reveal {
  /** Undo and Redo (the top bar; on a phone the floating Undo). */
  undo: boolean;
  /** The zoom buttons and Fit (on a phone the floating Fit). */
  zoom: boolean;
  minimap: boolean;
  /** The row of keys at the foot of the board, and the Delete tip under the build bar. */
  keys: boolean;
  trash: boolean;
  /** The plot's label. */
  plot: boolean;
  /** A locked deposit says "Unknown deposit · needs research" (before, it is an outline with a lock). */
  depositWords: boolean;
  /** The Flows button: the list of what is made and where it goes (flows.ts). */
  flows: boolean;
}

export function revealOf(g: Game): Reveal {
  const i = g.goal.i;
  return {
    undo: i >= FROM.undo,
    zoom: i >= FROM.zoom,
    minimap: i >= FROM.minimap || g.nodes.length >= MINIMAP_CARDS,
    keys: i >= FROM.keys && i < KEYS_UNTIL,
    trash: i >= FROM.keys,
    plot: i >= FROM.plot || g.board.expansions > 0,
    depositWords: has(g, 'R1'),
    flows: i >= FROM.flows || Object.keys(g.made).length >= FLOWS_MATS,
  };
}

/**
 * Is this machine's slot in the build bar yet? A locked machine has none (one is shown as a silhouette: teasedSlot in
 * tech.ts). The Drill's comes with the goal that has the player place one, the Market's when a second Market first
 * makes sense: its price is in hand, the chain has got to the inspector, or one has been built already.
 */
export function slotShown(g: Game, type: NodeType): boolean {
  if (!nodeUnlocked(g, type)) return false;
  const i = g.goal.i;
  if (type === 'well') return i >= FROM.drillSlot || nodeCount(g, 'well') > 1;
  if (type === 'market') return i >= FROM.marketSlot || nodeCount(g, 'market') > 1 || g.credits + 1e-6 >= nodeCost(g, 'market');
  return true;
}

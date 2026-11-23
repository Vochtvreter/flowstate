// What of the interface is on show yet. DOM-free: it only reads the game.
//
// The game starts with one Drill, one Market and one sentence, and the first screen shows that and little else: the
// credits, the goal card, sound and the menu. Everything else arrives with the goal that first gives it a use, so
// that what is new on screen is always what the card is talking about:
//
//   goal 2  "Dig up more Sand"         the Drill's slot in the build bar; Undo and Redo
//   goal 4  "Turn Sand into Glass"     the zoom buttons and Fit; the Delete tip; Duplicate and Delete in a card's
//                                      inspector
//   goal 6  "Make 1 Glass a second"    the Flows button: the first goal that is a rate, and the list has that rate
//   goal 7  "Make 1.2 Glass a second"  the Market's slot (or as soon as a second Market can be paid for); upgrades
//                                      in a card's inspector (Duplicate and Delete are there from goal 4): this is
//                                      the goal Speed is the way to
//   the Lab (goal 7's reward)          locked deposits say "needs research": until then they are outlines with a lock
//   goal 10 "Turn Oil into Plastic"    the minimap (or once the board holds eight cards)
//   goal 13 "Make 1 Plastic a second"  the Expand button and the plot's label, "Board · 1 plot": the one Oil
//                                      deposit is in use, and the next plot brings another
//   six cards on the board           cable management, with Tidy: the Wires button (curved or squared), and clips
//                                    (a wire's Route part in its inspector, a double click on a wire or on the board)
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
  trash: at('build-refiner'),
  marketSlot: at('tune-shard'),
  upgrades: at('tune-shard'),
  minimap: at('make-ink'),
  flows: at('grow-shard'),
  plot: at('grow-ink'),
};
/** The minimap also comes once the board holds this many cards, whatever the goal. */
const MINIMAP_CARDS = 8;
/** ...and the Flows button once this many materials are being made. */
const FLOWS_MATS = 4;
/** Cable management comes when the board holds this many cards (Tidy's own number: board.ts), or a clip stands on it already. */
export const WIRES_CARDS = 6;

export interface Reveal {
  /** Undo and Redo (the top bar; on a phone the floating Undo). */
  undo: boolean;
  /** The zoom buttons and Fit (on a phone the floating Fit). */
  zoom: boolean;
  minimap: boolean;
  /** The Delete tip under the build bar, and Duplicate and Delete in a card's inspector. */
  trash: boolean;
  /** The plot's label. */
  plot: boolean;
  /** A locked deposit says "Unknown deposit · needs research" (before, it is an outline with a lock). */
  depositWords: boolean;
  /** The Flows button: the list of what is made and where it goes (flows.ts). */
  flows: boolean;
  /** A card's inspector lists its upgrades (before, it says what the machine is and what is wrong with it, and no more). */
  upgrades: boolean;
  /** Cable management: the Wires button (how wires are drawn), and clips. */
  wires: boolean;
}

export function revealOf(g: Game): Reveal {
  const i = g.goal.i;
  return {
    undo: i >= FROM.undo,
    zoom: i >= FROM.zoom,
    minimap: i >= FROM.minimap || g.nodes.length >= MINIMAP_CARDS,
    trash: i >= FROM.trash,
    plot: i >= FROM.plot || g.board.expansions > 0,
    depositWords: has(g, 'R1'),
    flows: i >= FROM.flows || Object.keys(g.made).length >= FLOWS_MATS,
    upgrades: i >= FROM.upgrades || g.nodes.some((n) => n.lv.speed + n.lv.eff + n.lv.buffer > 0),
    wires: g.nodes.length >= WIRES_CARDS || g.clips.length > 0,
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

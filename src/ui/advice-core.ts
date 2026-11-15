// The adviser, asked about a copy of the game. DOM-free: this is what runs inside the Web Worker
// (src/advice.worker.ts), and, where a Worker cannot be made, on the page in an idle moment.
//
// A fresh verdict from advice() runs a dozen copies of the game forward and takes tens of milliseconds on a
// desktop and several hundred on a slow phone (measured in the browser: 30 to 60 ms at the median on boards
// of 13 to 20 nodes, up to 590 ms under a 4x CPU throttle). Called on the page, that is a dropped frame or
// twenty. So the page posts a plain copy of the game here and shows whatever comes back (advice-client.ts).
//
// The adviser remembers things between calls, per game object: the verdict it last gave (so a tip stays
// while it still helps, and is not worked out again until it has aged) and the income it measures a wait
// against. For that to work here as it does on the page, the copies that arrive are poured into ONE game
// object that lives as long as the game does (adopt), instead of each being a new game.
import { ADVICE, Advice, WaitInfo, advice, adviceLife, adviceQuiet, waitInfo, waitKind } from '../advice';
import { Game } from '../state';

export type WaitKind = 'credits' | 'data' | 'flow' | 'order' | null;

export interface AdviceRequest {
  id: number;
  /** What the board was when the copy was taken (boardKey in advice-client.ts). The answer carries it back. */
  key: string;
  /** The first request about a game (a new game, a loaded save): nothing remembered about the last one applies. */
  fresh: boolean;
  /**
   * A plain copy of the game. Its `rev` is not the page's g.rev: it counts changes to what is built
   * (advice-client.ts), because g.rev also moves when a node is merely clicked or dragged, and a tip must
   * not be thought over again because the player selected the node it is about.
   */
  game: Game;
}

export interface AdviceAnswer {
  id: number;
  key: string;
  /** Game time and goal index of the copy this is about. */
  time: number;
  goal: number;
  /** waitKind(g): what the goal card is waiting on, or null when it asks for an action or is ready. */
  kind: WaitKind;
  /** waitInfo(g): what is being saved for, and how long that takes at the current income. */
  info: WaitInfo | null;
  /** advice(g): the one tip, or null. */
  advice: Advice | null;
  /** Game seconds this answer stands while the board does not change: asking sooner gets the same answer. */
  life: number;
  /** Milliseconds it took to work out. */
  ms: number;
  /** The adviser threw: there is no tip, and this says why. */
  error?: string;
}

/** The game the adviser is asked about: one object for as long as the page's game lasts. */
let live: Game | null = null;

/** Make `to` equal to `from`, keeping the object. */
function pour<T extends object>(to: T, from: T) {
  for (const k in to) if (!(k in from)) delete to[k];
  Object.assign(to, from);
}

/**
 * Bring the long-lived game up to date with a copy that has just arrived. While what is built has not
 * changed (same `rev`, same nodes and wires) the node and wire objects are kept and only their contents
 * replaced, exactly as tick() leaves them on the page: the lookup tables in src/graph.ts are kept per `rev`
 * and hold on to those objects. When it has changed, the new arrays are taken as they are.
 */
function adopt(snap: Game, fresh: boolean): Game {
  const old = live;
  if (!old || fresh) return (live = snap);
  if (snap.rev !== old.rev) {
    Object.assign(old, snap);
    return old;
  }
  const same = snap.nodes.length === old.nodes.length && snap.wires.length === old.wires.length
    && snap.nodes.every((n, i) => n.id === old.nodes[i].id) && snap.wires.every((w, i) => w.id === old.wires[i].id);
  // The same revision with a different board should not happen. If it does, nothing remembered can be trusted.
  if (!same) return (live = snap);
  snap.nodes.forEach((n, i) => pour(old.nodes[i], n));
  snap.wires.forEach((w, i) => pour(old.wires[i], w));
  const { nodes: _n, wires: _w, ...rest } = snap;
  Object.assign(old, rest);
  return old;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Ask the adviser about a copy of the game. Never throws: a failure is an answer with no tip. */
export function answer(req: AdviceRequest): AdviceAnswer {
  const t0 = now();
  const out: AdviceAnswer = {
    id: req.id, key: req.key, time: req.game.time, goal: req.game.goal.i, kind: null, info: null, advice: null, life: ADVICE.refresh, ms: 0,
  };
  try {
    const g = adopt(req.game, req.fresh);
    out.kind = waitKind(g);
    if (out.kind) {
      out.info = waitInfo(g);
      out.advice = advice(g);
      // Just after a change to the board the adviser says nothing (RULES.tips.quiet): the answer stands until
      // that quiet is over, so the page asks again the moment a tip may come, not up to a verdict's life later.
      const quiet = adviceQuiet(g);
      out.life = quiet > 0 ? Math.min(quiet, ADVICE.refresh) : adviceLife(g) || ADVICE.refresh;
    }
  } catch (err) {
    out.kind = null;
    out.info = null;
    out.advice = null;
    out.error = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    live = null;
  }
  out.ms = now() - t0;
  return out;
}

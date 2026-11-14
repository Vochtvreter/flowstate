// The adviser: when the active goal is a wait (saving credits or Data) or the line is held up,
// name the single most useful thing the player can do right now. DOM-free.
import { Game } from './state';

export interface Advice {
  /** What is short: credits, Data, or Flow. */
  kind: 'credits' | 'data' | 'flow';
  /** One short sentence for mouse and keyboard, and one for touch (no key names, "tap" not "click"). */
  text: { mouse: string; touch: string };
  /** The node to show the player, if the advice is about one. */
  node?: number;
  /** A node type to build, if the advice is to build something. */
  build?: string;
  /** Seconds the current wait would take if nothing changed (Infinity when income is zero). */
  eta: number;
}

/** The best next step while waiting, or null when there is nothing worth saying. */
export function advice(_g: Game): Advice | null {
  return null;
}

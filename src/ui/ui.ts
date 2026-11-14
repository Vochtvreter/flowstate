import { NodeType } from '../content';
import { Game, GameEvent } from '../state';

export interface Selection { kind: 'node' | 'wire'; id: number }

export interface UIState {
  g: Game;
  view: { x: number; y: number; k: number };
  sel: Selection | null;
  placing: { type: NodeType; recipe?: string | null } | null;
  techOpen: boolean;
  techSel: string | null;
  recipeMenu: boolean;
  menuOpen: boolean;
  /** Bumped whenever something outside the game state (selection, mode) needs a re-render. */
  uiRev: number;
}

export const ui: UIState = {
  g: null as unknown as Game,
  view: { x: 0, y: 0, k: 1 },
  sel: null,
  placing: null,
  techOpen: false,
  techSel: null,
  recipeMenu: false,
  menuOpen: false,
  uiRev: 0,
};

export function select(sel: Selection | null) {
  ui.sel = sel;
  ui.recipeMenu = false;
  ui.uiRev++;
}

export function touch() {
  ui.uiRev++;
}

// ---------- signals ----------
// Moments in the interface that sound or celebration effects may want to react to, without the
// board or panels having to know who is listening. Positions are in client pixels.

export interface Signals {
  /** The player connected two nodes with a wire. `at` is the port the wire arrives at. */
  connect: { from: number; to: number; at: { x: number; y: number } };
  /** A node was placed from the hotbar or built from the radial menu. */
  place: { id: number; type: NodeType };
  /** Once a second for each Market that earned something. */
  sale: { id: number; amount: number; at: { x: number; y: number } };
  /** A hotbar item the player could not afford a moment ago can now be bought. `at` is its button. */
  afford: { type: NodeType; at: { x: number; y: number } };
  /**
   * The goal card's tip (the adviser's one suggestion during a wait). `shown`: a tip has just appeared.
   * `stale`: the same tip has been on offer for a while and nothing was done about it; sent again every
   * so often while that lasts. `gone`: the tip left the card. `at` is the middle of its "Show me" button,
   * in client pixels.
   */
  tip: { state: 'shown' | 'stale' | 'gone'; at: { x: number; y: number } };
  /**
   * The player pressed "Show me" on a tip, and the interface has already selected and framed what it is
   * about. Whoever can point should now act the suggestion out. At most one of these is set:
   *  - `wire`: connect `from`'s output port `port` (0 when absent) to `to`;
   *  - `build`: build a `type`, either from `from`'s output port `port` into empty space, or (a Well) on
   *    deposit `deposit` from the build bar;
   *  - `press`: press the control with this `data-testid` (an upgrade button, Favour, Research, Cut wire).
   */
  showme: {
    wire?: { from: number; to: number; port?: number };
    build?: { type: NodeType; from?: number; port?: number; deposit?: number };
    press?: string;
  };
}

const listeners: { [K in keyof Signals]?: ((detail: Signals[K]) => void)[] } = {};

export function onSignal<K extends keyof Signals>(kind: K, fn: (detail: Signals[K]) => void) {
  ((listeners[kind] ??= []) as ((detail: Signals[K]) => void)[]).push(fn);
}

export function signal<K extends keyof Signals>(kind: K, detail: Signals[K]) {
  const list = listeners[kind];
  if (list) for (const fn of list) fn(detail);
}

// ---------- hooks for feature modules ----------
// The HUD, feel and phone modules subscribe here rather than editing main.ts. main.ts calls the
// emit functions: every simulation event, every animation frame, and whenever ui.g is replaced.

const gameFns: ((ev: GameEvent) => void)[] = [];
const frameFns: ((dt: number) => void)[] = [];
const beatFns: (() => void)[] = [];
const newGameFns: (() => void)[] = [];

/** Every simulation event (see GameEvent in state.ts), once, in order. */
export const onGame = (fn: (ev: GameEvent) => void) => void gameFns.push(fn);
/** Every animation frame, after the board has been updated. `dt` is in seconds (0 after a long pause). */
export const onFrame = (fn: (dt: number) => void) => void frameFns.push(fn);
/** Four times a second, with the panels: the place for text that follows the game. */
export const onBeat = (fn: () => void) => void beatFns.push(fn);
/** ui.g was replaced (reset or a loaded save): drop anything cached about the old game. */
export const onNewGame = (fn: () => void) => void newGameFns.push(fn);

const run = <A extends unknown[]>(fns: ((...a: A) => void)[], ...a: A) => {
  for (const fn of fns) {
    try {
      fn(...a);
    } catch (err) {
      console.error(err);
    }
  }
};
export const emitGame = (ev: GameEvent) => run(gameFns, ev);
export const emitFrame = (dt: number) => run(frameFns, dt);
export const emitBeat = () => run(beatFns);
export const emitNewGame = () => run(newGameFns);

// ---------- toasts ----------

let toastHost: HTMLElement | null = null;

export function initToasts(host: HTMLElement) {
  toastHost = host;
}

export function toast(html: string, kind: 'info' | 'good' | 'bad' = 'info', ms = 3200) {
  if (!toastHost) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = html;
  toastHost.appendChild(el);
  while (toastHost.children.length > 4) toastHost.firstElementChild!.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/**
 * Call `fn` when something inside `root` is pressed.
 * A mouse acts on pointerdown, so nothing that happens between press and release can swallow it.
 * Touch and pen act on click, so a finger that lands on a button while scrolling does not fire it.
 * Keyboard activation (and script-made clicks) arrive as a click with detail 0.
 */
export function onPress(root: HTMLElement, fn: (ev: Event) => void) {
  let lastType = '';
  root.addEventListener('pointerdown', (ev) => {
    lastType = ev.pointerType;
    if (ev.pointerType === 'touch' || ev.pointerType === 'pen') return;
    if (ev.button === 0) fn(ev);
  });
  root.addEventListener('click', (ev) => {
    const pe = ev as PointerEvent;
    const type = pe.pointerType || (pe.detail === 0 ? '' : lastType);
    if (pe.detail === 0 || type === 'touch' || type === 'pen') fn(ev);
  });
}

/** One delegated handler per container: data-act="name:arg1:arg2" on any element. */
export function delegate(root: HTMLElement, handler: (act: string, args: string[], el: HTMLElement, ev: Event) => void) {
  onPress(root, (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || !root.contains(el) || (el as HTMLButtonElement).disabled) return;
    const [act, ...args] = el.dataset.act!.split(':');
    handler(act, args, el, ev);
  });
}

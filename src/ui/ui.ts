import { NodeType } from '../content';
import { Game } from '../state';

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

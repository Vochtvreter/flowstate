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

/** One delegated handler per container: data-act="name:arg1:arg2" on any element. */
export function delegate(root: HTMLElement, handler: (act: string, args: string[], el: HTMLElement, ev: Event) => void) {
  const run = (ev: Event) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || !root.contains(el) || (el as HTMLButtonElement).disabled) return;
    const [act, ...args] = el.dataset.act!.split(':');
    handler(act, args, el, ev);
  };
  // pointerdown so a re-render between press and release cannot swallow the click
  root.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    run(ev);
  });
  // keyboard activation arrives as a click with detail 0
  root.addEventListener('click', (ev) => {
    if ((ev as MouseEvent).detail === 0) run(ev);
  });
}

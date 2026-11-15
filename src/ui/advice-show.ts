// "Show me": take the player to what a tip, or the next step of a goal card's "while you wait" line, is
// about, without doing it for them.
//
// Whatever it is about is selected and brought on screen, the control to press (a button in the inspector,
// or the board's Expand button) gets a ring that stays until it is pressed or something else is selected, and
// the 'showme' signal tells whoever can point (the guiding hand) what to act out. Nothing is ever carried out
// here: applyAdvice() in src/advice.ts is for bots.
import { canFavour, freeDeposits, nodeById } from '../actions';
import type { Advice } from '../advice';
import { NodeType, TECHS } from '../content';
import { expansionCost, has, nodeUnlocked } from '../economy';
import { Game, GNode } from '../state';
import * as board from './board';
import { boardRect, toClient, toWorld, zoomBy } from './board';
import { ring } from './fx';
import { nodeSize, outPorts } from './geom';
import { env } from './phone-env';
import { closeTech, openTech } from './tech';
import { Signals, select, signal, ui } from './ui';

// ---------- the ring on a control ----------

/** The control a tip pointed at (its data-testid), and the selection it belongs to. */
let mark: { testid: string; sel: string; expansions: number } | null = null;

/** The one control outside the inspector that can carry the ring: the board's Expand button. */
const EXPAND = 'expand';
const expandButton = () => document.querySelector<HTMLElement>(`[data-testid="${EXPAND}"]`);

const selKey = () => (ui.sel ? `${ui.sel.kind}${ui.sel.id}` : '');

function setMark(testid: string) {
  mark = { testid, sel: selKey(), expansions: ui.g.board.expansions };
}

function unmark() {
  // (The inspector's buttons take the ring from marked() when they are drawn; the Expand button is the
  // board's, and gets the class put on and taken off here.)
  if (mark?.testid === EXPAND) expandButton()?.classList.remove('hl');
  mark = null;
}

/** ' hl' for the control a tip has pointed at, '' for every other. For the class list of a button in the inspector. */
export function marked(testid: string): string {
  return mark && mark.testid === testid && mark.sel === selKey() ? ' hl' : '';
}

/** The ring goes when its control is pressed... */
export function pressedMark(testid: string | undefined) {
  if (mark && testid === mark.testid) unmark();
}

/** ...when the selection changes (call with every inspector refresh), when the board has been expanded, or when the tip is gone. */
export function tendMark() {
  if (!mark) return;
  if (mark.sel !== selKey() || (mark.testid === EXPAND && ui.g.board.expansions !== mark.expansions)) unmark();
}
export function clearMark() {
  unmark();
}

/** For scripts: the control that carries the ring, or null. */
export const markedControl = () => (mark && mark.sel === selKey() ? mark.testid : null);

// ---------- can it still be done? has it been done? ----------

/** The board may have changed since the adviser looked: is everything the tip names still there? */
export function doable(g: Game, a: Advice): boolean {
  if (a.expand) return g.credits + 1e-6 >= expansionCost(g);
  if (a.research) return !!TECHS[a.research] && !has(g, a.research);
  if (a.cut) return g.wires.some((w) => w.id === a.cut!.wire);
  if (a.favour) return canFavour(g, a.favour.router, a.favour.wire);
  if (a.upgrade) return a.node != null && !!nodeById(g, a.node);
  if (a.wire) {
    const { from, to, port } = a.wire;
    return !!nodeById(g, from) && !!nodeById(g, to) && !g.wires.some((w) => w.from === from && w.to === to && w.port === (port ?? 0));
  }
  if (a.build) {
    if (!nodeUnlocked(g, a.build as NodeType)) return false;
    if (a.deposit != null) return freeDeposits(g).some((d) => d.id === a.deposit);
    return a.node != null && !!nodeById(g, a.node);
  }
  return false;
}

/** What the board was like when a tip was put on offer: enough to tell, later, whether the tip was carried out. */
export interface Offered { nextId: number; level: number; expansions: number }

/** The level a tip's upgrade is about: of its node, or (Upgrade all) of every node of that kind together. */
function levelOf(g: Game, a: Advice): number {
  const n = a.node != null ? nodeById(g, a.node) : null;
  if (!n || !a.upgrade) return 0;
  if (!a.all) return n.lv[a.upgrade];
  let sum = 0;
  for (const x of g.nodes) if (x.type === n.type) sum += x.lv[a.upgrade];
  return sum;
}

export const offeredAt = (g: Game, a: Advice): Offered => ({ nextId: g.nextId, level: levelOf(g, a), expansions: g.board.expansions });

/**
 * Has the player done what this tip says, on the board as it is now? 'done': all of it. 'half': a tip of two
 * gestures ("place a Well on the free deposit, wired to the Lab") whose first has been done; `built` is the
 * node that now stands and still has to be wired to the tip's `to`. null: not (yet).
 */
export function carriedOut(g: Game, a: Advice, o: Offered): { state: 'done' | 'half'; built?: number } | null {
  const done = { state: 'done' as const };
  if (a.expand) return g.board.expansions > o.expansions ? done : null;
  if (a.research) return has(g, a.research) ? done : null;
  if (a.cut) return g.wires.some((w) => w.id === a.cut!.wire) ? null : done;
  if (a.favour) {
    const { router, wire } = a.favour;
    return g.wires.some((w) => w.id === wire) && !canFavour(g, router, wire) ? done : null;
  }
  if (a.upgrade) return levelOf(g, a) > o.level ? done : null;
  if (a.wire) {
    const { from, to, port } = a.wire;
    return g.wires.some((w) => w.from === from && w.to === to && w.port === (port ?? 0)) ? done : null;
  }
  if (a.build) {
    // Built since the tip came up, where the tip said: on its deposit, or wired from its port.
    const built = g.nodes.find((n) => n.id >= o.nextId && n.type === a.build
      && (a.deposit != null ? n.depositId === a.deposit : a.node == null || g.wires.some((w) => w.from === a.node && w.to === n.id)));
    if (!built) return null;
    if (a.to == null || g.wires.some((w) => w.from === built.id && w.to === a.to)) return done;
    return { state: 'half', built: built.id };
  }
  return null;
}

// ---------- bringing things on screen ----------

interface Box { x: number; y: number; w: number; h: number }

const boxOf = (n: GNode): Box => ({ x: n.x - 12, y: n.y - 12, ...grow(nodeSize(n), 24) });
const grow = (s: { w: number; h: number }, by: number) => ({ w: s.w + by, h: s.h + by });

/**
 * Move the camera so that all of these (world boxes) can be seen: a pan when they fit at the current zoom,
 * otherwise as far out as it takes. Never zooms in. Whatever lies over the board is kept clear: the sheets
 * and the strip on a phone (env.cover), the goal card on a desktop. When they are too far apart to be seen
 * together at the smallest zoom the board allows (a phone does not go below what can be read), the first
 * one is shown: it is where the gesture starts.
 */
function frame(boxes: Box[]) {
  if (!boxes.length) return;
  const fit = frameAll(boxes);
  // (The board has kept the zoom inside its limits: if that is not what the boxes needed, they do not fit.)
  if (boxes.length > 1 && ui.view.k > fit * 1.01) frameAll([boxes[0]]);
}

/** Frame these boxes as well as the board lets us; returns the zoom they would have needed (Infinity: the current one did). */
function frameAll(boxes: Box[]): number {
  const r = boardRect();
  const c = env.cover();
  // (The strip is measured here too: it is the card this was pressed on, and it has just grown or shrunk.)
  const strip = document.getElementById('hud-strip');
  const top = Math.max(c.top, strip ? strip.offsetTop + strip.offsetHeight : 0);
  const pad = env.phone ? 16 : 36;
  const x0 = c.left + pad, y0 = top + pad;
  const x1 = Math.max(x0 + 80, r.width - c.right - pad), y1 = Math.max(y0 + 80, r.height - c.bottom - c.row - pad);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const b of boxes) {
    bx0 = Math.min(bx0, b.x);
    by0 = Math.min(by0, b.y);
    bx1 = Math.max(bx1, b.x + b.w);
    by1 = Math.max(by1, b.y + b.h);
  }
  const v = ui.view;
  const fit = Math.min((x1 - x0) / (bx1 - bx0), (y1 - y0) / (by1 - by0));
  const needed = fit < v.k ? fit : Infinity;
  if (fit < v.k) {
    v.k = fit;
    v.x = (x0 + x1) / 2 - ((bx0 + bx1) / 2) * fit;
    v.y = (y0 + y1) / 2 - ((by0 + by1) / 2) * fit;
  } else {
    const left = bx0 * v.k + v.x, right = bx1 * v.k + v.x, up = by0 * v.k + v.y, down = by1 * v.k + v.y;
    if (right > x1) v.x -= right - x1;
    else if (left < x0) v.x += x0 - left;
    if (down > y1) v.y -= down - y1;
    else if (up < y0) v.y += y0 - up;
  }
  // The board applies the view (and keeps the zoom inside what the device can read) when asked to zoom by nothing.
  zoomBy(1);
  return needed;
}

const BOARD_FRAMES = ['frame', 'Nodes'].join('');

/**
 * Bring these nodes on screen. The board does it when it can (frameNodes glides, and keeps clear of the
 * strip, an open sheet and the corner controls); a board without it gets the framing above. `room` is extra
 * space to the right of the first node, for a node that is about to be built from its port.
 */
function frameNodes(nodes: GNode[], room = 0) {
  // (Looked up by name at run time: this file is built against boards with and without it.)
  const byBoard = (board as unknown as Record<string, unknown>)[BOARD_FRAMES] as ((ids: number[]) => void) | undefined;
  // (The board's own: when they cannot all be seen together it shows the last one named. Here the first is
  // where the gesture starts, so they are named back to front.)
  if (byBoard) return byBoard(nodes.map((n) => n.id).reverse());
  frame(nodes.map((n, i) => {
    const b = boxOf(n);
    return i === 0 ? { ...b, w: b.w + room } : b;
  }));
}

/**
 * Three rings opening on a spot of the board (a world point, followed as the camera settles): "here".
 * Only where the player asked for less motion: everywhere else the guiding hand acts the step out on the
 * board (it listens to 'showme'), and where it does not move, this marks the spot instead.
 */
function beacon(at: () => { x: number; y: number } | null, color = '#7AA2FF') {
  if (!env.calm) return;
  const once = () => {
    const p = at();
    if (p) ring(toClient(p), color, { size: 34, life: 0.6 });
  };
  once();
  setTimeout(once, 450);
  setTimeout(once, 900);
}

const centre = (n: GNode) => {
  const { w, h } = nodeSize(n);
  return { x: n.x + w / 2, y: n.y + h / 2 };
};

/** Scroll the inspector so that the control with the ring can be seen. */
function revealMark() {
  if (!mark) return;
  const el = document.querySelector<HTMLElement>(`#insp [data-testid="${mark.testid}"]`);
  const scroller = el?.closest<HTMLElement>('.scroll');
  if (!el || !scroller) return;
  const e = el.getBoundingClientRect(), s = scroller.getBoundingClientRect();
  if (e.top < s.top + 8) scroller.scrollTop -= s.top + 8 - e.top;
  else if (e.bottom > s.bottom - 8) scroller.scrollTop += e.bottom - (s.bottom - 8);
}

// ---------- Show me ----------

/**
 * Take the player to what the tip is about. `render` must refresh the panels at once (the inspector has to
 * be on screen before anything is framed or pointed at). Returns false, having done nothing, when the tip
 * can no longer be carried out.
 */
export function showAdvice(g: Game, a: Advice, render: () => void): boolean {
  if (!doable(g, a)) return false;
  unmark();
  const press = (testid: string): Signals['showme'] => {
    setMark(testid);
    return { press: testid };
  };
  let detail: Signals['showme'];
  let after: (() => void) | null = null;
  if (a.research) {
    openTech(a.research);
    detail = { press: 'research' };
  } else {
    if (ui.techOpen) closeTech();
    if (a.expand) {
      // The Expand button lies on the board, under the plot. Nothing is selected: the ring is on the button.
      select(null);
      detail = press(EXPAND);
      after = () => {
        const b = expandButton();
        if (!b) return;
        const r = b.getBoundingClientRect();
        const p = toWorld(r.left, r.top), k = ui.view.k || 1;
        frame([{ x: p.x - 16, y: p.y - 16, w: r.width / k + 32, h: r.height / k + 32 }]);
        b.classList.add('hl');
      };
    } else if (a.cut) {
      const w = g.wires.find((x) => x.id === a.cut!.wire)!;
      select({ kind: 'wire', id: w.id });
      detail = press('cut-wire');
      const ends = [nodeById(g, w.from), nodeById(g, w.to)].filter((n): n is GNode => !!n);
      after = () => frameNodes(ends);
    } else if (a.favour || a.upgrade) {
      // The node is selected, which opens its inspector (a sheet on a phone), and then brought into what
      // is left of the board.
      const n = nodeById(g, a.favour ? a.favour.router : a.node!)!;
      select({ kind: 'node', id: n.id });
      detail = press(a.favour ? `favour-${a.favour.wire}` : `${a.all ? 'upgall' : 'upg'}-${a.upgrade}`);
      after = () => frameNodes([n]);
    } else if (a.wire) {
      const from = nodeById(g, a.wire.from)!, to = nodeById(g, a.wire.to)!;
      const port = a.wire.port ?? 0;
      // Nothing is selected: on a phone the inspector would cover half of what is being shown.
      select(null);
      detail = { wire: { from: from.id, to: to.id, port } };
      after = () => {
        frameNodes([from, to]);
        beacon(() => outPorts(g, from)[port] ?? null);
        beacon(() => centre(to));
      };
    } else {
      const type = a.build as NodeType;
      select(null);
      if (a.deposit != null) {
        const d = g.deposits.find((x) => x.id === a.deposit)!;
        detail = { build: { type, deposit: d.id } };
        after = () => {
          frame([{ x: d.x - 12, y: d.y - 12, w: 196, h: 96 }]);
          beacon(() => ({ x: d.x + 86, y: d.y + 36 }));
        };
      } else {
        const from = nodeById(g, a.node!)!;
        const port = a.port ?? 0;
        detail = { build: { type, from: from.id, port } };
        after = () => {
          // With room to its right, where the new node will go.
          frameNodes([from], env.phone ? 80 : 220);
          beacon(() => outPorts(g, from)[port] ?? null);
        };
      }
    }
  }
  render();
  after?.();
  revealMark();
  signal('showme', detail);
  return true;
}

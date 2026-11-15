// "Show me": take the player to what a tip is about, without doing it for them.
//
// Whatever the tip is about is selected and brought on screen, the control to press (if it is one in the
// inspector) gets a ring that stays until it is pressed or something else is selected, and the 'showme'
// signal tells whoever can point (the guiding hand) what to act out. The tip itself is never carried out
// here: applyAdvice() in src/advice.ts is for bots.
import { canFavour, freeDeposits, nodeById } from '../actions';
import type { Advice } from '../advice';
import { NodeType, TECHS } from '../content';
import { has, nodeUnlocked } from '../economy';
import { Game, GNode } from '../state';
import { boardRect, toClient, zoomBy } from './board';
import { ring } from './fx';
import { nodeSize, outPorts } from './geom';
import { calmMotion } from './hud-words';
import { env } from './phone-env';
import { closeTech, openTech } from './tech';
import { Signals, select, signal, ui } from './ui';

// ---------- the ring on a control ----------

/** The control a tip pointed at (its data-testid), and the selection it belongs to. */
let mark: { testid: string; sel: string } | null = null;

const selKey = () => (ui.sel ? `${ui.sel.kind}${ui.sel.id}` : '');

/** ' hl' for the control a tip has pointed at, '' for every other. For the class list of a button in the inspector. */
export function marked(testid: string): string {
  return mark && mark.testid === testid && mark.sel === selKey() ? ' hl' : '';
}

/** The ring goes when its control is pressed... */
export function pressedMark(testid: string | undefined) {
  if (mark && testid === mark.testid) mark = null;
}

/** ...when the selection changes (call with every inspector refresh), or when the tip is gone. */
export function tendMark() {
  if (mark && mark.sel !== selKey()) mark = null;
}
export function clearMark() {
  mark = null;
}

/** For scripts: the control that carries the ring, or null. */
export const markedControl = () => (mark && mark.sel === selKey() ? mark.testid : null);

// ---------- can it still be done? ----------

/** The board may have changed since the adviser looked: is everything the tip names still there? */
export function doable(g: Game, a: Advice): boolean {
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

// ---------- bringing things on screen ----------

interface Box { x: number; y: number; w: number; h: number }

const boxOf = (n: GNode): Box => ({ x: n.x - 12, y: n.y - 12, ...grow(nodeSize(n), 24) });
const grow = (s: { w: number; h: number }, by: number) => ({ w: s.w + by, h: s.h + by });

/**
 * Move the camera so that all of these (world boxes) can be seen: a pan when they fit at the current zoom,
 * otherwise as far out as it takes. Never zooms in. Whatever lies over the board is kept clear: the sheets
 * and the strip on a phone (env.cover), the goal card on a desktop.
 */
function frame(boxes: Box[]) {
  if (!boxes.length) return;
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
}

/** Rings opening on a spot of the board (a world point, followed as the camera settles): "here". */
function beacon(at: () => { x: number; y: number } | null, color = '#7AA2FF') {
  const once = () => {
    const p = at();
    if (p) ring(toClient(p), color, { size: 34, life: 0.6 });
  };
  once();
  if (calmMotion()) return;
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
  mark = null;
  const press = (testid: string): Signals['showme'] => {
    mark = { testid, sel: selKey() };
    return { press: testid };
  };
  let detail: Signals['showme'];
  let after: (() => void) | null = null;
  if (a.research) {
    openTech(a.research);
    detail = { press: 'research' };
  } else {
    if (ui.techOpen) closeTech();
    if (a.cut) {
      const w = g.wires.find((x) => x.id === a.cut!.wire)!;
      select({ kind: 'wire', id: w.id });
      detail = press('cut-wire');
      const ends = [nodeById(g, w.from), nodeById(g, w.to)].filter((n): n is GNode => !!n);
      after = () => frame(ends.map(boxOf));
    } else if (a.favour || a.upgrade) {
      // The node is selected, which opens its inspector (a sheet on a phone), and then brought into what
      // is left of the board.
      const n = nodeById(g, a.favour ? a.favour.router : a.node!)!;
      select({ kind: 'node', id: n.id });
      detail = press(a.favour ? `favour-${a.favour.wire}` : `${a.all ? 'upgall' : 'upg'}-${a.upgrade}`);
      after = () => frame([boxOf(n)]);
    } else if (a.wire) {
      const from = nodeById(g, a.wire.from)!, to = nodeById(g, a.wire.to)!;
      const port = a.wire.port ?? 0;
      // Nothing is selected: on a phone the inspector would cover half of what is being shown.
      select(null);
      detail = { wire: { from: from.id, to: to.id, port } };
      after = () => {
        frame([boxOf(from), boxOf(to)]);
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
          const b = boxOf(from);
          frame([{ ...b, w: b.w + (env.phone ? 80 : 220) }]);
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

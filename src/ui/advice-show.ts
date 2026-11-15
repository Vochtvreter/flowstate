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
import { goalFocus } from '../goals';
import { Game, GNode } from '../state';
import { armedPort, boardRect, frameNodes as boardFrames, gestureActive, radialOpen, toClient, toWorld, zoomBy } from './board';
import { celebrating } from './celebrate';
import { ring } from './fx';
import { nodeSize, outPorts } from './geom';
import { isStarted, screenOpen } from './hud-screens';
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

/**
 * Move the camera so that all of these (world boxes) can be seen: a pan when they fit at the current zoom,
 * otherwise as far out as it takes. Never zooms in. Whatever lies over the board is kept clear: the sheets
 * and the strip on a phone (env.cover), the goal card on a desktop. When they are too far apart to be seen
 * together at the smallest zoom the board allows (a phone does not go below what can be read), the first
 * one is shown: it is where the gesture starts. (For what is not a node, which the board's frameNodes does
 * not take: a free deposit, and the Expand button in its place under the plot.)
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

/**
 * Bring these nodes on screen, through the board's frameNodes: it glides, moves the camera as little as it
 * can (not at all when they are in view already), and keeps clear of the strip, an open sheet and the corner
 * controls. When they cannot all be seen together it shows the last one named; here the first is where the
 * gesture starts, so they are named back to front. `readable`: ports are about to be pointed at, so from the
 * overview, which shows none, the board comes back in among the cards. (Where the new node will be built
 * from a port, the board's own framing of that node leaves room around it: no extra room is asked for.)
 */
function frameNodes(nodes: GNode[]) {
  boardFrames(nodes.map((n) => n.id).reverse(), true);
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
        // Docked (class `dock`, board.ts), it stands fixed in the free part of the stage, where it can always be
        // pressed: moving the camera would not bring it any nearer, so the board stays where the player left it.
        if (!b.classList.contains('dock')) {
          const r = b.getBoundingClientRect();
          const p = toWorld(r.left, r.top), k = ui.view.k || 1;
          frame([{ x: p.x - 16, y: p.y - 16, w: r.width / k + 32, h: r.height / k + 32 }]);
        }
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
          frameNodes([from]);
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

// ---------- the nodes the goal is about, brought into view ----------
//
// When a goal comes up, and after a sheet or the tech tree has closed, the nodes its hint or line is about
// (goalFocus in src/goals.ts) are brought into view if any of them is off screen or covered: through the board's
// frameNodes, which moves the camera as little as it can. Never while the player is in the middle of something
// on the board (a drag, a pinch, an armed port, a node being placed, the build menu), never behind the start
// screen or the summary, and not while a celebration card is up (a research's, a claim's): the look waits until it
// has gone, so the board never glides under it, where a press made to put the card away would land on whatever the
// glide had brought under the finger. Nothing happens when they are all in view already, or when the goal names no
// node. A goal coming up brings its nodes in among the cards from the overview (it shows no ports); after a sheet or
// the tree, an overview the player chose (zoomed out to by hand, or within by hand) is theirs: it counts as in view,
// and only nodes off screen or covered are brought in, at the overview's zoom.

/**
 * Real milliseconds after a goal comes up, or after a sheet or the tree has gone, before the nodes are looked for:
 * a few frames, for the new card to take its height (a sheet counts as gone the moment it starts to slide away).
 * Short on purpose: the camera's glide is over before a player has the next press ready, and is never under it.
 */
const AFTER_GOAL = 120;
const AFTER_SHEET = 60;

let focusGoal = -1;
let focusGame: Game | null = null;
let sheetSeen = false;
let treeSeen = false;
/** Real time at which to look (0: nothing to do). */
let focusDue = 0;
/** What the look is for: a goal that came up (the overview is no view of its ports), or a sheet or the tree that closed. */
let focusFor: 'goal' | 'sheet' = 'goal';
/** When the player last changed the zoom by hand: the wheel, a pinch, the zoom or Fit buttons, a key (ms). */
let zoomedAt = -1e9;
/**
 * The board is in the overview because the player took it there, or zoomed within it, by hand: theirs. (One the game
 * opened in, for a big factory on a tablet, or a celebration's, is not.) Looked at every frame in tendFocus.
 */
let ownOverview = false;
let listening = false;

/** Hear the player's own zooming: the board's handlers do the zooming, this only notes when it happened. */
function listenForZoom() {
  if (listening) return;
  listening = true;
  const hand = () => void (zoomedAt = performance.now());
  const stage = document.getElementById('stage');
  stage?.addEventListener('wheel', hand, { capture: true, passive: true });
  // (Two fingers on the board are a pinch.)
  const fingers = new Set<number>();
  stage?.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    fingers.add(e.pointerId);
    if (fingers.size >= 2) hand();
  }, { capture: true, passive: true });
  stage?.addEventListener('pointermove', (e) => {
    if (fingers.size >= 2 && fingers.has(e.pointerId)) hand();
  }, { capture: true, passive: true });
  const lift = (e: PointerEvent) => void fingers.delete(e.pointerId);
  window.addEventListener('pointerup', lift, { capture: true, passive: true });
  window.addEventListener('pointercancel', lift, { capture: true, passive: true });
  document.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest?.('#zoom [data-act], [data-testid="fab-fit"]')) hand();
  }, { capture: true, passive: true });
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[f+=-]$/i.test(e.key)) hand();
  }, { capture: true, passive: true });
}

/** How long after the player's zooming the board may still be getting there (a Fit glides for 0.6 s). */
const ZOOM_SETTLES = 1200;
/** For scripts: what the last look found and did. */
let focusLast: { at: number; goal: number; ids: number[]; inView: boolean; framed: boolean; why?: string } | null = null;

/**
 * A sheet the player works in lies over the board: on a phone, the inspector or the build menu. (Elsewhere the build
 * menu is a menu at the pointer, not a sheet: it moves nothing, and once a node has been built from it the camera
 * stays on what the player is building. While it is up nothing is looked for either: see tendFocus.)
 */
function sheetUp(): boolean {
  const app = document.getElementById('app');
  return env.phone && !!app && (radialOpen() || app.classList.contains('insp-open') || app.classList.contains('building'));
}

/**
 * Are these nodes on screen, with their ports, in the part of the board nothing covers (the strip, a sheet,
 * the floating controls, the corner controls)? Not in the overview, which draws no ports, unless `overview` says an
 * overview will do (the player's own: then on screen and uncovered is enough).
 */
export function focusInView(ids: number[], overview = false): boolean {
  const boardEl = document.getElementById('board');
  if (!boardEl || (!overview && boardEl.classList.contains('ov'))) return false;
  const b = boardEl.getBoundingClientRect();
  const c = env.cover();
  const left = b.left + c.left, top = b.top + c.top, right = b.right - c.right, bottom = b.bottom - c.bottom - c.row;
  const s = env.phone ? null : env.strip();
  const corner = env.phone ? null : env.corner();
  for (const id of ids) {
    const e = boardEl.querySelector(`.node[data-id="${id}"]`);
    if (!e) return false;
    const r = e.getBoundingClientRect();
    // (The ports stand out of the card's sides by about 8 px.)
    const x0 = r.left - 10, x1 = r.right + 10, y0 = r.top, y1 = r.bottom;
    if (x0 < left || x1 > right || y0 < top || y1 > bottom) return false;
    if (s && x0 < b.left + s.x1 && x1 > b.left + s.x0 && y0 < b.top + s.bottom) return false;
    if (corner && x1 > b.left + corner.x0 && y1 > b.top + corner.y0) return false;
  }
  return true;
}

/** Call once a frame. */
export function tendFocus(g: Game) {
  const now = performance.now();
  listenForZoom();
  const ov = !!document.getElementById('board')?.classList.contains('ov');
  if (!ov) ownOverview = false;
  else if (now - zoomedAt < ZOOM_SETTLES) ownOverview = true;
  if (g !== focusGame) {
    focusGame = g;
    focusGoal = -1;
    focusDue = 0;
  }
  // Behind the start screen, the summary or the time-away card nothing is looked at; the goal on the card when
  // the player gets to it counts as coming up then.
  if (!isStarted() || screenOpen()) {
    focusGoal = -1;
    return;
  }
  const sheet = sheetUp();
  const tree = ui.techOpen;
  if (g.goal.i !== focusGoal) {
    focusGoal = g.goal.i;
    focusDue = now + AFTER_GOAL;
    focusFor = 'goal';
  }
  if ((sheetSeen && !sheet) || (treeSeen && !tree)) {
    // (A goal's own look, still to come, stays a goal's.)
    if (!focusDue) focusFor = 'sheet';
    focusDue = Math.max(focusDue, now + AFTER_SHEET);
  }
  sheetSeen = sheet;
  treeSeen = tree;
  if (!focusDue || now < focusDue) return;
  // (Still due: looked at once the card has gone.)
  if (celebrating()) return;
  focusDue = 0;
  const ids = goalFocus(g);
  const busy = sheet ? 'a sheet is up' : radialOpen() ? 'the build menu is up' : tree ? 'the tree is open' : gestureActive() ? 'a gesture'
    : armedPort() ? 'a port is armed' : ui.placing ? 'placing' : '';
  if (busy || !ids.length) {
    focusLast = { at: g.time, goal: g.goal.i, ids, inView: false, framed: false, why: busy || 'no nodes' };
    return;
  }
  // After a sheet or the tree, an overview the player chose is theirs: it counts as a view of the nodes.
  const theirs = focusFor === 'sheet' && ov && ownOverview;
  const inView = focusInView(ids, theirs);
  // (The board's frameNodes keeps the camera still when they are in view; it is not even asked then. From the player's
  // overview it brings them in at the same zoom; otherwise in among the cards, where the ports are.)
  if (!inView) boardFrames([...ids].reverse(), !theirs);
  focusLast = { at: g.time, goal: g.goal.i, ids, inView, framed: !inView, ...(theirs ? { why: 'overview' } : {}) };
}

/** For scripts: the last look at the goal's nodes. */
export const focusSeen = () => focusLast;

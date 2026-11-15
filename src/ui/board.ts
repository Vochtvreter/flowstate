// The board: world rendering (DOM nodes + SVG wires, patched by id) and every pointer gesture.
// Anything that moves every frame (wire dots, floating gains) is drawn by fx.ts on one canvas.
//
// Gestures, for mouse and finger alike:
//   - drag from a port to wire; drop on empty board for the build menu (a fan, or a sheet on a phone);
//   - or tap a port to arm it, then tap what its wire should go to (see `tapWire`);
//   - drag a card to move it, drag empty board to pan, wheel or two fingers to zoom;
//   - a dragged wire or card scrolls the board when it nears the edge.
// A finger is matched to ports, cards and wires by distance on screen (see `touchHit`), not by what the
// browser says is under it. What the phone layout changes here is read from phone-env.ts.
//
// The board is drawn in two tiers (see `applyView`). From the zoom floor up, cards are cards. Below it
// is the overview: every card is its icon and status ring, nothing has to be read, and the whole
// factory fits the screen. Fit goes there when the factory is too big for the floor.
import { MATERIALS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, Recipe, TECHS } from '../content';
import {
  act, canConnect, connect, cutWires, expandBoard, freeDeposits, materialsAt, nodeById, placeNode, recipesFor, splice,
} from '../actions';
import {
  expansionCost, fmt, fmtRate, labRate, matUnlocked, nodeCost, nodeUnlocked, recipeOf, recipeUnlocked,
} from '../economy';
import { bagTotal, graph, isMachine, isSink, outPortCount } from '../sim';
import { GOALS } from '../goals';
import { GRID, Game, GNode, Wire, snap } from '../state';
import { anchorPt, cachedRect, el, invalidateLayout, pulseAnchor, setClass, setHTML, setStyle, setText, svgEl } from './dom';
import {
  Beacon, Flow, floater, flowPoint, fly, frameFx, invalidateFx, makeFlow, setBeacons, setFlowPath, setFlows,
} from './fx';
import {
  Box, CARD_GAP, Card, NODE_W, Port, Pt, View, ZOOM, bezierAt, boxUnion, centreView, fadeColor, fitBox, fitZoom, frameBox,
  freeSpot as nearestSpot, inPorts, matColor, nodeSize, outPorts, pathD, pinchView, segmentsCross, separate, wireEnds,
} from './geom';
import { isTouch, pressWord } from './hud-words';
import { esc, icon, matGlyph, matShape, nodeIcon } from './icons';
import { env } from './phone-env';
import { diagnose } from './status';
import { delegate, onPress, select, signal, toast, touch, ui } from './ui';

let boardEl: HTMLElement;
let worldEl: HTMLElement;
let plotEl: HTMLElement;
let plotLabel: HTMLElement;
let depositsEl: HTMLElement;
let wiresSvg: SVGSVGElement;
let nodesEl: HTMLElement;
let chipsEl: HTMLElement;
let ghostEl: HTMLElement;
let expandEl: HTMLButtonElement;
let radialEl: HTMLElement;
/** The build menu as a bottom sheet (phone layout). It lives beside the board, not in it, so its list can scroll. */
let buildEl: HTMLElement;
let appEl: HTMLElement | null = null;
let tempPath: SVGPathElement;
let tempEnd: SVGCircleElement;
let knifeLine: SVGLineElement;

interface NodeRefs {
  el: HTMLElement; ring: SVGCircleElement | null; rate: HTMLElement; sub: HTMLElement; pill: HTMLElement;
  outs: HTMLElement[]; open: boolean[];
  /** Everything the element's structure depends on; a different signature means rebuild. */
  sig: string;
  x: number; y: number;
  // last values written, so the slow update only touches what changed
  cRate: string; cSub: string; cRing: number; cSt: string; cPill: string;
  // rate and utilisation: smoothed for display, and as last shown (see `settle`)
  sRate: number; vRate: number; sUtil: number; vUtil: number;
}
interface WireRefs {
  g: SVGGElement; hit: SVGPathElement; glow: SVGPathElement; base: SVGPathElement; chip: HTMLElement; chipText: HTMLElement;
  a: Pt; b: Pt; flow: Flow;
  chipX: number; chipY: number; chipHw: number;
  /** No place on the wire where its chip would not cover a card. */
  chipOff: boolean;
  /** This wire is selected, or runs to or from the selected node. */
  on: boolean;
  /** Its rate chip is showing (see `chipWanted`). */
  shown: boolean;
  /** Another part of the board is in focus: this wire is drawn faint. */
  dim: boolean;
  /** Until when (performance.now) the wire counts as just made: its chip shows and it is never dimmed. */
  fresh: number;
  /** The wire's material colour (its dots are drawn in a faded version of it while the wire is dim). */
  cColor: string; cWidth: number; cFlowing: boolean | null; cSat: boolean | null;
  /** What the chip should read, and what its element reads now (only a chip on show is written to). */
  cChip: string; dChip: string;
  sRate: number; vRate: number;
}
const nodeEls = new Map<number, NodeRefs>();
const wireEls = new Map<number, WireRefs>();

let renderedGame: Game | null = null;
let renderedRev = -1;
let renderedUi = -1;
let depositsHtml = '';
let selNodeId: number | null = null;
let selWireId: number | null = null;
let targetId: number | null = null;
/** The overview tier: zoomed out past the floor. Cards are icons, nothing on the board has to be read. */
let over = false;
/** How far into the overview, 1 to 3: icons and wires are drawn larger the further out the camera is. */
let ovStep = 0;
/**
 * Cards are set in the larger type (title and rate at 15 px, see "the board in large type" in
 * phone.css): always in the phone layout, and elsewhere below 100% zoom, so the type stays readable
 * down to the floor.
 */
let big = false;
/** In the larger type, the second line of each card is too small to read at this zoom, so it is hidden. */
let lean = false;
let mouse: Pt = { x: 0, y: 0 };
/** What the mouse is resting on, for the rate chips (a finger does not hover). */
let hoverNode: number | null = null;
let hoverWire: number | null = null;
/** Nodes whose border should flash once the next structure sync has run. */
const flashQueue: number[] = [];

/** How close (screen px) a dragged wire has to come to a node before it snaps on. */
const SNAP_PX = 40;
/** The same for a tap while a port is armed: nearer than this to a valid node counts as tapping it. */
const TAP_SNAP_PX = 20;

// Touch. All distances are screen pixels, whatever the zoom.
/** A finger this close to a port's centre means the port, even when it is on the card (a 44 px target). */
const PORT_NEAR = 22;
/** Input ports get a little less, so that the left edge of a card still selects and drags it. */
const PORT_IN_NEAR = 18;
/** Off the cards, the nearest output port within this distance is taken. */
const PORT_REACH = 44;
/**
 * Off the cards and this close to an output port, the port also comes before a wire that passes under
 * the finger, as long as that wire is long enough (WIRE_LONG on screen) to be tapped somewhere else.
 */
const PORT_EDGE = 30;
const WIRE_LONG = 100;
/** Half the width of the band along a wire that selects it (28 px in all). */
const WIRE_REACH = 14;
/** A finger that just misses a card, by no more than this, still means the card (when nothing else is nearer). */
const CARD_NEAR = 10;
/** How far a finger may wander and still be a tap, and how far it must go before a node or a wire follows it. */
const TOUCH_SLOP = 10;
/** A finger pans the board after this much movement (and the board then starts from where the finger is, without a jump). */
const PAN_SLOP = 8;
/** The mouse is steadier: a node follows after this much. */
const MOUSE_SLOP = 4;

/** While something is dragged within this distance of the edge of the visible board, the board scrolls. */
const EDGE_PX = 52;
/** Fastest edge scroll, in screen px per second. */
const EDGE_SPEED = 640;

/**
 * Zoom limits. The floor of the detailed tier is set by type size: below it the text on a card could
 * not be read. Cards use 15 px type under 100% (see `big`), which is 10.5 px on screen at 0.7 and 11 px
 * at the phone's 0.74.
 *
 * Below the floor is the overview, where nothing is read. It goes as far out as it takes to show the
 * whole factory with a margin (see `zoomMin`), never past ZOOM.min. A factory that fits the screen at
 * the floor has no overview: the board stops at the floor, as it always did.
 */
const zoomFloor = () => (env.phone ? ZOOM.phoneFloor : ZOOM.floor);
const zoomMax = () => (env.phone ? 1.5 : 2);
/** In the larger type the 12 px second line of a card is shown from this zoom up (11 px on screen). */
const LEAN_BELOW = 0.92;
/** Outside the phone layout, cards switch to the larger type under this zoom, and back at 100%. */
const BIG_BELOW = 0.985;
/** The overview begins a little under the floor and ends at it, so a pinch resting on the line does not flicker. */
const OVER_BELOW = 0.985;
/** A factory that misses fitting at the floor by no more than this is shown at the floor anyway, in thinner margins. */
const NEAR_FIT = 0.97;
/** The zoom a tap on a card in the overview comes back in to. */
const READ_ZOOM = 1;
/** How long a rate chip stays on a wire that was just made, and how long that wire is kept from dimming. */
const FRESH_MS = 3000;

type WireDrag = { kind: 'wire'; from: number; port: number; mats: MatId[]; a: Pt; p: Pt; target: number | null; tp: Pt; blend: number; armed: boolean; sx: number; sy: number; slop: number; touch: boolean };
type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean; slop: number; place: boolean;
      /** A finger came down near (not on) this output port: if it turns out to be a tap, the port is armed. */
      near?: { id: number; port: number } }
  | { kind: 'node'; id: number; ox: number; oy: number; x0: number; y0: number; moved: boolean; sx: number; sy: number; slop: number }
  | WireDrag
  | { kind: 'wireIn'; to: number; mat: MatId | null; b: Pt; p: Pt; target: number | null; tp: Pt; blend: number; armed: boolean; sx: number; sy: number; slop: number }
  | { kind: 'wirePress'; wireId: number; sx: number; sy: number; slop: number; touch: boolean }
  | { kind: 'knife'; a: Pt; b: Pt }
  /** Two fingers: `a` and `b` are their pointer ids; the rest is how things stood when the pair formed. */
  | { kind: 'pinch'; a: number; b: number; mx: number; my: number; dist: number; vx: number; vy: number; vk: number };
let drag: Drag | null = null;
/** The pointer that owns `drag`. Other pointers (a second finger) cannot steer it. */
let dragPointer = -1;
/** Where that pointer was last seen, in client pixels (edge scrolling steers the drag from here). */
const lastClient: Pt = { x: 0, y: 0 };
/** Every finger currently on the board, by pointer id, in client pixels. */
const fingers = new Map<number, Pt>();

/**
 * Wiring by tap: an output port that was tapped and is waiting for the player to tap where its
 * wire should go. It has the shape of a wire being dragged, so the same code can draw it (for a
 * mouse, which can hover) and connect it.
 */
let tapWire: (WireDrag & { hover: boolean }) | null = null;
/** Nodes currently marked as possible or impossible ends for the wire being made. */
const marked = new Set<number>();
let markedFor: { from: number; port: number; quiet: boolean } | null = null;

interface RadialOpt { type: NodeType; recipe?: string; label: string; sub: string; cost: number; locked?: string; glyph: string }
interface RadialState { at: Pt; opts: RadialOpt[]; dir: 'consume' | 'produce'; from: number; port: number; to: number; mat: MatId | null; a: Pt }
let radial: RadialState | null = null;

// ---------- coordinates ----------

const rectOf = cachedRect(() => boardEl);
/** The board's client rect. Cached: call invalidateLayout() (dom.ts) after anything that moves or resizes the stage. */
export const boardRect = () => rectOf();

export function toWorld(cx: number, cy: number): Pt {
  const r = rectOf();
  return { x: (cx - r.left - ui.view.x) / ui.view.k, y: (cy - r.top - ui.view.y) / ui.view.k };
}

/** World point to board-local pixels. */
export function toScreen(p: Pt): Pt {
  return { x: p.x * ui.view.k + ui.view.x, y: p.y * ui.view.k + ui.view.y };
}

/** World point to client pixels (what fx and getBoundingClientRect use). */
export function toClient(p: Pt): Pt {
  const r = rectOf();
  return { x: p.x * ui.view.k + ui.view.x + r.left, y: p.y * ui.view.k + ui.view.y + r.top };
}

/**
 * Keep some of the board on screen, so a long pan or an edge scroll can never lose it: at least
 * `keep` pixels of the plot stay inside the stage on each axis (which leaves room for the Expand
 * button under it).
 */
function clampView() {
  const g = ui.g;
  const r = rectOf();
  if (!g || r.width < 2 || r.height < 2) return;
  const v = ui.view;
  const keepX = Math.min(140, r.width * 0.4), keepY = Math.min(140, r.height * 0.4);
  v.x = Math.max(keepX - g.board.w * v.k, Math.min(r.width - keepX, v.x));
  v.y = Math.max(keepY - g.board.h * v.k, Math.min(r.height - keepY, v.y));
}

function applyView() {
  clampView();
  const { x, y, k } = ui.view;
  worldEl.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  boardEl.style.backgroundSize = `${24 * k}px ${24 * k}px`;
  boardEl.style.backgroundPosition = `${x}px ${y}px`;
  const floor = zoomFloor();
  const wasOver = over, wasBig = big, wasLean = lean, wasStep = ovStep;
  over = wasOver ? k < floor - 1e-6 : k < floor * OVER_BELOW;
  big = env.phone || (wasBig ? k < 1 - 1e-6 : k < BIG_BELOW);
  lean = big && k < LEAN_BELOW;
  // Icons and wires are a fixed size in board units, so they are drawn larger in steps as the camera
  // pulls back: an icon is never under 24 px on screen, a wire never under 1.4 px.
  ovStep = !over ? 0 : k >= 0.55 ? 1 : k >= 0.4 ? 2 : 3;
  if (over !== wasOver) boardEl.classList.toggle('ov', over);
  if (ovStep !== wasStep) {
    if (ovStep) boardEl.dataset.ov = String(ovStep);
    else delete boardEl.dataset.ov;
  }
  if (big !== wasBig) boardEl.classList.toggle('big', big);
  if (lean !== wasLean) boardEl.classList.toggle('lean', lean);
  placeExpand();
  if (!renderedGame) return;
  // Back in among the cards by the player's own hand: Fit has nothing left to return to.
  if (wasOver && !over) fitBack = fitAt = null;
  // The deposits' second line is worded for the type size.
  if (big !== wasBig) syncDeposits(ui.g);
  // Text that was left alone in the overview is brought up to date on the way back in, and the second
  // line of a card is worded differently in the larger type.
  if ((wasOver && !over) || big !== wasBig) updateSlow();
  // Chips appeared or disappeared, or changed size, which changes what the dots must avoid.
  if (over !== wasOver || big !== wasBig) {
    syncChips();
    layoutWires();
  }
}

/**
 * As far out as the board goes. A factory that fits the screen at the floor of the detailed tier stops
 * there. A bigger one can be pulled back into the overview until all of it shows with a margin.
 */
function zoomMin(): number {
  const floor = zoomFloor();
  const box = builtBox();
  if (!box || !renderedGame) return floor;
  const k = fitTarget(box).k;
  return k >= floor ? floor : Math.max(ZOOM.min, k * 0.9);
}

/** (Never forces the camera in: a view that is already further out than the limit may stay where it is.) */
const clampK = (k: number) => Math.max(Math.min(zoomMin(), ui.view.k), Math.min(zoomMax(), k));

/**
 * A camera move in progress: the view eases to `x`, `y`, `k`. With `from`, it is a timed move (`t` of
 * `dur` seconds along an ease-out curve); without, it closes in on the target a share of the way each frame.
 */
interface Glide extends View { from?: View; t?: number; dur?: number }
let glide: Glide | null = null;

/**
 * Move the camera. With `smooth` it glides there on a phone, and anywhere when a duration is given
 * (`ms`); it jumps when the player asked for less motion, and before the board has been drawn.
 */
function moveView(x: number, y: number, k: number, smooth: boolean, ms = 0) {
  if (smooth && !env.calm && renderedGame && (env.phone || ms > 0)) {
    glide = ms > 0 ? { x, y, k, from: { ...ui.view }, t: 0, dur: ms / 1000 } : { x, y, k };
    return;
  }
  glide = null;
  ui.view.x = x;
  ui.view.y = y;
  ui.view.k = k;
  applyView();
}

function stepGlide(dt: number) {
  const gl = glide;
  if (!gl) return;
  const v = ui.view;
  const step = Math.min(dt, 0.1);
  let done = false;
  if (gl.from && gl.dur) {
    gl.t = (gl.t ?? 0) + step;
    const u = Math.min(1, gl.t / gl.dur);
    const e = 1 - (1 - u) * (1 - u) * (1 - u);
    // The zoom is eased by ratio and the middle of the stage is carried across the board in a straight
    // line, so a move that zooms does not swing sideways on the way.
    const r = rectOf();
    const cx = r.width / 2, cy = r.height / 2;
    const f = gl.from;
    const k = f.k * Math.pow(gl.k / f.k, e);
    const wx0 = (cx - f.x) / f.k, wy0 = (cy - f.y) / f.k;
    const wx1 = (cx - gl.x) / gl.k, wy1 = (cy - gl.y) / gl.k;
    v.k = k;
    v.x = cx - (wx0 + (wx1 - wx0) * e) * k;
    v.y = cy - (wy0 + (wy1 - wy0) * e) * k;
    done = u >= 1;
  } else {
    const f = 1 - Math.exp(-step / 0.07);
    v.x += (gl.x - v.x) * f;
    v.y += (gl.y - v.y) * f;
    v.k += (gl.k - v.k) * f;
    done = Math.abs(gl.x - v.x) < 0.5 && Math.abs(gl.y - v.y) < 0.5 && Math.abs(gl.k - v.k) < 0.002;
  }
  if (done) {
    v.x = gl.x;
    v.y = gl.y;
    v.k = gl.k;
    glide = null;
  }
  const before = v.x + v.y;
  applyView();
  // Stopped by the edge of the board: there is nowhere further to go.
  if (glide && Math.abs(v.x + v.y - before) > 0.01) glide = null;
}

/** Where the camera is, or where it is on its way to. */
const viewAhead = (): View => (glide ? { x: glide.x, y: glide.y, k: glide.k } : ui.view);

/**
 * True while the browser is in the middle of handing over a press or a key: what is running now is
 * something the player just asked for, not something the game decided to do. (`fitView` is called
 * both by the Fit controls and by celebrations, with the same arguments.)
 */
function byHand(): boolean {
  const e = (window as unknown as { event?: Event }).event;
  return !!e && (e.type === 'pointerdown' || e.type === 'pointerup' || e.type === 'click' || e.type === 'keydown');
}

/**
 * The part of the board the player can actually see: the stage minus whatever covers its edges.
 * Board-local pixels. With `row`, the floating controls at the bottom count as covered too.
 */
function freeArea(row = false): { x0: number; y0: number; x1: number; y1: number } {
  const r = rectOf();
  const c = env.cover();
  const x0 = Math.min(c.left, r.width * 0.5), y0 = Math.min(c.top, r.height * 0.5);
  return { x0, y0, x1: Math.max(x0 + 40, r.width - c.right), y1: Math.max(y0 + 40, r.height - c.bottom - (row ? c.row : 0)) };
}

const inset = (b: Box, by: number): Box => {
  const x = Math.min(by, (b.x1 - b.x0) / 2 - 20), y = Math.min(by, (b.y1 - b.y0) / 2 - 20);
  return { x0: b.x0 + Math.max(0, x), y0: b.y0 + Math.max(0, y), x1: b.x1 - Math.max(0, x), y1: b.y1 - Math.max(0, y) };
};

/** A card as a box, with room for the ports that stick out of its sides and the status pill on top. */
function cardBox(n: GNode): Box {
  const { w, h } = nodeSize(n);
  return { x0: n.x - 10, y0: n.y - 14, x1: n.x + w + 10, y1: n.y + h + 4 };
}

/** Every node as one box (with room for the ports that stick out), or null on an empty board. */
function nodesBox(): Box | null {
  let box: Box | null = null;
  for (const n of ui.g.nodes) box = boxUnion(box, cardBox(n));
  return box;
}

/** What Fit frames: everything that has been built, with a little air around it. */
function builtBox(): Box | null {
  const b = nodesBox();
  return b && { x0: b.x0 - 14, y0: b.y0 - 14, x1: b.x1 + 14, y1: b.y1 + 14 };
}

/** Clear space kept between the strip and whatever the camera brings into view beside or below it. */
const STRIP_GAP = 14;

/**
 * The camera that shows a world box in the part of the stage nothing covers: clear of the strip, an
 * open sheet and the corner controls. As large as fits, up to 100%. A box too big for the floor of the
 * detailed tier is shown in the overview instead, unless `detailed` is set: then the camera stays at
 * the floor, on the middle of the box.
 */
function fitTarget(box: Box, detailed = false): View {
  const floor = zoomFloor();
  const plot = ui.g.board;
  const settle = (area: Box, k: number) => {
    const v = centreView(box, area, k >= floor ? k : detailed || k >= floor * NEAR_FIT ? floor : Math.max(ZOOM.min, k));
    // No more empty ground past the plot's edge than there has to be: where the plot is larger than
    // the space it fills it, and where it is smaller it sits in the middle. (What is built lies inside
    // the plot, so this never pushes any of it out of view.)
    const along = (at: number, size: number, a0: number, a1: number) =>
      size * v.k <= a1 - a0 ? (a0 + a1 - size * v.k) / 2 : Math.min(a0, Math.max(a1 - size * v.k, at));
    v.x = along(v.x, plot.w, area.x0, area.x1);
    v.y = along(v.y, plot.h, area.y0, area.y1);
    return v;
  };
  if (env.phone) {
    // Clear of the floating controls when that leaves room at a readable zoom; otherwise behind them
    // (they sit in the corners), with thinner margins. The overview keeps clear of them again.
    const clear = inset(freeArea(true), 14), behind = inset(freeArea(), 6);
    const k1 = fitZoom(box, clear), k2 = fitZoom(box, behind);
    if (k1 >= floor * NEAR_FIT || k2 < floor * NEAR_FIT) return settle(clear, k1);
    return settle(behind, k2);
  }
  // Outside the phone layout the strip hangs over the middle of the top edge: what is built is wide, so
  // the strip counts as a band across the stage. The zoom buttons and the minimap hold the bottom right
  // corner: the space is either everything to their left or everything above them, whichever shows more.
  const r = rectOf();
  const s = env.strip();
  const y0 = (s ? s.bottom : 40) + 22;
  const full: Box = { x0: 40, y0, x1: Math.max(100, r.width - 40), y1: Math.max(y0 + 120, r.height - 48) };
  let area = full;
  const c = env.corner();
  if (c) {
    const v = settle(full, fitZoom(box, full));
    if (box.x1 * v.k + v.x > c.x0 - STRIP_GAP && box.y1 * v.k + v.y > c.y0 - STRIP_GAP) {
      const left: Box = { ...full, x1: Math.max(full.x0 + 100, c.x0 - STRIP_GAP) }, above: Box = { ...full, y1: Math.max(full.y0 + 100, c.y0 - STRIP_GAP) };
      area = fitZoom(box, left) >= fitZoom(box, above) ? left : above;
    }
  }
  return settle(area, fitZoom(box, area));
}

/** How long Fit, a tap on a card in the overview, and a camera move that follows a build take, in ms. */
const FIT_MS = 360, FRAME_MS = 320;
/** The view the player had before Fit (or an expansion) took the camera into the overview, and where that left it. */
let fitBack: View | null = null;
let fitAt: View | null = null;
/** For a moment after a game is loaded or the layout changes, Fit is the opening view, not the player's own press. */
let openingUntil = 0;

const sameView = (a: View, b: View) => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.k - b.k) < 0.004;

/**
 * Show what has been built, as large as it fits clear of the strip, an open sheet and the corner
 * controls: among the cards when the factory fits the screen at a readable zoom, and in the overview
 * (every card an icon) when it does not. Pressed again from that overview, Fit returns to the view the
 * player had. A game that has just been loaded opens among the cards, on the middle of the factory.
 */
export function fitView(smooth = false) {
  const g = ui.g;
  const hand = byHand();
  const animate = smooth || hand;
  const now = viewAhead();
  if (hand && fitBack && fitAt && sameView(now, fitAt)) {
    const back = fitBack;
    fitBack = fitAt = null;
    moveView(back.x, back.y, back.k, animate, FIT_MS);
    return;
  }
  const opening = !renderedGame || renderedGame !== g || performance.now() < openingUntil;
  const t = fitTarget(builtBox() ?? { x0: 0, y0: 0, x1: g.board.w, y1: g.board.h }, opening);
  if (t.k < zoomFloor()) {
    if (!fitBack || !over) fitBack = { ...now };
    fitAt = t;
  } else fitBack = fitAt = null;
  moveView(t.x, t.y, t.k, animate, FIT_MS);
}

/** The view that puts a node in the middle of what the player can see, at zoom `k`. */
function centredOn(n: GNode, k: number): View {
  const f = freeArea();
  const { w, h } = nodeSize(n);
  // Outside the phone layout the strip hangs over the middle of the top edge, which is where a centred
  // node would go: it is centred in what is left below the strip instead.
  const s = env.phone ? null : env.strip();
  const y0 = s && f.y1 - s.bottom > h * k + 80 ? s.bottom : f.y0;
  return { x: (f.x0 + f.x1) / 2 - (n.x + w / 2) * k, y: (y0 + f.y1) / 2 - (n.y + h / 2) * k, k };
}

export function jumpTo(id: number) {
  const n = nodeById(ui.g, id);
  if (!n) return;
  // From the overview the camera comes in to where the card can be read.
  const k0 = viewAhead().k;
  const k = k0 < zoomFloor() ? READ_ZOOM : k0;
  const t = centredOn(n, k);
  moveView(t.x, t.y, t.k, true, k === k0 ? 0 : FIT_MS);
  select({ kind: 'node', id });
}

/** A card in the overview was tapped: glide back in to it, at the zoom the player had before Fit if there is one. */
function zoomInTo(id: number) {
  const n = nodeById(ui.g, id);
  if (!n) return;
  const k = fitBack && fitBack.k >= zoomFloor() ? fitBack.k : READ_ZOOM;
  fitBack = fitAt = null;
  const t = centredOn(n, k);
  moveView(t.x, t.y, t.k, true, FIT_MS);
}

/** Pan just enough that a world box is inside the visible part of the board. */
function reveal(bx: number, by: number, bw: number, bh: number) {
  const k = glide?.k ?? ui.view.k;
  const pad = env.phone ? 14 : 40;
  // Kept out from under the floating controls too, unless the space left would be too small for it.
  let f = freeArea(true);
  if (f.y1 - f.y0 - pad * 2 < bh * k) f = freeArea();
  const x0 = f.x0 + pad, x1 = f.x1 - pad, y1 = f.y1 - pad;
  let y0 = f.y0 + pad;
  let x = glide?.x ?? ui.view.x, y = glide?.y ?? ui.view.y;
  const left = bx * k + x;
  if (left + bw * k > x1) x -= left + bw * k - x1;
  else if (left < x0) x += x0 - left;
  // A box bigger than the space shows its top left corner.
  if (env.phone && bx * k + x < x0) x = x0 - bx * k;
  // On a phone the strip spans the stage and is part of what `freeArea` leaves out. Elsewhere it is a
  // card over the middle of the top edge: a box that would end up under it goes below it instead.
  if (!env.phone) {
    const s = env.strip();
    const l = bx * k + x;
    if (s && l < s.x1 + STRIP_GAP && l + bw * k > s.x0 - STRIP_GAP && y1 - (s.bottom + STRIP_GAP) >= bh * k) y0 = Math.max(y0, s.bottom + STRIP_GAP);
  }
  const top = by * k + y;
  if (top + bh * k > y1) y -= top + bh * k - y1;
  else if (top < y0) y += y0 - top;
  if (env.phone && by * k + y < y0) y = y0 - by * k;
  // The zoom buttons and the minimap hold the bottom right corner (outside the phone layout): a box
  // that would end up under them is moved up, or to the left, whichever is less and leaves it in view.
  const c = env.corner();
  if (c) {
    const over = bx * k + x + bw * k - (c.x0 - STRIP_GAP), under = by * k + y + bh * k - (c.y0 - STRIP_GAP);
    if (over > 0 && under > 0) {
      const canUp = by * k + y - under >= y0, canLeft = bx * k + x - over >= x0;
      if (canUp && (under <= over || !canLeft)) y -= under;
      else if (canLeft) x -= over;
    }
  }
  if (x === (glide?.x ?? ui.view.x) && y === (glide?.y ?? ui.view.y)) return;
  moveView(x, y, k, true);
}

/** Pan just enough that a node is fully on screen (e.g. after the inspector opens over it). */
export function ensureVisible(id: number) {
  const n = nodeById(ui.g, id);
  if (!n) return;
  const { w, h } = nodeSize(n);
  // On a phone the ports and the status pill count as part of the card.
  if (env.phone) reveal(n.x - 10, n.y - 14, w + 20, h + 18);
  else reveal(n.x, n.y, w, h);
}

/**
 * Glide the camera, as little as possible, so that these nodes are all in view and clear of the strip,
 * an open sheet and the corner controls. The zoom is kept when they fit at it; otherwise the camera
 * pulls back, but never out of the detailed tier. Nodes too far apart even for that: the last one named
 * is brought into view. Does nothing when they can all be seen already.
 */
export function frameNodes(ids: number[]): void {
  const g = ui.g;
  let box: Box | null = null;
  let last: Box | null = null;
  for (const id of ids) {
    const n = nodeById(g, id);
    if (!n) continue;
    last = cardBox(n);
    box = boxUnion(box, last);
  }
  if (!box || !last) return;
  const cur = viewAhead();
  const floor = zoomFloor();
  // The areas the nodes may be shown in, in order of preference (roomy margins first, then thin ones),
  // and what must not lie over them there.
  const tiers: Box[][] = [];
  const blocks: Box[] = [];
  if (env.phone) {
    const free = freeArea(true);
    tiers.push([inset(free, 14)], [inset(free, 4)]);
    // Behind the floating controls only when the room clear of them is too small for one card.
    if (free.y1 - free.y0 - 8 < (last.y1 - last.y0) * Math.min(cur.k, floor)) tiers.push([inset(freeArea(), 4)]);
  } else {
    const r = rectOf();
    const s = env.strip(), c = env.corner();
    for (const pad of [40, 12]) {
      const full: Box = { x0: pad, y0: pad, x1: Math.max(120, r.width - pad), y1: Math.max(120, r.height - pad) };
      const below = s ? { ...full, y0: s.bottom + STRIP_GAP } : null;
      const tier = [full];
      if (below) tier.push(below);
      if (c) {
        const left = c.x0 - STRIP_GAP, above = c.y0 - STRIP_GAP;
        tier.push({ ...full, x1: left }, { ...full, y1: above });
        if (below) tier.push({ ...below, x1: left }, { ...below, y1: above });
      }
      tiers.push(tier);
    }
    if (c) blocks.push({ x0: c.x0 - STRIP_GAP, y0: c.y0 - STRIP_GAP, x1: Infinity, y1: Infinity });
    if (s) blocks.push({ x0: s.x0 - STRIP_GAP, y0: -Infinity, x1: s.x1 + STRIP_GAP, y1: s.bottom + STRIP_GAP });
  }
  const tryBox = (b: Box): View | null => {
    for (const areas of tiers) {
      let best: View | null = null;
      let bestCost = Infinity;
      for (const area of areas) {
        if (area.x1 - area.x0 < 80 || area.y1 - area.y0 < 60) continue;
        const v = frameBox(cur, b, area, floor);
        const sx0 = b.x0 * v.k + v.x, sy0 = b.y0 * v.k + v.y, sx1 = b.x1 * v.k + v.x, sy1 = b.y1 * v.k + v.y;
        // All of it has to be inside the area (a box too big for the area at the floor is not), under nothing.
        if (sx0 < area.x0 - 0.5 || sy0 < area.y0 - 0.5 || sx1 > area.x1 + 0.5 || sy1 > area.y1 + 0.5) continue;
        if (blocks.some((o) => sx0 < o.x1 && sx1 > o.x0 && sy0 < o.y1 && sy1 > o.y0)) continue;
        // The least change wins: keeping the zoom matters most, then how far the board slides.
        const cost = (cur.k - v.k) * 4000 + Math.abs(v.x - cur.x) + Math.abs(v.y - cur.y);
        if (cost < bestCost) {
          bestCost = cost;
          best = v;
        }
      }
      if (best) return best;
    }
    return null;
  };
  const next = tryBox(box) ?? tryBox(last);
  if (!next) {
    // No room for even one card clear of everything (a very small stage): show its top left corner.
    const tier = tiers[tiers.length - 1];
    const v = frameBox(cur, last, tier[tier.length - 1], floor);
    if (v !== cur) moveView(v.x, v.y, v.k, true, FRAME_MS);
    return;
  }
  if (next !== cur && !sameView(next, cur)) moveView(next.x, next.y, next.k, true, FRAME_MS);
}

export function zoomBy(factor: number, cx?: number, cy?: number) {
  glide = null;
  const r = rectOf();
  const px = (cx ?? r.left + r.width / 2) - r.left;
  const py = (cy ?? r.top + r.height / 2) - r.top;
  const k = clampK(ui.view.k * factor);
  const f = k / ui.view.k;
  ui.view.x = px - (px - ui.view.x) * f;
  ui.view.y = py - (py - ui.view.y) * f;
  ui.view.k = k;
  applyView();
}

/**
 * The layout changed under the board (phone layout on or off, a different input device): redo
 * whatever depends on it at the next frame, and put the zoom back inside its limits.
 */
export function refreshBoard() {
  renderedRev = -1;
  depositsHtml = '';
  openingUntil = performance.now() + 800;
  fitBack = fitAt = null;
  if (radial) closeRadial();
  if (tapWire) disarm();
  if (ui.view.k !== clampK(ui.view.k)) zoomBy(1);
  else applyView();
}

// ---------- the Expand button ----------
// It stands in the world, under the plot. Controls that float over the bottom of the stage (the key
// hints, the zoom buttons and the minimap, the phone's Fit and Undo) must never lie over it, so it
// slides along the plot's edge, out from under them.

let hintsEl: HTMLElement | null = null;
let fabsEl: HTMLElement | null = null;
const hintsRect = cachedRect(() => hintsEl);
const fabsRect = cachedRect(() => fabsEl);
const EXPAND_W = 260, EXPAND_H = 64;
/** How much larger than life the button is drawn at each step of the overview, so it can still be found and pressed. */
const OV_SCALE = [1, 1.5, 1.9, 2.4];

function placeExpand() {
  const g = ui.g;
  if (!g || !expandEl) return;
  const { x: vx, y: vy, k } = ui.view;
  const sc = OV_SCALE[ovStep];
  const w = EXPAND_W * sc * k, h = EXPAND_H * sc * k;
  // Where it would stand left alone: centred under the plot (it grows from the middle of its top edge).
  const home = (g.board.w / 2) * k + vx - w / 2;
  const top = (g.board.h + 18) * k + vy;
  const r = rectOf();
  // What floats over the foot of the stage, in stage pixels.
  const over: Box[] = [];
  const gap = 12;
  const add = (b: DOMRect) => {
    if (b.width > 1 && b.height > 1) over.push({ x0: b.left - r.left - gap, y0: b.top - r.top - gap, x1: b.right - r.left + gap, y1: b.bottom - r.top + gap });
  };
  if (hintsEl) add(hintsRect());
  if (fabsEl && env.phone) add(fabsRect());
  const c = env.corner();
  if (c) over.push({ x0: c.x0 - gap, y0: c.y0 - gap, x1: r.width + 1e6, y1: r.height + 1e6 });
  // The stretches of the x axis that are taken at the button's height; it goes to the nearest free place.
  const taken = over.filter((b) => top < b.y1 && top + h > b.y0).map((b) => [b.x0 - w, b.x1] as [number, number]).sort((a, b) => a[0] - b[0]);
  let left = home;
  const blocked = (x: number) => taken.some(([a, b]) => x > a && x < b);
  if (blocked(home)) {
    let best = Infinity;
    for (const [a, b] of taken) {
      for (const x of [a, b]) {
        if (x < -1e5 || x > 1e5 || blocked(x)) continue;
        if (Math.abs(x - home) < Math.abs(best - home)) best = x;
      }
    }
    if (best < Infinity) left = best;
  }
  // (Written as the left edge of the unscaled button: the scale is about the middle of its top edge.)
  const wx = (left + w / 2 - vx) / k - EXPAND_W / 2;
  setStyle(expandEl, 'left', wx.toFixed(1) + 'px');
  setStyle(expandEl, 'top', g.board.h + 18 + 'px');
}

// ---------- init ----------

export function initBoard(root: HTMLElement) {
  boardEl = root;
  boardEl.innerHTML = `
    <div id="world">
      <div id="plot"><span id="plot-label"></span></div>
      <div id="deposits"></div>
      <svg id="wires" width="1" height="1"></svg>
      <div id="nodes"></div>
      <div id="chips"></div>
      <svg id="overlay" width="1" height="1"><path id="temp-wire"></path><circle id="temp-end" r="5"></circle><line id="knife"></line></svg>
      <div id="ghost"></div>
      <button id="expand" data-testid="expand"></button>
    </div>
    <div id="radial"></div>`;
  worldEl = boardEl.querySelector('#world')!;
  plotEl = boardEl.querySelector('#plot')!;
  plotLabel = boardEl.querySelector('#plot-label')!;
  depositsEl = boardEl.querySelector('#deposits')!;
  wiresSvg = boardEl.querySelector('#wires')!;
  nodesEl = boardEl.querySelector('#nodes')!;
  chipsEl = boardEl.querySelector('#chips')!;
  ghostEl = boardEl.querySelector('#ghost')!;
  expandEl = boardEl.querySelector('#expand')!;
  radialEl = boardEl.querySelector('#radial')!;
  tempPath = boardEl.querySelector('#temp-wire')!;
  tempEnd = boardEl.querySelector('#temp-end')!;
  knifeLine = boardEl.querySelector('#knife')!;
  appEl = boardEl.closest<HTMLElement>('#app');
  hintsEl = document.getElementById('hints');
  buildEl = el(`<div id="build-sheet" role="dialog" aria-label="Build menu"></div>`);
  (boardEl.parentElement ?? boardEl).appendChild(buildEl);

  boardEl.addEventListener('pointerdown', onDown);
  boardEl.addEventListener('pointermove', onMove);
  boardEl.addEventListener('pointerup', onUp);
  boardEl.addEventListener('pointercancel', onCancel);
  boardEl.addEventListener('pointerleave', () => setHover(null, null));
  // A finger that the browser stops reporting without an up or a cancel must not count as resting on the board.
  window.addEventListener('blur', () => fingers.clear());
  // The board never scrolls natively (touch-action: none), but unless the touch moves are also
  // claimed here Chromium still counts a quick drag as the start of a fling, and then swallows the
  // click of any tap in the next half second, wherever on the page it lands. Controls act on click
  // for touch (see onPress), so a build-menu slot or a hotbar button tapped straight after a flick
  // would be ignored.
  boardEl.addEventListener('touchmove', (e) => {
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  boardEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (radial) closeRadial();
    zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });
  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
  onPress(expandEl, expand);
  delegate(radialEl, (a, args) => {
    if (a === 'pick') pickRadial(Number(args[0]));
  });
  delegate(buildEl, (a, args) => {
    if (a === 'pick') pickRadial(Number(args[0]));
    else if (a === 'close') closeRadial();
  });
  // The cached board rect (and the minimap's viewport box) follow the stage's size.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      invalidateLayout();
      touch();
    }).observe(boardEl);
  }
  applyView();
}

// ---------- expanding the board ----------

/** Deposits an expansion has just revealed, and when each one pops in (performance.now). */
const popping = new Map<number, number>();
/** They pop in one after another this far apart, each over POP_MS (see `.deposit.pop` in the stylesheet). */
const POP_STAGGER = 80, POP_MS = 420;
let popTimer = 0;

/**
 * The Expand button was pressed. A successful expansion is an event: the camera glides out to show the
 * new plot together with the factory, the new deposits pop in one after another, and the 'expand'
 * signal goes out for sound and effects. (The first deposit starts as the signal is sent, the next ones
 * POP_STAGGER apart.) With motion reduced, the camera jumps, the deposits are simply there, and a toast
 * says what happened instead.
 */
function expand() {
  const g = ui.g;
  const had = new Set(g.deposits.map((d) => d.id));
  const old = { w: g.board.w, h: g.board.h };
  if (!expandBoard(g)) {
    toast(`Expanding costs <b>${fmt(expansionCost(g))}¢</b>`, 'bad');
    return;
  }
  const fresh = g.deposits.filter((d) => !had.has(d.id)).map((d) => d.id);
  if (env.calm) toast('Board expanded. New deposits revealed.', 'good');
  else {
    const t0 = performance.now();
    fresh.forEach((id, i) => popping.set(id, t0 + i * POP_STAGGER));
    clearTimeout(popTimer);
    // Once the last one has landed they are ordinary deposits again (a later redraw must not replay the pop).
    popTimer = window.setTimeout(() => {
      popping.clear();
      if (ui.g === g) syncDeposits(g);
    }, fresh.length * POP_STAGGER + POP_MS + 120);
  }
  signal('expand', { deposits: fresh, stagger: POP_STAGGER });
  // The new strip of ground, together with everything built.
  const strip: Box = g.board.w > old.w ? { x0: old.w, y0: 0, x1: g.board.w, y1: g.board.h } : { x0: 0, y0: old.h, x1: g.board.w, y1: g.board.h };
  const box = boxUnion(builtBox(), strip);
  const now = viewAhead();
  const t = fitTarget(box);
  // (Fit, pressed afterwards, goes back to where the player was: see `fitView`.)
  if (t.k < zoomFloor()) {
    if (!fitBack || !over) fitBack = { ...now };
    fitAt = t;
  }
  moveView(t.x, t.y, t.k, true, 600);
}

// ---------- structure: nodes ----------

function recipeText(r: Recipe): string {
  const side = (xs: [MatId, number][]) => xs.map(([m, q]) => `${q > 1 ? q + ' ' : ''}${MATERIALS[m].name}`).join(' + ');
  return `${side(r.inputs)} → ${side(r.outputs)}`;
}

function nodeTitle(n: GNode): string {
  if (n.type === 'well' && n.material) return `${MATERIALS[n.material].name} Well`;
  return NODE_DEFS[n.type].name;
}

/** Longest second line that fits a full-width card. Cut here rather than with CSS: see `.ns` in the stylesheet. */
const SUB_CHARS = 19;

function nodeSub(n: GNode): string {
  switch (n.type) {
    case 'well': return `Lv ${n.lv.speed} · deposit`;
    case 'refiner': case 'assembler': case 'fabricator': {
      const r = recipeOf(n);
      // In the larger type this line has less room, so there it only says what comes out.
      const max = big ? SUB_CHARS - 2 : SUB_CHARS;
      const text = !r ? 'no recipe' : big ? `makes ${r.outputs.map(([m]) => MATERIALS[m].name).join(' + ')}` : recipeText(r);
      return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
    }
    case 'router': return `${n.mode} split`;
    case 'merger': return 'junction';
    case 'silo': return 'buffer';
    case 'market': return 'sells anything';
    case 'lab': return 'items → Data';
    case 'void': return 'destroys items';
  }
}

function nodeGlyph(n: GNode): string {
  if (n.type === 'well' && n.material) return matGlyph(n.material, 17);
  if (isMachine(n)) {
    const r = recipeOf(n);
    return r ? matGlyph(r.outputs[0][0], 17) : nodeIcon(n.type, 18);
  }
  if (n.type === 'market') return `<span class="coin">¢</span>`;
  return nodeIcon(n.type, 18);
}

function nodeSig(n: GNode, w: number, h: number, ins: Port[], outs: Port[]): string {
  let s = `${n.type}|${n.recipe}|${n.material}|${w}x${h}`;
  for (const p of ins) s += `|i${p.mat}:${p.y - n.y}`;
  for (const p of outs) s += `|o${p.mat}:${p.y - n.y}`;
  return s;
}

function buildNode(n: GNode, w: number, h: number, ins: Port[], outs: Port[], sig: string): NodeRefs {
  const hasRing = n.type === 'well' || isMachine(n);
  const compact = w < 160;
  const sub = nodeSub(n);
  const e = el(`
    <div class="node t-${n.type}${compact ? ' compact' : ''}" data-id="${n.id}" data-testid="node-${n.type}"
         style="left:${n.x}px;top:${n.y}px;width:${w}px;height:${h}px">
      <div class="ring${hasRing ? '' : ' flat'}">
        ${hasRing ? `<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="17" class="trk"/><circle cx="20" cy="20" r="17" class="val" pathLength="100"/></svg>` : ''}
        <div class="glyph">${nodeGlyph(n)}</div>
      </div>
      <div class="txt"><div class="nt">${esc(nodeTitle(n))}</div><div class="ns">${esc(sub)}</div><div class="nr mono"></div></div>
      <span class="pill"></span>
    </div>`);
  for (const p of ins) {
    const c = n.type === 'market' ? '#FFC857' : n.type === 'lab' ? '#C4A1FF' : matColor(p.mat);
    e.appendChild(el(`<span class="port in" data-in="${p.index}" ${p.mat ? `data-mat="${p.mat}"` : ''} style="top:${p.y - n.y}px;background:${c}"></span>`));
  }
  const outEls: HTMLElement[] = [];
  for (const p of outs) {
    const port = el(`<span class="port out" data-out="${p.index}" data-testid="port-out" style="top:${p.y - n.y}px;background:${matColor(p.mat)}"></span>`);
    outEls.push(port);
    e.appendChild(port);
    if (outs.length > 1 && p.mat) e.appendChild(el(`<span class="port-label" style="top:${p.y - n.y}px">${MATERIALS[p.mat].name}</span>`));
  }
  return {
    el: e,
    ring: e.querySelector<SVGCircleElement>('.val'),
    rate: e.querySelector('.nr')!,
    sub: e.querySelector('.ns')!,
    pill: e.querySelector('.pill')!,
    outs: outEls, open: outEls.map(() => false),
    sig, x: n.x, y: n.y,
    cRate: '', cSub: sub, cRing: -1, cSt: '', cPill: '',
    sRate: -1, vRate: -1, sUtil: -1, vUtil: -1,
  };
}

/** Add a class that plays a CSS animation once, then take it off again so it can never replay. */
function oneShot(e: Element, cls: string, ms: number) {
  e.classList.add(cls);
  setTimeout(() => e.classList.remove(cls), ms);
}

function syncNodes(g: Game, fresh: boolean) {
  const gr = graph(g);
  for (const n of g.nodes) {
    const { w, h } = nodeSize(n);
    const ins = inPorts(n), outs = outPorts(g, n);
    const sig = nodeSig(n, w, h, ins, outs);
    let refs = nodeEls.get(n.id);
    if (!refs) {
      refs = buildNode(n, w, h, ins, outs, sig);
      nodesEl.appendChild(refs.el);
      nodeEls.set(n.id, refs);
      if (!fresh) oneShot(refs.el, 'pop', 320);
    } else if (refs.sig !== sig) {
      // Same node, different shape (recipe or ports changed): swap the element where it stands.
      const next = buildNode(n, w, h, ins, outs, sig);
      for (const cls of ['sel', 'target', 'dragging', 'can', 'cant']) if (refs.el.classList.contains(cls)) next.el.classList.add(cls);
      refs.el.replaceWith(next.el);
      nodeEls.set(n.id, (refs = next));
    } else if (refs.x !== n.x || refs.y !== n.y) {
      refs.el.style.left = n.x + 'px';
      refs.el.style.top = n.y + 'px';
      refs.x = n.x;
      refs.y = n.y;
    }
    // A port with nothing attached pulses to invite a wire.
    const ow = gr.outs.get(n.id);
    for (let i = 0; i < refs.outs.length; i++) {
      const open = !ow?.[i]?.length;
      if (refs.open[i] !== open) {
        refs.open[i] = open;
        refs.outs[i].classList.toggle('open', open);
      }
    }
  }
  if (nodeEls.size !== g.nodes.length) {
    for (const [id, refs] of nodeEls) {
      if (gr.byId.has(id)) continue;
      refs.el.remove();
      nodeEls.delete(id);
    }
  }
}

// ---------- structure: wires ----------

function setWirePath(refs: WireRefs, a: Pt, b: Pt) {
  const d = pathD(a, b);
  refs.hit.setAttribute('d', d);
  refs.glow.setAttribute('d', d);
  refs.base.setAttribute('d', d);
  refs.a = { x: a.x, y: a.y };
  refs.b = { x: b.x, y: b.y };
  setFlowPath(refs.flow, (t) => bezierAt(a, b, t));
}

function buildWire(w: Wire, a: Pt, b: Pt, fresh: boolean): WireRefs {
  const grp = svgEl('g', { class: 'wire stalled', 'data-id': String(w.id) });
  const hit = svgEl('path', { class: 'hit' });
  const glow = svgEl('path', { class: 'glow' });
  const base = svgEl('path', { class: 'base' });
  grp.append(hit, glow, base);
  // A zero-size anchor with the pill centred on it: no percentage transform, so a text change
  // never alters the compositor's property trees.
  const chip = el(`<span class="chip stalled"><i class="mono"></i></span>`);
  const refs: WireRefs = {
    g: grp, hit, glow, base, chip, chipText: chip.firstElementChild as HTMLElement, a, b,
    // A wire that is there when the board loads starts full of dots; one the player just made starts empty.
    flow: makeFlow(fresh),
    chipX: NaN, chipY: NaN, chipHw: 24, chipOff: false, on: false, shown: false, dim: false,
    fresh: fresh ? 0 : performance.now() + FRESH_MS,
    cColor: '', cWidth: -9, cFlowing: false, cSat: false, cChip: '', dChip: '',
    sRate: -1, vRate: -1,
  };
  setWirePath(refs, a, b);
  return refs;
}

function syncWires(g: Game, fresh: boolean) {
  let changed = fresh;
  const seen = new Set<number>();
  for (const w of g.wires) {
    const ends = drawnEnds(g, w);
    if (!ends) continue;
    seen.add(w.id);
    const refs = wireEls.get(w.id);
    if (!refs) {
      const made = buildWire(w, ends.a, ends.b, fresh);
      wiresSvg.appendChild(made.g);
      chipsEl.appendChild(made.chip);
      wireEls.set(w.id, made);
      if (!fresh) oneShot(made.g, 'new', 260);
      changed = true;
    } else if (refs.a.x !== ends.a.x || refs.a.y !== ends.a.y || refs.b.x !== ends.b.x || refs.b.y !== ends.b.y) {
      setWirePath(refs, ends.a, ends.b);
    }
  }
  if (wireEls.size !== seen.size) {
    for (const [id, refs] of wireEls) {
      if (seen.has(id)) continue;
      refs.g.remove();
      refs.chip.remove();
      wireEls.delete(id);
      changed = true;
    }
  }
  if (changed) pushFlows();
}

function pushFlows() {
  const list: Flow[] = [];
  for (const refs of wireEls.values()) list.push(refs.flow);
  setFlows(list);
}

/** Every card as a box. With `grown`, each is as tall as it could ever become (see roomFor). */
function nodeBoxes(skip?: number, grown = false): Box[] {
  const out: Box[] = [];
  for (const n of ui.g.nodes) {
    if (n.id === skip) continue;
    const { w, h } = nodeSize(n);
    out.push({ x0: n.x, y0: n.y, x1: n.x + w, y1: n.y + (grown ? roomFor(n.type, h) : h) });
  }
  return out;
}

/** Deposits with no Well on them, as boxes. */
function depositBoxes(): Box[] {
  const g = ui.g;
  const used = new Set(g.nodes.map((n) => n.depositId));
  const out: Box[] = [];
  for (const d of g.deposits) if (!used.has(d.id)) out.push({ x0: d.x, y0: d.y, x1: d.x + 172, y1: d.y + 72 });
  return out;
}

const CHIP_SPOTS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78];
/** Rate chips are set in bigger type when the cards are (15 px against 10.5), so they take more room. */
const chipScale = () => (big ? 1.42 : 1);

/**
 * Whether a wire's rate chip is on show. The cards already say what each node makes, so a chip is only
 * worth its place when it answers a question the player is asking or should be:
 *  - the wire belongs to the selection (it is selected, or runs to or from the selected node);
 *  - it is a problem wire: nothing flows on it (0/s), or it is full (MAX);
 *  - it was made in the last three seconds;
 *  - the mouse is resting on it or on a node at either end.
 * Never in the overview, where nothing is read. The same on every screen.
 */
function chipWanted(w: Wire, refs: WireRefs, now: number): boolean {
  if (over || refs.chipOff) return false;
  return refs.on || refs.cFlowing === false || refs.cSat === true || now < refs.fresh
    || hoverWire === w.id || (hoverNode != null && (hoverNode === w.from || hoverNode === w.to));
}

/** Write what a chip on show should read: only then is it worked out, and only a change touches the page. */
function writeChip(w: Wire, refs: WireRefs) {
  const src = nodeById(ui.g, w.from);
  const weight = src?.type === 'router' && src.mode === 'ratio' ? `×${w.weight} · ` : '';
  // A saturated wire shows its capacity exactly; otherwise the settled reading.
  refs.cChip = refs.cFlowing ? `${weight}${fmtRate(refs.cSat ? w.rate : Math.max(0, refs.vRate))}/s${refs.cSat ? ' MAX' : ''}` : `${weight}0/s`;
  if (refs.cChip !== refs.dChip) refs.chipText.textContent = refs.dChip = refs.cChip;
}

/** When the next "just made" wire stops being new (performance.now), or 0. Checked once a frame. */
let freshUntil = 0;

/**
 * Bring every wire's chip and strength in line with the selection, the hover and its age: which chips
 * show (see `chipWanted`), and, while something is selected, which wires are drawn faint so that the
 * selection's own stand out. Only what changed is written. Returns true when a chip appeared or went.
 */
function syncChips(): boolean {
  const sel = ui.sel;
  const now = performance.now();
  let chips = false, dims = false;
  let next = 0;
  for (const w of ui.g.wires) {
    const refs = wireEls.get(w.id);
    if (!refs) continue;
    const on = !!sel && (sel.kind === 'wire' ? sel.id === w.id : sel.id === w.from || sel.id === w.to);
    if (on !== refs.on) {
      refs.on = on;
      refs.chip.classList.toggle('on', on);
    }
    const fresh = now < refs.fresh;
    if (fresh && (!next || refs.fresh < next)) next = refs.fresh;
    const show = chipWanted(w, refs, now);
    if (show !== refs.shown) {
      refs.shown = show;
      if (show) writeChip(w, refs);
      refs.chip.classList.toggle('show', show);
      chips = true;
    }
    // A wire that was just made is never faint, whatever is selected.
    const dim = !!sel && !on && !fresh;
    if (dim !== refs.dim) {
      refs.dim = dim;
      refs.g.classList.toggle('dim', dim);
      refs.flow.color = dim ? faded(refs.cColor) : refs.cColor;
      dims = true;
    }
  }
  freshUntil = next;
  // (Dots are batched by colour: a wire whose dots changed colour has to be sorted in again.)
  if (dims) pushFlows();
  return chips;
}

const fadedColors = new Map<string, string>();
/** A wire colour at the strength of a dimmed wire, as a flat colour for its dots. */
function faded(color: string): string {
  let c = fadedColors.get(color);
  if (!c) fadedColors.set(color, (c = fadeColor(color, 0.35)));
  return c;
}

/** The mouse moved onto or off a card or a wire: its chips come and go with it. */
function setHover(node: number | null, wire: number | null) {
  if (node === hoverNode && wire === hoverWire) return;
  hoverNode = node;
  hoverWire = wire;
  if (renderedGame && syncChips()) layoutWires();
}

/**
 * Put each rate chip on its wire where it does not cover a node card (trying the middle first),
 * and tell the dot layer which cards each wire passes behind.
 */
function layoutWires() {
  const boxes = nodeBoxes();
  // Chips also keep off empty deposits, whose labels they would otherwise cover.
  const avoid = boxes.concat(depositBoxes());
  const cs = chipScale();
  let offChanged = false;
  for (const refs of wireEls.values()) {
    const f = refs.flow;
    const hw = Math.max(24, refs.cChip.length * 3.3 + 9) * cs, hh = 11 * cs;
    let spot: Pt | null = null;
    for (const t of CHIP_SPOTS) {
      const p = flowPoint(f, f.len * t);
      let clear = true;
      for (const b of avoid) {
        if (p.x + hw > b.x0 && p.x - hw < b.x1 && p.y + hh > b.y0 && p.y - hh < b.y1) {
          clear = false;
          break;
        }
      }
      if (clear) {
        spot = p;
        break;
      }
    }
    // No clear place on this wire: better no chip than one covering a card.
    if (!spot !== refs.chipOff) {
      refs.chipOff = !spot;
      offChanged = true;
    }
    if (spot) {
      if (spot.x !== refs.chipX || spot.y !== refs.chipY) {
        refs.chipX = spot.x;
        refs.chipY = spot.y;
        refs.chip.style.left = spot.x.toFixed(1) + 'px';
        refs.chip.style.top = spot.y.toFixed(1) + 'px';
      }
    }
    refs.chipHw = hw;
  }
  if (offChanged) syncChips();
  // Dots are drawn above everything in the world, so each wire is told what it must not draw over:
  // node cards, and (while they are showing) rate chips.
  for (const refs of wireEls.values()) {
    const f = refs.flow;
    const occ = f.occ;
    occ.length = 0;
    for (const b of boxes) {
      if (b.x1 < f.x0 || b.x0 > f.x1 || b.y1 < f.y0 || b.y0 > f.y1) continue;
      // Exactly the card's sides (ports sit on them and must keep their dots), a little extra above and below.
      occ.push(b.x0, b.y0 - 2, b.x1, b.y1 + 2);
    }
    if (over) continue;
    for (const c of wireEls.values()) {
      if (!c.shown) continue;
      const hw = c.chipHw + 3, hh = 12 * cs;
      if (c.chipX + hw < f.x0 || c.chipX - hw > f.x1 || c.chipY + hh < f.y0 || c.chipY - hh > f.y1) continue;
      occ.push(c.chipX - hw, c.chipY - hh, c.chipX + hw, c.chipY + hh);
    }
  }
  // Output ports with nothing attached pulse; the pulse is drawn on the effects canvas. (Not in the
  // overview, where there are no ports to see.)
  const open: Beacon[] = [];
  for (const n of over ? [] : ui.g.nodes) {
    const refs = nodeEls.get(n.id);
    if (!refs || refs.open.indexOf(true) < 0) continue;
    const ports = outPorts(ui.g, n);
    for (let i = 0; i < ports.length; i++) if (refs.open[i]) open.push({ x: ports[i].x, y: ports[i].y, r: 7 });
  }
  setBeacons(open);
  invalidateFx();
}

/** After a node moved: redo the wires attached to it, then chips and occlusion for all. */
function relayoutNode(n: GNode) {
  const g = ui.g;
  const gr = graph(g);
  const fix = (w: Wire) => {
    const refs = wireEls.get(w.id);
    const ends = drawnEnds(g, w);
    if (refs && ends) setWirePath(refs, ends.a, ends.b);
  };
  for (const w of gr.ins.get(n.id) ?? []) fix(w);
  for (const port of gr.outs.get(n.id) ?? []) if (port) for (const w of port) fix(w);
  layoutWires();
}

// ---------- structure: the rest ----------

function syncDeposits(g: Game) {
  const used = new Set(g.nodes.map((n) => n.depositId));
  const now = performance.now();
  const html = g.deposits
    .filter((d) => !used.has(d.id))
    .map((d) => {
      const ok = matUnlocked(g, d.mat);
      // A deposit an expansion has just revealed pops in at its turn (see `expand`).
      const at = popping.get(d.id);
      const pop = at == null ? '' : `animation-delay:${Math.round(at - now)}ms;`;
      return `<div class="deposit${ok ? '' : ' locked'}${at == null ? '' : ' pop'}" data-dep="${d.id}" style="left:${d.x}px;top:${d.y}px;${pop}${ok ? `--c:${MATERIALS[d.mat].color}` : ''}">
        ${ok ? matGlyph(d.mat, 18) : icon('lock', 16)}
        <div><div class="dn">${ok ? MATERIALS[d.mat].name + ' deposit' : 'Unknown deposit'}</div><div class="ds">${ok ? (big ? 'place a Well here' : 'empty · place a Well') : 'needs research'}</div></div>
      </div>`;
    })
    .join('');
  if (html !== depositsHtml) {
    depositsHtml = html;
    depositsEl.innerHTML = html;
  }
}

/** Bring the DOM in line with the game: create, patch or remove by id. Nothing is rebuilt that did not change. */
function syncStructure() {
  const g = ui.g;
  const fresh = g !== renderedGame;
  if (fresh) {
    // A different game object (first frame, or a reset): start clean, with no entrance animations.
    renderedGame = g;
    nodesEl.textContent = '';
    wiresSvg.textContent = '';
    chipsEl.textContent = '';
    nodeEls.clear();
    wireEls.clear();
    selNodeId = selWireId = targetId = null;
    flashQueue.length = 0;
    hoverNode = hoverWire = null;
    settling.clear();
    popping.clear();
    fitBack = fitAt = null;
    openingUntil = performance.now() + 800;
    untangle(g);
  }
  setStyle(plotEl, 'width', g.board.w + 'px');
  setStyle(plotEl, 'height', g.board.h + 'px');
  setText(plotLabel, `Board · ${g.board.expansions + 1} plot${g.board.expansions ? 's' : ''}`);
  fabsEl ??= document.getElementById('fabs');
  placeExpand();
  if (fresh) {
    tapWire = null;
    marked.clear();
    markedFor = null;
    boardEl.classList.remove('arming', 'marking');
  }
  syncDeposits(g);
  syncNodes(g, fresh);
  syncWires(g, fresh);
  syncChips();
  layoutWires();
  refreshMarks();
  for (const id of flashQueue.splice(0)) {
    const refs = nodeEls.get(id);
    if (refs) oneShot(refs.el, 'flash', 260);
  }
  livelyUntil = performance.now() + LIVELY_FOR;
  updateSlow();
}

/** Selection, wire target and placing mode are classes on elements that already exist. */
function syncUi() {
  const sel = ui.sel;
  const node = sel?.kind === 'node' ? sel.id : null;
  const wire = sel?.kind === 'wire' ? sel.id : null;
  if (node !== selNodeId || (node != null && !nodeEls.get(node)?.el.classList.contains('sel'))) {
    if (selNodeId != null) nodeEls.get(selNodeId)?.el.classList.remove('sel');
    if (node != null) nodeEls.get(node)?.el.classList.add('sel');
    selNodeId = node;
  }
  if (wire !== selWireId || (wire != null && !wireEls.get(wire)?.g.classList.contains('sel'))) {
    if (selWireId != null) wireEls.get(selWireId)?.g.classList.remove('sel');
    if (wire != null) wireEls.get(wire)?.g.classList.add('sel');
    selWireId = wire;
  }
  if (syncChips()) layoutWires();
  setClass(boardEl, 'placing', !!ui.placing);
  updateGhost();
}

// ---------- per-frame + slow updates ----------

function rateLine(g: Game, n: GNode, rate: number, util: number): string {
  switch (n.type) {
    case 'well': return `${fmtRate(rate)}/s`;
    case 'refiner': case 'assembler': case 'fabricator':
      return n.recipe ? `${fmtRate(rate)}/s · ${Math.round(util * 100)}%` : 'pick a recipe';
    case 'silo': return `${Math.round(bagTotal(n.inb))} stored`;
    case 'market': return `${fmtRate(rate)}/s sold`;
    case 'lab': return `${fmtRate(rate)} / ${fmtRate(labRate(g, n))} /s`;
    default: return `${fmtRate(rate)}/s`;
  }
}

// Readings on the board never quite sit still: items move in bursts, so a wire carrying 0.5/s
// reads 0.46, 0.53, 0.49… from one moment to the next. Showing that raw makes every number on
// screen flicker, and every flicker is a repaint. So each reading is eased a little more for
// display, and the shown value is only replaced once the eased one has clearly moved away from it
// or has come to rest somewhere else.

/** Weight of a new sample in the display average (about two seconds of smoothing at two samples a second). */
const EASE = 0.25;
/** For this long after the player changes the board, readings are shown as they are, so the change is felt at once. */
const LIVELY_FOR = 3000;
let livelyUntil = 0;
let lively = true;

/** Ease `avg` toward `now`; a first sample or a big jump is taken at once, and so is everything while `lively`. */
function ease(avg: number, now: number, jump: number): number {
  return lively || avg < 0 || Math.abs(now - avg) > jump ? now : avg + (now - avg) * EASE;
}

/**
 * The value to keep showing. `shown` stays while the eased reading is within `tol` of it; it is
 * replaced when the reading moves further away, or when the reading has stopped moving and sits
 * most of a display step (`step` is one unit of the last digit shown) from it, so that a steady
 * 1.00 never goes on reading 0.99.
 */
function settle(shown: number, before: number, avg: number, tol: number, step: number): number {
  const off = Math.abs(avg - shown);
  return off >= tol || (off >= step * 0.75 && Math.abs(avg - before) < step * 0.05) ? avg : shown;
}

let expandCost = -1;

function updateNodes(g: Game) {
  for (const n of g.nodes) {
    const refs = nodeEls.get(n.id);
    if (!refs) continue;
    let was = refs.sRate;
    refs.sRate = ease(was, n.rate, Math.max(0.15, was * 0.4));
    refs.vRate = settle(refs.vRate, was, refs.sRate, Math.max(0.012, refs.sRate * 0.025), 0.01);
    was = refs.sUtil;
    refs.sUtil = ease(was, n.util, 0.25);
    refs.vUtil = settle(refs.vUtil, was, refs.sUtil, 0.02, 0.01);
    // In the overview no text shows, so it is left alone (and caught up on the way back in).
    if (!over || refs.cRate === '') {
      const rate = rateLine(g, n, refs.vRate, refs.vUtil);
      if (rate !== refs.cRate) {
        refs.cRate = rate;
        refs.rate.textContent = rate;
      }
      const sub = nodeSub(n);
      if (sub !== refs.cSub) {
        refs.cSub = sub;
        refs.sub.textContent = sub;
      }
    }
    if (refs.ring) {
      const v = Math.round(refs.vUtil * 100);
      if (v !== refs.cRing) {
        refs.cRing = v;
        refs.ring.style.strokeDasharray = `${v} ${100 - v}`;
      }
    }
    const dx = diagnose(g, n);
    let st: string = n.status;
    let pill = '';
    // Wells never get a pill: their ring colour says enough.
    if (n.type !== 'well') {
      if (dx.problem === 'blocked') pill = dx.victim ? '' : 'BLOCKED';
      else if (dx.problem === 'starved') pill = dx.victim ? '' : 'STARVED';
      else if (dx.problem === 'idle') pill = 'IDLE';
    }
    if (dx.problem && dx.victim) st = 'victim';
    if (st !== refs.cSt) {
      refs.cSt = st;
      refs.el.dataset.st = st;
    }
    if (pill !== refs.cPill) {
      refs.cPill = pill;
      refs.pill.textContent = pill;
      refs.pill.dataset.kind = pill.toLowerCase();
    }
  }
}

function updateWires(g: Game) {
  let recolored = false;
  let reshown = false;
  const now = performance.now();
  for (const w of g.wires) {
    const refs = wireEls.get(w.id);
    if (!refs) continue;
    const cap = PIPES[w.tier].cap;
    const flowing = w.rate > 0.015;
    const sat = w.rate >= cap * 0.97;
    const mat = w.mat ?? materialsAt(g, w.from, w.port)[0] ?? null;
    const color = matColor(mat);
    if (color !== refs.cColor) {
      refs.cColor = color;
      refs.g.style.color = color;
      refs.flow.color = refs.dim ? faded(color) : color;
      refs.flow.shape = matShape(mat);
      recolored = true;
    }
    const was = refs.sRate;
    refs.sRate = flowing === refs.cFlowing ? ease(was, w.rate, Math.max(0.15, was * 0.4)) : w.rate;
    refs.vRate = settle(refs.vRate, was, refs.sRate, Math.max(0.012, refs.sRate * 0.025), 0.01);
    const width = 2 + Math.min(5, refs.vRate * 1.1);
    if (Math.abs(width - refs.cWidth) > 0.3) {
      refs.cWidth = width;
      refs.base.style.strokeWidth = width.toFixed(1) + 'px';
      refs.glow.style.strokeWidth = (width + 9).toFixed(1) + 'px';
    }
    if (flowing !== refs.cFlowing) {
      refs.cFlowing = flowing;
      refs.g.classList.toggle('stalled', !flowing);
      refs.chip.classList.toggle('stalled', !flowing);
    }
    if (sat !== refs.cSat) {
      refs.cSat = sat;
      refs.g.classList.toggle('sat', sat);
      refs.chip.classList.toggle('sat', sat);
    }
    // A wire that stopped, started or filled up gains or loses its chip.
    const show = chipWanted(w, refs, now);
    if (show !== refs.shown) {
      refs.shown = show;
      refs.chip.classList.toggle('show', show);
      reshown = true;
    }
    if (show) writeChip(w, refs);
  }
  if (recolored) pushFlows();
  if (reshown) layoutWires();
}

/**
 * Text, rings, pills, wire widths: things that only need refreshing a few times a second.
 * Everything is compared with what was last written, so a steady factory costs almost nothing.
 * The frame loop alternates between the two halves ('nodes', 'wires') so that neither refresh is
 * a long frame; called with no argument it does both.
 */
export function updateSlow(part?: 'nodes' | 'wires') {
  const g = ui.g;
  lively = performance.now() < livelyUntil;
  if (part !== 'wires') updateNodes(g);
  if (part !== 'nodes') updateWires(g);
  const cost = expansionCost(g);
  if (cost !== expandCost) {
    expandCost = cost;
    expandEl.innerHTML = `${icon('plus', 20)}<span><b>Expand board <i class="mono">${fmt(cost)}¢</i></b><small>New plot · reveals deposits</small></span>`;
  }
  setClass(expandEl, 'ok', g.credits >= cost);
  if (ui.placing) updateGhost();
  if (radial) refreshBuildSheet();
}

let gainTimer = 0;

/** Once a second: show what each Market and Lab earned, and send a few coins to the credits counter. */
function showGains() {
  const g = ui.g;
  const r = rectOf();
  const size = Math.max(11, Math.min(15, 9 + 5 * ui.view.k));
  const counter = anchorPt('credits');
  let coins = 6;
  let landed = false;
  const land = () => {
    // One pulse per second at most, however many Markets paid out.
    if (!landed) pulseAnchor('credits');
    landed = true;
  };
  const visible = (p: Pt) => p.x > r.left - 30 && p.x < r.right + 30 && p.y > r.top - 30 && p.y < r.bottom + 30;
  for (const n of g.nodes) {
    if (n.type === 'market' && n.gain >= 0.05) {
      const { w, h } = nodeSize(n);
      const top = toClient({ x: n.x + w / 2 + (Math.random() * 30 - 15), y: n.y - 4 });
      signal('sale', { id: n.id, amount: n.gain, at: top });
      if (visible(top) && !ui.techOpen) {
        floater(top, `+${fmt(n.gain)}¢`, '#FFC857', size);
        if (counter && coins > 0) {
          const count = Math.min(coins, n.gain >= 20 ? 3 : n.gain >= 2 ? 2 : 1);
          coins -= count;
          fly(toClient({ x: n.x + 29, y: n.y + h / 2 }), counter, '#FFC857', count, land);
        }
      }
    }
    n.gain = 0;
    if (n.type === 'lab') {
      const parts: string[] = [];
      if ((n.gainB.a ?? 0) >= 0.05) parts.push(`+${fmt(n.gainB.a!)}α`);
      if ((n.gainB.b ?? 0) >= 0.05) parts.push(`+${fmt(n.gainB.b!)}β`);
      if ((n.gainB.g ?? 0) >= 0.05) parts.push(`+${fmt(n.gainB.g!)}γ`);
      if (parts.length && !ui.techOpen) {
        const { w } = nodeSize(n);
        const top = toClient({ x: n.x + w / 2 + (Math.random() * 30 - 15), y: n.y - 4 });
        if (visible(top)) floater(top, parts.join(' '), '#C4A1FF', size);
      }
      n.gainB = {};
    }
  }
}

export function updateBoard(dt: number) {
  const g = ui.g;
  if (g !== renderedGame || g.rev !== renderedRev) {
    renderedRev = g.rev;
    renderedUi = ui.uiRev;
    syncStructure();
    syncUi();
  } else if (ui.uiRev !== renderedUi) {
    renderedUi = ui.uiRev;
    syncUi();
  }
  for (const w of g.wires) {
    const refs = wireEls.get(w.id);
    if (refs) refs.flow.rate = w.rate;
  }
  // A wire stopped being new: its chip goes, and it may dim with the rest.
  if (freshUntil && performance.now() >= freshUntil && syncChips()) layoutWires();
  if (glide) stepGlide(dt);
  if (settling.size) stepSettle(dt);
  if (drag) edgeScroll(dt);
  if (drag && (drag.kind === 'wire' || drag.kind === 'wireIn')) drawTemp(drag, dt);
  else if (tapWire?.hover && !radial) drawTemp(tapWire, dt);
  if (!g.paused) {
    gainTimer += dt;
    if (gainTimer >= 1) {
      gainTimer = 0;
      showGains();
    }
  }
  // The tech tree covers the whole board, so wire dots are not drawn behind it.
  frameFx(dt, ui.view, g.paused, ui.techOpen);
}

// ---------- placement ----------

function clampToBoard(x: number, y: number, w: number, h: number): Pt {
  const b = ui.g.board;
  return { x: snap(Math.max(20, Math.min(b.w - w - 20, x))), y: snap(Math.max(20, Math.min(b.h - h - 20, y))) };
}

/**
 * Where a w×h card wanted at (x, y) may stand: the nearest spot on the grid that keeps clear of every
 * other card and of every deposit with no Well on it (the rule itself is `freeSpot` in geom.ts, where
 * it is tested). `skip` is the node being moved, if any; `room` is the height to keep clear for it (see
 * roomFor); `dir` is the direction of the wire the card arrives on. Null when the plot is full.
 */
function freeSpot(x: number, y: number, w: number, h: number, skip?: number, room = h, dir?: Pt): Pt | null {
  return nearestSpot({ x, y, w, h: room, avoid: nodeBoxes(skip, true).concat(depositBoxes()), board: ui.g.board, grid: GRID, dir });
}

const NO_ROOM = 'No room left on the board. <b>Expand it</b>, or clear a space.';

// ----- cards that glide to where they belong -----
// A card dropped on top of another is eased to the nearest free spot rather than jumping there (and
// Tidy moves every card at once). The game already has the card at its new place; what glides is how
// far from it the card is drawn, which runs down to nothing. Wires follow.

/** How far from its real place each gliding card is drawn right now, and how it got there. */
const settling = new Map<number, { ox: number; oy: number; fx: number; fy: number; t: number; dur: number }>();

/** Draw a card `fx`, `fy` away from where it now is, and let it glide home over `ms`. Not when motion is reduced. */
function settleFrom(id: number, fx: number, fy: number, ms: number) {
  if (env.calm || (Math.abs(fx) < 1 && Math.abs(fy) < 1)) return;
  settling.set(id, { ox: fx, oy: fy, fx, fy, t: 0, dur: ms / 1000 });
}

/** The ends of a wire as drawn: where they are, plus however far the cards at each end still have to glide. */
function drawnEnds(g: Game, w: Wire) {
  const ends = wireEnds(g, w);
  if (!ends || !settling.size) return ends;
  const a = settling.get(w.from), b = settling.get(w.to);
  if (!a && !b) return ends;
  return {
    a: a ? { ...ends.a, x: ends.a.x + a.ox, y: ends.a.y + a.oy } : ends.a,
    b: b ? { ...ends.b, x: ends.b.x + b.ox, y: ends.b.y + b.oy } : ends.b,
    mat: ends.mat,
  };
}

function stepSettle(dt: number) {
  const g = ui.g;
  const step = Math.min(dt, 0.1);
  let done = false;
  for (const [id, m] of settling) {
    m.t += step;
    const u = Math.min(1, m.t / m.dur);
    const e = 1 - (1 - u) * (1 - u) * (1 - u);
    m.ox = m.fx * (1 - e);
    m.oy = m.fy * (1 - e);
    const refs = nodeEls.get(id);
    if (u >= 1 || !refs) {
      settling.delete(id);
      if (refs) refs.el.style.transform = '';
      done = true;
    } else refs.el.style.transform = `translate(${m.ox.toFixed(1)}px, ${m.oy.toFixed(1)}px)`;
  }
  for (const w of g.wires) {
    if (!done && !settling.has(w.from) && !settling.has(w.to)) continue;
    const refs = wireEls.get(w.id);
    const ends = drawnEnds(g, w);
    if (refs && ends && (refs.a.x !== ends.a.x || refs.a.y !== ends.a.y || refs.b.x !== ends.b.x || refs.b.y !== ends.b.y)) setWirePath(refs, ends.a, ends.b);
  }
  // Chips and what the dots must keep off are put right once everything has come to rest.
  if (!settling.size) layoutWires();
  else invalidateFx();
}

/**
 * A board whose cards rest on one another (an old save, or one a script laid out) is pulled apart as
 * it is loaded: the game itself never lets that happen, and nothing on it can be read while it lasts.
 */
function untangle(g: Game) {
  const cards: Card[] = g.nodes.map((n) => {
    const { w, h } = nodeSize(n);
    return { id: n.id, x: n.x, y: n.y, w, h, room: roomFor(n.type, h), fixed: n.type === 'well' };
  });
  for (const [id, at] of separate(cards, depositBoxes(), g.board, GRID)) {
    const n = nodeById(g, id);
    if (n) {
      n.x = at.x;
      n.y = at.y;
    }
  }
}

const tallest: Partial<Record<NodeType, number>> = {};

/**
 * Height to keep clear for a card of this type. A machine's card grows when it is given a recipe
 * with more ports (an Assembler on its first wire, a Refiner switched to Ink), so the tallest it can
 * become is kept free from the start and it can never grow into the card below.
 */
function roomFor(type: NodeType, h: number): number {
  let max = tallest[type];
  if (max == null) {
    max = 0;
    for (const r of Object.values(RECIPES)) if (r.machine === type) max = Math.max(max, sizeFor(type, r.id).h);
    tallest[type] = max;
  }
  return Math.max(h, max);
}

/** Size a node of this type and recipe will have once placed. */
const sizeFor = (type: NodeType, recipe?: string | null) => nodeSize({ type, recipe: recipe ?? null } as GNode);

function nearestDeposit(p: Pt) {
  let best: { d: ReturnType<typeof freeDeposits>[number]; dist: number } | null = null;
  for (const d of freeDeposits(ui.g)) {
    const dist = Math.hypot(d.x + 86 - p.x, d.y + 36 - p.y);
    if (!best || dist < best.dist) best = { d, dist };
  }
  return best?.d ?? null;
}

function updateGhost() {
  const p = ui.placing;
  if (!p) {
    setStyle(ghostEl, 'display', 'none');
    return;
  }
  const g = ui.g;
  const { w, h } = sizeFor(p.type, p.recipe);
  const cost = nodeCost(g, p.type);
  let ok = cost <= g.credits + 1e-6;
  let label = NODE_DEFS[p.type].name;
  let pos: Pt;
  let onDeposit = false;
  let why = 'not enough credits';
  if (p.type === 'well') {
    const d = nearestDeposit(mouse);
    if (d) {
      pos = { x: d.x, y: d.y };
      label = `${MATERIALS[d.mat].name} Well`;
      onDeposit = true;
    } else {
      pos = clampToBoard(mouse.x - w / 2, mouse.y - h / 2, w, h);
      ok = false;
      label = 'No free deposit';
      why = 'expand the board';
    }
  } else {
    // The ghost stands where the card would go: the nearest free spot to the pointer.
    const spot = freeSpot(mouse.x - w / 2, mouse.y - h / 2, w, h, undefined, roomFor(p.type, h));
    pos = spot ?? clampToBoard(mouse.x - w / 2, mouse.y - h / 2, w, h);
    if (!spot) {
      ok = false;
      why = 'no room: expand the board';
    }
  }
  setStyle(ghostEl, 'display', 'flex');
  setStyle(ghostEl, 'left', pos.x + 'px');
  setStyle(ghostEl, 'top', pos.y + 'px');
  setStyle(ghostEl, 'width', w + 'px');
  setStyle(ghostEl, 'height', h + 'px');
  setClass(ghostEl, 'bad', !ok);
  // On a deposit the ghost is only an outline with its caption underneath, so the deposit's own label stays readable.
  setClass(ghostEl, 'outline', onDeposit);
  const hint = ok ? `${fmt(cost)}¢ · ${pressWord()} to place` : why;
  // In the phone layout a line above the hotbar already says "tap the board to place": the card
  // itself has room for the price only at that type size.
  const brief = ok && env.phone ? `${fmt(cost)}¢` : hint;
  setHTML(ghostEl, onDeposit
    ? `<span class="cap">${nodeIcon(p.type, 15)}${label} · <span class="mono">${hint}</span></span>`
    : `${nodeIcon(p.type, 20)}<span>${label}<small class="mono">${brief}</small></span>`);
}

export function startPlacing(type: NodeType, recipe?: string | null) {
  const g = ui.g;
  if (!nodeUnlocked(g, type)) return;
  if (ui.placing?.type === type) {
    ui.placing = null;
    touch();
    return;
  }
  if (type === 'well' && !freeDeposits(g).length) {
    toast('No free deposit. <b>Expand the board</b> to find more.', 'bad');
    return;
  }
  if (nodeCost(g, type) > g.credits + 1e-6) {
    toast(`${NODE_DEFS[type].name} costs <b>${fmt(nodeCost(g, type))}¢</b>`, 'bad');
    return;
  }
  closeRadial();
  if (tapWire) disarm();
  ui.placing = { type, recipe };
  if (env.touch) {
    // A finger does not hover: the ghost starts in the middle of what the player can see.
    const f = freeArea(true);
    mouse = { x: ((f.x0 + f.x1) / 2 - ui.view.x) / ui.view.k, y: ((f.y0 + f.y1) / 2 - ui.view.y) / ui.view.k };
  }
  touch();
}

/** The first goal that needs the inspector ("Upgrade a Well"). */
const INSPECT_FROM = GOALS.findIndex((x) => x.id === 'upgrade-well');

/**
 * A node has just been built. On a desktop it is selected, which opens the inspector beside the
 * board: but not before the first goal that needs the inspector, because a panel that opens after
 * every build makes the board jump just as a newcomer is finding their feet. On a phone the inspector
 * would cover half the board just as the player wants to wire the new node up, so it is never opened
 * there. Either way the camera makes sure the node can be seen, together with the node its wire comes
 * from (`from`) when there is one.
 */
function built(id: number, from?: number) {
  if (env.phone) {
    if (ui.sel) select(null);
  } else if (ui.g.goal.i >= INSPECT_FROM) select({ kind: 'node', id });
  frameNodes(from == null ? [id] : [from, id]);
}

/** Distance from a point to a wire's path. */
function distToFlow(p: Pt, f: Flow, max: number): number {
  if (p.x < f.x0 - max || p.x > f.x1 + max || p.y < f.y0 - max || p.y > f.y1 + max) return Infinity;
  const pts = f.pts;
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1];
    const dx = pts[i + 2] - ax, dy = pts[i + 3] - ay;
    const len = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len));
    const d = Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

function wireNear(p: Pt, maxDist: number): Wire | null {
  let best: Wire | null = null;
  let bestD = maxDist;
  for (const w of ui.g.wires) {
    const refs = wireEls.get(w.id);
    if (!refs) continue;
    const d = distToFlow(p, refs.flow, maxDist);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

function placeAt(p: Pt, keep: boolean) {
  const g = ui.g;
  const pl = ui.placing!;
  let node: GNode | null = null;
  if (pl.type === 'well') {
    const d = nearestDeposit(p);
    if (!d) return toast('No free deposit. <b>Expand the board</b> to find more.', 'bad');
    node = placeNode(g, 'well', d.x, d.y, { depositId: d.id });
  } else {
    const { w, h } = sizeFor(pl.type, pl.recipe);
    const pos = freeSpot(p.x - w / 2, p.y - h / 2, w, h, undefined, roomFor(pl.type, h));
    if (!pos) return toast(NO_ROOM, 'bad');
    const onWire = wireNear(p, 16);
    act(g, () => {
      node = placeNode(g, pl.type, pos.x, pos.y, { recipe: pl.recipe });
      if (!node) return false;
      if (onWire) splice(g, onWire.id, node.id);
      return 0;
    });
  }
  if (!node) return toast(`Not enough credits for a ${NODE_DEFS[pl.type].name}`, 'bad');
  if (!keep || nodeCost(g, pl.type) > g.credits) ui.placing = null;
  touch();
  built((node as GNode).id);
  signal('place', { id: (node as GNode).id, type: pl.type });
}

// ---------- pointer gestures ----------

/** The node whose card contains a world point (topmost first). */
function nodeAt(p: Pt): GNode | null {
  const nodes = ui.g.nodes;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const { w, h } = nodeSize(n);
    if (p.x >= n.x && p.x <= n.x + w && p.y >= n.y && p.y <= n.y + h) return n;
  }
  return null;
}

/**
 * Where a dragged wire should attach: the node under the pointer if it is a valid end,
 * otherwise the nearest valid node within `reach` px on screen.
 */
function snapTarget(p: Pt, ok: (n: GNode) => boolean, reach = SNAP_PX): GNode | null {
  const nodes = ui.g.nodes;
  let best: GNode | null = null;
  let bestD = reach / ui.view.k;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const { w, h } = nodeSize(n);
    const dx = Math.max(n.x - p.x, 0, p.x - (n.x + w));
    const dy = Math.max(n.y - p.y, 0, p.y - (n.y + h));
    if (dx === 0 && dy === 0) return ok(n) ? n : null;
    const d = Math.hypot(dx, dy);
    if (d < bestD && ok(n)) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

let tempD = '';

function hideTemp() {
  tempPath.classList.remove('on', 'snap');
  tempEnd.classList.remove('on');
  tempD = '';
}

/** The wire being dragged: a curve from the port to the pointer that eases onto a target's port when it snaps. */
function drawTemp(d: Extract<Drag, { kind: 'wire' | 'wireIn' }>, dt: number) {
  const goal = d.target != null ? 1 : 0;
  d.blend += (goal - d.blend) * (1 - Math.exp(-dt / 0.045));
  if (Math.abs(goal - d.blend) < 0.01) d.blend = goal;
  const free = { x: d.p.x + (d.tp.x - d.p.x) * d.blend, y: d.p.y + (d.tp.y - d.p.y) * d.blend };
  const from = d.kind === 'wire' ? d.a : free;
  const to = d.kind === 'wire' ? free : d.b;
  const path = pathD(from, to);
  const key = path + goal;
  if (key === tempD) return;
  tempD = key;
  const color = matColor(d.kind === 'wire' ? d.mats[0] ?? null : d.mat);
  tempPath.setAttribute('d', path);
  tempPath.style.stroke = color;
  tempPath.classList.add('on');
  tempPath.classList.toggle('snap', d.target != null);
  tempEnd.setAttribute('cx', String(free.x));
  tempEnd.setAttribute('cy', String(free.y));
  tempEnd.style.fill = color;
  tempEnd.classList.add('on');
}

function highlightTarget(id: number | null) {
  if (id === targetId) return;
  if (targetId != null) nodeEls.get(targetId)?.el.classList.remove('target');
  if (id != null) nodeEls.get(id)?.el.classList.add('target');
  targetId = id;
}

// ----- which nodes a wire may go to: shown while a port is armed, and while a wire is dragged -----

/**
 * Why a wire from this port would be no use to that node, in words for the player, or '' when the
 * node can use what the wire carries. A machine can use a material its recipe takes (or, with no recipe
 * yet, one that some recipe it knows takes). Everything else takes anything. A source that carries
 * nothing yet (a Router with no input) is never refused: what it will carry is not known.
 */
function noUse(g: Game, from: number, port: number, to: number): string {
  const tn = nodeById(g, to);
  if (!tn || !isMachine(tn)) return '';
  const mats = materialsAt(g, from, port);
  if (!mats.length) return '';
  const takes = (x: Recipe) => x.inputs.some((i) => mats.includes(i[0]));
  const r = recipeOf(tn);
  if (r ? takes(r) : recipesFor(g, tn.type).some(takes)) return '';
  const name = NODE_DEFS[tn.type].name;
  return `The ${r ? `${r.name} ${name}` : name} cannot use ${mats.map((m) => MATERIALS[m].name).join(' or ')}`;
}

/** A wire from this port to that node can be made, and would be of use there. */
const wireOk = (g: Game, from: number, port: number, to: number) => canConnect(g, from, port, to) && !noUse(g, from, port, to);

/** The output port of `src` that a wire drawn back from an input for `mat` starts at. */
function portFor(src: GNode, mat: MatId | null): number {
  const r = recipeOf(src);
  return isMachine(src) && r && mat ? Math.max(0, r.outputs.findIndex((o) => o[0] === mat)) : 0;
}

/**
 * Mark every node the wire from this port could go to and dim the rest (a node that could take the
 * wire but has no use for what it carries is dimmed too). A finger hides what is under it, so for touch
 * the possible ends also glow; a mouse (`quiet`) gets the dimming alone.
 */
function markTargets(from: number, port: number, quiet = false) {
  const g = ui.g;
  markedFor = { from, port, quiet };
  boardEl.classList.add(quiet ? 'marking' : 'arming');
  for (const n of g.nodes) {
    const refs = nodeEls.get(n.id);
    if (!refs) continue;
    const can = n.id !== from && wireOk(g, from, port, n.id);
    refs.el.classList.toggle('can', can);
    refs.el.classList.toggle('cant', !can && n.id !== from);
    marked.add(n.id);
  }
}

function clearMarks() {
  if (!markedFor) return;
  markedFor = null;
  boardEl.classList.remove('arming', 'marking');
  for (const id of marked) nodeEls.get(id)?.el.classList.remove('can', 'cant');
  marked.clear();
}

/** After the board changed: drop an armed port that no longer exists, and re-mark targets (new nodes, new wires). */
function refreshMarks() {
  if (tapWire) {
    const n = nodeById(ui.g, tapWire.from);
    const a = n && outPorts(ui.g, n)[tapWire.port];
    if (!a) disarm();
    else {
      tapWire.a = a;
      tapWire.mats = materialsAt(ui.g, tapWire.from, tapWire.port);
      if (!tapWire.hover) tapWire.p = tapWire.tp = a;
      nodeEls.get(tapWire.from)?.outs[tapWire.port]?.classList.add('armed');
    }
  }
  if (markedFor) markTargets(markedFor.from, markedFor.port, markedFor.quiet);
}

/** Arm an output port: it waits for a tap on whatever its wire should go to. */
function arm(d: WireDrag) {
  if (tapWire) disarm();
  tapWire = { ...d, p: d.a, tp: d.a, target: null, blend: 0, armed: false, hover: false };
  nodeEls.get(d.from)?.outs[d.port]?.classList.add('armed');
  markTargets(d.from, d.port);
  // The inspector would sit over half the board on a phone; the player is choosing a target now.
  if (env.phone && ui.sel) select(null);
  else touch();
}

/** Arm a port that was tapped near rather than on. */
function armPort(from: number, port: number) {
  const g = ui.g;
  const n = nodeById(g, from);
  const a = n && outPorts(g, n)[port];
  if (!a) return;
  arm({ kind: 'wire', from, port, mats: materialsAt(g, from, port), a, p: a, target: null, tp: a, blend: 0, armed: false, sx: 0, sy: 0, slop: TOUCH_SLOP, touch: true });
}

function disarm() {
  if (!tapWire) return;
  nodeEls.get(tapWire.from)?.outs[tapWire.port]?.classList.remove('armed');
  tapWire = null;
  clearMarks();
  highlightTarget(null);
  if (!drag) hideTemp();
  touch();
}

/** The port that is armed for wiring by tap, if any (the phone shell shows a hint and a Cancel for it). */
export const armedPort = (): { from: number; port: number; mat: MatId | null } | null =>
  tapWire ? { from: tapWire.from, port: tapWire.port, mat: tapWire.mats[0] ?? null } : null;

/** Stop wiring by tap. Returns false when no port was armed. */
export function cancelArmed(): boolean {
  if (!tapWire) return false;
  disarm();
  return true;
}

/** Where a wire from these materials attaches on a node: the matching input, or the first. */
function inPortFor(tn: GNode, mats: MatId[], fallback: Pt): Pt {
  const ins = inPorts(tn);
  return ins.find((ip) => ip.mat && mats.includes(ip.mat)) ?? ins[0] ?? fallback;
}

/**
 * Connect a port to a node, with everything the player should see and hear. Used by drag and by tap.
 * A node that has no use for what the wire carries refuses it, with the reason. Returns true when the
 * wire was made.
 */
function makeWire(from: number, port: number, target: number, tp: Pt): boolean {
  const g = ui.g;
  const why = canConnect(g, from, port, target) ? noUse(g, from, port, target) : '';
  if (why) {
    toast(why, 'bad');
    return false;
  }
  if (!connect(g, from, port, target)) return false;
  flashQueue.push(target);
  signal('connect', { from, to: target, at: toClient(tp) });
  // If either end is out of view or under the HUD, the camera brings both in.
  frameNodes([from, target]);
  return true;
}

/** A port is armed and the player tapped a node. */
function tapNode(id: number) {
  const t = tapWire;
  if (!t) return;
  const g = ui.g;
  if (id !== t.from && canConnect(g, t.from, t.port, id)) {
    const tn = nodeById(g, id)!;
    // A node with no use for the wire says so, and the port stays armed for another try.
    const why = noUse(g, t.from, t.port, id);
    if (why) {
      toast(why, 'bad');
      return;
    }
    disarm();
    makeWire(t.from, t.port, id, inPortFor(tn, t.mats, t.a));
    return;
  }
  // Anything else cancels. A node that cannot take the wire is simply selected, as a tap would do.
  disarm();
  if (id !== t.from) select({ kind: 'node', id });
}

/** A port is armed and the player tapped the board where there is no node. */
function tapEmpty(p: Pt) {
  const t = tapWire;
  if (!t) return;
  const g = ui.g;
  // A mouse has been shown where the wire would snap: a click takes exactly that. A finger gets a
  // smaller margin, since nothing showed it which node a near miss would count for.
  const near = snapTarget(p, (n) => wireOk(g, t.from, t.port, n.id), t.hover ? SNAP_PX : TAP_SNAP_PX);
  if (near) return tapNode(near.id);
  disarm();
  // Right beside the port there is no room to build: that tap only cancels.
  if (Math.hypot(p.x - t.a.x, p.y - t.a.y) > 36 && !nodeAt(p)) {
    openRadial({ at: p, dir: 'consume', from: t.from, port: t.port, to: 0, mat: t.mats[0] ?? null, a: t.a, opts: consumeOptions(g, t.mats) });
  }
}

// ----- what is under the pointer -----

type Hit =
  | { kind: 'out'; id: number; port: number }
  /** Not on the port, but within reach of it: a tap there arms it, a drag there pans. */
  | { kind: 'reach'; id: number; port: number }
  | { kind: 'in'; id: number; port: number; mat: MatId | null }
  | { kind: 'node'; id: number }
  | { kind: 'wire'; id: number }
  | null;

/** A mouse points exactly, so what it pressed is what the browser says it pressed. */
function mouseHit(t: HTMLElement): Hit {
  const nodeEl = t.closest<HTMLElement>('.node');
  if (nodeEl) {
    const id = Number(nodeEl.dataset.id);
    // (In the overview a card has no ports to press, and wires cannot be picked: see the stylesheet.)
    if (over) return { kind: 'node', id };
    const portOut = t.closest<HTMLElement>('.port.out');
    if (portOut) return { kind: 'out', id, port: Number(portOut.dataset.out) };
    const portIn = t.closest<HTMLElement>('.port.in');
    if (portIn) return { kind: 'in', id, port: Number(portIn.dataset.in), mat: (portIn.dataset.mat as MatId) ?? null };
    return { kind: 'node', id };
  }
  const wireEl = (t as Element).closest?.('g.wire') as SVGGElement | null;
  if (wireEl) return { kind: 'wire', id: Number(wireEl.dataset.id) };
  return null;
}

/**
 * A finger does not: ports are 14 px dots and wires a few pixels wide, and the browser reports a
 * touch as landing on whatever interesting thing is near it, not on what is under it. So a touch is
 * matched by distance on screen, whatever the zoom. In order: a port right under the finger, the card
 * under the finger, a wire within reach (unless the finger is right beside a port and the wire is a
 * long one), the nearest output port within reach, a card the finger just missed.
 *
 * (The port's reach comes before the near miss of a card: a tap a little to the right of a Well's
 * port is a tap for the port, not for the Well.)
 *
 * Only the first of those starts a wire when the finger drags. The gaps between cards are where
 * a thumb goes to pan, and they are full of wires and within reach of ports: a drag that starts
 * there pans, and only a tap there selects the wire or arms the port.
 *
 * In the overview there are no ports and no wires to aim at: a touch is on a card or on nothing.
 */
function touchHit(p: Pt): Hit {
  const g = ui.g;
  const k = ui.view.k;
  if (over) {
    const n = nodeAt(p) ?? cardNear(p, CARD_NEAR / k);
    return n ? { kind: 'node', id: n.id } : null;
  }
  const reach = PORT_REACH / k;
  let out: { id: number; port: number } | null = null, dOut = Infinity;
  let inn: { id: number; port: number; mat: MatId | null } | null = null, dIn = Infinity;
  for (const n of g.nodes) {
    const { w, h } = nodeSize(n);
    if (p.x < n.x - reach || p.x > n.x + w + reach || p.y < n.y - reach || p.y > n.y + h + reach) continue;
    for (const o of outPorts(g, n)) {
      const d = Math.hypot(o.x - p.x, o.y - p.y) * k;
      if (d < dOut) {
        dOut = d;
        out = { id: n.id, port: o.index };
      }
    }
    for (const i of inPorts(n)) {
      const d = Math.hypot(i.x - p.x, i.y - p.y) * k;
      if (d < dIn) {
        dIn = d;
        inn = { id: n.id, port: i.index, mat: i.mat };
      }
    }
  }
  if (out && dOut <= PORT_NEAR && dOut <= dIn) return { kind: 'out', ...out };
  if (inn && dIn <= PORT_IN_NEAR) return { kind: 'in', ...inn };
  const on = nodeAt(p);
  if (on) return { kind: 'node', id: on.id };
  // A wire comes before the wider reach of a port: every wire starts at one, and a short wire
  // would otherwise have nowhere left to be tapped (and so could never be cut). Right beside the
  // port, though, a tap is for the port: a long wire can be tapped further along.
  const w = wireNear(p, WIRE_REACH / k);
  if (w && !(out && dOut <= PORT_EDGE && (wireEls.get(w.id)?.flow.len ?? 0) * k >= WIRE_LONG)) return { kind: 'wire', id: w.id };
  if (out && dOut <= PORT_REACH) return { kind: 'reach', ...out };
  const near = cardNear(p, CARD_NEAR / k);
  return near ? { kind: 'node', id: near.id } : null;
}

/** The card nearest to a world point, within `max` (world px) of its edge. */
function cardNear(p: Pt, max: number): GNode | null {
  let best: GNode | null = null;
  let bestD = max;
  for (const n of ui.g.nodes) {
    const { w, h } = nodeSize(n);
    const d = Math.hypot(Math.max(n.x - p.x, 0, p.x - (n.x + w)), Math.max(n.y - p.y, 0, p.y - (n.y + h)));
    if (d <= bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

function startWire(from: number, port: number, cx: number, cy: number, p: Pt, touchy: boolean): boolean {
  const g = ui.g;
  const n = nodeById(g, from);
  const a = n && outPorts(g, n)[port];
  if (!a) return false;
  drag = {
    kind: 'wire', from, port, mats: materialsAt(g, from, port), a, p, target: null, tp: p, blend: 0, armed: false,
    sx: cx, sy: cy, slop: touchy ? TOUCH_SLOP : 6, touch: touchy,
  };
  boardEl.classList.add('wiring');
  return true;
}

/** The wire has left its port and is being dragged for real. */
function wireUnderWay(d: WireDrag) {
  d.armed = true;
  if (tapWire) disarm();
  // What cannot take the wire is dimmed. A finger hides what is under it, so for touch the possible
  // ends are lit up as well, as they are for wiring by tap.
  markTargets(d.from, d.port, !d.touch);
  if (d.touch && env.phone && ui.sel) select(null);
}

// ----- two fingers -----

/** Start (or restart) a pinch from the first two fingers on the board, measured from how things stand now. */
function startPinch() {
  const ids = [...fingers.keys()];
  if (ids.length < 2) return;
  const a = fingers.get(ids[0])!, b = fingers.get(ids[1])!;
  const r = rectOf();
  drag = {
    kind: 'pinch', a: ids[0], b: ids[1],
    mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top,
    // Fingers that start almost touching would turn a twitch into a big zoom, so the spread never counts as less than this.
    dist: Math.max(30, Math.hypot(a.x - b.x, a.y - b.y)),
    vx: ui.view.x, vy: ui.view.y, vk: ui.view.k,
  };
  dragPointer = -1;
}

function movePinch(d: Extract<Drag, { kind: 'pinch' }>) {
  const a = fingers.get(d.a), b = fingers.get(d.b);
  if (!a || !b) return;
  const r = rectOf();
  const now = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
  const v = pinchView({ x: d.vx, y: d.vy, k: d.vk }, { x: d.mx, y: d.my }, d.dist, now, Math.max(30, Math.hypot(a.x - b.x, a.y - b.y)), clampK);
  ui.view.x = v.x;
  ui.view.y = v.y;
  ui.view.k = v.k;
  applyView();
}

/** A finger left the board (lifted or cancelled). Returns true when that was handled as part of a pinch. */
function fingerGone(id: number): boolean {
  fingers.delete(id);
  const d = drag;
  if (d?.kind !== 'pinch') return false;
  if (id !== d.a && id !== d.b) return true;
  if (fingers.size >= 2) startPinch();
  else if (fingers.size === 1) {
    // One finger left: it carries on as a pan, from where the board is now.
    const [rest] = fingers.keys();
    const f = fingers.get(rest)!;
    drag = { kind: 'pan', sx: f.x, sy: f.y, vx: ui.view.x, vy: ui.view.y, moved: true, slop: 0, place: false };
    dragPointer = rest;
    lastClient.x = f.x;
    lastClient.y = f.y;
  } else drag = null;
  return true;
}

function onDown(e: PointerEvent) {
  const t = e.target as HTMLElement;
  const onControl = !!(t.closest('#radial') || t.closest('#expand'));
  // A press on the board takes the camera over from whatever move was under way. (Not a press on a
  // control that stands on the board: Expand starts a camera move of its own.)
  if (!onControl) glide = null;
  if (e.pointerType === 'touch' && !onControl) {
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size >= 2) {
      // A second finger: whatever the first was doing ends (a node in mid-move is dropped where it
      // is, a half-drawn wire is let go), and the two of them move the camera.
      boardEl.setPointerCapture(e.pointerId);
      if (radial) closeRadial();
      // (A node that was only pressed, not moved, is let go without being selected.)
      if (drag?.kind === 'node' && !drag.moved) endDrag();
      else finishDrag();
      startPinch();
      return;
    }
  }
  // A press while a gesture is still going (a release that never reached us) finishes that gesture
  // first, so a node in mid-move is dropped properly rather than left behind.
  finishDrag();
  dragPointer = e.pointerId;
  lastClient.x = e.clientX;
  lastClient.y = e.clientY;
  if (e.button === 1 || e.button === 2) {
    if (ui.placing) {
      ui.placing = null;
      touch();
    }
    if (radial) closeRadial();
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: ui.view.x, vy: ui.view.y, moved: true, slop: 0, place: false };
    boardEl.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0) return;
  if (onControl) return;
  if (radial) {
    closeRadial();
    return;
  }
  const p = toWorld(e.clientX, e.clientY);
  mouse = p;
  const g = ui.g;
  const touchy = e.pointerType !== 'mouse';
  boardEl.setPointerCapture(e.pointerId);

  if (ui.placing) {
    // A finger may be about to pan, so it places on release, and only if it was a tap.
    if (touchy) drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: ui.view.x, vy: ui.view.y, moved: false, slop: PAN_SLOP, place: true };
    else placeAt(p, e.shiftKey);
    return;
  }
  if (e.shiftKey) {
    drag = { kind: 'knife', a: p, b: p };
    return;
  }
  const hit = touchy ? touchHit(p) : mouseHit(t);
  if (hit?.kind === 'out') {
    startWire(hit.id, hit.port, e.clientX, e.clientY, p, touchy);
    return;
  }
  if (hit?.kind === 'in') {
    const n = nodeById(g, hit.id);
    const b = n && inPorts(n)[hit.port];
    if (!b) return;
    drag = {
      kind: 'wireIn', to: hit.id, mat: hit.mat, b, p, target: null, tp: p, blend: 0, armed: false,
      sx: e.clientX, sy: e.clientY, slop: touchy ? TOUCH_SLOP : 6,
    };
    boardEl.classList.add('wiring');
    return;
  }
  if (hit?.kind === 'node') {
    const n = nodeById(g, hit.id);
    if (!n) return;
    // Only the old position is remembered here; the undo step is built when the node is dropped.
    drag = {
      kind: 'node', id: hit.id, ox: p.x - n.x, oy: p.y - n.y, x0: n.x, y0: n.y, moved: false,
      sx: e.clientX, sy: e.clientY, slop: touchy ? TOUCH_SLOP : MOUSE_SLOP,
    };
    return;
  }
  if (hit?.kind === 'wire') {
    drag = { kind: 'wirePress', wireId: hit.id, sx: e.clientX, sy: e.clientY, slop: touchy ? TOUCH_SLOP + 2 : 6, touch: touchy };
    return;
  }
  drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: ui.view.x, vy: ui.view.y, moved: false, slop: touchy ? PAN_SLOP : 0, place: false };
  if (hit?.kind === 'reach') drag.near = { id: hit.id, port: hit.port };
}

function onMove(e: PointerEvent) {
  const f = fingers.get(e.pointerId);
  if (f) {
    f.x = e.clientX;
    f.y = e.clientY;
  }
  if (drag?.kind === 'pinch') {
    if (e.pointerId === drag.a || e.pointerId === drag.b) movePinch(drag);
    return;
  }
  if (drag && e.pointerId !== dragPointer) return;
  lastClient.x = e.clientX;
  lastClient.y = e.clientY;
  if (e.pointerType === 'mouse' && !drag) {
    // What the mouse rests on shows its rate chips.
    const t = e.target as Element;
    const nodeEl = t.closest?.('.node') as HTMLElement | null;
    const wireEl = nodeEl ? null : (t.closest?.('g.wire') as SVGGElement | null);
    setHover(nodeEl ? Number(nodeEl.dataset.id) : null, wireEl ? Number(wireEl.dataset.id) : null);
  } else if (hoverNode != null || hoverWire != null) setHover(null, null);
  steer(e.clientX, e.clientY, e.pointerType === 'mouse');
}

/** Move whatever is being dragged to a client position. Also called by edge scrolling, when the board moved under a still pointer. */
function steer(cx: number, cy: number, hovering = false) {
  const p = toWorld(cx, cy);
  mouse = p;
  const g = ui.g;
  if (ui.placing) updateGhost();
  if (!drag) {
    // A mouse shows where the armed wire would go; a finger cannot hover.
    const t = tapWire;
    if (t && hovering && !radial) {
      t.hover = true;
      t.p = p;
      const tn = snapTarget(p, (n) => wireOk(g, t.from, t.port, n.id));
      t.target = tn?.id ?? null;
      if (tn) t.tp = inPortFor(tn, t.mats, p);
      highlightTarget(t.target);
    }
    return;
  }
  switch (drag.kind) {
    case 'pan': {
      let dx = cx - drag.sx, dy = cy - drag.sy;
      if (drag.slop) {
        // A finger: nothing moves until it has clearly left the spot, and then the board starts from there.
        if (!drag.moved) {
          if (Math.hypot(dx, dy) < drag.slop) break;
          drag.moved = true;
          drag.sx = cx;
          drag.sy = cy;
          dx = dy = 0;
        }
      } else if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      ui.view.x = drag.vx + dx;
      ui.view.y = drag.vy + dy;
      applyView();
      break;
    }
    case 'node': {
      if (!drag.moved && Math.hypot(cx - drag.sx, cy - drag.sy) < drag.slop) break;
      const n = nodeById(g, drag.id);
      if (!n) break;
      if (n.type === 'well') {
        // A Well stays on its deposit. Under a finger the drag pans the board instead, so that a
        // swipe that happens to start on a Well still goes somewhere.
        if (drag.slop >= TOUCH_SLOP) drag = { kind: 'pan', sx: cx, sy: cy, vx: ui.view.x, vy: ui.view.y, moved: true, slop: 0, place: false };
        break;
      }
      if (!drag.moved) {
        drag.moved = true;
        // On a phone the inspector sheet gets out of the way while its node is carried about.
        appEl?.classList.add('carrying');
      }
      const { w, h } = nodeSize(n);
      const pos = clampToBoard(p.x - drag.ox, p.y - drag.oy, w, h);
      if (pos.x !== n.x || pos.y !== n.y) {
        n.x = pos.x;
        n.y = pos.y;
        const refs = nodeEls.get(n.id);
        if (refs) {
          refs.el.style.left = n.x + 'px';
          refs.el.style.top = n.y + 'px';
          refs.x = n.x;
          refs.y = n.y;
          refs.el.classList.add('dragging');
        }
        relayoutNode(n);
      }
      break;
    }
    case 'wirePress': {
      if (Math.hypot(cx - drag.sx, cy - drag.sy) < drag.slop) break;
      const press = drag;
      if (press.touch) {
        // Under a finger a drag that starts on a wire pans (see touchHit); the board starts from here.
        drag = { kind: 'pan', sx: cx, sy: cy, vx: ui.view.x, vy: ui.view.y, moved: true, slop: 0, place: false };
        break;
      }
      const w = g.wires.find((x) => x.id === press.wireId);
      // With a mouse, dragging off the middle of a wire branches a new one from the same port.
      if (!w || !startWire(w.from, w.port, cx, cy, p, false)) drag = null;
      break;
    }
    case 'wire': {
      const d = drag;
      d.p = p;
      if (!d.armed && Math.hypot(cx - d.sx, cy - d.sy) > d.slop) wireUnderWay(d);
      const tn = d.armed ? snapTarget(p, (n) => wireOk(g, d.from, d.port, n.id)) : null;
      d.target = tn?.id ?? null;
      if (tn) d.tp = inPortFor(tn, d.mats, p);
      highlightTarget(d.target);
      break;
    }
    case 'wireIn': {
      const d = drag;
      d.p = p;
      if (!d.armed && Math.hypot(cx - d.sx, cy - d.sy) > d.slop) {
        d.armed = true;
        if (tapWire) disarm();
        if (env.phone && ui.sel) select(null);
      }
      const sn = d.armed ? snapTarget(p, (n) => !isSink(n) && n.id !== d.to && !noUse(g, n.id, portFor(n, d.mat), d.to)) : null;
      d.target = sn?.id ?? null;
      if (sn) d.tp = outPorts(g, sn)[portFor(sn, d.mat)] ?? outPorts(g, sn)[0] ?? p;
      highlightTarget(d.target);
      break;
    }
    case 'knife': {
      drag.b = p;
      knifeLine.classList.add('on');
      knifeLine.setAttribute('x1', String(drag.a.x));
      knifeLine.setAttribute('y1', String(drag.a.y));
      knifeLine.setAttribute('x2', String(p.x));
      knifeLine.setAttribute('y2', String(p.y));
      break;
    }
  }
}

/**
 * While a wire or a node is dragged near the edge of the visible board, the board scrolls under it,
 * faster the nearer the edge. On a phone the visible board ends where a sheet or the strip begins.
 */
function edgeScroll(dt: number) {
  const d = drag;
  if (!d || dt <= 0) return;
  // A wire that has found something to snap to stays put: the player is where they wanted to be.
  const live = ((d.kind === 'wire' || d.kind === 'wireIn') && d.armed && d.target == null) || (d.kind === 'node' && d.moved);
  if (!live) return;
  const r = rectOf();
  const f = freeArea();
  const x = lastClient.x - r.left, y = lastClient.y - r.top;
  // The band is narrower on a small screen, so there is always a calm middle.
  const ex = Math.min(EDGE_PX, (f.x1 - f.x0) * 0.2), ey = Math.min(EDGE_PX, (f.y1 - f.y0) * 0.2);
  const push = (into: number, band: number) => Math.max(0, Math.min(1, into / band));
  const vx = push(f.x0 + ex - x, ex) - push(x - (f.x1 - ex), ex);
  const vy = push(f.y0 + ey - y, ey) - push(y - (f.y1 - ey), ey);
  if (!vx && !vy) return;
  const step = EDGE_SPEED * Math.min(dt, 0.05);
  const bx = ui.view.x, by = ui.view.y;
  ui.view.x += vx * step;
  ui.view.y += vy * step;
  applyView();
  // The pointer has not moved but the board under it has.
  if (ui.view.x !== bx || ui.view.y !== by) steer(lastClient.x, lastClient.y);
}

function endDrag() {
  if (drag?.kind === 'node') nodeEls.get(drag.id)?.el.classList.remove('dragging');
  drag = null;
  boardEl.classList.remove('wiring');
  appEl?.classList.remove('carrying');
  highlightTarget(null);
  hideTemp();
  knifeLine.classList.remove('on');
  // Marks put up for a dragged wire come down; those of an armed port stay.
  if (markedFor && !tapWire) clearMarks();
}

/** Give up on the gesture in progress. A node that was being moved goes back to where it started. */
function abortDrag() {
  if (drag?.kind === 'node' && drag.moved) {
    const n = nodeById(ui.g, drag.id);
    const refs = nodeEls.get(drag.id);
    if (n && refs) {
      n.x = refs.x = drag.x0;
      n.y = refs.y = drag.y0;
      refs.el.style.left = n.x + 'px';
      refs.el.style.top = n.y + 'px';
      relayoutNode(n);
    }
  }
  endDrag();
}

/** Finish moving a node: settle it on a free spot and record one undo step for the move. */
function dropNode(d: Extract<Drag, { kind: 'node' }>) {
  const g = ui.g;
  const n = nodeById(g, d.id);
  nodeEls.get(d.id)?.el.classList.remove('dragging');
  appEl?.classList.remove('carrying');
  if (!n) return; // deleted while it was being dragged: nothing to record
  if (d.moved) {
    const { w, h } = nodeSize(n);
    // Dropping a loose node on a wire splices it in.
    const loose = !g.wires.some((x) => x.from === n.id || x.to === n.id);
    const onWire = loose ? wireNear({ x: n.x + w / 2, y: n.y + h / 2 }, 18) : null;
    // Let go on top of another card (or too close to one), it goes to the nearest free spot; with
    // nowhere free at all, back to where it came from.
    const let_go = { x: n.x, y: n.y };
    const spot = freeSpot(n.x, n.y, w, h, n.id, roomFor(n.type, h)) ?? { x: d.x0, y: d.y0 };
    // The node goes back to where it started for a moment, so that the undo step is taken now
    // (at press time it would also roll back anything else done during the drag) and shows only
    // this node moving. Move and splice are one step: a single undo puts the node back.
    n.x = d.x0;
    n.y = d.y0;
    if (spot.x !== d.x0 || spot.y !== d.y0 || onWire) {
      act(g, () => {
        n.x = spot.x;
        n.y = spot.y;
        if (onWire) splice(g, onWire.id, n.id);
        return 0;
      });
    } else g.rev++;
    // It is eased there from where it was let go, not jumped.
    settleFrom(n.id, let_go.x - spot.x, let_go.y - spot.y, 180);
  }
  const again = ui.sel?.kind === 'node' && ui.sel.id === d.id;
  select({ kind: 'node', id: d.id });
  // The frame loop pans to a node when it becomes the selection. This one already was, and on a
  // phone it may have been dropped where the returning sheet will cover it.
  if (env.phone && d.moved && again) ensureVisible(d.id);
}

/** End whatever gesture is in progress: a node being moved is dropped where it is, anything else is abandoned. */
function finishDrag() {
  if (!drag) return;
  if (drag.kind === 'node') dropNode(drag);
  endDrag();
}

function onCancel(e: PointerEvent) {
  if (fingerGone(e.pointerId)) return;
  if (e.pointerId === dragPointer) abortDrag();
}

function onUp(e: PointerEvent) {
  const g = ui.g;
  if (fingerGone(e.pointerId)) return;
  const d = drag;
  if (!d || e.pointerId !== dragPointer) return;
  const p = toWorld(e.clientX, e.clientY);
  switch (d.kind) {
    case 'pan':
      if (d.moved) break;
      if (d.place) {
        if (ui.placing) placeAt(p, false);
      } else if (tapWire) {
        // (The gesture is wound up first: the build menu this may open draws with the wire preview.)
        endDrag();
        tapEmpty(p);
        return;
      } else if (d.near) {
        endDrag();
        armPort(d.near.id, d.near.port);
        return;
      } else if (ui.sel) select(null);
      break;
    case 'node':
      if (!d.moved && tapWire) tapNode(d.id);
      // A tap on a card in the overview comes back in to it.
      else if (!d.moved && over) zoomInTo(d.id);
      else dropNode(d);
      break;
    case 'wirePress':
      if (tapWire) disarm();
      select({ kind: 'wire', id: d.wireId });
      break;
    case 'wire': {
      if (!d.armed) {
        // A tap on a port arms it; a tap on the armed port lets it go again.
        if (tapWire && tapWire.from === d.from && tapWire.port === d.port) disarm();
        else {
          endDrag();
          arm(d);
          return;
        }
      } else if (d.target != null) makeWire(d.from, d.port, d.target, d.tp);
      else {
        const on = nodeAt(p);
        if (on) {
          // Dropped on a card that would not snap: if that is because it has no use for the wire, say so.
          const why = on.id !== d.from && canConnect(g, d.from, d.port, on.id) ? noUse(g, d.from, d.port, on.id) : '';
          if (why) toast(why, 'bad');
        } else if (Math.hypot(p.x - d.a.x, p.y - d.a.y) > 36) {
          endDrag();
          openRadial({ at: p, dir: 'consume', from: d.from, port: d.port, to: 0, mat: d.mats[0] ?? null, a: d.a, opts: consumeOptions(g, d.mats) });
          return;
        }
      }
      break;
    }
    case 'wireIn': {
      if (!d.armed) {
        // A tap on an input port is a tap on its node.
        if (tapWire) tapNode(d.to);
        else if (d.slop >= TOUCH_SLOP) select({ kind: 'node', id: d.to });
      } else if (d.target != null) {
        const src = nodeById(g, d.target)!;
        const port = portFor(src, d.mat);
        if (port < outPortCount(src)) makeWire(d.target, port, d.to, d.b);
      } else if (nodeAt(p)) {
        // Dropped on a card that would not snap: if that is because this node has no use for what it makes, say so.
        const on = nodeAt(p)!;
        const why = on.id !== d.to && !isSink(on) ? noUse(g, on.id, portFor(on, d.mat), d.to) : '';
        if (why) toast(why, 'bad');
      } else if (Math.hypot(p.x - d.b.x, p.y - d.b.y) > 36) {
        const opts = d.mat ? produceOptions(g, d.mat) : [];
        // (Said to a finger without naming the gesture: there, wires are made by tapping.)
        if (!opts.length) toast(d.mat ? `Nothing you have unlocked makes ${MATERIALS[d.mat].name}. Wire a Well to it.` : isTouch() ? 'Start from an output port instead' : 'Drag from an output port instead', 'bad');
        else {
          endDrag();
          openRadial({ at: p, dir: 'produce', from: 0, port: 0, to: d.to, mat: d.mat, a: d.b, opts });
          return;
        }
      }
      break;
    }
    case 'knife': {
      const cut: number[] = [];
      for (const w of g.wires) {
        const refs = wireEls.get(w.id);
        if (!refs) continue;
        const pts = refs.flow.pts;
        for (let i = 0; i + 3 < pts.length; i += 2) {
          if (segmentsCross(d.a, d.b, { x: pts[i], y: pts[i + 1] }, { x: pts[i + 2], y: pts[i + 3] })) {
            cut.push(w.id);
            break;
          }
        }
      }
      if (cut.length) {
        cutWires(g, cut);
        if (ui.sel?.kind === 'wire' && cut.includes(ui.sel.id)) select(null);
      }
      break;
    }
    case 'pinch':
      break;
  }
  endDrag();
}

// ---------- radial build menu ----------

function consumeOptions(g: Game, mats: MatId[]): RadialOpt[] {
  const opts: RadialOpt[] = [];
  const uses = (r: Recipe) => r.inputs.some((i) => mats.includes(i[0]));
  const recipes = Object.values(RECIPES).filter(uses);
  const open = recipes.filter((r) => recipeUnlocked(g, r)).sort((a, b) => MATERIALS[b.outputs[0][0]].value - MATERIALS[a.outputs[0][0]].value);
  for (const r of open.slice(0, 3)) {
    opts.push({ type: r.machine, recipe: r.id, label: `${NODE_DEFS[r.machine].name} → ${r.name}`, sub: NODE_DEFS[r.machine].verb, cost: nodeCost(g, r.machine), glyph: matGlyph(r.outputs[0][0], 26) });
  }
  const sink = (type: NodeType, sub: string) => {
    if (nodeUnlocked(g, type)) opts.push({ type, label: NODE_DEFS[type].name, sub, cost: nodeCost(g, type), glyph: type === 'market' ? '<span class="coin big">¢</span>' : nodeIcon(type, 26) });
  };
  const junk = mats.length > 0 && mats.every((m) => MATERIALS[m].value < 1);
  if (junk) {
    sink('void', 'destroy');
    sink('market', 'sell');
  } else {
    sink('market', 'sell');
    sink('lab', 'study');
    sink('void', 'destroy');
  }
  sink('router', 'split');
  sink('silo', 'store');
  const locked = recipes.find((r) => !recipeUnlocked(g, r));
  if (locked && opts.length < 8) {
    opts.push({ type: locked.machine, recipe: locked.id, label: `${NODE_DEFS[locked.machine].name} → ${locked.name}`, sub: '', cost: 0, locked: locked.tech, glyph: matGlyph(locked.outputs[0][0], 24) });
  }
  return opts.slice(0, 8);
}

function produceOptions(g: Game, m: MatId): RadialOpt[] {
  return Object.values(RECIPES)
    .filter((r) => r.outputs.some((o) => o[0] === m) && recipeUnlocked(g, r))
    .map((r) => ({ type: r.machine, recipe: r.id, label: `${NODE_DEFS[r.machine].name} → ${r.name}`, sub: 'make', cost: nodeCost(g, r.machine), glyph: matGlyph(r.outputs[0][0], 26) }));
}

/**
 * Angle of each slot, as a multiple of the step, measured from straight ahead (away from the wire).
 * Odd counts put the best option dead ahead and fan the rest out alternately; even counts straddle
 * the axis (±½, ±1½, …). Either way the fan is a mirror image about the drag direction and its two
 * ends are the slots furthest from the incoming wire's side.
 */
export function radialOffset(i: number, n: number): number {
  if (n % 2 === 1) return Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1);
  return (Math.floor(i / 2) + 0.5) * (i % 2 === 0 ? -1 : 1);
}

/** Angle between neighbouring slots. The whole fan never spans more than 300°, which keeps 60° clear around the wire. */
export const radialStep = (n: number) => (n <= 1 ? 0 : Math.min(Math.PI / 3, (Math.PI * 5) / 3 / (n - 1)));

/** What an option costs, as shown on its button. */
const optPrice = (o: RadialOpt) =>
  o.locked ? `needs ${esc(TECHS[o.locked]?.name ?? o.locked)}` : o.cost === 0 ? 'free' : `${fmt(o.cost)}¢`;

/**
 * The build menu on a phone: a bottom sheet of large labelled buttons instead of the fan, which
 * is wider than the screen there. The half-drawn wire stays on the board and the board slides so
 * that the spot where the node will be built shows above the sheet.
 */
function openBuildSheet(state: RadialState) {
  const g = ui.g;
  const what = state.mat ? MATERIALS[state.mat].name : '';
  const title = state.dir === 'consume'
    ? (what ? `Send <b>${what}</b> to a new…` : 'Build here')
    : `Make <b>${what}</b> with a new…`;
  const opts = state.opts
    .map((o, i) => {
      const afford = !o.locked && o.cost <= g.credits + 1e-6;
      const cls = o.locked ? 'locked' : afford ? '' : 'poor';
      const does = o.recipe ? `makes ${esc(RECIPES[o.recipe]?.name ?? '')}` : o.sub;
      return `<button class="bopt ${cls}${i === 0 && afford ? ' best' : ''}" data-act="pick:${i}" data-testid="radial-${o.type}${o.recipe ? '-' + o.recipe : ''}" ${o.locked ? 'disabled' : ''}>
        <span class="bg">${o.glyph}</span><span class="bn">${o.locked ? icon('lock', 13) : ''}${esc(NODE_DEFS[o.type].name)}</span>
        <span class="bs">${o.locked ? '' : does ? does + ' · ' : ''}<span class="mono">${optPrice(o)}</span></span>
      </button>`;
    })
    .join('');
  buildEl.innerHTML = `<div class="sheet-grab" aria-hidden="true"></div>
    <div class="bhead"><span class="bt">${state.mat ? matGlyph(state.mat, 18) : ''}<span>${title}</span></span>
      <button class="ibtn bare" data-act="close" aria-label="Close">${icon('close', 18)}</button></div>
    <div class="bopts">${opts}</div>`;
  buildEl.classList.add('open');
  touch();
  // The wire that was being drawn stays, ending where the new node will go.
  const from = state.dir === 'consume' ? state.a : state.at;
  const to = state.dir === 'consume' ? state.at : state.a;
  const color = matColor(state.mat);
  tempPath.setAttribute('d', pathD(from, to));
  tempPath.style.stroke = color;
  tempPath.classList.remove('snap');
  tempPath.classList.add('on');
  tempEnd.setAttribute('cx', String(state.at.x));
  tempEnd.setAttribute('cy', String(state.at.y));
  tempEnd.style.fill = color;
  tempEnd.classList.add('on');
  tempD = '';
  // Room for the card that will appear there (a consumer grows to the right of the spot, a producer to the left).
  reveal(state.dir === 'consume' ? state.at.x - 16 : state.at.x - NODE_W, state.at.y - 46, NODE_W + 16, 92);
}

/**
 * While the sheet is open the player may be waiting to afford something on it: keep the buttons'
 * "out of reach" look up to date. Only classes change, so nothing moves under a finger.
 */
function refreshBuildSheet() {
  const r = radial;
  if (!r || !buildEl.classList.contains('open')) return;
  const credits = ui.g.credits;
  const btns = buildEl.querySelectorAll<HTMLElement>('.bopt');
  r.opts.forEach((o, i) => {
    const b = btns[i];
    if (!b || o.locked) return;
    const afford = o.cost <= credits + 1e-6;
    setClass(b, 'poor', !afford);
    if (i === 0) setClass(b, 'best', afford);
  });
}

function openRadial(state: RadialState) {
  radial = state;
  if (env.phone) {
    openBuildSheet(state);
    return;
  }
  const g = ui.g;
  const n = state.opts.length;
  // Wide enough that neighbouring slots never overlap, however the fan is turned.
  const R = n >= 8 ? 180 : n === 7 ? 158 : n >= 6 ? 142 : 122;
  // Keep the whole menu on screen; the node is built wherever the menu ends up.
  const rect = rectOf();
  let raw = toScreen(state.at);
  const m = R + 58;
  const mx = Math.min(m, rect.width / 2), my = Math.min(m, rect.height / 2);
  const c = { x: Math.max(mx, Math.min(rect.width - mx, raw.x)), y: Math.max(my, Math.min(rect.height - my, raw.y)) };
  // The menu opens clear of the goal card (and of the chips under it, when there is room for that).
  // If the spot the player chose is under the strip, the board slides down first, so the menu, the
  // wire and the new node all stay where they belong to each other.
  const s = env.strip();
  if (s && c.x + m > s.x0 && c.x - m < s.x1) {
    const fits = (edge: number) => rect.height - (edge + 8) >= m * 2;
    const edge = fits(s.bottom) ? s.bottom : fits(s.goalBottom) ? s.goalBottom : -1;
    // (No room under the card at all, on a very short window: as low as the menu can go.)
    const top = edge >= 0 ? edge + 8 + m : rect.height - my;
    if (c.y < top) {
      ui.view.y += top - raw.y;
      glide = null;
      applyView();
      raw = toScreen(state.at);
      c.y = Math.max(my, Math.min(rect.height - my, Math.max(top, raw.y)));
    }
  }
  state.at = { x: (c.x - ui.view.x) / ui.view.k, y: (c.y - ui.view.y) / ui.view.k };
  const a = toScreen(state.a);
  hideTemp();
  const back = Math.atan2(a.y - c.y, a.x - c.x); // direction the wire comes from
  const fwd = back + Math.PI;
  const step = radialStep(n);
  const slots = state.opts
    .map((o, i) => {
      const ang = fwd + step * radialOffset(i, n);
      const x = Math.cos(ang) * R, y = Math.sin(ang) * R;
      const afford = !o.locked && o.cost <= g.credits + 1e-6;
      const cls = o.locked ? 'locked' : afford ? '' : 'poor';
      const price = optPrice(o);
      return `<button class="slot ${cls}${i === 0 && afford ? ' best' : ''}" data-act="pick:${i}" data-i="${i}" data-testid="radial-${o.type}${o.recipe ? '-' + o.recipe : ''}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px" ${o.locked ? 'disabled' : ''}>
        <span class="key mono">${i + 1}</span>${o.locked ? icon('lock', 14) : ''}${o.glyph}
        <span class="sn">${esc(o.label)}</span><span class="ss">${o.sub ? o.sub + ' · ' : ''}<span class="mono">${price}</span></span>
      </button>`;
    })
    .join('');
  const hub = state.mat
    ? `${matGlyph(state.mat, 20)}<span>${MATERIALS[state.mat].name}</span>`
    : `<span>Build</span>`;
  radialEl.innerHTML = `<div class="disc" style="width:${R * 2 + 130}px;height:${R * 2 + 130}px"></div>
    <svg class="lead" width="1" height="1"><line x1="0" y1="0" x2="${a.x - c.x}" y2="${a.y - c.y}" style="stroke:${matColor(state.mat)}"/></svg>
    <div class="hub">${hub}</div>${slots}`;
  radialEl.style.left = c.x + 'px';
  radialEl.style.top = c.y + 'px';
  radialEl.style.display = 'block';
}

export function closeRadial() {
  if (!radial) return;
  radial = null;
  radialEl.style.display = 'none';
  if (buildEl.classList.contains('open')) {
    buildEl.classList.remove('open');
    touch();
  }
  hideTemp();
}

export const radialOpen = () => !!radial;

export function pickRadial(i: number) {
  const r = radial;
  if (!r) return;
  const o = r.opts[i];
  if (!o || o.locked) return;
  const g = ui.g;
  if (o.cost > g.credits + 1e-6) {
    toast(`${NODE_DEFS[o.type].name} costs <b>${fmt(o.cost)}¢</b>`, 'bad');
    return;
  }
  // The card goes where the wire was dropped, or the nearest free spot from there: further along the
  // wire for preference, then a row above or below.
  const { w, h } = sizeFor(o.type, o.recipe);
  const pos = freeSpot(r.dir === 'consume' ? r.at.x : r.at.x - w, r.at.y - h / 2, w, h, undefined, roomFor(o.type, h), { x: r.at.x - r.a.x, y: r.at.y - r.a.y });
  if (!pos) {
    closeRadial();
    toast(NO_ROOM, 'bad');
    return;
  }
  let made: GNode | null = null;
  act(g, () => {
    const n = placeNode(g, o.type, pos.x, pos.y, { recipe: o.recipe });
    if (!n) return false;
    if (r.dir === 'consume') connect(g, r.from, r.port, n.id);
    else {
      const rec = recipeOf(n);
      const port = rec && r.mat ? Math.max(0, rec.outputs.findIndex((x) => x[0] === r.mat)) : 0;
      connect(g, n.id, port, r.to);
    }
    made = n;
    return 0;
  });
  closeRadial();
  if (made) {
    built((made as GNode).id, r.dir === 'consume' ? r.from : r.to);
    signal('place', { id: (made as GNode).id, type: o.type });
  }
}

/**
 * Close the build menu and abandon a wire, a cut or a node move in progress, leaving the board as
 * it was before it started. Returns false when there was nothing to cancel.
 */
export function cancelGesture(): boolean {
  const d = drag;
  const busy = !!d && (d.kind === 'wire' || d.kind === 'wireIn' || d.kind === 'knife' || (d.kind === 'node' && d.moved));
  if (!radial && !busy && !tapWire) return false;
  if (radial) closeRadial();
  if (busy) abortDrag();
  if (tapWire) disarm();
  return true;
}

/** A pointer is on the board in the middle of something (a pan, a pinch, a wire, a node being moved). */
export const gestureActive = () => !!drag || fingers.size > 0;

/**
 * Call before something other than the pointer changes the board (a keyboard shortcut, say):
 * a node that is still being dragged is dropped where it is, so its move becomes its own undo step
 * and cannot get mixed up with what happens next.
 */
export function settleGesture() {
  if (drag?.kind === 'node') finishDrag();
}

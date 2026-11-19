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
import { DATA_COLORS, DATA_NAMES, DataTier, MATERIALS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, Recipe, TECHS } from '../content';
import {
  act, canConnect, connect, cutWires, expandBoard, freeDeposits, materialsAt, nodeById, placeNode, recipesFor, splice,
} from '../actions';
import {
  expansionCost, fmt, fmtRate, labRate, matUnlocked, nodeCost, nodeUnlocked, recipeOf, recipeUnlocked,
} from '../economy';
import { bagTotal, graph, isMachine, isSink, outPortCount } from '../sim';
import { lineAdvice, lineSpot } from '../advice';
import { GOALS, activeGoal, goalDeposit, goalFocus } from '../goals';
import { GRID, Game, GNode, Wire, snap } from '../state';
import { anchorPt, cachedRect, el, invalidateLayout, setAttr, setClass, setHTML, setHidden, setStyle, setText, svgEl } from './dom';
import {
  Beacon, Flow, floater, flowPoint, fly, frameFx, invalidateFx, makeFlow, setBeacons, setFlowPath, setFlows,
} from './fx';
import {
  Box, Card, Footprint, Port, Pt, View, ZOOM, bestWindow, bezierAt, boxClear, boxUnion, buildSite, centreView, clearPoint, dockSpot, fadeColor, fitBox,
  fitZoom, fitsAt, frameBox, freeSpot as nearestSpot, heldRate, inPorts, matColor, nodeSize, outPorts, pathD, pinchView, roomFor, segmentsCross, separate,
  siteFor, wholeGain, wireEnds,
} from './geom';
import { isStarted, screenOpen } from './hud-screens';
import { isTouch, pressWord, withKey } from './hud-words';
import { esc, icon, matGlyph, matShape, nodeIcon } from './icons';
import { tidy, tidyInput } from './layout';
import { shortNum } from './panels';
import { env } from './phone-env';
import { diagnose } from './status';
import { delegate, onGame, onPress, onSignal, select, signal, toast, touch, ui } from './ui';

let boardEl: HTMLElement;
let worldEl: HTMLElement;
let plotEl: HTMLElement;
let plotLabel: HTMLElement;
let depositsEl: HTMLElement;
let wiresSvg: SVGSVGElement;
let nodesEl: HTMLElement;
let chipsEl: HTMLElement;
let ghostEl: HTMLElement;
/** What the card in hand is and costs, in words: drawn on the stage, at the same size at every zoom (see `placeGhostCap`). */
let ghostCap: HTMLElement;
/** The outline of the card the build menu is about to build, where it will stand (under the phone's sheet; the fan draws its own). */
let siteEl: HTMLElement;
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
  /** With less motion asked for: the zoom the wire's still dots were last laid out at. */
  stillK?: number;
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
 * whole factory with a margin (see `zoomMin`), never past ZOOM.least. A factory that fits the screen at
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
/** How much larger than life a card's icon is drawn at each step of the overview (style.css, --ovs). */
const OV_ICON = [1, 1.5, 1.9, 2.4, 3.2, 4];
/**
 * In the overview a card's ports are dots at its sides (style.css). Out at the furthest steps the icon is drawn
 * nearly as wide as the card, so the dots are pushed out from the sides by this much (board units), to stand clear
 * of it: for a full-width card and for a narrow one (a Router, a Dump), at each step. The board sets these as
 * --opn and --opc, and finds the dots by the same numbers (`ovDot`).
 */
const OV_PORT_OUT: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 9], [12, 30], [34, 52]];
/**
 * In the overview a press this close to a port's dot (screen px) is a press on the port, so that wiring works at
 * every zoom: a mouse, and a finger. A press on a card's icon is always for the card (it comes back in to it).
 */
const OV_PORT_MOUSE = 12, OV_PORT_FINGER = 16;
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
/** `best`: the option highlighted and preselected: the one the card asks for, or the first when it asks for none (see `suggest`). */
interface RadialState {
  at: Pt; opts: RadialOpt[]; dir: 'consume' | 'produce'; from: number; port: number; to: number; mat: MatId | null; a: Pt; best?: number;
  /**
   * Where the card will stand, found once when the menu opens (see `findSite`): the spot of the suggested option's
   * card, that card, and the board (its revision) and the camera it was found on.
   */
  site?: Pt | null; card?: Footprint; rev?: number; sight?: Sight;
  /** Where each other option's card would stand, as far as asked for (see `optSite`). */
  sites?: Map<number, Box | null>;
  /** The option whose card the outline shows: the suggested one, until the pointer rests on another. */
  shown?: number;
  /** An option that was pressed and whose card would not stand in the suggested one's outline: its own outline is on show, and the next press on it builds. */
  asked?: number;
  /** A move the camera made for the menu itself when it opened: where it stood before, and where the move left it. */
  moved?: { from: View; to: View } | null;
}
let radial: RadialState | null = null;

// ----- the build menu takes no press from the gesture that opened it -----
// The menu opens when a finger lifts (a tap on empty board with a port armed, or a wire let go there).
// For touch the browser then sends that lift's click to whatever is under the finger, and the menu,
// kept inside the visible stage, may by then have an option there: one tap would buy a node nobody
// chose. So an option takes only a press that began on the menu after it opened, and not in its
// first moment (MENU_GUARD), whatever the pointer. Keys (1 to 9, Enter on a focused option) still pick.

/** When the build menu last opened (performance.now), and when a press last began on it. */
let menuOpenedAt = -Infinity;
let menuPressAt = -Infinity;
/** A press on the menu this soon after it opened is not taken as a choice (a double tap, or a finger still landing). */
const MENU_GUARD = 250;

function noteMenuPress() {
  if (performance.now() - menuOpenedAt >= MENU_GUARD) menuPressAt = performance.now();
}

/** May this press or click on the menu choose an option? */
function menuPressOk(ev: Event): boolean {
  const pe = ev as PointerEvent;
  // A click with no pointer behind it: the keyboard, or a script.
  if (ev.type === 'click' && pe.detail === 0) return true;
  // (A mouse acts on its press, which `noteMenuPress` has just looked at; touch and pen on the click
  // that follows a press: either way that press has to be one that began after the menu opened.)
  return menuPressAt > menuOpenedAt && menuPressAt - menuOpenedAt >= MENU_GUARD;
}

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
  ovStep = !over ? 0 : k >= 0.55 ? 1 : k >= 0.4 ? 2 : k >= 0.26 ? 3 : k >= 0.19 ? 4 : 5;
  if (over !== wasOver) boardEl.classList.toggle('ov', over);
  if (ovStep !== wasStep) {
    if (ovStep) boardEl.dataset.ov = String(ovStep);
    else delete boardEl.dataset.ov;
    // (How far the port dots stand out from a card's sides at this step: see OV_PORT_OUT.)
    const [n, c] = OV_PORT_OUT[ovStep] ?? [0, 0];
    boardEl.style.setProperty('--opn', `${n}px`);
    boardEl.style.setProperty('--opc', `${c}px`);
  }
  if (big !== wasBig) boardEl.classList.toggle('big', big);
  if (lean !== wasLean) boardEl.classList.toggle('lean', lean);
  placeExpand(true);
  if (!renderedGame) return;
  placePlotLabel();
  if (ui.placing) {
    // (In the overview the card in hand is an outline with its words beside it on the stage: see `updateGhost`.)
    if (over !== wasOver) updateGhost();
    else placeGhostCap();
  }
  if (hintsBox && ui.g.goal.i < HINTS_UNTIL) syncHints(ui.g, false);
  // The camera has left the place the player's own Fit took it to (and is not on its way there): Fit has nothing left
  // to return to, and fits again. Back in among the cards, the zoom to come back in to is forgotten too.
  if (fitBack && fitAt && !(glide && glide === fitGlide) && !sameView(ui.view, fitAt)) fitBack = fitAt = null;
  if (wasOver && !over) ovFrom = null;
  // The deposits' second line is worded for the type size (and so is the card in hand).
  if (big !== wasBig) {
    syncDeposits(ui.g);
    if (ui.placing) updateGhost();
  }
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
  // Outside the phone layout the whole plot, with the Expand button under it, can always be brought into
  // view: its edge is where the board grows (a phone has a Fit button and the docked Expand for that).
  const g = ui.g;
  const r = rectOf();
  const plot = env.phone ? Infinity : fitZoom({ x0: -20, y0: -20, x1: g.board.w + 20, y1: g.board.h + 18 + EXPAND_H + 20 }, { x0: 0, y0: 0, x1: r.width, y1: r.height }) * 0.95;
  const need = Math.min(k * 0.9, plot);
  return need >= floor ? floor : Math.max(ZOOM.least, need);
}

/**
 * (Never forces the camera in: a view that is already further out than the limit may stay where it is,
 * though nothing is ever further out than ZOOM.least.)
 */
const clampK = (k: number) => Math.max(ZOOM.least, Math.min(zoomMin(), ui.view.k), Math.min(zoomMax(), k));

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

/**
 * The part of the stage nothing covers, for finding its middle (stage pixels): on a phone the free area; elsewhere
 * the stage under the strip (the goal card, with room for the alert chip under it), where the strip hangs over
 * the middle of the top edge.
 */
function uncoveredArea(): Box {
  if (env.phone) return freeArea();
  const r = rectOf();
  const s = env.strip();
  const y0 = s ? Math.min(r.height * 0.5, Math.max(s.bottom, s.goalBottom + ALERT_ROOM)) : 0;
  return { x0: 0, y0, x1: r.width, y1: r.height };
}

const inset = (b: Box, by: number): Box => {
  const x = Math.min(by, (b.x1 - b.x0) / 2 - 20), y = Math.min(by, (b.y1 - b.y0) / 2 - 20);
  return { x0: b.x0 + Math.max(0, x), y0: b.y0 + Math.max(0, y), x1: b.x1 - Math.max(0, x), y1: b.y1 - Math.max(0, y) };
};

/** Clear space kept around the phone's floating buttons (Fit, Undo, Tidy) by the camera and by placement. */
const FAB_CLEAR = 16;

/** The stage-pixel box of an element on show, grown by `gap`, or null when it is not laid out. */
function stageBoxOf(e: Element | null | undefined, gap = 0): Box | null {
  if (!e) return null;
  const b = e.getBoundingClientRect();
  if (b.width < 2 || b.height < 2) return null;
  const r = rectOf();
  return { x0: b.left - r.left - gap, y0: b.top - r.top - gap, x1: b.right - r.left + gap, y1: b.bottom - r.top + gap };
}

/**
 * How far an open sheet pushes the phone's floating buttons: up by a sheet across the foot of the screen, aside by
 * one standing at the side (as phone.ts sets --lift and --shift from the same sheets, a frame later).
 */
function sheetAside(): { lift: number; shift: number } {
  let lift = 0, shift = 0;
  const sw = boardEl.offsetWidth || 1;
  for (const sheet of [document.getElementById('insp'), buildEl]) {
    // (While its node is being carried the inspector waits out of sight: see `carrying` in phone.css.)
    if (!sheet?.classList.contains('open') || (sheet.id === 'insp' && appEl?.classList.contains('carrying'))) continue;
    if (sheet.offsetWidth >= sw * 0.7) lift = Math.max(lift, sheet.offsetHeight);
    else shift = Math.max(shift, sheet.offsetWidth + 8);
  }
  return { lift, shift };
}

/**
 * The phone's floating buttons on show, each with `gap` around it (stage pixels), where they stand once they have
 * settled: their place in the layout, moved aside by an open sheet. (They slide there with a transition, so where
 * they are drawn a moment after a sheet opens or closes is on the way: a camera that framed a card from that was
 * still under them once they had arrived.)
 */
function fabBoxes(gap = FAB_CLEAR): Box[] {
  const out: Box[] = [];
  if (!env.phone) return out;
  fabsEl ??= document.getElementById('fabs');
  if (!fabsEl || !fabsEl.offsetWidth) return out;
  const { lift, shift } = sheetAside();
  for (const b of fabsEl.querySelectorAll<HTMLElement>('.fab:not([hidden])')) {
    if (!b.offsetWidth) continue;
    const x0 = fabsEl.offsetLeft + b.offsetLeft - shift, y0 = fabsEl.offsetTop + b.offsetTop - lift;
    out.push({ x0: x0 - gap, y0: y0 - gap, x1: x0 + b.offsetWidth + gap, y1: y0 + b.offsetHeight + gap });
  }
  return out;
}

/**
 * Everything that lies over the board where a card cannot be seen or reached, in stage pixels: the strip
 * (the goal card with the order and the alert), an open sheet, the corner controls, the key hints, the
 * "tap where…" line, and on a phone the floating buttons (with room around them) and a Claim button
 * seated in the thumb row. Reads layout: for moments when the camera may move, not for every frame. `fabGap`: the
 * room kept round the floating buttons. `line`: false leaves the "tap where…" line out (it goes the moment a card
 * is built, so a new card need not keep out from under it).
 */
function coverBoxes(fabGap = FAB_CLEAR, line = true): Box[] {
  const out: Box[] = [];
  const push = (b: Box | null) => void (b && out.push(b));
  const r = rectOf();
  if (env.phone) {
    const c = env.cover();
    if (c.top) out.push({ x0: -1e6, y0: -1e6, x1: 1e6, y1: c.top });
    if (c.bottom) out.push({ x0: -1e6, y0: r.height - c.bottom, x1: 1e6, y1: 1e6 });
    if (c.right) out.push({ x0: r.width - c.right, y0: -1e6, x1: 1e6, y1: 1e6 });
    out.push(...fabBoxes(fabGap));
    push(stageBoxOf(document.querySelector('#hud [data-testid="claim"]'), 8));
  } else {
    const s = env.strip();
    if (s) out.push({ x0: s.x0, y0: -1e6, x1: s.x1, y1: s.bottom });
    const c = env.corner();
    if (c) out.push({ x0: c.x0, y0: c.y0, x1: 1e6, y1: 1e6 });
    push(stageBoxOf(hintsEl));
  }
  if (line) push(stageBoxOf(document.getElementById('tap-hint'), 4));
  return out;
}

/** A world box as it lies on the stage from view `v`. */
const onStage = (b: Box, v: View): Box => ({ x0: b.x0 * v.k + v.x, y0: b.y0 * v.k + v.y, x1: b.x1 * v.k + v.x, y1: b.y1 * v.k + v.y });

/** A stage box lies wholly on the stage and under none of `covers`. */
function inClear(sb: Box, covers: Box[]): boolean {
  const r = rectOf();
  if (sb.x0 < -1 || sb.y0 < -1 || sb.x1 > r.width + 1 || sb.y1 > r.height + 1) return false;
  return !covers.some((o) => sb.x0 < o.x1 && sb.x1 > o.x0 && sb.y0 < o.y1 && sb.y1 > o.y0);
}

/** A card as a box, with room for the ports that stick out of its sides and the status pill on top. */
function cardBox(n: GNode): Box {
  const { w, h } = nodeSize(n);
  return { x0: n.x - 10, y0: n.y - 14, x1: n.x + w + 10, y1: n.y + h + 4 };
}

/** The plot's label as last placed: its width on the board once measured (for which words), where it stands along the plot's top side, whether it shows. */
const plotTag = { text: '', big: false, w: 0, left: 16, on: true, away: false, timer: 0 };
/** How long the camera rests before the plot's label is set in a new place (ms). */
const PLOT_SETTLE = 150;

/**
 * Keep the plot's label ("Board · 3 plots") whole: it stands at the left end of the plot's top side, and when
 * something that covers the stage (the goal card), or the stage's own edge, would cut it there it moves along that
 * side to the nearest place that is clear; with none, it is left out until there is one. Never half of it. (Not
 * looked for in the overview, which does not show it.)
 */
function placePlotLabel() {
  const g = ui.g;
  if (!g || over || !plotLabel) return;
  const text = plotLabel.textContent ?? '';
  if (text !== plotTag.text || big !== plotTag.big || !plotTag.w) {
    plotTag.text = text;
    plotTag.big = big;
    plotTag.w = plotLabel.offsetWidth;
  }
  if (!plotTag.w) return;
  // What covers the stage, from what the shell has already measured (this runs with every camera move: no layout is read).
  const covers: Box[] = [];
  const r = rectOf();
  if (env.phone) {
    const c = env.cover();
    if (c.top) covers.push({ x0: -1e6, y0: -1e6, x1: 1e6, y1: c.top });
    if (c.bottom) covers.push({ x0: -1e6, y0: r.height - c.bottom, x1: 1e6, y1: 1e6 });
    if (c.right) covers.push({ x0: r.width - c.right, y0: -1e6, x1: 1e6, y1: 1e6 });
  } else {
    const st = env.strip(), c = env.corner();
    if (st) covers.push({ x0: st.x0, y0: -1e6, x1: st.x1, y1: st.bottom });
    if (c) covers.push({ x0: c.x0, y0: c.y0, x1: 1e6, y1: 1e6 });
    if (hintsBox && g.goal.i < HINTS_UNTIL) covers.push(hintsBox);
  }
  // Past the stage's edges it cannot be read either: with the plot's corner off the side of the stage (as the camera
  // stands in the Phone ending) it read "ard · 3 plots" there.
  covers.push({ x0: -1e6, y0: -1e6, x1: 0, y1: 1e6 }, { x0: r.width, y0: -1e6, x1: 1e6, y1: 1e6 }, { x0: -1e6, y0: -1e6, x1: 1e6, y1: 0 });
  const v = ui.view;
  const y0 = (big ? -11 : -9) * v.k + v.y, y1 = y0 + (big ? 22 : 17) * v.k;
  const w = plotTag.w;
  const cut = (left: number) => {
    const x0 = left * v.k + v.x, x1 = (left + w) * v.k + v.x;
    return covers.some((c) => x0 < c.x1 + 6 && x1 > c.x0 - 6 && y0 < c.y1 + 2 && y1 > c.y0);
  };
  let left = 16;
  let on = true;
  if (cut(left)) {
    // Just right of what covers it, or just left: whichever is nearer and clear, inside the plot's own side.
    on = false;
    let best = Infinity;
    for (const c of covers) {
      for (const x of [(c.x1 + 10 - v.x) / v.k, (c.x0 - 10 - v.x) / v.k - w]) {
        if (x < 16 || x + w > g.board.w - 16 || Math.abs(x - 16) >= best || cut(x)) continue;
        best = Math.abs(x - 16);
        left = Math.round(x);
        on = true;
      }
    }
  }
  if (left === plotTag.left && on === plotTag.on) {
    // Back where it stands (or never moved): nothing waits, and it shows again if it was put away for the move.
    if (plotTag.timer) clearTimeout(plotTag.timer);
    plotTag.timer = 0;
    if (plotTag.away) {
      plotTag.away = false;
      plotLabel.style.visibility = on ? '' : 'hidden';
    }
    return;
  }
  // Moving the label repaints the board's whole layer, so it is not slid along the plot's edge frame by frame while
  // the camera moves (that took a pan at 70% on a slow machine from 49 to 41 frames a second): it is put away at the
  // first frame and set in its new place once the camera has rested for a moment.
  if (!plotTag.away && plotTag.on) {
    plotTag.away = true;
    plotLabel.style.visibility = 'hidden';
  }
  if (plotTag.timer) clearTimeout(plotTag.timer);
  plotTag.timer = window.setTimeout(() => {
    plotTag.timer = 0;
    plotTag.away = false;
    plotTag.left = left;
    plotTag.on = on;
    plotLabel.style.left = left + 'px';
    plotLabel.style.visibility = on ? '' : 'hidden';
  }, PLOT_SETTLE);
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
/** How far under the goal card the alert chip reaches when it shows (outside the phone layout). */
const ALERT_ROOM = 46;
/** On a phone held upright the alert chip is a row of its own under the card: its height with the gap above it. */
const PHONE_ALERT_ROOM = 40;

/**
 * The camera that shows a world box in the part of the stage nothing covers: clear of the strip, an
 * open sheet and the corner controls. As large as fits, up to 100%. A box too big for the floor of the
 * detailed tier is shown in the overview instead, unless `detailed` is set: then the camera stays at
 * the floor, on the middle of the box.
 */
function fitTarget(box: Box, detailed = false, kMax = 1): View {
  const floor = zoomFloor();
  const plot = ui.g.board;
  const settle = (area: Box, k: number) => {
    const v = centreView(box, area, k >= floor ? k : detailed || k >= floor * NEAR_FIT ? floor : Math.max(ZOOM.least, k));
    // No more empty ground past the plot's edge than there has to be: where the plot is larger than
    // the space it fills it, and where it is smaller it sits in the middle. (The plot is taken together
    // with the box, so nothing built is ever pushed out of view: a card from an old save may stand
    // past the plot's edge.)
    const along = (at: number, lo: number, hi: number, a0: number, a1: number) => {
      const size = (hi - lo) * v.k;
      return size <= a1 - a0 ? (a0 + a1 - size) / 2 - lo * v.k : Math.min(a0 - lo * v.k, Math.max(a1 - hi * v.k, at));
    };
    v.x = along(v.x, Math.min(0, box.x0), Math.max(plot.w, box.x1), area.x0, area.x1);
    v.y = along(v.y, Math.min(0, box.y0), Math.max(plot.h, box.y1), area.y0, area.y1);
    return v;
  };
  if (env.phone) {
    // Clear of the row of floating controls when that leaves room at a readable zoom, 16 px in from each
    // side; otherwise down into that row, but left of the floating buttons and FAB_CLEAR from them. The
    // overview keeps clear of the whole row again.
    const clear = inset(freeArea(true), 16), all = inset(freeArea(), 6);
    const fabs = fabBoxes();
    const behind = fabs.length ? { ...all, x1: Math.max(all.x0 + 80, Math.min(all.x1, ...fabs.map((b) => b.x0))) } : all;
    const k1 = fitZoom(box, clear, kMax), k2 = fitZoom(box, behind, kMax);
    if (k1 >= floor * NEAR_FIT || k2 < floor * NEAR_FIT) return settle(clear, k1);
    return settle(behind, k2);
  }
  // Outside the phone layout the strip hangs over the middle of the top edge: what is built is wide, so
  // the strip counts as a band across the stage. The zoom buttons and the minimap hold the bottom right
  // corner: the space is either everything to their left or everything above them, whichever shows more.
  const r = rectOf();
  const s = env.strip();
  // (The alert chip comes and goes under the goal card: room is kept for it whether it is showing or not,
  // so that nothing framed now is under it a moment later.)
  const y0 = (s ? Math.max(s.bottom, s.goalBottom + ALERT_ROOM) : 40) + 22;
  const full: Box = { x0: 40, y0, x1: Math.max(100, r.width - 40), y1: Math.max(y0 + 120, r.height - 48) };
  let area = full;
  const c = env.corner();
  if (c) {
    const v = settle(full, fitZoom(box, full, kMax));
    if (box.x1 * v.k + v.x > c.x0 - STRIP_GAP && box.y1 * v.k + v.y > c.y0 - STRIP_GAP) {
      const left: Box = { ...full, x1: Math.max(full.x0 + 100, c.x0 - STRIP_GAP) }, above: Box = { ...full, y1: Math.max(full.y0 + 100, c.y0 - STRIP_GAP) };
      area = fitZoom(box, left, kMax) >= fitZoom(box, above, kMax) ? left : above;
    }
  }
  return settle(area, fitZoom(box, area, kMax));
}

/** How long Fit, a tap on a card in the overview, and a camera move that follows a build take, in ms. */
const FIT_MS = 360, FRAME_MS = 320;
/**
 * The way back from the player's own Fit: the view they had before it took the camera into the overview, where it
 * left the camera, the camera move that takes it there, and the board (its revision) as it was then. Only a Fit the
 * player pressed has one, and only until the camera or the board changes (see `fitGoesBack`).
 */
let fitBack: View | null = null;
let fitAt: View | null = null;
let fitGlide: Glide | null = null;
let fitRev = -1;
/** The zoom the camera had before Fit or an expansion took it into the overview: a tap on a card there comes back in to it. */
let ovFrom: number | null = null;
/** For a moment after a game is loaded or the layout changes, Fit is the opening view, not the player's own press. */
let openingUntil = 0;

const sameView = (a: View, b: View) => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.k - b.k) < 0.004;

/**
 * A press on Fit now would go back to the view the player had before their last Fit, not fit: that Fit was their
 * own, it took the camera into the overview, and neither the camera nor the board has changed since. (For the
 * button's title, and for `fitView`.)
 */
export function fitGoesBack(): boolean {
  return !!fitBack && !!fitAt && !!renderedGame && fitRev === ui.g.rev && sameView(viewAhead(), fitAt);
}

/**
 * Show what has been built, as large as it fits clear of the strip, an open sheet and the corner controls: among
 * the cards when the factory fits the screen at a readable zoom, and in the overview (every card an icon) when it
 * does not. Fit always fits, with one exception: a second press straight after the player's own Fit from among the
 * cards into the overview, with the camera and the board untouched in between, goes back to the view they had
 * (`fitGoesBack`; the button says so while it would). A fit the game made itself (the opening view, an expansion, a celebration) has no
 * way back: pressed after one, Fit fits. A game that has just been loaded opens among the cards, on the middle of
 * the factory.
 */
export function fitView(smooth = false) {
  fit(smooth, byHand());
}

/** The same, never as the player's own press: for a caller that fits the board for a purpose of its own (Show me). */
export function fitAll(smooth = false) {
  fit(smooth, false);
}

function fit(smooth: boolean, hand: boolean) {
  const g = ui.g;
  const animate = smooth || hand;
  const now = viewAhead();
  if (hand && fitGoesBack()) {
    const back = fitBack!;
    fitBack = fitAt = null;
    moveView(back.x, back.y, back.k, animate, FIT_MS);
    syncFitControl();
    return;
  }
  if (!renderedGame || renderedGame !== g || performance.now() < openingUntil) {
    openView();
    return;
  }
  const t = fitTarget(builtBox() ?? { x0: 0, y0: 0, x1: g.board.w, y1: g.board.h });
  const out = t.k < zoomFloor();
  if (out && now.k >= zoomFloor()) ovFrom = now.k;
  // (Only a view among the cards is one to come back to: from an overview, the game's or the player's, Fit just fits.)
  if (hand && out && now.k >= zoomFloor()) {
    fitBack = { ...now };
    fitAt = t;
    fitRev = g.rev;
  } else fitBack = fitAt = null;
  moveView(t.x, t.y, t.k, animate, FIT_MS);
  fitGlide = glide;
  syncFitControl();
}

/** What the Fit controls say while a press would go back, and otherwise (the wide layout's button names its key to a keyboard). */
const FIT_BACK = 'Back to the last view';

/**
 * The Fit controls (the zoom row's button, the phone's floating one) say what a press would do: while it would go
 * back to the view before Fit, their title and label say that. (Their own words are put back as they were.)
 */
function syncFitControl() {
  const back = fitGoesBack();
  // (Looked at a few times a second: the panels write the button's own words again when the pointer in use changes.)
  const wide = document.querySelector<HTMLElement>('#zoom [data-act="fit"]'), fab = document.querySelector<HTMLElement>('[data-testid="fab-fit"]');
  const put = (e: HTMLElement | null, title: string | null, label: string) => {
    if (!e) return;
    if (e.getAttribute('aria-label') !== label) e.setAttribute('aria-label', label);
    if (title == null) {
      if (e.hasAttribute('title')) e.removeAttribute('title');
    } else if (e.getAttribute('title') !== title) e.setAttribute('title', title);
  };
  const wideWords = back ? withKey(FIT_BACK, 'F') : withKey('Fit board', 'F');
  put(wide, wideWords, wideWords);
  put(fab, back ? FIT_BACK : null, back ? FIT_BACK : 'Show my supply line');
  for (const e of [wide, fab]) e?.classList.toggle('back', back);
}

/**
 * The view a game opens on (a save loaded, a new game, the layout changed under it). The view the layout
 * had before, when the board is coming back to it; on a phone that was turned, the zoom and the middle it had.
 * Otherwise the whole factory, when it can be read at once. When it is too big for that: what the player is in
 * the middle of (a wire a finger is still drawing) or what the goal is about (goalFocus), at a readable zoom; with
 * nothing named, the middle of the factory at a readable zoom on a phone, and elsewhere the floor of the detailed
 * tier when every card is whole and uncovered there, else all of it in the overview, so that no card opens cut in
 * half at the stage's edges.
 */
function openView() {
  const g = ui.g;
  const r = rectOf();
  kindSeen ??= layoutKind();
  fitBack = fitAt = null;
  if (r.width < 2 || r.height < 2) {
    openPending = true;
    return;
  }
  openPending = false;
  const back = switchedTo ? layoutViews.get(switchedTo) : undefined;
  const turned = turnedFrom;
  switchedTo = turnedFrom = null;
  if (back) {
    standOn(back);
    return;
  }
  // A phone turned keeps the zoom it had and the middle of its view; the selected node, or the armed port, is then
  // brought back into view if the turn put it out of sight (the least move, at that zoom when it fits).
  if (turned) {
    standOn({ ...turned, k: clampK(turned.k) });
    const keep = tapWire ? tapWire.from : ui.sel?.kind === 'node' ? ui.sel.id : null;
    if (keep != null) frameNodes([keep]);
    return;
  }
  const floor = zoomFloor();
  const box = builtBox() ?? { x0: 0, y0: 0, x1: g.board.w, y1: g.board.h };
  const t = fitTarget(box);
  const go = (v: View) => moveView(v.x, v.y, v.k, false);
  if (t.k >= floor) return go(t);
  // (A wire a finger is still drawing counts as armed: its start stays in view.)
  const armed = tapWire ? [tapWire.from] : drag?.kind === 'wire' && drag.armed ? [drag.from] : drag?.kind === 'wireIn' && drag.armed ? [drag.to] : [];
  const named = (armed.length ? armed : goalFocus(g)).map((id) => nodeById(g, id)).filter((n): n is GNode => !!n);
  // On a phone (a game opened, or the phone turned) as much of the factory as can be read at once: at the
  // floor of the detailed tier, the stretch of it with the most cards on screen, the armed port among them; or,
  // when the goal names no node but a place (a free deposit to put a Drill on), with that place among them, and
  // failing that the place itself, readable.
  if (env.phone && (!named.length || armed.length)) {
    const place = armed.length ? null : goalPlace(g);
    const extra = place ? [place] : [];
    const v = bestWindow(g.nodes.map(cardBox).concat(extra), named.map(cardBox).concat(extra), inset(freeArea(true), 16), floor);
    if (v) return go(v);
    if (place) return go(fitTarget(place, true, 1));
  }
  if (named.length) {
    let fb: Box | null = null;
    for (const n of named) fb = boxUnion(fb, cardBox(n));
    // (An armed port is shown with as much of the factory around it as can be read; a goal's nodes as large as fits.)
    return go(fitTarget(fb!, true, armed.length ? floor : 1));
  }
  if (env.phone) return go(fitTarget(box, true));
  // Wider than the room under the strip, but whole on the stage at the floor with no card cut or under the
  // strip, the corner controls or the key hints (a big factory on a wide screen): it opens there, readable.
  // (The hint row is put away first if the goal is past it.)
  syncHints(g);
  const d = wholeAtFloor(fitTarget(box, true));
  if (d) return go(d);
  // Too big for that, and the goal names no node, but a place (as Show me frames it, advice-show.ts): the free
  // deposit the card's line wants a Drill on, or the hint's own ("Place a Drill on the Oil deposit"), at a
  // readable zoom; or, where the card asks for the expansion, the plot's lower edge, under which the Expand
  // button stands, with the factory around it at the floor.
  const place = goalPlace(g);
  if (place) return go(fitTarget(place, true, 1));
  const spot = lineSpot(g);
  if ((spot && 'expand' in spot) || (activeGoal(g)?.id === 'expand' && !g.goal.ready)) {
    const w = EXPAND_W * 1.4, mid = g.board.w / 2;
    return go(fitTarget({ x0: mid - w, y0: g.board.h - 200, x1: mid + w, y1: g.board.h + 18 + EXPAND_H + 12 }, true, floor));
  }
  go(t);
}

/**
 * The free deposit the goal names, as a world box with a little room round it: the one the card's line wants a
 * Drill on, or the hint's own ("Place a Drill on the Oil deposit"). Null when it names none.
 */
function goalPlace(g: Game): Box | null {
  const spot = lineSpot(g);
  const depId = spot && 'deposit' in spot ? spot.deposit : goalDeposit(g);
  const dep = depId != null ? g.deposits.find((x) => x.id === depId) : undefined;
  return dep ? { x0: dep.x - 12, y0: dep.y - 12, x1: dep.x + 184, y1: dep.y + 84 } : null;
}

/**
 * Outside the phone layout, at the zoom of `v` (the floor): a camera near `v` under which every card is whole
 * on the stage and under nothing (see `coverBoxes`), or null when there is none. Tried in turn: `v` itself,
 * then slid as little as keeps every card on the stage, then with the cards as low as they go (away from
 * the strip) and as far left as they go (away from the corner controls).
 */
function wholeAtFloor(v: View): View | null {
  const g = ui.g;
  const r = rectOf();
  const k = v.k;
  const boxes = g.nodes.map(cardBox);
  if (!boxes.length) return null;
  let all: Box | null = null;
  for (const b of boxes) all = boxUnion(all, b);
  const m = 8;
  // The camera positions that keep every card on the stage, on each axis.
  const xa = m - all!.x0 * k, xb = r.width - m - all!.x1 * k, ya = m - all!.y0 * k, yb = r.height - m - all!.y1 * k;
  if (xa > xb || ya > yb) return null;
  // (The lower bound puts the cards as far left, or as high, as they go; the upper as far right, or as low.)
  const x = Math.min(xb, Math.max(xa, v.x)), y = Math.min(yb, Math.max(ya, v.y));
  const covers = coverBoxes();
  for (const c of [v, { x, y, k }, { x, y: yb, k }, { x: xa, y, k }, { x: xa, y: yb, k }]) {
    if (boxes.every((b) => inClear(onStage(b, c), covers))) return c;
  }
  return null;
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
  const k = ovFrom != null && ovFrom >= zoomFloor() ? ovFrom : READ_ZOOM;
  fitBack = fitAt = null;
  ovFrom = null;
  const t = centredOn(n, k);
  moveView(t.x, t.y, t.k, true, FIT_MS);
}

/**
 * The selected node may have just been covered: the inspector opened beside the board (which narrows the
 * stage from the right, so everything else stays where it was on screen), a sheet came up, the strip grew.
 * If it is no longer in view and uncovered, the least move brings it back; otherwise nothing moves.
 */
export function ensureVisible(id: number) {
  if (!nodeById(ui.g, id)) return;
  // While the window is being resized the view keeps its anchor (see `stageResized`): the selected node is
  // looked at once the resizing has stopped, where the window ended up.
  if (performance.now() < resizingUntil) return;
  // (Called straight after a panel opened or closed: the stage's size is read afresh.)
  invalidateLayout();
  frameNodes([id]);
}

/**
 * Glide the camera, as little as possible, so that these nodes are all in view and clear of the strip,
 * an open sheet and the corner controls. The zoom is kept when they fit at it; otherwise the camera
 * pulls back, but never out of the detailed tier. Nodes too far apart even for that: the last one named
 * is brought into view. Does nothing when they can all be seen already.
 *
 * From the overview the zoom is left alone too, unless `readable` is set (for a caller that is about
 * to point at ports, which the overview does not show): then the camera comes back in among the cards.
 */
export function frameNodes(ids: number[], readable = false): void {
  const boxes: Box[] = [];
  for (const id of ids) {
    const n = nodeById(ui.g, id);
    if (n) boxes.push(cardBox(n));
  }
  frameBoxes(boxes, readable);
}

/** True when a node can be seen whole, under nothing (see `coverBoxes`). For scripts, and for the camera's own rules. */
export function nodeInClear(id: number, v: View = viewAhead()): boolean {
  const n = nodeById(ui.g, id);
  return !!n && inClear(onStage(cardBox(n), v), coverBoxes());
}

/**
 * The same for world boxes (cards, deposits): nothing moves when every one of them is already in view and
 * uncovered; otherwise the least move that brings them, or the last one named, into the free part of the stage.
 */
export function frameBoxes(boxes: Box[], readable = false): void {
  const plan = framePlan(boxes, readable);
  if (plan.view && !sameView(plan.view, viewAhead())) moveView(plan.view.x, plan.view.y, plan.view.k, true, FRAME_MS);
}

/** On a phone, the height of the band under the strip where the "tap where…" line stands when it moves up (phone.ts). */
const HINT_BAND = 60;

/**
 * Where `frameBoxes` takes the camera: `view` is null when nothing has to move; `all` is false when the boxes
 * cannot all be shown together, and only the last one named is. `least`: how far out the camera may pull back for
 * them (the floor of the detailed tier unless said). `hintRoom`: on a phone, the band under the strip where the
 * "tap where…" line moves to when its own place would hide what it asks for is kept clear too, whether the line
 * stands there yet or not (it is shown, and placed, a frame after a port is armed).
 */
function framePlan(boxes: Box[], readable: boolean, opts: { least?: number; hintRoom?: boolean } = {}): { view: View | null; all: boolean } {
  let box: Box | null = null;
  let last: Box | null = null;
  for (const b of boxes) {
    last = b;
    box = boxUnion(box, b);
  }
  if (!box || !last) return { view: null, all: true };
  const floor = zoomFloor();
  const least = Math.min(floor, opts.least ?? floor);
  const now = viewAhead();
  const band: Box | null = opts.hintRoom && env.phone ? { x0: -1e6, y0: env.cover().top, x1: 1e6, y1: env.cover().top + HINT_BAND } : null;
  // Already in view and under nothing: the camera holds still. (From the overview a caller that wants
  // ports to point at still comes back in among the cards.)
  if (!(readable && now.k < floor)) {
    const covers = coverBoxes();
    if (band) covers.push(band);
    if (boxes.every((b) => inClear(onStage(b, now), covers))) return { view: null, all: true };
  }
  // (Coming in from the overview: start from 100% on the middle of the nodes, and pull back from there as needed.)
  const cur = readable && now.k < floor ? centreView(box, { x0: 0, y0: 0, x1: rectOf().width, y1: rectOf().height }, READ_ZOOM) : now;
  // The areas the nodes may be shown in, in order of preference (roomy margins first, then thin ones),
  // and what must not lie over them there.
  const tiers: Box[][] = [];
  const blocks: Box[] = [];
  if (env.phone) {
    const free = freeArea(true);
    // (Room for the "tap where…" line under the strip, when asked: the boxes go below it.)
    if (band) free.y0 = Math.min(Math.max(free.y0, band.y1), free.y1 - 80);
    // Tidy stands above the thumb row, in the corner: nothing is framed under it either. (Where it will have settled: see `fabBoxes`.)
    const tidyFab = fabsEl?.querySelector<HTMLElement>('[data-testid="fab-tidy"]:not([hidden])');
    const aside = sheetAside();
    const corner = fabsEl && tidyFab && tidyFab.offsetWidth
      ? { x0: fabsEl.offsetLeft + tidyFab.offsetLeft - aside.shift - 8, y0: fabsEl.offsetTop + tidyFab.offsetTop - aside.lift - 8 } : null;
    for (const pad of [14, 4]) {
      const a = inset(free, pad);
      tiers.push(corner ? [a, { ...a, x1: Math.min(a.x1, corner.x0) }, { ...a, y1: Math.min(a.y1, corner.y0) }] : [a]);
    }
    if (corner) blocks.push({ x0: corner.x0, y0: corner.y0, x1: Infinity, y1: free.y1 });
    // Never under a floating button, nor nearer to one than FAB_CLEAR; nor under the "tap where…" line.
    blocks.push(...fabBoxes());
    const tap = stageBoxOf(document.getElementById('tap-hint'), 4);
    if (tap) blocks.push(tap);
    // Behind the row of floating controls only when the room clear of them is too small for one card.
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
    for (const e of [hintsEl, document.getElementById('tap-hint')]) {
      const b = stageBoxOf(e, 6);
      if (b) blocks.push(b);
    }
  }
  const tryBox = (b: Box): View | null => {
    for (const areas of tiers) {
      let best: View | null = null;
      let bestCost = Infinity;
      for (const area of areas) {
        if (area.x1 - area.x0 < 80 || area.y1 - area.y0 < 60) continue;
        const v0 = frameBox(cur, b, area, least);
        // The least move into the area; when that lies under a block (a floating button in the corner of a short
        // stage), the box is slid on past the block, to its left or right, above or below it, as long as it stays
        // in the area.
        const cands: View[] = [v0];
        const s0 = onStage(b, v0);
        for (const o of blocks) {
          if (!(s0.x0 < o.x1 && s0.x1 > o.x0 && s0.y0 < o.y1 && s0.y1 > o.y0)) continue;
          for (const [dx, dy] of [[o.x0 - s0.x1, 0], [o.x1 - s0.x0, 0], [0, o.y0 - s0.y1], [0, o.y1 - s0.y0]]) {
            if (Number.isFinite(dx) && Number.isFinite(dy)) cands.push({ x: v0.x + dx, y: v0.y + dy, k: v0.k });
          }
        }
        for (const v of cands) {
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
      }
      if (best) return best;
    }
    return null;
  };
  const whole = tryBox(box);
  const next = whole ?? tryBox(last);
  if (!next) {
    // No room for even one card clear of everything (a very small stage): show its top left corner.
    const tier = tiers[tiers.length - 1];
    return { view: frameBox(cur, last, tier[tier.length - 1], least), all: false };
  }
  return { view: next, all: !!whole || boxes.length < 2 };
}

/**
 * Zoom about a point (the middle of the stage when none is given). Asked to zoom by nothing
 * (`zoomBy(1)`), it applies a view that was written to `ui.view` from outside, as Show me does: such a
 * view is brought inside the limits, and one written from among the cards stays among the cards (it is
 * brought in to the floor of the detailed tier rather than left in the overview, where there are no
 * ports to point at).
 */
export function zoomBy(factor: number, cx?: number, cy?: number) {
  glide = null;
  const r = rectOf();
  const px = (cx ?? r.left + r.width / 2) - r.left;
  const py = (cy ?? r.top + r.height / 2) - r.top;
  const k = factor === 1 && !over && ui.view.k < zoomFloor() ? zoomFloor() : clampK(ui.view.k * factor);
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
  // Between the phone layout and the wide one, the view each had is kept, so that going back (a window
  // dragged narrow and wide again) finds the board where it was. A phone turned on its side keeps its zoom and
  // the middle of its view (see `openView`).
  const kind = layoutKind();
  if (kindSeen && kind !== kindSeen) {
    layoutViews.set(kindSeen, resizeAnchorNow());
    switchedTo = kind;
    turnedFrom = null;
  } else {
    switchedTo = null;
    turnedFrom = kind === 'phone' ? resizeAnchorNow() : null;
  }
  kindSeen = kind;
  // The build menu changes shape (a fan or a sheet): it closes, and its port is armed again so that one
  // tap opens it in the new shape. An armed port and a wire being dragged carry on as they were.
  if (radial) {
    const r = radial;
    closeRadial();
    if (r.dir === 'consume' && !drag) armPort(r.from, r.port);
  }
  if (ui.view.k !== clampK(ui.view.k)) zoomBy(1);
  else applyView();
}

// ---------- the stage changes size ----------
// A panel opening or closing beside the board (the inspector) narrows or widens the stage from the right:
// what is on screen stays where it is, and only a selected node that ends up covered is brought back
// (ensureVisible). The window changing size keeps the middle of the board in the middle, measured from
// where the camera stood before the resizing began, so a window dragged narrow and back again leaves the
// view as it was. Switching between the phone layout and the wide one, each keeps the view it had.

type LayoutKind = 'phone' | 'wide';
const layoutKind = (): LayoutKind => (env.phone ? 'phone' : 'wide');
let kindSeen: LayoutKind | null = null;
/** The layout the board has just switched to (until the opening view has been chosen for it). */
let switchedTo: LayoutKind | null = null;
/** A phone has just been turned: the view it had before (the middle of the stage and the zoom), to stand on again. */
let turnedFrom: Anchor | null = null;
/** A view to come back to: the world point in the middle of the stage, and the zoom. */
interface Anchor { wx: number; wy: number; k: number }
const layoutViews = new Map<LayoutKind, Anchor>();
/** Stage and window sizes as last seen, the view a resize was measured from, and the view it left. */
const stageSeen = { w: 0, h: 0 }, winSeen = { w: 0, h: 0 };
let resizeAnchor: Anchor | null = null;
let resizeLeft: View | null = null;
/** The opening view is waiting for the stage to have a size (it opened behind a full-screen panel). */
let openPending = false;
/** Until when the window counts as being resized (performance.now), and the check on the selection after it. */
let resizingUntil = 0;
let resizeSettle = 0;
const RESIZE_REST = 400;

const anchorOf = (v: View, w: number, h: number): Anchor => ({ wx: (w / 2 - v.x) / v.k, wy: (h / 2 - v.y) / v.k, k: v.k });

/** The view as an anchor: the one the resizing started from while it is still the view, else the view now. */
function resizeAnchorNow(): Anchor {
  const v = viewAhead();
  if (resizeAnchor && resizeLeft && sameView(v, resizeLeft)) return resizeAnchor;
  return anchorOf(v, stageSeen.w || rectOf().width, stageSeen.h || rectOf().height);
}

/** Put the camera on an anchor in the stage as it is now. */
function standOn(a: Anchor) {
  const r = rectOf();
  glide = null;
  ui.view.k = a.k;
  ui.view.x = r.width / 2 - a.wx * a.k;
  ui.view.y = r.height / 2 - a.wy * a.k;
  applyView();
  resizeAnchor = a;
  resizeLeft = { ...ui.view };
}

/** The stage has a new size (from its ResizeObserver). */
function stageResized() {
  const r = rectOf();
  const w = r.width, h = r.height;
  const before = { ...stageSeen };
  const winChanged = window.innerWidth !== winSeen.w || window.innerHeight !== winSeen.h;
  stageSeen.w = w;
  stageSeen.h = h;
  winSeen.w = window.innerWidth;
  winSeen.h = window.innerHeight;
  if (w < 2 || h < 2 || !renderedGame) return;
  // A layout that had no size when it opened (behind a full-screen panel) gets its opening view now.
  if (openPending) {
    openPending = false;
    openView();
    return;
  }
  if (before.w < 2 || before.h < 2 || (before.w === w && before.h === h) || !winChanged) return;
  const v = viewAhead();
  standOn(resizeAnchor && resizeLeft && sameView(v, resizeLeft) ? resizeAnchor : anchorOf(v, before.w, before.h));
  // A selected node that the narrower window covers is not chased step by step (each chase would move the
  // anchor, and a window dragged narrow and wide again would not come back to where it was): it is looked at
  // once, when the resizing stops.
  resizingUntil = performance.now() + RESIZE_REST;
  clearTimeout(resizeSettle);
  resizeSettle = window.setTimeout(() => {
    if (ui.sel?.kind === 'node' && !drag) ensureVisible(ui.sel.id);
  }, RESIZE_REST + 50);
}

// ---------- the Expand button ----------
// Its natural place is in the world, just under the plot, and while that place can be seen and nothing
// lies over it, that is where the button stands, at the scale of everything else on the board. But the
// goal card sends the player to it ("Expand board at the edge of the map"), and a camera that frames
// the factory seldom shows the edge of the map. So whenever its place is off screen, or under the goal
// card, a sheet or a floating control, the button docks: it comes to rest at life size in the free part
// of the stage, as near to its place as it can (the rule is `dockSpot` in geom.ts), in a one-line form
// unless the goal card is asking for it. It slides from one place to the other. On a phone it docks only
// in the thumb row, beside Fit: a button floating over so small a board lies on top of cards.
//
// The element is a child of the board, not of the world, and is placed by a transform in stage pixels.

let hintsEl: HTMLElement | null = null;
let fabsEl: HTMLElement | null = null;
let toastsEl: HTMLElement | null = null;
/** The time-away card ("While you were away", hud-screens.ts): up while it has the class `open`. */
let modalEl: HTMLElement | null = null;
const EXPAND_W = 260, EXPAND_H = 64;
/**
 * How much larger than life the button is drawn in its natural place at each step of the overview, so
 * that it can still be found and pressed there: 64 px tall, it is never under 44 px on screen.
 */
const OV_SCALE = [1, 1.5, 1.9, 2.8, 3.6, 4.5];
/** Docked, the button keeps this far from the edge of what the player can see, and from every control. */
const DOCK_EDGE = 10, DOCK_GAP = 10;
/** In its natural place it may come this close to the edge of the stage and to a control before it docks. */
const HOME_EDGE = 4, HOME_GAP = 6;
/** Once docked it goes back only when its place is this much further in the clear, so it cannot flicker on the line. */
const DOCK_STICK = 8;
/** On a phone the thumb row is the Claim button's seat (with the floating buttons): room for it is kept whether Claim is showing or not. */
const CLAIM_SEAT = 70;
/** The slide from one place to the other, in ms. */
const DOCK_MS = 220;
/** A docked button follows its place along the edge as the camera moves; a step longer than this (px) is slid. */
const DOCK_JUMP = 24;
/** After an expansion the button takes no press for this long: docked, it stays under the pointer, and a second press would buy a second plot. */
const EXPAND_REST = 700;
/**
 * Nor a tap while it slides from one place to another, or this soon after it came to rest or changed place:
 * docked over the board, it can slide under a finger that was on its way to a port or a card (a sheet
 * opens, the camera eases), and that tap must not buy a plot. (A mouse pointer can be seen: a click counts.)
 */
const MOVE_REST = 40;
/**
 * A finger that comes down on the button where it already stood this long before (ms) was aimed at it: its tap
 * counts even if the button has moved a little since, or is moving (a sheet opened, the alert chip came in under
 * the card and pushed it down). One that comes down where the button has only just arrived was not.
 */
const AIM_MS = 250;
/** Docked over the board and in the way of what has just grown or moved beside it, the button waits this long (ms) for its surroundings to stop changing, then changes place once. */
const SETTLE_MS = 160;

/** Where the middle of the button is on the stage, and the scale it is drawn at. */
interface Stand { x: number; y: number; s: number }
const ex = {
  /** It is docked, in its one-line form, and the goal card is asking for it (and the player can pay). */
  docked: false, mini: false, call: false,
  /** The size of the element as laid out in its present form (before the scale), and what that was measured for. */
  w: EXPAND_W, h: EXPAND_H, sized: '',
  /** Where it belongs now, where it is drawn, and the slide between the two when there is one. */
  target: null as Stand | null, drawn: null as Stand | null,
  slide: null as { from: Stand; t0: number } | null,
  /** What it must keep clear of, in stage pixels: measured again when `stale` (see `measureExpand`). */
  blocks: [] as Box[], stale: true,
  /** The goal card is sending the player to it (see `expandAsked`), and when that was last looked at. */
  asked: false, askedKey: '', askedAt: 0,
  /** No press counts before this (performance.now). */
  restUntil: 0,
  /** When it last changed place other than by following the camera, or was last sliding: see `MOVE_REST`. */
  movedAt: 0,
  /** The docked button as a world box: wire dots are not drawn over it (the first four numbers of every flow's `occ`). */
  occ: [0, 0, 0, 0],
  /**
   * On a phone: the right end and the middle of its seat in the thumb row, just left of the floating
   * buttons (see `measureExpand`), or null while that row is taken (Claim, the "tap where…" line, the
   * build menu). `short`: a phone held sideways, where the board has no room to spare for it.
   */
  row: null as { x1: number; y: number } | null, short: false,
  /** The width of the one-line form, as last measured. */
  miniW: 160,
  /** Shown at all: from the goal that asks for it on (see `expandShown`). */
  shown: false,
  /** The button stood back (see `expandQuiet`) when the last press anywhere began. */
  quietAtDown: false,
  /** The last press began on the button where it had already stood a moment before (see `aimedAt`). */
  aimedAtDown: false,
  /** Where it has been drawn of late (stage pixels; an empty box while hidden), newest last: see `aimedAt`. */
  seats: [] as { t: number; x0: number; y0: number; x1: number; y1: number }[],
  /** What it keeps clear of and where it may stand, as last placed (a signature), and when that last changed. */
  around: '', aroundAt: 0,
  /** It has been left where it was for its surroundings to settle (SETTLE_MS), and is placed again then. */
  settling: false,
  /** What the last measurement was taken for (see `expandKey`), and when. */
  key: '', measuredAt: 0,
  /**
   * Off a phone the stage itself has changed size (the inspector opened or closed beside it, the window was
   * resized): docked, the button takes its place afresh rather than staying where it was, so that it comes back
   * once the inspector has gone.
   */
  reseat: false,
};

/** The goal that first asks for the expansion: before it the button is not shown (it would compete with the first steps). */
const EXPAND_GOAL = GOALS.findIndex((x) => x.id === 'expand');

/**
 * Whether the button is on the board at all: from the goal "Open up more land" on (or once the board has been
 * expanded, in free play, or when a "while you wait" line asks for it). Before that it would only be one more
 * thing beside the first instructions, and a tap meant for an empty spot could buy a plot.
 */
function expandShown(g: Game): boolean {
  return g.board.expansions > 0 || g.ended || EXPAND_GOAL < 0 || g.goal.i >= EXPAND_GOAL || ex.asked;
}

/**
 * The player is in the middle of something (a port armed, a wire being drawn, a card being placed, the build
 * menu open): the button stands back, faint and deaf to presses, in either form. A tap meant for an empty
 * spot of the board must never buy a plot.
 */
const expandQuiet = () => !!tapWire || !!ui.placing || !!radial || (!!drag && (drag.kind === 'wire' || drag.kind === 'wireIn'));

/**
 * The goal card is asking for the expansion: the goal is "Open up more land", or the next step of the
 * goal's "while you wait" line is to expand (which the line only asks for when it can be paid for).
 */
function expandAsked(g: Game): boolean {
  const goal = activeGoal(g);
  // (A goal that is done and waiting to be claimed asks for nothing more.)
  if (!goal || g.goal.ready) return false;
  return goal.id === 'expand' || (!!goal.meanwhile && !!lineAdvice(g)?.expand);
}

/** What the button's surroundings depend on that can be read without reading layout: when it changes, they are measured again. */
function expandKey(g: Game): string {
  const c = env.cover(), s = env.strip(), k = env.corner();
  return `${c.top}|${c.right}|${c.bottom}|${c.row}|${s ? `${s.x0},${s.x1},${s.bottom}` : ''}|${k ? `${k.x0},${k.y0}` : ''}|${ui.uiRev}|${g.goal.i}${g.goal.ready ? 'r' : ''}|${toastsEl?.childElementCount ?? 0}|${hintsEl?.hidden ? 1 : 0}|${tidyBtn && !tidyBtn.hidden ? 1 : 0}`;
}

/** What stands on the stage that the button must keep clear of. Reads layout: only when something may have changed. */
function measureExpand() {
  ex.stale = false;
  ex.measuredAt = performance.now();
  watchStage();
  const r = rectOf();
  const out: Box[] = [];
  const add = (e: Element | null | undefined) => {
    const b = e?.getBoundingClientRect();
    if (b && b.width > 1 && b.height > 1) out.push({ x0: b.left - r.left, y0: b.top - r.top, x1: b.right - r.left, y1: b.bottom - r.top });
  };
  if (env.phone) {
    // (The strip, an open sheet and the thumb row are left out of the area itself: see `dockArea`.)
    // The floating buttons (Tidy stands above the thumb row); toasts come up under the strip.
    for (const b of fabsEl?.querySelectorAll('.fab:not([hidden])') ?? []) add(b);
    if (toastsEl?.childElementCount) add(toastsEl);
    // The strip as it is laid out this moment (an alert chip that has just come in makes it taller
    // before the cover is measured again). Held upright, the strip takes the alert chip as one more row under the
    // card: room is kept for it whether it is showing or not (as away from a phone, ALERT_ROOM), or the button
    // docked under the card is pushed down the moment a problem is named, under a finger on its way to it.
    const strip = document.getElementById('hud-strip');
    if (strip && !strip.hidden) {
      const b = strip.getBoundingClientRect();
      const upright = r.height > r.width;
      const room = upright && document.getElementById('hud-alert')?.hidden ? PHONE_ALERT_ROOM : 0;
      if (b.height > 1) out.push({ x0: -1e6, y0: -1e6, x1: 1e6, y1: b.bottom - r.top + room });
    }
    // Its seat in the thumb row, beside Fit, or beside Claim or the "tap where…" line when one of those stands
    // in the row: a place that costs no working board. None while the build menu is open (the floating
    // buttons step aside then).
    ex.short = r.height < 420 && r.width > r.height;
    // (Where Fit stands once an open sheet has pushed the floating buttons aside, read from layout, not from
    // where they are drawn mid-slide: they are moved by a transform that follows --lift and --shift.)
    const fitBtn = fabsEl?.querySelector<HTMLElement>('[data-testid="fab-fit"]');
    const c = env.cover();
    const fit: Box | null = fabsEl && fitBtn && fitBtn.offsetWidth ? {
      x0: fabsEl.offsetLeft + fitBtn.offsetLeft - c.right, x1: fabsEl.offsetLeft + fitBtn.offsetLeft + fitBtn.offsetWidth - c.right,
      y0: fabsEl.offsetTop + fitBtn.offsetTop - c.bottom, y1: fabsEl.offsetTop + fitBtn.offsetTop + fitBtn.offsetHeight - c.bottom,
    } : null;
    let x1 = fit ? fit.x0 - 10 : -1;
    for (const e of [document.querySelector('#hud [data-testid="claim"]'), document.getElementById('tap-hint')]) {
      const b = stageBoxOf(e);
      if (b && fit && b.x0 < fit.x0) x1 = Math.min(x1, b.x0 - 10);
    }
    ex.row = fit && x1 > 0 && !appEl?.classList.contains('building') ? { x1, y: (fit.y0 + fit.y1) / 2 } : null;
  } else {
    // The goal card with the order beside it, over the middle of the top edge, and room under it for the
    // alert chip whether it is showing or not.
    const s = env.strip();
    if (s) out.push({ x0: s.x0, y0: -1e6, x1: s.x1, y1: Math.max(s.bottom, s.goalBottom + ALERT_ROOM) });
    // The zoom buttons and the minimap: everything right of and below their corner, as they are laid out now
    // (the corner the shell keeps is measured when the stage changes size, and lags behind the cluster growing
    // its Tidy button: the button stood 36 px into the cluster at 1024x768 for up to two seconds).
    let cx = Infinity, cy = Infinity;
    for (const id of ['zoom', 'mini']) {
      const b = stageBoxOf(document.getElementById(id));
      if (b) {
        cx = Math.min(cx, b.x0);
        cy = Math.min(cy, b.y0);
      }
    }
    if (cx < Infinity) out.push({ x0: cx, y0: cy, x1: 1e6, y1: 1e6 });
    add(hintsEl);
    // (For a finger on a wide screen the "tap where..." line shows under the strip.)
    add(document.getElementById('tap-hint'));
    // Toasts are not in the list: outside the phone layout they step up above the button themselves (hud-toasts.ts).
  }
  ex.blocks = out;
}

/**
 * The strip grows when the alert chip comes in, toasts come and go, Tidy shows: each of these may take
 * the button's place, so a change in their size has the button moved at once rather than at the next
 * slow refresh. (They are made after the board, so they are looked for here.)
 */
let stageWatch: ResizeObserver | null = null;
const watched = new Set<string>();
function watchStage() {
  if (typeof ResizeObserver === 'undefined') return;
  stageWatch ??= new ResizeObserver(() => {
    ex.stale = true;
    placeExpand();
  });
  for (const id of ['hud-strip', 'toasts', 'fabs', 'hints', 'zoom']) {
    if (watched.has(id)) continue;
    const e = document.getElementById(id);
    if (!e) continue;
    watched.add(id);
    stageWatch.observe(e);
  }
}

/** The part of the stage the docked button may stand in. */
function dockArea(): Box {
  const r = rectOf();
  if (!env.phone) return { x0: DOCK_EDGE, y0: DOCK_EDGE, x1: r.width - DOCK_EDGE, y1: r.height - DOCK_EDGE };
  // Under the strip, beside or above an open sheet, and above the thumb row.
  const c = env.cover();
  const x0 = c.left + DOCK_EDGE, y0 = c.top + DOCK_EDGE;
  return { x0, y0, x1: Math.max(x0 + 40, r.width - c.right - DOCK_EDGE), y1: Math.max(y0 + 40, r.height - c.bottom - Math.max(c.row, CLAIM_SEAT) - 2) };
}

/**
 * Work out where the button belongs and in which form, and put it there. `byCamera`: the view has just
 * changed (the button's natural place moves with the board, and is followed exactly); otherwise
 * something about the stage or the game may have changed, and a new place is slid to.
 */
function placeExpand(byCamera = false) {
  const g = ui.g;
  if (!g || !expandEl) return;
  const r = rectOf();
  if (r.width < 2 || r.height < 2) return;
  if (ex.stale) measureExpand();
  ex.settling = false;
  ex.shown = expandShown(g);
  if (!ex.shown) {
    hideExpand();
    return;
  }
  const { x: vx, y: vy, k } = ui.view;
  // Its natural place: centred under the plot, at the board's scale (larger in the overview).
  const hs = OV_SCALE[ovStep] * k;
  const hw = EXPAND_W * hs, hh = EXPAND_H * hs;
  const home: Stand = { x: (g.board.w / 2) * k + vx, y: (g.board.h + 18) * k + vy + hh / 2, s: hs };
  const area = dockArea();
  const stick = ex.docked ? DOCK_STICK : 0;
  const by = DOCK_EDGE - HOME_EDGE - stick;
  const seen = boxClear(
    { x0: home.x - hw / 2, y0: home.y - hh / 2, x1: home.x + hw / 2, y1: home.y + hh / 2 },
    { x0: area.x0 - by, y0: area.y0 - by, x1: area.x1 + by, y1: area.y1 + by }, ex.blocks, HOME_GAP + stick,
  );
  const docked = !seen;
  // On a phone, docked, it stands in the thumb row beside Fit (or beside Claim), in the nearest stretch of
  // it that no card or port lies under, and nowhere else: over the board it would float on top of cards. While
  // there is no such stretch (the row full, the build menu open, cards all along the row) it waits off the board;
  // Fit, and the overview, where it stands at the plot's edge, bring it back.
  const rowX = docked && env.phone && ex.row ? rowSeat(ex.row) : null;
  const afford = g.credits + 1e-6 >= expansionCost(g);
  const call = ex.asked && afford;
  // (In the thumb row it takes its one-line form, whatever is asked: the row is 44 px tall. So it does on a
  // phone held sideways, where the board is a strip.)
  const inRow = rowX != null;
  const mini = docked && (!call || inRow || (env.phone && ex.short));
  // (Shown before it is measured: a hidden element has no size. Hidden again below, before anything is drawn, if it has no place.)
  setHidden(expandEl, false);
  setClass(expandEl, 'dock', docked);
  setClass(expandEl, 'mini', mini);
  setClass(expandEl, 'call', call);
  // The element's own size changes with its form (and the price in it): measured once for each.
  const sized = `${mini ? 1 : 0}${docked ? 1 : 0}|${expandCost}|${isTouch() ? 1 : 0}|${boardEl.classList.contains('big') ? 1 : 0}`;
  if (sized !== ex.sized) {
    ex.sized = sized;
    ex.w = mini ? expandEl.offsetWidth || 150 : EXPAND_W;
    ex.h = mini ? expandEl.offsetHeight || 36 : EXPAND_H;
    if (mini) ex.miniW = ex.w;
  }
  // (On a phone, docked and with no seat in the thumb row, it is not on the board at all.)
  if (docked && env.phone && rowX == null) {
    hideExpand();
    return;
  }
  let target = home;
  if (rowX != null && ex.row) target = { x: Math.min(rowX, ex.row.x1) - ex.w / 2, y: ex.row.y, s: 1 };
  else if (docked) {
    // (Docked over the board it keeps off the cards on screen too, with their ports, when there is room
    // anywhere for that: a tap meant for a port must not buy a plot.)
    const pad = isTouch() ? 24 : 6;
    const cards: Box[] = [];
    for (const n of g.nodes) {
      const b = onStage(cardBox(n), ui.view);
      if (b.x1 + pad > area.x0 && b.x0 - pad < area.x1 && b.y1 + pad > area.y0 && b.y0 - pad < area.y1) cards.push({ x0: b.x0 - pad, y0: b.y0, x1: b.x1 + pad, y1: b.y1 });
    }
    const blocks = cards.length < 40 ? ex.blocks.concat(cards) : ex.blocks;
    // Where it stands docked over the board it stays, for as long as that place is clear, unless the player is
    // moving the board: when what moved was a sheet, a toast or the strip, or the camera gliding by itself (to
    // keep the selected card in view as the strip grows), a button that changes place while a finger is on its way
    // to it is a button that cannot be pressed. (As the player pans, it follows its place along the edge.)
    // And when it has to move, it waits for its surroundings to settle and then moves once: the strip, the cover
    // the phone shell reports, the sheet and the floating buttons above it each take their new place a frame or
    // more apart (the alert chip coming in under the card moved it three times in 60 ms).
    const at = ex.target;
    const kept = !ex.reseat && (!byCamera || !!glide) && at && ex.docked && ex.mini === mini && !env.calm ? { x: at.x - ex.w / 2, y: at.y - ex.h / 2 } : null;
    const sig = `${Math.round(area.x0)},${Math.round(area.y0)},${Math.round(area.x1)},${Math.round(area.y1)}|${ex.blocks.map((b) => `${Math.round(b.x0)},${Math.round(b.y0)},${Math.round(b.x1)},${Math.round(b.y1)}`).join(' ')}`;
    if (sig !== ex.around) {
      ex.around = sig;
      ex.aroundAt = performance.now();
    }
    let p: { x: number; y: number };
    if (kept && boxClear({ x0: kept.x, y0: kept.y, x1: kept.x + ex.w, y1: kept.y + ex.h }, area, blocks, DOCK_GAP)) p = kept;
    else if (kept && performance.now() - ex.aroundAt < SETTLE_MS) {
      p = kept;
      ex.settling = true;
    } else p = dockSpot({ home, w: ex.w, h: ex.h, area, blocks, gap: DOCK_GAP });
    target = { x: p.x + ex.w / 2, y: p.y + ex.h / 2, s: 1 };
  }
  // A change of place is slid: from one place to the other, to a docked place that jumped, and to any new
  // place the camera did not cause. (Not while the board is being opened, nor when motion is reduced.)
  const was = ex.target;
  // (A change of place the camera did not cause, or a docked jump along the edge, also holds off presses
  // for a moment: see `MOVE_REST`. Following the camera does not: the finger follows it too.)
  if (was) {
    const step = Math.hypot(target.x - was.x, target.y - was.y);
    if (docked !== ex.docked || (byCamera ? docked && step > DOCK_JUMP : step > 2)) ex.movedAt = performance.now();
  }
  // (Docked over the board in the same form before and after, pushed by what grew beside it, it changes place at
  // once: a button on its way somewhere for a fifth of a second is a button whose taps do not count, see `aimedAt`.)
  const pushed = !byCamera && docked && ex.docked && rowX == null && !ex.slide && mini === ex.mini;
  if (was && ex.drawn && renderedGame && !env.calm && performance.now() >= openingUntil && !pushed) {
    const step = Math.hypot(target.x - was.x, target.y - was.y);
    if (docked !== ex.docked || (byCamera ? docked && step > DOCK_JUMP : step > 0.5 || Math.abs(target.s - was.s) > 0.002)) {
      ex.slide = { from: { ...ex.drawn }, t0: performance.now() };
    }
    // The way there must not pass under a floating control: then it just changes place.
    if (ex.slide && !slideClear(ex.drawn, target)) ex.slide = null;
  } else if (!pushed) ex.slide = null;
  ex.docked = docked;
  ex.mini = mini;
  ex.call = call;
  ex.target = target;
  ex.reseat = false;
  drawExpand();
}

/**
 * The right end of the stretch of the thumb row nearest Fit, at most `row.x1`, where the one-line button
 * (as last measured) lies over no card and no port; null when there is none.
 */
function rowSeat(row: { x1: number; y: number }): number | null {
  const w = ex.miniW + 4, h = 44;
  const y0 = row.y - h / 2, y1 = row.y + h / 2;
  const { x: vx, y: vy, k } = ui.view;
  // Cards (with their ports) that reach into the row, as stretches of it, right to left.
  const taken: [number, number][] = [];
  for (const n of ui.g.nodes) {
    const b = cardBox(n);
    const sy0 = b.y0 * k + vy, sy1 = b.y1 * k + vy;
    if (sy1 < y0 || sy0 > y1) continue;
    const sx0 = b.x0 * k + vx, sx1 = b.x1 * k + vx;
    if (sx1 < 0 || sx0 > row.x1) continue;
    // (A finger aiming at a port lands up to a fingertip beside it: the button keeps that far off too.)
    taken.push([sx0 - 4, sx1 + 30]);
  }
  taken.sort((a, b) => b[1] - a[1]);
  let right = row.x1;
  for (const [a, b] of taken) {
    if (b < right - w) break;
    if (a < right) right = Math.min(right, a);
  }
  return right - w >= DOCK_EDGE ? right : null;
}

/** Off the board for now: hidden, and no longer a place wire dots keep away from. */
function hideExpand() {
  noteSeat(0, 0, 0, 0);
  setHidden(expandEl, true);
  ex.target = ex.drawn = null;
  ex.slide = null;
  ex.docked = false;
  if (ex.occ[2] !== 0) {
    ex.occ.fill(0);
    for (const refs of wireEls.values()) if (refs.flow.occ.length >= 4) refs.flow.occ.fill(0, 0, 4);
    invalidateFx();
  }
}

/**
 * On its way from one place to the other the button keeps inside the stage. (The two ends are inside it,
 * but the form can change as it sets off: the full form, centred where the one-line form stood, can
 * stick out.)
 */
function keepIn(st: Stand): Stand {
  const r = rectOf();
  const hw = (ex.w * st.s) / 2 + 2, hh = (ex.h * st.s) / 2 + 2;
  const x = r.width > 2 * hw ? Math.max(hw, Math.min(r.width - hw, st.x)) : st.x;
  const y = r.height > 2 * hh ? Math.max(hh, Math.min(r.height - hh, st.y)) : st.y;
  return { x, y, s: st.s };
}

/** A slide from one stand to the other keeps clear of every control on the way (sampled along it). */
function slideClear(a: Stand, b: Stand): boolean {
  const all: Box = { x0: -1e7, y0: -1e7, x1: 1e7, y1: 1e7 };
  const n = Math.max(10, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const { x, y, s: sc } = keepIn({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, s: a.s + (b.s - a.s) * u });
    const hw = (ex.w * sc) / 2, hh = (ex.h * sc) / 2;
    if (!boxClear({ x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh }, all, ex.blocks, 2)) return false;
  }
  return true;
}

/** Remember where the button is drawn now (stage pixels; all zero: hidden), for `aimedAt`. Kept for a second. */
function noteSeat(x0: number, y0: number, x1: number, y1: number) {
  const now = performance.now();
  const log = ex.seats;
  const last = log[log.length - 1];
  if (last && last.x0 === x0 && last.y0 === y0 && last.x1 === x1 && last.y1 === y1) return;
  log.push({ t: now, x0, y0, x1, y1 });
  // (The newest entry older than the window stays: it says where the button stood when the window began.)
  while (log.length > 2 && log[1].t < now - 1000) log.shift();
}

/**
 * Was a press at this client point aimed at the button? It was if the button is under it now and was under it
 * AIM_MS ago, wherever it has been in between: it had been on show there for longer than a finger takes to set
 * off for it. A button that has slid or jumped under a finger on its way to a port or a card was not there then.
 */
function aimedAt(cx: number, cy: number): boolean {
  if (!ex.shown || expandEl.hidden) return false;
  const r = rectOf();
  const x = cx - r.left, y = cy - r.top;
  const log = ex.seats;
  const now = performance.now();
  const inside = (b: { x0: number; y0: number; x1: number; y1: number }) => b.x1 > b.x0 && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  const cur = log[log.length - 1];
  if (!cur || !inside(cur)) return false;
  // Where it stood AIM_MS ago: the newest entry from before then.
  let then = null;
  for (let i = log.length - 1; i >= 0; i--) if (log[i].t <= now - AIM_MS) { then = log[i]; break; }
  return !!then && inside(then);
}

/** Put the button where it belongs, or where it has got to on its way there. */
function drawExpand() {
  const t = ex.target;
  if (!t) return;
  let d = t;
  const sl = ex.slide;
  if (sl) {
    const u = Math.min(1, (performance.now() - sl.t0) / DOCK_MS);
    const e = 1 - (1 - u) * (1 - u) * (1 - u);
    d = keepIn({ x: sl.from.x + (t.x - sl.from.x) * e, y: sl.from.y + (t.y - sl.from.y) * e, s: sl.from.s + (t.s - sl.from.s) * e });
    if (u >= 1) ex.slide = null;
  }
  ex.drawn = d;
  const left = d.x - (ex.w * d.s) / 2, top = d.y - (ex.h * d.s) / 2;
  noteSeat(left, top, left + ex.w * d.s, top + ex.h * d.s);
  // (While it slides it takes no press; the rest is counted from the end of the slide.)
  if (sl) ex.movedAt = performance.now();
  setStyle(expandEl, 'transform', `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px) scale(${d.s.toFixed(4)})`);
  // Wire dots are drawn above everything on the board: a docked button is one more thing they keep off.
  const { x: vx, y: vy, k } = ui.view;
  const o = ex.occ;
  const x0 = ex.docked ? (left - 2 - vx) / k : 0, y0 = ex.docked ? (top - 2 - vy) / k : 0;
  const x1 = ex.docked ? (left + ex.w * d.s + 2 - vx) / k : 0, y1 = ex.docked ? (top + ex.h * d.s + 2 - vy) / k : 0;
  if (x0 === o[0] && y0 === o[1] && x1 === o[2] && y1 === o[3]) return;
  o[0] = x0;
  o[1] = y0;
  o[2] = x1;
  o[3] = y1;
  for (const refs of wireEls.values()) {
    const occ = refs.flow.occ;
    if (occ.length < 4) continue;
    occ[0] = x0;
    occ[1] = y0;
    occ[2] = x1;
    occ[3] = y1;
  }
  invalidateFx();
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
      <div id="site"></div>
    </div>
    <div id="ghost-cap" hidden></div>
    <button id="expand" data-testid="expand" style="transform:translate(-9999px,0)"></button>
    <div id="radial"></div>`;
  worldEl = boardEl.querySelector('#world')!;
  plotEl = boardEl.querySelector('#plot')!;
  plotLabel = boardEl.querySelector('#plot-label')!;
  depositsEl = boardEl.querySelector('#deposits')!;
  wiresSvg = boardEl.querySelector('#wires')!;
  nodesEl = boardEl.querySelector('#nodes')!;
  chipsEl = boardEl.querySelector('#chips')!;
  ghostEl = boardEl.querySelector('#ghost')!;
  siteEl = boardEl.querySelector('#site')!;
  ghostCap = boardEl.querySelector('#ghost-cap')!;
  expandEl = boardEl.querySelector('#expand')!;
  radialEl = boardEl.querySelector('#radial')!;
  tempPath = boardEl.querySelector('#temp-wire')!;
  tempEnd = boardEl.querySelector('#temp-end')!;
  knifeLine = boardEl.querySelector('#knife')!;
  appEl = boardEl.closest<HTMLElement>('#app');
  hintsEl = document.getElementById('hints');
  toastsEl = document.getElementById('toasts');
  modalEl = document.getElementById('modal');
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
    wheelAt = performance.now();
    if (radial) closeRadial();
    zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });
  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onTidyKey);
  onPress(expandEl, expand);
  // A finger's tap acts on the click that follows it, and by then the board may have answered the tap (a card
  // placed, the build menu closed) and woken the button up under that finger. Whether it stood back is
  // therefore taken when the finger comes down: a tap that began while it did was meant for the board.
  window.addEventListener('pointerdown', (e) => {
    ex.quietAtDown = expandQuiet() || expandEl.classList.contains('quiet');
    ex.aimedAtDown = aimedAt(e.clientX, e.clientY);
  }, true);
  onSignal('showme', (d) => {
    shownWire = d.wire ? { ...d.wire } : null;
  });
  // The next goal starts with the whole board: on a narrow stage the inspector closes (see `makeRoom`).
  onGame((ev) => {
    if (ev.kind === 'goal-claimed') makeRoom();
  });
  // An option counts only for a press that began on the menu after it opened (see `menuPressOk`).
  for (const m of [radialEl, buildEl]) m.addEventListener('pointerdown', noteMenuPress, true);
  // The outline is the suggested option's card; with the pointer (or the focus) on another option it is that one's.
  const showOpt = (e: Event) => {
    // (A finger does not rest on an option before it presses it: for a finger the first press shows, see `pickRadial`.)
    if ((e.type === 'pointerover' || e.type === 'pointerout') && (e as PointerEvent).pointerType !== 'mouse') return;
    const slot = (e.target as Element | null)?.closest?.<HTMLElement>('.slot');
    const i = slot && e.type !== 'pointerout' && e.type !== 'focusout' ? Number(slot.dataset.i) : radial?.asked;
    if (radial && radial.shown !== i) {
      radial.shown = i;
      drawSite();
    }
  };
  for (const t of ['pointerover', 'pointerout', 'focusin', 'focusout']) radialEl.addEventListener(t, showOpt);
  delegate(radialEl, (a, args, _el, ev) => {
    if (a === 'pick' && menuPressOk(ev)) pickRadial(Number(args[0]));
  });
  // (The sheet's ✕ too: where the sheet appears at once, with reduced motion, the opening tap's click landed on it
  // and shut the sheet before it was seen.)
  delegate(buildEl, (a, args, _el, ev) => {
    if (a === 'pick' && menuPressOk(ev)) pickRadial(Number(args[0]));
    else if (a === 'close' && menuPressOk(ev)) closeRadial();
  });
  // The cached board rect (and the minimap's viewport box) follow the stage's size.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      invalidateLayout();
      ex.stale = true;
      if (!env.phone) ex.reseat = true;
      stageResized();
      touch();
    }).observe(boardEl);
  }
  applyView();
  // For scripts: `flowstate.board.inClear(id)`, `.buildSpot(x, y, type)`, `.covers()`, `.place()`, `.frameBoxes(boxes, readable)`
  // (main.ts builds window.flowstate after the modules have started).
  const attach = () => {
    const hook = (window as unknown as { flowstate?: Record<string, unknown> }).flowstate;
    if (!hook) return false;
    hook.board ??= {
      inClear: (id: number) => nodeInClear(id), expand: () => ({ ...ex, now: performance.now() }),
      // Where a card of this type built at a board point would stand (see `buildSpot`), and what covers the stage.
      buildSpot: (x: number, y: number, type: NodeType, recipe?: string) => buildSpot({ x, y }, footprint(type, recipe)),
      // The point a press there is taken to have been meant for (inside the plot, on the stage, under nothing).
      clearPoint: (x: number, y: number) => {
        const sight = sightNow();
        return clearPoint({ x, y }, ui.g.board, sight.view, sight.covers);
      },
      // The build menu's outline while it is open: the spot found for the suggested card, the card on show, the camera.
      site: () => siteState(),
      // Where the menu's suggested card would stand for a point, by the whole rule and with one part of it left out
      // (the wire's share, the other options' room, the camera): to see which part moved a card.
      explain: (x: number, y: number, from: number, port: number) => explainSite({ x, y }, from, port),
      // The outline the menu would show if it were opened from this port at each of these points (see `buildPreview`).
      preview: (from: number, port: number, pts: Pt[], blind = false) => buildPreview(from, port, pts, blind),
      covers: () => coverBoxes(),
      place: () => goalPlace(ui.g),
      frameBoxes: (boxes: Box[], readable = false) => frameBoxes(boxes, readable),
    };
    return true;
  };
  queueMicrotask(() => {
    if (!attach()) setTimeout(attach, 0);
  });
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
function expand(ev?: Event) {
  const g = ui.g;
  if (performance.now() < ex.restUntil || !ex.shown || expandQuiet()) return;
  // (A finger cannot see where the button is going: a tap on it while it slides is a tap meant for the board,
  // unless the finger came down where the button had already been standing: then it was aimed at it.)
  const finger = (ev as PointerEvent | undefined)?.pointerType === 'touch' || (ev as PointerEvent | undefined)?.pointerType === 'pen';
  if (finger && (ex.quietAtDown || (performance.now() - ex.movedAt < MOVE_REST && !ex.aimedAtDown))) return;
  const had = new Set(g.deposits.map((d) => d.id));
  const old = { w: g.board.w, h: g.board.h };
  if (!expandBoard(g)) {
    toast(`Expanding costs <b>${fmt(expansionCost(g))}¢</b>`, 'bad');
    return;
  }
  ex.restUntil = performance.now() + EXPAND_REST;
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
  // (The game's own move: Fit, pressed afterwards, fits. A tap on a card comes back in to the zoom the player had.)
  fitBack = fitAt = null;
  if (t.k < zoomFloor() && now.k >= zoomFloor()) ovFrom = now.k;
  moveView(t.x, t.y, t.k, true, 600);
}

// ---------- Tidy ----------

/** How long the cards take to glide to their new places, in ms. */
const TIDY_MS = 400;
/** Tidy is offered once there is this much on the board to tidy. */
const TIDY_FROM = 6;
let tidyBtn: HTMLButtonElement | null = null;

/**
 * Lay the board out again so that wires are short, cross as little as possible, and nothing overlaps
 * (the layout itself is `tidy` in layout.ts, worked out in a Worker so that a big factory never holds the
 * page up). Drills stay on their deposits. The cards glide to their new places; the camera stays among the
 * cards, where their text can be read, on the part of the factory the player was looking at; one undo puts
 * every card back. Returns false when there is nothing to tidy, true when the work has been started (the
 * answer comes back a moment later; "Already tidy." is said then if the board cannot be bettered).
 */
export function tidyBoard(): boolean {
  const g = ui.g;
  if (!g || !renderedGame || g.nodes.length < 2) return false;
  // Whatever the pointer was in the middle of ends first.
  settleGesture();
  cancelGesture();
  if (tidyJob && tidyJob.g === g) return true;
  // What the player is looking at now: the cards whose middle is in view, and the one nearest the middle of what
  // nothing covers (under the strip, on a wide screen: not the middle of the whole stage, which the strip hangs over).
  const v = viewAhead();
  const f = freeArea();
  const u = uncoveredArea();
  const mx = (u.x0 + u.x1) / 2, my = (u.y0 + u.y1) / 2;
  let centre = -1, near = Infinity;
  const seen = g.nodes.filter((n) => {
    const b = cardBox(n);
    const x = ((b.x0 + b.x1) / 2) * v.k + v.x, y = ((b.y0 + b.y1) / 2) * v.k + v.y;
    const d = (x - mx) ** 2 + (y - my) ** 2;
    if (d < near) {
      near = d;
      centre = n.id;
    }
    return x > f.x0 && x < f.x1 && y > f.y0 && y < f.y1;
  }).map((n) => n.id);
  tidyJob = { id: ++tidySeq, g, rev: g.rev, tries: 0, seen, centre };
  setTidyBusy(true);
  askTidy(tidyJob);
  return true;
}

/** The layout being worked out, and the board it is for (`rev`: as it was when asked). */
interface TidyJob { id: number; g: Game; rev: number; tries: number; seen: number[]; centre: number }
let tidyJob: TidyJob | null = null;
let tidySeq = 0;
/** The Worker that lays boards out: made on first use; null where one cannot be made (then the page does it). */
let layoutWorker: Worker | null | undefined;

function askTidy(job: TidyJob) {
  const input = tidyInput(job.g, GRID);
  if (layoutWorker === undefined) {
    layoutWorker = null;
    if (typeof Worker === 'function') {
      try {
        layoutWorker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
        layoutWorker.onmessage = (e: MessageEvent<{ id: number; moves: [number, Pt][] }>) => tidyAnswer(e.data.id, new Map(e.data.moves));
        // A Worker that fails is not asked again; the job in hand is done on the page.
        layoutWorker.onerror = () => {
          layoutWorker = null;
          const j = tidyJob;
          if (j) askTidy(j);
        };
      } catch {
        layoutWorker = null;
      }
    }
  }
  if (layoutWorker) layoutWorker.postMessage({ id: job.id, input });
  else setTimeout(() => tidyAnswer(job.id, tidy(input)), 0);
}

/** The new places for a board. If the board changed while they were worked out, they are worked out again. */
function tidyAnswer(id: number, moves: Map<number, Pt>) {
  const job = tidyJob;
  if (!job || job.id !== id) return;
  const g = ui.g;
  if (g !== job.g) {
    tidyJob = null;
    setTidyBusy(false);
    return;
  }
  if (g.rev !== job.rev) {
    if (job.tries++ < 2) {
      job.rev = g.rev;
      askTidy(job);
      return;
    }
    tidyJob = null;
    setTidyBusy(false);
    return;
  }
  tidyJob = null;
  setTidyBusy(false);
  // A drag that began while the answer was on its way is let go first.
  settleGesture();
  cancelGesture();
  const from = new Map<number, Pt>();
  for (const [nid] of moves) {
    const n = nodeById(g, nid);
    if (n && n.type !== 'well') from.set(nid, { x: n.x, y: n.y });
  }
  if (!from.size) {
    toast('Already tidy.', 'info');
    return;
  }
  act(g, () => {
    for (const [nid] of from) {
      const n = nodeById(g, nid)!;
      const to = moves.get(nid)!;
      n.x = to.x;
      n.y = to.y;
    }
    return 0;
  });
  for (const [nid, was] of from) {
    const to = moves.get(nid)!;
    settleFrom(nid, was.x - to.x, was.y - to.y, TIDY_MS);
  }
  // The camera: on the cards the player was looking at (all of them, if none was in view), where they
  // stand now, at a zoom where card text is drawn, never further in than before.
  let box: Box | null = null;
  for (const nid of job.seen.length ? job.seen : g.nodes.map((n) => n.id)) {
    const n = nodeById(g, nid);
    if (n) box = boxUnion(box, cardBox(n));
  }
  if (!box) return;
  const now = viewAhead();
  const floor = zoomFloor();
  const kMax = now.k >= floor ? Math.max(floor, Math.min(1, now.k)) : 1;
  let t = fitTarget(box, true, kMax);
  // A card that frame would cut at the edge of the stage (or leave half under the strip or the corner controls) is
  // taken in too, while everything still fits whole at a readable zoom: a column cut at the edge reads as a column
  // under the build bar. (Three rounds at most: each can only add cards.)
  const covers = coverBoxes();
  const whole = (n: GNode, v: View) => inClear(onStage(cardBox(n), v), covers);
  // (One card at a time, nearest the frame first; a card that does not fit with the rest is left out.)
  const tried = new Set<number>();
  for (let round = 0; round < 3; round++) {
    const r = rectOf();
    const cut = g.nodes.filter((n) => {
      const b = onStage(cardBox(n), t);
      return !tried.has(n.id) && b.x1 > 0 && b.x0 < r.width && b.y1 > 0 && b.y0 < r.height && !whole(n, t);
    });
    if (!cut.length) break;
    const mid = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    cut.sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y));
    for (const n of cut) {
      tried.add(n.id);
      const more = boxUnion(box, cardBox(n));
      const next = fitTarget(more, true, kMax);
      const inside = g.nodes.filter((m) => { const b = cardBox(m); return b.x0 >= more.x0 && b.x1 <= more.x1 && b.y0 >= more.y0 && b.y1 <= more.y1; });
      if (next.k < floor - 1e-6 || !inside.every((m) => whole(m, next))) continue;
      box = more;
      t = next;
    }
  }
  // Where they have spread too far apart to be seen together at that zoom (a phone, a big board: the two cards
  // in view went to opposite ends, and the camera on the middle of them showed neither), the card the view was
  // centred on stays in view: the least move from there that brings it in, clear of what covers the board.
  const mid = nodeById(g, job.centre);
  if (mid) {
    const b = cardBox(mid), a = inset(uncoveredArea(), 12);
    const x0 = b.x0 * t.k + t.x, x1 = b.x1 * t.k + t.x, y0 = b.y0 * t.k + t.y, y1 = b.y1 * t.k + t.y;
    if (x1 - x0 <= a.x1 - a.x0) t.x += x0 < a.x0 ? a.x0 - x0 : x1 > a.x1 ? a.x1 - x1 : 0;
    if (y1 - y0 <= a.y1 - a.y0) t.y += y0 < a.y0 ? a.y0 - y0 : y1 > a.y1 ? a.y1 - y1 : 0;
  }
  fitBack = fitAt = null;
  moveView(t.x, t.y, t.k, true, TIDY_MS);
  toast(`Tidied. <b>${isTouch() ? 'Undo' : 'Ctrl Z'}</b> puts it back.`, 'good');
}

/** The Tidy buttons say they are working while the layout is worked out. */
function setTidyBusy(on: boolean) {
  for (const b of [tidyBtn, fabsEl?.querySelector('[data-testid="fab-tidy"]')]) if (b) setAttr(b, 'aria-busy', on ? 'true' : null);
}

/**
 * The Tidy button, in the zoom cluster (which the panels build after the board starts, so it is added
 * when the board first draws), at the cluster's far end from Fit. It shows once there is something to tidy.
 */
function syncTidyControl() {
  if (!tidyBtn) {
    const zoom = document.getElementById('zoom');
    if (!zoom || !zoom.firstElementChild) return;
    tidyBtn = el<HTMLButtonElement>(`<button class="ibtn" data-testid="tidy"><svg class="ic" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M3 4.5h6v5H3zM3 14.5h6v5H3zM15 9.5h6v5h-6zM9 7h3v5h3M9 17h3v-5"/></svg></button>`);
    // (At the far end from Fit, so that Fit keeps the place the player has learned.)
    zoom.insertBefore(tidyBtn, zoom.firstChild);
    onPress(tidyBtn, () => void tidyBoard());
  }
  setHidden(tidyBtn, ui.g.nodes.length < TIDY_FROM);
  const label = withKey('Tidy the board', 'T');
  setAttr(tidyBtn, 'aria-label', label);
  setAttr(tidyBtn, 'title', label);
}

/** T tidies, wherever the board's other keys work (main.ts has those): not in a text field, the tech tree or a full-screen card. */
function onTidyKey(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== 't' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (screenOpen() || ui.techOpen || !ui.g || ui.g.nodes.length < TIDY_FROM) return;
  tidyBoard();
}

// ---------- structure: nodes ----------

function recipeText(r: Recipe): string {
  const side = (xs: [MatId, number][]) => xs.map(([m, q]) => `${q > 1 ? q + ' ' : ''}${MATERIALS[m].name}`).join(' + ');
  return `${side(r.inputs)} → ${side(r.outputs)}`;
}

function nodeTitle(n: GNode): string {
  if (n.type === 'well' && n.material) return `${MATERIALS[n.material].name} Drill`;
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

/** Deposits with no Drill on them, as boxes. */
function depositBoxes(): Box[] {
  const g = ui.g;
  const used = new Set(g.nodes.map((n) => n.depositId));
  const out: Box[] = [];
  for (const d of g.deposits) if (!used.has(d.id)) out.push({ x0: d.x, y0: d.y, x1: d.x + 172, y1: d.y + 72 });
  return out;
}

const CHIP_SPOTS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78];
/**
 * Where a chip may stand off its wire when every place on it is taken by another chip (see `layoutWires`): in
 * half-widths across and in heights up and down, never more than a width or two heights away.
 */
const NUDGES: [number, number][] = [];
for (const dx of [0, 0.5, -0.5, 1, -1]) for (const dy of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) if ((dx || dy) && Math.abs(dx) + Math.abs(dy) / 2 <= 1.25) NUDGES.push([dx, dy]);
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
  // Chips on show are placed first, each keeping off those placed before it: two wires leaving the same
  // port (a Router's, with its weights on them) would otherwise put their chips one on top of the other.
  const order = [...wireEls.values()].sort((a, b) => Number(b.shown) - Number(a.shown));
  /** Cards and deposits are the first `fixed` boxes of `avoid`; the chips placed so far come after them. */
  const fixed = avoid.length;
  const clearOf = (p: Pt, hw: number, hh: number, from = 0, to = avoid.length) => {
    for (let i = from; i < to; i++) {
      const b = avoid[i];
      if (p.x + hw > b.x0 && p.x - hw < b.x1 && p.y + hh > b.y0 && p.y - hh < b.y1) return false;
    }
    return true;
  };
  for (const refs of order) {
    const f = refs.flow;
    const hw = Math.max(24, refs.cChip.length * 3.3 + 9) * cs, hh = 11 * cs;
    let spot: Pt | null = null;
    for (const t of CHIP_SPOTS) {
      const p = flowPoint(f, f.len * t);
      if (clearOf(p, hw, hh)) {
        spot = p;
        break;
      }
    }
    // Every place on the wire that no card covers is taken by a chip placed before (a Router's two wires that
    // leave together for takers close by): this chip stands beside its wire there, nudged off the other by up to
    // a chip's width or two of its heights, rather than going missing (the "×1" of a Router favouring its other
    // wire "×3" was dropped). The nearest such place wins; still never over a card or a deposit.
    if (!spot && refs.shown) {
      let best = Infinity;
      for (const t of CHIP_SPOTS) {
        const p = flowPoint(f, f.len * t);
        if (!clearOf(p, hw, hh, 0, fixed)) continue;
        for (const [dx, dy] of NUDGES) {
          const far = dx * dx + dy * dy;
          if (far >= best) continue;
          const q = { x: p.x + dx * hw, y: p.y + dy * (2 * hh + 4) };
          if (!clearOf(q, hw, hh)) continue;
          best = far;
          spot = q;
        }
      }
    }
    if (spot && refs.shown) avoid.push({ x0: spot.x - hw - 3, y0: spot.y - hh - 2, x1: spot.x + hw + 3, y1: spot.y + hh + 2 });
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
  // overview, where ports are small dots beside the icons and a pulse on each would crowd the map.)
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
        <div><div class="dn">${ok ? MATERIALS[d.mat].name + ' deposit' : 'Unknown deposit'}</div><div class="ds">${ok ? (big ? 'place a Drill here' : 'empty · place a Drill') : 'needs research'}</div></div>
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
  syncTidyControl();
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
    // The ring and the border say what diagnose says: a node it finds nothing wrong with (the Phone-only
    // Fabricator between the first Phone and free play, status.ts `resting`) is drawn as working, not amber or red.
    if (!dx.problem && (n.status === 'blocked' || n.status === 'starved')) st = 'working';
    let pill = '';
    // Drills never get a pill: their ring colour says enough.
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
  // While the camera moves (a pan, a pinch, the wheel, a glide), the cards' text is left as it is: each
  // change would repaint the whole board layer under a moving camera, on a slow machine a frame lost. It
  // catches up at the first slow beat after the camera comes to rest. (Called with no argument, it always runs.)
  const still = !part || !cameraMoving();
  if (still && part !== 'wires') updateNodes(g);
  if (still && part !== 'nodes') updateWires(g);
  const cost = expansionCost(g);
  if (cost !== expandCost) {
    expandCost = cost;
    // (Docked in its one-line form, the button shows only the plus, "Expand" and the price: see `.mini`.)
    expandEl.innerHTML = `${icon('plus', 20)}<span><b>Expand<em> board</em> <i class="mono">${fmt(cost)}¢</i></b><small>New plot · reveals deposits</small></span>`;
  }
  setClass(expandEl, 'ok', g.credits >= cost);
  syncHints(g);
  // Whether the goal card is sending the player to it: looked at twice a second at most.
  const now = performance.now();
  if (now - ex.askedAt > 500) {
    ex.askedAt = now;
    ex.asked = expandAsked(g);
  }
  // What the button keeps clear of (the goal card, an open sheet or inspector, toasts...) is measured
  // again when something it depends on may have moved (the ResizeObserver catches size changes), and at
  // least every two seconds: reading layout here costs a full layout of the board after its text changed.
  const key = expandKey(g);
  if (key !== ex.key || now - ex.measuredAt > 2000) {
    ex.key = key;
    ex.stale = true;
  }
  placeExpand();
  if (ui.placing) updateGhost();
  placePlotLabel();
  syncFitControl();
  if (radial) {
    refreshBuildSheet();
    // The board changed under the open menu (an undo by key): its spot is found again, and the outline moves there.
    if (radial.rev !== g.rev) {
      findSite(radial);
      if (radial.site) drawSite();
      else {
        closeRadial();
        toast(NO_ROOM, 'bad');
      }
    }
  }
}

/** The key hints are for the first steps: from this goal on (goal 5 claimed) they are gone. */
const HINTS_UNTIL = GOALS.findIndex((x) => x.id === 'sell-shard') + 1;
/** Where the hint row stands on the stage, as last measured while it showed. */
let hintsBox: Box | null = null;

/** The key-hint row shows for the first five goals, and never over a card. */
function syncHints(g: Game, measure = true) {
  if (!hintsEl) return;
  if (g.goal.i >= HINTS_UNTIL || env.phone) {
    if (setHidden(hintsEl, true)) ex.stale = true;
    return;
  }
  // (Measured on the slow beat only: while the camera moves, the last measurement is used.)
  if (measure && !hintsEl.hidden) hintsBox = stageBoxOf(hintsEl, 6) ?? hintsBox;
  let under = false;
  if (hintsBox) {
    const { x: vx, y: vy, k } = ui.view;
    under = g.nodes.some((n) => {
      const b = cardBox(n);
      return b.x0 * k + vx < hintsBox!.x1 && b.x1 * k + vx > hintsBox!.x0 && b.y0 * k + vy < hintsBox!.y1 && b.y1 * k + vy > hintsBox!.y0;
    });
  }
  if (setHidden(hintsEl, under)) ex.stale = true;
}

/** When the wheel last turned (performance.now). */
let wheelAt = 0;
/** The camera is being moved by the player or is gliding. */
const cameraMoving = () =>
  !!glide || performance.now() - wheelAt < 250 || drag?.kind === 'pinch' || (drag?.kind === 'pan' && drag.moved);

let gainTimer = 0;
/** Under this (items a second) a wire counts as carrying nothing, for its still dots. */
const STILL_MIN = 0.015;
/**
 * What each Market and Lab has earned and not yet floated (always under one unit of each kind): what
 * floats is whole units, and the fractions are kept until they make one (`wholeGain` in geom.ts).
 */
const gainCarry = new Map<number, { c: number; a: number; b: number; g: number }>();
/** The credits colour as the top bar draws it (the stylesheet's --credits), read once. */
let creditsColor = '';
const DATA_TIERS: DataTier[] = ['a', 'b', 'g'];

/**
 * Once a second: float what each Market and Lab earned, in whole units and in the colour of what it is
 * (credits as the top bar's credits, each kind of Data as its counter in the top bar), and send a few
 * coins from each Market towards the credits counter. (The counter itself is not moved here: only the
 * effects layer pops it, as a claim pays out.) Each earning Market also sends the 'sale' signal, every
 * second, with what it earned, whether or not a whole credit floats.
 */
function showGains() {
  const g = ui.g;
  const r = rectOf();
  // Out in the overview a card is only its icon: the figures are drawn small enough to sit beside it.
  const size = ovStep > 0 ? 9 : Math.max(11, Math.min(15, 9 + 5 * ui.view.k));
  if (!creditsColor) creditsColor = getComputedStyle(document.documentElement).getPropertyValue('--credits').trim() || '#FFC857';
  const counter = anchorPt('credits');
  let coins = 6;
  const visible = (p: Pt) => p.x > r.left - 30 && p.x < r.right + 30 && p.y > r.top - 30 && p.y < r.bottom + 30;
  const live = new Set<number>();
  for (const n of g.nodes) {
    if (n.type !== 'market' && n.type !== 'lab') {
      n.gain = 0;
      continue;
    }
    live.add(n.id);
    let carry = gainCarry.get(n.id);
    if (!carry) gainCarry.set(n.id, (carry = { c: 0, a: 0, b: 0, g: 0 }));
    const { w, h } = nodeSize(n);
    const top = toClient({ x: n.x + w / 2 + (Math.random() * 30 - 15), y: n.y - 4 });
    const shown = visible(top) && !ui.techOpen;
    if (n.type === 'market') {
      if (n.gain >= 0.05) signal('sale', { id: n.id, amount: n.gain, at: top });
      const whole = wholeGain(carry.c, n.gain);
      carry.c = whole.carry;
      if (whole.show > 0 && shown) {
        floater(top, `+${shortNum(whole.show, 1000)}¢`, creditsColor, size);
        if (counter && coins > 0) {
          const count = Math.min(coins, whole.show >= 20 ? 3 : whole.show >= 2 ? 2 : 1);
          coins -= count;
          fly(toClient({ x: n.x + 29, y: n.y + h / 2 }), counter, creditsColor, count);
        }
      }
    } else {
      let lift = 0;
      for (const k of DATA_TIERS) {
        const whole = wholeGain(carry[k], n.gainB[k] ?? 0);
        carry[k] = whole.carry;
        if (whole.show <= 0 || !shown) continue;
        // (A Lab making more than one kind of Data floats each in its own colour, one above the other.)
        floater({ x: top.x, y: top.y - lift }, `+${shortNum(whole.show, 1000)}${DATA_NAMES[k]}`, DATA_COLORS[k], size);
        lift += size * 1.5;
      }
      n.gainB = {};
    }
    n.gain = 0;
  }
  for (const id of gainCarry.keys()) if (!live.has(id)) gainCarry.delete(id);
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
  // With less motion asked for, the dots stand still (see `frameFx` below) and show the rate by how
  // densely they lie: each wire's pattern is laid again, evenly, when its rate starts, stops or really
  // changes (`heldRate`), and a wire that carries nothing has no dots at all.
  const calm = env.calm;
  for (const w of g.wires) {
    const refs = wireEls.get(w.id);
    if (!refs) continue;
    if (!calm) {
      refs.flow.rate = w.rate;
      continue;
    }
    const rate = w.rate > STILL_MIN ? w.rate : 0;
    const held = heldRate(refs.flow.rate, rate);
    if (held !== refs.flow.rate || refs.stillK !== ui.view.k) {
      refs.flow.rate = held;
      refs.stillK = ui.view.k;
      // (Laid out cold: evenly along the whole wire, at the spacing this rate has.)
      refs.flow.dots.length = 0;
      refs.flow.cold = true;
      invalidateFx();
    }
  }
  // A wire stopped being new: its chip goes, and it may dim with the rest.
  if (freshUntil && performance.now() >= freshUntil && syncChips()) layoutWires();
  if (glide) stepGlide(dt);
  if (ex.slide) drawExpand();
  // A docked button left where it was while its surroundings settled takes its new place once they have.
  else if (ex.settling && performance.now() - ex.aroundAt >= SETTLE_MS) placeExpand();
  // While a port is armed, a wire drawn, a card placed or the build menu open, the button stands back in
  // either form (faint, and a press goes through it to the board): that tap is not meant for a new plot.
  setClass(expandEl, 'quiet', expandQuiet());
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
  // The tech tree, the start screen and the time-away card cover the whole board, so wire dots are not drawn
  // behind them, and they do not run on either: when the card goes they pick up where they were (fx.ts frameBoard).
  // The summary does not count: it is a card at the foot of the screen (a sheet on a phone) with the factory
  // framed above it and running, the picture the demo ends on. With less motion asked for, the dots do not
  // travel: the effects layer is told the board is paused (particles still run).
  const covered = ui.techOpen || !isStarted() || !!modalEl?.classList.contains('open');
  frameFx(dt, ui.view, g.paused || calm, covered);
}

// ---------- placement ----------

function clampToBoard(x: number, y: number, w: number, h: number): Pt {
  const b = ui.g.board;
  return { x: snap(Math.max(20, Math.min(b.w - w - 20, x))), y: snap(Math.max(20, Math.min(b.h - h - 20, y))) };
}

/**
 * Where a w×h card wanted at (x, y) may stand: the nearest spot on the grid that keeps clear of every
 * other card and of every deposit with no Drill on it (the rule itself is `freeSpot` in geom.ts, where
 * it is tested). `skip` is the node being moved, if any; `room` is the height to keep clear for it (see
 * roomFor). Null when the plot is full. (For a card the player moves by hand; one the game builds where the
 * player chose goes by `buildSpot`.)
 */
function freeSpot(x: number, y: number, w: number, h: number, skip?: number, room = h): Pt | null {
  return nearestSpot({ x, y, w, h: room, avoid: nodeBoxes(skip, true).concat(depositBoxes()), board: ui.g.board, grid: GRID });
}

/** A card of this type and recipe as the placement rule sees it: its size, and the height to keep clear for it. */
function footprint(type: NodeType, recipe?: string | null): Footprint {
  const { w, h } = sizeFor(type, recipe);
  return { w, h, room: roomFor(type, h) };
}

/** What the placement rule knows of the camera: the part of the board on the stage, and what covers the stage there (board units). */
interface Sight { view: Box | null; covers: Box[]; hidden?: Box[] }

/** The width the inspector takes from the stage's right side when it opens beside the board (style.css, `#insp`). */
const INSPECT_W = 320;

/**
 * The stage, and what lies over it, as the board stands under the camera now (or where the camera is going). Where
 * a card that is built gets selected (see `built`), the inspector then opens over the stage's right side, and the
 * corner controls move in with it: a card there could not be seen once it is built (`hidden`), though a point there
 * is as good a point to choose as any.
 */
function sightNow(): Sight {
  const r = rectOf();
  if (r.width < 2 || r.height < 2) return { view: null, covers: [] };
  const v = viewAhead();
  const toBoard = (b: Box): Box => ({ x0: (b.x0 - v.x) / v.k, y0: (b.y0 - v.y) / v.k, x1: (b.x1 - v.x) / v.k, y1: (b.y1 - v.y) / v.k });
  const hidden: Box[] = [];
  if (selectsBuilt() && !document.getElementById('insp')?.classList.contains('open') && r.width > 2 * INSPECT_W) {
    hidden.push({ x0: r.width - INSPECT_W, y0: -1e6, x1: 1e6, y1: 1e6 });
    const c = env.corner();
    if (c) hidden.push({ x0: c.x0 - INSPECT_W, y0: c.y0, x1: 1e6, y1: 1e6 });
  }
  return { view: toBoard({ x0: 0, y0: 0, x1: r.width, y1: r.height }), covers: coverBoxes(FAB_CLEAR, false).map(toBoard), hidden: hidden.map(toBoard) };
}

/**
 * Where a card built at a point the player chose stands (its top left corner), or null when the plot is full. The
 * rule is `buildSite` in geom.ts, where it is tested: centred on the point when the card has room there; otherwise
 * the nearest spot that has, measured from the point (or, for a point outside the plot or under something that
 * covers the stage, from the nearest point inside and clear); in view and uncovered when any such spot is; and a
 * point the rule gave is accepted as it stands. `wire`: the port the card will be wired from, or to. `sight`: the
 * camera the spot is found for (as it is now, unless given).
 */
function buildSpot(at: Pt, card: Footprint, opts: { wire?: { from?: Pt; to?: Pt }; sight?: Sight } = {}): Pt | null {
  const sight = opts.sight ?? sightNow();
  return buildSite({
    at, card, wire: opts.wire, cards: nodeBoxes(undefined, true), deposits: depositBoxes(), board: ui.g.board, grid: GRID,
    view: sight.view, covers: sight.covers, hidden: sight.hidden,
  });
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

/** Size a node of this type and recipe will have once placed. */
const sizeFor = (type: NodeType, recipe?: string | null) => nodeSize({ type, recipe: recipe ?? null } as GNode);

/** The deposit with no Drill on it under a world point, if any. */
function depositAt(p: Pt) {
  const used = new Set(ui.g.nodes.map((n) => n.depositId));
  return ui.g.deposits.find((d) => !used.has(d.id) && p.x >= d.x && p.x <= d.x + 172 && p.y >= d.y && p.y <= d.y + 72) ?? null;
}

/**
 * A tap on an empty deposit: a Drill is taken up for it (as from the build bar), its ghost already on that
 * deposit, so that one more tap there places it. A deposit not yet researched says what it needs. Returns
 * false when the tap was not on an empty deposit.
 */
function tapDeposit(p: Pt): boolean {
  const g = ui.g;
  const d = depositAt(p);
  if (!d) return false;
  if (!matUnlocked(g, d.mat)) {
    toast(isTouch() ? 'Research this deposit first (tap <b>Tech</b>), then put a Drill on it.' : 'Research this deposit in the <b>Tech tree</b> first, then put a Drill on it.', 'info');
    return true;
  }
  if (ui.sel) select(null);
  startPlacing('well', null, d.id);
  return true;
}

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
    setHidden(ghostCap, true);
    capFor = null;
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
      label = `${MATERIALS[d.mat].name} Drill`;
      onDeposit = true;
    } else {
      pos = clampToBoard(mouse.x - w / 2, mouse.y - h / 2, w, h);
      ok = false;
      label = 'No free deposit';
      why = 'expand the board';
    }
  } else {
    // The ghost stands where the card would go: on the pointer, or the nearest spot with air round it.
    const spot = buildSpot(mouse, footprint(p.type, p.recipe));
    pos = spot ?? clampToBoard(mouse.x - w / 2, mouse.y - h / 2, w, h);
    if (!spot) {
      ok = false;
      why = 'no room: expand the board';
    }
  }
  // On a deposit the ghost is only an outline, so the deposit's own label stays readable; and in the overview, where
  // nothing drawn at the board's scale can be read. Its words then stand beside it on the stage (`placeGhostCap`).
  const bare = onDeposit || over;
  setStyle(ghostEl, 'display', 'flex');
  setStyle(ghostEl, 'left', pos.x + 'px');
  setStyle(ghostEl, 'top', pos.y + 'px');
  setStyle(ghostEl, 'width', w + 'px');
  setStyle(ghostEl, 'height', h + 'px');
  setClass(ghostEl, 'bad', !ok);
  setClass(ghostEl, 'outline', bare);
  const hint = ok ? `${fmt(cost)}¢ · ${pressWord()} to place` : why;
  // In the phone layout a line above the hotbar already says "tap the board to place": the card itself has room for
  // the price only at that type size. The same under 100% elsewhere, where the ghost is set in the larger type too.
  const brief = ok && (env.phone || big) ? `${fmt(cost)}¢` : hint;
  setHTML(ghostEl, bare ? '' : `${nodeIcon(p.type, 20)}<span>${label}<small class="mono">${brief}</small></span>`);
  setHidden(ghostCap, !bare);
  setClass(ghostCap, 'bad', !ok);
  if (bare) {
    if (setHTML(ghostCap, `${nodeIcon(p.type, 15)}${label} · <span class="mono">${hint}</span>`)) capSize = null;
    capFor = { x0: pos.x, y0: pos.y, x1: pos.x + w, y1: pos.y + h };
    placeGhostCap();
  } else capFor = null;
}

/** The ghost the words belong to (board units), their size on the stage once measured, and what covers the stage (looked at now and then). */
let capFor: Box | null = null;
let capSize: { w: number; h: number } | null = null;
let capCovers: { at: number; boxes: Box[] } | null = null;

/**
 * Put the words of the card in hand ("Quartz Drill · 31¢ · tap to place") beside its ghost, on the stage: the same
 * size at every zoom (drawn at the board's scale they were 3 px tall in the overview), under the ghost when that
 * is clear of the goal card, the build bar and the floating controls, else above it, else as near as is clear.
 */
function placeGhostCap() {
  const b = capFor;
  if (!b || !ui.placing) return;
  capSize ??= { w: ghostCap.offsetWidth, h: ghostCap.offsetHeight };
  const now = performance.now();
  if (!capCovers || now - capCovers.at > 400) capCovers = { at: now, boxes: coverBoxes(4, false) };
  const { w, h } = capSize;
  const r = rectOf();
  const s = onStage(b, ui.view);
  const mid = (s.x0 + s.x1) / 2;
  const x = Math.max(6, Math.min(r.width - w - 6, mid - w / 2));
  const clear = (y: number) => y >= 4 && y + h <= r.height - 4 && !capCovers!.boxes.some((c) => x < c.x1 && x + w > c.x0 && y < c.y1 && y + h > c.y0);
  let y = s.y1 + 7;
  if (!clear(y)) {
    const above = s.y0 - 7 - h;
    if (clear(above)) y = above;
    else {
      // Neither: inside what the player can see, as near under the ghost as that allows.
      const f = env.phone ? freeArea(true) : uncoveredArea();
      y = Math.max(f.y0 + 6, Math.min(f.y1 - h - 6, y));
    }
  }
  setStyle(ghostCap, 'transform', `translate(${Math.round(x)}px, ${Math.round(y)}px)`);
}

export function startPlacing(type: NodeType, recipe?: string | null, deposit?: number) {
  const g = ui.g;
  if (!nodeUnlocked(g, type)) return;
  if (ui.placing?.type === type && deposit == null) {
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
  if (type === 'well') showDeposits(deposit);
  touch();
}

/**
 * A Drill has been taken up: the free deposits it can stand on are brought into view (as little as the
 * camera can move; nothing moves when they are all in view already), and a finger's ghost starts on the
 * one that matters most: the deposit tapped, else one whose material has no Drill yet, nearest first.
 */
function showDeposits(tapped?: number) {
  const g = ui.g;
  const used = new Set(g.nodes.map((n) => n.depositId));
  const have = new Set(g.nodes.filter((n) => n.type === 'well').map((n) => n.material));
  const v = viewAhead();
  const r = rectOf();
  const mid = { x: (r.width / 2 - v.x) / v.k, y: (r.height / 2 - v.y) / v.k };
  const free = g.deposits.filter((d) => !used.has(d.id) && matUnlocked(g, d.mat));
  if (!free.length) return;
  const far = (d: (typeof free)[number]) => Math.hypot(d.x + 86 - mid.x, d.y + 36 - mid.y);
  // (The one that matters most goes last: a set too big to show at once shows that one.)
  free.sort((a, b) => (a.id === tapped ? 1 : 0) - (b.id === tapped ? 1 : 0) || Number(!have.has(a.mat)) - Number(!have.has(b.mat)) || far(b) - far(a));
  const best = free[free.length - 1];
  if (tapped == null) frameBoxes(free.map((d) => ({ x0: d.x - 6, y0: d.y - 6, x1: d.x + 178, y1: d.y + 78 })));
  if (env.touch || tapped != null) mouse = { x: best.x + 86, y: best.y + 36 };
}

/** The first goal that needs the inspector ("Speed up a Drill"). */
const INSPECT_FROM = GOALS.findIndex((x) => x.id === 'upgrade-well');

/** A stage this wide (with the inspector's room counted in) has space for the inspector beside the board. */
const INSPECT_WIDE = 1200;

/**
 * A node has just been built. With a mouse on a wide stage it is selected, which opens the inspector
 * beside the board: but not before the first goal that needs the inspector, because a panel that opens
 * after every build makes the board jump just as a newcomer is finding their feet. Under a finger, or on
 * a stage narrower than INSPECT_WIDE, the inspector would cover the part of the board the player is
 * working on (half of it on a phone), so nothing is selected; on a phone the selection is dropped.
 * The camera moves only if the new node cannot be seen whole, and then as little as it can.
 */
function built(id: number) {
  if (env.phone) {
    if (ui.sel) select(null);
  } else if (selectsBuilt()) select({ kind: 'node', id });
  frameNodes([id]);
}

/** A card that is built now gets selected (see `built`). */
const selectsBuilt = () => !env.phone && ui.g.goal.i >= INSPECT_FROM && roomToInspect();

/** A mouse, and a stage wide enough for the inspector beside it (see INSPECT_WIDE). */
function roomToInspect(): boolean {
  if (isTouch() || env.phone) return false;
  return !narrowStage();
}

/** The stage, with the inspector's room counted in, is narrower than INSPECT_WIDE (a phone, a tablet, a small window). */
function narrowStage(): boolean {
  if (env.phone) return true;
  const insp = document.getElementById('insp');
  const open = insp?.classList.contains('open') ? insp.offsetWidth : 0;
  return boardEl.offsetWidth + open < INSPECT_WIDE;
}

/**
 * On a narrow stage the inspector covers much of the board (half of it on a phone, 320 px of a tablet's 768): it
 * closes when the player starts on something else there, a port armed for a wire or the next goal. (A wide stage
 * keeps it open beside the board, where it is in nobody's way.)
 */
function makeRoom() {
  if (ui.sel && narrowStage()) select(null);
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
    const pos = buildSpot(p, footprint(pl.type, pl.recipe));
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

/** A mouse letting go of a wire takes a node only over its card or this close (screen px) to one of its ports. */
const PORT_SNAP_PX = 12;

/**
 * Where a wire let go by a mouse attaches: the card under the pointer, or a card one of whose `side`
 * ports (inputs for a wire drawn from an output, outputs for one drawn back from an input) is within
 * PORT_SNAP_PX. A mouse points exactly: a release near a card, but not over it, is a release on empty
 * board (which opens the build menu), never a wire into that card.
 */
function snapExact(p: Pt, ok: (n: GNode) => boolean, side: 'in' | 'out'): GNode | null {
  // (In the overview a card is its icon, which can stand out past the card at the furthest steps, and its ports
  // are dots beside it: see `ovDot`.)
  const on = nodeAt(p) ?? (over ? iconUnder(p) : null);
  if (on) return ok(on) ? on : null;
  const g = ui.g;
  let best: GNode | null = null;
  let bestD = PORT_SNAP_PX / ui.view.k;
  for (const n of g.nodes) {
    if (!ok(n)) continue;
    for (const port of side === 'in' ? inPorts(n) : outPorts(g, n)) {
      const q = over ? ovDot(n, port, side) : port;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
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
    // (See `tapTarget`: a card lit up for a finger answers a tap on whatever shows of it.)
    if (can && !quiet) refs.el.addEventListener('click', tapTarget);
    else refs.el.removeEventListener('click', tapTarget);
    marked.add(n.id);
  }
}

/**
 * A card lit up as a possible end of the wire carries this listener, which does nothing. A browser moves a tap
 * that lands beside a control on to the control (the goal card is one), and counts only elements that listen for
 * clicks as things a tap can be meant for: the board hears presses, not clicks, so a tap on the strip of a card that
 * showed under the goal card went to the goal card. With the listener, a tap on the card is a tap on the card.
 */
function tapTarget() {}

function clearMarks() {
  if (!markedFor) return;
  markedFor = null;
  boardEl.classList.remove('arming', 'marking');
  for (const id of marked) {
    const e = nodeEls.get(id)?.el;
    e?.classList.remove('can', 'cant');
    e?.removeEventListener('click', tapTarget);
  }
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
  // The player is choosing a target now: on a narrow stage the inspector would sit over the board (see `makeRoom`).
  if (ui.sel && narrowStage()) select(null);
  else touch();
}

// ----- the far end of a wire armed by a tap -----
// A finger cannot drag a wire past the edge of the screen, and on a phone the two ends of a wire seldom fit on it
// together. So once a finger has armed a port, the camera may bring the other end into view, at once (a move that
// came later would take the target from under a finger already on its way to it). It moves only when the player
// could not tap what they are looking for as things stand:
//  - never when the card asks for something to be built from this port: the player is about to tap an empty spot;
//  - on a phone, where the strip hides a third of the board, the far end the card names (the node "Show me" acted
//    the wire out to, the line's wire, or the node the goal is about) comes first: the camera moves when that node
//    cannot be tapped, whatever else could be;
//  - otherwise only when no end at all can be tapped.
// It then frames the armed port together with the end the card names, or else the nearest Market (where most wires
// go), or else the nearest end: at a readable zoom when the two fit there, and otherwise out in the overview, where
// both can still be tapped. Every move keeps clear of the strip, a sheet and the floating controls (`frameNodes`).
// Never while a finger is down, and never for a mouse (it can hover, and pan with a drag).

/** The wire "Show me" last acted out (the 'showme' signal), if it was a wire. */
let shownWire: { from: number; to: number; port?: number } | null = null;

/**
 * What lies over the board where a finger cannot tap, in stage pixels: `coverBoxes`, with the floating buttons as
 * they are drawn (no room round them).
 */
const tapCovers = () => coverBoxes(0);

/** A finger needs this much of a card clear, each way, to tap it (screen px). */
const TAP_ROOM = 44;

/**
 * Enough of this card can be seen and tapped from view `v`: a part of it at least TAP_ROOM by TAP_ROOM on screen
 * (its whole width or height, where the card is drawn smaller than that) lies on the stage, under nothing in
 * `covers`. (A Market whose bottom 20 px showed under the goal card counted as in view, and could not be tapped.)
 */
function reachable(n: GNode, covers: Box[], v: View = viewAhead()): boolean {
  const { w, h } = nodeSize(n);
  const r = rectOf();
  const x0 = Math.max(0, n.x * v.k + v.x), y0 = Math.max(0, n.y * v.k + v.y);
  const x1 = Math.min(r.width, (n.x + w) * v.k + v.x), y1 = Math.min(r.height, (n.y + h) * v.k + v.y);
  const needW = Math.min(TAP_ROOM, w * v.k), needH = Math.min(TAP_ROOM, h * v.k);
  if (x1 - x0 < needW - 0.5 || y1 - y0 < needH - 0.5) return false;
  // A clear part of that size can always be slid left and up until it meets the card's own side or a cover's.
  const xs = [x0], ys = [y0];
  for (const c of covers) {
    if (c.x1 > x0 && c.x1 < x1) xs.push(c.x1);
    if (c.y1 > y0 && c.y1 < y1) ys.push(c.y1);
  }
  for (const ax of xs) {
    for (const ay of ys) {
      if (ax + needW > x1 + 0.5 || ay + needH > y1 + 0.5) continue;
      if (!covers.some((c) => ax < c.x1 - 0.5 && ax + needW > c.x0 + 0.5 && ay < c.y1 - 0.5 && ay + needH > c.y0 + 0.5)) return true;
    }
  }
  return false;
}

/**
 * The far end the card names for a wire from this port, if any: the node "Show me" acted this wire out to, the far
 * end of the line's next wire, or, when the goal is about this port's node (goalFocus), the first other node it is
 * about that the wire can go to ("Sell your Sand", "...wire it to the Market").
 */
function namedEnd(g: Game, from: number, port: number): GNode | null {
  const end = (id: number | undefined) => {
    const n = id == null || id === from ? null : nodeById(g, id);
    return n && wireOk(g, from, port, n.id) ? n : null;
  };
  const sw = shownWire;
  const shown = sw && sw.from === from && (sw.port == null || sw.port === port) ? end(sw.to) : null;
  if (shown) return shown;
  const step = lineAdvice(g);
  const line = step?.wire && step.wire.from === from && (step.wire.port ?? 0) === port ? end(step.wire.to) : null;
  if (line) return line;
  const focus = goalFocus(g);
  if (!focus.includes(from)) return null;
  for (const id of focus) {
    const n = end(id);
    if (n) return n;
  }
  return null;
}

/** The card asks for something to be built from this port, and the build menu from it offers that: see `wantedType`. */
function buildsFrom(g: Game, from: number, port: number): boolean {
  const want = wantedType(g, from);
  return !!want && consumeOptions(g, materialsAt(g, from, port)).some((o) => o.type === want && !o.locked);
}

/** A port has just been armed by a tap: bring its wire's far end into view, when the player could not tap it otherwise (see above). */
function followArmed(touchy: boolean) {
  const g = ui.g;
  const t = tapWire;
  if (!t || !touchy || fingers.size > 0) return;
  const src = nodeById(g, t.from);
  if (!src || buildsFrom(g, t.from, t.port)) return;
  const can = g.nodes.filter((n) => n.id !== t.from && wireOk(g, t.from, t.port, n.id));
  if (!can.length) return;
  const covers = tapCovers();
  const named = namedEnd(g, t.from, t.port);
  if (named && env.phone) {
    if (!reachable(named, covers)) frameTogether(src, named);
    return;
  }
  if (can.some((n) => reachable(n, covers))) return;
  const d = (n: GNode) => Math.hypot(n.x - src.x, n.y - src.y);
  const markets = can.filter((n) => n.type === 'market');
  frameTogether(src, named ?? (markets.length ? markets : can).reduce((a, b) => (d(b) < d(a) ? b : a)));
}

/**
 * Frame two cards together: at a readable zoom when they fit there (the least move, see `frameNodes`), otherwise in
 * the overview, as far out as it takes. From the overview the zoom is kept when they fit at it.
 */
function frameTogether(a: GNode, b: GNode) {
  frameBoth([cardBox(a), cardBox(b)], !over);
}

/**
 * The same for world boxes (the two ends of a gesture: a card, and the empty spot a card is to be built on): all of
 * them at a readable zoom when they fit there, by the least move; otherwise in the overview, as far out as it takes.
 * `readable`: from the overview the camera comes back in among the cards when they fit there (false keeps its zoom).
 */
export function frameBoth(boxes: Box[], readable = true) {
  let plan = framePlan(boxes, readable, { hintRoom: true });
  if (!plan.all) plan = framePlan(boxes, false, { least: ZOOM.least, hintRoom: true });
  if (plan.view && !sameView(plan.view, viewAhead())) moveView(plan.view.x, plan.view.y, plan.view.k, true, FRAME_MS);
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
  // The camera moves only if the wire's far end cannot be seen whole, and then as little as it can.
  frameNodes([target]);
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
  const near = t.hover ? snapExact(p, (n) => wireOk(g, t.from, t.port, n.id), 'in') : snapTarget(p, (n) => wireOk(g, t.from, t.port, n.id), TAP_SNAP_PX);
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

/**
 * A mouse points exactly, so what it pressed is what the browser says it pressed. In the overview the ports are
 * small dots beside the icons, found by distance instead (see `ovPortAt`), and wires cannot be picked.
 */
function mouseHit(t: HTMLElement, p: Pt): Hit {
  const nodeEl = t.closest<HTMLElement>('.node');
  if (over) {
    const port = ovPortAt(p, OV_PORT_MOUSE, true);
    if (port) return port;
    return nodeEl ? { kind: 'node', id: iconAt(p)?.id ?? Number(nodeEl.dataset.id) } : null;
  }
  if (nodeEl) {
    const id = Number(nodeEl.dataset.id);
    const portOut = t.closest<HTMLElement>('.port.out');
    if (portOut) return { kind: 'out', id, port: Number(portOut.dataset.out) };
    const portIn = t.closest<HTMLElement>('.port.in');
    if (portIn) return { kind: 'in', id, port: Number(portIn.dataset.in), mat: (portIn.dataset.mat as MatId) ?? null };
    return { kind: 'node', id };
  }
  // (A free deposit lies above the wires that cross it, and with a port armed a click on a wire is a click on the
  // board under it, as for a finger: see `touchHit`.)
  const wireEl = (t as Element).closest?.('g.wire') as SVGGElement | null;
  if (wireEl && !tapWire && !depositAt(p)) return { kind: 'wire', id: Number(wireEl.dataset.id) };
  return null;
}

/**
 * A finger does not: ports are 14 px dots and wires a few pixels wide, and the browser reports a
 * touch as landing on whatever interesting thing is near it, not on what is under it. So a touch is
 * matched by distance on screen, whatever the zoom. In order: a port right under the finger, the card
 * under the finger, a wire within reach (unless the finger is right beside a port and the wire is a
 * long one), the nearest output port within reach, a card the finger just missed.
 *
 * (The port's reach comes before the near miss of a card: a tap a little to the right of a Drill's
 * port is a tap for the port, not for the Drill.)
 *
 * Only the first of those starts a wire when the finger drags. The gaps between cards are where
 * a thumb goes to pan, and they are full of wires and within reach of ports: a drag that starts
 * there pans, and only a tap there selects the wire or arms the port.
 *
 * In the overview there are no wires to aim at, and the ports are dots beside the icons: a touch is on an output
 * port's dot (see `ovPortAt`), on a card, or on nothing.
 */
function touchHit(p: Pt): Hit {
  const g = ui.g;
  const k = ui.view.k;
  if (over) {
    const port = ovPortAt(p, OV_PORT_FINGER, false);
    if (port) return port;
    const n = iconAt(p) ?? nodeAt(p) ?? cardNear(p, CARD_NEAR / k);
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
  // A free deposit lies above the wires that cross it: a tap there is for the deposit (see `tapDeposit`).
  if (depositAt(p)) return null;
  // A wire comes before the wider reach of a port: every wire starts at one, and a short wire
  // would otherwise have nowhere left to be tapped (and so could never be cut). Right beside the
  // port, though, a tap is for the port: a long wire can be tapped further along. With a port armed a
  // wire is not something to tap at all: a tap on one is a tap on the board under it (see `tapEmpty`).
  const w = tapWire ? null : wireNear(p, WIRE_REACH / k);
  if (w && !(out && dOut <= PORT_EDGE && (wireEls.get(w.id)?.flow.len ?? 0) * k >= WIRE_LONG)) return { kind: 'wire', id: w.id };
  if (out && dOut <= PORT_REACH) return { kind: 'reach', ...out };
  const near = cardNear(p, CARD_NEAR / k);
  return near ? { kind: 'node', id: near.id } : null;
}

/**
 * In the overview a card is drawn as its icon, in the middle of the card and larger than the card's own
 * ring (by --ovs): the icon whose middle is nearest a world point, within its drawn size plus a finger's
 * margin. (The icon can stand out past the card's box, and icons of neighbouring cards come close.)
 */
function iconAt(p: Pt): GNode | null {
  const scale = OV_ICON[ovStep] ?? 1;
  const reach = 20 * scale + 8 / ui.view.k;
  let best: GNode | null = null;
  let bestD = reach;
  for (const n of ui.g.nodes) {
    const { w, h } = nodeSize(n);
    const d = Math.hypot(n.x + w / 2 - p.x, n.y + h / 2 - p.y);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

/** In the overview, the card whose icon, as drawn, covers a world point (no margin). */
function iconUnder(p: Pt): GNode | null {
  const r = 20 * (OV_ICON[ovStep] ?? 1);
  for (const n of ui.g.nodes) {
    const { w, h } = nodeSize(n);
    if (Math.hypot(n.x + w / 2 - p.x, n.y + h / 2 - p.y) <= r) return n;
  }
  return null;
}

/** Where a port's dot is drawn in the overview, in board units: at the card's side, pushed out at the furthest steps (OV_PORT_OUT). */
function ovDot(n: GNode, q: Port, side: 'in' | 'out'): Pt {
  const off = (OV_PORT_OUT[ovStep] ?? [0, 0])[nodeSize(n).w < 160 ? 1 : 0];
  return { x: side === 'out' ? q.x + 1 + off : q.x - 1 - off, y: q.y };
}

/**
 * In the overview: the port whose dot is nearest a world point, within `reach` screen px; output ports, and with
 * `ins` input ports too. A point on a card's icon is for the card (a press there comes back in to it), unless it
 * is on the dot itself: the dots are drawn above the icons, and far out a neighbour's icon can reach one. With a
 * port armed, the ports of the cards its wire can go to do not count: a press beside one is for that card.
 */
function ovPortAt(p: Pt, reach: number, ins: boolean): Hit {
  const g = ui.g;
  const k = ui.view.k;
  const t = tapWire;
  const end = (n: GNode) => !!t && n.id !== t.from && wireOk(g, t.from, t.port, n.id);
  const far = reach / k + 60;
  let best: Hit = null;
  let bestD = reach;
  for (const n of g.nodes) {
    const { w, h } = nodeSize(n);
    if (p.x < n.x - far || p.x > n.x + w + far || p.y < n.y - far || p.y > n.y + h + far || end(n)) continue;
    for (const q of outPorts(g, n)) {
      const d = ovDot(n, q, 'out');
      const dist = Math.hypot(d.x - p.x, d.y - p.y) * k;
      if (dist < bestD) {
        bestD = dist;
        best = { kind: 'out', id: n.id, port: q.index };
      }
    }
    if (!ins) continue;
    for (const q of inPorts(n)) {
      const d = ovDot(n, q, 'in');
      const dist = Math.hypot(d.x - p.x, d.y - p.y) * k;
      if (dist < bestD) {
        bestD = dist;
        best = { kind: 'in', id: n.id, port: q.index, mat: q.mat };
      }
    }
  }
  // (A dot is 14 board px across, scaled with the icons; a few px round it still count as on it.)
  const onDot = bestD <= 7 * (OV_ICON[ovStep] ?? 1) * k + 3;
  return best && (onDot || !iconUnder(p)) ? best : null;
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
  // A wire dragged out is a port armed as much as one tapped: on a narrow stage the inspector closes (see `makeRoom`).
  makeRoom();
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
  // (A finger on the Expand button still counts towards a pinch: docked, the button may stand in the middle
  // of a small screen, and a pinch that starts on it must still move the camera. A tap on it stays a press.)
  if (e.pointerType === 'touch' && !t.closest('#radial')) {
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
  const hit = touchy ? touchHit(p) : mouseHit(t, p);
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
      const tn = snapExact(p, (n) => wireOk(g, t.from, t.port, n.id), 'in');
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
      // A finger that drags across a card while a port waits for its target, or out in the overview where
      // cards are small icons close together, moves the board, not the card.
      if (drag.slop >= TOUCH_SLOP && (tapWire || over)) {
        drag = { kind: 'pan', sx: cx, sy: cy, vx: ui.view.x, vy: ui.view.y, moved: true, slop: 0, place: false };
        break;
      }
      if (n.type === 'well') {
        // A Drill stays on its deposit. Under a finger the drag pans the board instead, so that a
        // swipe that happens to start on a Drill still goes somewhere; so does a mouse in the overview,
        // where a drag that let go would otherwise count as a click on the Drill and take the camera in to it.
        if (drag.slop >= TOUCH_SLOP || over) drag = { kind: 'pan', sx: cx, sy: cy, vx: ui.view.x, vy: ui.view.y, moved: true, slop: 0, place: false };
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
      if (!d.armed && Math.hypot(cx - d.sx, cy - d.sy) > d.slop) {
        // Out in the overview a finger's drag moves the board wherever it starts, as it does across a card there
        // (the port dots stand close together): a dot is armed by a tap, and the wire ends with a tap on a target.
        if (d.touch && over) {
          boardEl.classList.remove('wiring');
          drag = { kind: 'pan', sx: cx, sy: cy, vx: ui.view.x, vy: ui.view.y, moved: true, slop: 0, place: false };
          break;
        }
        wireUnderWay(d);
      }
      const can = (n: GNode) => wireOk(g, d.from, d.port, n.id);
      const tn = !d.armed ? null : d.touch ? snapTarget(p, can) : snapExact(p, can, 'in');
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
        makeRoom();
      }
      const can = (n: GNode) => !isSink(n) && n.id !== d.to && !noUse(g, n.id, portFor(n, d.mat), d.to);
      const sn = !d.armed ? null : d.slop >= TOUCH_SLOP ? snapTarget(p, can) : snapExact(p, can, 'out');
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
        followArmed(e.pointerType !== 'mouse');
        return;
      } else if (tapDeposit(p)) {
        endDrag();
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
          followArmed(e.pointerType !== 'mouse');
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
        if (!opts.length) toast(d.mat ? `Nothing you have unlocked makes ${MATERIALS[d.mat].name}. Wire a Drill to it.` : isTouch() ? 'Start from an output port instead' : 'Drag from an output port instead', 'bad');
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

/**
 * The kind of node the card is asking the player to build right now, if any: the next step of the goal's
 * "while you wait" line when that is a build, or else what the goal's hint says to pick or to build
 * ("…and pick Lab", "Build a Router from…"), for as long as the goal still needs one built: while what it is
 * buying next (Goal.step) is that kind. Once the Router of "Route more to a Lab…" stands, the card is about
 * wiring it, and a menu opened from its own port must not offer a second Router first. The build menu puts it
 * first and preselects it.
 */
function wantedType(g: Game, from?: number): NodeType | null {
  const step = lineAdvice(g);
  // The line's next build counts from the port it names (its node); from any other port the goal's own words do
  // (at goal 15 the line's "a Lab from the new Drill's port" must not put Lab first on the Plastic port the goal names).
  if (step?.build && step.build in NODE_DEFS && (step.node == null || step.node === from)) return step.build as NodeType;
  const goal = activeGoal(g);
  if (!goal || g.goal.ready) return null;
  const names = new Map<string, NodeType>();
  for (const t of Object.keys(NODE_DEFS) as NodeType[]) names.set(NODE_DEFS[t].name.toLowerCase(), t);
  const said = /\b(?:pick|build(?:\s+(?:a|an|another))?)\s+([A-Za-z]+)/gi;
  // (A goal that keeps no account of what it buys goes by its words alone, until a node of that kind stands:
  // once the Dump of "Give the Tar somewhere to go" is built, what is left is selling the Plastic, and a menu
  // opened from the Plastic port must not offer a Dump first.)
  const buying = goal.step ? goal.step(g) : undefined;
  const named = buying === undefined ? null : buying === null ? '' : 'tech' in buying ? buying.thenWhat ?? '' : buying.what ?? '';
  for (const m of goal.hint.mouse.matchAll(said)) {
    const t = names.get(m[1].toLowerCase());
    if (!t) continue;
    if (named == null) return g.nodes.some((n) => n.type === t) ? null : t;
    return named.includes(`the ${NODE_DEFS[t].name}`) ? t : null;
  }
  return null;
}

/**
 * The option the card asks for (see `wantedType`): it is highlighted and preselected. Where the menu shows keys (a
 * mouse and keyboard), every option keeps the place the port's kind of material gives it, so that a key learned
 * once builds the same machine every time; a finger has no keys to learn, and there the suggested option comes
 * first, where it is seen first. Sets `state.best`, and reorders `state.opts` for a finger.
 */
function suggest(g: Game, state: RadialState) {
  const want = wantedType(g, state.dir === 'consume' ? state.from : undefined);
  let i = want ? state.opts.findIndex((o) => o.type === want && !o.locked) : -1;
  if (i > 0 && isTouch()) {
    state.opts = [state.opts[i], ...state.opts.slice(0, i), ...state.opts.slice(i + 1)];
    i = 0;
  }
  // (With nothing asked for, the first option is the one on offer, as it always was.)
  state.best = i >= 0 ? i : 0;
}

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
  // One thing still to research is shown locked, as a promise; not a machine already on offer for another
  // recipe (a Fabricator that makes Phone beside a locked Fabricator would read as two of the same).
  const locked = recipes.find((r) => !recipeUnlocked(g, r) && !opts.some((o) => o.type === r.machine));
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
      return `<button class="bopt ${cls}${i === state.best && afford ? ' best' : ''}" data-act="pick:${i}" data-testid="radial-${o.type}${o.recipe ? '-' + o.recipe : ''}" ${o.locked ? 'disabled' : ''}>
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
  fitBuildSheet();
  touch();
  // The outline of the card where it will stand, and the wire that was being drawn, now ending on it.
  drawSite();
  // The board slides, as little as it can, so that the outline shows above the sheet (beside it, on a phone held
  // sideways). The move is the sheet's own: it is taken back when the sheet goes (see `unmove`).
  const card = state.card!, site = state.site!;
  liftFor(state, { x0: site.x, y0: site.y, x1: site.x + card.w, y1: site.y + card.room });
}

/** Under the phone's sheet: slide the board, if need be, so that this outline shows above it (see `sheetLift`). */
function liftFor(state: RadialState, box: Box) {
  if (!buildEl.classList.contains('open')) return;
  const before = state.moved?.from ?? { ...viewAhead() };
  // (Across, the card with its ports: a spot the rule counts as in view is then never moved sideways for.)
  const to = sheetLift({ x0: box.x0 - 10, y0: box.y0 - 22, x1: box.x1 + 10, y1: box.y1 + 12 });
  if (to) {
    moveView(to.x, to.y, to.k, true);
    state.moved = { from: before, to };
  }
}

/**
 * The camera from which a world box shows in what an open sheet leaves of the stage, moved as little as it can be:
 * only up or down while the box lies on the stage across (a sheet at the side moves it across instead). A box taller
 * than the room shows its top. Null when nothing has to move.
 */
function sheetLift(box: Box): View | null {
  const v = viewAhead();
  const f = freeArea();
  const pad = 10;
  let x = v.x, y = v.y;
  const l = box.x0 * v.k + x, r = box.x1 * v.k + x;
  if (r - l > f.x1 - f.x0 || l < f.x0) x += f.x0 - l;
  else if (r > f.x1) x -= r - f.x1;
  const y0 = f.y0 + pad, y1 = Math.max(y0 + 40, f.y1 - pad);
  const t = box.y0 * v.k + y, b = box.y1 * v.k + y;
  if (b - t > y1 - y0 || t < y0) y += y0 - t;
  else if (b > y1) y -= b - y1;
  return Math.abs(x - v.x) < 0.5 && Math.abs(y - v.y) < 0.5 ? null : { x, y, k: v.k };
}

/**
 * Find where the card the menu builds will stand, for the camera as it was when the menu opened: the spot of the
 * suggested option's card (`buildSpot`). It is found once; the pick builds there (see `pickRadial`).
 */
function findSite(r: RadialState) {
  const best = r.opts[r.best ?? 0];
  const lead = best && !best.locked ? best : r.opts.find((o) => !o.locked);
  r.rev = ui.g.rev;
  r.site = null;
  r.sites = new Map();
  r.asked = undefined;
  if (!lead) return;
  r.sight ??= sightNow();
  r.card = footprint(lead.type, lead.recipe);
  r.site = buildSpot(r.at, r.card, { wire: menuWire(r), sight: r.sight });
}

/** The wire a card built from this menu arrives on: from the port, or (built back from an input port) to it. */
const menuWire = (r: RadialState) => (r.dir === 'consume' ? { from: r.a } : { to: r.a });

/**
 * The outline the build menu would show if it were opened from this output port at each of these points (board
 * units): where its suggested card would stand (see `findSite`), or null where the plot has no room. For whoever
 * points at an empty spot before the player has chosen one (the guiding hand): a point whose outline is centred on
 * it is one the menu accepts as it stands. `blind`: as if all of the board could be seen (to choose a spot before
 * the camera has been brought to it).
 */
export function buildPreview(from: number, port: number, pts: Pt[], blind = false): (Box | null)[] {
  const g = ui.g;
  const n = nodeById(g, from);
  const a = n && outPorts(g, n)[port];
  if (!a) return pts.map(() => null);
  const mats = materialsAt(g, from, port);
  const first: RadialState = { at: a, dir: 'consume', from, port, to: 0, mat: mats[0] ?? null, a, opts: consumeOptions(g, mats) };
  suggest(g, first);
  const sight: Sight = blind ? { view: null, covers: [] } : sightNow();
  return pts.map((at) => {
    const r: RadialState = { ...first, at, sight };
    findSite(r);
    const o = r.opts[r.best ?? 0];
    return o ? optSite(r, o) : null;
  });
}

/** For scripts: see the hook `board.explain`. */
function explainSite(at: Pt, from: number, port: number) {
  const g = ui.g;
  const n = nodeById(g, from);
  const a = n && outPorts(g, n)[port];
  if (!a) return null;
  const mats = materialsAt(g, from, port);
  const r: RadialState = { at, dir: 'consume', from, port, to: 0, mat: mats[0] ?? null, a, opts: consumeOptions(g, mats) };
  suggest(g, r);
  findSite(r);
  const card = r.card;
  if (!card) return null;
  const sight = r.sight!;
  return {
    type: r.opts[r.best ?? 0]?.type, rule: r.site,
    noWire: buildSpot(at, card, { sight }),
    noSight: buildSpot(at, card, { wire: { from: a }, sight: { view: null, covers: sight.covers } }),
    bare: buildSpot(at, card, { sight: { view: null, covers: sight.covers } }),
    clear: clearPoint(at, g.board, sight.view, sight.covers),
  };
}

/**
 * Where this option's card stands. The suggested option's: on the spot found for the menu. Any other: on the same
 * middle, when that card has room there too (most are the same size or smaller); a card that has not (a taller one in
 * a tight spot) gets a spot of its own by the same rule, as near that middle as it can stand.
 */
function optSite(r: RadialState, o: RadialOpt): Box | null {
  if (!r.site || !r.card || o.locked) return null;
  const i = r.opts.indexOf(o);
  let box = r.sites?.get(i);
  if (box !== undefined) return box;
  const f = footprint(o.type, o.recipe);
  const { w, h } = sizeFor(o.type, o.recipe);
  let p: Pt | null = siteFor(r.site, r.card, f, GRID);
  if (!(f.w === r.card.w && f.h === r.card.h && f.room === r.card.room) && !fitsAt(p, f, { cards: nodeBoxes(undefined, true), deposits: depositBoxes(), board: ui.g.board })) {
    p = buildSpot({ x: r.site.x + r.card.w / 2, y: r.site.y + r.card.h / 2 }, f, { wire: menuWire(r), sight: r.sight });
  }
  box = p ? { x0: p.x, y0: p.y, x1: p.x + w, y1: p.y + h } : null;
  r.sites?.set(i, box);
  return box;
}

/** This option's card would stand in the outline the menu shows for the suggested one: on the same middle (to the grid). */
function inOutline(r: RadialState, o: RadialOpt): boolean {
  const lead = r.opts[r.best ?? 0], a = lead ? optSite(r, lead) : null, b = optSite(r, o);
  return !!a && !!b && Math.abs((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2) <= 10 && Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) <= 10;
}

/**
 * Draw the outline of the card the open menu will build, where it will stand, with the wire from the port to it: the
 * suggested option's card, or the one the pointer rests on. Under the phone's sheet it is drawn on the board (it moves
 * with the camera); the fan covers the board round it, so there it is drawn on the fan.
 */
function drawSite() {
  const r = radial;
  const lead = r ? r.opts[r.best ?? 0] : null;
  const over = r && r.shown != null ? r.opts[r.shown] : null;
  const o = over && !over.locked ? over : lead;
  const box = r && o ? optSite(r, o) : null;
  const sheet = buildEl.classList.contains('open');
  if (!r || !o || !box) {
    setStyle(siteEl, 'display', 'none');
    return;
  }
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  // The wire ends on the middle of the card's side: its input, or (built back from an input port) its output.
  const end = r.dir === 'consume' ? { x: box.x0, y: box.y0 + h / 2 } : { x: box.x1, y: box.y0 + h / 2 };
  const color = matColor(r.mat);
  if (sheet) {
    setStyle(siteEl, 'display', 'flex');
    setStyle(siteEl, 'left', box.x0 + 'px');
    setStyle(siteEl, 'top', box.y0 + 'px');
    setStyle(siteEl, 'width', w + 'px');
    setStyle(siteEl, 'height', h + 'px');
    setHTML(siteEl, `${nodeIcon(o.type, 20)}<span>${esc(NODE_DEFS[o.type].name)}</span>`);
    tempPath.setAttribute('d', r.dir === 'consume' ? pathD(r.a, end) : pathD(end, r.a));
    tempPath.style.stroke = color;
    tempPath.classList.remove('snap');
    tempPath.classList.add('on');
    tempEnd.setAttribute('cx', String(end.x));
    tempEnd.setAttribute('cy', String(end.y));
    tempEnd.style.fill = color;
    tempEnd.classList.add('on');
    tempD = '';
    return;
  }
  setStyle(siteEl, 'display', 'none');
  const rect = radialEl.querySelector<SVGRectElement>('.lead .site'), line = radialEl.querySelector<SVGLineElement>('.lead line');
  if (!rect || !line) return;
  // (The fan stands at a point of the stage, and the camera holds still while it is open.)
  const k = ui.view.k;
  const cx = parseFloat(radialEl.style.left) || 0, cy = parseFloat(radialEl.style.top) || 0;
  const tl = toScreen({ x: box.x0, y: box.y0 }), a = toScreen(r.a), b = toScreen(end);
  setAttr(rect, 'x', (tl.x - cx).toFixed(1));
  setAttr(rect, 'y', (tl.y - cy).toFixed(1));
  setAttr(rect, 'width', (w * k).toFixed(1));
  setAttr(rect, 'height', (h * k).toFixed(1));
  setAttr(rect, 'rx', (14 * k).toFixed(1));
  setAttr(line, 'x1', (a.x - cx).toFixed(1));
  setAttr(line, 'y1', (a.y - cy).toFixed(1));
  setAttr(line, 'x2', (b.x - cx).toFixed(1));
  setAttr(line, 'y2', (b.y - cy).toFixed(1));
}

/** For scripts: the open menu's outline (board units), the spot it was found on, the point chosen and the camera move made for the menu. */
function siteState() {
  const r = radial;
  if (!r) return null;
  const over = r.shown != null ? r.opts[r.shown] : null;
  const o = over && !over.locked ? over : r.opts[r.best ?? 0];
  const box = o ? optSite(r, o) : null;
  return {
    at: { ...r.at }, spot: r.site ? { ...r.site } : null, card: r.card ? { ...r.card } : null,
    outline: box ? { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 } : null,
    option: o ? o.type : null, best: r.opts[r.best ?? 0]?.type ?? null, moved: r.moved ? { from: { ...r.moved.from }, to: { ...r.moved.to } } : null,
  };
}

/**
 * The menu has gone, by a pick or a cancel: a move the camera made for it when it opened is taken back, unless the
 * player has moved the camera since. (After a pick the camera then moves on only if the new card cannot be seen whole
 * from there, and as little as it takes: see `built`.)
 */
function unmove(r: RadialState) {
  const m = r.moved;
  if (!m || !sameView(viewAhead(), m.to)) return;
  moveView(m.from.x, m.from.y, m.from.k, true, env.phone ? 0 : FRAME_MS);
}

/** Room kept above the build sheet for the spot where the new node goes (a card is 72 to 112 px tall). */
const SHEET_ROOM = 120;

/**
 * Size the build sheet to its options. It may grow past the inspector's limit (it needs room above it
 * only for the new node, and the floating controls step aside while it is open), up to the strip less
 * SHEET_ROOM. When even that cannot show every option, the list is cut halfway through a row, never at a
 * sliver, and fades at its foot: the rest is plainly there to be scrolled to. (The option the goal asks for
 * comes first: see `suggest`.)
 */
function fitBuildSheet() {
  const list = buildEl.querySelector<HTMLElement>('.bopts');
  buildEl.style.maxHeight = '';
  if (!list || !env.phone) return;
  list.style.maxHeight = '';
  const stage = boardEl.offsetHeight;
  const c = env.cover();
  // (A sheet that stands at the side, on a phone held sideways, has the stage's full height.)
  const side = buildEl.offsetWidth < (boardEl.offsetWidth || 1) * 0.7;
  const room = side ? stage - 6 : Math.max(190, stage - c.top - SHEET_ROOM);
  const head = buildEl.offsetHeight - list.offsetHeight;
  const need = head + list.scrollHeight;
  buildEl.style.maxHeight = Math.min(need, room) + 'px';
  list.classList.remove('more');
  if (need <= room) return;
  // Cut the list in the middle of the first row that does not fit.
  const top = list.getBoundingClientRect().top;
  const avail = room - head;
  let cut = -1;
  let prevMid = -1;
  for (const o of list.querySelectorAll<HTMLElement>('.bopt')) {
    const r = o.getBoundingClientRect();
    const y0 = r.top - top + list.scrollTop, y1 = y0 + r.height;
    if (y1 > avail) {
      // Halfway into this row when that much of it fits; otherwise halfway into the row before it (the list would
      // end at a row's edge and look complete).
      const half = y0 - 8 + r.height * 0.5;
      cut = Math.max(half <= avail ? half : prevMid >= 0 ? prevMid : avail, 60);
      break;
    }
    prevMid = y0 + r.height * 0.5;
  }
  // (Every option fits, and only the list's own padding does not: nothing more to scroll to, and no fade.)
  if (cut < 0) return;
  list.style.maxHeight = Math.round(cut) + 'px';
  list.classList.add('more');
  buildEl.style.maxHeight = Math.round(head + cut) + 'px';
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
    if (i === r.best) setClass(b, 'best', afford);
  });
}

/**
 * The room the fan of `n` options needs, and how it is made: `clear(p)` gives where a fan round the stage point `p`
 * stands (kept on the stage), after sliding the board down, when the goal card hangs over that place, by as much as
 * brings the fan out from under it (and from under the chips below it, when there is room for that).
 */
function fanRoom(n: number) {
  // Wide enough that neighbouring slots never overlap, however the fan is turned.
  const R = n >= 8 ? 180 : n === 7 ? 158 : n >= 6 ? 142 : 122;
  const rect = rectOf();
  const m = R + 58;
  const mx = Math.min(m, rect.width / 2), my = Math.min(m, rect.height / 2);
  const clear = (p: Pt): Pt => {
    const c = { x: Math.max(mx, Math.min(rect.width - mx, p.x)), y: Math.max(my, Math.min(rect.height - my, p.y)) };
    const s = env.strip();
    if (s && c.x + m > s.x0 && c.x - m < s.x1) {
      const fits = (edge: number) => rect.height - (edge + 8) >= m * 2;
      const edge = fits(s.bottom) ? s.bottom : fits(s.goalBottom) ? s.goalBottom : -1;
      // (No room under the card at all, on a very short window: as low as the menu can go.)
      const top = edge >= 0 ? edge + 8 + m : rect.height - my;
      if (c.y < top) {
        const y0 = ui.view.y;
        ui.view.y += top - p.y;
        glide = null;
        applyView();
        // (The board may not have gone all the way: it is kept on the stage.)
        c.y = Math.max(my, Math.min(rect.height - my, Math.max(top, p.y + ui.view.y - y0)));
      }
    }
    return c;
  };
  return { R, m, my, rect, clear };
}

function openRadial(state: RadialState) {
  suggest(ui.g, state);
  const before = { ...viewAhead() };
  // (Where the pointer is, on the stage, before anything slides under it: the fan may have to stand elsewhere, but no
  // option may come to lie under the pointer.)
  const pointer = toScreen(state.at);
  const fan = env.phone ? null : fanRoom(state.opts.length);
  // Outside the phone layout the menu is a fan round the point, which needs room under the goal card: where the
  // point lies too near the card for that, the board slides down first, so the fan, the wire and the new card stay
  // where they belong to each other. (The fan's own move: taken back when it goes, see `unmove`.)
  if (fan) fan.clear(toScreen(state.at));
  // Where the card will stand is settled now, before anything is chosen, and shown as an outline until the pick or
  // the cancel (see `findSite`, `drawSite`). With no room anywhere there is nothing to choose.
  findSite(state);
  if (!state.site || !state.card) {
    if (!sameView(before, ui.view)) moveView(before.x, before.y, before.k, false);
    toast(NO_ROOM, 'bad');
    return;
  }
  radial = state;
  menuOpenedAt = performance.now();
  menuPressAt = -Infinity;
  if (!fan) {
    openBuildSheet(state);
    return;
  }
  const g = ui.g;
  const n = state.opts.length;
  const { R } = fan;
  // The fan stands round the middle of the outline: where the wire was let go, unless the card has to stand
  // elsewhere (then it is brought clear of the goal card there too). The whole menu is kept on screen.
  const mid = { x: state.site.x + state.card.w / 2, y: state.site.y + state.card.h / 2 };
  const c = fan.clear(toScreen(mid));
  if (!sameView(before, ui.view)) state.moved = { from: before, to: { ...ui.view } };
  const a = toScreen(state.a);
  hideTemp();
  const back = Math.atan2(a.y - c.y, a.x - c.x); // direction the wire comes from
  const step = radialStep(n);
  // Near an edge the menu stands off the pointer, and an option could come to lie under it (a second click from
  // a double-click habit would build it): the fan is turned, as little as it takes, until none does.
  const under = (turn: number) => state.opts.some((_, i) => {
    const ang = back + Math.PI + turn + step * radialOffset(i, n);
    return Math.abs(c.x + Math.cos(ang) * R - pointer.x) < 48 + 10 && Math.abs(c.y + Math.sin(ang) * R - pointer.y) < 48 + 10;
  });
  let turn = 0;
  if (under(0)) {
    for (let d = 5; d <= 180; d += 5) {
      const t = (d * Math.PI) / 180;
      if (!under(t)) { turn = t; break; }
      if (!under(-t)) { turn = -t; break; }
    }
  }
  const fwd = back + Math.PI + turn;
  const best = state.best ?? 0;
  const slots = state.opts
    .map((o, i) => {
      const ang = fwd + step * radialOffset(i, n);
      const x = Math.cos(ang) * R, y = Math.sin(ang) * R;
      const afford = !o.locked && o.cost <= g.credits + 1e-6;
      const cls = o.locked ? 'locked' : afford ? '' : 'poor';
      const price = optPrice(o);
      return `<button class="slot ${cls}${i === best && afford ? ' best' : ''}" data-act="pick:${i}" data-i="${i}" data-testid="radial-${o.type}${o.recipe ? '-' + o.recipe : ''}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px" ${o.locked ? 'disabled' : ''}>
        <span class="key mono">${i + 1}</span>${o.locked ? icon('lock', 14) : ''}${o.glyph}
        <span class="sn">${esc(o.label)}</span><span class="ss">${o.sub ? o.sub + ' · ' : ''}<span class="mono">${price}</span></span>
      </button>`;
    })
    .join('');
  const hub = state.mat
    ? `${matGlyph(state.mat, 20)}<span>${MATERIALS[state.mat].name}</span>`
    : `<span>Build</span>`;
  radialEl.innerHTML = `<div class="disc" style="width:${R * 2 + 130}px;height:${R * 2 + 130}px"></div>
    <svg class="lead" width="1" height="1"><rect class="site"/><line style="stroke:${matColor(state.mat)}"/></svg>
    <div class="hub">${hub}</div>${slots}`;
  radialEl.style.left = c.x + 'px';
  radialEl.style.top = c.y + 'px';
  radialEl.style.display = 'block';
  drawSite();
  // Preselected: Enter (or Space) builds the suggested option, for a player at the keyboard. (Not for a finger.)
  if (!isTouch()) radialEl.querySelector<HTMLButtonElement>(`.slot[data-i="${best}"]:not(:disabled)`)?.focus({ preventScroll: true });
}

/** Take the build menu off the screen. Returns what it was showing (null: it was not open). */
function shutRadial(): RadialState | null {
  const r = radial;
  if (!r) return null;
  radial = null;
  radialEl.style.display = 'none';
  setStyle(siteEl, 'display', 'none');
  if (buildEl.classList.contains('open')) {
    buildEl.classList.remove('open');
    touch();
  }
  hideTemp();
  return r;
}

/** Close the build menu without building. A move the camera made for it is taken back (see `unmove`). */
export function closeRadial() {
  const r = shutRadial();
  if (r) unmove(r);
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
  // The card goes into the outline the menu showed: the spot found when it opened (`findSite`). Only when the board
  // has changed under the open menu (an undo by key) is the spot found again, for the same camera.
  if (r.rev !== g.rev) findSite(r);
  const box = optSite(r, o);
  // An option whose card has no room in that outline (a taller card, in a tight spot) has a spot of its own beside
  // it. Nothing is built where it was not shown: unless its outline is on show already (the pointer rests on it), the
  // first press shows it, with the wire, and the next builds.
  if (box && !inOutline(r, o) && r.shown !== i && r.asked !== i) {
    r.asked = r.shown = i;
    drawSite();
    liftFor(r, box);
    toast(`No room for the ${NODE_DEFS[o.type].name} there: it would stand here. Pick it again to build.`, 'info');
    return;
  }
  shutRadial();
  if (!box) {
    unmove(r);
    toast(NO_ROOM, 'bad');
    return;
  }
  const pos = { x: box.x0, y: box.y0 };
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
  // (The menu has gone: its own camera move is taken back first; the camera then moves only if the card cannot be seen.)
  unmove(r);
  if (made) {
    built((made as GNode).id);
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

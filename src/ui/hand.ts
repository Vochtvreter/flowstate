// The guiding hand: a small pointer that acts out a gesture for the player. It never takes input,
// never presses anything, and vanishes the moment the player touches the screen, a key or the wheel.
//
// It has three jobs:
//  - The first wire and the first build ("goal"). When the player has done nothing for a few seconds
//    on the goal that teaches wiring, or on the one that teaches building from a port, it shows the
//    gesture over and over until they move. It never comes back for a gesture they have done once.
//  - A tip that has gone stale ("tip"). It appears at the tip's Show me button and taps it once in
//    the air.
//  - Show me ("showme"). It acts the tip's suggestion out twice and leaves: a wire from a port to a
//    node, a build from a port into empty space, a Well from the build bar onto a deposit, or a
//    press on a control in the inspector or the tech tree.
//
// How a gesture looks follows the pointer in use. With a mouse a wire is a drag (press on the port,
// drag, let go). With a finger it is two taps, as the phone shell wires: tap the port, tap the
// target. When the player has already tapped the port (it is "armed", see armedPort in board.ts)
// only the second tap is shown, because tapping the port again would let go of it.
//
// The hand itself is one small element above every panel (#feel-hand, feel.css), moved with a
// transform, so it can point at the build bar, the goal card and the inspector as well as the board.
// What it draws on the board (the wire it would make, the outline of the target) is on the effects
// canvas, under the HUD, in world space: after a pan, a pinch or a turn of the phone it is still on
// the port. Layout is only read on the slow beat (four times a second), and only while a gesture
// that points at a control is on its way or on screen.
import { NodeType } from '../content';
import { goalView } from '../goals';
import { graph } from '../sim';
import { Game, GNode } from '../state';
import { armedPort, boardRect, radialOpen, toClient } from './board';
import { el, setClass, setStyle } from './dom';
import { Overlay, addOverlay, ring } from './fx';
import { Pt, bezierAt, inPorts, matColor, nodeSize, outPorts } from './geom';
import { env } from './phone-env';
import { Signals, onBeat, onFrame, onNewGame, ui } from './ui';

/** Without input for this long (ms) before the hand shows the goal's gesture. */
const IDLE_MS = 5000;
/** A gesture that was asked for but cannot be shown yet (a sheet still sliding, a pointer still down) waits this long (ms). */
const WAIT_MS = 4000;
/** Height of the hand on screen, in px. */
const HAND_PX = 38;
/** How often Show me is acted out before the hand leaves. */
const SHOW_LOOPS = 2;

type Kind = 'wire' | 'build' | 'place' | 'press' | 'point';
type Source = 'goal' | 'showme' | 'tip';
/** How the gesture is acted: a drag, two taps, only the second of the two, or one tap on a control. */
type Mode = 'drag' | 'taps' | 'tap2' | 'tap';

/** Seconds one round of each takes. */
const PERIOD: Record<Mode, number> = { drag: 2.9, taps: 3.1, tap2: 2.0, tap: 1.7 };

/** Something the hand has been asked to act out (by a signal), until it is done, dropped or interrupted. */
interface Act {
  source: 'showme' | 'tip';
  kind: Kind;
  from?: number;
  port?: number;
  to?: number;
  type?: NodeType;
  deposit?: number;
  testid?: string;
  at?: Pt;
  loops: number;
  born: number;
  shown: boolean;
}

/** A point either on the board (world space, followed as the view moves) or on the screen (client px). */
interface Spot { x: number; y: number; world: boolean }

interface Plan {
  kind: Kind;
  source: Source;
  mode: Mode;
  /** Where the gesture starts (the port, the build-bar button); null when only its end is shown. */
  a: Spot | null;
  /** Where the fingertip ends up. */
  b: Spot;
  /** Board gestures: the wire that would be made, from the port to where it attaches (world space). */
  wire: { from: Pt; end: Pt } | null;
  /** The card to light up as the target (world space), or null. */
  card: { x: number; y: number; w: number; h: number } | null;
  /** Draw the outline of a card that would be built at `b`. */
  ghost: boolean;
  color: string;
  loops: number;
}

let record: (kind: 'hand', name: string, detail?: string | number) => void = () => {};
let isBusy: () => boolean = () => false;
let app: HTMLElement | null = null;
let handEl: HTMLElement | null = null;
let plan: Plan | null = null;
let act: Act | null = null;
let visible = false;
let clock = 0;
/** Where the fingertip was last drawn, in client px (for tests). */
const tip: Pt = { x: 0, y: 0 };
let lastInput = 0;
/**
 * The pointers that are down, by id. (Kept as a set, not a count: when a press opens a browser dialog,
 * "New game" asks "are you sure?", the page never hears that press end. A count would stay one too high
 * for good and the hand would never show again; the set is emptied by the next press.)
 */
const pointersDown = new Set<number>();
/** The build menu has been opened from a port during this game: that gesture is learnt. */
let builtOnce = false;
const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!reducedQuery?.matches;

const usesTouch = () => document.documentElement.dataset.input === 'touch';

// ---------- when ----------

const wireDone = (g: Game) => g.goal.i > 0 || g.goal.ready || g.wires.length > 0 || g.stats.wiresMade > 0;
const buildDone = (g: Game) => builtOnce || g.goal.i > 3 || g.nodes.some((n) => n.type === 'refiner');

/** A full-screen card is up, a celebration is playing, or the player is holding something down. */
function blockedAnywhere(): boolean {
  if (pointersDown.size > 0 || document.hidden || ui.menuOpen || isBusy()) return true;
  if (!app) return false;
  // The start screen is up until #app is marked as started.
  if (!app.classList.contains('started')) return true;
  return !!app.querySelector('#modal.open, #summary:not([hidden])');
}

/** Something is open over the board, or the player is in the middle of something on it. */
function blockedOnBoard(placingOwn = false): boolean {
  if (blockedAnywhere() || ui.techOpen || radialOpen()) return true;
  return !!ui.placing && !placingOwn;
}

/** The part of the board that can be seen: the stage less whatever the phone shell says is covered. */
function freeBox(pad: number) {
  const r = boardRect();
  const c = env.cover();
  return { x0: r.left + c.left + pad, y0: r.top + c.top + pad, x1: r.right - c.right - pad, y1: r.bottom - c.bottom - pad };
}

const inBox = (p: Pt, b: { x0: number; y0: number; x1: number; y1: number }) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
const client = (s: Spot): Pt => (s.world ? toClient(s) : s);
const world = (p: Pt): Spot => ({ x: p.x, y: p.y, world: true });
const screen = (p: Pt): Spot => ({ x: p.x, y: p.y, world: false });

/** How a wire from a port is acted out now, or null when the player is busy with another wire. */
function wireMode(from: number, port: number): Mode | null {
  const armed = armedPort();
  if (armed) return armed.from === from && armed.port === port ? 'tap2' : null;
  return usesTouch() ? 'taps' : 'drag';
}

/** A wire from `from`'s output port to the node `to`. */
function wirePlan(g: Game, from: GNode, portIndex: number, to: GNode, source: Source, loops: number): Plan | null {
  const port = outPorts(g, from)[portIndex];
  if (!port) return null;
  const mode = wireMode(from.id, portIndex);
  if (!mode) return null;
  const { w, h } = nodeSize(to);
  const ins = inPorts(to);
  const inPort = ins.find((p) => p.mat && p.mat === port.mat) ?? ins[0] ?? { x: to.x, y: to.y + h / 2 };
  return {
    kind: 'wire', source, mode, a: mode === 'tap2' ? null : world(port), b: world({ x: to.x + Math.min(34, w / 2), y: to.y + h / 2 + 6 }),
    wire: { from: { x: port.x, y: port.y }, end: { x: inPort.x, y: inPort.y } }, card: { x: to.x, y: to.y, w, h }, ghost: false,
    color: matColor(port.mat), loops,
  };
}

/** The goal's wire: the first Well that has nothing attached, to the Market. */
function firstWirePlan(g: Game): Plan | null {
  const outs = graph(g).outs;
  const wells = g.nodes.filter((n) => n.type === 'well');
  const well = wells.find((n) => !(outs.get(n.id)?.[0]?.length)) ?? wells[0];
  const market = g.nodes.find((n) => n.type === 'market');
  return well && market ? wirePlan(g, well, 0, market, 'goal', Infinity) : null;
}

/** Offsets from the port (world px) to try for "an empty spot", nearest and most natural first. */
const SPOTS: [number, number][] = [[210, 40], [210, 130], [210, -80], [150, 110], [150, -100], [280, 0], [160, 180], [160, -140], [110, 150], [110, -130], [340, 90]];

/** A build from `from`'s output port into empty space. */
function buildPlan(g: Game, from: GNode, portIndex: number, source: Source, loops: number): Plan | null {
  const port = outPorts(g, from)[portIndex];
  if (!port) return null;
  const mode = wireMode(from.id, portIndex);
  if (!mode) return null;
  const used = new Set(g.nodes.map((n) => n.depositId));
  const boxes = g.nodes.map((n) => ({ x: n.x, y: n.y, ...nodeSize(n) }));
  for (const d of g.deposits) if (!used.has(d.id)) boxes.push({ x: d.x, y: d.y, w: 172, h: 72 });
  // Where the fingertip may go: on the part of the board that shows, and clear of the floating buttons at its foot.
  const free = freeBox(36);
  free.y1 -= env.cover().row;
  // First a spot where the whole outline of the new card can be seen; failing that (a narrow screen),
  // one where at least the fingertip can.
  for (const whole of [true, false]) {
    for (const [dx, dy] of SPOTS) {
      const p = { x: port.x + dx, y: port.y + dy };
      // Room for the card that would be built here, with some air around it.
      const x0 = p.x - 30, y0 = p.y - 56, x1 = p.x + 190, y1 = p.y + 56;
      if (x0 < 10 || y0 < 10 || x1 > g.board.w - 10 || y1 > g.board.h - 10) continue;
      if (boxes.some((b) => x0 < b.x + b.w && x1 > b.x && y0 < b.y + b.h && y1 > b.y)) continue;
      if (!inBox(toClient(p), free)) continue;
      if (whole && !inBox(toClient({ x: p.x + 176, y: p.y + 40 }), freeBox(4))) continue;
      return { kind: 'build', source, mode, a: mode === 'tap2' ? null : world(port), b: world(p), wire: { from: { x: port.x, y: port.y }, end: p }, card: null, ghost: true, color: matColor(port.mat), loops };
    }
  }
  return null;
}

/** The gesture the active goal needs, if it is one the hand teaches and the player has not done it yet. */
function wanted(g: Game): Plan | null {
  const view = goalView(g);
  if (!view || view.ready) return null;
  if (view.goal.id === 'wire-market' && !wireDone(g)) return firstWirePlan(g);
  if (view.goal.id === 'build-refiner') {
    if (radialOpen()) builtOnce = true;
    const well = g.nodes.find((n) => n.type === 'well');
    if (!buildDone(g) && well) return buildPlan(g, well, 0, 'goal', Infinity);
  }
  return null;
}

// ---------- controls ----------

/**
 * The middle of a control, if it is on screen and nothing lies over it there. Reads layout, so it is
 * only called on the beat.
 */
function controlAt(selector: string): Pt | null {
  for (const e of document.querySelectorAll<HTMLElement>(selector)) {
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    if (p.x < 0 || p.y < 0 || p.x > window.innerWidth || p.y > window.innerHeight) continue;
    const hit = document.elementFromPoint(p.x, p.y);
    if (hit && (e === hit || e.contains(hit))) return p;
  }
  return null;
}

const byTestId = (id: string) => `[data-testid="${id.replace(/["\\]/g, '')}"]`;

/**
 * Work out what an asked-for gesture looks like right now. 'done' when the player has already done
 * it (or it can no longer be done), null when it cannot be shown at the moment.
 */
function resolve(g: Game, a: Act): Plan | 'done' | null {
  const byId = graph(g).byId;
  switch (a.kind) {
    case 'wire': {
      const from = byId.get(a.from!), to = byId.get(a.to!);
      if (!from || !to) return 'done';
      const port = a.port ?? 0;
      if (g.wires.some((w) => w.from === from.id && w.to === to.id && w.port === port)) return 'done';
      if (blockedOnBoard()) return null;
      return wirePlan(g, from, port, to, a.source, a.loops);
    }
    case 'build': {
      const from = byId.get(a.from!);
      if (!from) return 'done';
      // The build menu is open: the player has made the gesture.
      if (radialOpen()) return 'done';
      if (blockedOnBoard()) return null;
      return buildPlan(g, from, a.port ?? 0, a.source, a.loops);
    }
    case 'place': {
      const d = g.deposits.find((x) => x.id === a.deposit);
      if (!d || g.nodes.some((n) => n.depositId === d.id)) return 'done';
      const own = ui.placing?.type === a.type;
      if (blockedOnBoard(own)) return null;
      const b = world({ x: d.x + 86, y: d.y + 36 });
      const card = { x: d.x, y: d.y, w: 172, h: 72 };
      // The Well is already in hand: only where to put it is shown.
      if (own) return { kind: 'place', source: a.source, mode: 'tap2', a: null, b, wire: null, card, ghost: false, color: '#fff', loops: a.loops };
      const btn = controlAt(byTestId(`hot-${a.type}`));
      if (!btn) return null;
      return { kind: 'place', source: a.source, mode: 'taps', a: screen(btn), b, wire: null, card, ghost: false, color: '#fff', loops: a.loops };
    }
    case 'press': {
      if (blockedAnywhere()) return null;
      const p = controlAt(byTestId(a.testid!));
      return p ? { kind: 'press', source: a.source, mode: 'tap', a: null, b: screen(p), wire: null, card: null, ghost: false, color: '#fff', loops: a.loops } : null;
    }
    case 'point': {
      if (blockedAnywhere()) return null;
      // The tip's Show me button, measured afresh (the card may have moved since the signal); where
      // the signal said it was when there is no such button to measure.
      const sel = byTestId('advice-show');
      const p = document.querySelector(sel) ? controlAt(sel) : a.at && a.at.x > 0 && a.at.y > 0 && a.at.x < window.innerWidth && a.at.y < window.innerHeight ? a.at : null;
      return p ? { kind: 'point', source: a.source, mode: 'tap', a: null, b: screen(p), wire: null, card: null, ghost: false, color: '#fff', loops: a.loops } : null;
    }
  }
}

/**
 * Both ends of a board gesture can be seen: they are on the part of the stage that shows, and what
 * is on top there is the board itself, not the goal card, a chip, a floating button or a sheet.
 * (The hand is above all of those: without this it would point at a port through the goal card.)
 * Asked on the beat, and only once everything else says the hand may show.
 */
function onScreen(p: Plan): boolean {
  const free = freeBox(8);
  for (const s of [p.a, p.b]) {
    if (!s || !s.world) continue;
    const c = toClient(s);
    if (!inBox(c, free)) return false;
    const top = document.elementFromPoint(c.x, c.y);
    if (!top || !top.closest('#board')) return false;
  }
  return true;
}

// ---------- show and hide ----------

function hide(why: string) {
  if (!visible) return;
  visible = false;
  record('hand', 'hide', why);
  if (handEl) {
    setClass(handEl, 'on', false);
    setStyle(handEl, 'opacity', '0');
  }
}

function show(p: Plan) {
  const fresh = !visible || !plan || plan.source !== p.source || plan.kind !== p.kind || plan.mode !== p.mode;
  plan = p;
  if (!fresh) return;
  visible = true;
  clock = 0;
  rung = -1;
  record('hand', 'show', p.source === 'goal' ? p.kind : `${p.source}:${p.kind}:${p.mode}`);
  if (handEl) setClass(handEl, 'on', true);
}

function drop(why: string) {
  if (!act) return;
  record('hand', 'drop', `${act.kind}:${why}`);
  act = null;
}

function evaluate() {
  const g = ui.g;
  const now = performance.now();
  if (act) {
    const a = act;
    const p = resolve(g, a);
    if (p === 'done') {
      drop('done');
      hide('done');
    } else if (p && onScreen(p)) {
      a.shown = true;
      return show(p);
    } else if (a.shown) {
      // It was on screen and something got in the way: it does not come back by itself.
      drop('busy');
      hide('busy');
    } else if (now - a.born > WAIT_MS) drop('timeout');
    else return hide('wait');
  }
  // The goal's own gesture, for a player who has stopped.
  const want = wanted(g);
  const idle = now - lastInput >= IDLE_MS;
  // (On a phone the inspector is a sheet over the board; a paused factory is not being played.)
  const busy = !want || !idle || blockedOnBoard() || g.paused || (!!ui.sel && env.phone) || !onScreen(want);
  if (busy) return hide(want ? 'busy' : 'done');
  show(want!);
}

function input() {
  lastInput = performance.now();
  // Whatever was being acted out is over: the player has taken the screen back.
  if (act) drop('input');
  hide('input');
}

export function initHand(hooks: { record: typeof record; busy: () => boolean }) {
  record = hooks.record;
  isBusy = hooks.busy;
  app = document.getElementById('app');
  lastInput = performance.now();
  // The hand: the same shape at every size, drawn once. The fingertip is at TIP in its own px.
  handEl = el(`<div id="feel-hand" aria-hidden="true"><svg viewBox="${-PAD} ${-PAD} ${24 + PAD * 2} ${24 + PAD * 2}" width="${BOX}" height="${BOX}"><path d="${HAND_D}"/></svg></div>`);
  handEl.style.transformOrigin = `${TIP.x}px ${TIP.y}px`;
  (app ?? document.body).appendChild(handEl);
  const opts = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', (e) => {
    // The first pointer of a new press (the mouse, or the first finger) means nothing else is still
    // down, whatever was left in the set by a release that was never heard.
    if (e.isPrimary) pointersDown.clear();
    pointersDown.add(e.pointerId);
    input();
  }, opts);
  const up = (e: PointerEvent) => {
    pointersDown.delete(e.pointerId);
    lastInput = performance.now();
    // Show me was pressed with a mouse: the hand may start now that the button is let go.
    if (act && !act.shown && !pointersDown.size) soon();
  };
  window.addEventListener('pointerup', up, opts);
  window.addEventListener('pointercancel', up, opts);
  window.addEventListener('blur', () => pointersDown.clear());
  window.addEventListener('keydown', input, opts);
  window.addEventListener('wheel', input, opts);
  window.addEventListener('touchstart', input, opts);
  addOverlay(overlay);
  onBeat(evaluate);
  onFrame(step);
  onNewGame(() => {
    builtOnce = false;
    act = null;
    pointersDown.clear();
    lastInput = performance.now();
    hide('new game');
  });
}

// ---------- what the signals ask for ----------

/** Show me was pressed: act the suggestion out (twice), starting as soon as it can be shown. */
export function actOut(d: Signals['showme']) {
  const base = { source: 'showme' as const, loops: SHOW_LOOPS, born: performance.now(), shown: false };
  let next: Act | null = null;
  if (d.wire) next = { ...base, kind: 'wire', from: d.wire.from, to: d.wire.to, port: d.wire.port ?? 0 };
  else if (d.build && d.build.deposit != null) next = { ...base, kind: 'place', type: d.build.type, deposit: d.build.deposit };
  else if (d.build && d.build.from != null) next = { ...base, kind: 'build', type: d.build.type, from: d.build.from, port: d.build.port ?? 0 };
  else if (d.press) next = { ...base, kind: 'press', testid: d.press };
  if (!next) return;
  act = next;
  hide('showme');
  record('hand', 'ask', `showme:${next.kind}`);
  soon();
}

/** A tip has gone stale: appear at its Show me button and tap it once in the air. `null`: the tip has gone. */
export function pointAt(at: Pt | null) {
  if (!at) {
    if (act?.source === 'tip') {
      drop('gone');
      hide('gone');
    }
    return;
  }
  // Show me in progress is the player's own request: a reminder does not cut it short.
  if (act) return;
  act = { source: 'tip', kind: 'point', at: { x: at.x, y: at.y }, loops: 1, born: performance.now(), shown: false };
  record('hand', 'ask', 'tip:point');
  soon();
}

let soonTimer = 0;
/** Look again in a moment rather than on the next beat, once whoever raised the signal has finished drawing. */
function soon() {
  clearTimeout(soonTimer);
  soonTimer = window.setTimeout(evaluate, 0);
}

/** For tests: what the hand is doing, and where its ends are on screen right now. */
export const handState = () => ({
  visible, kind: visible ? plan?.kind ?? null : null, source: visible ? plan?.source ?? null : null, mode: visible ? plan?.mode ?? null : null,
  idleMs: Math.round(performance.now() - lastInput), touch: usesTouch(), asked: act ? `${act.source}:${act.kind}` : null,
  tip: visible ? { x: tip.x, y: tip.y } : null,
  a: visible && plan?.a ? client(plan.a) : null, b: visible && plan ? client(plan.b) : null,
  round: visible && plan ? Math.floor(clock / PERIOD[plan.mode]) : 0,
});

// ---------- the hand itself ----------

// A pointing hand in a 24-unit box, drawn BOX px square with PAD units of room for its outline.
const HAND_D = 'M8.6 12.2V4.3a1.9 1.9 0 0 1 3.8 0V10l5 .9a2.3 2.3 0 0 1 1.9 2.6l-.75 5.1a3.1 3.1 0 0 1-3.07 2.65H10.9a3.1 3.1 0 0 1-2.5-1.27L4.3 14.4a1.65 1.65 0 0 1 2.45-2.2L8.6 13.9z';
const PAD = 2;
const UNIT = HAND_PX / 20;
const BOX = Math.round((24 + PAD * 2) * UNIT);
/** The fingertip, in the element's own px. */
const TIP = { x: +((10.5 + PAD) * UNIT).toFixed(2), y: +((2.6 + PAD) * UNIT).toFixed(2) };

const seg = (u: number, a: number, b: number) => Math.max(0, Math.min(1, (u - a) / (b - a)));
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - ((2 - 2 * u) * (2 - 2 * u)) / 2);
const mix = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

interface Pose { at: Pt; alpha: number; press: number; lift: number }

/** Where the hand is `u` seconds into a round, between `a` (if the round has a start) and `b`, in client px. */
function poseAt(mode: Mode, u: number, a: Pt | null, b: Pt): Pose {
  if (mode === 'drag' && a) {
    // Press on the port, drag to the target, let go.
    const fade = seg(u, 0, 0.3) * (1 - seg(u, 2.15, 2.5));
    const approach = ease(seg(u, 0, 0.4));
    const press = seg(u, 0.4, 0.58) * (1 - seg(u, 1.62, 1.8));
    const go = ease(seg(u, 0.62, 1.6));
    return { at: mix(mix({ x: a.x + 22, y: a.y + 26 }, a, approach), b, go), alpha: fade, press, lift: 0 };
  }
  if (mode === 'taps' && a) {
    // Tap the port, then tap the target.
    const fade = seg(u, 0, 0.3) * (1 - seg(u, 2.3, 2.65));
    const tap1 = seg(u, 0.4, 0.68), tap2 = seg(u, 1.55, 1.83);
    const go = seg(u, 0.72, 1.5);
    return { at: mix(a, b, ease(go)), alpha: fade, press: Math.min(1, Math.sin(Math.PI * tap1) + Math.sin(Math.PI * tap2)), lift: Math.sin(Math.PI * go) };
  }
  // One tap on `b`: come in from below right, press, let go, leave. (The second tap of a pair is the same, a little slower.)
  const k = mode === 'tap2' ? PERIOD.tap2 / PERIOD.tap : 1;
  const v = u / k;
  const fade = seg(v, 0, 0.25) * (1 - seg(v, 1.2, 1.5));
  const approach = ease(seg(v, 0, 0.45));
  const tap = seg(v, 0.5, 0.8);
  return { at: mix({ x: b.x + 20, y: b.y + 24 }, b, approach), alpha: fade, press: Math.sin(Math.PI * tap), lift: 0 };
}

/** When in a round each tap lands, in seconds: a ring opens there. Only taps on things outside the board are listed (the board's rings are drawn with its wire). */
const TAP_AT: Record<Mode, number> = { drag: -1, taps: 0.54, tap2: 0.65 * (PERIOD.tap2 / PERIOD.tap), tap: 0.65 };
/** The round whose ring has been drawn. */
let rung = -1;

/** Move the hand. Every frame while it shows; it writes two styles, and only when they changed. */
function step(dt: number) {
  if (!visible || !plan || !handEl) return;
  const p = plan;
  const calm = reduced();
  clock += dt;
  const period = PERIOD[p.mode];
  const round = Math.floor(clock / period);
  if (round >= p.loops) {
    // Acted out as often as asked: it leaves.
    if (act) {
      record('hand', 'played', `${act.source}:${act.kind}`);
      act = null;
    }
    return hide('played');
  }
  const a = p.a ? client(p.a) : null, b = client(p.b);
  let pose: Pose;
  if (calm) {
    // No motion: the hand rests on where the gesture ends, for as long as the rounds would have taken.
    pose = { at: b, alpha: 0.95, press: 0, lift: 0 };
  } else {
    const u = clock - round * period;
    pose = poseAt(p.mode, u, a, b);
    // A tap on something that is not on the board (a button) opens a ring above the panels.
    const ringAt = p.mode === 'taps' ? (p.a && !p.a.world ? a : null) : p.mode === 'tap' || (p.mode === 'tap2' && !p.b.world) ? b : null;
    if (ringAt && rung !== round && u >= TAP_AT[p.mode]) {
      rung = round;
      ring(ringAt, '#ffffff', { top: true, size: 26, life: 0.5 });
    }
  }
  tip.x = pose.at.x;
  tip.y = pose.at.y - pose.lift * 7;
  const s = 1 - 0.12 * pose.press + 0.06 * pose.lift;
  setStyle(handEl, 'transform', `translate(${(tip.x - TIP.x).toFixed(1)}px,${(tip.y - TIP.y).toFixed(1)}px) rotate(-0.28rad) scale(${s.toFixed(3)})`);
  setStyle(handEl, 'opacity', pose.alpha.toFixed(2));
}

// ---------- what it draws on the board ----------

function drawRing(c: CanvasRenderingContext2D, at: Pt, u: number, color: string, alpha: number) {
  if (u <= 0 || u >= 1 || alpha <= 0) return;
  c.globalAlpha = (1 - u) * 0.9 * alpha;
  c.strokeStyle = color;
  c.lineWidth = 3 * (1 - u) + 1;
  c.beginPath();
  c.arc(at.x, at.y, 7 + 22 * (1 - (1 - u) * (1 - u)), 0, Math.PI * 2);
  c.stroke();
}

/** The wire the gesture would make, from the port to `end` (world). */
function drawWire(c: CanvasRenderingContext2D, from: Pt, end: Pt, color: string, alpha: number, dashed: boolean) {
  if (alpha <= 0) return;
  const k = ui.view.k;
  c.beginPath();
  for (let i = 0; i <= 20; i++) {
    const p = toClient(bezierAt(from, end, i / 20));
    if (i) c.lineTo(p.x, p.y);
    else c.moveTo(p.x, p.y);
  }
  c.globalAlpha = alpha;
  c.strokeStyle = color;
  c.lineWidth = Math.max(2, 3.5 * k);
  c.lineCap = 'round';
  c.setLineDash(dashed ? [2 * k + 1, 8 * k + 2] : []);
  c.stroke();
  c.setLineDash([]);
}

function drawCard(c: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, alpha: number, dashed: boolean, color: string) {
  if (alpha <= 0) return;
  const k = ui.view.k;
  const o = toClient({ x: box.x, y: box.y });
  const pad = 4 * k, r = 14 * k + pad;
  const x = o.x - pad, y = o.y - pad, w = box.w * k + pad * 2, h = box.h * k + pad * 2;
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
  c.globalAlpha = alpha;
  c.strokeStyle = color;
  c.lineWidth = 2;
  c.setLineDash(dashed ? [6, 5] : []);
  c.stroke();
  c.setLineDash([]);
  if (!dashed) {
    c.globalAlpha = alpha * 0.2;
    c.lineWidth = 9;
    c.stroke();
  }
}

/** The card that building here would make: a dashed outline with a plus in it. */
function drawGhostCard(c: CanvasRenderingContext2D, at: Pt, alpha: number) {
  if (alpha <= 0) return;
  const k = ui.view.k;
  drawCard(c, { x: at.x, y: at.y - 36, w: 172, h: 72 }, alpha, true, '#9DB8FF');
  const m = toClient({ x: at.x + 86, y: at.y });
  c.globalAlpha = alpha;
  c.strokeStyle = '#9DB8FF';
  c.lineWidth = Math.max(2, 3 * k);
  c.lineCap = 'round';
  c.beginPath();
  const a = 9 * k;
  c.moveTo(m.x - a, m.y);
  c.lineTo(m.x + a, m.y);
  c.moveTo(m.x, m.y - a);
  c.lineTo(m.x, m.y + a);
  c.stroke();
}

/** A port that has been tapped stays lit, as it does in the game. */
function drawArmed(c: CanvasRenderingContext2D, at: Pt, alpha: number) {
  if (alpha <= 0) return;
  c.globalAlpha = 0.9 * alpha;
  c.strokeStyle = '#fff';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(at.x, at.y, 11, 0, Math.PI * 2);
  c.stroke();
}

// The board's share of a gesture: the wire it would make, the target lit up, rings where a tap
// lands on the board. Drawn from the same clock as the hand, which is moved in step() above.
const overlay: Overlay = {
  active: () => visible && !!plan && (plan.kind === 'wire' || plan.kind === 'build' || plan.kind === 'place'),
  draw(c) {
    const p = plan;
    if (!p) return;
    const b = client(p.b);
    const target = (alpha: number, strong = true) => {
      if (p.card) drawCard(c, p.card, alpha * (strong ? 1 : 0.5), false, '#fff');
      else if (p.ghost && strong) drawGhostCard(c, p.b, alpha);
    };
    if (reduced()) {
      // No motion: the whole gesture as one still picture.
      if (p.wire) drawWire(c, p.wire.from, p.wire.end, p.color, 0.75, true);
      if (p.card) drawCard(c, p.card, 0.8, false, '#fff');
      else if (p.ghost) drawGhostCard(c, p.b, 0.8);
      c.globalAlpha = 1;
      return;
    }
    const u = clock % PERIOD[p.mode];
    if (p.mode === 'taps') {
      const a = p.a ? client(p.a) : b;
      const fade = seg(u, 0, 0.3) * (1 - seg(u, 2.3, 2.65));
      const onBoard = !!p.a?.world;
      // After the first tap the port stays lit and a dotted wire reaches for the target.
      if (onBoard) {
        drawRing(c, a, seg(u, 0.4, 0.68), '#fff', fade);
        if (u > 0.55) drawArmed(c, a, fade);
      }
      if (p.wire) drawWire(c, p.wire.from, p.wire.end, p.color, (u > 1.7 ? 0.95 : 0.4 * seg(u, 0.6, 0.9)) * fade, u <= 1.7);
      if (p.card) drawCard(c, p.card, seg(u, 0.6, 0.9) * fade * (u > 1.7 ? 1 : 0.5), false, '#fff');
      else if (p.ghost) drawGhostCard(c, p.b, seg(u, 1.6, 1.8) * fade);
      drawRing(c, b, seg(u, 1.55, 1.83), '#fff', fade);
    } else if (p.mode === 'tap2') {
      // The port is already lit (the player tapped it): only the second tap is shown.
      const k = PERIOD.tap2 / PERIOD.tap;
      const v = u / k;
      const fade = seg(v, 0, 0.25) * (1 - seg(v, 1.2, 1.5));
      const landed = v > 0.65;
      if (p.wire) drawWire(c, p.wire.from, p.wire.end, p.color, (landed ? 0.95 : 0.4) * fade, !landed);
      target(fade, landed);
      drawRing(c, b, seg(v, 0.5, 0.95), '#fff', fade);
    } else if (p.mode === 'drag' && p.a && p.wire) {
      const a = client(p.a);
      const fade = seg(u, 0, 0.3) * (1 - seg(u, 2.15, 2.5));
      const go = ease(seg(u, 0.62, 1.6));
      drawRing(c, a, seg(u, 0.42, 0.8), '#fff', fade);
      const released = u >= 1.66;
      if (u > 0.6) {
        // While dragging the wire follows the finger; let go and it snaps onto the target.
        const endWorld = released ? p.wire.end : mix(p.wire.from, p.b, go);
        drawWire(c, p.wire.from, endWorld, p.color, 0.95 * fade, !released && go < 0.82);
      }
      if (p.card) drawCard(c, p.card, seg(go, 0.75, 0.9) * fade, false, '#fff');
      else if (p.ghost) drawGhostCard(c, p.b, seg(u, 1.66, 1.8) * fade);
      drawRing(c, released && p.card ? toClient(p.wire.end) : b, seg(u, 1.66, 2.05), released ? p.color : '#fff', fade);
    }
    c.globalAlpha = 1;
  },
};

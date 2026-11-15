// Everything that moves every frame is drawn here, on three canvases:
//  - the board layer (`#fx`, over the stage and under the HUD): the dots travelling along flowing
//    wires, the pulse on open ports, and particles that belong to the board (sale floaters, sparks);
//  - the bar layer (`#fx-bar`, made here, a strip over the top bar and a little below it): whatever
//    has to be seen up there, such as a coin on the last stretch of its way to the credits counter;
//  - the top layer (`#fx-top`, made here, above every panel): a small window, a little larger than a
//    celebration card (440 by 360 px; 220 px square for a small effect such as a claim), through which
//    particles are seen above the HUD. A particle that asks to be on top is drawn there while it is
//    inside the window and on the board or the strip once it has left, so a spark can start over the
//    card and fly off across the board. The window is moved to wherever the next effect is whenever
//    it is empty.
// Nothing here touches the DOM after init but to move the top layer's window and to hide the board
// layer while there is nothing on it, and nothing here knows about the game: the board hands
// over wire geometry as `Flow` objects, everyone else calls the particle functions or adds an
// overlay (a function that draws its own thing each frame).
//
// Points passed to the particle functions are in client pixels (the same space as pointer events
// and getBoundingClientRect), so any HUD element or board position can be a source or a target.
//
// Why three canvases rather than one big one. Wire dots must stay under the goal card, the build
// menu and the phone's sheets, while coins must fly over the top bar: one canvas cannot be both.
// And a canvas costs by its size on every frame it changes (the browser hands the whole of it to
// the compositor each time; measured, that is the largest single cost in a frame here). A strip
// hardly costs at all, and the top layer is kept to a small window that is only touched for the
// second or two of a celebration. The board layer is the big one, and on a large factory it is
// most of what a frame costs on a slow machine, so it is changed as seldom as looks right (see
// BUSY_WIRES): about 30 times a second while the camera is still, not at all for its dots while
// the camera moves, and with the dots held still while a celebration card is up.

export interface Pt { x: number; y: number }

export type DotShape = 'circle' | 'diamond' | 'triangle' | 'hexagon' | 'square' | 'star';

/** A wire, as the effects layer sees it. The board owns geometry and rate; `dots` belongs to fx. */
export interface Flow {
  /** Polyline along the wire in world space: x0, y0, x1, y1, … */
  pts: Float32Array;
  /** Distance along the polyline at each point. */
  cum: Float32Array;
  len: number;
  /** World-space bounding box, for culling. */
  x0: number; y0: number; x1: number; y1: number;
  /** World-space rectangles the dots must not be drawn over (node cards): x0, y0, x1, y1 each. */
  occ: number[];
  /** Items per second; 0 when nothing is flowing. */
  rate: number;
  color: string;
  shape: DotShape;
  /** Distance of each dot from the start of the wire, furthest first. */
  dots: number[];
  /** Distance travelled since the last dot left the source. */
  acc: number;
  /** True until first drawn: the wire is then filled with evenly spaced dots instead of starting empty. */
  cold: boolean;
  /** Was flowing on the last frame. */
  on: boolean;
}

const SEGS = 28;

export function makeFlow(cold: boolean): Flow {
  return {
    pts: new Float32Array((SEGS + 1) * 2), cum: new Float32Array(SEGS + 1), len: 0,
    x0: 0, y0: 0, x1: 0, y1: 0, occ: [], rate: 0, color: '#8C97AD', shape: 'circle',
    dots: [], acc: 0, cold, on: false,
  };
}

/** Re-sample a wire's path. `at(t)` gives the point at t in 0..1. */
export function setFlowPath(f: Flow, at: (t: number) => Pt) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let len = 0;
  let px = 0, py = 0;
  for (let i = 0; i <= SEGS; i++) {
    const p = at(i / SEGS);
    if (i > 0) len += Math.hypot(p.x - px, p.y - py);
    f.pts[i * 2] = px = p.x;
    f.pts[i * 2 + 1] = py = p.y;
    f.cum[i] = len;
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  f.len = len;
  f.x0 = x0; f.y0 = y0; f.x1 = x1; f.y1 = y1;
  stale = true;
}

/** Point at a distance along a flow's path (world space). */
export function flowPoint(f: Flow, s: number): Pt {
  const cum = f.cum;
  let i = 0;
  while (i < SEGS - 1 && cum[i + 1] < s) i++;
  const span = cum[i + 1] - cum[i] || 1;
  const t = Math.max(0, Math.min(1, (s - cum[i]) / span));
  return { x: f.pts[i * 2] + (f.pts[i * 2 + 2] - f.pts[i * 2]) * t, y: f.pts[i * 2 + 1] + (f.pts[i * 2 + 3] - f.pts[i * 2 + 1]) * t };
}

// ---------- canvas ----------

const MAX_DPR = 2;
/** Dots on screen never exceed HARD; spacing widens everywhere once more than SOFT are wanted. */
const SOFT_DOTS = 520;
const HARD_DOTS = 800;
const MIN_RATE = 0.015;
/** World px per second: fastest a dot travels, and how fast leftover dots drain off a stalled wire. */
const MAX_SPEED = 170;
const DRAIN_SPEED = 60;
/** Widest spacing between dots, in world px. */
const MAX_GAP = 240;
/** Dots shown per item carried. More than one keeps slow wires looking alive; density still follows rate. */
const DOTS_PER_ITEM = 2.5;
/** At full mood (Flow State) dots travel this much faster and are drawn this much larger. */
const MOOD_SPEED = 0.3;
const MOOD_SIZE = 0.1;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let host: HTMLElement | null = null;
let W = 0, H = 0, dpr = 1;
let originX = 0, originY = 0;

/** One of the two canvases above the panels. `x`, `y`, `w`, `h` are its place on screen, in client px. */
interface Surface {
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null;
  x: number; y: number; w: number; h: number;
  /** Canvas pixels per CSS pixel. */
  ratio: number;
  blank: boolean;
  /** It is on screen (it is hidden while there is nothing on it). */
  shown: boolean;
}
/** Layer numbers. A particle is on one of them, or on AUTO: wherever it happens to be this frame. */
const BOARD = 0, TOP = 1, BAR = 2, AUTO = -1;
/**
 * The top layer is drawn at one canvas pixel per CSS pixel whatever the screen (it only ever holds
 * small moving shapes), and is this large at most, in CSS px.
 */
const TOP_RATIO = 1;
const TOP_W = 440, TOP_H = 360;
/**
 * A small effect (the sparks and first coins of a claim, thirty times a game) gets a small window:
 * what the top layer costs each frame goes by its area, and this is a fifth of the full one.
 */
const SMALL_W = 220, SMALL_H = 220;
/** The window is at its small size. */
let topSmall = false;
/** How far the bar layer reaches below the top bar, in px. */
const BAR_SKIRT = 44;
let appEl: HTMLElement | null = null;
let appX = 0, appY = 0, appW = 0, appH = 0;
/** Live particles that belong to the top layer. While there are none it may be moved. */
let topCount = 0;
let top: Surface | null = null;
let bar: Surface | null = null;
let sizeDirty = true;
let flows: Flow[] = [];
let stale = true;
let wasBlank = true;
let lastKey = '';
let thin = 1;
let dotCount = 0;
/** 0..1: how "in the zone" the factory is. Eased toward `moodTarget`; dots run a little faster and larger with it. */
let mood = 0;
let moodTarget = 0;

// How often the board layer is redrawn. On a factory of more than BUSY_WIRES wires:
//  - While the camera is still, the board layer is redrawn about 30 times a second (every other frame
//    of a 60 Hz screen), with the dots moved on by the whole time since the last redraw. Dots, port
//    pulses, floating figures and coins from sales read the same at that rate; anything that must keep
//    up with the eye (sparks, rings, the coins of a reward, the hand's wire, a wire being connected) is
//    drawn on every frame as before, while it lasts.
//  - While the camera moves (a pan, a pinch, the wheel, a glide: seen here as a view that differs from
//    the last frame's), the dots and port pulses are not drawn at all, and they fade back in once the
//    camera has been still for SETTLE. Redrawn at 30 Hz they would lag behind the wires they belong
//    to; not drawn, the board layer costs nothing while the camera moves.
// On a smaller factory every frame is drawn, as it is cheap there.
// Whatever the size, the dots and pulses hold still while a celebration card is up (holdFlows).
/** More wires than this and the board layer is redrawn as described above. */
const BUSY_WIRES = 30;
/** Least time between two redraws of a busy board's layer, in seconds: a little under a 30 Hz frame, so a 60 Hz screen draws every other frame. */
const BUSY_GAP = 0.028;
/** The camera counts as still once the view has not changed for this long, in seconds. */
const SETTLE = 0.12;
/** Once the camera is still, the dots fade back in over this long, in seconds. */
const DOTS_IN = 0.22;
/** The view on the last frame, and how long it has stayed the same (s). */
let camX = NaN, camY = NaN, camK = NaN, stillFor = 0;
/** Seconds since the board layer was last drawn, and the time its dots have to catch up on. */
let sinceDraw = 0, flowDue = 0;
/** 0..1: how far the dots have faded back in after the camera stopped. */
let dotsIn = 1;
/** A celebration card is up: dots and port pulses hold still (see holdFlows). */
let held = false;
/** Redraws of the board layer since the page loaded, and whether its dots are left out right now because the camera is moving (for tests). */
let boardDraws = 0;
let boardHidden = false;

function makeSurface(id: string, z: number): Surface {
  const c = document.createElement('canvas');
  c.id = id;
  c.setAttribute('aria-hidden', 'true');
  // Inline, so the layer can never take input or push the layout about even if a stylesheet is missing.
  c.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;z-index:${z}`;
  appEl!.appendChild(c);
  return { canvas: c, ctx: c.getContext('2d'), x: 0, y: 0, w: 0, h: 0, ratio: 1, blank: true, shown: true };
}

export function initFx(c: HTMLCanvasElement) {
  canvas = c;
  host = c.parentElement;
  ctx = c.getContext('2d');
  // The two upper layers are made here rather than in index.html, so the page needs no extra
  // elements and the three can never get out of step.
  appEl = (c.closest('#app') as HTMLElement | null) ?? document.body;
  top = makeSurface('fx-top', 56);
  bar = makeSurface('fx-bar', 56);
  const dirty = () => (sizeDirty = true);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(dirty);
    if (host) ro.observe(host);
    ro.observe(appEl);
  }
  window.addEventListener('resize', dirty);
}

function place(s: Surface, x: number, y: number, w: number, h: number, ratio: number) {
  const moved = x !== s.x || y !== s.y;
  s.x = x;
  s.y = y;
  if (w === s.w && h === s.h && ratio === s.ratio) {
    if (moved) s.blank = false; // what is on it was drawn for the old position: have it redrawn or wiped
    return;
  }
  s.w = w; s.h = h; s.ratio = ratio;
  s.canvas.width = Math.max(1, Math.round(w * ratio));
  s.canvas.height = Math.max(1, Math.round(h * ratio));
  s.canvas.style.width = w + 'px';
  s.canvas.style.height = h + 'px';
  s.canvas.style.display = w && h ? '' : 'none';
  s.blank = true; // setting the size cleared it
}

function resize() {
  if (!canvas || !host) return;
  sizeDirty = false;
  const d = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const ratioChanged = d !== dpr;
  dpr = d;
  const r = host.getBoundingClientRect();
  originX = r.left;
  originY = r.top;
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (w !== W || h !== H || ratioChanged) {
    W = w; H = h;
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    stale = true;
  }
  if (!appEl || !top || !bar) return;
  const a = appEl.getBoundingClientRect();
  appX = a.left; appY = a.top;
  appW = Math.max(1, Math.round(a.width)); appH = Math.max(1, Math.round(a.height));
  // The top layer: a window in the middle until an effect asks for it somewhere else (see aimTop).
  const tw = Math.min(appW, topSmall ? SMALL_W : TOP_W), th = Math.min(appH, topSmall ? SMALL_H : TOP_H);
  place(top, appX + Math.round((appW - tw) / 2), appY + Math.round((appH - th) / 2), tw, th, TOP_RATIO);
  moveTop();
  // The strip from the top of the app to a little below the top of the stage: the top bar, in every
  // layout, and room under it for a number to pop up beneath a counter. No strip when there is no bar.
  const barH = Math.round(r.top - a.top);
  place(bar, a.left, a.top, Math.max(1, Math.round(a.width)), barH > 0 ? barH + BAR_SKIRT : 0, d);
}

function moveTop() {
  if (top) top.canvas.style.transform = `translate(${top.x - appX}px, ${top.y - appY}px)`;
}

/**
 * Centre the top layer on a point (as far as the app's edges allow), at its small or its full size,
 * unless something is still being drawn on it. One thing overrides that: an effect that needs the
 * full window (a celebration) takes it from a small one that is still in use; what was showing
 * through the small window goes on where it would be without one, on the board or the bar.
 */
function aimTop(x: number, y: number, small = false) {
  if (sizeDirty) resize();
  if (!top) return;
  if (topCount > 0) {
    if (!topSmall || small) return;
    for (const p of pool) if (p.kind !== 0 && p.layer === TOP) p.layer = AUTO;
    topCount = 0;
  }
  const w = Math.min(appW, small ? SMALL_W : TOP_W), h = Math.min(appH, small ? SMALL_H : TOP_H);
  const nx = Math.max(appX, Math.min(appX + appW - w, Math.round(x - w / 2)));
  const ny = Math.max(appY, Math.min(appY + appH - h, Math.round(y - h / 2)));
  topSmall = small;
  if (nx === top.x && ny === top.y && w === top.w && h === top.h) return;
  place(top, nx, ny, w, h, TOP_RATIO);
  moveTop();
}

const inStage = (x: number, y: number, m = 0) => x >= originX - m && x <= originX + W + m && y >= originY - m && y <= originY + H + m;
const inBar = (x: number, y: number, m = 0) => !!bar && bar.h > 0 && x >= bar.x - m && x <= bar.x + bar.w + m && y >= bar.y - m && y <= bar.y + bar.h + m;
const inTop = (x: number, y: number, m = 0) => !!top && x >= top.x - m && x <= top.x + top.w + m && y >= top.y - m && y <= top.y + top.h + m;

/**
 * How lively the wires look, 0..1. The feel module raises it in Flow State: dots then run a little
 * faster and a touch larger. It eases, so the change is felt rather than seen.
 */
export function setMood(level: number, atOnce = false) {
  moodTarget = Math.max(0, Math.min(1, level));
  // (A reset: no easing. Behind the start screen no time passes, so there would be none anyway. With less
  // motion asked for, never any easing: see isCalm.)
  if (atOnce || isCalm()) mood = moodTarget;
}

/**
 * Hold the dots and the port pulses still (a celebration card is up and covers the middle of the
 * board), or let them go again. While held, the board layer is only redrawn for what still moves
 * on it (particles, overlays), and the dots are drawn where they stopped.
 */
export function holdFlows(on: boolean) {
  if (held === on) return;
  held = on;
  stale = true;
}

/** The wires to draw dots on. Call again whenever wires are added or removed. */
export function setFlows(list: Flow[]) {
  // Same colour and shape next to each other, so each group is one path and one fill.
  flows = list.slice().sort((a, b) => (a.color + a.shape < b.color + b.shape ? -1 : a.color + a.shape > b.color + b.shape ? 1 : 0));
  stale = true;
}

// The player has asked the system for less motion. Nothing then flies, sprays or swells, whoever
// asks for it: burst(), ring() and pop() draw nothing, fly() delivers at once (its `onArrive` runs
// straight away, so counters still pulse and sounds still play), and a floater appears where it was
// asked for and fades without rising. The dots on the wires stand still: the board passes `paused`
// to frameFx and lays each wire's dots out evenly at the spacing its rate gives, so how densely they
// lie still shows what is flowing. The mood (Flow State) is then set at once rather than eased, so
// the dots never grow while the player watches, and the port pulses are a steady ring. The dots of a
// busy board fade back in after the camera moves (an opacity change only, which is allowed there).
const calm = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const isCalm = () => !!calm?.matches;

/** A spot on the board that should pulse gently to invite a click (an output port with nothing attached). */
export interface Beacon { x: number; y: number; r: number }
let beacons: Beacon[] = [];
let beaconClock = 0;

/** The pulsing spots, in world space. Drawn here so that nothing in the DOM has to animate. */
export function setBeacons(list: Beacon[]) {
  beacons = list;
  stale = true;
}

const onScreen = (b: Beacon, view: { x: number; y: number; k: number }) => {
  const x = b.x * view.k + view.x, y = b.y * view.k + view.y;
  return x > -20 && y > -20 && x < W + 20 && y < H + 20;
};

function drawBeacons(c: CanvasRenderingContext2D, view: { x: number; y: number; k: number }) {
  const k = view.k;
  // One breath every 1.6 s: a soft white ring that swells from the port's edge and settles back.
  // (A steady ring for players who have asked for less motion.)
  const s = calm?.matches ? 0.6 : 0.5 - 0.5 * Math.cos((beaconClock / 1.6) * Math.PI * 2);
  const spread = (1 + 5 * s) * k;
  c.beginPath();
  for (const b of beacons) {
    if (!onScreen(b, view)) continue;
    const x = b.x * k + view.x, y = b.y * k + view.y;
    const r = b.r * k + spread / 2;
    c.moveTo(x + r, y);
    c.arc(x, y, r, 0, Math.PI * 2);
  }
  c.lineWidth = spread;
  c.strokeStyle = `rgba(255, 255, 255, ${(0.1 + 0.08 * s).toFixed(3)})`;
  c.stroke();
}

/** Ask for a redraw even though nothing is moving (geometry changed while paused). */
export function invalidateFx() {
  stale = true;
}

// ---------- dots ----------

const STAR_IN = 0.42;
const COS30 = Math.cos(Math.PI / 6);

function addShape(c: CanvasRenderingContext2D, shape: DotShape, x: number, y: number, r: number) {
  if (r < 2.2) {
    // Too small to tell shapes apart: a square is the cheapest thing to fill.
    c.rect(x - r, y - r, r * 2, r * 2);
    return;
  }
  switch (shape) {
    case 'diamond': {
      const q = r * 1.25;
      c.moveTo(x, y - q); c.lineTo(x + q, y); c.lineTo(x, y + q); c.lineTo(x - q, y); c.closePath();
      break;
    }
    case 'triangle': {
      const q = r * 1.3;
      c.moveTo(x, y - q); c.lineTo(x + q * COS30, y + q * 0.5); c.lineTo(x - q * COS30, y + q * 0.5); c.closePath();
      break;
    }
    case 'hexagon': {
      const q = r * 1.12, h = q * COS30, d = q * 0.5;
      c.moveTo(x, y - q); c.lineTo(x + h, y - d); c.lineTo(x + h, y + d); c.lineTo(x, y + q); c.lineTo(x - h, y + d); c.lineTo(x - h, y - d); c.closePath();
      break;
    }
    case 'square': {
      const q = r * 0.92;
      c.rect(x - q, y - q, q * 2, q * 2);
      break;
    }
    case 'star': {
      const q = r * 1.45, i = q * STAR_IN * 0.7071;
      c.moveTo(x, y - q); c.lineTo(x + i, y - i); c.lineTo(x + q, y); c.lineTo(x + i, y + i);
      c.lineTo(x, y + q); c.lineTo(x - i, y + i); c.lineTo(x - q, y); c.lineTo(x - i, y - i); c.closePath();
      break;
    }
    default:
      c.moveTo(x + r, y);
      c.arc(x, y, r, 0, Math.PI * 2);
  }
}

/**
 * Move the dots along every wire on screen and let new ones out of the source.
 * Speed and spacing are chosen so that dots passing a point per second is proportional to the
 * wire's rate, which makes a busy wire both faster and denser (until both reach their limits).
 */
function stepFlows(dt: number, view: { x: number; y: number; k: number }, paused: boolean): number {
  const k = view.k;
  const m = 8 / k;
  const vx0 = -view.x / k - m, vy0 = -view.y / k - m, vx1 = (W - view.x) / k + m, vy1 = (H - view.y) / k + m;
  // Never closer than 11 world px, nor than 8 screen px, or a busy wire turns into a solid line.
  const minGap = Math.max(11, 8 / k);
  let total = 0;
  let wanted = 0;
  for (const f of flows) {
    if (f.x1 < vx0 || f.x0 > vx1 || f.y1 < vy0 || f.y0 > vy1 || f.len < 1) {
      // Off screen: forget the dots, and refill evenly when the wire comes back into view.
      if (f.dots.length) f.dots.length = 0;
      f.cold = true;
      continue;
    }
    const flowing = f.rate > MIN_RATE;
    let speed = DRAIN_SPEED;
    let gap = Infinity;
    if (flowing) {
      speed = Math.min(MAX_SPEED, 34 + 26 * f.rate);
      gap = Math.max(minGap, Math.min(MAX_GAP, speed / (f.rate * DOTS_PER_ITEM)));
      wanted += f.len / gap;
      gap *= thin;
      // In the zone the same dots simply travel faster: spacing is unchanged, so more pass each second.
      speed *= 1 + MOOD_SPEED * mood;
    }
    const dots = f.dots;
    if (f.cold) {
      f.cold = false;
      if (flowing) {
        const first = f.acc % gap;
        for (let i = Math.floor((f.len - first) / gap); i >= 0; i--) dots.push(first + i * gap);
      }
    } else if (flowing && !f.on) {
      f.acc = gap; // just started flowing: the first dot leaves at once
    }
    f.on = flowing;
    if (!paused && dt > 0) {
      const adv = speed * dt;
      for (let i = 0; i < dots.length; i++) dots[i] += adv;
      while (dots.length && dots[0] > f.len) dots.shift();
      if (flowing) {
        f.acc += adv;
        if (f.acc >= gap) {
          // One new dot per gap travelled; after a long frame the surplus is dropped rather than bunched up.
          f.acc = Math.min(f.acc - gap, gap);
          if (total + dots.length < HARD_DOTS) dots.push(Math.min(f.acc, f.len));
        }
      }
    }
    total += dots.length;
  }
  // More dots wanted than the budget allows: space them all out by the same factor, so busy wires
  // still look busier than quiet ones. Eased, so the spacing never jumps.
  const target = Math.max(1, wanted / SOFT_DOTS);
  thin += (target - thin) * 0.08;
  return total;
}

function drawFlows(c: CanvasRenderingContext2D, view: { x: number; y: number; k: number }) {
  const k = view.k;
  let key = '';
  let open = false;
  let budget = HARD_DOTS;
  for (const f of flows) {
    const dots = f.dots;
    if (!dots.length) continue;
    const fk = f.color + f.shape;
    if (fk !== key) {
      if (open) c.fill();
      c.beginPath();
      c.fillStyle = f.color;
      key = fk;
      open = true;
    }
    const base = Math.max(1.5, (3.6 + Math.min(2.4, f.rate * 0.5)) * k) * (1 + MOOD_SIZE * mood);
    const pts = f.pts, cum = f.cum, occ = f.occ, len = f.len;
    let seg = 0;
    for (let i = dots.length - 1; i >= 0 && budget > 0; i--) {
      const s = dots[i];
      while (seg < SEGS - 1 && cum[seg + 1] < s) seg++;
      const span = cum[seg + 1] - cum[seg] || 1;
      const t = (s - cum[seg]) / span;
      const wx = pts[seg * 2] + (pts[seg * 2 + 2] - pts[seg * 2]) * t;
      const wy = pts[seg * 2 + 1] + (pts[seg * 2 + 3] - pts[seg * 2 + 1]) * t;
      let hidden = false;
      for (let j = 0; j < occ.length; j += 4) {
        if (wx > occ[j] && wx < occ[j + 2] && wy > occ[j + 1] && wy < occ[j + 3]) {
          hidden = true;
          break;
        }
      }
      if (hidden) continue;
      const sx = wx * k + view.x, sy = wy * k + view.y;
      if (sx < -8 || sy < -8 || sx > W + 8 || sy > H + 8) continue;
      // Grow out of the source port and shrink into the target, rather than popping.
      const edge = Math.min(1, (s + 2) / 12, (len - s + 2) / 12);
      addShape(c, f.shape, sx, sy, base * (edge < 0.3 ? 0.3 : edge));
      budget--;
    }
  }
  if (open) c.fill();
  dotCount = HARD_DOTS - budget;
}


// ---------- particles ----------
// One pool for all three layers. Positions are kept in client pixels and shifted to the layer when drawn.

const SPARK = 1, COIN = 2, TEXT = 3, RING = 4, POP = 5;
/** Text only: it neither pops in nor rises (less motion was asked for when it was made). */
const F_STILL = 1;
/** It moves quickly or matters now (a spark, a ring, a reward's coin): drawn on every frame wherever it is. */
const F_FAST = 2;
const POOL = 360;
/**
 * Floating text is drawn this much larger than asked (moving text reads smaller than still text of
 * the same size), and in the bold display face rather than the HUD's mono.
 */
const TEXT_SCALE = 1.2;
/** One bit per layer, for `Particle.mask`. */
const B_BOARD = 1 << BOARD, B_TOP = 1 << TOP, B_BAR = 1 << BAR;

interface Particle {
  kind: number;
  /**
   * Where it may be drawn. BOARD: the board layer only. AUTO: whichever of the board and the bar it
   * is over. TOP: above the panels, i.e. in the top layer's window while it is inside it, and
   * otherwise like AUTO.
   */
  layer: number;
  /** The layers it is drawn on this frame, one bit each (worked out by stepParticles). */
  mask: number;
  t: number; ttl: number;
  /** Where it is (sparks, text, rings) or where it set off from (coins). */
  x: number; y: number;
  /** Velocity (sparks), or where a coin is right now. For text, `vy` is how far it rises. */
  vx: number; vy: number;
  cx: number; cy: number; tx: number; ty: number;
  size: number; color: string; text: string;
  shape: DotShape | '';
  /** F_FAST; and for text, F_STILL. */
  flags: number;
  /** Text only: seconds it takes to fade at the end of its life. */
  fade: number;
  /** Coins: what runs when the first of a flight lands (`fn`, once) and when each of them does (`each`). */
  done: { fn: (() => void) | null; each: (() => void) | null } | null;
}

const pool: Particle[] = [];
for (let i = 0; i < POOL; i++) {
  pool.push({ kind: 0, layer: 0, mask: 0, t: 0, ttl: 1, x: 0, y: 0, vx: 0, vy: 0, cx: 0, cy: 0, tx: 0, ty: 0, size: 1, color: '#fff', text: '', shape: '', flags: 0, fade: 0, done: null });
}
let live = 0;
/** Particles to draw on each layer this frame, and how many of those are shared with the top layer's window. */
const liveBy = [0, 0, 0];
const splitBy = [0, 0, 0];
/** Of the particles on the board layer this frame, those with F_FAST. */
let fastOnBoard = 0;
let cursor = 0;

function spawn(kind: number, layer: number): Particle | null {
  for (let i = 0; i < POOL; i++) {
    const p = pool[(cursor + i) % POOL];
    if (p.kind === 0) {
      cursor = (cursor + i + 1) % POOL;
      p.kind = kind;
      p.layer = layer;
      if (layer === TOP) topCount++;
      p.mask = 0;
      p.t = 0;
      p.shape = '';
      // Sparks, rings and anything above the panels are drawn on every frame, even on a busy board.
      p.flags = layer === TOP || kind === SPARK || kind === RING ? F_FAST : 0;
      p.fade = 0;
      p.done = null;
      live++;
      return p;
    }
  }
  return null; // pool exhausted: the effect is simply skipped
}

function kill(p: Particle) {
  p.kind = 0;
  p.done = null;
  live--;
  if (p.layer === TOP) topCount--;
}

/**
 * `top` draws above every panel instead of only on the board (where the HUD covers it).
 * Above the panels means: on the strip over the top bar when it is up there, and otherwise through
 * the top layer's window, about 440 by 360 px, which is centred on the first effect that uses it and
 * stays there until it is empty again. Outside the window the particle is drawn on the board as usual.
 */
export interface LayerOpt {
  top?: boolean;
  /** With `top`: a small effect. If the window above the panels is free it is brought here at its small size (about 220 px square). */
  small?: boolean;
}
export interface BurstOpts extends LayerOpt {
  /** 1 = the usual spray; 2 flies about twice as far and lives a little longer. */
  power?: number;
  shape?: DotShape;
}
export interface FlyOpts extends LayerOpt {
  /** Draw each one as this outline instead of a coin. */
  shape?: DotShape;
  /** Seconds each one takes; by default it follows the distance (0.4 to 0.9 s). */
  ttl?: number;
  size?: number;
  /** Seconds between one leaving and the next. */
  stagger?: number;
  /** How far from `from` each one may start, in px. */
  spread?: number;
  /** Each one's flight is longer than `ttl` by a random time up to this, in seconds (0.08 unless given). 0: they land exactly `stagger` apart. */
  jitter?: number;
  /** Runs as each one lands (after `onArrive`, which runs once, for the first). Not called when less motion is asked for: nothing flies then. */
  each?: () => void;
  /** With `top`: the window above the panels is put around where they leave from, not where they are going. */
  topAtStart?: boolean;
  /** How far their paths bow out to either side: 1 is the usual arc, 0 a straight line. */
  bend?: number;
}
export interface FloaterOpts extends LayerOpt {
  life?: number;
  rise?: number;
  /** Seconds of fading at the end of its life (by default the last 35% of it). */
  fade?: number;
  /** `size` is the size on screen, in px: not enlarged as moving text is. */
  exact?: boolean;
}
export interface RingOpts extends LayerOpt { size?: number; life?: number }

/**
 * The layer value for a particle at this point, bringing the top layer's window here if it is wanted and free.
 * Something that starts over the top bar is already above the panels on the bar's own strip: it
 * never needs the big top layer (which would otherwise be woken for every "+12¢" under a counter
 * whenever its window happened to be near, as it is on a short phone).
 */
function layerFor(o: LayerOpt | undefined, x: number, y: number): number {
  if (!o?.top) return BOARD;
  if (inBar(x, y)) return AUTO;
  aimTop(x, y, !!o.small);
  return TOP;
}

/** A spray of sparks. */
export function burst(at: Pt, color: string, count = 10, o?: BurstOpts) {
  if (isCalm()) return;
  const pw = o?.power ?? 1;
  const layer = layerFor(o, at.x, at.y);
  for (let i = 0; i < count; i++) {
    const p = spawn(SPARK, layer);
    if (!p) return;
    const a = Math.random() * Math.PI * 2;
    const v = (70 + Math.random() * 150) * pw;
    p.x = at.x;
    p.y = at.y;
    p.vx = Math.cos(a) * v;
    p.vy = Math.sin(a) * v - 40 * pw;
    p.ttl = (0.4 + Math.random() * 0.3) * (0.7 + 0.3 * pw);
    p.size = (1.6 + Math.random() * 1.8) * (0.75 + 0.25 * pw);
    p.color = color;
    p.shape = o?.shape ?? '';
  }
}

/**
 * Send `count` coin-like particles from one point to another along slightly different arcs.
 * Each is drawn on whichever layer it is passing over: on the board while it is over the stage
 * (where the HUD may hide it for a moment), on the strip once it is over the top bar; over anything
 * else (the hotbar, the inspector) it is not drawn. With `top` it is also seen above the panels
 * around where it is going (see LayerOpt).
 * `onArrive` runs once, when the first of them lands (or at once, if the pool is full and nothing
 * could be sent), so it is safe to hang a counter update or a sound on it.
 */
export function fly(from: Pt, to: Pt, color: string, count = 3, onArrive?: () => void, o?: FlyOpts) {
  if (isCalm()) return void onArrive?.();
  const done = { fn: onArrive ?? null, each: o?.each ?? null };
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist, ny = dx / dist;
  const spread = o?.spread ?? 12;
  const stagger = o?.stagger ?? 0.06;
  const layer = o?.top ? (o.topAtStart ? layerFor(o, from.x, from.y) : layerFor(o, to.x, to.y)) : AUTO;
  const jitter = o?.jitter ?? 0.08;
  let sent = 0;
  for (let i = 0; i < count; i++) {
    const p = spawn(COIN, layer);
    if (!p) break;
    sent++;
    const bend = (Math.random() * 0.5 + 0.15) * dist * (i % 2 ? -0.45 : 0.45) * (o?.bend ?? 1);
    p.x = from.x + (Math.random() - 0.5) * spread;
    p.y = from.y + (Math.random() - 0.5) * spread;
    p.tx = to.x;
    p.ty = to.y;
    p.cx = (p.x + p.tx) / 2 + nx * bend;
    p.cy = (p.y + p.ty) / 2 + ny * bend;
    p.vx = p.x;
    p.vy = p.y;
    p.t = -i * stagger; // staggered start
    p.ttl = (o?.ttl ?? Math.min(0.9, 0.38 + dist / 2600)) + Math.random() * jitter;
    p.size = o?.size ?? 4.2;
    p.color = color;
    p.shape = o?.shape ?? '';
    p.done = done;
  }
  if (!sent && onArrive) onArrive();
}

const FONT = (size: number) => `700 ${size}px "Space Grotesk", Inter, system-ui, sans-serif`;

/**
 * Text that pops in, rises and fades. (With `rise: 0` it pops in and stands where it is; with less
 * motion asked for it neither pops nor rises, and only fades.)
 */
export function floater(at: Pt, text: string, color: string, size = 13, o?: FloaterOpts) {
  const p = spawn(TEXT, layerFor(o, at.x, at.y));
  if (!p) return;
  const calmNow = isCalm();
  p.x = at.x;
  p.y = at.y;
  p.ttl = o?.life ?? 1.05;
  p.vy = calmNow ? 0 : o?.rise ?? 34;
  p.fade = Math.min(p.ttl, o?.fade ?? p.ttl * 0.35);
  if (calmNow) p.flags |= F_STILL;
  p.size = o?.exact ? size : size * TEXT_SCALE;
  p.color = color;
  p.text = text;
}

let measurer: CanvasRenderingContext2D | null = null;

/** How wide some words are in the bold face floaters are drawn in, at `px` on screen: for laying out a label of one's own. */
export function textWidth(text: string, px: number): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * px * 0.6;
  measurer.font = FONT(px);
  return measurer.measureText(text).width;
}

/** An expanding ring. */
export function ring(at: Pt, color: string, o?: RingOpts) {
  if (isCalm()) return;
  const p = spawn(RING, layerFor(o, at.x, at.y));
  if (!p) return;
  p.x = at.x;
  p.y = at.y;
  p.ttl = o?.life ?? 0.45;
  p.size = o?.size ?? 30;
  p.color = color;
}

/** A disc of radius `r` that swells and fades: the after-image of something popping (a coin on a sale). */
export function pop(at: Pt, color: string, r = 13, o?: LayerOpt) {
  if (isCalm()) return;
  const p = spawn(POP, layerFor(o, at.x, at.y));
  if (!p) return;
  p.x = at.x;
  p.y = at.y;
  p.ttl = 0.3;
  p.size = r;
  p.color = color;
}

/**
 * Take every particle away at once, without running what was waiting for a coin to land (the game
 * was reset: whatever those were about is gone). The layers are wiped on the next frame.
 */
export function clearParticles() {
  for (const p of pool) if (p.kind !== 0) kill(p);
  liveBy[0] = liveBy[1] = liveBy[2] = 0;
  splitBy[0] = splitBy[1] = splitBy[2] = 0;
  fastOnBoard = 0;
  stale = true;
}

const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - ((2 - 2 * u) * (2 - 2 * u)) / 2);
/** A small particle this near the edge of a layer is drawn on both sides of it, so it is never cut in half. */
const EDGE = 12;

/** Advance every particle once per frame, and work out which layers each is drawn on. */
function stepParticles(dt: number) {
  liveBy[0] = liveBy[1] = liveBy[2] = 0;
  splitBy[0] = splitBy[1] = splitBy[2] = 0;
  fastOnBoard = 0;
  for (const p of pool) {
    if (p.kind === 0) continue;
    p.t += dt;
    if (p.t < 0) continue; // still waiting for its staggered start
    if (p.t >= p.ttl) {
      const d = p.kind === COIN ? p.done : null;
      const fn = d?.fn;
      if (fn) d!.fn = null;
      kill(p);
      if (fn) fn();
      d?.each?.();
      continue;
    }
    // Where it is now, and how far it reaches from there.
    let x = p.x, y = p.y, reach = EDGE;
    if (p.kind === SPARK) {
      p.vx *= 1 - 3.2 * dt;
      p.vy = p.vy * (1 - 3.2 * dt) + 320 * dt;
      x = p.x += p.vx * dt;
      y = p.y += p.vy * dt;
    } else if (p.kind === COIN) {
      const e = easeInOut(p.t / p.ttl), a = 1 - e;
      x = p.vx = a * a * p.x + 2 * a * e * p.cx + e * e * p.tx;
      y = p.vy = a * a * p.y + 2 * a * e * p.cy + e * e * p.ty;
    } else if (p.kind === TEXT) {
      y -= p.vy / 2;
      // (Text that stands on the bar is no wider than the bar is high: it never needs the layer beside it.)
      reach = 90;
    } else reach = p.size * 1.8 + 4;
    let m: number;
    if (p.layer === BOARD) m = B_BOARD;
    else {
      // Through the window if it is inside it; under it (bar first, then board) for any part that is not.
      const windowed = p.layer === TOP && inTop(x, y, reach);
      m = windowed ? B_TOP : 0;
      if (!windowed || !inTop(x, y, -reach)) {
        const onBar = inBar(x, y), onStage = inStage(x, y);
        if (onBar) m |= B_BAR;
        else if (onStage) m |= B_BOARD;
        // A coin or a spark near the line between the strip and the board is drawn on both.
        if (reach > EDGE) { /* larger things stay on one side */ }
        else if (onBar && onStage && !inBar(x, y, -reach)) m |= B_BOARD;
        else if (!onBar && onStage && inBar(x, y, reach)) m |= B_BAR;
      }
    }
    p.mask = m;
    const shared = m & B_TOP;
    if (m & B_BOARD) { liveBy[BOARD]++; if (shared) splitBy[BOARD]++; if (p.flags & F_FAST) fastOnBoard++; }
    if (m & B_TOP) liveBy[TOP]++;
    if (m & B_BAR) { liveBy[BAR]++; if (shared) splitBy[BAR]++; }
  }
}

// ---------- text ----------

interface Sprite { canvas: HTMLCanvasElement; w: number; h: number; base: number; used: number }
const sprites = new Map<string, Sprite>();
const SPRITE_MAX = 40;
let spriteClock = 0;
let fontsWatched = false;

/**
 * A floater's text as a picture: bold, in its colour, with a dark outline. `w`, `h` and `base`
 * (how far the baseline is below the top) are in CSS px; the picture is `ratio` times that.
 * Kept while in use, so the "+1¢" of every Market each second is drawn once.
 */
function textSprite(text: string, color: string, size: number, ratio: number): Sprite {
  const key = `${text}|${color}|${size}|${ratio}`;
  let s = sprites.get(key);
  if (s) {
    s.used = ++spriteClock;
    return s;
  }
  if (!fontsWatched && typeof document !== 'undefined' && document.fonts) {
    // A picture made before the web font arrived shows the fallback face: start again when fonts load.
    fontsWatched = true;
    document.fonts.addEventListener('loadingdone', () => sprites.clear());
  }
  const canvas = document.createElement('canvas');
  const c = canvas.getContext('2d')!;
  const font = FONT(size);
  const pad = 4;
  c.font = font;
  const w = Math.ceil(c.measureText(text).width) + pad * 2, h = Math.ceil(size * 1.45) + pad * 2;
  canvas.width = Math.ceil(w * ratio);
  canvas.height = Math.ceil(h * ratio);
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  c.font = font;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.lineWidth = 3.5;
  c.lineJoin = 'round';
  c.strokeStyle = 'rgba(11, 15, 23, 0.9)';
  c.fillStyle = color;
  const base = pad + size * 1.08;
  c.strokeText(text, w / 2, base);
  c.fillText(text, w / 2, base);
  s = { canvas, w, h, base, used: ++spriteClock };
  sprites.set(key, s);
  if (sprites.size > SPRITE_MAX) {
    let oldest = '', when = Infinity;
    for (const [k, v] of sprites) if (v.used < when) { when = v.used; oldest = k; }
    sprites.delete(oldest);
  }
  return s;
}

function drawOne(c: CanvasRenderingContext2D, p: Particle, ratio: number) {
  const u = p.t / p.ttl;
  switch (p.kind) {
    case SPARK: {
      c.globalAlpha = 1 - u * u;
      c.fillStyle = p.color;
      c.beginPath();
      const r = p.size * (1 - u * 0.6);
      if (p.shape) addShape(c, p.shape, p.x, p.y, r * 1.5);
      else c.arc(p.x, p.y, r, 0, Math.PI * 2);
      c.fill();
      break;
    }
    case COIN: {
      const x = p.vx, y = p.vy;
      const r = p.size * (u < 0.15 ? 0.5 + u / 0.3 : u > 0.85 ? 1 - (u - 0.85) * 3 : 1);
      const alpha = u < 0.1 ? u * 10 : 1;
      // Two fading echoes just behind it, so the eye reads direction as well as position.
      c.fillStyle = p.color;
      for (let g = 1; g <= 2 && u > 0.05; g++) {
        const e0 = easeInOut(u - 0.022 * g), a0 = 1 - e0;
        c.globalAlpha = alpha * (0.34 - 0.12 * g);
        c.beginPath();
        c.arc(a0 * a0 * p.x + 2 * a0 * e0 * p.cx + e0 * e0 * p.tx, a0 * a0 * p.y + 2 * a0 * e0 * p.cy + e0 * e0 * p.ty, r * (1 - 0.22 * g), 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = alpha;
      c.fillStyle = p.color;
      c.beginPath();
      if (p.shape) {
        addShape(c, p.shape, x, y, r);
        c.fill();
        break;
      }
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = alpha * 0.55;
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(x - r * 0.3, y - r * 0.3, r * 0.38, 0, Math.PI * 2);
      c.fill();
      break;
    }
    case TEXT: {
      // Drawn once into a small picture of its own, then stamped each frame: stroking text is the
      // dearest thing a canvas does, and a floater lives for sixty frames.
      const sp = textSprite(p.text, p.color, p.size, ratio);
      const rise = p.vy * (1 - (1 - u) * (1 - u));
      // It pops in a little too big and settles, then rises. (With less motion asked for: neither.)
      // The pop takes about a fifth of a second, however long the text then stays.
      const v = p.t / 1.05;
      const s = p.flags & F_STILL ? 1 : v < 0.1 ? 0.6 + v * 6 : v < 0.22 ? 1.2 - ((v - 0.1) / 0.12) * 0.2 : 1;
      const left = p.ttl - p.t;
      c.globalAlpha = left >= p.fade ? 1 : Math.max(0, left / p.fade);
      c.drawImage(sp.canvas, p.x - (sp.w * s) / 2, p.y - rise - sp.base * s, sp.w * s, sp.h * s);
      break;
    }
    case RING: {
      const e = 1 - (1 - u) * (1 - u);
      c.globalAlpha = (1 - u) * 0.9;
      c.strokeStyle = p.color;
      c.lineWidth = 2.5 * (1 - u) + 0.5;
      c.beginPath();
      c.arc(p.x, p.y, 5 + (p.size - 5) * e, 0, Math.PI * 2);
      c.stroke();
      break;
    }
    case POP: {
      const e = 1 - (1 - u) * (1 - u);
      c.globalAlpha = (1 - u) * 0.6;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.size * (1 + 0.7 * e), 0, Math.PI * 2);
      c.fill();
      break;
    }
  }
}

/**
 * Draw the particles that are on this layer this frame. A particle that is also showing through the
 * top layer's window is drawn here with the window cut out, so the two halves meet without overlapping.
 */
function drawParticles(c: CanvasRenderingContext2D, layer: number, ratio: number, fastOnly = false) {
  const bit = 1 << layer;
  const split = layer !== TOP && splitBy[layer] > 0 && top;
  const need = fastOnly ? F_FAST : 0;
  for (const p of pool) {
    if (p.kind === 0 || !(p.mask & bit) || p.t < 0 || (p.flags & need) !== need) continue;
    if (split && p.mask & B_TOP) continue;
    drawOne(c, p, ratio);
  }
  if (split) {
    c.save();
    c.globalAlpha = 1;
    c.beginPath();
    c.rect(-1e5, -1e5, 2e5, 2e5);
    c.rect(top!.x, top!.y, top!.w, top!.h);
    c.clip('evenodd');
    for (const p of pool) if (p.kind !== 0 && p.mask & bit && p.mask & B_TOP && p.t >= 0 && (p.flags & need) === need) drawOne(c, p, ratio);
    c.restore();
  }
  c.globalAlpha = 1;
}

// ---------- overlays ----------

/**
 * Something that draws itself each frame while it is active (the guiding hand, a celebration).
 * `draw` gets a context whose units are client pixels, like everything else here.
 */
export interface Overlay {
  active(): boolean;
  draw(c: CanvasRenderingContext2D, dt: number): void;
  /**
   * It changes slowly and stands still on the screen (the Flow State glow along the board's edge): on a
   * busy board it may be drawn about 30 times a second, like the dots. Anything else is drawn on every
   * frame while it is active. `dt` is then the time since it was last drawn.
   */
  slow?: boolean;
}

const overlays: [Overlay[], Overlay[]] = [[], []];
/** For each overlay on the board layer, the time since it was last drawn (s): what its next draw is given as `dt`. */
const overlayDue: number[] = [];

/** Register an overlay on the board layer (under the HUD), or with `onTop` on the top layer above everything. */
export function addOverlay(o: Overlay, onTop = false) {
  overlays[onTop ? TOP : BOARD].push(o);
  if (!onTop) overlayDue.push(0);
}

/** Draw the board layer's active overlays (only those that cannot wait, with `urgentOnly`), each with the time since it was last drawn. */
function drawBoardOverlays(c: CanvasRenderingContext2D, urgentOnly: boolean) {
  const list = overlays[BOARD];
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if ((urgentOnly && o.slow) || !o.active()) continue;
    o.draw(c, overlayDue[i]);
    overlayDue[i] = 0;
  }
}

const anyActive = (list: Overlay[]) => {
  for (const o of list) if (o.active()) return true;
  return false;
};

/** An overlay is active that must be drawn on every frame. */
const anyUrgent = (list: Overlay[]) => {
  for (const o of list) if (!o.slow && o.active()) return true;
  return false;
};

/** Add a material's dot outline to the current path (for overlays that want the same shapes as the wires). */
export const shapePath = addShape;

// ---------- frame ----------

/** Seconds for the mood to follow its target. */
const MOOD_EASE = 0.9;
/** The board layer's last frame had particles or an overlay on it. */
let boardExtras = false;

/**
 * Advance and draw everything. Call once per animation frame.
 * `covered` means the board cannot be seen (a full-screen overlay is up): wire dots, port pulses and
 * everything else on the board layer are then skipped. Particles still run, so an `onArrive`
 * callback is never left waiting, and the layers above the panels are drawn as usual.
 */
export function frameFx(dt: number, view: { x: number; y: number; k: number }, paused: boolean, covered = false) {
  if (!ctx || !canvas) return;
  if (sizeDirty) resize();
  const pdt = Math.min(dt, 0.1);
  if (mood !== moodTarget) {
    // (With less motion asked for the dots do not grow by degrees: the mood is simply where it should be.)
    if (isCalm()) mood = moodTarget;
    else mood += (moodTarget - mood) * (1 - Math.exp(-pdt / MOOD_EASE));
    if (Math.abs(moodTarget - mood) < 0.003) mood = moodTarget;
    // (Still dots are drawn again at their new size.)
    stale = true;
  }
  if (live) stepParticles(pdt);
  frameBoard(ctx, canvas, dt, pdt, view, paused, covered);
  if (top) frameSurface(top, liveBy[TOP], overlays[TOP], TOP, pdt);
  if (bar && bar.h > 0) frameSurface(bar, liveBy[BAR], null, BAR, pdt);
}

/** The board layer is on screen (it is hidden while it has nothing on it: see frameBoard). */
let boardShown = true;

function showBoardLayer(cv: HTMLCanvasElement, on: boolean) {
  if (boardShown === on) return;
  boardShown = on;
  cv.style.visibility = on ? '' : 'hidden';
}

function frameBoard(c: CanvasRenderingContext2D, cv: HTMLCanvasElement, dt: number, pdt: number, view: { x: number; y: number; k: number }, paused: boolean, covered: boolean) {
  // Is the camera moving? (A pan, a pinch, the wheel or a glide: the board moves it, and it shows here
  // as a view that differs from the last frame's.)
  if (view.x !== camX || view.y !== camY || view.k !== camK) {
    camX = view.x; camY = view.y; camK = view.k;
    stillFor = 0;
  } else stillFor += dt;
  const list = overlays[BOARD];
  for (let i = 0; i < list.length; i++) overlayDue[i] = Math.min(0.25, overlayDue[i] + pdt);
  const busy = flows.length > BUSY_WIRES;
  // Dots that do not travel this frame: the game is paused (or less motion is asked for), or a card is up.
  const still = paused || held;
  if (!held) beaconClock += pdt;
  sinceDraw += dt;
  // (The time the dots move on by when next drawn: none while they are held, so they pick up where they
  // stopped rather than jumping on by the length of the pause.)
  flowDue = still ? 0 : flowDue + dt;
  const over = !covered && anyActive(list);
  const parts = covered ? 0 : liveBy[BOARD];
  // The frame after the last particle or overlay has gone must be drawn once more, or (while paused,
  // when nothing else asks for a redraw) its last image would stay on the canvas.
  const extras = over || parts > 0;
  if (boardExtras && !extras) stale = true;
  boardExtras = extras;
  const wipeAll = () => {
    if (!wasBlank) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, cv.width, cv.height);
      wasBlank = true;
      // An empty canvas the size of the board still costs the browser a full-screen blend on every frame
      // in which anything else on screen changes (measured: a pan on a large factory ran 8 fps faster with
      // it hidden), so it is put out of sight until there is something to draw on it again.
      showBoardLayer(cv, false);
    }
    lastKey = '';
  };
  if (covered) {
    dotCount = 0;
    stale = false;
    return wipeAll();
  }
  // What cannot wait for the next slot of a busy board: a spark, a ring, a reward's coin, or an overlay
  // that follows the camera or the hand.
  const urgentOver = over && anyUrgent(list);
  const urgent = fastOnBoard > 0 || urgentOver;
  if (busy && stillFor < SETTLE) {
    // A busy board while the camera moves: only what cannot wait is drawn, and the dots, the port pulses,
    // the floating figures and the coins of sales come back (fading in) once it has stopped.
    boardHidden = true;
    dotsIn = 0;
    flowDue = 0;
    dotCount = 0;
    if (!urgent) return wipeAll();
    boardDraws++;
    wasBlank = false;
    showBoardLayer(cv, true);
    lastKey = '';
    sinceDraw = 0;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.setTransform(dpr, 0, 0, dpr, -originX * dpr, -originY * dpr);
    if (urgentOver) drawBoardOverlays(c, true);
    if (fastOnBoard) drawParticles(c, BOARD, dpr, true);
    return;
  }
  boardHidden = false;
  if (dotsIn < 1) dotsIn = Math.min(1, dotsIn + dt / DOTS_IN);
  // A busy board otherwise waits for its next slot, about 30 times a second.
  if (busy && !urgent && sinceDraw < BUSY_GAP) return;
  const total = stepFlows(flowDue, view, still);
  flowDue = 0;
  let pulsing = false;
  for (const b of beacons) {
    if (onScreen(b, view)) {
      pulsing = true;
      break;
    }
  }
  if (!total) dotCount = 0;
  if (!total && !parts && !pulsing && !over) {
    stale = false;
    sinceDraw = 0;
    return wipeAll();
  }
  // Still dots with nothing else moving: the last frame is still right unless the view or the wires
  // changed, or the dots are still fading back in. (Port pulses keep breathing while paused, so they count
  // as movement; while a card is up they hold still too.)
  const key = `${view.x}|${view.y}|${view.k}`;
  if (still && !parts && !(pulsing && !held) && !over && !stale && key === lastKey && dotsIn >= 1) return;
  lastKey = key;
  stale = false;
  wasBlank = false;
  showBoardLayer(cv, true);
  sinceDraw = 0;
  boardDraws++;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  // (Fading back in after the camera moved: an opacity change only.)
  if (dotsIn < 1) c.globalAlpha = dotsIn * dotsIn * (3 - 2 * dotsIn);
  if (pulsing) drawBeacons(c, view);
  if (total) drawFlows(c, view);
  c.globalAlpha = 1;
  if (!over && !parts) return;
  // Overlays and particles work in client pixels: shift so that the canvas corner is where it is on screen.
  c.setTransform(dpr, 0, 0, dpr, -originX * dpr, -originY * dpr);
  if (over) drawBoardOverlays(c, false);
  if (parts) drawParticles(c, BOARD, dpr);
}

/** One of the layers above the panels: wiped once when it empties, otherwise cleared and redrawn. */
function frameSurface(s: Surface, parts: number, list: Overlay[] | null, layer: number, pdt: number) {
  const c = s.ctx;
  if (!c) return;
  const over = !!list && anyActive(list);
  if (!parts && !over) {
    if (!s.blank) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, s.canvas.width, s.canvas.height);
      s.blank = true;
    }
    // (Out of sight while empty, like the board layer: an empty canvas on screen is still blended on every frame.)
    if (s.shown) {
      s.shown = false;
      s.canvas.style.visibility = 'hidden';
    }
    return;
  }
  if (!s.shown) {
    s.shown = true;
    s.canvas.style.visibility = '';
  }
  s.blank = false;
  c.setTransform(s.ratio, 0, 0, s.ratio, -s.x * s.ratio, -s.y * s.ratio);
  c.clearRect(s.x, s.y, s.w, s.h);
  if (over) for (const o of list!) if (o.active()) o.draw(c, pdt);
  if (parts) drawParticles(c, layer, s.ratio);
}

/** Numbers for tests and tuning. `width`, `height` and `dpr` describe the board layer. */
export function fxStats() {
  // Particles that travel or swell (everything but floating text): none while less motion is asked for.
  let moving = 0;
  for (const p of pool) if (p.kind !== 0 && p.kind !== TEXT) moving++;
  return {
    dots: dotCount, particles: live, moving, pool: POOL, thin: +thin.toFixed(2), width: canvas?.width ?? 0, height: canvas?.height ?? 0, dpr,
    top: { particles: liveBy[TOP], width: top?.canvas.width ?? 0, height: top?.canvas.height ?? 0 },
    bar: { particles: liveBy[BAR], width: bar?.canvas.width ?? 0, height: bar?.canvas.height ?? 0 },
    mood: +mood.toFixed(2),
    /**
     * The board layer: redraws since the page loaded; whether the factory is big enough to be drawn at about
     * 30 Hz (`busy`); whether its dots are left out because the camera is moving (`hidden`); whether they
     * are held still for a celebration card (`held`).
     */
    draws: boardDraws, busy: flows.length > BUSY_WIRES, wires: flows.length, hidden: boardHidden, held,
  };
}

export const fx = { burst, fly, floater, ring, pop, stats: fxStats };

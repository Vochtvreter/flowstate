// One canvas over the stage for everything that moves every frame: the dots travelling along
// flowing wires, and a small pooled particle system (bursts, coins that fly somewhere, floating
// text, rings). Nothing here touches the DOM after init, and nothing here knows about the game:
// the board hands over wire geometry as `Flow` objects, everyone else calls the particle functions.
//
// Points passed to the particle functions are in client pixels (the same space as pointer events
// and getBoundingClientRect), so any HUD element or board position can be a source or a target.

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

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let host: HTMLElement | null = null;
let W = 0, H = 0, dpr = 1;
let originX = 0, originY = 0;
let sizeDirty = true;
let flows: Flow[] = [];
let stale = true;
let wasBlank = true;
let lastKey = '';
let thin = 1;
let dotCount = 0;

export function initFx(c: HTMLCanvasElement) {
  canvas = c;
  host = c.parentElement;
  ctx = c.getContext('2d');
  if (typeof ResizeObserver !== 'undefined' && host) new ResizeObserver(() => (sizeDirty = true)).observe(host);
  window.addEventListener('resize', () => (sizeDirty = true));
}

function resize() {
  if (!canvas || !host) return;
  sizeDirty = false;
  const r = host.getBoundingClientRect();
  originX = r.left;
  originY = r.top;
  const d = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (w === W && h === H && d === dpr) return;
  W = w; H = h; dpr = d;
  canvas.width = Math.round(w * d);
  canvas.height = Math.round(h * d);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  stale = true;
}

/** The wires to draw dots on. Call again whenever wires are added or removed. */
export function setFlows(list: Flow[]) {
  // Same colour and shape next to each other, so each group is one path and one fill.
  flows = list.slice().sort((a, b) => (a.color + a.shape < b.color + b.shape ? -1 : a.color + a.shape > b.color + b.shape ? 1 : 0));
  stale = true;
}

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
  const s = 0.5 - 0.5 * Math.cos((beaconClock / 1.6) * Math.PI * 2);
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
    const base = Math.max(1.5, (3.6 + Math.min(2.4, f.rate * 0.5)) * k);
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

const SPARK = 1, COIN = 2, TEXT = 3, RING = 4;
const POOL = 360;

interface Particle {
  kind: number;
  t: number; ttl: number;
  x: number; y: number; vx: number; vy: number;
  cx: number; cy: number; tx: number; ty: number;
  size: number; color: string; text: string;
  done: { fn: (() => void) | null } | null;
}

const pool: Particle[] = [];
for (let i = 0; i < POOL; i++) {
  pool.push({ kind: 0, t: 0, ttl: 1, x: 0, y: 0, vx: 0, vy: 0, cx: 0, cy: 0, tx: 0, ty: 0, size: 1, color: '#fff', text: '', done: null });
}
let live = 0;
let cursor = 0;

function spawn(kind: number): Particle | null {
  for (let i = 0; i < POOL; i++) {
    const p = pool[(cursor + i) % POOL];
    if (p.kind === 0) {
      cursor = (cursor + i + 1) % POOL;
      p.kind = kind;
      p.t = 0;
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
}

/** A spray of sparks. */
export function burst(at: Pt, color: string, count = 10) {
  for (let i = 0; i < count; i++) {
    const p = spawn(SPARK);
    if (!p) return;
    const a = Math.random() * Math.PI * 2;
    const v = 70 + Math.random() * 150;
    p.x = at.x - originX;
    p.y = at.y - originY;
    p.vx = Math.cos(a) * v;
    p.vy = Math.sin(a) * v - 40;
    p.ttl = 0.4 + Math.random() * 0.3;
    p.size = 1.6 + Math.random() * 1.8;
    p.color = color;
  }
}

/**
 * Send `count` coin-like particles from one point to another along slightly different arcs.
 * `onArrive` runs once, when the first of them lands.
 */
export function fly(from: Pt, to: Pt, color: string, count = 3, onArrive?: () => void) {
  const done = { fn: onArrive ?? null };
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist, ny = dx / dist;
  for (let i = 0; i < count; i++) {
    const p = spawn(COIN);
    if (!p) break;
    const bend = (Math.random() * 0.5 + 0.15) * dist * (i % 2 ? -0.45 : 0.45);
    p.x = from.x - originX + (Math.random() * 12 - 6);
    p.y = from.y - originY + (Math.random() * 12 - 6);
    p.tx = to.x - originX;
    p.ty = to.y - originY;
    p.cx = (p.x + p.tx) / 2 + nx * bend;
    p.cy = (p.y + p.ty) / 2 + ny * bend;
    p.t = -i * 0.06; // staggered start
    p.ttl = Math.min(0.9, 0.38 + dist / 2600) + Math.random() * 0.08;
    p.size = 4.2;
    p.color = color;
    p.done = done;
  }
  if (!count && onArrive) onArrive();
}

/** Text that rises and fades. */
export function floater(at: Pt, text: string, color: string, size = 13) {
  const p = spawn(TEXT);
  if (!p) return;
  p.x = at.x - originX;
  p.y = at.y - originY;
  p.ttl = 0.95;
  p.size = size;
  p.color = color;
  p.text = text;
}

/** An expanding ring. */
export function ring(at: Pt, color: string) {
  const p = spawn(RING);
  if (!p) return;
  p.x = at.x - originX;
  p.y = at.y - originY;
  p.ttl = 0.45;
  p.size = 30;
  p.color = color;
}

function drawParticles(c: CanvasRenderingContext2D, dt: number) {
  let font = '';
  for (const p of pool) {
    if (p.kind === 0) continue;
    p.t += dt;
    if (p.t < 0) continue; // still waiting for its staggered start
    const u = p.t / p.ttl;
    if (u >= 1) {
      if (p.kind === COIN && p.done?.fn) {
        const fn = p.done.fn;
        p.done.fn = null;
        fn();
      }
      kill(p);
      continue;
    }
    switch (p.kind) {
      case SPARK: {
        p.vx *= 1 - 3.2 * dt;
        p.vy = p.vy * (1 - 3.2 * dt) + 320 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        c.globalAlpha = 1 - u * u;
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.size * (1 - u * 0.6), 0, Math.PI * 2);
        c.fill();
        break;
      }
      case COIN: {
        const e = u < 0.5 ? 2 * u * u : 1 - (2 - 2 * u) * (2 - 2 * u) / 2;
        const a = 1 - e;
        const x = a * a * p.x + 2 * a * e * p.cx + e * e * p.tx;
        const y = a * a * p.y + 2 * a * e * p.cy + e * e * p.ty;
        const r = p.size * (u < 0.15 ? 0.5 + u / 0.3 : u > 0.85 ? 1 - (u - 0.85) * 3 : 1);
        c.globalAlpha = u < 0.1 ? u * 10 : 1;
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha *= 0.55;
        c.fillStyle = '#fff';
        c.beginPath();
        c.arc(x - r * 0.3, y - r * 0.3, r * 0.38, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case TEXT: {
        const rise = 30 * (1 - (1 - u) * (1 - u));
        const f = `600 ${p.size}px "JetBrains Mono", ui-monospace, Menlo, monospace`;
        if (f !== font) c.font = font = f;
        c.textAlign = 'center';
        c.textBaseline = 'alphabetic';
        c.globalAlpha = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
        c.lineWidth = 3;
        c.lineJoin = 'round';
        c.strokeStyle = 'rgba(11, 15, 23, 0.85)';
        c.strokeText(p.text, p.x, p.y - rise);
        c.fillStyle = p.color;
        c.fillText(p.text, p.x, p.y - rise);
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
    }
  }
  c.globalAlpha = 1;
}

// ---------- frame ----------

/**
 * Advance and draw everything. Call once per animation frame.
 * `covered` means the board cannot be seen (a full-screen overlay is up): wire dots and port pulses
 * are then skipped, but particles still run, so an `onArrive` callback is never left waiting.
 */
export function frameFx(dt: number, view: { x: number; y: number; k: number }, paused: boolean, covered = false) {
  if (!ctx || !canvas) return;
  if (sizeDirty) resize();
  const total = covered ? 0 : stepFlows(dt, view, paused);
  beaconClock += Math.min(dt, 0.1);
  let pulsing = false;
  if (!covered) {
    for (const b of beacons) {
      if (onScreen(b, view)) {
        pulsing = true;
        break;
      }
    }
  }
  if (!total && !live && !pulsing) {
    if (!wasBlank) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      wasBlank = true;
    }
    stale = false;
    lastKey = '';
    return;
  }
  // Paused with nothing moving: the last frame is still right unless the view or the wires changed.
  // (Beacons keep breathing while paused, so they count as movement.)
  const key = `${view.x}|${view.y}|${view.k}`;
  if (paused && !live && !pulsing && !stale && key === lastKey) return;
  lastKey = key;
  stale = false;
  wasBlank = false;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (pulsing) drawBeacons(ctx, view);
  if (total) drawFlows(ctx, view);
  if (live) drawParticles(ctx, Math.min(dt, 0.1));
}

/** Numbers for tests and tuning. */
export function fxStats() {
  return { dots: dotCount, particles: live, thin: +thin.toFixed(2), width: canvas?.width ?? 0, height: canvas?.height ?? 0, dpr };
}

export const fx = { burst, fly, floater, ring, stats: fxStats };

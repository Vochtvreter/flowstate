import { MATERIALS, MatId, NodeType, RECIPES } from '../content';
import { materialsAt, nodeById } from '../actions';
import { recipeOf } from '../economy';
import { isMachine, isSink } from '../sim';
import { Game, GNode, Wire } from '../state';

export const NODE_W = 172;

export function nodeSize(n: GNode): { w: number; h: number } {
  if (isMachine(n)) {
    const r = recipeOf(n);
    const ports = r ? Math.max(r.inputs.length, r.outputs.length) : 1;
    return { w: NODE_W, h: ports >= 3 ? 112 : ports === 2 ? 92 : 72 };
  }
  if (n.type === 'router' || n.type === 'merger' || n.type === 'void') return { w: 136, h: 60 };
  return { w: NODE_W, h: 72 };
}

const tallest: Partial<Record<NodeType, number>> = {};

/**
 * Height to keep clear for a card of this type. A machine's card grows when it is given a recipe
 * with more ports (an Assembler on its first wire, a Refiner switched to Ink), so the tallest it can
 * become is kept free from the start and it can never grow into the card below.
 */
export function roomFor(type: NodeType, h: number): number {
  let max = tallest[type];
  if (max == null) {
    max = 0;
    for (const r of Object.values(RECIPES)) if (r.machine === type) max = Math.max(max, nodeSize({ type, recipe: r.id } as GNode).h);
    tallest[type] = max;
  }
  return Math.max(h, max);
}

export interface Port { x: number; y: number; mat: MatId | null; index: number }

const spread = (h: number, count: number, i: number) => (h * (i + 1)) / (count + 1);

export function inPorts(n: GNode): Port[] {
  if (n.type === 'well') return [];
  const { h } = nodeSize(n);
  const r = isMachine(n) ? recipeOf(n) : null;
  if (r) return r.inputs.map(([m], i) => ({ x: n.x, y: n.y + spread(h, r.inputs.length, i), mat: m, index: i }));
  return [{ x: n.x, y: n.y + h / 2, mat: null, index: 0 }];
}

export function outPorts(g: Game, n: GNode): Port[] {
  if (isSink(n)) return [];
  const { w, h } = nodeSize(n);
  const r = isMachine(n) ? recipeOf(n) : null;
  if (r) return r.outputs.map(([m], i) => ({ x: n.x + w, y: n.y + spread(h, r.outputs.length, i), mat: m, index: i }));
  const mats = materialsAt(g, n.id, 0);
  return [{ x: n.x + w, y: n.y + h / 2, mat: mats[0] ?? null, index: 0 }];
}

export interface Pt { x: number; y: number }

export function wireEnds(g: Game, w: Wire): { a: Pt; b: Pt; mat: MatId | null } | null {
  const from = nodeById(g, w.from);
  const to = nodeById(g, w.to);
  if (!from || !to) return null;
  const outs = outPorts(g, from);
  const a = outs[Math.min(w.port, outs.length - 1)];
  if (!a) return null;
  const mats = materialsAt(g, w.from, w.port);
  const ins = inPorts(to);
  let b = ins[0];
  const match = ins.find((p) => p.mat && mats.includes(p.mat));
  if (match) b = match;
  if (!b) return null;
  return { a, b, mat: w.mat ?? mats[0] ?? null };
}

export function curve(a: Pt, b: Pt): [Pt, Pt, Pt, Pt] {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return [a, { x: a.x + dx, y: a.y }, { x: b.x - dx, y: b.y }, b];
}

export function pathD(a: Pt, b: Pt): string {
  const [p0, p1, p2, p3] = curve(a, b);
  return `M${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
}

export function bezierAt(a: Pt, b: Pt, t: number): Pt {
  const [p0, p1, p2, p3] = curve(a, b);
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

export function samples(a: Pt, b: Pt, n = 16): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push(bezierAt(a, b, i / n));
  return out;
}

export function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

export const matColor = (m: MatId | null) => (m ? MATERIALS[m].color : '#8C97AD');

// ---------- camera ----------

export interface View { x: number; y: number; k: number }

/**
 * The view after two fingers have moved. `v0`, `m0` and `d0` are the view, the fingers' midpoint
 * (board-local pixels) and their spread when the pair formed; `m1` and `d1` are the midpoint and
 * spread now. The board point that was under the midpoint stays under it, whatever `clampK` does
 * to the zoom, so fingers that move together pan and fingers that spread zoom about their middle.
 */
export function pinchView(v0: View, m0: Pt, d0: number, m1: Pt, d1: number, clampK: (k: number) => number): View {
  const k = clampK((v0.k * d1) / d0);
  return { x: m1.x - ((m0.x - v0.x) / v0.k) * k, y: m1.y - ((m0.y - v0.y) / v0.k) * k, k };
}

/** The zoom at which each view tier ends. Below `floor` cards are icons (the overview); `min` is as far out as the board ever goes. */
export const ZOOM = { floor: 0.7, phoneFloor: 0.74, min: 0.25 };

export interface Box { x0: number; y0: number; x1: number; y1: number }

export const boxUnion = (a: Box | null, b: Box): Box =>
  a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : { ...b };

/** The largest zoom, up to `kMax`, at which a world box fits a screen area. */
export const fitZoom = (box: Box, area: Box, kMax = 1) =>
  Math.min(kMax, Math.max(1, area.x1 - area.x0) / Math.max(1, box.x1 - box.x0), Math.max(1, area.y1 - area.y0) / Math.max(1, box.y1 - box.y0));

/** The view that puts the middle of a world box in the middle of a screen area at zoom `k`. */
export const centreView = (box: Box, area: Box, k: number): View => ({
  x: (area.x0 + area.x1) / 2 - ((box.x0 + box.x1) / 2) * k,
  y: (area.y0 + area.y1) / 2 - ((box.y0 + box.y1) / 2) * k,
  k,
});

/**
 * Frame a world box in a screen area: the largest zoom up to `kMax` that shows all of it, centred. When
 * that zoom would be under `floor` (where cards can still be read) the view is the overview instead, no
 * further out than `min`; a box too big even for that is centred at `min`.
 */
export function fitBox(box: Box, area: Box, floor: number, min = ZOOM.min, kMax = 1): View {
  const k = fitZoom(box, area, kMax);
  return centreView(box, area, k >= floor ? k : Math.max(min, k));
}

/**
 * Move the camera as little as possible so that a world box lies inside a screen area. The zoom is kept
 * when the box fits at it; otherwise the camera pulls back, but never past `floor`. A box that does not
 * fit even there keeps its top left corner in view. Returns the same view object when nothing has to move.
 */
export function frameBox(v: View, box: Box, area: Box, floor: number): View {
  const k = Math.min(v.k, Math.max(Math.min(floor, v.k), fitZoom(box, area, v.k)));
  let x = v.x, y = v.y;
  if (k !== v.k) {
    // Pull back about the middle of the area, so what was in view stays roughly where it was.
    const mx = (area.x0 + area.x1) / 2, my = (area.y0 + area.y1) / 2;
    x = mx - ((mx - v.x) / v.k) * k;
    y = my - ((my - v.y) / v.k) * k;
  }
  const slide = (lo: number, hi: number, a0: number, a1: number) => {
    // lo..hi is the box on screen along one axis; a0..a1 the room for it. Returns how far to move.
    if (hi - lo > a1 - a0) return a0 - lo;
    if (lo < a0) return a0 - lo;
    if (hi > a1) return a1 - hi;
    return 0;
  };
  x += slide(box.x0 * k + x, box.x1 * k + x, area.x0, area.x1);
  y += slide(box.y0 * k + y, box.y1 * k + y, area.y0, area.y1);
  if (Math.abs(x - v.x) < 0.5 && Math.abs(y - v.y) < 0.5 && k === v.k) return v;
  return { x, y, k };
}

// ---------- where a card may stand ----------

/** Clear space kept between two cards, and between a card and a deposit with no Well on it. */
export const CARD_GAP = 16;
/** Cards stay this far inside the edge of the plot. */
export const PLOT_MARGIN = 20;

export interface SpotQuery {
  /** Where the top left corner of the card is wanted. */
  x: number; y: number;
  w: number; h: number;
  /** What to keep clear of: the other cards (each as tall as it may become) and the free deposits. */
  avoid: Box[];
  board: { w: number; h: number };
  /** The grid cards stand on. */
  grid: number;
  /**
   * The direction of the wire that leads to the card, when there is one (any length). A card that
   * cannot stand where it is wanted then goes further along the wire rather than back toward where the
   * wire came from, and to a row above or below before it goes back.
   */
  dir?: Pt;
}

/** True when a w×h card at (x, y) keeps `gap` clear of every box. */
export function spotFree(x: number, y: number, w: number, h: number, avoid: Box[], gap = CARD_GAP): boolean {
  for (const b of avoid) {
    if (x < b.x1 + gap && x + w + gap > b.x0 && y < b.y1 + gap && y + h + gap > b.y0) return false;
  }
  return true;
}

/** Sideways from the wire costs this much more than along it, and going back against it this much more. */
const SIDE = 1.5, BACK = 3;

/**
 * The spot on the grid nearest to where a card is wanted at which it stands inside the plot and keeps
 * CARD_GAP clear of everything in `avoid`. Null when the plot has no such spot left.
 *
 * "Nearest" is plain distance (sideways counting a little less: cards are wider than tall), unless the
 * card arrives on a wire (`dir`): then distance along the wire is the cheapest, a row above or below
 * costs half as much again, and going back toward the wire's start three times as much.
 */
export function freeSpot(q: SpotQuery): Pt | null {
  const { w, h, avoid, board, grid } = q;
  const snap = (v: number) => Math.round(v / grid) * grid;
  // The grid lines a card of this size can stand on inside the plot.
  const gx0 = Math.ceil(PLOT_MARGIN / grid) * grid, gy0 = Math.ceil(PLOT_MARGIN / grid) * grid;
  const gx1 = Math.floor((board.w - w - PLOT_MARGIN) / grid) * grid, gy1 = Math.floor((board.h - h - PLOT_MARGIN) / grid) * grid;
  if (gx1 < gx0 || gy1 < gy0) return null;
  const bx = Math.max(gx0, Math.min(gx1, snap(q.x))), by = Math.max(gy0, Math.min(gy1, snap(q.y)));
  if (spotFree(bx, by, w, h, avoid)) return { x: bx, y: by };
  const len = q.dir ? Math.hypot(q.dir.x, q.dir.y) : 0;
  const ux = len > 1e-6 ? q.dir!.x / len : 0, uy = len > 1e-6 ? q.dir!.y / len : 0;
  let best: Pt | null = null;
  let bestCost = Infinity;
  for (let y = gy0; y <= gy1; y += grid) {
    for (let x = gx0; x <= gx1; x += grid) {
      const ox = x - bx, oy = y - by;
      let cost: number;
      if (len > 1e-6) {
        const along = ox * ux + oy * uy, side = Math.abs(ox * uy - oy * ux);
        cost = (along >= 0 ? along : -along * BACK) + side * SIDE;
      } else cost = Math.hypot(ox * 0.9, oy);
      if (cost >= bestCost) continue;
      if (!spotFree(x, y, w, h, avoid)) continue;
      bestCost = cost;
      best = { x, y };
    }
  }
  return best;
}

export interface Card { id: number; x: number; y: number; w: number; h: number; /** Height to keep clear for it (it may grow). */ room: number; /** A Well: it stays on its deposit. */ fixed: boolean }

/** True when two cards share any ground at all (touching edges do not count). */
export const cardsOverlap = (a: Card, b: Card) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Pull apart cards that rest on top of one another (a board from an old save, or one a script laid
 * out). Cards are taken in order: one that overlaps a card before it in the list, or a Well, has to move;
 * every other card stays exactly where it is. Each card that has to move then goes to the nearest spot
 * clear of all the cards that stayed and of those already moved. Wells never move. Returns the new
 * positions of the cards that moved; a board with no overlap comes back untouched.
 */
export function separate(cards: Card[], deposits: Box[], board: { w: number; h: number }, grid: number): Map<number, Pt> {
  const moved = new Map<number, Pt>();
  const kept: Card[] = cards.filter((c) => c.fixed);
  const loose: Card[] = [];
  for (const c of cards) {
    if (c.fixed) continue;
    if (kept.some((p) => cardsOverlap(p, c))) loose.push(c);
    else kept.push(c);
  }
  if (!loose.length) return moved;
  const avoid: Box[] = kept.map((c) => ({ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.room })).concat(deposits);
  for (const c of loose) {
    const spot = freeSpot({ x: c.x, y: c.y, w: c.w, h: c.room, avoid, board, grid }) ?? { x: c.x, y: c.y };
    if (spot.x !== c.x || spot.y !== c.y) moved.set(c.id, spot);
    avoid.push({ x0: spot.x, y0: spot.y, x1: spot.x + c.w, y1: spot.y + c.room });
  }
  return moved;
}

/**
 * A colour as it looks at `alpha` over the board's background, as a plain hex colour. (Wire dots are
 * drawn on a canvas in flat colours: this is how a dimmed wire's dots are dimmed.)
 */
export function fadeColor(hex: string, alpha: number, over = '#0b0f17'): string {
  const parse = (s: string) => {
    const v = s.replace('#', '');
    const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  };
  const a = parse(hex), b = parse(over);
  if (a.some(Number.isNaN)) return hex;
  return '#' + a.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}

// ---------- where the Expand button stands ----------

/** True when a screen box lies wholly inside `area` and keeps `gap` clear of every block. */
export function boxClear(b: Box, area: Box, blocks: Box[], gap = 0): boolean {
  if (b.x0 < area.x0 - 0.01 || b.y0 < area.y0 - 0.01 || b.x1 > area.x1 + 0.01 || b.y1 > area.y1 + 0.01) return false;
  for (const o of blocks) if (b.x0 < o.x1 + gap && b.x1 > o.x0 - gap && b.y0 < o.y1 + gap && b.y1 > o.y0 - gap) return false;
  return true;
}

export interface DockQuery {
  /** The middle of the button's natural place under the plot, in stage pixels. It may be far off screen. */
  home: Pt;
  /** The size the docked button has on screen. */
  w: number; h: number;
  /** The part of the stage it may stand in: what the player can see, less a margin. */
  area: Box;
  /** What it must keep clear of in there (the goal card, the corner controls, the key hints...), in stage pixels. */
  blocks: Box[];
  /** Clear space kept between the button and each block. */
  gap: number;
}

/**
 * Where the Expand button comes to rest when its natural place cannot be seen: the top left corner of
 * the place inside `area`, `gap` clear of every block, whose middle is nearest to `home`. (So it sits at
 * the edge of what the player sees, on the side where the plot's edge lies, and follows it along.)
 *
 * The nearest free place is either the natural one pushed straight into the area, or it touches the
 * side of a block or of the area on at least one axis: those are the only places tried. When there is
 * no free place at all (a stage smaller than the controls on it), the place inside the area that lies
 * over the least of them is given instead.
 */
export function dockSpot(q: DockQuery): Pt {
  const { home, w, h, area, blocks, gap } = q;
  // (An area smaller than the button: the button keeps its top left corner in it.)
  const maxX = Math.max(area.x0, area.x1 - w), maxY = Math.max(area.y0, area.y1 - h);
  const inX = (x: number) => Math.max(area.x0, Math.min(maxX, x)), inY = (y: number) => Math.max(area.y0, Math.min(maxY, y));
  const xs = new Set<number>([inX(home.x - w / 2), area.x0, maxX]);
  const ys = new Set<number>([inY(home.y - h / 2), area.y0, maxY]);
  for (const o of blocks) {
    for (const x of [o.x0 - gap - w, o.x1 + gap]) if (x >= area.x0 - 0.01 && x <= maxX + 0.01) xs.add(x);
    for (const y of [o.y0 - gap - h, o.y1 + gap]) if (y >= area.y0 - 0.01 && y <= maxY + 0.01) ys.add(y);
  }
  let best: Pt | null = null;
  let bestD = Infinity, bestOver = Infinity;
  for (const y of ys) {
    for (const x of xs) {
      // How much of the blocks (with their gap) this place would lie over: none, for a free one.
      let over = 0;
      for (const o of blocks) {
        const ox = Math.min(x + w, o.x1 + gap) - Math.max(x, o.x0 - gap), oy = Math.min(y + h, o.y1 + gap) - Math.max(y, o.y0 - gap);
        if (ox > 0.01 && oy > 0.01) over += ox * oy;
      }
      const d = (x + w / 2 - home.x) ** 2 + (y + h / 2 - home.y) ** 2;
      if (over < bestOver - 1e-6 || (Math.abs(over - bestOver) <= 1e-6 && d < bestD)) {
        bestOver = over;
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best ?? { x: area.x0, y: area.y0 };
}

// ---------- what floats over a Market or a Lab ----------

/**
 * Earnings come in fractions of a unit; what floats over a Market or a Lab is whole units. `carry` is
 * what the node has earned and not yet shown (always under one unit), `earned` what it earned since.
 * Returns how many whole units to show now and what is carried on, so that nothing is lost and nothing
 * invented: over any stretch of time, what was shown is what was earned, less the under-one-unit rest.
 */
export function wholeGain(carry: number, earned: number): { show: number; carry: number } {
  const total = Math.max(0, carry) + Math.max(0, earned);
  // (A sum of fractions that should come to a whole number may fall a hair short of it.)
  const show = Math.floor(total + 1e-6);
  return { show, carry: Math.max(0, total - show) };
}

// ---------- a wire's flow, shown without movement ----------

/**
 * The rate a wire's still pattern of dots is drawn for (when the player has asked for less motion).
 * A reading never quite sits still, and every change redraws the pattern, so the rate on show is held:
 * it is replaced only when the reading starts or stops, or has moved away from it by more than `by`
 * (a fifth) of the larger of the two.
 */
export function heldRate(held: number, rate: number, by = 0.2): number {
  if (held <= 0 || rate <= 0) return Math.max(0, rate);
  return Math.abs(rate - held) > by * Math.max(rate, held) ? rate : held;
}

// Tidy: lay a board out again so that wires are short and cross as little as possible, with no two
// cards on top of one another. Pure and deterministic: cards, wires and the plot in, positions out.
// Wells stay on their deposits; everything else may move.
//
// How it works. A layout is scored by what the player sees: the length of every wire as it is drawn
// (a wire that has to run backwards loops, and is long), plus a charge for every pair of wires that
// cross and for every card a wire runs behind. A card only moves when that is clearly worth it, and
// only to ground with room around it for its wires. Three layouts are tried and the best one that has
// no more crossings and no more wire than the board as it stands is taken:
//   1. the board as it stands, improved one card at a time (a card moves to a free spot, or two cards
//      change places, whenever that lowers the score);
//   2. a fresh layout, built left to right from the Wells (each card in the column its depth in the
//      line gives it, level with what feeds it), then improved the same way;
//   3. the board as it stands, improved only by steps that make neither the crossings nor the length
//      worse: slower to get anywhere, but it can never lose, so there is always an answer.
import { Game } from '../state';
import { Box, CARD_GAP, Card, PLOT_MARGIN, Pt, bezierAt, cardsOverlap, nodeSize, roomFor, separate, spotFree, wireEnds } from './geom';

export interface TidyNode extends Card {}
/** A wire, by the cards at its ends and how far down each card its port is. It leaves `from` on the right and enters `to` on the left. */
export interface TidyWire { from: number; to: number; ay: number; by: number }
export interface TidyInput {
  nodes: TidyNode[];
  wires: TidyWire[];
  /** Deposits with no Well on them: cards keep clear of these too. */
  deposits: Box[];
  board: { w: number; h: number };
  grid: number;
}
export interface BoardStats {
  /** Pairs of wires that cross. */
  crossings: number;
  /** Total length of the wires as drawn, in board px. */
  length: number;
  /** Pairs of cards that share ground. */
  overlaps: number;
  /** Times a wire runs behind a card that is not at either of its ends. */
  under: number;
  /** Wires that run backwards, right to left. */
  backward: number;
}

/** A crossing is charged like this many px of wire; so is a wire that runs behind a card, and one that has to run backwards (right to left). */
const CROSS = 140, UNDER = 260, BACK = 240;
/** A wire runs backwards when its far end is not at least this far to the right of its near end. */
const FORWARD = 24;
/** A move has to be worth this many px of wire before it is made: a board that is already neat is left alone. */
const WORTH = 30;
/** Clear ground a card that Tidy moves keeps to its sides (room for its wires to bend) and above and below. */
const ROOM_X = 56, ROOM_Y = 24;
/** Columns of a fresh layout stand this far apart (a card is 172 wide), starting where the first deposits are. */
const COL_X0 = 100, COL_PITCH = 240;
/** Straight pieces each wire is cut into when the board is measured, and (coarser, for speed) while layouts are compared. */
const SEGS = 16, SEARCH_SEGS = 8;

// ---------- measuring ----------

interface Poly { pts: Float64Array; segs: number; len: number; x0: number; y0: number; x1: number; y1: number; /** What running backwards costs this wire (0 for one that runs forwards). */ back: number }

function polyOf(ax: number, ay: number, bx: number, by: number, segs: number, out?: Poly): Poly {
  const p = out ?? { pts: new Float64Array((segs + 1) * 2), segs, len: 0, x0: 0, y0: 0, x1: 0, y1: 0, back: 0 };
  p.back = bx - ax < FORWARD ? BACK + (ax + FORWARD - bx) * 0.5 : 0;
  const a = { x: ax, y: ay }, b = { x: bx, y: by };
  let len = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, px = 0, py = 0;
  for (let i = 0; i <= segs; i++) {
    const q = bezierAt(a, b, i / segs);
    if (i) len += Math.hypot(q.x - px, q.y - py);
    p.pts[i * 2] = px = q.x;
    p.pts[i * 2 + 1] = py = q.y;
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.y > y1) y1 = q.y;
  }
  p.len = len;
  p.x0 = x0; p.y0 = y0; p.x1 = x1; p.y1 = y1;
  return p;
}

function polysCross(a: Poly, b: Poly): boolean {
  if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) return false;
  const p = a.pts, q = b.pts;
  const SEGS = a.segs;
  for (let i = 0; i < SEGS; i++) {
    const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[i * 2 + 2], by = p[i * 2 + 3];
    const lox = Math.min(ax, bx), hix = Math.max(ax, bx), loy = Math.min(ay, by), hiy = Math.max(ay, by);
    for (let j = 0; j < SEGS; j++) {
      const cx = q[j * 2], cy = q[j * 2 + 1], dx = q[j * 2 + 2], dy = q[j * 2 + 3];
      if (Math.max(cx, dx) < lox || Math.min(cx, dx) > hix || Math.max(cy, dy) < loy || Math.min(cy, dy) > hiy) continue;
      const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
      const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
      const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
  }
  return false;
}

/** True when a wire's path enters a box. */
function polyInBox(a: Poly, x0: number, y0: number, x1: number, y1: number): boolean {
  if (a.x1 < x0 || a.x0 > x1 || a.y1 < y0 || a.y0 > y1) return false;
  const p = a.pts;
  for (let i = 0; i < a.segs; i++) {
    const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[i * 2 + 2], by = p[i * 2 + 3];
    if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
    // Clip the piece to the box (Liang-Barsky): anything left of it is inside.
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    const clip = (pp: number, q: number) => {
      if (pp === 0) return q >= 0;
      const r = q / pp;
      if (pp < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    if (clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay) && t0 <= t1) return true;
  }
  return false;
}

/** The board as the player sees it, in numbers: wire crossings, total wire length, cards on top of one another, wires behind cards. */
export function boardStats(input: TidyInput, at?: Map<number, Pt>): BoardStats {
  const pos = new Map<number, TidyNode>();
  for (const n of input.nodes) pos.set(n.id, at?.has(n.id) ? { ...n, ...at.get(n.id)! } : n);
  const polys: Poly[] = [];
  const ends: [number, number][] = [];
  for (const w of input.wires) {
    const a = pos.get(w.from), b = pos.get(w.to);
    if (!a || !b) continue;
    polys.push(polyOf(a.x + a.w, a.y + w.ay, b.x, b.y + w.by, SEGS));
    ends.push([w.from, w.to]);
  }
  const cards = [...pos.values()];
  let crossings = 0, length = 0, under = 0, backward = 0;
  for (let i = 0; i < polys.length; i++) {
    length += polys[i].len;
    if (polys[i].back > 0) backward++;
    for (let j = i + 1; j < polys.length; j++) if (polysCross(polys[i], polys[j])) crossings++;
    for (const c of cards) if (c.id !== ends[i][0] && c.id !== ends[i][1] && polyInBox(polys[i], c.x, c.y, c.x + c.w, c.y + c.h)) under++;
  }
  let overlaps = 0;
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) if (cardsOverlap(cards[i], cards[j])) overlaps++;
  return { crossings, length, overlaps, under, backward };
}

// ---------- the search ----------

class Layout {
  readonly n: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly polys: Poly[];
  /** For each card, the wires that touch it. */
  readonly touch: number[][];
  private readonly spare: Poly[];
  private readonly mark: Uint8Array;
  /**
   * How much comparing has been done on this layout: wires moved times wires they were compared with.
   * The search stops at a fixed amount (not at a time, which would make the answer depend on the
   * machine), so that a big board cannot hold the page up.
   */
  work = 0;

  constructor(readonly input: TidyInput, readonly nodes: TidyNode[], readonly wf: Int32Array, readonly wt: Int32Array, start: Pt[]) {
    this.n = nodes.length;
    this.x = new Float64Array(this.n);
    this.y = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.x[i] = start[i].x;
      this.y[i] = start[i].y;
    }
    this.touch = nodes.map(() => []);
    this.polys = [];
    this.spare = [];
    for (let w = 0; w < wf.length; w++) {
      this.touch[wf[w]].push(w);
      if (wt[w] !== wf[w]) this.touch[wt[w]].push(w);
      this.polys.push(this.poly(w));
      this.spare.push(polyOf(0, 0, 0, 0, SEARCH_SEGS));
    }
    this.mark = new Uint8Array(wf.length);
  }

  poly(w: number, out?: Poly): Poly {
    const a = this.wf[w], b = this.wt[w], wire = this.input.wires[w];
    return polyOf(this.x[a] + this.nodes[a].w, this.y[a] + wire.ay, this.x[b], this.y[b] + wire.by, SEARCH_SEGS, out);
  }

  /** True when wire `w` runs behind card `k` (which is not at either of its ends). */
  private behind(w: number, k: number): boolean {
    if (this.wf[w] === k || this.wt[w] === k) return false;
    return polyInBox(this.polys[w], this.x[k], this.y[k], this.x[k] + this.nodes[k].w, this.y[k] + this.nodes[k].h);
  }

  /**
   * Crossings, length and wires behind cards that involve the wires in `ws` or the cards in `ids`
   * (each crossing pair counted once): everything a move of those cards can change.
   */
  private part(ws: number[], ids: number[]): { c: number; l: number; u: number; b: number } {
    let c = 0, l = 0, u = 0, b = 0;
    for (const w of ws) this.mark[w] = 1;
    for (let i = 0; i < ws.length; i++) {
      const p = this.polys[ws[i]];
      l += p.len;
      b += p.back;
      for (let v = 0; v < this.polys.length; v++) {
        // Against every wire outside the set, and against those inside it that come later.
        if (this.mark[v] && v <= ws[i]) continue;
        if (polysCross(p, this.polys[v])) c++;
      }
      for (let k = 0; k < this.n; k++) if (this.behind(ws[i], k)) u++;
    }
    // The other wires, where they pass the cards that move.
    for (let v = 0; v < this.polys.length; v++) {
      if (this.mark[v]) continue;
      for (const k of ids) if (this.behind(v, k)) u++;
    }
    for (const w of ws) this.mark[w] = 0;
    return { c, l, u, b };
  }

  /**
   * Move cards and say what it did to the crossings, the length, and the rest of the score (wires
   * behind cards and wires running backwards, in px of wire). `keep` decides, from those changes,
   * whether the move stands; when it does not, everything is put back.
   */
  attempt(ids: number[], to: Pt[], keep: (dc: number, dl: number, dx: number) => boolean): boolean {
    const ws: number[] = [];
    for (const i of ids) for (const w of this.touch[i]) if (!ws.includes(w)) ws.push(w);
    this.work += ws.length * (this.polys.length + this.n) + this.polys.length * ids.length;
    const before = this.part(ws, ids);
    const ox = ids.map((i) => this.x[i]), oy = ids.map((i) => this.y[i]);
    ids.forEach((i, k) => {
      this.x[i] = to[k].x;
      this.y[i] = to[k].y;
    });
    // The wires' old paths are kept aside so that a refused move costs nothing to undo.
    for (const w of ws) {
      const old = this.polys[w];
      this.polys[w] = this.poly(w, this.spare[w]);
      this.spare[w] = old;
    }
    const after = this.part(ws, ids);
    if (keep(after.c - before.c, after.l - before.l, (after.u - before.u) * UNDER + after.b - before.b)) return true;
    ids.forEach((i, k) => {
      this.x[i] = ox[k];
      this.y[i] = oy[k];
    });
    for (const w of ws) {
      const cur = this.polys[w];
      this.polys[w] = this.spare[w];
      this.spare[w] = cur;
    }
    return false;
  }

  /**
   * True when card `k`, put at (px, py), would stand inside the plot with room around it: ROOM_X and
   * ROOM_Y clear of every card but `skip` and `skip2`, and CARD_GAP clear of the free deposits.
   */
  clear(k: number, px: number, py: number, skip: number, skip2 = -1): boolean {
    const w = this.nodes[k].w, h = this.nodes[k].room;
    const b = this.input.board;
    if (px < PLOT_MARGIN || py < PLOT_MARGIN || px + w > b.w - PLOT_MARGIN || py + h > b.h - PLOT_MARGIN) return false;
    for (let i = 0; i < this.n; i++) {
      if (i === skip || i === skip2) continue;
      if (px < this.x[i] + this.nodes[i].w + ROOM_X && px + w + ROOM_X > this.x[i] && py < this.y[i] + this.nodes[i].room + ROOM_Y && py + h + ROOM_Y > this.y[i]) return false;
    }
    for (const d of this.input.deposits) if (px < d.x1 + CARD_GAP && px + w + CARD_GAP > d.x0 && py < d.y1 + CARD_GAP && py + h + CARD_GAP > d.y0) return false;
    return true;
  }

  positions(): Pt[] {
    return this.nodes.map((_, i) => ({ x: this.x[i], y: this.y[i] }));
  }
}

/** The free spot on the grid nearest to (x, y), looking outward ring by ring. `free` says whether a spot will do. Null when there is none within reach. */
function nearFree(x: number, y: number, grid: number, free: (px: number, py: number) => boolean): Pt | null {
  const bx = Math.round(x / grid) * grid, by = Math.round(y / grid) * grid;
  if (free(bx, by)) return { x: bx, y: by };
  let best: Pt | null = null;
  let bestCost = Infinity;
  for (let r = 1; r <= 40; r++) {
    // Nothing on this ring or beyond can beat what is already in hand.
    if (best && r * grid * 0.9 >= bestCost) break;
    for (let i = -r; i <= r; i++) {
      const edge = Math.abs(i) === r;
      for (let j = -r; j <= r; j += edge ? 1 : 2 * r) {
        const cost = Math.hypot(i * grid * 0.9, j * grid);
        if (cost >= bestCost) continue;
        const px = bx + i * grid, py = by + j * grid;
        if (!free(px, py)) continue;
        bestCost = cost;
        best = { x: px, y: py };
      }
    }
  }
  return best;
}

/** How far along the line each card is: Wells are 0, and every other card is one further than the furthest thing that feeds it. */
function depths(n: number, fixed: boolean[], wf: Int32Array, wt: Int32Array): Int32Array {
  const d = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (fixed[i]) d[i] = 0;
  // (A loop in the wiring would climb for ever: n rounds are enough for any line without one.)
  for (let round = 0; round < n; round++) {
    let moved = false;
    for (let w = 0; w < wf.length; w++) {
      const a = wf[w], b = wt[w];
      if (fixed[b] || d[a] < 0 || d[b] >= d[a] + 1 || d[a] + 1 > n) continue;
      d[b] = d[a] + 1;
      moved = true;
    }
    if (!moved) break;
  }
  return d;
}

/** Comparing done on one layout (see `Layout.work`) before the search settles for what it has. */
const BUDGET = 900000;

/** Improve a layout one card at a time until nothing helps any more (or the budget of tries is spent). */
function improve(L: Layout, strict: boolean, cols: number[]) {
  const { nodes, input } = L;
  const keep = strict
    ? (dc: number, dl: number, dx: number) => dc <= 0 && dl <= 0.5 && dx <= 0 && dc * CROSS + dl + dx < -WORTH
    : (dc: number, dl: number, dx: number) => dc * CROSS + dl + dx < -WORTH;
  const span = COL_PITCH - 172;
  for (let round = 0; round < 8 && L.work < BUDGET; round++) {
    let changed = false;
    for (let i = 0; i < L.n && L.work < BUDGET; i++) {
      if (nodes[i].fixed || !L.touch[i].length) continue;
      // Where its wires would have it: level with the ports at their other ends.
      let sum = 0, count = 0;
      const tries: Pt[] = [];
      for (const w of L.touch[i]) {
        const wire = input.wires[w];
        const a = L.wf[w], b = L.wt[w];
        if (a === b) continue;
        if (b === i) {
          const want = L.y[a] + wire.ay - wire.by;
          sum += want;
          count++;
          // Just to the right of what feeds it.
          tries.push({ x: L.x[a] + nodes[a].w + span, y: want });
        } else {
          const want = L.y[b] + wire.by - wire.ay;
          sum += want;
          count++;
          // Just to the left of what it feeds.
          tries.push({ x: L.x[b] - nodes[i].w - span, y: want });
        }
      }
      if (!count) continue;
      const level = sum / count;
      for (const cx of cols) tries.push({ x: cx, y: level });
      tries.push({ x: L.x[i], y: level });
      // Each idea is tried where it lands on free ground; the best of them is kept.
      let best: Pt | null = null;
      let bestGain = 0;
      const seen = new Set<number>();
      const free = (px: number, py: number) => L.clear(i, px, py, i);
      for (const t of tries) {
        const p = nearFree(t.x, t.y, input.grid, free);
        if (!p || (p.x === L.x[i] && p.y === L.y[i])) continue;
        const key = p.x * 65536 + p.y;
        if (seen.has(key)) continue;
        seen.add(key);
        let gain = 0;
        // (Looked at and put back: only how much it would help is wanted here.)
        L.attempt([i], [p], (dc, dl, dx) => {
          if (keep(dc, dl, dx)) gain = -(dc * CROSS + dl + dx);
          return false;
        });
        if (gain > bestGain) {
          bestGain = gain;
          best = p;
        }
      }
      if (best && L.attempt([i], [best], keep)) changed = true;
    }
    // Two cards change places.
    for (let i = 0; i < L.n && L.work < BUDGET; i++) {
      if (nodes[i].fixed) continue;
      for (let j = i + 1; j < L.n; j++) {
        if (nodes[j].fixed || (!L.touch[i].length && !L.touch[j].length)) continue;
        const pi = { x: L.x[j], y: L.y[j] }, pj = { x: L.x[i], y: L.y[i] };
        if (!L.clear(i, pi.x, pi.y, i, j) || !L.clear(j, pj.x, pj.y, i, j)) continue;
        // (They may differ in size: after the exchange they still have to clear each other.)
        if (pi.x < pj.x + nodes[j].w + ROOM_X && pi.x + nodes[i].w + ROOM_X > pj.x && pi.y < pj.y + nodes[j].room + ROOM_Y && pi.y + nodes[i].room + ROOM_Y > pj.y) continue;
        if (L.attempt([i, j], [pi, pj], keep)) changed = true;
      }
    }
    if (!changed) break;
  }
}

/**
 * A fresh layout: Wells where they are, every other card in the column its depth gives it, level with
 * what feeds it, on the nearest free ground. Cards nothing feeds stay where they are.
 */
function fresh(input: TidyInput, nodes: TidyNode[], wf: Int32Array, wt: Int32Array, start: Pt[], depth: Int32Array, cols: number[]): Pt[] {
  const pos = start.map((p) => ({ ...p }));
  const placed = nodes.map((n) => n.fixed);
  /** Card `i` at (px, py) is inside the plot and clear of everything placed so far and of the free deposits. */
  const clearOf = (i: number, px: number, py: number) => {
    const w = nodes[i].w, h = nodes[i].room;
    if (px < PLOT_MARGIN || py < PLOT_MARGIN || px + w > input.board.w - PLOT_MARGIN || py + h > input.board.h - PLOT_MARGIN) return false;
    for (let k = 0; k < nodes.length; k++) {
      if (!placed[k] || k === i) continue;
      if (px < pos[k].x + nodes[k].w + ROOM_X && px + w + ROOM_X > pos[k].x && py < pos[k].y + nodes[k].room + ROOM_Y && py + h + ROOM_Y > pos[k].y) return false;
    }
    return spotFree(px, py, w, h, input.deposits);
  };
  const order = nodes.map((_, i) => i).filter((i) => !nodes[i].fixed && depth[i] > 0);
  const level = (i: number) => {
    let sum = 0, count = 0;
    for (let w = 0; w < wf.length; w++) {
      if (wt[w] !== i || !placed[wf[w]]) continue;
      sum += pos[wf[w]].y + input.wires[w].ay - input.wires[w].by;
      count++;
    }
    return count ? sum / count : start[i].y;
  };
  // Depth first; within a depth, from the top down by where each card wants to be.
  order.sort((a, b) => depth[a] - depth[b] || start[a].y - start[b].y || nodes[a].id - nodes[b].id);
  let at = 0;
  while (at < order.length) {
    let end = at;
    while (end < order.length && depth[order[end]] === depth[order[at]]) end++;
    const row = order.slice(at, end).map((i) => ({ i, y: level(i) })).sort((a, b) => a.y - b.y || nodes[a.i].id - nodes[b.i].id);
    for (const { i, y } of row) {
      const p = nearFree(cols[Math.min(depth[i], cols.length - 1)], y, input.grid, (px, py) => clearOf(i, px, py));
      if (p) pos[i] = p;
      placed[i] = true;
    }
    at = end;
  }
  // Whatever is left (cards with nothing leading to them from a Well) keeps its place if it is free, or the nearest free spot.
  for (let i = 0; i < nodes.length; i++) {
    if (placed[i]) continue;
    const p = nearFree(start[i].x, start[i].y, input.grid, (px, py) => clearOf(i, px, py));
    if (p) pos[i] = p;
    placed[i] = true;
  }
  return pos;
}

/**
 * Tidy a board. Returns the new place of every card that should move (none when the board cannot be
 * bettered). The result never has two cards overlapping, never moves a Well, and never has more wire
 * crossings or more wire than the board it was given (once any overlapping cards on that board have
 * been pulled apart).
 */
export function tidy(input: TidyInput): Map<number, Pt> {
  const nodes = input.nodes;
  const index = new Map<number, number>();
  nodes.forEach((n, i) => index.set(n.id, i));
  const wires = input.wires.filter((w) => index.has(w.from) && index.has(w.to));
  const inp: TidyInput = { ...input, wires };
  const wf = Int32Array.from(wires.map((w) => index.get(w.from)!)), wt = Int32Array.from(wires.map((w) => index.get(w.to)!));
  // Cards on top of one another are pulled apart first: that board is what the others are measured against.
  const apart = separate(nodes, input.deposits, input.board, input.grid);
  const start: Pt[] = nodes.map((n) => apart.get(n.id) ?? { x: n.x, y: n.y });
  const cols: number[] = [];
  for (let x = COL_X0; x + 172 <= input.board.w - PLOT_MARGIN; x += COL_PITCH) cols.push(x);
  if (!cols.length) cols.push(PLOT_MARGIN);
  const depth = depths(nodes.length, nodes.map((n) => n.fixed), wf, wt);

  const base = new Layout(inp, nodes, wf, wt, start);
  const baseStats = boardStatsOf(base);
  const candidates: Layout[] = [];
  const a = new Layout(inp, nodes, wf, wt, start);
  improve(a, false, cols);
  candidates.push(a);
  const b = new Layout(inp, nodes, wf, wt, fresh(inp, nodes, wf, wt, start, depth, cols));
  improve(b, false, cols);
  candidates.push(b);

  let best = base;
  const scoreOf = (st: BoardStats, L: Layout) => st.crossings * CROSS + st.length + st.under * UNDER + L.polys.reduce((sum, p) => sum + p.back, 0);
  let bestScore = scoreOf(baseStats, base);
  const judge = (L: Layout) => {
    const s = boardStatsOf(L);
    if (s.overlaps > 0 || s.crossings > baseStats.crossings || s.length > baseStats.length + 0.5) return;
    const score = scoreOf(s, L);
    if (score < bestScore - 1) {
      best = L;
      bestScore = score;
    }
  };
  for (const L of candidates) judge(L);
  if (best === base) {
    // Neither came out no worse on both counts: the careful way, which cannot lose.
    const c = new Layout(inp, nodes, wf, wt, start);
    improve(c, true, cols);
    judge(c);
  }
  const out = new Map<number, Pt>();
  const end = best.positions();
  nodes.forEach((n, i) => {
    if (end[i].x !== n.x || end[i].y !== n.y) out.set(n.id, end[i]);
  });
  return out;
}

function boardStatsOf(L: Layout): BoardStats {
  const at = new Map<number, Pt>();
  L.positions().forEach((p, i) => at.set(L.nodes[i].id, p));
  return boardStats(L.input, at);
}

/** A game's board as Tidy wants it: every card with its size, every wire with its ports, the free deposits, the plot. */
export function tidyInput(g: Game, grid: number): TidyInput {
  const nodes: TidyNode[] = g.nodes.map((n) => {
    const { w, h } = nodeSize(n);
    return { id: n.id, x: n.x, y: n.y, w, h, room: roomFor(n.type, h), fixed: n.type === 'well' };
  });
  const at = new Map(g.nodes.map((n) => [n.id, n]));
  const wires: TidyWire[] = [];
  for (const w of g.wires) {
    const ends = wireEnds(g, w);
    const a = at.get(w.from), b = at.get(w.to);
    if (ends && a && b) wires.push({ from: w.from, to: w.to, ay: ends.a.y - a.y, by: ends.b.y - b.y });
  }
  const used = new Set(g.nodes.map((n) => n.depositId));
  const deposits: Box[] = g.deposits.filter((d) => !used.has(d.id)).map((d) => ({ x0: d.x, y0: d.y, x1: d.x + 172, y1: d.y + 72 }));
  return { nodes, wires, deposits, board: { w: g.board.w, h: g.board.h }, grid };
}

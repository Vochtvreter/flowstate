// Tidy: lay a board out again so that no wire runs behind a card it does not end at, wires are short
// and cross as little as possible, and no two cards stand on top of one another. Pure and deterministic:
// cards, wires and the plot in, positions out. Wells stay on their deposits; everything else may move.
//
// How it works. A layout is scored by what the player sees: the length of every wire as it is drawn
// (a wire that has to run backwards loops, and is long), plus a charge for every pair of wires that
// cross, a much larger one for every card a wire runs behind, and a small one for a wire that only
// brushes past a card. A card only moves when that is clearly worth it, and only to ground with room
// around it for its wires. Up to three kinds of layout are worked out, and the best is taken (fewest
// wires behind cards first, then the lowest score):
//   1. the board as it stands, mended: wires brought out from behind cards, then improved one card at a
//      time (a card moves to a free spot, or two cards change places, whenever that lowers the score).
//      Little moves, and a board the player has arranged stays theirs;
//   2. plain columns: every card in the column its depth in the line gives it, level with what feeds
//      it, improved as if a wire behind a card cost little (short wires and straight rows first), and
//      then mended; where a few cards are still stuck with a wire behind one, those are shaken loose
//      (see `anneal`) and mended again;
//   3. only where that still leaves a wire behind a card: a fresh layout built card by card where its
//      wires cost the least, shaken into shape as a whole, and mended.
// Where the cards stood before plays no part in 2 and 3, so the same factory always gets the same
// layout from them; they have to beat 1 by a margin, since they move every card; and what the next Tidy
// would do first is done before the answer is given. So a board that has been tidied is left alone by
// the next Tidy.
//
// The layout taken never has more wires behind cards than the board as it stands; and it has no more
// crossings and no more wire either, unless that is what it took to bring a wire out from behind a
// card. When nothing passes, the board is improved only by steps that make nothing worse: slower to
// get anywhere, but it can never lose, so there is always an answer.
//
// Why a wire used to stay behind a card, and what is tried now. A card wants to be level with the ports
// at the other ends of its wires, and those spots are always tried. They are not enough: a port that
// feeds two cards cannot have the near one level with it, 68 px away, without every other wire from
// that port running straight through it; and a Well in the middle of the plot cannot step aside for a
// wire. So a card that is in a wire's way, or whose own wire runs behind something, is also tried on
// every free row of the columns it could stand in: the card in the way moves a row, or the wire's far
// end comes to the row of its Well. And where no single card can cure it (round a Market that ten wires
// meet at, every free spot is in some other wire's way), the cards round it are shaken: moved a few at
// a time, a step that makes things worse taken now and then, until they have got past each other.
import { Game } from '../state';
import { Box, CARD_GAP, Card, PLOT_MARGIN, Pt, cardsOverlap, nodeSize, roomFor, separate, wireEnds } from './geom';

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

/** A crossing is charged like this many px of wire, and a wire that has to run backwards (right to left) like this many. */
const CROSS = 220, BACK = 240;
/**
 * A wire that runs behind a card it does not end at is charged like this many px of wire: as much as
 * eleven crossings, because a wire across a card's label is what makes a board look broken. One that
 * only brushes past a card (closer than CLEAR, where its glow and its dots touch the card's edge) costs
 * a little more than a crossing.
 */
const UNDER = 2400, BRUSH = 280;
/** What a wire behind a card costs while the plain columns are laid out: little, so that short wires and straight rows come first. */
const SOFT = 260;
/** A wire keeps this far from the cards it passes; nearer than that it brushes them. */
const CLEAR = 8;
/**
 * A wire counts as behind a card from this far outside its edge. The search follows each wire as a
 * chain of straight pieces, which cuts the curve's corners by a pixel or two: with this, a wire that is
 * drawn just inside a card is never taken for one that just misses it.
 */
const EDGE = 2;
/** A wire runs backwards when its far end is not at least this far to the right of its near end. */
const FORWARD = 24;
/** A move has to be worth this many px of wire before it is made: a board that is already neat is left alone. */
const WORTH = 30;
/** Clear ground a card that Tidy moves keeps to its sides (room for its wires to bend) and above and below. */
const ROOM_X = 56, ROOM_Y = 24;
/** Columns of a fresh layout stand this far apart (a card is 172 wide), starting where the first deposits are. */
const COL_X0 = 100, COL_PITCH = 240;
/** Empty ground between two columns: what is left of a column's pitch beside a card. */
const SPAN = COL_PITCH - 172;
/**
 * Straight pieces each wire is cut into: when the board is measured; while layouts are improved (FINE);
 * and while a fresh layout is shaken into shape (COARSE). Cards are looked for along all of a wire's
 * pieces; crossings on every second point while improving (seven pieces) and on every fourth while
 * shaking (three: rough, and several times as fast). Odd numbers of pieces for crossings, so that two
 * wires that mirror each other cross in the middle of a piece and not at a corner of both, where the
 * crossing would be missed.
 */
const SEGS = 15, FINE = 14, FINE_STEP = 2, COARSE = 12, COARSE_STEP = 4;

// ---------- measuring ----------

/**
 * A wire as a chain of `segs` straight pieces along the curve it is drawn with: its points go into
 * `pts` from `o`, its bounding box into `box` from `ob`. Returns its length. The curve is the board's
 * (`curve` in geom.ts: a cubic that leaves its port level, with its handles half the span out, 40 px
 * at least); it is worked out here in plain numbers because this runs a hundred thousand times in one
 * Tidy, and a test holds the two to each other.
 */
function trace(ax: number, ay: number, bx: number, by: number, segs: number, pts: Float64Array, o: number, box: Float64Array, ob: number): number {
  const h = Math.max(40, Math.abs(bx - ax) / 2);
  const x1 = ax + h, x2 = bx - h;
  let len = 0, lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity, px = 0, py = 0;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, u = 1 - t;
    const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
    const qx = k0 * ax + k1 * x1 + k2 * x2 + k3 * bx, qy = (k0 + k1) * ay + (k2 + k3) * by;
    if (i) len += Math.sqrt((qx - px) * (qx - px) + (qy - py) * (qy - py));
    pts[o + i * 2] = px = qx;
    pts[o + i * 2 + 1] = py = qy;
    if (qx < lx) lx = qx;
    if (qx > hx) hx = qx;
    if (qy < ly) ly = qy;
    if (qy > hy) hy = qy;
  }
  box[ob] = lx; box[ob + 1] = ly; box[ob + 2] = hx; box[ob + 3] = hy;
  return len;
}

/** What running backwards costs a wire from ax to bx (0 for one that runs forwards). */
const backCost = (ax: number, bx: number) => (bx - ax < FORWARD ? BACK + (ax + FORWARD - bx) * 0.5 : 0);

/**
 * True when two wires cross: the chain in `p` from `oa` and the one in `q` from `ob`, each of `n2 / 2`
 * pieces, looked at `d / 2` points at a time. Only the pieces of each that reach into the other's
 * bounding box (`pb` from `opb`, `qb` from `oqb`) can cross anything: the rest are passed over.
 */
function crosses(p: Float64Array, oa: number, pb: Float64Array, opb: number, q: Float64Array, ob: number, qb: Float64Array, oqb: number, n2: number, d: number): boolean {
  const px0 = pb[opb], py0 = pb[opb + 1], px1 = pb[opb + 2], py1 = pb[opb + 3];
  const qx0 = qb[oqb], qy0 = qb[oqb + 1], qx1 = qb[oqb + 2], qy1 = qb[oqb + 3];
  if (px1 < qx0 || qx1 < px0 || py1 < qy0 || qy1 < py0) return false;
  for (let i = 0; i < n2; i += d) {
    const ax = p[oa + i], ay = p[oa + i + 1], bx = p[oa + i + d], by = p[oa + i + d + 1];
    const lox = ax < bx ? ax : bx, hix = ax < bx ? bx : ax, loy = ay < by ? ay : by, hiy = ay < by ? by : ay;
    if (hix < qx0 || lox > qx1 || hiy < qy0 || loy > qy1) continue;
    for (let j = 0; j < n2; j += d) {
      const cx = q[ob + j], cy = q[ob + j + 1], dx = q[ob + j + d], dy = q[ob + j + d + 1];
      if ((cx < lox && dx < lox) || (cx > hix && dx > hix) || (cy < loy && dy < loy) || (cy > hiy && dy > hiy)) continue;
      const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
      const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
      if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))) continue;
      const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      if ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)) return true;
    }
  }
  return false;
}

/** True when a wire's path (the chain of `segs` pieces in `p` from `o`) enters a box. */
function entersBox(p: Float64Array, o: number, segs: number, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let i = 0; i < segs; i++) {
    const k = o + i * 2;
    const ax = p[k], ay = p[k + 1], bx = p[k + 2], by = p[k + 3];
    if ((ax < x0 && bx < x0) || (ax > x1 && bx > x1) || (ay < y0 && by < y0) || (ay > y1 && by > y1)) continue;
    // Clip the piece to the box (Liang-Barsky), one side after another: anything left of it is inside.
    let t0 = 0, t1 = 1, inside = true;
    for (let side = 0; side < 4 && inside; side++) {
      const pp = side === 0 ? ax - bx : side === 1 ? bx - ax : side === 2 ? ay - by : by - ay;
      const qq = side === 0 ? ax - x0 : side === 1 ? x1 - ax : side === 2 ? ay - y0 : y1 - ay;
      if (pp === 0) inside = qq >= 0;
      else {
        const r = qq / pp;
        if (pp < 0) {
          if (r > t1) inside = false;
          else if (r > t0) t0 = r;
        } else {
          if (r < t0) inside = false;
          else if (r < t1) t1 = r;
        }
      }
    }
    if (inside && t0 <= t1) return true;
  }
  return false;
}

/** The board as the player sees it, in numbers: wire crossings, total wire length, cards on top of one another, wires behind cards. */
export function boardStats(input: TidyInput, at?: Map<number, Pt>): BoardStats {
  const pos = new Map<number, TidyNode>();
  for (const n of input.nodes) pos.set(n.id, at?.has(n.id) ? { ...n, ...at.get(n.id)! } : n);
  const wires = input.wires.filter((w) => pos.has(w.from) && pos.has(w.to));
  const stride = (SEGS + 1) * 2;
  const pts = new Float64Array(wires.length * stride), box = new Float64Array(wires.length * 4);
  const cards = [...pos.values()];
  let crossings = 0, length = 0, under = 0, backward = 0;
  wires.forEach((w, i) => {
    const a = pos.get(w.from)!, b = pos.get(w.to)!;
    length += trace(a.x + a.w, a.y + w.ay, b.x, b.y + w.by, SEGS, pts, i * stride, box, i * 4);
    if (backCost(a.x + a.w, b.x) > 0) backward++;
  });
  for (let i = 0; i < wires.length; i++) {
    for (let j = i + 1; j < wires.length; j++) if (crosses(pts, i * stride, box, i * 4, pts, j * stride, box, j * 4, SEGS * 2, 2)) crossings++;
    for (const c of cards) {
      if (c.id === wires[i].from || c.id === wires[i].to) continue;
      if (box[i * 4 + 2] < c.x || box[i * 4] > c.x + c.w || box[i * 4 + 3] < c.y || box[i * 4 + 1] > c.y + c.h) continue;
      if (entersBox(pts, i * stride, SEGS, c.x, c.y, c.x + c.w, c.y + c.h)) under++;
    }
  }
  let overlaps = 0;
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) if (cardsOverlap(cards[i], cards[j])) overlaps++;
  return { crossings, length, overlaps, under, backward };
}

// ---------- a layout, and what a move does to it ----------

/**
 * Cards at their places, with everything the score needs kept up to date: each wire's path, which
 * pairs of wires cross, and what each wire is charged for each card it passes. A move is first tried
 * (`trial` says what it would change, and changes nothing) and then, if wanted, made (`commit`): only
 * the wires of the cards that move are followed again, and nothing has to be measured twice.
 */
class Layout {
  readonly n: number;
  /** Wires. */
  readonly m: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** For each card, the wires that touch it. */
  readonly touch: number[][];
  /** Cards that have a place: all of them, except while a fresh layout is being built. */
  readonly on: Uint8Array;
  /** Wires with a place at both ends. */
  private readonly live: Uint8Array;
  private readonly cw: Float64Array;
  private readonly ch: Float64Array;
  private readonly room: Float64Array;
  private readonly stride: number;
  /** The wires' paths, their bounding boxes, lengths, and what each is charged for running backwards. */
  private readonly pts: Float64Array;
  private readonly box: Float64Array;
  private readonly len: Float64Array;
  private readonly back: Float64Array;
  /** cross[w * m + v]: wires w and v cross. beh[w * n + k]: what wire w is charged for card k. */
  private readonly cross: Uint8Array;
  private readonly beh: Float64Array;
  /** The same, for the move being tried: only the rows of the wires that move, and the columns of the cards that do. */
  private readonly tpts: Float64Array;
  private readonly tbox: Float64Array;
  private readonly tlen: Float64Array;
  private readonly tback: Float64Array;
  private readonly tcross: Uint8Array;
  private readonly tbeh: Float64Array;
  private readonly tcol: Float64Array;
  private readonly mark: Uint8Array;
  private tIds: number[] = [];
  private tTo: Pt[] = [];
  private tWs: number[] = [];
  /** What the move last tried would change: crossings, wire length, and the rest of the score (`dx`: wires behind cards or brushing them, and wires running backwards, in px of wire). */
  dc = 0;
  dl = 0;
  dx = 0;
  /**
   * How much comparing has been done on this layout: wires moved times wires they were compared with.
   * The search stops at a fixed amount (not at a time, which would make the answer depend on the
   * machine), so that a big board cannot hold the page up.
   */
  work = 0;
  /** Counts the moves made: nothing about the layout has changed while this stands still. */
  moves = 0;
  /** For each card, the count of moves at which it was last tried on every free row of its columns and nothing came of it: until something moves, there is no point in trying again. */
  readonly barren: Int32Array;

  constructor(readonly input: TidyInput, readonly nodes: TidyNode[], readonly wf: Int32Array, readonly wt: Int32Array, start: Pt[], readonly segs: number, /** Crossings are looked for on every `step`-th point of a wire's path. */ readonly step: number, private readonly under = UNDER, private readonly brush = BRUSH) {
    const n = (this.n = nodes.length), m = (this.m = wf.length);
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.cw = new Float64Array(n);
    this.ch = new Float64Array(n);
    this.room = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = start[i].x;
      this.y[i] = start[i].y;
      this.cw[i] = nodes[i].w;
      this.ch[i] = nodes[i].h;
      this.room[i] = nodes[i].room;
    }
    this.on = new Uint8Array(n).fill(1);
    this.live = new Uint8Array(m).fill(1);
    this.touch = nodes.map(() => []);
    this.stride = (segs + 1) * 2;
    this.pts = new Float64Array(m * this.stride);
    this.tpts = new Float64Array(m * this.stride);
    this.box = new Float64Array(m * 4);
    this.tbox = new Float64Array(m * 4);
    this.len = new Float64Array(m);
    this.tlen = new Float64Array(m);
    this.back = new Float64Array(m);
    this.tback = new Float64Array(m);
    this.cross = new Uint8Array(m * m);
    this.tcross = new Uint8Array(m * m);
    this.beh = new Float64Array(m * n);
    this.tbeh = new Float64Array(m * n);
    this.tcol = new Float64Array(n * m);
    this.mark = new Uint8Array(m);
    this.barren = new Int32Array(n).fill(-1);
    for (let w = 0; w < m; w++) {
      this.touch[wf[w]].push(w);
      if (wt[w] !== wf[w]) this.touch[wt[w]].push(w);
      this.path(w, this.pts, this.box, this.len, this.back);
    }
    for (let w = 0; w < m; w++) {
      for (let v = w + 1; v < m; v++) this.cross[w * m + v] = this.cross[v * m + w] = this.meet(this.pts, this.box, w, this.pts, this.box, v);
      for (let k = 0; k < n; k++) this.beh[w * n + k] = this.charge(this.pts, this.box, w, k);
    }
  }

  /** Follow wire `w` from port to port as the cards stand, into the given arrays. */
  private path(w: number, pts: Float64Array, box: Float64Array, len: Float64Array, back: Float64Array) {
    const a = this.wf[w], b = this.wt[w], wire = this.input.wires[w];
    const ax = this.x[a] + this.cw[a], bx = this.x[b];
    len[w] = trace(ax, this.y[a] + wire.ay, bx, this.y[b] + wire.by, this.segs, pts, w * this.stride, box, w * 4);
    back[w] = backCost(ax, bx);
  }

  /** 1 when wire `w` (its path in `p`, `pb`) crosses wire `v` (in `q`, `qb`). */
  private meet(p: Float64Array, pb: Float64Array, w: number, q: Float64Array, qb: Float64Array, v: number): number {
    return crosses(p, w * this.stride, pb, w * 4, q, v * this.stride, qb, v * 4, this.segs * 2, this.step * 2) ? 1 : 0;
  }

  /** What wire `w` (its path in `p`, `pb`) is charged for card `k`: UNDER when it runs behind it, BRUSH when it only passes too close, nothing when it is clear of it or ends at it. */
  private charge(p: Float64Array, pb: Float64Array, w: number, k: number): number {
    if (this.wf[w] === k || this.wt[w] === k) return 0;
    const o = w * 4;
    const x0 = this.x[k] - CLEAR, y0 = this.y[k] - CLEAR, x1 = this.x[k] + this.cw[k] + CLEAR, y1 = this.y[k] + this.ch[k] + CLEAR;
    if (pb[o + 2] < x0 || pb[o] > x1 || pb[o + 3] < y0 || pb[o + 1] > y1) return 0;
    if (!entersBox(p, w * this.stride, this.segs, x0, y0, x1, y1)) return 0;
    const e = CLEAR - EDGE;
    return entersBox(p, w * this.stride, this.segs, x0 + e, y0 + e, x1 - e, y1 - e) ? this.under : this.brush;
  }

  /** The wires that touch any of these cards. */
  private wiresOf(ids: number[]): number[] {
    if (ids.length === 1) return this.touch[ids[0]];
    const ws: number[] = [];
    for (const i of ids) for (const w of this.touch[i]) if (!ws.includes(w)) ws.push(w);
    return ws;
  }

  /**
   * Try moving cards: afterwards `dc`, `dl` and `dx` say what the move would change. Nothing is moved;
   * `commit` makes the move last tried.
   */
  trial(ids: number[], to: Pt[]) {
    const { n, m, live, mark, cross, beh, tcross, tbeh, tcol, on } = this;
    const ws = this.wiresOf(ids);
    this.tIds = ids;
    this.tTo = to;
    this.tWs = ws;
    this.work += ws.length * (m + n) + m * ids.length;
    let oc = 0, ol = 0, ou = 0, ob = 0, nc = 0, nl = 0, nu = 0, nb = 0;
    for (const w of ws) mark[w] = 1;
    // As things stand: read off, nothing to measure.
    for (const w of ws) {
      if (!live[w]) continue;
      ol += this.len[w];
      ob += this.back[w];
      const row = w * m, rk = w * n;
      for (let v = 0; v < m; v++) if (cross[row + v] && !(mark[v] && v < w)) oc++;
      for (let k = 0; k < n; k++) ou += beh[rk + k];
    }
    for (const k of ids) for (let v = 0; v < m; v++) if (!mark[v]) ou += beh[v * n + k];
    // With the cards moved: their wires followed again, and compared with the rest.
    const wasX = ids.length === 1 ? this.x[ids[0]] : 0, wasY = ids.length === 1 ? this.y[ids[0]] : 0;
    const wasXs = ids.length === 1 ? null : ids.map((i) => this.x[i]), wasYs = ids.length === 1 ? null : ids.map((i) => this.y[i]);
    for (let k = 0; k < ids.length; k++) {
      this.x[ids[k]] = to[k].x;
      this.y[ids[k]] = to[k].y;
    }
    for (const w of ws) if (live[w]) this.path(w, this.tpts, this.tbox, this.tlen, this.tback);
    for (const w of ws) {
      if (!live[w]) continue;
      nl += this.tlen[w];
      nb += this.tback[w];
      const row = w * m, rk = w * n;
      for (let v = 0; v < m; v++) {
        if (v === w || !live[v] || (mark[v] && v < w)) continue;
        const hit = mark[v] ? this.meet(this.tpts, this.tbox, w, this.tpts, this.tbox, v) : this.meet(this.tpts, this.tbox, w, this.pts, this.box, v);
        tcross[row + v] = hit;
        nc += hit;
      }
      for (let k = 0; k < n; k++) nu += tbeh[rk + k] = on[k] ? this.charge(this.tpts, this.tbox, w, k) : 0;
    }
    // The other wires, where they pass the cards that move.
    for (const k of ids) {
      for (let v = 0; v < m; v++) {
        if (mark[v]) continue;
        nu += tcol[k * m + v] = live[v] ? this.charge(this.pts, this.box, v, k) : 0;
      }
    }
    if (wasXs && wasYs) {
      for (let k = 0; k < ids.length; k++) {
        this.x[ids[k]] = wasXs[k];
        this.y[ids[k]] = wasYs[k];
      }
    } else {
      this.x[ids[0]] = wasX;
      this.y[ids[0]] = wasY;
    }
    for (const w of ws) mark[w] = 0;
    this.dc = nc - oc;
    this.dl = nl - ol;
    this.dx = nu - ou + nb - ob;
  }

  /** Make the move last tried. */
  commit() {
    const { n, m, live, mark, stride } = this;
    this.moves++;
    const ids = this.tIds, to = this.tTo, ws = this.tWs;
    for (let k = 0; k < ids.length; k++) {
      this.x[ids[k]] = to[k].x;
      this.y[ids[k]] = to[k].y;
    }
    for (const w of ws) mark[w] = 1;
    for (const w of ws) {
      if (!live[w]) continue;
      this.pts.set(this.tpts.subarray(w * stride, (w + 1) * stride), w * stride);
      this.box.set(this.tbox.subarray(w * 4, w * 4 + 4), w * 4);
      this.len[w] = this.tlen[w];
      this.back[w] = this.tback[w];
      const row = w * m, rk = w * n;
      for (let v = 0; v < m; v++) {
        if (v === w || !live[v] || (mark[v] && v < w)) continue;
        this.cross[row + v] = this.cross[v * m + w] = this.tcross[row + v];
      }
      for (let k = 0; k < n; k++) this.beh[rk + k] = this.tbeh[rk + k];
    }
    for (const k of ids) for (let v = 0; v < m; v++) if (!mark[v]) this.beh[v * n + k] = this.tcol[k * m + v];
    for (const w of ws) mark[w] = 0;
  }

  /** Take a card off the board (while a fresh layout is built): its wires count for nothing until it is put down. */
  lift(k: number) {
    const { n, m } = this;
    this.on[k] = 0;
    for (const w of this.touch[k]) {
      this.live[w] = 0;
      for (let v = 0; v < m; v++) this.cross[w * m + v] = this.cross[v * m + w] = 0;
      for (let j = 0; j < n; j++) this.beh[w * n + j] = 0;
    }
    for (let v = 0; v < m; v++) this.beh[v * n + k] = 0;
  }

  /**
   * Put a card that was off the board down at (px, py). Returns what that adds to the score: its wires
   * to the cards already down (their length, what they cross, what they run behind) and the wires that
   * now pass behind it.
   */
  put(k: number, px: number, py: number): number {
    const { n, m, live, mark, on } = this;
    this.x[k] = px;
    this.y[k] = py;
    on[k] = 1;
    const ws = this.touch[k];
    this.work += ws.length * (m + n) + m;
    let cost = 0;
    for (const w of ws) {
      live[w] = on[this.wf[w]] & on[this.wt[w]];
      if (live[w]) this.path(w, this.pts, this.box, this.len, this.back);
      mark[w] = 1;
    }
    for (const w of ws) {
      if (!live[w]) continue;
      cost += this.len[w] + this.back[w];
      for (let v = 0; v < m; v++) {
        if (v === w || !live[v] || (mark[v] && v < w)) continue;
        const hit = this.meet(this.pts, this.box, w, this.pts, this.box, v);
        this.cross[w * m + v] = this.cross[v * m + w] = hit;
        cost += hit * CROSS;
      }
      for (let j = 0; j < n; j++) cost += this.beh[w * n + j] = on[j] ? this.charge(this.pts, this.box, w, j) : 0;
    }
    for (let v = 0; v < m; v++) if (!mark[v] && live[v]) cost += this.beh[v * n + k] = this.charge(this.pts, this.box, v, k);
    for (const w of ws) mark[w] = 0;
    return cost;
  }

  /** What card `k` is in trouble for: the charges on its own wires for the cards they pass, and on the other wires for passing it. 0 for a card with nothing behind it and no wire of its own behind anything. */
  trouble(k: number): number {
    const { n, m, beh } = this;
    let u = 0;
    for (const w of this.touch[k]) for (let j = 0; j < n; j++) u += beh[w * n + j];
    for (let v = 0; v < m; v++) u += beh[v * n + k];
    return u;
  }

  /** True when card `k`, put at (px, py), would stand in the way of a wire that does not end at it. */
  blocks(k: number, px: number, py: number): boolean {
    const wasX = this.x[k], wasY = this.y[k];
    this.x[k] = px;
    this.y[k] = py;
    this.work += this.m;
    let hit = false;
    for (let v = 0; v < this.m && !hit; v++) hit = this.live[v] === 1 && this.charge(this.pts, this.box, v, k) >= this.under;
    this.x[k] = wasX;
    this.y[k] = wasY;
    return hit;
  }

  /**
   * True when card `k`, put at (px, py), would stand inside the plot with room around it: ROOM_X and
   * ROOM_Y clear of every card but `skip` and `skip2`, and CARD_GAP clear of the free deposits.
   */
  clear(k: number, px: number, py: number, skip: number, skip2 = -1): boolean {
    const w = this.cw[k], h = this.room[k];
    const b = this.input.board;
    if (px < PLOT_MARGIN || py < PLOT_MARGIN || px + w > b.w - PLOT_MARGIN || py + h > b.h - PLOT_MARGIN) return false;
    const { x, y, cw, room, on } = this;
    for (let i = 0; i < this.n; i++) {
      if (i === skip || i === skip2 || !on[i]) continue;
      if (px < x[i] + cw[i] + ROOM_X && px + w + ROOM_X > x[i] && py < y[i] + room[i] + ROOM_Y && py + h + ROOM_Y > y[i]) return false;
    }
    for (const d of this.input.deposits) if (px < d.x1 + CARD_GAP && px + w + CARD_GAP > d.x0 && py < d.y1 + CARD_GAP && py + h + CARD_GAP > d.y0) return false;
    return true;
  }

  /** What the whole layout is charged for wires behind cards and brushing them, and for wires running backwards. */
  charges(): { under: number; back: number } {
    let under = 0, back = 0;
    for (let w = 0; w < this.m; w++) {
      if (!this.live[w]) continue;
      back += this.back[w];
      for (let k = 0; k < this.n; k++) under += this.beh[w * this.n + k];
    }
    return { under, back };
  }

  positions(): Pt[] {
    return this.nodes.map((_, i) => ({ x: this.x[i], y: this.y[i] }));
  }
}

// ---------- the search ----------

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
        const cost = Math.sqrt(i * grid * 0.9 * (i * grid * 0.9) + j * grid * (j * grid));
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

/** Every row of the grid on which a card of this height stands inside the plot. */
function rowsFor(input: TidyInput, room: number): number[] {
  const rows: number[] = [];
  for (let y = Math.ceil(PLOT_MARGIN / input.grid) * input.grid; y + room <= input.board.h - PLOT_MARGIN; y += input.grid) rows.push(y);
  return rows;
}

/** Whether a move is worth making, from what it does to the crossings, the wire length and the rest of the score. */
type Keep = (dc: number, dl: number, dx: number) => boolean;
const anyGain: Keep = (dc, dl, dx) => dc * CROSS + dl + dx < -WORTH;
const noLoss: Keep = (dc, dl, dx) => dc <= 0 && dl <= 0.5 && dx <= 0 && dc * CROSS + dl + dx < -WORTH;

/**
 * The spots worth trying for card `i`: level with the port at the other end of each of its wires (just
 * to the right of what feeds it, just to the left of what it feeds), and at the average of those levels
 * in every column and where it stands; each on the nearest free ground. With `rows`, also every free
 * row of the columns it could stand in (where it is, and beside each card at the other end of a wire).
 */
function spotsFor(L: Layout, i: number, cols: number[], rows: boolean): Pt[] {
  const { nodes, input } = L;
  const grid = input.grid;
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
      tries.push({ x: L.x[a] + nodes[a].w + SPAN, y: want });
    } else {
      const want = L.y[b] + wire.by - wire.ay;
      sum += want;
      count++;
      // Just to the left of what it feeds.
      tries.push({ x: L.x[b] - nodes[i].w - SPAN, y: want });
    }
  }
  const spots: Pt[] = [];
  if (!count) return spots;
  const level = sum / count;
  const wired = tries.length;
  for (const cx of cols) tries.push({ x: cx, y: level });
  tries.push({ x: L.x[i], y: level });
  const seen = new Set<number>();
  const add = (p: Pt) => {
    if (p.x === L.x[i] && p.y === L.y[i]) return;
    const key = p.x * 65536 + p.y;
    if (seen.has(key)) return;
    seen.add(key);
    spots.push(p);
  };
  const free = (px: number, py: number) => L.clear(i, px, py, i);
  for (const t of tries) {
    const p = nearFree(t.x, t.y, grid, free);
    if (p) add(p);
  }
  if (rows) {
    const xs = new Set<number>([L.x[i]]);
    for (let k = 0; k < wired; k++) xs.add(Math.round(tries[k].x / grid) * grid);
    const ys = rowsFor(input, nodes[i].room);
    // (Not where it would stand in another wire's way: that cures nothing.)
    for (const x of xs) for (const y of ys) if (free(x, y) && !L.blocks(i, x, y)) add({ x, y });
  }
  return spots;
}

const one = [0], spot: Pt[] = [{ x: 0, y: 0 }];

/** The best of `spots` for card `i` that `keep` allows, and what it gains (in px of wire). Nothing is moved. */
function bestOf(L: Layout, i: number, spots: Pt[], keep: Keep, budget: number): { p: Pt | null; gain: number } {
  let p: Pt | null = null;
  let gain = 0;
  one[0] = i;
  for (const s of spots) {
    if (L.work >= budget) break;
    spot[0] = s;
    L.trial(one, spot);
    if (!keep(L.dc, L.dl, L.dx)) continue;
    const g = -(L.dc * CROSS + L.dl + L.dx);
    if (g > gain) {
      gain = g;
      p = s;
    }
  }
  return { p, gain };
}

/** Move card `i` to `p` if `keep` still allows it. */
function moveIf(L: Layout, i: number, p: Pt, keep: Keep): boolean {
  if (!L.clear(i, p.x, p.y, i)) return false;
  one[0] = i;
  spot[0] = p;
  L.trial(one, spot);
  if (!keep(L.dc, L.dl, L.dx)) return false;
  L.commit();
  return true;
}

/**
 * Improve a layout one card at a time until nothing helps any more (or the budget of tries is spent).
 * With `rows`, the cards in trouble (in a wire's way, or with a wire of their own behind a card) are
 * tried on every free row of their columns as well.
 */
function improve(L: Layout, keep: Keep, cols: number[], budget: number, rows: boolean) {
  const { nodes } = L;
  for (let round = 0; round < 60 && L.work < budget; round++) {
    let changed = false;
    for (let i = 0; i < L.n && L.work < budget; i++) {
      if (nodes[i].fixed || !L.touch[i].length) continue;
      const scan = rows && L.barren[i] !== L.moves && L.trouble(i) > 0;
      const { p } = bestOf(L, i, spotsFor(L, i, cols, scan), keep, budget);
      if (p && moveIf(L, i, p, keep)) changed = true;
      else if (scan && !p && L.work < budget) L.barren[i] = L.moves;
    }
    // Two cards change places.
    for (let i = 0; i < L.n && L.work < budget; i++) {
      if (nodes[i].fixed) continue;
      for (let j = i + 1; j < L.n; j++) {
        if (nodes[j].fixed || (!L.touch[i].length && !L.touch[j].length)) continue;
        const pi = { x: L.x[j], y: L.y[j] }, pj = { x: L.x[i], y: L.y[i] };
        if (!L.clear(i, pi.x, pi.y, i, j) || !L.clear(j, pj.x, pj.y, i, j)) continue;
        // (They may differ in size: after the exchange they still have to clear each other.)
        if (pi.x < pj.x + nodes[j].w + ROOM_X && pi.x + nodes[i].w + ROOM_X > pj.x && pi.y < pj.y + nodes[j].room + ROOM_Y && pi.y + nodes[i].room + ROOM_Y > pj.y) continue;
        L.trial([i, j], [pi, pj]);
        if (!keep(L.dc, L.dl, L.dx)) continue;
        L.commit();
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/**
 * Bring wires out from behind cards, the cheapest cure first. Every card in trouble is tried on every
 * free row of its columns; of all of them, the move that gains the most is made, then the next best
 * that still holds, and so on, round after round.
 */
function repair(L: Layout, cols: number[], budget: number) {
  const { nodes } = L;
  for (let round = 0; round < 40 && L.work < budget; round++) {
    const found: { i: number; p: Pt; gain: number }[] = [];
    for (let i = 0; i < L.n && L.work < budget; i++) {
      if (nodes[i].fixed || !L.touch[i].length || L.barren[i] === L.moves || L.trouble(i) <= 0) continue;
      const { p, gain } = bestOf(L, i, spotsFor(L, i, cols, true), anyGain, budget);
      if (p) found.push({ i, p, gain });
      else if (L.work < budget) L.barren[i] = L.moves;
    }
    if (!found.length) break;
    found.sort((a, b) => b.gain - a.gain || a.i - b.i);
    let changed = false;
    for (const f of found) if (moveIf(L, f.i, f.p, anyGain)) changed = true;
    if (!changed) break;
  }
}

/**
 * A fresh layout: Wells where they are; every other card, in the order of the line, in the first
 * column to the right of what feeds it (or the one after), on the free row where its wires cost the
 * least: short, clear of the cards already down, crossing as few of the wires already drawn as it can.
 * Where the cards stood before plays no part. Cards with no wire at all stay where they are.
 */
function fresh(L: Layout, depth: Int32Array, loose: number[]) {
  const { nodes, input } = L;
  const grid = input.grid;
  for (const i of loose) L.lift(i);
  /** Level with the ports of the cards already down that feed card `i` (or, with `out`, that it feeds). Null when none is down. */
  const level = (i: number, out: boolean): number | null => {
    let sum = 0, count = 0;
    for (const w of L.touch[i]) {
      const a = L.wf[w], b = L.wt[w], wire = input.wires[w];
      if (a === b) continue;
      if (!out && b === i && L.on[a]) {
        sum += L.y[a] + wire.ay - wire.by;
        count++;
      } else if (out && a === i && L.on[b]) {
        sum += L.y[b] + wire.by - wire.ay;
        count++;
      }
    }
    return count ? sum / count : null;
  };
  const place = (i: number) => {
    const was = { x: L.x[i], y: L.y[i] };
    let want = level(i, false);
    let x0: number;
    if (want != null) {
      // The first column to the right of everything that feeds it.
      x0 = -Infinity;
      for (const w of L.touch[i]) {
        const a = L.wf[w];
        if (L.wt[w] === i && a !== i && L.on[a]) x0 = Math.max(x0, L.x[a] + nodes[a].w + SPAN);
      }
    } else {
      // Nothing that feeds it is down (it is fed by nothing, or only round a loop): to the left of what it feeds.
      want = level(i, true);
      x0 = Infinity;
      for (const w of L.touch[i]) {
        const b = L.wt[w];
        if (L.wf[w] === i && b !== i && L.on[b]) x0 = Math.min(x0, L.x[b] - nodes[i].w - SPAN);
      }
      if (want == null) {
        // Wired only to cards that are not down yet: where it stood.
        want = was.y;
        x0 = was.x;
      }
    }
    x0 = Math.round(x0 / grid) * grid;
    const free = (px: number, py: number) => L.clear(i, px, py, i);
    let best: Pt | null = null;
    let bestCost = Infinity;
    const rows = rowsFor(input, nodes[i].room);
    for (const x of [x0, x0 + COL_PITCH]) {
      for (const y of rows) {
        if (!free(x, y)) continue;
        // (Between two spots that cost the same: the one nearer the level it wants.)
        const cost = L.put(i, x, y) + Math.abs(y - want) * 0.01;
        L.lift(i);
        if (cost < bestCost) {
          bestCost = cost;
          best = { x, y };
        }
      }
      // The next column is only worth a look when this one has no clean spot.
      if (best && bestCost < UNDER / 2) break;
    }
    best ??= nearFree(x0, want, grid, free) ?? was;
    L.put(i, best.x, best.y);
  };
  // Along the line; within a depth, from the top down by where each card wants to be.
  const reached = loose.filter((i) => depth[i] > 0).sort((a, b) => depth[a] - depth[b] || nodes[a].id - nodes[b].id);
  let at = 0;
  while (at < reached.length) {
    let end = at;
    while (end < reached.length && depth[reached[end]] === depth[reached[at]]) end++;
    const row = reached.slice(at, end).map((i) => ({ i, y: level(i, false) ?? Infinity })).sort((a, b) => a.y - b.y || nodes[a.i].id - nodes[b.i].id);
    for (const { i } of row) place(i);
    at = end;
  }
  // Cards no Well leads to: those that feed something already down first, so that the rest can follow them.
  const rest = loose.filter((i) => depth[i] <= 0);
  for (let round = 0; round < 2; round++) {
    for (const i of rest) {
      if (L.on[i]) continue;
      if (round === 0 && level(i, false) == null && level(i, true) == null) continue;
      place(i);
    }
  }
}

/**
 * A fresh layout in plain columns: every card in the column its depth in the line gives it, level with
 * what feeds it, on the nearest free ground. Short wires and straight rows; wires may run behind cards.
 */
function freshLevel(L: Layout, depth: Int32Array, loose: number[], cols: number[]) {
  const { nodes, input } = L;
  for (const i of loose) L.lift(i);
  const level = (i: number) => {
    let sum = 0, count = 0;
    for (const w of L.touch[i]) {
      const a = L.wf[w];
      if (L.wt[w] !== i || a === i || !L.on[a]) continue;
      sum += L.y[a] + input.wires[w].ay - input.wires[w].by;
      count++;
    }
    return count ? sum / count : null;
  };
  const order = loose.filter((i) => depth[i] > 0).sort((a, b) => depth[a] - depth[b] || nodes[a].id - nodes[b].id);
  let at = 0;
  while (at < order.length) {
    let end = at;
    while (end < order.length && depth[order[end]] === depth[order[at]]) end++;
    const row = order.slice(at, end).map((i) => ({ i, y: level(i) ?? L.y[i] })).sort((a, b) => a.y - b.y || nodes[a.i].id - nodes[b.i].id);
    for (const { i, y } of row) {
      let x = cols[Math.min(depth[i], cols.length - 1)];
      // (A Well further right than that column: to the right of it.)
      for (const w of L.touch[i]) if (L.wt[w] === i && L.on[L.wf[w]]) x = Math.max(x, Math.round((L.x[L.wf[w]] + nodes[L.wf[w]].w + SPAN) / input.grid) * input.grid);
      const p = nearFree(x, y, input.grid, (px, py) => L.clear(i, px, py, i)) ?? { x: L.x[i], y: L.y[i] };
      L.put(i, p.x, p.y);
    }
    at = end;
  }
  // Cards no Well leads to: to the left of what they feed, level with it; with nothing to go by, where they stood.
  for (let round = 0; round < 2; round++) {
    for (const i of loose) {
      if (L.on[i]) continue;
      let x = L.x[i], y = L.y[i], found = false;
      for (const w of L.touch[i]) {
        const b = L.wt[w];
        if (L.wf[w] !== i || b === i || !L.on[b] || found) continue;
        x = L.x[b] - nodes[i].w - SPAN;
        y = L.y[b] + input.wires[w].by - input.wires[w].ay;
        found = true;
      }
      if (!found && round === 0) continue;
      const p = nearFree(x, y, input.grid, (px, py) => L.clear(i, px, py, i)) ?? { x: L.x[i], y: L.y[i] };
      L.put(i, p.x, p.y);
    }
  }
}

/** Numbers that look random and are the same on every run. */
function dice(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** While a fresh layout is shaken into shape, a move that makes things worse by this many px of wire is still taken about one time in three: at first, and at the end. */
const HOT = 300, COLD = 8;
/** Where only a few cards are shaken (those round a wire that is stuck behind a card), it starts this much cooler. */
const WARM = 100;
/** ln(HOT / COLD). */
const COOLING = 3.6243;

/**
 * Shake a layout into shape. One card at a time is tried somewhere that makes sense for it (a few rows up
 * or down; beside a card at the other end of one of its wires; any row of its column; a column over; in
 * the place of another card). A move that lowers the score is always made; one that raises it is made
 * now and then, often at first and hardly ever by the end. That is what gets cards past each other: one
 * card at a time, always downhill, a layout sticks with its wires tangled round the Market, because every
 * way out begins with a step that makes things worse. Returns the best layout seen on the way, and how
 * much better than the one it began with its score is.
 *
 * The numbers that decide are the same on every run, and nothing here is worked out with anything but
 * plus, minus, times and divide (which every machine does alike): so the layout is the same everywhere.
 */
function anneal(L: Layout, loose: number[], trials: number, seed: number, hot = HOT): { at: Pt[]; gain: number } {
  const { nodes, input } = L;
  const grid = input.grid;
  const bestX = Float64Array.from(L.x), bestY = Float64Array.from(L.y);
  let best = 0;
  if (loose.length && trials > 0) {
    const r = dice(seed);
    const rows = new Map<number, number[]>();
    const rowsOf = (i: number) => {
      let rs = rows.get(nodes[i].room);
      if (!rs) rows.set(nodes[i].room, (rs = rowsFor(input, nodes[i].room)));
      return rs;
    };
    // (Cooling by the same small step every trial: from HOT to about COLD over the run.)
    const cool = 1 - (COOLING * hot) / HOT / Math.max(trials, 8);
    let T = hot, now = 0;
    const one = [0], two = [0, 0], spot: Pt[] = [{ x: 0, y: 0 }];
    // (A spot that is taken is no trial: `guard` only keeps a board with no free ground at all from spinning here.)
    for (let done = 0, guard = trials * 30; done < trials && guard > 0; guard--) {
      const i = loose[Math.floor(r() * loose.length)];
      const kind = r();
      let ids: number[], to: Pt[];
      if (kind < 0.12) {
        const j = loose[Math.floor(r() * loose.length)];
        if (j === i) continue;
        const pi = { x: L.x[j], y: L.y[j] }, pj = { x: L.x[i], y: L.y[i] };
        if (!L.clear(i, pi.x, pi.y, i, j) || !L.clear(j, pj.x, pj.y, i, j)) continue;
        if (pi.x < pj.x + nodes[j].w + ROOM_X && pi.x + nodes[i].w + ROOM_X > pj.x && pi.y < pj.y + nodes[j].room + ROOM_Y && pi.y + nodes[i].room + ROOM_Y > pj.y) continue;
        two[0] = i;
        two[1] = j;
        ids = two;
        to = [pi, pj];
      } else {
        // Beside the card at the other end of one of its wires, level with that port.
        const ws = L.touch[i];
        const w = ws[Math.floor(r() * ws.length)];
        const a = L.wf[w], b = L.wt[w], wire = input.wires[w];
        // (A card that is off the board for now stands nowhere: nothing may go by where it used to be.)
        if (!L.on[a] || !L.on[b]) continue;
        const nx = Math.round((b === i ? L.x[a] + nodes[a].w + SPAN : L.x[b] - nodes[i].w - SPAN) / grid) * grid;
        const ny = Math.round((b === i ? L.y[a] + wire.ay - wire.by : L.y[b] + wire.by - wire.ay) / grid) * grid;
        let px: number, py: number;
        if (kind < 0.35) {
          px = L.x[i];
          py = L.y[i] + (Math.floor(r() * 9) - 4) * grid * (r() < 0.5 ? 1 : 3);
        } else if (kind < 0.55) {
          px = nx;
          py = ny + (Math.floor(r() * 13) - 6) * grid;
        } else if (kind < 0.8) {
          const rs = rowsOf(i);
          px = r() < 0.5 ? L.x[i] : nx;
          py = rs.length ? rs[Math.floor(r() * rs.length)] : L.y[i];
        } else {
          px = L.x[i] + (r() < 0.5 ? -1 : 1) * (r() < 0.5 ? COL_PITCH : 3 * grid);
          py = L.y[i] + (Math.floor(r() * 5) - 2) * grid;
        }
        if ((px === L.x[i] && py === L.y[i]) || !L.clear(i, px, py, i)) continue;
        one[0] = i;
        ids = one;
        spot[0] = { x: px, y: py };
        to = spot;
      }
      L.trial(ids, to);
      done++;
      T *= cool;
      const d = L.dc * CROSS + L.dl + L.dx;
      if (d >= 0) {
        // About e to the minus d / T, by its series.
        const q = d / T;
        if (r() * (1 + q * (1 + (q / 2) * (1 + (q / 3) * (1 + (q / 4) * (1 + q / 5))))) >= 1) continue;
      }
      L.commit();
      now += d;
      if (now < best - 1e-6) {
        best = now;
        bestX.set(L.x);
        bestY.set(L.y);
      }
    }
  }
  return { at: nodes.map((_, i) => ({ x: bestX[i], y: bestY[i] })), gain: -best };
}

/** A layout in numbers: what the player sees (`boardStats`) and what the search charges for it. */
interface Grade extends BoardStats { /** Charged for wires behind cards and brushing them. */ charge: number; score: number }

function gradeOf(L: Layout): Grade {
  const at = new Map<number, Pt>();
  L.positions().forEach((p, i) => at.set(L.nodes[i].id, p));
  const s = boardStats(L.input, at);
  const { under, back } = L.charges();
  return { ...s, charge: under, score: s.crossings * CROSS + s.length + under + back };
}

/**
 * All the comparing one Tidy may do (see `Layout.work`; a rough layout's comparing is cheaper and counts
 * for less), and the shares of it each part may use. A board of thirty cards never gets near it; a
 * board of fifty spends it all, and settles for what it has by then.
 */
const TOTAL = 3400000, ROUGH = 0.4;
const SHARE_AS_IT_STANDS = 0.1, SHARE_PLAIN = 0.2, SHARE_MEND = 0.15, SHARE_UNSTICK = 0.3;
/** Trials each card gets when a layout is shaken: all of it (a fresh layout: this many at most, and at least so many for it to be worth doing), or just the cards round a wire that is stuck behind one (and three times as many again when that was not enough). */
const SHAKE_PER_CARD = 1500, SHAKE_AT_LEAST = 250, GENTLE_PER_CARD = 1000, GENTLE_ROUNDS = 2;
/** A fresh layout is shaken this many times, each time with other numbers deciding: where one run ends up is a matter of luck, and the better of two short ones beats one long one. */
const SHAKES = 2;
/** A layout that moves every card (plain columns, a fresh one) has to beat the board as it stands, mended, by this share of its score. */
const MARGIN = 0.04;

/**
 * Tidy a board. Returns the new place of every card that should move (none when the board cannot be
 * bettered). The result never has two cards overlapping, never moves a Well, and never has more wires
 * behind cards than the board it was given; nor more wire crossings or more wire, unless a wire came
 * out from behind a card for it (all of this once any overlapping cards on that board have been
 * pulled apart).
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
  const fine = (at: Pt[]) => new Layout(inp, nodes, wf, wt, at, FINE, FINE_STEP);

  const base = fine(start);
  const baseGrade = gradeOf(base);
  /** A layout passes when it has no more wires behind cards than the board, and no more crossings or wire either unless a wire came out from behind a card. */
  const passes = (s: Grade) =>
    s.overlaps === 0 && s.under <= baseGrade.under && (s.under < baseGrade.under || (s.crossings <= baseGrade.crossings && s.length <= baseGrade.length + 0.5));
  let best = base, bestGrade = baseGrade;
  /**
   * Take a layout if it passes and is better than the best so far: one with no wire behind a card beats
   * any that has one; otherwise the lower score wins, and a fresh layout (which moves every card) has to
   * win by MARGIN at least.
   */
  const offer = (L: Layout, isFresh: boolean): Grade => {
    const s = gradeOf(L);
    const margin = isFresh && (best === base || best === a) ? MARGIN : 0;
    const clean = s.under === 0, cleanBest = bestGrade.under === 0;
    if (passes(s) && (clean !== cleanBest ? clean : s.score < bestGrade.score * (1 - margin) - 1)) {
      best = L;
      bestGrade = s;
    }
    return s;
  };
  let spent = 0;
  /** What is left of a share of the comparing, for a layout that has already done `L.work` of it. */
  const upTo = (L: Layout, share: number) => L.work + Math.max(0, Math.min(share * TOTAL, TOTAL - spent));
  /** Bring wires out from behind cards, then improve, within a share of the comparing. */
  const mend = (L: Layout, share: number) => {
    const from = L.work, limit = upTo(L, share);
    repair(L, cols, limit);
    improve(L, anyGain, cols, limit, true);
    spent += L.work - from;
  };
  /** The cards with a wire behind them, or with a wire of their own behind a card, and the cards wired to those. */
  const stuck = (L: Layout): number[] => {
    const hurt = new Set<number>();
    for (const i of loose) {
      if (L.trouble(i) < UNDER) continue;
      hurt.add(i);
      for (const w of L.touch[i]) for (const j of [wf[w], wt[w]]) if (!nodes[j].fixed) hurt.add(j);
    }
    return [...hurt].sort((x, y) => x - y);
  };
  /** Where a few cards are stuck with a wire behind one, shake just those, gently, and mend again; and once more, longer. */
  const unstick = (L: Layout, share: number, seed: number): Layout => {
    const perTrial = wires.length ? (2 * wires.length * (wires.length + nodes.length)) / Math.max(1, loose.length) + wires.length : 1;
    const until = spent + share * TOTAL;
    for (let round = 0; round < GENTLE_ROUNDS; round++) {
      const among = stuck(L);
      if (!among.length) break;
      // (Two thirds of what is left of the share for the shake, the rest to mend after it.)
      const room = Math.max(0, Math.min(until, TOTAL) - spent);
      const trials = Math.floor(Math.min(GENTLE_PER_CARD * (1 + 2 * round) * among.length, (room * 0.67) / ROUGH / perTrial));
      if (trials < 8) break;
      const rough = new Layout(inp, nodes, wf, wt, L.positions(), COARSE, COARSE_STEP);
      const shaken = anneal(rough, among, trials, seed + round, WARM);
      spent += rough.work * ROUGH;
      L = fine(shaken.at);
      mend(L, Math.max(0, Math.min(until, TOTAL) - spent) / TOTAL);
    }
    return L;
  };

  const loose: number[] = [], core: number[] = [], leaves: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].fixed || !base.touch[i].length) continue;
    loose.push(i);
    // A card on one wire (a Lab beside its Well, a Void) is no part of the puzzle: it is put down afterwards, beside what it is wired to.
    const w = base.touch[i][0];
    const other = wf[w] === i ? wt[w] : wf[w];
    if (base.touch[i].length === 1 && other !== i && (nodes[other].fixed || base.touch[other].length > 1)) leaves.push(i);
    else core.push(i);
  }

  // 1. The board as it stands, mended.
  const a = fine(start);
  mend(a, SHARE_AS_IT_STANDS);
  // Nothing to mend, and no wire behind a card: the board is tidy, and is not laid out afresh to find out.
  if (!a.moves && !apart.size && baseGrade.under === 0 && baseGrade.charge < UNDER) return new Map();
  offer(a, false);
  // (Its whole share counts as spent, used or not: what follows must not depend on how the board stood.)
  spent = SHARE_AS_IT_STANDS * TOTAL;

  if (loose.length) {
    // 2. Plain columns: short wires and straight rows first (as if a wire behind a card cost little), then mended.
    const soft = new Layout(inp, nodes, wf, wt, start, FINE, FINE_STEP, SOFT, 0);
    freshLevel(soft, depth, loose, cols);
    improve(soft, anyGain, cols, upTo(soft, SHARE_PLAIN), false);
    spent += soft.work;
    let plain = fine(soft.positions());
    mend(plain, SHARE_MEND);
    plain = unstick(plain, SHARE_UNSTICK, 1);
    const gp = offer(plain, true);

    // 3. Where that still leaves a wire behind a card: a fresh layout shaken into shape, a few times; each mended.
    if ((gp.under > 0 || gp.charge >= UNDER) && core.length) {
      let live = 0;
      for (let w = 0; w < wf.length; w++) if (!leaves.includes(wf[w]) && !leaves.includes(wt[w])) live++;
      const perTrial = (2 * live * (live + nodes.length)) / core.length + live;
      const left = Math.max(0, TOTAL - spent);
      // Twice if there is comparing left for two proper shakes, once if only for one; a board too big for even that is not shaken at all.
      const all = (left * 0.55) / ROUGH / perTrial;
      const shakes = all >= SHAKES * SHAKE_AT_LEAST * core.length ? SHAKES : all >= SHAKE_AT_LEAST * core.length ? 1 : 0;
      const trials = Math.floor(Math.min(SHAKE_PER_CARD * core.length, all / Math.max(1, shakes)));
      const share = (left * 0.45) / TOTAL / Math.max(1, shakes);
      for (let k = 0; k < shakes; k++) {
        const rough = new Layout(inp, nodes, wf, wt, start, COARSE, COARSE_STEP);
        for (const i of leaves) rough.lift(i);
        fresh(rough, depth, core);
        const shaken = anneal(rough, core, trials, 1 + k, HOT);
        spent += rough.work * ROUGH;
        let b = fine(shaken.at);
        fresh(b, depth, leaves);
        mend(b, share * 0.4);
        b = unstick(b, share * 0.6, 1 + k);
        offer(b, true);
      }
    }
  }
  if (best === base) {
    // Nothing passed: the careful way, which cannot lose.
    const c = fine(start);
    improve(c, noLoss, cols, TOTAL * SHARE_AS_IT_STANDS, false);
    const gc = gradeOf(c);
    if (passes(gc) && gc.score < baseGrade.score - 1) best = c;
  }
  // What the next Tidy would do with this layout is done now, until it changes nothing: so a board that has
  // been tidied is left alone by the next Tidy. (It would mend it; and, that changing nothing, take the careful way.)
  if (best !== base) {
    const before = best.positions(), was = bestGrade;
    const share = SHARE_AS_IT_STANDS * TOTAL;
    for (let pass = 0; pass < 6; pass++) {
      const moves = best.moves;
      const limit = best.work + share;
      repair(best, cols, limit);
      improve(best, anyGain, cols, limit, true);
      if (best.moves === moves) improve(best, noLoss, cols, best.work + share, false);
      if (best.moves === moves) break;
    }
    const s = gradeOf(best);
    if (!passes(s) || s.under > was.under || s.score > was.score) best = fine(before);
  }
  const out = new Map<number, Pt>();
  const end = best.positions();
  nodes.forEach((n, i) => {
    if (end[i].x !== n.x || end[i].y !== n.y) out.set(n.id, end[i]);
  });
  return out;
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

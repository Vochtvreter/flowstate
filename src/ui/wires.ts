// How a wire runs from one port to another: the line that is drawn, and the same line as points. DOM-free.
//
// Cable management. A wire used to be one curve from port to port, and where it went was decided by where its two
// cards stood: ten wires into one Market lay on top of each other, and the only way to move a wire was to move a
// card. A wire now has a style, the board's choice, and may have pins, the player's:
//
//  - curved: the curve it always was. With pins, a run of such curves from pin to pin.
//  - squared: right angles with rounded corners, as on a circuit board. A wire leaves its port, runs level, turns
//    once and comes level into the port it ends at: before the card it ends at, just after the card it leaves, or
//    half way, the first of those with no card in its way. A wire that ends behind its start goes out, round and
//    back in. With a card in the way of every such way, the wire finds its own way round the cards: the shortest
//    with the fewest corners that keeps clear of all of them. Wires that then share a line (those that turn before
//    the same card, those that pass the same side of one) are set side by side, LANE_GAP apart, in the order in
//    which the fewest cross: a ribbon, not a knot.
//  - pins: the points a wire is set to run through, the player's clips (state.ts Clip: a clip may hold several wires),
//    up to MAX_CLIPS a wire, kept with the save. A curved wire passes through each.
//    A squared wire passes through each too: it runs level to the pin's upright and up or down through the pin, so
//    one pin slides a wire's upright run to where the pin is and two take it round a card; and where a card is in
//    the way of that, it finds its way from pin to pin as an unpinned wire does from port to port. Wires that share
//    pins share lines, and are set side by side there as the others are: a bundle through the clip.
//
// What is returned is the SVG path and the line as n + 1 points, corners among them, which is what the dots travel
// along and what a click, the knife and the rate chips are measured against (fx.ts, board.ts). Nothing here reads
// the game: ends and cards are handed in. The rules of the game know nothing of any of it: a wire carries the same
// whatever way it runs.
import { MAX_CLIPS } from '../state';
import { Box, Pt, curve } from './geom';

export { MAX_CLIPS };

export type WireStyle = 'curved' | 'squared';
export const WIRE_STYLES: WireStyle[] = ['curved', 'squared'];

/** A squared wire runs this far straight out of a port, and into one, before it may turn. */
export const STUB = 20;
/** The radius of a squared wire's corners (less where the runs either side are short). */
export const CORNER = 10;
/** Squared wires that share a line (they turn before the same card, or pass the same side of one) run this far apart. */
export const LANE_GAP = 8;
/** Two ports this close in height are level: the wire between them is a straight line. */
const LEVEL = 0.75;

/** A wire as it is drawn. */
export interface Drawn {
  /** The SVG path. */
  d: string;
  /** The same line as points, start to end: as many as were asked for, plus one. */
  pts: Pt[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const same = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;

// ---------- curved ----------

function cubicAt(c: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x,
    y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y,
  };
}

/** Share `n` steps among legs by their lengths, at least `least` each (fewer where there are not enough to go round). */
function share(lengths: number[], n: number, least: number): number[] {
  const k = lengths.length;
  const min = Math.max(1, Math.min(least, Math.floor(n / k)));
  const out = lengths.map(() => min);
  let left = n - min * k;
  const total = lengths.reduce((s, v) => s + v, 0) || 1;
  const want = lengths.map((v) => (v / total) * left);
  for (let i = 0; i < k; i++) {
    const give = Math.floor(want[i]);
    out[i] += give;
    left -= give;
  }
  // What is left over goes to the legs that were rounded down the most.
  const order = want.map((v, i) => [v - Math.floor(v), i] as const).sort((p, q) => q[0] - p[0]);
  for (let i = 0; left > 0; i = (i + 1) % k, left--) out[order[i][1]]++;
  return out;
}

/** A curved wire: one curve with level ends, or a run of them through its pins. */
export function drawCurved(a: Pt, b: Pt, pins: Pt[], n: number): Drawn {
  const stops = [a, ...pins, b];
  const legs = stops.slice(1).map((to, i) => curve(stops[i], to));
  const steps = share(legs.map((c) => Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y) + 1), n, 4);
  let d = `M${a.x} ${a.y}`;
  const pts: Pt[] = [{ x: a.x, y: a.y }];
  legs.forEach((c, i) => {
    d += ` C ${c[1].x} ${c[1].y}, ${c[2].x} ${c[2].y}, ${c[3].x} ${c[3].y}`;
    for (let s = 1; s <= steps[i]; s++) pts.push(cubicAt(c, s / steps[i]));
  });
  return { d, pts };
}

// ---------- squared ----------

/** Corners that turn nothing (three in a row on one line, or the same point twice) are taken out. */
function tidy(v: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of v) {
    if (out.length && same(out[out.length - 1], p)) continue;
    while (out.length >= 2) {
      const a = out[out.length - 2], m = out[out.length - 1];
      const cross = (m.x - a.x) * (p.y - m.y) - (m.y - a.y) * (p.x - m.x);
      const along = (m.x - a.x) * (p.x - m.x) + (m.y - a.y) * (p.y - m.y);
      if (Math.abs(cross) < 0.01 && along >= 0) out.pop();
      else break;
    }
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Where a squared wire with no pins turns, when it turns once: before the card it ends at, after the card it leaves, or half way. */
export type Turn = 'end' | 'start' | 'mid';

/** The corners of a squared wire with no pins that ends ahead of its start, turning at `turn`. */
export function forward(a: Pt, b: Pt, turn: Turn): Pt[] {
  if (Math.abs(a.y - b.y) <= LEVEL) return [a, b];
  const lo = a.x + STUB, hi = b.x - STUB;
  const at = turn === 'end' ? hi : turn === 'start' ? lo : (a.x + b.x) / 2;
  return tidy([a, { x: at, y: a.y }, { x: at, y: b.y }, b]);
}

/** The corners of a squared wire that ends behind its start (or too close ahead to turn between): out, across at height `y`, and back in. */
export function around(a: Pt, b: Pt, y: number): Pt[] {
  return tidy([a, { x: a.x + STUB, y: a.y }, { x: a.x + STUB, y }, { x: b.x - STUB, y }, { x: b.x - STUB, y: b.y }, b]);
}

/** Does a squared wire from a to b have room to turn between its ports? */
export const ahead = (a: Pt, b: Pt) => b.x - a.x >= 2 * STUB;

/**
 * The corners of a squared wire through pins: level from the port to the first pin's upright, up or down to that pin,
 * level to the next pin's upright and so on, and from the last pin up or down to the height of the port it ends at.
 * Every pin is a corner or lies on an upright run. Out of a port a wire runs right first, and into one from the left:
 * a pin behind the port it comes after, or ahead of the one it comes before, is reached by way of the stub.
 */
export function throughPins(a: Pt, b: Pt, pins: Pt[]): Pt[] {
  const v: Pt[] = [a];
  let at = a;
  pins.forEach((p, i) => {
    if (i === 0 && p.x < a.x + STUB) v.push({ x: a.x + STUB, y: a.y }, { x: a.x + STUB, y: p.y });
    else v.push({ x: p.x, y: at.y });
    v.push(p);
    at = p;
  });
  if (at.x > b.x - STUB) v.push({ x: b.x - STUB, y: at.y }, { x: b.x - STUB, y: b.y });
  else v.push({ x: at.x, y: b.y });
  v.push(b);
  return tidy(v);
}

/** A squared wire, from its corners: straight runs with rounded corners, and the same line as n + 1 points. */
export function drawSquared(corners: Pt[], n: number): Drawn {
  const v = tidy(corners);
  if (v.length < 2) {
    const p = v[0] ?? { x: 0, y: 0 };
    return { d: `M${p.x} ${p.y}`, pts: Array.from({ length: n + 1 }, () => ({ x: p.x, y: p.y })) };
  }
  let d = `M${r1(v[0].x)} ${r1(v[0].y)}`;
  // The line as points that must be kept: its ends, and where each corner begins, bends and ends.
  const keep: Pt[] = [v[0]];
  for (let i = 1; i < v.length - 1; i++) {
    const p = v[i - 1], c = v[i], q = v[i + 1];
    const din = Math.hypot(c.x - p.x, c.y - p.y), dout = Math.hypot(q.x - c.x, q.y - c.y);
    const r = Math.min(CORNER, din / 2, dout / 2);
    const p1 = { x: c.x - ((c.x - p.x) / din) * r, y: c.y - ((c.y - p.y) / din) * r };
    const p2 = { x: c.x + ((q.x - c.x) / dout) * r, y: c.y + ((q.y - c.y) / dout) * r };
    d += ` L${r1(p1.x)} ${r1(p1.y)} Q${r1(c.x)} ${r1(c.y)} ${r1(p2.x)} ${r1(p2.y)}`;
    keep.push(p1, { x: 0.25 * p1.x + 0.5 * c.x + 0.25 * p2.x, y: 0.25 * p1.y + 0.5 * c.y + 0.25 * p2.y }, p2);
  }
  const end = v[v.length - 1];
  d += ` L${r1(end.x)} ${r1(end.y)}`;
  keep.push(end);
  return { d, pts: spread(tidyKeep(keep), n) };
}

/** The same point twice in a row is one point (a corner with no room for a radius). */
function tidyKeep(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.length || !same(out[out.length - 1], p)) out.push(p);
  return out.length > 1 ? out : [pts[0], pts[pts.length - 1]];
}

/**
 * n + 1 points along a line of points, every one of the line's own among them where there are enough to go round
 * (the rest set evenly along its runs, more on the longer ones): the dots turn the corners the wire turns. With more
 * points on the line than were asked for, they are set evenly along it instead.
 */
export function spread(line: Pt[], n: number): Pt[] {
  const runs = line.length - 1;
  const len = line.slice(1).map((p, i) => Math.hypot(p.x - line[i].x, p.y - line[i].y));
  if (runs > n) {
    const total = len.reduce((s, v) => s + v, 0) || 1;
    const out: Pt[] = [];
    let i = 0, before = 0;
    for (let k = 0; k <= n; k++) {
      const s = (total * k) / n;
      while (i < runs - 1 && before + len[i] < s) before += len[i++];
      const t = len[i] > 0 ? Math.max(0, Math.min(1, (s - before) / len[i])) : 0;
      out.push({ x: line[i].x + (line[i + 1].x - line[i].x) * t, y: line[i].y + (line[i + 1].y - line[i].y) * t });
    }
    return out;
  }
  const steps = share(len, n, 1);
  const out: Pt[] = [{ x: line[0].x, y: line[0].y }];
  for (let i = 0; i < runs; i++) {
    for (let s = 1; s <= steps[i]; s++) {
      const t = s / steps[i];
      out.push({ x: line[i].x + (line[i + 1].x - line[i].x) * t, y: line[i].y + (line[i + 1].y - line[i].y) * t });
    }
  }
  return out;
}

// ---------- a way round cards ----------

/** A squared wire keeps this far from every card it passes: a card nearer than this to one of its runs is in its way. */
export const CLEAR = 6;
/** Where a wire goes round a card, it runs this far out from the card's sides (a stub's length), and this far above or below it. */
export const PASS_X = STUB;
export const PASS_Y = 14;
/** What a corner costs a wire that is looking for its way, in pixels of length: a way with a corner fewer may be this much longer. */
const BEND = 36;
/** Of two ways as good as each other, the one that runs level first and turns late is taken (a hair's worth an upright pixel, by how far from the end it stands). */
const LATE = 1e-5;
/** Lines of the search nearer than this to one another are one line. */
const MERGE = 3;
/** How far round its two ends a wire looks for a way, widening when it finds none (or only a long one). */
const REACH = [100, 320, Infinity];
/** Too close ahead for two stubs, but with this much between the two cards a wire still turns once between them. */
const NEAR = 4;
const EPS = 0.01;

/** A wire to be drawn: its ends, the cards at them, and its pins if it has any. */
export interface WireIn { id: number; from: number; to: number; a: Pt; b: Pt; pins?: Pt[] }
/** A card that wires should not pass behind. */
export interface CardBox extends Box { id: number }

/** Is a level or upright run nearer than `clear` to a card, or behind it? */
function near(p: Pt, q: Pt, c: Box, clear: number): boolean {
  return Math.min(p.x, q.x) < c.x1 + clear - EPS && Math.max(p.x, q.x) > c.x0 - clear + EPS
    && Math.min(p.y, q.y) < c.y1 + clear - EPS && Math.max(p.y, q.y) > c.y0 - clear + EPS;
}

/**
 * How many cards are in the way of a line of corners: behind one of its runs, or within CLEAR of it. The run out of
 * a port lies along the card it leaves and the run into one along the card it enters: those two do not count there.
 */
export function inWay(corners: Pt[], cards: CardBox[], from: number, to: number, clear = CLEAR): number {
  let count = 0;
  const last = corners.length - 2;
  for (const c of cards) {
    for (let i = 0; i <= last; i++) {
      if ((i === 0 && c.id === from) || (i === last && c.id === to)) continue;
      if (near(corners[i], corners[i + 1], c, clear)) {
        count++;
        break;
      }
    }
  }
  return count;
}

// The search works on a few lines only: those a wire would run along to pass a card (PASS out from each side of it),
// and the heights and stubs of its own two ports. Where two such lines meet is a place the wire may turn. What it is
// looking for is the way with the least length and the fewest corners that comes within CLEAR of no card (A*).

/** Scratch for the search, kept from wire to wire and grown as boards grow. */
let room = 0;
let barH = new Uint8Array(0), barV = new Uint8Array(0);
let cost = new Float64Array(0), cameFrom = new Int32Array(0);
let seen = new Uint32Array(0), shut = new Uint32Array(0);
let stamp = 0;
const heapS: number[] = [], heapF: number[] = [];
let heapN = 0;
/** How often a way was looked for, and how often one that was kept did instead: for tests and for measuring. */
export const COUNT = { searches: 0, kept: 0 };

function grow(nodes: number) {
  if (nodes <= room) return;
  room = Math.max(nodes, room * 2, 1024);
  barH = new Uint8Array(room);
  barV = new Uint8Array(room);
  cost = new Float64Array(room * 2);
  cameFrom = new Int32Array(room * 2);
  seen = new Uint32Array(room * 2);
  shut = new Uint32Array(room * 2);
  stamp = 0;
}

function push(s: number, f: number) {
  let i = heapN++;
  while (i > 0) {
    const up = (i - 1) >> 1;
    if (heapF[up] <= f) break;
    heapS[i] = heapS[up];
    heapF[i] = heapF[up];
    i = up;
  }
  heapS[i] = s;
  heapF[i] = f;
}

function pop(): number {
  const top = heapS[0];
  const s = heapS[--heapN], f = heapF[heapN];
  let i = 0;
  for (;;) {
    let kid = i * 2 + 1;
    if (kid >= heapN) break;
    if (kid + 1 < heapN && heapF[kid + 1] < heapF[kid]) kid++;
    if (heapF[kid] >= f) break;
    heapS[i] = heapS[kid];
    heapF[i] = heapF[kid];
    i = kid;
  }
  heapS[i] = s;
  heapF[i] = f;
  return top;
}

/** Sorted lines for the search: every one of `must` as it is, and of `more` those not within MERGE of a line already there. */
function lines(must: number[], more: number[]): number[] {
  const out = must.length > 1 && must[0] === must[1] ? [must[0]] : must.slice();
  const fixed = out.length;
  more.sort((p, q) => p - q);
  let last = -Infinity;
  for (const v of more) {
    if (v - last < MERGE) continue;
    let taken = false;
    for (let i = 0; i < fixed && !taken; i++) taken = Math.abs(out[i] - v) < MERGE;
    if (taken) continue;
    out.push(v);
    last = v;
  }
  return out.sort((p, q) => p - q);
}

/**
 * The best way from one crossing of the lines to another, as points, or null when there is none. A state is a
 * crossing and whether the wire came to it level or upright, so that a corner can be charged for.
 *
 * `came` is the way the wire was going when it reached the start (0 right, 1 left, 2 down, 3 up): out of a port that
 * is right; through a pin, the way the stretch before arrived. It does not turn back on itself there. `port` says
 * what it ends at: the stub of a port, which it must reach from the left, or a pin, which it may reach from any side.
 */
function search(xs: number[], ys: number[], blocks: Box[], si: number, sj: number, ti: number, tj: number, came: number, port: boolean): Pt[] | null {
  const nx = xs.length, ny = ys.length, n = nx * ny;
  COUNT.searches++;
  grow(n);
  barH.fill(0, 0, n);
  barV.fill(0, 0, n);
  // barH[node]: the level step from a crossing to the next on its right is shut; barV[node]: the step to the one below.
  for (const c of blocks) {
    const x0 = c.x0 - CLEAR + EPS, x1 = c.x1 + CLEAR - EPS, y0 = c.y0 - CLEAR + EPS, y1 = c.y1 + CLEAR - EPS;
    for (let j = 0; j < ny; j++) {
      if (ys[j] <= y0 || ys[j] >= y1) continue;
      for (let i = 0; i + 1 < nx; i++) if (xs[i] < x1 && xs[i + 1] > x0) barH[i + j * nx] = 1;
    }
    for (let i = 0; i < nx; i++) {
      if (xs[i] <= x0 || xs[i] >= x1) continue;
      for (let j = 0; j + 1 < ny; j++) if (ys[j] < y1 && ys[j + 1] > y0) barV[i + j * nx] = 1;
    }
  }
  if (++stamp > 4e9) {
    seen.fill(0);
    shut.fill(0);
    stamp = 1;
  }
  const first = si + sj * nx, goal = ti + tj * nx;
  const tx = xs[ti], ty = ys[tj];
  heapN = 0;
  const s0 = first * 2 + (came < 2 ? 0 : 1);
  cost[s0] = 0;
  seen[s0] = stamp;
  cameFrom[s0] = -1;
  // What is left of the way from a crossing, at the least: the distance, and the corners it cannot do without. To
  // a port: come level and not at its height, two; come upright, one. To a pin: one, unless it lies straight on.
  const corners = (i: number, j: number, upright: number) => (port
    ? (i === ti && j === tj ? 0 : upright ? BEND : j === tj ? 0 : 2 * BEND)
    : (upright ? (i === ti ? 0 : BEND) : j === tj ? 0 : BEND));
  push(s0, Math.abs(xs[si] - tx) + Math.abs(ys[sj] - ty) + corners(si, sj, s0 & 1));
  while (heapN > 0) {
    const s = pop();
    if (shut[s] === stamp) continue;
    shut[s] = stamp;
    const node = s >> 1, upright = s & 1;
    if (node === goal) {
      const out: Pt[] = [];
      for (let at = s; at >= 0; at = cameFrom[at]) {
        const k = at >> 1;
        out.push({ x: xs[k % nx], y: ys[(k - (k % nx)) / nx] });
      }
      return out.reverse();
    }
    const i = node % nx, j = (node - i) / nx;
    const g = cost[s];
    for (let m = 0; m < 4; m++) {
      // 0 right, 1 left, 2 down, 3 up
      let ni = i, nj = j, len = 0;
      if (m === 0) {
        if (i + 1 >= nx || barH[node]) continue;
        ni = i + 1;
        len = xs[ni] - xs[i];
      } else if (m === 1) {
        if (i === 0 || barH[node - 1]) continue;
        ni = i - 1;
        len = xs[i] - xs[ni];
      } else if (m === 2) {
        if (j + 1 >= ny || barV[node]) continue;
        nj = j + 1;
        len = ys[nj] - ys[j];
      } else {
        if (j === 0 || barV[node - nx]) continue;
        nj = j - 1;
        len = ys[j] - ys[nj];
      }
      const next = ni + nj * nx;
      // A wire does not turn back on itself where it starts (out of a port it runs right first), and goes into a port from the left.
      if ((node === first && m === (came ^ 1)) || (port && m === 1 && next === goal)) continue;
      const turns = m < 2 ? 0 : 1;
      const t = next * 2 + turns;
      if (shut[t] === stamp) continue;
      let c = g + len + (turns !== upright ? BEND : 0);
      if (turns) c += len * Math.abs(xs[i] - tx) * LATE;
      // (Arriving upright, it has one more corner to turn, into the port.)
      if (port && next === goal && turns) c += BEND;
      if (seen[t] === stamp && cost[t] <= c) continue;
      seen[t] = stamp;
      cost[t] = c;
      cameFrom[t] = s;
      push(t, c + (Math.abs(xs[ni] - tx) + Math.abs(ys[nj] - ty)) * 1.0005 + corners(ni, nj, turns));
    }
  }
  return null;
}

/** Where a wire's stub ends: STUB out from the port, or half that where a card stands in the way of the whole of it. Null with no room for either. */
function stubEnd(p: Pt, side: 1 | -1, cards: Box[]): Pt | null {
  for (const len of [STUB, STUB / 2]) {
    const q = { x: p.x + side * len, y: p.y };
    if (!cards.some((c) => near(q, q, c, CLEAR))) return q;
  }
  return null;
}

/** The cards a search of `reach` round the two stub ends has to do with: `by`, those whose sides give it lines; `blocks`, every card those lines pass. */
function inReach(s: Pt, t: Pt, reach: number, cards: Box[]): { by: Box[]; blocks: Box[] } {
  if (reach === Infinity) return { by: cards, blocks: cards };
  const x0 = Math.min(s.x, t.x) - reach, x1 = Math.max(s.x, t.x) + reach, y0 = Math.min(s.y, t.y) - reach, y1 = Math.max(s.y, t.y) + reach;
  const by: Box[] = [];
  // (The lines of a card that is only partly in reach go on past it: every card they pass counts.)
  let gx0 = Math.min(s.x, t.x), gx1 = Math.max(s.x, t.x), gy0 = Math.min(s.y, t.y), gy1 = Math.max(s.y, t.y);
  for (const c of cards) {
    if (c.x1 + PASS_X < x0 || c.x0 - PASS_X > x1 || c.y1 + PASS_Y < y0 || c.y0 - PASS_Y > y1) continue;
    by.push(c);
    gx0 = Math.min(gx0, c.x0 - PASS_X);
    gx1 = Math.max(gx1, c.x1 + PASS_X);
    gy0 = Math.min(gy0, c.y0 - PASS_Y);
    gy1 = Math.max(gy1, c.y1 + PASS_Y);
  }
  if (by.length === cards.length) return { by, blocks: cards };
  const blocks = cards.filter((c) => c.x1 + CLEAR > gx0 && c.x0 - CLEAR < gx1 && c.y1 + CLEAR > gy0 && c.y0 - CLEAR < gy1);
  return { by, blocks };
}

/** A way that was found, kept for as long as nothing it has to do with has moved (see `wayRound`). */
interface Kept { h1: number; h2: number; reach: number; way: Pt[] | null }
const kept = new Map<number, Kept>();

/** Two numbers that stand for the ports and the cards a search had to do with: the same again, and its answer is the same. */
function mark(a: Pt, b: Pt, by: Box[], blocks: Box[], kind: number): [number, number] {
  let h1 = 2166136261, h2 = 0x9e3779b9;
  const mix = (v: number) => {
    const k = Math.round(v * 4) | 0;
    h1 = Math.imul(h1 ^ k, 16777619);
    h2 = Math.imul(h2 + k, 0x85ebca6b) ^ (h2 >>> 13);
  };
  mix(kind); mix(a.x); mix(a.y); mix(b.x); mix(b.y); mix(by.length);
  for (const c of by) { mix(c.x0); mix(c.y0); mix(c.x1); mix(c.y1); }
  mix(blocks.length);
  if (blocks !== by) for (const c of blocks) { mix(c.x0); mix(c.y0); mix(c.x1); mix(c.y1); }
  return [h1, h2];
}

/**
 * One stretch of a way: from `s` to `t`, within CLEAR of no card, as points; null when there is none. It looks near
 * its two ends first, and further only when that finds nothing or a long way round, so a wire in one corner of a big
 * board is not held up by the rest of it. (`came` and `port`: see `search`.)
 *
 * With `key`, the stretch is kept: asked again while its ends and every card the search had to do with stand where
 * they stood, it is given back without looking again. A board is routed afresh at every step of a drag, and most of
 * its wires are nowhere near the card that is moving.
 */
function stretch(s: Pt, t: Pt, cards: Box[], came: number, port: boolean, key?: number): Pt[] | null {
  const kind = (came + 1) * 2 + (port ? 1 : 0);
  const old = key == null ? undefined : kept.get(key);
  if (old) {
    const { by, blocks } = inReach(s, t, old.reach, cards);
    const [h1, h2] = mark(s, t, by, blocks, kind);
    if (h1 === old.h1 && h2 === old.h2) {
      COUNT.kept++;
      return old.way && old.way.map((p) => ({ x: p.x, y: p.y }));
    }
  }
  const direct = Math.abs(s.x - t.x) + Math.abs(s.y - t.y);
  let way: Pt[] | null = null, used = Infinity, by: Box[] = cards, blocks: Box[] = cards;
  for (const reach of REACH) {
    ({ by, blocks } = inReach(s, t, reach, cards));
    const xs = lines([s.x, t.x], by.flatMap((c) => [c.x0 - PASS_X, c.x1 + PASS_X]));
    const ys = lines([s.y, t.y], by.flatMap((c) => [c.y0 - PASS_Y, c.y1 + PASS_Y]));
    const path = search(xs, ys, blocks, xs.indexOf(s.x), ys.indexOf(s.y), xs.indexOf(t.x), ys.indexOf(t.y), came, port);
    const all = by.length === cards.length;
    used = reach;
    if (path) {
      let len = 0;
      for (let i = 1; i < path.length; i++) len += Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
      if (all || len - direct <= 2 * reach) {
        way = path;
        break;
      }
    }
    if (all) break;
  }
  if (key != null) {
    const [h1, h2] = mark(s, t, by, blocks, kind);
    kept.set(key, { h1, h2, reach: used, way: way && way.map((p) => ({ x: p.x, y: p.y })) });
  }
  return way;
}

/** A wire has a stretch from its port to its first pin, one between each two pins, and one to the port it ends at: each is kept under its own number. */
const STRETCHES = 16;

/**
 * A way for a squared wire from port a to port b that comes within CLEAR of no card: its corners, or null when there
 * is none (a port walled in). With `pins` it passes through each of them in turn, finding its way from one to the
 * next (null too when a pin stands nearer than CLEAR to a card: there is no clear way to it). `id` is the wire's, for
 * keeping what was found (see `stretch`).
 */
export function wayRound(a: Pt, b: Pt, cards: Box[], id?: number, pins: Pt[] = []): Pt[] | null {
  const s = stubEnd(a, 1, cards), t = stubEnd(b, -1, cards);
  if (!s || !t) return null;
  const stops = [s, ...pins, t];
  const out: Pt[] = [a];
  let came = 0;
  for (let i = 0; i + 1 < stops.length; i++) {
    const leg = stretch(stops[i], stops[i + 1], cards, came, i + 2 === stops.length, id == null ? undefined : id * STRETCHES + i);
    if (!leg) return null;
    // (The way it was going when it got there: it goes on from the pin without doubling back.)
    for (let k = leg.length - 1; k > 0; k--) {
      const dx = leg[k].x - leg[k - 1].x, dy = leg[k].y - leg[k - 1].y;
      if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) continue;
      came = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 1) : dy > 0 ? 2 : 3;
      break;
    }
    out.push(...leg);
  }
  out.push(b);
  return tidy(out);
}

// ---------- side by side ----------

// Routed one at a time, wires that pass the same card take the same line and lie on top of each other. So afterwards
// every run that shares a line with another wire's run is given a track of its own, LANE_GAP from the next, in the
// room there is beside the line, and in the order in which the fewest of them cross.

/** A run of a wire that may be moved sideways: not the one out of its port nor the one into it. */
interface Run {
  v: Pt[];
  /** The run is from v[i] to v[i + 1]. */
  i: number;
  /** Where it stands: the x of an upright run, the y of a level one. */
  c: number;
  /** From where to where it runs, along itself. */
  lo: number;
  hi: number;
  /** Which way the wire goes on from each of its ends, across the run: -1 to the low side, 1 to the high side. */
  atLo: number;
  atHi: number;
  /** Wires out of one port are one net: they may share a line until they part. */
  net: string;
}

function runsOf(routes: { net: string; v: Pt[] }[], upright: boolean): Run[] {
  const out: Run[] = [];
  for (const r of routes) {
    const v = r.v;
    for (let i = 1; i + 2 < v.length; i++) {
      const p = v[i], q = v[i + 1], before = v[i - 1], after = v[i + 2];
      // (Along: the way the run goes. Across: the other way.)
      const along = (u: Pt) => (upright ? u.y : u.x), across = (u: Pt) => (upright ? u.x : u.y);
      if (Math.abs(across(p) - across(q)) > EPS || Math.abs(along(p) - along(q)) < EPS) continue;
      // The runs either side of it must lie across it, or moving it would bend them.
      if (Math.abs(along(before) - along(p)) > EPS || Math.abs(along(after) - along(q)) > EPS) continue;
      const c = across(p), up = along(p) < along(q);
      const dLo = across(up ? before : after) - c, dHi = across(up ? after : before) - c;
      out.push({ v, i, c, lo: Math.min(along(p), along(q)), hi: Math.max(along(p), along(q)), atLo: Math.sign(dLo), atHi: Math.sign(dHi), net: r.net });
    }
  }
  return out;
}

/** How often two runs' wires cross when `p` stands on the low side of `q`: an end of one that goes on across the other. */
function crossing(p: Run, q: Run): number {
  let n = 0;
  if (p.atLo > 0 && p.lo > q.lo + 0.5 && p.lo < q.hi - 0.5) n++;
  if (p.atHi > 0 && p.hi > q.lo + 0.5 && p.hi < q.hi - 0.5) n++;
  if (q.atLo < 0 && q.lo > p.lo + 0.5 && q.lo < p.hi - 0.5) n++;
  if (q.atHi < 0 && q.hi > p.lo + 0.5 && q.hi < p.hi - 0.5) n++;
  return n;
}

/** The order, from the low side, in which k bundles cross each other least. cross[i][j]: crossings with i on the low side of j. */
function leastCrossing(k: number, cross: number[][]): number[] {
  if (k > 7) {
    // Too many to try every order: each is put where it adds the fewest.
    const cur: number[] = [];
    for (let i = 0; i < k; i++) {
      let best = 0, least = Infinity;
      for (let at = 0; at <= cur.length; at++) {
        let sum = 0;
        for (let q = 0; q < cur.length; q++) sum += q < at ? cross[cur[q]][i] : cross[i][cur[q]];
        if (sum < least) {
          least = sum;
          best = at;
        }
      }
      cur.splice(best, 0, i);
    }
    return cur;
  }
  let best: number[] = [], least = Infinity;
  const used: boolean[] = new Array(k).fill(false), cur: number[] = [];
  const go = (sum: number) => {
    if (sum >= least) return;
    if (cur.length === k) {
      least = sum;
      best = cur.slice();
      return;
    }
    for (let i = 0; i < k; i++) {
      if (used[i]) continue;
      let add = 0;
      for (const p of cur) add += cross[p][i];
      used[i] = true;
      cur.push(i);
      go(sum + add);
      cur.pop();
      used[i] = false;
    }
  };
  go(0);
  return best;
}

/**
 * The room there is to either side of a line at `c` for runs from `lo` to `hi`, keeping `clear` from every card
 * beside them: the least and the most they may stand at. A card that is nearer than that already sets the limit
 * where the line is: nothing is moved nearer to it.
 */
function roomBeside(upright: boolean, c: number, lo: number, hi: number, cards: Box[], clear: number): [number, number] {
  let least = -Infinity, most = Infinity;
  for (const k of cards) {
    const p0 = upright ? k.y0 : k.x0, p1 = upright ? k.y1 : k.x1, q0 = upright ? k.x0 : k.y0, q1 = upright ? k.x1 : k.y1;
    if (p1 + CLEAR <= lo || p0 - CLEAR >= hi) continue;
    if (q1 + clear <= c + EPS) least = Math.max(least, q1 + clear);
    else if (q0 - clear >= c - EPS) most = Math.min(most, q0 - clear);
    else if (c >= (q0 + q1) / 2) least = Math.max(least, c);
    else most = Math.min(most, c);
  }
  return [least, most];
}

/** Give every run that shares a line with another wire's a track of its own. The corners are moved where they are. */
function sideBySide(routes: { net: string; v: Pt[] }[], cards: Box[]) {
  const was = routes.map((r) => r.v.map((p) => ({ x: p.x, y: p.y })));
  for (const upright of [true, false]) {
    const runs = runsOf(routes, upright).sort((p, q) => p.c - q.c || p.lo - q.lo || p.hi - q.hi || (p.net < q.net ? -1 : p.net > q.net ? 1 : 0));
    // Runs on one line, or on lines too near each other to tell apart, that run beside each other for a stretch: one group.
    const root = runs.map((_, i) => i);
    const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length && runs[j].c - runs[i].c < LANE_GAP - EPS; j++) {
        if (Math.min(runs[i].hi, runs[j].hi) - Math.max(runs[i].lo, runs[j].lo) > 1) root[find(j)] = find(i);
      }
    }
    const groups = new Map<number, Run[]>();
    runs.forEach((r, i) => {
      const at = find(i);
      const list = groups.get(at);
      if (list) list.push(r);
      else groups.set(at, [r]);
    });
    for (const group of groups.values()) {
      const nets = [...new Set(group.map((r) => r.net))];
      const k = nets.length;
      if (k < 2) continue;
      const bundles = nets.map((net) => group.filter((r) => r.net === net));
      const cross = bundles.map((p) => bundles.map((q) => (p === q ? 0 : p.reduce((s, x) => s + q.reduce((t, y) => t + crossing(x, y), 0), 0))));
      const order = leastCrossing(k, cross);
      const lo = Math.min(...group.map((r) => r.lo)), hi = Math.max(...group.map((r) => r.hi));
      const c = group.reduce((s, r) => s + r.c, 0) / group.length;
      const need = (k - 1) * LANE_GAP;
      let [least, most] = roomBeside(upright, c, lo, hi, cards, upright ? PASS_X : PASS_Y);
      if (most - least < need) [least, most] = roomBeside(upright, c, lo, hi, cards, CLEAR);
      // (With less room than they need, they stand closer; with none, on each other as before.)
      const span = Math.max(0, Math.min(need, most - least));
      const start = Math.max(least, Math.min(most - span, c - span / 2));
      order.forEach((b, t) => {
        const at = Math.round((start + (span * t) / (k - 1)) * 2) / 2;
        for (const r of bundles[b]) {
          if (upright) r.v[r.i].x = r.v[r.i + 1].x = at;
          else r.v[r.i].y = r.v[r.i + 1].y = at;
        }
      });
    }
  }
  // A wire whose run was moved past the end of the run beside it would double back on itself: it stays as it was.
  routes.forEach((r, k) => {
    const old = was[k];
    let back = false;
    for (let i = 0; i + 1 < old.length && !back; i++) {
      back = (old[i + 1].x - old[i].x) * (r.v[i + 1].x - r.v[i].x) < -EPS || (old[i + 1].y - old[i].y) * (r.v[i + 1].y - r.v[i].y) < -EPS;
    }
    if (back) old.forEach((p, i) => { r.v[i].x = p.x; r.v[i].y = p.y; });
  });
}

// ---------- a whole board ----------

/** How far above or below both cards a squared wire that goes back on itself runs when the cards stand too near each other in height to pass between. */
const ROUND = 70;

/** The plain ways a squared wire with no pins may run, the one it takes when nothing is in the way first. */
function plain(a: Pt, b: Pt): Pt[][] {
  const level = Math.abs(a.y - b.y) <= LEVEL;
  if (ahead(a, b)) return level ? [[a, b]] : [forward(a, b, 'end'), forward(a, b, 'start'), forward(a, b, 'mid')];
  const out: Pt[][] = [];
  // Too close ahead for two stubs: straight across where the ports are level, else one turn half way between the cards.
  if (b.x - a.x >= NEAR) out.push(level ? [a, b] : tidy([a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b]));
  // Back on itself: between the two cards where there is room, else under them, or over them.
  if (Math.abs(a.y - b.y) >= ROUND * 1.6) out.push(around(a, b, (a.y + b.y) / 2));
  else out.push(around(a, b, Math.max(a.y, b.y) + ROUND), around(a, b, Math.min(a.y, b.y) - ROUND));
  return out;
}

/**
 * Every wire of a board as it is drawn in a style. Curved, each wire is its own business. Squared, the wires are
 * routed together:
 *
 *  - a wire with pins goes through each of them: the plain way where that is clear of every card, else finding its
 *    way from pin to pin; it is the player's, and is moved sideways only for a wire it shares a pin with (wires
 *    through one clip run as a bundle about it);
 *  - any other takes the first of its plain ways (one turn: before the card it ends at, after the one it leaves, half
 *    way; or out, round and back in) that comes within CLEAR of no card;
 *  - with a card in the way of every one of those, it finds the shortest way round the cards with the fewest corners
 *    (`wayRound`); only a wire with no way at all (a port walled in) still passes behind a card, the fewest it can;
 *  - then the runs that ended up on one line are set side by side, each on a track of its own (`sideBySide`): wires
 *    that turn in before the same card, or pass the same side of one, are a ribbon and not one thick line.
 */
export function routeAll(wires: WireIn[], cards: CardBox[], style: WireStyle, n: number): Map<number, Drawn> {
  const out = new Map<number, Drawn>();
  if (style === 'curved') {
    for (const w of wires) out.set(w.id, drawCurved(w.a, w.b, w.pins ?? [], n));
    return out;
  }
  const routes = new Map<number, Pt[]>();
  const free: { net: string; v: Pt[] }[] = [];
  const held: { net: string; v: Pt[] }[] = [];
  // (How many wires run through each pin: a pin that holds more than one is a clip they share.)
  const through = new Map<string, number>();
  const key = (p: Pt) => `${r1(p.x)},${r1(p.y)}`;
  for (const w of wires) for (const p of w.pins ?? []) through.set(key(p), (through.get(key(p)) ?? 0) + 1);
  for (const w of wires) {
    if (w.pins?.length) {
      // Through its pins the plain way (level to each pin's upright, up or down through the pin) where no card is
      // in the way of that; else it finds its way from pin to pin as any wire does from port to port.
      const plainWay = throughPins(w.a, w.b, w.pins);
      const own = (inWay(plainWay, cards, w.from, w.to) === 0 ? plainWay : wayRound(w.a, w.b, cards, w.id, w.pins) ?? plainWay).map((p) => ({ x: p.x, y: p.y }));
      routes.set(w.id, own);
      if (w.pins.some((p) => (through.get(key(p)) ?? 0) > 1)) held.push({ net: `${w.from}:${r1(w.a.x)},${r1(w.a.y)}`, v: own });
      continue;
    }
    const tries = plain(w.a, w.b);
    // (The first way of a wire to a card close ahead turns in the gap between its own two cards, however narrow:
    // those two are not in its way.)
    const between = !ahead(w.a, w.b) && w.b.x - w.a.x >= NEAR;
    let v = tries.find((r, i) => inWay(r, between && i === 0 ? cards.filter((c) => c.id !== w.from && c.id !== w.to) : cards, w.from, w.to) === 0)
      ?? wayRound(w.a, w.b, cards, w.id);
    if (!v) {
      // No way at all: the plain way that passes behind the fewest cards (its own two among them).
      let least = Infinity;
      for (const r of tries) {
        const k = inWay(r, cards, w.from, w.to, -1);
        if (k < least) {
          least = k;
          v = r;
        }
      }
    }
    // (Its own copy of the corners: they are moved where they stand when wires are set side by side.)
    const own = (v ?? [w.a, w.b]).map((p) => ({ x: p.x, y: p.y }));
    routes.set(w.id, own);
    free.push({ net: `${w.from}:${r1(w.a.x)},${r1(w.a.y)}`, v: own });
  }
  sideBySide(free, cards);
  // Wires through pins are the player's, and are not moved aside for the wires that find their own way, nor for
  // each other. Except those that share a pin (a clip that holds several wires): they would lie on one line there,
  // and are set side by side as a bundle about it instead. A wire alone on its pins stays exactly where they put it.
  if (held.length > 1) sideBySide(held, cards);
  for (const w of wires) out.set(w.id, drawSquared(routes.get(w.id) ?? [w.a, w.b], n));
  // (Ways kept for wires that are gone are let go, now and then.)
  if (kept.size > wires.length * 2 + 32) {
    const here = new Set(wires.map((w) => w.id));
    for (const key of kept.keys()) if (!here.has(Math.floor(key / STRETCHES))) kept.delete(key);
  }
  return out;
}

/** One wire with no board round it: the one being drawn out of a port, a preview. */
export function drawWire(a: Pt, b: Pt, style: WireStyle, n: number): Drawn {
  if (style === 'curved') return drawCurved(a, b, [], n);
  return drawSquared(ahead(a, b) ? forward(a, b, 'mid') : around(a, b, Math.abs(a.y - b.y) >= ROUND * 1.6 ? (a.y + b.y) / 2 : Math.max(a.y, b.y) + ROUND), n);
}

/** The point a share `t` (0 to 1) of the way along a drawn line (its points as x, y, x, y...), by length. */
export function lineAt(pts: ArrayLike<number>, t: number): Pt {
  const n = pts.length / 2 - 1;
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]);
  let s = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < n; i++) {
    const dx = pts[i * 2 + 2] - pts[i * 2], dy = pts[i * 2 + 3] - pts[i * 2 + 1];
    const len = Math.hypot(dx, dy);
    if (s <= len || i === n - 1) {
      const u = len > 0 ? Math.min(1, s / len) : 0;
      return { x: pts[i * 2] + dx * u, y: pts[i * 2 + 1] + dy * u };
    }
    s -= len;
  }
  return { x: pts[0] ?? 0, y: pts[1] ?? 0 };
}

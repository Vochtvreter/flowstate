// How a wire runs from one port to another: the line that is drawn, and the same line as points. DOM-free.
//
// Cable management. A wire used to be one curve from port to port, and where it went was decided by where its two
// cards stood: ten wires into one Market lay on top of each other, and the only way to move a wire was to move a
// card. A wire now has a style, the board's choice, and may have pins, the player's:
//
//  - curved: the curve it always was. With pins, a run of such curves from pin to pin.
//  - squared: right angles with rounded corners, as on a circuit board. A wire leaves its port, runs level, turns
//    once and comes level into the port it ends at. Of the places it could turn (just before the card it ends at,
//    just after the card it leaves, half way) it takes the one that passes behind the fewest cards. Wires that turn
//    before the same card do so side by side, LANE_GAP apart, in an order in which they do not cross: a ribbon, not
//    a knot. A wire that ends behind its start goes out, round and back in.
//  - pins: points the player sets on a wire, up to MAX_PINS, kept with the save. A curved wire passes through each.
//    A squared wire turns at each: it runs level to the pin, turns there, runs up or down to the next. So one pin
//    slides a wire's upright run to where the pin is, and two take it round a card.
//
// What is returned is the SVG path and the line as n + 1 points, corners among them, which is what the dots travel
// along and what a click, the knife and the rate chips are measured against (fx.ts, board.ts). Nothing here reads
// the game: ends and cards are handed in. The rules of the game know nothing of any of it: a wire carries the same
// whatever way it runs.
import { MAX_PINS } from '../state';
import { Box, Pt, curve } from './geom';

export { MAX_PINS };

export type WireStyle = 'curved' | 'squared';
export const WIRE_STYLES: WireStyle[] = ['curved', 'squared'];

/** A squared wire runs this far straight out of a port, and into one, before it may turn. */
export const STUB = 20;
/** The radius of a squared wire's corners (less where the runs either side are short). */
export const CORNER = 10;
/** Squared wires that turn before the same card run this far apart. */
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

/** Where a squared wire with no pins turns: before the card it ends at (`lane` of them, counted from the card), after the card it leaves, or half way. */
export type Turn = 'end' | 'start' | 'mid';

/** The corners of a squared wire with no pins that ends ahead of its start, turning at `turn`. */
export function forward(a: Pt, b: Pt, turn: Turn, lane = 0): Pt[] {
  if (Math.abs(a.y - b.y) <= LEVEL) return [a, b];
  const lo = a.x + STUB, hi = b.x - STUB;
  const x = turn === 'end' ? hi - lane * LANE_GAP : turn === 'start' ? lo + lane * LANE_GAP : (a.x + b.x) / 2;
  const at = Math.max(lo, Math.min(hi, x));
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

/** How many of these cards a line of corners passes behind. */
export function behind(corners: Pt[], cards: Box[]): number {
  let count = 0;
  for (const c of cards) {
    for (let i = 0; i + 1 < corners.length; i++) {
      const p = corners[i], q = corners[i + 1];
      // (Runs are level or upright: a run is behind a card when its own box, a hair thick, lies over the card's inside.)
      if (Math.min(p.x, q.x) < c.x1 - 1 && Math.max(p.x, q.x) > c.x0 + 1 && Math.min(p.y, q.y) < c.y1 - 1 && Math.max(p.y, q.y) > c.y0 + 1) {
        count++;
        break;
      }
    }
  }
  return count;
}

// ---------- a whole board ----------

/** A wire to be drawn: its ends, the cards at them, and its pins if it has any. */
export interface WireIn { id: number; from: number; to: number; a: Pt; b: Pt; pins?: Pt[] }
/** A card that wires should not pass behind. */
export interface CardBox extends Box { id: number }

/** How far above or below both cards a squared wire that goes back on itself runs when the cards stand too near each other in height to pass between. */
const ROUND = 70;

/**
 * Every wire of a board as it is drawn in a style. Curved, each wire is its own business. Squared, the wires are
 * routed together: each takes the turn that passes behind the fewest cards (before the card it ends at, where that is
 * as good as any), and those that turn before the same card are set side by side in lanes, the wire that comes from
 * furthest above or below nearest the card, so that none crosses another on its way in.
 */
export function routeAll(wires: WireIn[], cards: CardBox[], style: WireStyle, n: number): Map<number, Drawn> {
  const out = new Map<number, Drawn>();
  if (style === 'curved') {
    for (const w of wires) out.set(w.id, drawCurved(w.a, w.b, w.pins ?? [], n));
    return out;
  }
  const others = (w: WireIn) => cards.filter((c) => c.id !== w.from && c.id !== w.to);
  /** Wires that turn before the card they end at, by that card: they share its lanes. */
  const lanes = new Map<number, WireIn[]>();
  const routes = new Map<number, Pt[]>();
  for (const w of wires) {
    if (w.pins?.length) {
      routes.set(w.id, throughPins(w.a, w.b, w.pins));
      continue;
    }
    if (!ahead(w.a, w.b)) {
      // Back on itself: between the two cards where there is room, else under them, or over them if that is clearer.
      const far = Math.abs(w.a.y - w.b.y) >= ROUND * 1.6;
      const tries = far ? [(w.a.y + w.b.y) / 2] : [Math.max(w.a.y, w.b.y) + ROUND, Math.min(w.a.y, w.b.y) - ROUND];
      const hide = others(w);
      let best = around(w.a, w.b, tries[0]);
      let least = behind(best, hide);
      for (const y of tries.slice(1)) {
        const r = around(w.a, w.b, y);
        const k = behind(r, hide);
        if (k < least) {
          best = r;
          least = k;
        }
      }
      routes.set(w.id, best);
      continue;
    }
    if (Math.abs(w.a.y - w.b.y) <= LEVEL) {
      routes.set(w.id, [w.a, w.b]);
      continue;
    }
    const hide = others(w);
    let turn: Turn = 'end';
    let least = behind(forward(w.a, w.b, 'end'), hide);
    for (const t of ['start', 'mid'] as Turn[]) {
      const k = behind(forward(w.a, w.b, t), hide);
      if (k < least) {
        turn = t;
        least = k;
      }
    }
    if (turn === 'end') {
      const list = lanes.get(w.to);
      if (list) list.push(w);
      else lanes.set(w.to, [w]);
    } else routes.set(w.id, forward(w.a, w.b, turn));
  }
  for (const list of lanes.values()) {
    // From above and from below are two ribbons that never meet: each is counted from the card on its own.
    for (const side of [-1, 1]) {
      const ribbon = list.filter((w) => Math.sign(w.a.y - w.b.y) === side).sort((p, q) => Math.abs(q.a.y - q.b.y) - Math.abs(p.a.y - p.b.y) || p.id - q.id);
      ribbon.forEach((w, lane) => routes.set(w.id, forward(w.a, w.b, 'end', lane)));
    }
  }
  for (const w of wires) out.set(w.id, drawSquared(routes.get(w.id) ?? [w.a, w.b], n));
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

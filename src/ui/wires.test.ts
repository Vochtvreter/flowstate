// How a wire runs (wires.ts): curved or squared, through pins, in lanes. These run without a browser.
import { describe, expect, it } from 'vitest';
import { Box, Pt, bezierAt, pathD } from './geom';
import { CORNER, CardBox, LANE_GAP, MAX_PINS, STUB, WireIn, ahead, around, behind, drawCurved, drawSquared, drawWire, forward, routeAll, spread, throughPins } from './wires';

const N = 28;
const pt = (x: number, y: number): Pt => ({ x, y });
/** Every run of a line of corners is level or upright. */
const square = (v: Pt[]) => v.slice(1).every((p, i) => Math.abs(p.x - v[i].x) < 0.01 || Math.abs(p.y - v[i].y) < 0.01);
/** Is the point on the line of corners (within a pixel)? */
const on = (v: Pt[], p: Pt) => v.slice(1).some((q, i) => {
  const a = v[i];
  return p.x >= Math.min(a.x, q.x) - 1 && p.x <= Math.max(a.x, q.x) + 1 && p.y >= Math.min(a.y, q.y) - 1 && p.y <= Math.max(a.y, q.y) + 1;
});
/** Do two lines of level and upright runs cross (a level run of one through an upright run of the other, not at their ends)? */
function crossings(v: Pt[], w: Pt[]): number {
  let n = 0;
  for (let i = 0; i + 1 < v.length; i++) {
    for (let j = 0; j + 1 < w.length; j++) {
      const [a, b, c, d] = [v[i], v[i + 1], w[j], w[j + 1]];
      const hv = (h0: Pt, h1: Pt, u0: Pt, u1: Pt) => Math.abs(h0.y - h1.y) < 0.01 && Math.abs(u0.x - u1.x) < 0.01
        && u0.x > Math.min(h0.x, h1.x) + 0.5 && u0.x < Math.max(h0.x, h1.x) - 0.5 && h0.y > Math.min(u0.y, u1.y) + 0.5 && h0.y < Math.max(u0.y, u1.y) - 0.5;
      if (hv(a, b, c, d) || hv(c, d, a, b)) n++;
    }
  }
  return n;
}

describe('a curved wire', () => {
  it('with no pins is the curve it always was, point for point', () => {
    const a = pt(272, 156), b = pt(618, 488);
    const w = drawCurved(a, b, [], N);
    expect(w.d).toBe(pathD(a, b));
    expect(w.pts.length).toBe(N + 1);
    for (let i = 0; i <= N; i++) {
      const p = bezierAt(a, b, i / N);
      expect(w.pts[i].x).toBeCloseTo(p.x, 6);
      expect(w.pts[i].y).toBeCloseTo(p.y, 6);
    }
  });

  it('with pins passes through each of them, in order, and still has as many points as it was asked for', () => {
    const a = pt(100, 100), b = pt(700, 400), pins = [pt(300, 60), pt(480, 420)];
    const w = drawCurved(a, b, pins, N);
    expect(w.pts.length).toBe(N + 1);
    expect(w.pts[0]).toEqual(a);
    expect(w.pts[N]).toEqual(b);
    const at = pins.map((p) => w.pts.findIndex((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6));
    expect(at[0]).toBeGreaterThan(0);
    expect(at[1]).toBeGreaterThan(at[0]);
    expect(w.d.match(/ C /g)!.length).toBe(3);
  });
});

describe('a squared wire', () => {
  it('between level ports is one straight line; otherwise it runs level, turns once and comes level in', () => {
    expect(forward(pt(100, 156), pt(400, 156.3), 'end')).toEqual([pt(100, 156), pt(400, 156.3)]);
    const v = forward(pt(100, 100), pt(500, 300), 'end');
    expect(v).toEqual([pt(100, 100), pt(480, 100), pt(480, 300), pt(500, 300)]);
    expect(square(v)).toBe(true);
    expect(forward(pt(100, 100), pt(500, 300), 'start')[1]).toEqual(pt(120, 100));
    expect(forward(pt(100, 100), pt(500, 300), 'mid')[1]).toEqual(pt(300, 100));
    // A lane further from the card is LANE_GAP further back, and never nearer its own port than the stub.
    expect(forward(pt(100, 100), pt(500, 300), 'end', 2)[1].x).toBe(480 - 2 * LANE_GAP);
    expect(forward(pt(100, 100), pt(160, 300), 'end', 5)[1].x).toBe(100 + STUB);
  });

  it('that ends behind its start goes out by the stub, across, and back in by the stub', () => {
    const a = pt(500, 100), b = pt(200, 300);
    expect(ahead(a, b)).toBe(false);
    const v = around(a, b, 200);
    expect(v).toEqual([a, pt(520, 100), pt(520, 200), pt(180, 200), pt(180, 300), b]);
    expect(square(v)).toBe(true);
  });

  it('is drawn with rounded corners, and its points turn the corners it turns', () => {
    const v = forward(pt(100, 100), pt(500, 300), 'mid');
    const w = drawSquared(v, N);
    expect(w.pts.length).toBe(N + 1);
    expect(w.pts[0]).toEqual(pt(100, 100));
    expect(w.pts[N]).toEqual(pt(500, 300));
    expect(w.d.match(/Q/g)!.length).toBe(2);
    expect(w.d.startsWith('M100 100 L290 100 Q300 100 300 110')).toBe(true);
    // No point of it is further from the line of corners than a corner's own rounding.
    for (const p of w.pts) expect(on(v, p) || Math.hypot(p.x - 300, Math.min(Math.abs(p.y - 100), Math.abs(p.y - 300))) <= CORNER).toBe(true);
    // Where each corner begins and ends is one of its points: the dots do not cut the corner.
    for (const c of [pt(290, 100), pt(300, 110), pt(300, 290), pt(310, 300)]) expect(w.pts.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 1e-6)).toBe(true);
    // A jog too short for the radius gets a smaller one, not a loop.
    const jog = drawSquared(forward(pt(100, 100), pt(400, 106), 'mid'), N);
    expect(jog.d).toContain('Q250 100 250 103');
  });

  it('spread: the line\'s own points are kept while there are enough to go round, and set evenly when there are not', () => {
    const line = [pt(0, 0), pt(100, 0), pt(100, 10), pt(300, 10)];
    const some = spread(line, 10);
    expect(some.length).toBe(11);
    for (const p of line) expect(some.some((q) => q.x === p.x && q.y === p.y)).toBe(true);
    const few = spread(line, 2);
    // (310 long in all: its middle is 45 along the last run.)
    expect(few).toEqual([pt(0, 0), pt(145, 10), pt(300, 10)]);
  });
});

describe('pins', () => {
  it('one pin on a squared wire is where its upright run stands; the wire still leaves and arrives level', () => {
    const a = pt(100, 100), b = pt(500, 300);
    const v = throughPins(a, b, [pt(220, 180)]);
    expect(v).toEqual([a, pt(220, 100), pt(220, 300), b]);
    expect(on(v, pt(220, 180))).toBe(true);
    expect(square(v)).toBe(true);
  });

  it('two pins take it round: level to the first, up or down, level to the second, and on to the port', () => {
    const a = pt(100, 100), b = pt(700, 120);
    const pins = [pt(240, 260), pt(560, 260)];
    const v = throughPins(a, b, pins);
    expect(v).toEqual([a, pt(240, 100), pt(240, 260), pt(560, 260), pt(560, 120), b]);
    for (const p of pins) expect(on(v, p)).toBe(true);
    expect(square(v)).toBe(true);
  });

  it('a pin behind the port the wire leaves, or ahead of the one it enters, is reached by way of the stub', () => {
    const a = pt(300, 100), b = pt(700, 300);
    const back = throughPins(a, b, [pt(200, 200)]);
    expect(back.slice(0, 3)).toEqual([a, pt(300 + STUB, 100), pt(300 + STUB, 200)]);
    expect(on(back, pt(200, 200))).toBe(true);
    const past = throughPins(a, b, [pt(760, 200)]);
    expect(past.slice(-3)).toEqual([pt(700 - STUB, 200), pt(700 - STUB, 300), b]);
    expect(square(back) && square(past)).toBe(true);
    expect(MAX_PINS).toBe(4);
  });
});

describe('a whole board, squared', () => {
  const card = (id: number, x: number, y: number, w = 172, h = 72): CardBox => ({ id, x0: x, y0: y, x1: x + w, y1: y + h });
  /** The corners of a drawn wire, read back from its path. */
  const cornersOf = (d: string): Pt[] => {
    const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const out: Pt[] = [];
    // M x y, then for each corner L x y Q cx cy x y, then L x y: the corner itself is the Q's control point.
    out.push(pt(nums[0], nums[1]));
    let i = 2;
    while (i + 5 < nums.length) {
      out.push(pt(nums[i + 2], nums[i + 3]));
      i += 6;
    }
    out.push(pt(nums[nums.length - 2], nums[nums.length - 1]));
    return out;
  };

  it('wires into one card turn side by side, the one from furthest away nearest the card, and none crosses another', () => {
    // Three sources above a Market and two below it, each in its own row.
    const market = card(9, 800, 300);
    const b = pt(800, 336);
    const wires: WireIn[] = [100, 180, 260, 420, 500].map((y, i) => ({ id: i + 1, from: i + 1, to: 9, a: pt(272, y), b }));
    const drawn = routeAll(wires, [market], 'squared', N);
    const turns = wires.map((w) => cornersOf(drawn.get(w.id)!.d)[1].x);
    // Above: 100 is furthest and turns nearest the card, then 180, then 260. Below: 500, then 420.
    expect(turns).toEqual([780, 780 - LANE_GAP, 780 - 2 * LANE_GAP, 780 - LANE_GAP, 780]);
    const lines = wires.map((w) => cornersOf(drawn.get(w.id)!.d));
    for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) expect(crossings(lines[i], lines[j]), `${i} and ${j}`).toBe(0);
    for (const w of wires) expect(drawn.get(w.id)!.pts.length).toBe(N + 1);
  });

  it('a wire turns where it passes behind the fewest cards: not through the card that stands in its own row', () => {
    // A Drill's port at 272,156 and a Market down to the right; a Refiner stands in the Drill's row.
    const refiner = card(2, 440, 120);
    const a = pt(272, 156), b = pt(900, 436);
    expect(behind(forward(a, b, 'end'), [refiner])).toBe(1);
    expect(behind(forward(a, b, 'start'), [refiner])).toBe(0);
    const drawn = routeAll([{ id: 1, from: 1, to: 9, a, b }], [card(1, 100, 120), refiner, card(9, 900, 400)], 'squared', N);
    expect(cornersOf(drawn.get(1)!.d)[1]).toEqual(pt(272 + STUB, 156));
    // With nothing in the way it turns before the card it ends at.
    const clear = routeAll([{ id: 1, from: 1, to: 9, a, b }], [card(1, 100, 120), card(9, 900, 400)], 'squared', N);
    expect(cornersOf(clear.get(1)!.d)[1]).toEqual(pt(900 - STUB, 156));
  });

  it('a wire that ends behind its start goes between the two cards where there is room, and under them where there is not', () => {
    const far = routeAll([{ id: 1, from: 1, to: 2, a: pt(700, 100), b: pt(300, 400) }], [], 'squared', N);
    expect(cornersOf(far.get(1)!.d)[2].y).toBe(250);
    const near = routeAll([{ id: 1, from: 1, to: 2, a: pt(700, 100), b: pt(300, 130) }], [], 'squared', N);
    expect(cornersOf(near.get(1)!.d)[2].y).toBe(200);
  });

  it('a pinned wire goes where its pins say, whatever the others do; curved, every wire is its own', () => {
    const b = pt(800, 336);
    const pinned: WireIn = { id: 1, from: 1, to: 9, a: pt(272, 100), b, pins: [pt(400, 200)] };
    const free: WireIn = { id: 2, from: 2, to: 9, a: pt(272, 180), b };
    const sq = routeAll([pinned, free], [], 'squared', N);
    expect(cornersOf(sq.get(1)!.d)[1]).toEqual(pt(400, 100));
    expect(cornersOf(sq.get(2)!.d)[1].x).toBe(780);
    const cv = routeAll([pinned, free], [], 'curved', N);
    expect(cv.get(2)!.d).toBe(pathD(free.a, free.b));
    expect(cv.get(1)!.d).toBe(drawCurved(pinned.a, b, pinned.pins!, N).d);
  });

  it('one wire with no board round it, for the wire being drawn out of a port', () => {
    expect(drawWire(pt(100, 100), pt(400, 300), 'curved', N).d).toBe(pathD(pt(100, 100), pt(400, 300)));
    const sq = drawWire(pt(100, 100), pt(400, 300), 'squared', N);
    expect(cornersOf(sq.d)[1]).toEqual(pt(250, 100));
    const back = drawWire(pt(400, 100), pt(100, 120), 'squared', N);
    expect(back.pts.length).toBe(N + 1);
    expect(back.pts[N]).toEqual(pt(100, 120));
  });

  it('behind: a run through a card\'s inside counts once a card, and a run along its edge does not', () => {
    const box: Box = { x0: 400, y0: 100, x1: 572, y1: 172 };
    expect(behind([pt(300, 140), pt(700, 140)], [box])).toBe(1);
    expect(behind([pt(300, 100), pt(700, 100)], [box])).toBe(0);
    expect(behind([pt(300, 140), pt(380, 140), pt(380, 300)], [box])).toBe(0);
    expect(behind([pt(300, 140), pt(700, 140), pt(700, 150), pt(300, 150)], [box, box])).toBe(2);
  });
});

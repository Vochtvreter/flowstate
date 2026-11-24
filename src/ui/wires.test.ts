// How a wire runs (wires.ts): curved or squared, through pins, round cards, side by side. These run without a browser.
import { describe, expect, it } from 'vitest';
import { Pt, bezierAt, pathD } from './geom';
import {
  CLEAR, CORNER, COUNT, CardBox, LANE_GAP, MAX_CLIPS, PASS_X, PASS_Y, STUB, WireIn, ahead, around, drawCurved, drawSquared, drawWire, forgetWays, forward, inWay, routeAll,
  spread, throughPins, wayRound,
} from './wires';

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
    expect(MAX_CLIPS).toBe(8);
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

  it('a wire takes the first of its plain turns that has no card in its way: not through the card that stands in its own row', () => {
    // A Drill's port at 272,156 and a Market down to the right; a Refiner stands in the Drill's row.
    const refiner = card(2, 440, 120);
    const a = pt(272, 156), b = pt(900, 436);
    expect(inWay(forward(a, b, 'end'), [refiner], 1, 9)).toBe(1);
    expect(inWay(forward(a, b, 'start'), [refiner], 1, 9)).toBe(0);
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

  it('in the way: a card behind a run, or nearer to it than CLEAR; not the cards at its own ends, along the runs out of and into them', () => {
    const box = card(5, 400, 100);
    expect(inWay([pt(300, 140), pt(700, 140)], [box], 1, 9)).toBe(1);
    // Along its edge, CLEAR away, is clear; a pixel nearer is not.
    expect(inWay([pt(300, 100 - CLEAR), pt(700, 100 - CLEAR)], [box], 1, 9)).toBe(0);
    expect(inWay([pt(300, 101 - CLEAR), pt(700, 101 - CLEAR)], [box], 1, 9)).toBe(1);
    expect(inWay([pt(300, 140), pt(380, 140), pt(380, 300)], [box], 1, 9)).toBe(0);
    // A card counts once, however many runs pass it.
    expect(inWay([pt(300, 140), pt(700, 140), pt(700, 150), pt(300, 150)], [box, card(6, 400, 100)], 1, 9)).toBe(2);
    // The run out of a port lies along the card it leaves, the run into one along the card it enters.
    const from = card(1, 100, 120), to = card(9, 900, 400);
    const v = forward(pt(272, 156), pt(900, 436), 'end');
    expect(inWay(v, [from, to], 1, 9)).toBe(0);
    expect(inWay(v, [from, to], 7, 8)).toBe(2);
  });
});

describe('a way round cards', () => {
  const card = (id: number, x: number, y: number, w = 172, h = 72): CardBox => ({ id, x0: x, y0: y, x1: x + w, y1: y + h });
  const cornersOf = (d: string): Pt[] => {
    const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const out: Pt[] = [pt(nums[0], nums[1])];
    for (let i = 2; i + 5 < nums.length; i += 6) out.push(pt(nums[i + 2], nums[i + 3]));
    out.push(pt(nums[nums.length - 2], nums[nums.length - 1]));
    return out;
  };
  /** Stretches where two wires lie on each other: runs of each on one line, beside each other for more than a pixel. */
  function shared(v: Pt[], w: Pt[]): number {
    let n = 0;
    for (let i = 0; i + 1 < v.length; i++) {
      for (let j = 0; j + 1 < w.length; j++) {
        const [a, b, c, d] = [v[i], v[i + 1], w[j], w[j + 1]];
        const upright = Math.abs(a.x - b.x) < 0.01, other = Math.abs(c.x - d.x) < 0.01;
        if (upright !== other) continue;
        const at = (p: Pt) => (upright ? p.x : p.y), along = (p: Pt) => (upright ? p.y : p.x);
        if (Math.abs(at(a) - at(c)) > 0.6) continue;
        if (Math.min(Math.max(along(a), along(b)), Math.max(along(c), along(d))) - Math.max(Math.min(along(a), along(b)), Math.min(along(c), along(d))) > 1) n++;
      }
    }
    return n;
  }

  it('a card in the row between two level ports: the wire goes round it, over or under, and comes in level', () => {
    const a = pt(272, 156), b = pt(900, 156);
    const cards = [card(1, 100, 120), card(2, 500, 120), card(9, 900, 120)];
    expect(inWay([a, b], cards, 1, 9)).toBe(1);
    const v = wayRound(a, b, cards)!;
    expect(square(v)).toBe(true);
    expect(inWay(v, cards, 1, 9)).toBe(0);
    // Level as far as it can go, PASS_X before the card up or down to PASS_Y clear of it, along there to the stub of
    // the port it ends at (it turns late), back to the port's height and in from the left.
    expect(v.length).toBe(6);
    expect(v[0]).toEqual(a);
    expect(v[1]).toEqual(pt(500 - PASS_X, 156));
    expect([120 - PASS_Y, 192 + PASS_Y]).toContain(v[2].y);
    expect(v[3]).toEqual(pt(900 - STUB, v[2].y));
    expect(v[4]).toEqual(pt(900 - STUB, 156));
    expect(v[5]).toEqual(b);
    // The board draws it so.
    const drawn = routeAll([{ id: 1, from: 1, to: 9, a, b }], cards, 'squared', N);
    expect(cornersOf(drawn.get(1)!.d)).toEqual(v);
    expect(drawn.get(1)!.pts.length).toBe(N + 1);
  });

  it('with a card in the way of every plain turn, the wire still passes behind none', () => {
    const a = pt(272, 156), b = pt(900, 436);
    // One card in the row it leaves along, one in the row it comes in along: before, after and half way are all shut.
    const cards = [card(1, 100, 120), card(2, 440, 120), card(3, 500, 400), card(9, 900, 400)];
    for (const turn of ['end', 'start', 'mid'] as const) expect(inWay(forward(a, b, turn), cards, 1, 9), turn).toBeGreaterThan(0);
    const v = cornersOf(routeAll([{ id: 1, from: 1, to: 9, a, b }], cards, 'squared', N).get(1)!.d);
    expect(square(v)).toBe(true);
    expect(inWay(v, cards, 1, 9)).toBe(0);
    expect(v[1].y).toBe(a.y);
    expect(v[1].x).toBeGreaterThan(a.x);
    expect(v[v.length - 2].y).toBe(b.y);
    expect(v[v.length - 2].x).toBeLessThan(b.x);
  });

  it('a wire that ends behind its start goes round its own two cards, not behind them', () => {
    // From a card on the right back to one on the left, a little lower: over or under both.
    const cards = [card(1, 700, 100), card(2, 300, 130), card(3, 480, 250, 172, 140)];
    const a = pt(872, 136), b = pt(300, 166);
    const v = cornersOf(routeAll([{ id: 1, from: 1, to: 2, a, b }], cards, 'squared', N).get(1)!.d);
    expect(square(v)).toBe(true);
    expect(inWay(v, cards, 1, 2)).toBe(0);
    expect(v[1]).toEqual(pt(872 + STUB, 136));
    expect(v[v.length - 2]).toEqual(pt(300 - STUB, 166));
  });

  it('two wires that pass the same side of a card run side by side there, LANE_GAP apart, and do not cross', () => {
    // Two rows, and a tall card across both that reaches far up: both wires have to go under it.
    const wall = card(5, 500, -400, 172, 690);
    const cards = [card(1, 100, 120), card(2, 100, 220), wall, card(8, 900, 120), card(9, 900, 220)];
    const wires: WireIn[] = [
      { id: 1, from: 1, to: 8, a: pt(272, 156), b: pt(900, 156) },
      { id: 2, from: 2, to: 9, a: pt(272, 256), b: pt(900, 256) },
    ];
    const drawn = routeAll(wires, cards, 'squared', N);
    const [v, w] = wires.map((x) => cornersOf(drawn.get(x.id)!.d));
    expect(inWay(v, cards, 1, 8)).toBe(0);
    expect(inWay(w, cards, 2, 9)).toBe(0);
    // Under the card: the wire from the nearer row on the outside, the other inside it, a lane apart all the way round.
    const under = (c: Pt[]) => Math.max(...c.map((p) => p.y));
    expect(under(v)).toBe(wall.y1 + PASS_Y);
    expect(under(w)).toBe(wall.y1 + PASS_Y + LANE_GAP);
    expect(v[1].x).toBe(wall.x0 - PASS_X);
    expect(w[1].x).toBe(wall.x0 - PASS_X - LANE_GAP);
    expect(shared(v, w)).toBe(0);
    expect(crossings(v, w)).toBe(0);
    // One at a time, each would have taken the same line.
    const alone = wires.map((x) => wayRound(x.a, x.b, cards)!);
    expect(shared(alone[0], alone[1])).toBeGreaterThan(0);
  });

  it('two wires out of one port share their way until they part: they are one cable there, not two', () => {
    const cards = [card(1, 100, 120), card(8, 900, 300), card(9, 900, 420)];
    const a = pt(272, 156);
    const wires: WireIn[] = [{ id: 1, from: 1, to: 8, a, b: pt(900, 336) }, { id: 2, from: 1, to: 9, a, b: pt(900, 456) }];
    const drawn = routeAll(wires, cards, 'squared', N);
    const [v, w] = wires.map((x) => cornersOf(drawn.get(x.id)!.d));
    expect(v[1]).toEqual(pt(900 - STUB, 156));
    expect(w[1]).toEqual(pt(900 - STUB, 156));
  });

  it('two cards almost touching: the wire turns in the gap between them', () => {
    // A Drill and a Lab 8 px to its right, 40 lower.
    const cards = [card(1, 1260, 840), card(2, 1440, 880)];
    const a = pt(1432, 876), b = pt(1440, 916);
    const v = cornersOf(routeAll([{ id: 1, from: 1, to: 2, a, b }], cards, 'squared', N).get(1)!.d);
    expect(v).toEqual([a, pt(1436, 876), pt(1436, 916), b]);
  });

  it('a port walled in has no way round: the wire is still drawn, behind as few cards as it can', () => {
    const cards = [card(1, 100, 120), card(2, 280, 20, 60, 400), card(9, 900, 300)];
    const a = pt(272, 156), b = pt(900, 336);
    expect(wayRound(a, b, cards)).toBe(null);
    const drawn = routeAll([{ id: 1, from: 1, to: 9, a, b }], cards, 'squared', N).get(1)!;
    expect(drawn.pts.length).toBe(N + 1);
    expect(drawn.pts[N]).toEqual(b);
    expect(inWay(cornersOf(drawn.d), cards, 1, 9)).toBe(1);
  });

  it('a way is kept while nothing near it moves, and looked for again when something does', () => {
    const a = pt(272, 156), b = pt(900, 156);
    const far = card(7, 3000, 2000);
    const cards = [card(1, 100, 120), card(2, 500, 120), card(9, 900, 120), far];
    const first = wayRound(a, b, cards, 77)!;
    const before = { ...COUNT };
    expect(wayRound(a, b, cards, 77)).toEqual(first);
    expect(COUNT.searches).toBe(before.searches);
    expect(COUNT.kept).toBe(before.kept + 1);
    // A card far off moves: the way stands. What is given back is the caller's own to change.
    first[2].y = -999;
    far.x0 += 40;
    far.x1 += 40;
    const again = wayRound(a, b, cards, 77)!;
    expect(COUNT.searches).toBe(before.searches);
    expect(again[2].y).not.toBe(-999);
    // The card in the way moves down a little: looked for again, and the way is another.
    cards[1] = card(2, 500, 150);
    const moved = wayRound(a, b, cards, 77)!;
    expect(COUNT.searches).toBeGreaterThan(before.searches);
    expect(inWay(moved, cards, 1, 9)).toBe(0);
    expect(moved).not.toEqual(again);
  });

  it('a pinned wire with a card in the way of its plain shape goes round the card, and still through every pin in turn', () => {
    const a = pt(272, 156), b = pt(1200, 436);
    const pins = [pt(700, 60), pt(1000, 300)];
    const clear = [card(1, 100, 120), card(9, 1200, 400)];
    // Nothing in the way: the plain shape, level to each pin's upright and up or down through the pin.
    const plain = cornersOf(routeAll([{ id: 1, from: 1, to: 9, a, b, pins }], clear, 'squared', N).get(1)!.d);
    expect(plain).toEqual(throughPins(a, b, pins));
    // A card in the row it leaves along, and one where it comes down from the first pin to the second.
    const cards = [...clear, card(2, 440, 120), card(3, 800, 150)];
    expect(inWay(throughPins(a, b, pins), cards, 1, 9)).toBeGreaterThan(0);
    const v = cornersOf(routeAll([{ id: 1, from: 1, to: 9, a, b, pins }], cards, 'squared', N).get(1)!.d);
    expect(square(v)).toBe(true);
    expect(inWay(v, cards, 1, 9)).toBe(0);
    for (const p of pins) expect(on(v, p)).toBe(true);
    // In turn: the first pin is met before the second, along the wire.
    const along = (p: Pt) => {
      let s = 0;
      for (let i = 0; i + 1 < v.length; i++) {
        if (on([v[i], v[i + 1]], p)) return s + Math.abs(p.x - v[i].x) + Math.abs(p.y - v[i].y);
        s += Math.abs(v[i + 1].x - v[i].x) + Math.abs(v[i + 1].y - v[i].y);
      }
      return -1;
    };
    expect(along(pins[0])).toBeGreaterThan(0);
    expect(along(pins[1])).toBeGreaterThan(along(pins[0]));
    // It never doubles back on itself: no run goes the opposite way to the one before it.
    for (let i = 0; i + 2 < v.length; i++) {
      const d1 = pt(v[i + 1].x - v[i].x, v[i + 1].y - v[i].y), d2 = pt(v[i + 2].x - v[i + 1].x, v[i + 2].y - v[i + 1].y);
      expect(d1.x * d2.x + d1.y * d2.y).toBeGreaterThanOrEqual(0);
    }
    // A pin set on top of a card has no clear way to it: the wire keeps its plain shape, through the pin.
    const buried = [pt(520, 150)];
    const kept = cornersOf(routeAll([{ id: 1, from: 1, to: 9, a, b, pins: buried }], cards, 'squared', N).get(1)!.d);
    expect(kept).toEqual(throughPins(a, b, buried));
  });

  it('wires that share pins (one clip that holds them) run through them side by side as a bundle; a wire alone on its pins stays on them', () => {
    const cards = [card(1, 100, 100), card(2, 100, 300), card(3, 100, 500), card(8, 900, 300), card(9, 900, 500)];
    const pins = [pt(500, 60), pt(700, 200)];
    const wires: WireIn[] = [
      { id: 1, from: 1, to: 8, a: pt(272, 136), b: pt(900, 336), pins },
      { id: 2, from: 2, to: 8, a: pt(272, 336), b: pt(900, 346), pins },
      { id: 3, from: 3, to: 9, a: pt(272, 536), b: pt(900, 536), pins },
      // On the same upright as the others, but through a pin of its own: it is not one of the bundle.
      { id: 4, from: 3, to: 8, a: pt(272, 546), b: pt(900, 356), pins: [pt(500, 450)] },
    ];
    const drawn = routeAll(wires, cards, 'squared', N);
    const v = wires.map((w) => cornersOf(drawn.get(w.id)!.d));
    for (const line of v) expect(square(line)).toBe(true);
    // The three that share the pins: where they run up the first pin's upright they stand LANE_GAP apart, about the pin.
    const upright = (line: Pt[], near: number) => line.find((p, i) => i + 1 < line.length && Math.abs(p.x - line[i + 1].x) < 0.01 && Math.abs(p.x - near) <= 2 * LANE_GAP)!.x;
    const first = [0, 1, 2].map((i) => upright(v[i], 500)).sort((p, q) => p - q);
    expect(first[1] - first[0]).toBeCloseTo(LANE_GAP, 5);
    expect(first[2] - first[1]).toBeCloseTo(LANE_GAP, 5);
    expect(first[1]).toBeCloseTo(500, 5);
    // ...and so along the level run between the two pins, about its height.
    const level = [0, 1, 2].map((i) => v[i].find((p, k) => k + 1 < v[i].length && Math.abs(p.y - v[i][k + 1].y) < 0.01 && Math.abs(p.y - 60) <= 2 * LANE_GAP)!.y).sort((p, q) => p - q);
    expect(level[2] - level[0]).toBeCloseTo(2 * LANE_GAP, 5);
    expect((level[0] + level[2]) / 2).toBeCloseTo(60, 5);
    // None of them doubles back on itself.
    for (const line of v) {
      for (let i = 0; i + 2 < line.length; i++) {
        const d1 = pt(line[i + 1].x - line[i].x, line[i + 1].y - line[i].y), d2 = pt(line[i + 2].x - line[i + 1].x, line[i + 2].y - line[i + 1].y);
        expect(d1.x * d2.x + d1.y * d2.y).toBeGreaterThanOrEqual(0);
      }
    }
    // The wire with a pin of its own runs exactly through it, bundle or no bundle beside it.
    expect(on(v[3], pt(500, 450))).toBe(true);
    expect(v[3]).toEqual(throughPins(wires[3].a, wires[3].b, wires[3].pins!));
    // Alone, a wire through the shared pins runs exactly through them too.
    const alone = cornersOf(routeAll([wires[0]], cards, 'squared', N).get(1)!.d);
    for (const p of pins) expect(on(alone, p)).toBe(true);
  });

  it('on boards with room between the cards, no wire passes behind a card or nearer to one than CLEAR, whatever goes where', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = seed * 7919;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const cards: CardBox[] = [];
      for (let c = 0; c < 5; c++) {
        for (let r = 0; r < 5; r++) {
          if (rnd() < 0.25) continue;
          cards.push(card(cards.length + 1, 100 + c * 280 + Math.round(rnd() * 3) * 20, 100 + r * 160 + Math.round(rnd() * 3) * 20, 172, rnd() < 0.3 ? 92 : 72));
        }
      }
      const wires: WireIn[] = [];
      for (let i = 0; i < 30; i++) {
        const from = cards[Math.floor(rnd() * cards.length)], to = cards[Math.floor(rnd() * cards.length)];
        if (from === to) continue;
        const w: WireIn = { id: i + 1, from: from.id, to: to.id, a: pt(from.x1, from.y0 + (rnd() < 0.5 ? 36 : 31)), b: pt(to.x0, to.y0 + (rnd() < 0.5 ? 36 : 61)) };
        // One wire in five has a pin or two, anywhere that is not on top of a card.
        if (rnd() < 0.2) {
          const pins: Pt[] = [];
          for (let k = 0; k < 1 + Math.floor(rnd() * 2); k++) {
            const p = pt(Math.round(rnd() * 150) * 10, Math.round(rnd() * 90) * 10);
            if (!cards.some((c) => p.x > c.x0 - 10 && p.x < c.x1 + 10 && p.y > c.y0 - 10 && p.y < c.y1 + 10)) pins.push(p);
          }
          if (pins.length) w.pins = pins;
        }
        wires.push(w);
      }
      const drawn = routeAll(wires, cards, 'squared', N);
      for (const w of wires) {
        const line = drawn.get(w.id)!;
        const v = cornersOf(line.d);
        const say = `seed ${seed}, wire ${w.id}: ${line.d}`;
        expect(line.pts.length, say).toBe(N + 1);
        expect(square(v), say).toBe(true);
        expect(v[0], say).toEqual(w.a);
        expect(v[v.length - 1], say).toEqual(w.b);
        // (Set side by side, a run stands on the half pixel: a hair inside CLEAR is still clear.)
        expect(inWay(v, cards, w.from, w.to, CLEAR - 0.6), say).toBe(0);
        for (const p of w.pins ?? []) expect(on(v, p), say).toBe(true);
        // Out of its port to the right, and into the other from the left.
        expect(v[1].x, say).toBeGreaterThan(w.a.x);
        expect(v[v.length - 2].x, say).toBeLessThan(w.b.x);
      }
    }
  });
});

// A board is routed again at every step of a drag and every frame of a glide, and what was worked out for a wire is
// kept while nothing it has to do with has moved (wires.ts, "what has moved since a wire was last looked at"). That
// must never show: whatever the board went through to get where it is, it is drawn as a page that has just loaded
// it draws it. (It did show once: after a glide some wires rested on a line found for the board a fraction of a
// pixel before it came to rest, and moved when the page was loaded again.)
describe('what is kept from one look at the board to the next never changes how it is drawn', () => {
  interface Wired { id: number; from: number; to: number; ay: number; by: number; pins?: Pt[] }
  /** The board at one look: its wires and cards, and the cards that are in the hand (or gliding to where they were let go) just then. */
  interface Shot { wires: WireIn[]; cards: CardBox[]; carried: number[] }
  const card = (id: number, x: number, y: number, w = 172, h = 72): CardBox => ({ id, x0: x, y0: y, x1: x + w, y1: y + h });

  /** A board that things happen to, and how it stood after each of them. */
  function story(seed: number): Shot[] {
    let s = seed * 104729;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pick = <T>(v: T[]) => v[Math.floor(rnd() * v.length)];
    const cards: CardBox[] = [];
    let nextCard = 1, nextWire = 1;
    const addCard = () => {
      const x = 60 + Math.round(rnd() * 60) * 20, y = 60 + Math.round(rnd() * 40) * 20;
      cards.push(card(nextCard++, x, y, 172, rnd() < 0.3 ? 92 : 72));
    };
    for (let i = 0; i < 16; i++) addCard();
    let wired: Wired[] = [];
    const addWire = () => {
      const from = pick(cards), to = pick(cards);
      if (from === to) return;
      wired.push({ id: nextWire++, from: from.id, to: to.id, ay: rnd() < 0.5 ? 36 : 31, by: rnd() < 0.5 ? 36 : 61 });
    };
    for (let i = 0; i < 28; i++) addWire();
    // From the start two wires run through one pin (a clip that holds both), and a third through one of its own.
    const clip = pt(Math.round(rnd() * 120) * 10, Math.round(rnd() * 80) * 10);
    wired[0].pins = [{ ...clip }];
    wired[1].pins = [{ ...clip }];
    wired[2].pins = [pt(Math.round(rnd() * 120) * 10, Math.round(rnd() * 80) * 10)];
    const shots: Shot[] = [];
    const move = (c: CardBox, dx: number, dy: number) => {
      c.x0 += dx;
      c.x1 += dx;
      c.y0 += dy;
      c.y1 += dy;
    };
    let inHand: number[] = [];
    const shoot = () => {
      const at = new Map(cards.map((c) => [c.id, c]));
      shots.push({
        carried: inHand.filter((id) => at.has(id)),
        cards: cards.map((c) => ({ ...c })),
        wires: wired.filter((w) => at.has(w.from) && at.has(w.to)).map((w) => {
          const f = at.get(w.from)!, t = at.get(w.to)!;
          return { id: w.id, from: w.from, to: w.to, a: pt(f.x1, f.y0 + w.ay), b: pt(t.x0, t.y0 + w.by), ...(w.pins ? { pins: w.pins.map((q) => ({ ...q })) } : {}) };
        }),
      });
    };
    /** Cards glide home from where they were let go, a frame at a time (board.ts, stepSettle), and come to rest. */
    const glide = (from: Map<CardBox, Pt>, frames: number, held = false) => {
      let was = new Map<CardBox, Pt>([...from.keys()].map((c) => [c, pt(0, 0)]));
      for (let f = 1; f <= frames; f++) {
        // (A card that was let go counts as carried until the frame it lands on: board.ts, stepSettle.)
        inHand = held && f < frames ? [...from.keys()].map((c) => c.id) : [];
        const u = f / frames, e = 1 - (1 - u) * (1 - u) * (1 - u);
        const now = new Map<CardBox, Pt>();
        for (const [c, off] of from) {
          const o = f === frames ? pt(0, 0) : pt(off.x * (1 - e), off.y * (1 - e));
          move(c, o.x - was.get(c)!.x, o.y - was.get(c)!.y);
          now.set(c, o);
        }
        was = now;
        shoot();
      }
    };
    shoot();
    for (let step = 0; step < 14; step++) {
      const what = rnd();
      if (what < 0.3) {
        // A card is carried a few grid steps one way, then another: alone, or as one of a block of two or three.
        const c = pick(cards);
        const block = [c, ...(rnd() < 0.3 ? cards.filter((o) => o !== c && rnd() < 0.15).slice(0, 2) : [])];
        inHand = block.map((o) => o.id);
        // (Picked up, before it has moved at all.)
        shoot();
        for (let leg = 0; leg < 2; leg++) {
          const [dx, dy] = pick([[20, 0], [-20, 0], [0, 20], [0, -20]]);
          for (let k = 0; k < 5; k++) {
            for (const o of block) move(o, dx, dy);
            shoot();
          }
        }
        inHand = [];
      } else if (what < 0.5) {
        // Let go off the grid: it glides the rest of the way.
        const c = pick(cards);
        const off = pt(Math.round((rnd() - 0.5) * 36), Math.round((rnd() - 0.5) * 36));
        const x = c.x0, y = c.y0;
        glide(new Map([[c, off]]), 7, true);
        expect(c.x0).toBeCloseTo(x, 9);
        expect(c.y0).toBeCloseTo(y, 9);
        // (To rest means to rest: on whole pixels, where it was let go to.)
        move(c, x - c.x0, y - c.y0);
        shoot();
      } else if (what < 0.62) {
        // Tidy: many cards glide to new places at once.
        const from = new Map<CardBox, Pt>();
        const home = new Map<CardBox, Pt>();
        for (const c of cards) {
          if (rnd() < 0.5) continue;
          const d = pt(Math.round((rnd() - 0.5) * 20) * 20, Math.round((rnd() - 0.5) * 12) * 20);
          move(c, d.x, d.y);
          home.set(c, pt(c.x0, c.y0));
          from.set(c, pt(-d.x, -d.y));
        }
        glide(from, 9);
        for (const [c, h] of home) move(c, h.x - c.x0, h.y - c.y0);
        shoot();
      } else if (what < 0.7) addCard();
      else if (what < 0.78 && cards.length > 6) cards.splice(Math.floor(rnd() * cards.length), 1);
      else if (what < 0.86) addWire();
      else if (what < 0.9 && wired.length > 8) wired = wired.filter((w) => w !== pick(wired));
      else if (what < 0.98) {
        // A pin is set on a wire, or the one it has is moved; or the wire is run through a pin another already has
        // (a clip that holds several: they are set side by side about it).
        const w = pick(wired);
        const held = wired.filter((o) => o !== w && o.pins?.length);
        w.pins = held.length && rnd() < 0.5 ? pick(held).pins!.map((q) => ({ ...q })) : [pt(Math.round(rnd() * 150) * 10, Math.round(rnd() * 90) * 10)];
      }
      // (...and sometimes nothing at all happens between two looks.)
      shoot();
    }
    return shots;
  }

  const route = (shot: Shot) => (shot.carried.length ? routeAll(shot.wires, shot.cards, 'squared', N, { carried: new Set(shot.carried) }) : routeAll(shot.wires, shot.cards, 'squared', N));
  const lines = (shot: Shot) => [...route(shot)].map(([id, line]) => ({ id, d: line.d, pts: line.pts.map((q) => [q.x, q.y]) }));
  const cornersOf = (d: string): Pt[] => {
    const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const out: Pt[] = [pt(nums[0], nums[1])];
    for (let i = 2; i + 5 < nums.length; i += 6) out.push(pt(nums[i + 2], nums[i + 3]));
    out.push(pt(nums[nums.length - 2], nums[nums.length - 1]));
    return out;
  };

  it('at every step of a board\'s story it is drawn as a board that was only just loaded: cards carried, let go, tidied, built and taken away', () => {
    let kept = 0, fresh = 0, steps = 0, shared = 0, inHand = 0, atRest = 0;
    for (let seed = 1; seed <= 14; seed++) {
      const shots = story(seed);
      for (const shot of shots) {
        if (shot.carried.length) inHand++;
        else atRest++;
      }
      // (How often two wires ran through one pin: the stories must have that in them.)
      for (const shot of shots) {
        const at = new Set<string>();
        for (const w of shot.wires) for (const q of w.pins ?? []) {
          if (at.has(`${q.x},${q.y}`)) shared++;
          at.add(`${q.x},${q.y}`);
        }
      }
      forgetWays();
      const s0 = COUNT.searches;
      const going = shots.map((shot) => lines(shot));
      kept += COUNT.searches - s0;
      const s1 = COUNT.searches;
      shots.forEach((shot, i) => {
        forgetWays();
        expect(going[i], `seed ${seed}, step ${i}`).toEqual(lines(shot));
      });
      fresh += COUNT.searches - s1;
      steps += shots.length;
    }
    expect(steps).toBeGreaterThan(600);
    expect(shared).toBeGreaterThan(50);
    // (With a card in the hand the board is drawn by another rule, and that too is the same from nothing as from
    // what was kept; at rest, which every story comes back to, it is the board a page would load.)
    expect(inHand).toBeGreaterThan(300);
    expect(atRest).toBeGreaterThan(300);
    // (And it is worth keeping: far fewer ways are looked for than when every look starts from nothing.)
    expect(fresh).toBeGreaterThan(2000);
    expect(kept).toBeLessThan(fresh * 0.8);
  });

  it('a way taken only because every card was in reach is looked for again when a card is built further off', () => {
    // A tall card stands between two level ports. The way over it is long, and is taken at the first, short reach
    // only because that reach takes in every card on the board. Then a card is built beyond everything that way had
    // to do with: a page that had just loaded would now look further, and find a line that card lends it.
    const cards = [card(1, -172, 264), card(9, 400, 264), card(2, 150, 100, 100, 600)];
    const wires: WireIn[] = [{ id: 1, from: 1, to: 9, a: pt(0, 300), b: pt(400, 300) }];
    forgetWays();
    const before = routeAll(wires, cards, 'squared', N).get(1)!.d;
    cards.push(card(7, 610, 104));
    const kept = routeAll(wires, cards, 'squared', N).get(1)!.d;
    forgetWays();
    const fresh = routeAll(wires, cards, 'squared', N).get(1)!.d;
    expect(fresh).not.toBe(before);
    expect(kept).toBe(fresh);
    // ...and when it is taken away again, the first way is back.
    cards.pop();
    expect(routeAll(wires, cards, 'squared', N).get(1)!.d).toBe(before);
  });

  it('a line that was drawn is given again while its wire has not changed, and anew when it has', () => {
    forgetWays();
    const cards = [card(1, 100, 120), card(2, 500, 120), card(9, 900, 120), card(7, 3000, 2000)];
    const wires: WireIn[] = [{ id: 1, from: 1, to: 9, a: pt(272, 156), b: pt(900, 156) }, { id: 2, from: 2, to: 9, a: pt(672, 151), b: pt(900, 181) }];
    const first = routeAll(wires, cards, 'squared', N);
    const before = { ...COUNT };
    const again = routeAll(wires, cards, 'squared', N);
    expect(again.get(1)).toBe(first.get(1));
    expect(again.get(2)).toBe(first.get(2));
    expect(COUNT.searches).toBe(before.searches);
    // A card far from both moves: nothing is looked for, nothing is drawn again.
    cards[3] = card(7, 3040, 2000);
    const far = routeAll(wires, cards, 'squared', N);
    expect(far.get(1)).toBe(first.get(1));
    expect(COUNT.searches).toBe(before.searches);
    // The card in the first wire's way moves: that wire is looked for again.
    cards[1] = card(2, 500, 150);
    wires[1] = { ...wires[1], a: pt(672, 181) };
    const moved = routeAll(wires, cards, 'squared', N);
    expect(COUNT.searches).toBeGreaterThan(before.searches);
    expect(moved.get(1)!.d).not.toBe(first.get(1)!.d);
    forgetWays();
    expect([...routeAll(wires, cards, 'squared', N)].map(([, x]) => x.d)).toEqual([...moved].map(([, x]) => x.d));
  });

  // A card in the hand (routeAll's `carried`) lends the other wires no line to turn at: they are routed as if it were
  // not on the board, until it comes into the way one of them has found. Carrying a card across a late board was forty
  // searches a step, nearly all of them for wires it was nowhere near.
  describe('a card that is carried', () => {
    // A wall between two level ports: the wire goes over it. And a card with no wires, to carry about.
    const board = () => [card(1, -172, 264), card(9, 400, 264), card(2, 150, 220, 100, 180)];
    const wires: WireIn[] = [{ id: 1, from: 1, to: 9, a: pt(0, 300), b: pt(400, 300) }];
    const d = (cards: CardBox[], carried?: number[]) => routeAll(wires, cards, 'squared', N, carried ? { carried: new Set(carried) } : {}).get(1)!.d;
    /** Where the loose card lends the wire a better line to cross the wall on (4 px lower than the wall's own). */
    const lending = () => card(5, 480, 124);

    it('lends no line while it is in the hand, and does when it is put down', () => {
      forgetWays();
      const without = d(board());
      const down = d([...board(), lending()]);
      expect(down).not.toBe(without);
      expect(d([...board(), lending()], [5])).toBe(without);
      // Carried about near the wire, never in its way: the wire is not looked for once, and does not move.
      const before = COUNT.searches;
      for (const [x, y] of [[480, 104], [460, 84], [440, 64], [300, 20], [120, 20], [-60, 40], [480, 124]]) expect(d([...board(), card(5, x, y)], [5]), `at ${x}, ${y}`).toBe(without);
      expect(COUNT.searches).toBe(before);
      // Put down where it lends its line: looked for again, and it is the board a page would load.
      expect(d([...board(), lending()])).toBe(down);
      expect(COUNT.searches).toBeGreaterThan(before);
      // Picked up again from there, without moving: the wire goes back to its own way.
      expect(d([...board(), lending()], [5])).toBe(without);
    });

    it('is stepped round by a wire it comes into the way of, for as long as it is', () => {
      forgetWays();
      const without = d(board());
      // On the run the wire crosses the wall on.
      const inWayOf = card(5, 100, 150);
      expect(inWay(cornersOf(without), [inWayOf], 1, 9)).toBe(1);
      const aside = d([...board(), inWayOf], [5]);
      expect(aside).not.toBe(without);
      expect(inWay(cornersOf(aside), [...board(), inWayOf], 1, 9, CLEAR - 0.6)).toBe(0);
      // ...which is the way it would take with the card standing there (the card is in its way: it counts as any card).
      forgetWays();
      expect(d([...board(), inWayOf])).toBe(aside);
      // Carried on, out of the way: the wire is back where it was at once.
      expect(d([...board(), card(5, 100, 20)], [5])).toBe(without);
    });

    it('with nothing carried the board is routed as it always was, said or not', () => {
      for (let seed = 1; seed <= 6; seed++) {
        for (const shot of story(seed).filter((x) => !x.carried.length).filter((_, i) => i % 5 === 0)) {
          forgetWays();
          const plain = [...routeAll(shot.wires, shot.cards, 'squared', N)].map(([id, x]) => `${id} ${x.d}`);
          forgetWays();
          expect([...routeAll(shot.wires, shot.cards, 'squared', N, { carried: new Set() })].map(([id, x]) => `${id} ${x.d}`)).toEqual(plain);
          // (...and a card named as carried that is not on the board is nobody.)
          forgetWays();
          expect([...routeAll(shot.wires, shot.cards, 'squared', N, { carried: new Set([-7]) })].map(([id, x]) => `${id} ${x.d}`)).toEqual(plain);
        }
      }
    });

    it('never brings a wire nearer to a card than it would be with that card standing there', () => {
      // At every look of the stories with a card in the hand: no wire that is not the carried card's own comes within
      // CLEAR of a card that it keeps clear of when the same board is routed with nothing carried. (The stories'
      // boards are crowded, with cards on one another: there a wire may have no clear way under either rule.)
      let looked = 0, worse = 0;
      for (let seed = 1; seed <= 14; seed++) {
        for (const shot of story(seed)) {
          if (!shot.carried.length) continue;
          const hand = new Set(shot.carried);
          forgetWays();
          const held = route(shot);
          forgetWays();
          const down = routeAll(shot.wires, shot.cards, 'squared', N);
          for (const w of shot.wires) {
            if (hand.has(w.from) || hand.has(w.to)) continue;
            looked++;
            // (Its own two cards aside: where it stands against those is a matter of the lane it was given.)
            const others = shot.cards.filter((c) => c.id !== w.from && c.id !== w.to);
            const near = (line: string) => others.filter((c) => inWay(cornersOf(line), [c], w.from, w.to, CLEAR - 0.6) > 0).map((c) => c.id);
            const was = new Set(near(down.get(w.id)!.d));
            if (near(held.get(w.id)!.d).some((id) => !was.has(id))) worse++;
          }
        }
      }
      expect(looked).toBeGreaterThan(5000);
      expect(worse).toBe(0);
    });
  });
});

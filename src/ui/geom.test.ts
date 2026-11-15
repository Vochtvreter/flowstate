import { describe, expect, it } from 'vitest';
import { Box, CARD_GAP, Card, PLOT_MARGIN, cardsOverlap, fadeColor, fitBox, frameBox, freeSpot, pinchView, separate, spotFree } from './geom';

const free = (k: number) => k;
const phone = (k: number) => Math.max(0.74, Math.min(1.5, k));
/** The board point under a screen point. */
const under = (v: { x: number; y: number; k: number }, p: { x: number; y: number }) => ({ x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k });

describe('pinchView', () => {
  const v0 = { x: -54, y: 131, k: 0.74 };
  const m0 = { x: 180, y: 300 };

  it('does nothing while the fingers have not moved (no jump when the second finger lands)', () => {
    const v = pinchView(v0, m0, 80, m0, 80, phone);
    expect(v.k).toBe(v0.k);
    expect(v.x).toBeCloseTo(v0.x, 9);
    expect(v.y).toBeCloseTo(v0.y, 9);
  });

  it('pans when two fingers move together', () => {
    const v = pinchView(v0, m0, 80, { x: 220, y: 268 }, 80, phone);
    expect(v.k).toBe(v0.k);
    expect(v.x - v0.x).toBeCloseTo(40, 9);
    expect(v.y - v0.y).toBeCloseTo(-32, 9);
  });

  it('zooms by the ratio of the spread, about the midpoint', () => {
    const v = pinchView(v0, m0, 80, m0, 120, phone);
    expect(v.k).toBeCloseTo(0.74 * 1.5, 9);
    const a = under(v0, m0), b = under(v, m0);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  });

  it('zooms and pans at once: the board point under the fingers follows them', () => {
    const m1 = { x: 150, y: 340 };
    const v = pinchView(v0, m0, 80, m1, 100, free);
    const a = under(v0, m0), b = under(v, m1);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  });

  it('stops at the zoom limits and stays anchored there', () => {
    const wide = pinchView(v0, m0, 80, m0, 800, phone);
    expect(wide.k).toBe(1.5);
    const tight = pinchView({ ...v0, k: 1 }, m0, 200, m0, 20, phone);
    expect(tight.k).toBe(0.74);
    for (const v of [wide, tight]) {
      const from = v === wide ? v0 : { ...v0, k: 1 };
      expect(under(v, m0).x).toBeCloseTo(under(from, m0).x, 9);
      expect(under(v, m0).y).toBeCloseTo(under(from, m0).y, 9);
    }
  });
});

// ---------- where a card may stand ----------

const GRID = 20;
const BOARD = { w: 1240, h: 760 };
const card = (x: number, y: number, w = 172, h = 72): Box => ({ x0: x, y0: y, x1: x + w, y1: y + h });
/** A small deterministic generator, so the random boards below are the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const spot = (x: number, y: number, avoid: Box[], dir?: { x: number; y: number }, w = 172, h = 72) =>
  freeSpot({ x, y, w, h, avoid, board: BOARD, grid: GRID, dir });

describe('freeSpot: the placement rule', () => {
  it('leaves a card where it is wanted when that spot is free, on the grid', () => {
    expect(spot(400, 300, [])).toEqual({ x: 400, y: 300 });
    expect(spot(407, 293, [card(100, 100)])).toEqual({ x: 400, y: 300 });
  });

  it('keeps cards inside the plot, a margin from its edge', () => {
    const p = spot(-500, 5000, [])!;
    expect(p.x).toBeGreaterThanOrEqual(PLOT_MARGIN);
    expect(p.y + 72).toBeLessThanOrEqual(BOARD.h - PLOT_MARGIN);
    const q = spot(5000, -500, [])!;
    expect(q.x + 172).toBeLessThanOrEqual(BOARD.w - PLOT_MARGIN);
    expect(q.y).toBeGreaterThanOrEqual(PLOT_MARGIN);
  });

  it('never rests a card on another, and keeps 16 px clear of it', () => {
    const other = card(400, 300);
    for (const [x, y] of [[400, 300], [420, 320], [300, 260], [560, 360], [400, 240], [380, 372]]) {
      const p = spot(x, y, [other])!;
      expect(spotFree(p.x, p.y, 172, 72, [other])).toBe(true);
      // Either beside it or above or below it, with the gap.
      const dx = Math.max(other.x0 - (p.x + 172), p.x - other.x1), dy = Math.max(other.y0 - (p.y + 72), p.y - other.y1);
      expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(CARD_GAP);
    }
  });

  it('takes the nearest free spot when the card is simply dropped (no wire)', () => {
    const other = card(400, 300);
    // Dropped a little below the middle of another card: the nearest clear place is just under it.
    const p = spot(400, 320, [other])!;
    expect(p.x).toBe(400);
    expect(p.y).toBeGreaterThanOrEqual(other.y1 + CARD_GAP);
    expect(p.y).toBeLessThan(other.y1 + CARD_GAP + GRID);
    // Dropped a little above it: just over it.
    const q = spot(400, 280, [other])!;
    expect(q.x).toBe(400);
    expect(q.y + 72).toBeLessThanOrEqual(other.y0 - CARD_GAP);
    expect(q.y + 72).toBeGreaterThan(other.y0 - CARD_GAP - GRID);
  });

  it('on a wire, goes further along the wire before it goes to a row above or below', () => {
    // The wire runs to the right. The wanted spot overlaps a card by a sliver at its right end: moving on
    // along the wire is a short step, and wins over the row above or below.
    const other = card(400, 300);
    const p = spot(540, 300, [other], { x: 1, y: 0 })!;
    expect(p.y).toBe(300);
    expect(p.x).toBeGreaterThanOrEqual(other.x1 + CARD_GAP);
    expect(p.x).toBeLessThan(other.x1 + CARD_GAP + GRID);
  });

  it('on a wire, takes the row above or below rather than going back toward the wire\'s start', () => {
    // The wanted spot sits on the left half of a card. Without a wire the nearest clear spot is to the
    // left (back the way the wire came); with the wire, the card goes to the row above or below instead.
    const other = card(400, 300);
    const plain = spot(360, 300, [other])!;
    const wired = spot(360, 300, [other], { x: 1, y: 0 })!;
    expect(spotFree(wired.x, wired.y, 172, 72, [other])).toBe(true);
    expect(wired.x).toBeGreaterThanOrEqual(360);
    expect(wired.y).not.toBe(300);
    expect(Math.abs(wired.y - 300)).toBeLessThanOrEqual(72 + CARD_GAP + GRID);
    expect(plain.y === 300 ? plain.x < 360 : true).toBe(true);
  });

  it('with a wall of cards ahead on every row, still never goes back past the wall when a row is free', () => {
    // A column of three cards; the wire comes from the left and is dropped on the middle one's row.
    const wall = [card(600, 200), card(600, 300), card(600, 400)];
    const p = spot(600, 300, wall, { x: 1, y: 0 })!;
    expect(spotFree(p.x, p.y, 172, 72, wall)).toBe(true);
    // Further along (to the right of the wall) or a row above or below it: not to its left.
    expect(p.x).toBeGreaterThanOrEqual(600);
  });

  it('follows a wire that runs downward, too', () => {
    const other = card(400, 300);
    const p = spot(400, 340, [other], { x: 0, y: 1 })!;
    expect(p.x).toBe(400);
    expect(p.y).toBeGreaterThanOrEqual(other.y1 + CARD_GAP);
  });

  it('keeps clear of free deposits as it does of cards', () => {
    const deposit = card(100, 260);
    const p = spot(120, 270, [deposit])!;
    expect(spotFree(p.x, p.y, 172, 72, [deposit])).toBe(true);
  });

  it('keeps the tallest the card may become clear (the height asked for is the room it needs)', () => {
    const below = card(400, 400);
    // A 72 px card would fit at y = 300; one that may grow to 112 px must stand higher.
    expect(spot(400, 300, [below], undefined, 172, 72)).toEqual({ x: 400, y: 300 });
    const p = spot(400, 300, [below], undefined, 172, 112)!;
    expect(spotFree(p.x, p.y, 172, 112, [below])).toBe(true);
  });

  it('says so when the plot has no room left', () => {
    const full: Box[] = [{ x0: 0, y0: 0, x1: BOARD.w, y1: BOARD.h }];
    expect(spot(400, 300, full)).toBeNull();
    expect(freeSpot({ x: 0, y: 0, w: 172, h: 72, avoid: [], board: { w: 150, h: 60 }, grid: GRID })).toBeNull();
  });

  it('on 300 random boards, with and without a wire, the result is always clear, on the grid and inside the plot', () => {
    const r = rng(7);
    for (let n = 0; n < 300; n++) {
      const avoid: Box[] = [];
      const count = 3 + Math.floor(r() * 25);
      for (let i = 0; i < count; i++) avoid.push(card(Math.round(r() * 1100), Math.round(r() * 680), r() < 0.2 ? 136 : 172, [60, 72, 92, 112][Math.floor(r() * 4)]));
      const w = r() < 0.2 ? 136 : 172, h = [60, 72, 92, 112][Math.floor(r() * 4)];
      const dir = r() < 0.5 ? { x: r() * 2 - 1, y: r() * 2 - 1 } : undefined;
      const p = freeSpot({ x: r() * 1300 - 30, y: r() * 800 - 20, w, h, avoid, board: BOARD, grid: GRID, dir });
      if (!p) continue;
      expect(spotFree(p.x, p.y, w, h, avoid)).toBe(true);
      expect(p.x % GRID).toBe(0);
      expect(p.y % GRID).toBe(0);
      expect(p.x).toBeGreaterThanOrEqual(PLOT_MARGIN);
      expect(p.y).toBeGreaterThanOrEqual(PLOT_MARGIN);
      expect(p.x + w).toBeLessThanOrEqual(BOARD.w - PLOT_MARGIN);
      expect(p.y + h).toBeLessThanOrEqual(BOARD.h - PLOT_MARGIN);
    }
  });

  it('is the same every time', () => {
    const avoid = [card(400, 300), card(600, 300), card(400, 400)];
    expect(spot(410, 310, avoid, { x: 1, y: 0.2 })).toEqual(spot(410, 310, avoid, { x: 1, y: 0.2 }));
  });
});

describe('separate: cards that rest on one another are pulled apart', () => {
  const c = (id: number, x: number, y: number, fixed = false, w = 172, h = 72): Card => ({ id, x, y, w, h, room: h, fixed });
  const apply = (cards: Card[], moved: Map<number, { x: number; y: number }>) => cards.map((k) => ({ ...k, ...(moved.get(k.id) ?? {}) }));
  const anyOverlap = (cards: Card[]) => cards.some((a, i) => cards.some((b, j) => j > i && cardsOverlap(a, b)));

  it('leaves a board with no overlap exactly as it is', () => {
    const cards = [c(1, 100, 100, true), c(2, 400, 100), c(3, 400, 200), c(4, 700, 100)];
    expect(separate(cards, [], BOARD, GRID).size).toBe(0);
  });

  it('moves the later of two stacked cards, and never a Well', () => {
    const cards = [c(1, 100, 100, true), c(2, 120, 120), c(3, 400, 300), c(4, 420, 320)];
    const moved = separate(cards, [], BOARD, GRID);
    expect([...moved.keys()].sort()).toEqual([2, 4]);
    expect(anyOverlap(apply(cards, moved))).toBe(false);
  });

  it('untangles a staircase of cards stacked by a script, on random boards', () => {
    const r = rng(11);
    for (let n = 0; n < 60; n++) {
      const cards: Card[] = [];
      for (let i = 0; i < 4; i++) cards.push(c(i + 1, 100, 100 + i * 140, true));
      const count = 6 + Math.floor(r() * 20);
      for (let i = 0; i < count; i++) cards.push(c(10 + i, 300 + Math.round(r() * 12) * 40, 80 + Math.round(r() * 14) * 30, false, r() < 0.2 ? 136 : 172, [60, 72, 92][Math.floor(r() * 3)]));
      const out = apply(cards, separate(cards, [], BOARD, GRID));
      expect(anyOverlap(out)).toBe(false);
      for (const k of out.filter((x) => x.fixed)) expect(cards.find((x) => x.id === k.id)).toMatchObject({ x: k.x, y: k.y });
    }
  });
});

// ---------- camera ----------

describe('fitBox and frameBox', () => {
  const area: Box = { x0: 20, y0: 100, x1: 370, y1: 600 };
  const on = (v: { x: number; y: number; k: number }, b: Box) => ({ x0: b.x0 * v.k + v.x, y0: b.y0 * v.k + v.y, x1: b.x1 * v.k + v.x, y1: b.y1 * v.k + v.y });
  const inside = (b: Box, a: Box) => b.x0 >= a.x0 - 0.01 && b.y0 >= a.y0 - 0.01 && b.x1 <= a.x1 + 0.01 && b.y1 <= a.y1 + 0.01;

  it('fits a small factory at 100%, centred', () => {
    const v = fitBox({ x0: 100, y0: 100, x1: 400, y1: 300 }, area, 0.74);
    expect(v.k).toBe(1);
    expect(inside(on(v, { x0: 100, y0: 100, x1: 400, y1: 300 }), area)).toBe(true);
  });

  it('pulls back within the readable tier while the factory still fits there', () => {
    const box = { x0: 0, y0: 0, x1: 440, y1: 300 };
    const v = fitBox(box, area, 0.74);
    expect(v.k).toBeCloseTo(350 / 440, 6);
    expect(v.k).toBeGreaterThanOrEqual(0.74);
    expect(inside(on(v, box), area)).toBe(true);
  });

  it('goes to the overview when the factory does not fit at the floor, and shows all of it', () => {
    const box = { x0: 0, y0: 0, x1: 1000, y1: 700 };
    const v = fitBox(box, area, 0.74);
    expect(v.k).toBeLessThan(0.74);
    expect(v.k).toBeGreaterThanOrEqual(0.25);
    expect(inside(on(v, box), area)).toBe(true);
  });

  it('never goes further out than the minimum, and then centres the factory', () => {
    const box = { x0: 0, y0: 0, x1: 4000, y1: 700 };
    const v = fitBox(box, area, 0.74);
    expect(v.k).toBe(0.25);
    expect((on(v, box).x0 + on(v, box).x1) / 2).toBeCloseTo((area.x0 + area.x1) / 2, 6);
  });

  it('frameBox moves nothing when the box is already in view', () => {
    const v = { x: 0, y: 0, k: 1 };
    expect(frameBox(v, { x0: 50, y0: 150, x1: 300, y1: 400 }, area, 0.74)).toBe(v);
  });

  it('frameBox pans just enough at the same zoom', () => {
    const v = { x: 0, y: 0, k: 1 };
    const box = { x0: 300, y0: 150, x1: 472, y1: 222 };
    const out = frameBox(v, box, area, 0.74);
    expect(out.k).toBe(1);
    expect(out.y).toBe(0);
    expect(on(out, box).x1).toBeCloseTo(area.x1, 6);
  });

  it('frameBox pulls back, but only within the readable tier', () => {
    const v = { x: 0, y: 0, k: 1 };
    const fits = { x0: 0, y0: 100, x1: 420, y1: 400 };
    const a = frameBox(v, fits, area, 0.74);
    expect(a.k).toBeCloseTo(350 / 420, 6);
    expect(inside(on(a, fits), area)).toBe(true);
    const wide = { x0: 0, y0: 100, x1: 900, y1: 400 };
    const b = frameBox(v, wide, area, 0.74);
    expect(b.k).toBe(0.74);
    // Too wide even there: its left end is in view.
    expect(on(b, wide).x0).toBeCloseTo(area.x0, 6);
  });

  it('frameBox leaves the zoom alone in the overview', () => {
    const v = { x: 0, y: 0, k: 0.4 };
    const out = frameBox(v, { x0: 900, y0: 300, x1: 1072, y1: 372 }, area, 0.74);
    expect(out.k).toBe(0.4);
    expect(inside(on(out, { x0: 900, y0: 300, x1: 1072, y1: 372 }), area)).toBe(true);
  });
});

describe('fadeColor', () => {
  it('mixes a colour toward the board background', () => {
    expect(fadeColor('#ffffff', 1)).toBe('#ffffff');
    expect(fadeColor('#ffffff', 0)).toBe('#0b0f17');
    expect(fadeColor('#ffc857', 0.35)).toBe('#60502d');
    expect(fadeColor('#fff', 0.5)).toBe(fadeColor('#ffffff', 0.5));
  });
});

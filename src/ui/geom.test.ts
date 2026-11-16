import { describe, expect, it } from 'vitest';
import {
  BUILD_AIR, BUILD_REACH, Box, CARD_GAP, Card, Footprint, MORE_REACH, PLOT_MARGIN, PORT_OUT, SiteQuery, WIRE_REACH, bestWindow, boxClear, buildSite, cardsOverlap,
  clearPoint, dockSpot, fadeColor, fitBox, fitsAt, frameBox, freeSpot, heldRate, pinchView, samples, separate, siteFor, spotFree, wholeGain,
} from './geom';

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

  it('keeps a wider gap when asked (a card built where the player chose keeps 40 px of air)', () => {
    const other = card(400, 300);
    // 28 px under the other card: free with the usual 16 px, taken with 40.
    expect(freeSpot({ x: 400, y: 400, w: 172, h: 72, avoid: [other], board: BOARD, grid: GRID })).toEqual({ x: 400, y: 400 });
    const p = freeSpot({ x: 400, y: 400, w: 172, h: 72, avoid: [other], board: BOARD, grid: GRID, gap: 40 })!;
    expect(spotFree(p.x, p.y, 172, 72, [other], 40)).toBe(true);
    // The nearest such spot: straight down to the first grid line 40 px clear.
    expect(p).toEqual({ x: 400, y: 420 });
  });

  it('with a wide gap, on random boards, the result is always that clear, on the grid and in the plot', () => {
    const r = rng(11);
    for (let n = 0; n < 200; n++) {
      const avoid: Box[] = [];
      const count = 3 + Math.floor(r() * 18);
      for (let i = 0; i < count; i++) avoid.push(card(Math.round(r() * 1100), Math.round(r() * 680)));
      const p = freeSpot({ x: r() * 1200, y: r() * 700, w: 172, h: 72, avoid, board: BOARD, grid: GRID, gap: 40 });
      if (!p) continue;
      expect(spotFree(p.x, p.y, 172, 72, avoid, 40)).toBe(true);
      expect(p.x % GRID).toBe(0);
      expect(p.y % GRID).toBe(0);
      expect(p.x).toBeGreaterThanOrEqual(PLOT_MARGIN);
      expect(p.y + 72).toBeLessThanOrEqual(BOARD.h - PLOT_MARGIN);
    }
  });
});

describe('buildSite: where a card built at a point the player chose stands', () => {
  const LAB: Footprint = { w: 172, h: 72, room: 72 }, REFINER: Footprint = { w: 172, h: 72, room: 92 }, ASSEMBLER: Footprint = { w: 172, h: 72, room: 112 }, VOID: Footprint = { w: 136, h: 60, room: 60 };
  const site = (x: number, y: number, cards: Box[], more: Partial<SiteQuery> = {}) =>
    buildSite({ at: { x, y }, card: LAB, cards, deposits: [], board: BOARD, grid: GRID, ...more });
  /** The middle of a card standing on a spot. */
  const mid = (p: { x: number; y: number }, f: Footprint = LAB) => ({ x: p.x + f.w / 2, y: p.y + f.h / 2 });
  /** A card on spot `p` keeps `gap` from every other card (and the ports' reach across). */
  const keeps = (p: { x: number; y: number }, f: Footprint, cards: Box[], gap: number) =>
    cards.every((b) => !(p.x < b.x1 + gap + 2 * PORT_OUT && p.x + f.w + gap + 2 * PORT_OUT > b.x0 && p.y < b.y1 + gap && p.y + f.room + gap > b.y0));
  const far = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot((p.x - q.x) * 0.9, p.y - q.y);
  const randomBoard = (r: () => number, most = 25) => {
    const cards: Box[] = [];
    const count = 2 + Math.floor(r() * most);
    for (let i = 0; i < count; i++) cards.push(card(20 + Math.round(r() * 52) * 20, 20 + Math.round(r() * 32) * 20, r() < 0.2 ? 136 : 172, [60, 72, 92, 112][Math.floor(r() * 4)]));
    return cards;
  };

  it('centres the card on the point, on the grid, when it has air there', () => {
    expect(site(486, 336, [])).toEqual({ x: 400, y: 300 });
    expect(site(493, 329, [card(100, 100)])).toEqual({ x: 400, y: 300 });
  });

  it('steps aside for air when a spot with air is within reach, and stands by the point with the usual gap when none is', () => {
    const other = card(400, 300);
    // 28 px under the other card: the usual gap is kept there, the air is not; a row lower it is.
    expect(site(486, 436, [other])).toEqual({ x: 400, y: 420 });
    // Between a Well and the plot's left edge with a wall of cards round it, the only air is far off: the card stays by the point.
    const wall = [card(240, 20, 172, 720)];
    const p = site(120, 300, wall)!;
    expect(far(p, { x: 34, y: 264 })).toBeLessThan(30);
    expect(keeps(p, LAB, wall, CARD_GAP)).toBe(true);
    expect(keeps(p, LAB, wall, BUILD_AIR)).toBe(false);
  });

  it('accepts a point it gave as it stands: asked again on the middle of its answer, the answer is the same', () => {
    const r = rng(23);
    let moved = 0, tight = 0;
    for (let n = 0; n < 400; n++) {
      const cards = randomBoard(r);
      const f = [LAB, REFINER, ASSEMBLER, VOID][Math.floor(r() * 4)];
      // A camera somewhere over the board, with something over its top and a corner, on half of the boards.
      const vx = r() * 700, vy = r() * 300;
      const view = r() < 0.5 ? { x0: vx, y0: vy, x1: vx + 400 + r() * 900, y1: vy + 350 + r() * 500 } : null;
      const covers = view ? [{ x0: view.x0 + 100, y0: -1e6, x1: view.x0 + 420, y1: view.y0 + 130 }, { x0: view.x1 - 150, y0: view.y1 - 120, x1: 1e6, y1: 1e6 }] : [];
      const wire = r() < 0.6 ? { from: { x: 100 + r() * 900, y: 60 + r() * 600 } } : r() < 0.5 ? { to: { x: 100 + r() * 900, y: 60 + r() * 600 } } : undefined;
      const q = { card: f, cards, deposits: [card(880, 600)], board: BOARD, grid: GRID, view, covers, wire };
      const at = { x: r() * 1400 - 80, y: r() * 900 - 70 };
      const p = buildSite({ ...q, at });
      if (!p) continue;
      if (far(mid(p, f), at) > 15) moved++;
      if (!keeps(p, f, cards, BUILD_AIR)) tight++;
      expect(buildSite({ ...q, at: mid(p, f) })).toEqual(p);
    }
    // (The boards are crowded enough to matter: many answers are not the point itself, and some have no air.)
    expect(moved).toBeGreaterThan(100);
    expect(tight).toBeGreaterThan(10);
  });

  it('on random boards the card is always inside the plot, on the grid, and keeps the usual gap', () => {
    const r = rng(5);
    for (let n = 0; n < 300; n++) {
      const cards = randomBoard(r);
      const f = [LAB, REFINER, ASSEMBLER, VOID][Math.floor(r() * 4)];
      const p = buildSite({ at: { x: r() * 1400 - 80, y: r() * 900 - 70 }, card: f, cards, deposits: [], board: BOARD, grid: GRID });
      if (!p) continue;
      expect(keeps(p, f, cards, CARD_GAP)).toBe(true);
      expect(p.x % GRID).toBe(0);
      expect(p.y % GRID).toBe(0);
      expect(p.x).toBeGreaterThanOrEqual(PLOT_MARGIN);
      expect(p.y).toBeGreaterThanOrEqual(PLOT_MARGIN);
      expect(p.x + f.w).toBeLessThanOrEqual(BOARD.w - PLOT_MARGIN);
      expect(p.y + f.room).toBeLessThanOrEqual(BOARD.h - PLOT_MARGIN);
    }
  });

  it('is never further from the point than the rule it replaced (air if within reach of the nearest spot with the usual gap)', () => {
    const r = rng(41);
    const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d - 2 * PORT_OUT, y0: b.y0 - d, x1: b.x1 + d + 2 * PORT_OUT, y1: b.y1 + d });
    let differ = 0;
    for (let n = 0; n < 300; n++) {
      const cards = randomBoard(r);
      const at = { x: 40 + r() * 1160, y: 40 + r() * 680 };
      // (Both rules measure from the wanted spot on the grid.)
      const want = { x: Math.round((at.x - 86) / GRID) * GRID, y: Math.round((at.y - 36) / GRID) * GRID };
      const old = (gap: number) => freeSpot({ ...want, w: 172, h: 72, avoid: cards.map((b) => grow(b, gap - 8)), board: BOARD, grid: GRID, gap: 8 });
      const a = old(BUILD_AIR), u = old(CARD_GAP);
      const before = a && u && far(a, want) <= far(u, want) + BUILD_REACH ? a : u ?? a;
      const now = site(at.x, at.y, cards);
      if (!before || !now) {
        expect(now).toEqual(before);
        continue;
      }
      if (now.x !== before.x || now.y !== before.y) differ++;
      expect(far(now, want)).toBeLessThanOrEqual(far(before, want) + 1e-6);
    }
    expect(differ).toBeLessThan(60);
  });

  it('takes a point outside the plot as the nearest point inside it', () => {
    expect(clearPoint({ x: 500, y: 900 }, BOARD)).toEqual({ x: 500, y: 760 });
    expect(clearPoint({ x: -40, y: -10 }, BOARD)).toEqual({ x: 0, y: 0 });
    // Below the plot's edge, on open ground: the card stands at the edge under the point, not somewhere else.
    expect(site(500, 900, [])).toEqual({ x: 420, y: 660 });
    // With the edge taken under the point, the nearest room along it.
    const p = site(500, 900, [card(400, 640), card(600, 640)])!;
    expect(far(mid(p), { x: 500, y: 760 })).toBeLessThan(230);
  });

  it('takes a point under something that covers the stage as the nearest point clear of it', () => {
    const view = { x0: 0, y0: 0, x1: 900, y1: 700 };
    const strip = { x0: 200, y0: -1e6, x1: 700, y1: 150 };
    expect(clearPoint({ x: 400, y: 100 }, BOARD, view, [strip])).toEqual({ x: 400, y: 150 });
    expect(clearPoint({ x: 210, y: 20 }, BOARD, view, [strip])).toEqual({ x: 200, y: 20 });
    // Off the stage: the nearest point on it.
    expect(clearPoint({ x: 1000, y: 300 }, BOARD, view, [])).toEqual({ x: 900, y: 300 });
    // The card is then built clear of the cover (with room for its pill), as near as that allows.
    const p = site(400, 100, [], { view, covers: [strip] })!;
    expect(p.y).toBeGreaterThanOrEqual(150 + 22);
    expect(p.y).toBeLessThan(200);
    expect(p.x).toBe(320);
  });

  it('does not build a card half off the stage while there is room beside it, and does when there is none', () => {
    const view = { x0: 100, y0: 0, x1: 700, y1: 700 };
    // 30 px from the stage's right side: the whole card is brought on to the stage.
    const p = site(670, 300, [], { view, covers: [] })!;
    expect(p.x + 172 + 10).toBeLessThanOrEqual(700);
    expect(far(mid(p), { x: 670, y: 300 })).toBeLessThan(110);
    // A wall of cards fills the stage's right half: the nearest room is off the stage, and that is where it goes.
    const wall = [card(340, 20, 172, 720), card(528, 20, 172, 720)];
    const q = site(660, 300, wall, { view, covers: [] })!;
    expect(q.x).toBeGreaterThanOrEqual(700);
  });

  it('does not put the card on the far side of another card from its port when the near side has room within reach', () => {
    // A Well's port at (272, 296); a Market stands to the right of where the player let go, the spot itself is tight.
    const cards = [card(100, 260), card(360, 300)];
    const from = { x: 272, y: 296 };
    const p = site(446, 256, cards, { wire: { from } })!;
    const end = { x: p.x, y: p.y + 36 };
    const crossed = samples(from, end, 24).some((s) => cards.some((b) => s.x > b.x0 + 2 && s.x < b.x1 - 2 && s.y > b.y0 + 2 && s.y < b.y1 - 2));
    expect(crossed).toBe(false);
    expect(p.x).toBeLessThan(532);
    // Without the wire the plain nearest spot is as good as any.
    expect(site(446, 256, cards)).not.toBeNull();
  });

  it('puts another card of the menu on the same middle, and says whether it has room there', () => {
    expect(siteFor({ x: 400, y: 300 }, LAB, LAB, GRID)).toEqual({ x: 400, y: 300 });
    expect(siteFor({ x: 400, y: 300 }, LAB, VOID, GRID)).toEqual({ x: 420, y: 300 });
    expect(siteFor({ x: 400, y: 300 }, LAB, ASSEMBLER, GRID)).toEqual({ x: 400, y: 300 });
    const q = { cards: [card(400, 400)], deposits: [], board: BOARD };
    // 28 px above another card: a Lab keeps the usual gap; an Assembler, which may grow to 112 px, does not.
    expect(fitsAt({ x: 400, y: 300 }, LAB, q)).toBe(true);
    expect(fitsAt({ x: 400, y: 300 }, ASSEMBLER, q)).toBe(false);
    expect(fitsAt({ x: 420, y: 300 }, VOID, q)).toBe(true);
    // Outside the plot's margin there is no room.
    expect(fitsAt({ x: 0, y: 300 }, LAB, q)).toBe(false);
    expect(fitsAt({ x: 400, y: 700 }, LAB, q)).toBe(false);
  });

  it('counts a clear wire for a little and the near side of a card for a reach, and only when the card has to move', () => {
    const from = { x: 272, y: 156 };
    // The card can stand on the point: it does, though its wire will pass behind the Market.
    const market = card(360, 300);
    expect(site(626, 476, [card(100, 120), market], { wire: { from } })).toEqual({ x: 540, y: 440 });
    // It cannot (8 px under the Market): of the spots about as near, the one on the near side of the Market, with its wire clear.
    const p = site(626, 416, [card(100, 120), market], { wire: { from } })!;
    const end = { x: p.x, y: p.y + 36 };
    expect(samples(from, end, 24).some((s) => s.x > 362 && s.x < 530 && s.y > 302 && s.y < 370)).toBe(false);
    expect(far(p, { x: 540, y: 380 })).toBeLessThanOrEqual(BUILD_REACH + 60);
    expect(WIRE_REACH).toBeLessThan(BUILD_REACH);
  });

  it('is never more than a reach and two steps further from the point than the nearest free spot, whatever the wire and the camera', () => {
    const r = rng(91);
    for (let n = 0; n < 300; n++) {
      const cards = randomBoard(r, 30);
      const vx = r() * 700, vy = r() * 300;
      const view = { x0: vx, y0: vy, x1: vx + 400 + r() * 900, y1: vy + 350 + r() * 500 };
      const at = { x: view.x0 + r() * (view.x1 - view.x0), y: view.y0 + r() * (view.y1 - view.y0) };
      if (at.x < 0 || at.y < 0 || at.x > BOARD.w || at.y > BOARD.h) continue;
      const q = { at, card: LAB, cards, deposits: [], board: BOARD, grid: GRID };
      const plain = freeSpot({ x: at.x - 86, y: at.y - 36, w: 172, h: 72, avoid: cards.map((b) => ({ x0: b.x0 - 8 - 2 * PORT_OUT, y0: b.y0 - 8, x1: b.x1 + 8 + 2 * PORT_OUT, y1: b.y1 + 8 })), board: BOARD, grid: GRID, gap: 8 });
      const p = buildSite({ ...q, view, covers: [], wire: { from: { x: 100 + r() * 900, y: 60 + r() * 600 } } });
      if (!plain || !p) {
        expect(!!p).toBe(!!plain);
        continue;
      }
      const want = { x: Math.round((at.x - 86) / GRID) * GRID, y: Math.round((at.y - 36) / GRID) * GRID };
      expect(far(p, want)).toBeLessThanOrEqual(far(plain, want) + BUILD_REACH + 2 * MORE_REACH + 1e-6);
    }
  });

  it('answers null only when the plot has no room at all', () => {
    expect(buildSite({ at: { x: 0, y: 0 }, card: LAB, cards: [], deposits: [], board: { w: 150, h: 60 }, grid: GRID })).toBeNull();
    expect(site(600, 300, [card(0, 0, 1240, 760)])).toBeNull();
    // Under a cover that hides the whole plot there is still room: the card goes under it.
    expect(site(600, 300, [], { view: { x0: 0, y0: 0, x1: 1240, y1: 760 }, covers: [{ x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 }] })).toEqual({ x: 520, y: 260 });
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

describe('dockSpot: where the Expand button rests when its own place cannot be seen', () => {
  // A 1364 x 844 stage (1440 x 900 window): the goal card over the middle of the top edge, the key hints
  // bottom left, the zoom buttons and the minimap bottom right.
  const area: Box = { x0: 10, y0: 10, x1: 1354, y1: 834 };
  const strip: Box = { x0: 300, y0: -1e6, x1: 1065, y1: 186 };
  const hints: Box = { x0: 16, y0: 810, x1: 396, y1: 828 };
  const corner: Box = { x0: 1152, y0: 668, x1: 1e6, y1: 1e6 };
  const blocks = [strip, hints, corner];
  const at = (p: { x: number; y: number }, w: number, h: number): Box => ({ x0: p.x, y0: p.y, x1: p.x + w, y1: p.y + h });
  const dist = (p: { x: number; y: number }, w: number, h: number, home: { x: number; y: number }) => Math.hypot(p.x + w / 2 - home.x, p.y + h / 2 - home.y);

  it('a place under the stage: it rests on the bottom edge, straight above where the place is', () => {
    const p = dockSpot({ home: { x: 700, y: 1100 }, w: 150, h: 36, area, blocks, gap: 10 });
    expect(p).toEqual({ x: 625, y: 798 });
    expect(boxClear(at(p, 150, 36), area, blocks, 10)).toBe(true);
  });

  it('follows the place along the edge, and steps out from under the hints and the corner controls', () => {
    // Above the key hints the nearest free place is beside them, not on top of them.
    const left = dockSpot({ home: { x: 120, y: 1100 }, w: 150, h: 36, area, blocks, gap: 10 });
    expect(boxClear(at(left, 150, 36), area, blocks, 10)).toBe(true);
    expect(left.y + 36).toBeLessThanOrEqual(hints.y0 - 10 + 0.01);
    // Under the corner controls it stands just left of them, on the bottom edge.
    const right = dockSpot({ home: { x: 1300, y: 1100 }, w: 150, h: 36, area, blocks, gap: 10 });
    expect(right).toEqual({ x: corner.x0 - 10 - 150, y: 798 });
  });

  it('a place hidden by the goal card: just under the card', () => {
    const p = dockSpot({ home: { x: 700, y: 120 }, w: 150, h: 36, area, blocks, gap: 10 });
    expect(p).toEqual({ x: 625, y: 196 });
  });

  it('a place off to one side: on that side, level with it', () => {
    expect(dockSpot({ home: { x: 2000, y: 400 }, w: 150, h: 36, area, blocks, gap: 10 })).toEqual({ x: 1204, y: 382 });
    expect(dockSpot({ home: { x: -900, y: 400 }, w: 150, h: 36, area, blocks, gap: 10 })).toEqual({ x: 10, y: 382 });
  });

  it('is always inside the area, clear of every block, and no further from the place than any other free spot', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let n = 0; n < 300; n++) {
      const W = 300 + Math.floor(rnd() * 1100), H = 200 + Math.floor(rnd() * 700);
      const a: Box = { x0: 8, y0: 8, x1: W - 8, y1: H - 8 };
      const bs: Box[] = [];
      for (let i = Math.floor(rnd() * 5); i > 0; i--) {
        const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H);
        bs.push({ x0: x, y0: y, x1: x + 20 + Math.floor(rnd() * W * 0.4), y1: y + 10 + Math.floor(rnd() * H * 0.3) });
      }
      const w = 120 + Math.floor(rnd() * 140), h = rnd() < 0.5 ? 36 : 64, gap = 10;
      const home = { x: Math.floor(rnd() * W * 3 - W), y: Math.floor(rnd() * H * 3 - H) };
      const p = dockSpot({ home, w, h, area: a, blocks: bs, gap });
      // The best a search of every whole pixel finds.
      let best = Infinity;
      for (let y = a.y0; y + h <= a.y1; y += 2) for (let x = a.x0; x + w <= a.x1; x += 2) {
        if (boxClear(at({ x, y }, w, h), a, bs, gap)) best = Math.min(best, dist({ x, y }, w, h, home));
      }
      if (best === Infinity) continue; // no free place at all on this stage
      expect(boxClear(at(p, w, h), a, bs, gap), `scene ${n}`).toBe(true);
      expect(dist(p, w, h, home), `scene ${n}`).toBeLessThanOrEqual(best + 1e-6);
    }
  });

  it('with no free place at all it still lands inside the area, over as little as possible', () => {
    const small: Box = { x0: 8, y0: 8, x1: 208, y1: 108 };
    const wall: Box = { x0: 0, y0: 0, x1: 300, y1: 70 };
    const p = dockSpot({ home: { x: 100, y: 400 }, w: 150, h: 64, area: small, blocks: [wall], gap: 10 });
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.x + 150).toBeLessThanOrEqual(208);
    expect(p.y + 64).toBeLessThanOrEqual(108);
    expect(p.y).toBe(44);
  });

  it('boxClear: inside the area and a gap away from every block', () => {
    expect(boxClear({ x0: 20, y0: 20, x1: 120, y1: 60 }, area, blocks)).toBe(true);
    expect(boxClear({ x0: 0, y0: 20, x1: 100, y1: 60 }, area, blocks)).toBe(false);
    expect(boxClear({ x0: 1000, y0: 700, x1: 1146, y1: 760 }, area, blocks, 0)).toBe(true);
    expect(boxClear({ x0: 1000, y0: 700, x1: 1146, y1: 760 }, area, blocks, 10)).toBe(false);
  });
});

describe('wholeGain: what floats over a Market or a Lab is whole units', () => {
  it('shows nothing until a whole unit has been earned, and carries the rest', () => {
    expect(wholeGain(0, 0.4)).toEqual({ show: 0, carry: 0.4 });
    const b = wholeGain(0.4, 0.4);
    expect(b.show).toBe(0);
    const c = wholeGain(b.carry, 0.4);
    expect(c.show).toBe(1);
    expect(c.carry).toBeCloseTo(0.2, 9);
    expect(wholeGain(0.59, 7.41).show).toBe(8);
    expect(wholeGain(0, 1234.5)).toEqual({ show: 1234, carry: 0.5 });
  });

  it('ten tenths make one', () => {
    let carry = 0, shown = 0;
    for (let i = 0; i < 10; i++) {
      const r = wholeGain(carry, 0.1);
      carry = r.carry;
      shown += r.show;
    }
    expect(shown).toBe(1);
    expect(carry).toBeLessThan(1e-6);
  });

  it('over a minute what was shown is what was earned, to within one unit, and never more', () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const scale of [0.05, 0.4, 1, 7.41, 1.99, 180, 12345.678]) {
      let carry = 0, shown = 0, earned = 0;
      for (let s = 0; s < 60; s++) {
        const e = scale * (0.5 + rnd());
        earned += e;
        const r = wholeGain(carry, e);
        expect(Number.isInteger(r.show)).toBe(true);
        expect(r.carry).toBeGreaterThanOrEqual(0);
        expect(r.carry).toBeLessThan(1);
        carry = r.carry;
        shown += r.show;
      }
      expect(shown).toBeLessThanOrEqual(earned + 1e-4);
      expect(earned - shown).toBeLessThan(1);
    }
  });

  it('never goes below nothing', () => {
    expect(wholeGain(-1, -3)).toEqual({ show: 0, carry: 0 });
  });
});

describe('heldRate: a still pattern is only redrawn for a real change of rate', () => {
  it('holds through the wobble of a reading', () => {
    let held = heldRate(0, 0.5);
    expect(held).toBe(0.5);
    for (const r of [0.46, 0.53, 0.49, 0.58, 0.42]) held = heldRate(held, r);
    expect(held).toBe(0.5);
  });
  it('follows a change of a fifth or more, a start and a stop', () => {
    expect(heldRate(0.5, 0.64)).toBe(0.64);
    expect(heldRate(1, 0.79)).toBe(0.79);
    expect(heldRate(1, 0)).toBe(0);
    expect(heldRate(0, 0.02)).toBe(0.02);
    expect(heldRate(2, -1)).toBe(0);
  });
});

describe('bestWindow: the stretch of a big factory with the most cards on screen', () => {
  const card = (x: number, y: number): Box => ({ x0: x, y0: y, x1: x + 172, y1: y + 72 });
  const area: Box = { x0: 16, y0: 100, x1: 374, y1: 700 };
  const shows = (v: { x: number; y: number; k: number }, b: Box) =>
    b.x0 * v.k + v.x >= area.x0 - 0.5 && b.x1 * v.k + v.x <= area.x1 + 0.5 && b.y0 * v.k + v.y >= area.y0 - 0.5 && b.y1 * v.k + v.y <= area.y1 + 0.5;
  it('picks the cluster of cards over a lone card', () => {
    const boxes = [card(100, 100), card(100, 240), card(300, 160), card(1400, 160)];
    const v = bestWindow(boxes, [], area, 0.74)!;
    expect(boxes.filter((b) => shows(v, b)).length).toBe(3);
    expect(shows(v, boxes[3])).toBe(false);
  });
  it('keeps every card it must show in view, even when another stretch has more', () => {
    const boxes = [card(100, 100), card(100, 240), card(300, 160), card(1400, 160)];
    const v = bestWindow(boxes, [boxes[3]], area, 0.74)!;
    expect(shows(v, boxes[3])).toBe(true);
  });
  it('shows everything when everything fits, and is null with no cards', () => {
    const boxes = [card(0, 0), card(200, 0)];
    const v = bestWindow(boxes, [], area, 0.74)!;
    expect(boxes.every((b) => shows(v, b))).toBe(true);
    expect(bestWindow([], [], area, 0.74)).toBeNull();
  });
  it('on random boards no camera at that zoom shows more cards', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let t = 0; t < 40; t++) {
      const boxes = Array.from({ length: 3 + Math.floor(rnd() * 10) }, () => card(Math.round(rnd() * 1600), Math.round(rnd() * 900)));
      const k = 0.5 + rnd() * 0.5;
      const v = bestWindow(boxes, [], area, k)!;
      const n = boxes.filter((b) => shows(v, b)).length;
      for (let x = -1800; x < 400; x += 25) for (let y = -900; y < 700; y += 25) expect(boxes.filter((b) => shows({ x, y, k }, b)).length).toBeLessThanOrEqual(n);
    }
  });
});

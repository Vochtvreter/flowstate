import { describe, expect, it } from 'vitest';
import { connect, placeNode } from '../actions';
import { GRID, newGame } from '../state';
import { Box, CARD_GAP, PLOT_MARGIN, Pt, bezierAt, cardsOverlap } from './geom';
import { TidyInput, TidyNode, TidyWire, boardStats, tidy, tidyInput } from './layout';

const BOARD = { w: 1640, h: 760 };
const card = (id: number, x: number, y: number, fixed = false, w = 172, h = 72): TidyNode => ({ id, x, y, w, h, room: h, fixed });
const wire = (from: number, to: number): TidyWire => ({ from, to, ay: 36, by: 36 });
const board = (nodes: TidyNode[], wires: TidyWire[], deposits: Box[] = []): TidyInput => ({ nodes, wires, deposits, board: BOARD, grid: GRID });
const after = (input: TidyInput) => {
  const moved = tidy(input);
  return { moved, nodes: input.nodes.map((n) => ({ ...n, ...(moved.get(n.id) ?? {}) })), stats: boardStats(input, moved) };
};
/** The same board with its cards where a Tidy put them. */
const tidied = (input: TidyInput, moved: Map<number, Pt>): TidyInput => ({ ...input, nodes: input.nodes.map((n) => ({ ...n, ...(moved.get(n.id) ?? {}) })) });
/** A small deterministic generator, so the random boards are the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** Where a wire starts and ends, as the board draws it: out of the right side of `a`, into the left side of `b`. */
const ends = (a: TidyNode, b: TidyNode, w: TidyWire) => ({ A: { x: a.x + a.w, y: a.y + w.ay }, B: { x: b.x, y: b.y + w.by } });
/**
 * Times a wire, followed closely along the curve the board draws (400 steps of `bezierAt`), is inside a
 * card it does not end at: the count a player would make from the picture.
 */
function drawnBehind(input: TidyInput, moved?: Map<number, Pt>): number {
  const nodes = moved ? tidied(input, moved).nodes : input.nodes;
  const at = new Map(nodes.map((n) => [n.id, n]));
  let hits = 0;
  for (const w of input.wires) {
    const a = at.get(w.from)!, b = at.get(w.to)!;
    const { A, B } = ends(a, b, w);
    for (const c of nodes) {
      if (c.id === w.from || c.id === w.to) continue;
      for (let i = 0; i <= 400; i++) {
        const q = bezierAt(A, B, i / 400);
        if (q.x > c.x && q.x < c.x + c.w && q.y > c.y && q.y < c.y + c.h) {
          hits++;
          break;
        }
      }
    }
  }
  return hits;
}
/** A random factory: a column of Drills, and cards scattered over the plot, each fed by a Drill or by a card before it. */
function factory(r: () => number): TidyInput {
  const nodes: TidyNode[] = [];
  const wells = 2 + Math.floor(r() * 4);
  for (let i = 0; i < wells; i++) nodes.push(card(i + 1, 100, 120 + i * 140, true));
  const count = 4 + Math.floor(r() * 14);
  for (let i = 0; i < count; i++) nodes.push(card(10 + i, 300 + Math.round(r() * 55) * 20, 40 + Math.round(r() * 30) * 20, false, r() < 0.2 ? 136 : 172, [60, 72, 92][Math.floor(r() * 3)]));
  const wires: TidyWire[] = [];
  // Every card is fed by a Drill or by a card before it; a few get a second feed.
  for (let i = 0; i < count; i++) {
    const feeds = 1 + (r() < 0.3 ? 1 : 0);
    for (let k = 0; k < feeds; k++) {
      const from = r() < 0.4 || i === 0 ? 1 + Math.floor(r() * wells) : 10 + Math.floor(r() * i);
      if (!wires.some((w) => w.from === from && w.to === 10 + i)) wires.push({ from, to: 10 + i, ay: 36, by: 20 + Math.floor(r() * 3) * 16 });
    }
  }
  return board(nodes, wires);
}

describe('boardStats: the board in numbers', () => {
  it('counts a pair of wires that cross, once', () => {
    // Two Drills, two Markets, wired crosswise.
    const crossed = board([card(1, 100, 100, true), card(2, 100, 300, true), card(3, 500, 100), card(4, 500, 300)], [wire(1, 4), wire(2, 3)]);
    expect(boardStats(crossed).crossings).toBe(1);
    const straight = board(crossed.nodes, [wire(1, 3), wire(2, 4)]);
    expect(boardStats(straight).crossings).toBe(0);
    expect(boardStats(straight).length).toBeCloseTo(2 * (500 - 272), 0);
  });

  it('counts cards on top of one another, wires behind cards, and wires that run backwards', () => {
    const b = board([card(1, 100, 100, true), card(2, 700, 100), card(3, 400, 100), card(4, 420, 120), card(5, 100, 400, true), card(6, 60, 600)], [wire(1, 2), wire(5, 6)]);
    const s = boardStats(b);
    expect(s.overlaps).toBe(1); // 3 and 4
    expect(s.under).toBe(2); // the wire from 1 to 2 runs behind 3 and 4
    expect(s.backward).toBe(1); // 5 to 6: the far end is to the left
  });

  it('measures a moved board without touching the input', () => {
    const b = board([card(1, 100, 100, true), card(2, 500, 300)], [wire(1, 2)]);
    const moved = new Map([[2, { x: 500, y: 100 }]]);
    expect(boardStats(b, moved).length).toBeLessThan(boardStats(b).length);
    expect(b.nodes[1].y).toBe(300);
  });

  it('follows every wire along the curve the board draws: forwards, backwards, short and long', () => {
    // (The layout works the curve out in plain numbers, for speed: this holds it to `bezierAt`, which the board draws with.)
    const r = rng(11);
    for (let n = 0; n < 300; n++) {
      const a = card(1, Math.round(r() * 1200), Math.round(r() * 600), true), b = card(2, Math.round(r() * 1200), Math.round(r() * 600));
      const w: TidyWire = { from: 1, to: 2, ay: 20 + Math.round(r() * 40), by: 20 + Math.round(r() * 40) };
      const { A, B } = ends(a, b, w);
      let len = 0;
      for (let i = 1; i <= 15; i++) {
        const p = bezierAt(A, B, (i - 1) / 15), q = bezierAt(A, B, i / 15);
        len += Math.hypot(q.x - p.x, q.y - p.y);
      }
      expect(boardStats(board([a, b], [w])).length).toBeCloseTo(len, 6);
    }
  });

  it('calls a wire behind a card when the drawn curve is inside the card, and not when it clears it', () => {
    const r = rng(23);
    let inside = 0, outside = 0;
    for (let n = 0; n < 400; n++) {
      const a = card(1, 100, 100 + Math.round(r() * 20) * 20, true), b = card(2, 500 + Math.round(r() * 30) * 20, 40 + Math.round(r() * 30) * 20);
      const w = wire(1, 2);
      const { A, B } = ends(a, b, w);
      // A third card somewhere along the wire: on it, or a little off it.
      const on = bezierAt(A, B, 0.2 + r() * 0.6);
      const c = card(3, Math.round(on.x - 86 + (r() - 0.5) * 260), Math.round(on.y - 36 + (r() - 0.5) * 160));
      // How far inside the card the curve gets, at most (negative: how far it stays away).
      let depth = -Infinity;
      for (let i = 0; i <= 600; i++) {
        const q = bezierAt(A, B, i / 600);
        depth = Math.max(depth, Math.min(q.x - c.x, c.x + c.w - q.x, q.y - c.y, c.y + c.h - q.y));
      }
      const under = boardStats(board([a, b, c], [w])).under;
      // (Within a few px of the card's edge the fifteen straight pieces and the curve may disagree: those boards prove nothing.)
      if (depth > 4) {
        expect(under).toBe(1);
        inside++;
      } else if (depth < -4) {
        expect(under).toBe(0);
        outside++;
      }
    }
    expect(inside).toBeGreaterThan(50);
    expect(outside).toBeGreaterThan(50);
  });
});

describe('tidy', () => {
  it('uncrosses two wires by moving the cards, not the Drills', () => {
    const b = board([card(1, 100, 100, true), card(2, 100, 300, true), card(3, 500, 100), card(4, 500, 300)], [wire(1, 4), wire(2, 3)]);
    const r = after(b);
    expect(r.stats.crossings).toBe(0);
    expect(r.moved.has(1)).toBe(false);
    expect(r.moved.has(2)).toBe(false);
    expect(r.stats.length).toBeLessThan(boardStats(b).length);
  });

  it('brings a card that sits behind its Drill round to the front of it', () => {
    // The Market is to the left of the Drill that feeds it: the wire has to loop back.
    const b = board([card(1, 600, 300, true), card(2, 200, 300)], [wire(1, 2)]);
    expect(boardStats(b).backward).toBe(1);
    const r = after(b);
    expect(r.stats.backward).toBe(0);
    const m = r.nodes[1];
    expect(m.x).toBeGreaterThan(600 + 172);
  });

  it('pulls apart cards that rest on one another', () => {
    const b = board([card(1, 100, 100, true), card(2, 400, 100), card(3, 420, 120), card(4, 430, 140)], [wire(1, 2), wire(1, 3), wire(1, 4)]);
    expect(boardStats(b).overlaps).toBeGreaterThan(0);
    expect(after(b).stats.overlaps).toBe(0);
  });

  it('leaves a board that is already neat exactly as it is', () => {
    const b = board(
      [card(1, 100, 100, true), card(2, 100, 240, true), card(3, 340, 100), card(4, 340, 240), card(5, 580, 170)],
      [wire(1, 3), wire(2, 4), wire(3, 5), wire(4, 5)],
    );
    expect(tidy(b).size).toBe(0);
  });

  it('keeps moved cards inside the plot and clear of free deposits', () => {
    const deposits: Box[] = [{ x0: 340, y0: 100, x1: 512, y1: 172 }, { x0: 340, y0: 240, x1: 512, y1: 312 }];
    const b = board([card(1, 100, 100, true), card(2, 100, 240, true), card(3, 900, 600), card(4, 1200, 80)], [wire(1, 4), wire(2, 3)], deposits);
    const r = after(b);
    for (const n of r.nodes) {
      if (!r.moved.has(n.id)) continue;
      expect(n.x).toBeGreaterThanOrEqual(PLOT_MARGIN);
      expect(n.y).toBeGreaterThanOrEqual(PLOT_MARGIN);
      expect(n.x + n.w).toBeLessThanOrEqual(BOARD.w - PLOT_MARGIN);
      expect(n.y + n.h).toBeLessThanOrEqual(BOARD.h - PLOT_MARGIN);
      for (const d of deposits) expect(n.x < d.x1 + CARD_GAP && n.x + n.w + CARD_GAP > d.x0 && n.y < d.y1 + CARD_GAP && n.y + n.room + CARD_GAP > d.y0).toBe(false);
    }
    expect(r.moved.size).toBeGreaterThan(0);
  });

  it('a Drill that feeds a Refiner and a Market: the Refiner does not stay level with the Drill, in the way of the wire to the Market', () => {
    // As plain columns lay it out: the Refiner level with its Drill and 68 px away, the Market in the next column.
    // The wire from the Drill to the Market leaves the same port level, and runs straight through the Refiner.
    const b = board(
      [card(1, 100, 120, true), card(2, 100, 260, true), card(3, 340, 120), card(4, 580, 220)],
      [wire(1, 3), wire(1, 4), wire(2, 4), wire(3, 4)],
    );
    expect(boardStats(b).under).toBe(1);
    expect(drawnBehind(b)).toBe(1);
    const r = after(b);
    expect(r.stats.under).toBe(0);
    expect(drawnBehind(b, r.moved)).toBe(0);
    expect(r.stats.overlaps).toBe(0);
    expect(r.moved.has(1) || r.moved.has(2)).toBe(false);
  });

  it('a Drill in the middle of the plot whose wire crosses a card: the card it feeds, or the card in the way, moves', () => {
    // Drills 1 and 2 on the left; Drill 3 on a deposit further in, below. The Refiner it feeds (6) was put up
    // and to the left of it, so its wire loops back across the Refiner of Drill 2 (5), which stands between.
    const b = board(
      [card(1, 100, 120, true), card(2, 100, 400, true), card(3, 380, 620, true), card(4, 340, 120), card(5, 340, 470, false, 172, 92), card(6, 340, 340), card(7, 820, 420)],
      [wire(1, 4), wire(2, 5), wire(3, 6), wire(4, 7), wire(5, 7), wire(6, 7)],
    );
    expect(boardStats(b).under).toBeGreaterThan(0);
    const r = after(b);
    expect(r.stats.under).toBe(0);
    expect(drawnBehind(b, r.moved)).toBe(0);
    for (const id of [1, 2, 3]) expect(r.moved.has(id)).toBe(false);
    expect(r.moved.has(5) || r.moved.has(6)).toBe(true);
  });

  it('does not call a board tidy while a wire runs behind a card, however short its wires are', () => {
    // A Drill, its Refiner and the Market in one row: no layout has less wire. But the wire from the Drill to the
    // Market runs behind the Refiner. Bringing it out costs wire, and is done all the same.
    const b = board([card(1, 100, 120, true), card(2, 340, 120), card(3, 580, 120)], [wire(1, 2), wire(1, 3), wire(2, 3)]);
    const s0 = boardStats(b);
    expect(s0.under).toBe(1);
    expect(s0.length).toBeCloseTo(68 + 68 + 308, 0);
    const r = after(b);
    expect(r.moved.size).toBeGreaterThan(0);
    expect(r.stats.under).toBe(0);
    expect(drawnBehind(b, r.moved)).toBe(0);
    expect(r.stats.length).toBeGreaterThan(s0.length);
  });

  it('where no wire can come out from behind a card, never adds crossings or wire', () => {
    // Two Drills, side by side, each wired to the Market beyond the other: nothing but the Market can move,
    // and wherever it stands one wire crosses the other Drill.
    const b = board([card(1, 100, 300, true), card(2, 340, 300, true), card(3, 900, 600)], [wire(1, 3), wire(2, 3)]);
    const s0 = boardStats(b);
    const r = after(b);
    expect(r.stats.under).toBeLessThanOrEqual(s0.under);
    if (r.stats.under === s0.under) {
      expect(r.stats.crossings).toBeLessThanOrEqual(s0.crossings);
      expect(r.stats.length).toBeLessThanOrEqual(s0.length + 0.5);
    }
    expect(r.moved.has(1) || r.moved.has(2)).toBe(false);
  });

  it('on 30 random factories: no overlap, no Drill moved, no wire left behind a card, and never worse than the board it was given', () => {
    const r = rng(5);
    let before = 0, afterC = 0, behind = 0;
    for (let n = 0; n < 30; n++) {
      const input = factory(r);
      const moved = tidy(input);
      const s0 = boardStats(input), s1 = boardStats(input, moved);
      const out = tidied(input, moved).nodes;
      for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(cardsOverlap(out[i], out[j])).toBe(false);
      for (const c of input.nodes) if (c.fixed) expect(moved.has(c.id)).toBe(false);
      // (A board whose cards overlap is first pulled apart, which can add a little wire: those are compared after that.)
      if (s0.overlaps === 0) {
        expect(s1.under).toBeLessThanOrEqual(s0.under);
        // More crossings or more wire only when that brought a wire out from behind a card.
        if (s1.under === s0.under) {
          expect(s1.crossings).toBeLessThanOrEqual(s0.crossings);
          expect(s1.length).toBeLessThanOrEqual(s0.length + 0.5);
        }
      }
      // What the layout counts and what is drawn agree.
      expect(drawnBehind(input, moved)).toBe(s1.under);
      before += s0.crossings;
      afterC += s1.crossings;
      behind += s1.under;
    }
    // These boards start with some twenty wires behind cards each; every one of them comes out.
    expect(behind).toBe(0);
    // And taken together, random tangles still lose well over two thirds of their crossings.
    expect(afterC).toBeLessThan(before * 0.33);
  }, 120000);

  it('on 12 random factories: the same answer every time, and a second Tidy moves nothing', () => {
    const r = rng(41);
    for (let n = 0; n < 12; n++) {
      const input = factory(r);
      const moved = tidy(input);
      expect([...tidy(input)]).toEqual([...moved]);
      expect(tidy(tidied(input, moved)).size).toBe(0);
    }
  }, 120000);

  it('reads a real game: cards with their sizes, wires with their ports, and Drills that stay put', () => {
    const g = newGame();
    g.credits = 1e6;
    const well = g.nodes.find((n) => n.type === 'well')!;
    // A second Market, behind the Drill, with a wire that has to loop back to it.
    const m2 = placeNode(g, 'market', 100, 400)!;
    connect(g, well.id, 0, m2.id);
    const input = tidyInput(g, GRID);
    expect(input.nodes).toHaveLength(g.nodes.length);
    expect(input.nodes.find((n) => n.id === well.id)!.fixed).toBe(true);
    expect(input.wires).toEqual([{ from: well.id, to: m2.id, ay: 36, by: 36 }]);
    // Four deposits have no Drill on them.
    expect(input.deposits).toHaveLength(g.deposits.length - 1);
    const moved = tidy(input);
    expect(moved.has(well.id)).toBe(false);
    expect(moved.has(m2.id)).toBe(true);
    expect(boardStats(input, moved).backward).toBe(0);
  });
});

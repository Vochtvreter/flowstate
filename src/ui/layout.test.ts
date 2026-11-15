import { describe, expect, it } from 'vitest';
import { connect, placeNode } from '../actions';
import { GRID, newGame } from '../state';
import { Box, CARD_GAP, PLOT_MARGIN, cardsOverlap } from './geom';
import { TidyInput, TidyNode, TidyWire, boardStats, tidy, tidyInput } from './layout';

const BOARD = { w: 1640, h: 760 };
const card = (id: number, x: number, y: number, fixed = false, w = 172, h = 72): TidyNode => ({ id, x, y, w, h, room: h, fixed });
const wire = (from: number, to: number): TidyWire => ({ from, to, ay: 36, by: 36 });
const board = (nodes: TidyNode[], wires: TidyWire[], deposits: Box[] = []): TidyInput => ({ nodes, wires, deposits, board: BOARD, grid: GRID });
const after = (input: TidyInput) => {
  const moved = tidy(input);
  return { moved, nodes: input.nodes.map((n) => ({ ...n, ...(moved.get(n.id) ?? {}) })), stats: boardStats(input, moved) };
};
/** A small deterministic generator, so the random boards are the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('boardStats: the board in numbers', () => {
  it('counts a pair of wires that cross, once', () => {
    // Two Wells, two Markets, wired crosswise.
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
});

describe('tidy', () => {
  it('uncrosses two wires by moving the cards, not the Wells', () => {
    const b = board([card(1, 100, 100, true), card(2, 100, 300, true), card(3, 500, 100), card(4, 500, 300)], [wire(1, 4), wire(2, 3)]);
    const r = after(b);
    expect(r.stats.crossings).toBe(0);
    expect(r.moved.has(1)).toBe(false);
    expect(r.moved.has(2)).toBe(false);
    expect(r.stats.length).toBeLessThan(boardStats(b).length);
  });

  it('brings a card that sits behind its Well round to the front of it', () => {
    // The Market is to the left of the Well that feeds it: the wire has to loop back.
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

  it('on 40 random factories: no overlap, no Well moved, never more crossings or more wire, and the same answer every time', () => {
    const r = rng(5);
    let before = 0, afterC = 0;
    for (let n = 0; n < 40; n++) {
      const nodes: TidyNode[] = [];
      const wells = 2 + Math.floor(r() * 4);
      for (let i = 0; i < wells; i++) nodes.push(card(i + 1, 100, 120 + i * 140, true));
      const count = 4 + Math.floor(r() * 14);
      for (let i = 0; i < count; i++) nodes.push(card(10 + i, 300 + Math.round(r() * 55) * 20, 40 + Math.round(r() * 30) * 20, false, r() < 0.2 ? 136 : 172, [60, 72, 92][Math.floor(r() * 3)]));
      const wires: TidyWire[] = [];
      // Every card is fed by a Well or by a card before it; a few get a second feed.
      for (let i = 0; i < count; i++) {
        const feeds = 1 + (r() < 0.3 ? 1 : 0);
        for (let k = 0; k < feeds; k++) {
          const from = r() < 0.4 || i === 0 ? 1 + Math.floor(r() * wells) : 10 + Math.floor(r() * i);
          if (!wires.some((w) => w.from === from && w.to === 10 + i)) wires.push({ from, to: 10 + i, ay: 36, by: 20 + Math.floor(r() * 3) * 16 });
        }
      }
      const input = board(nodes, wires);
      const moved = tidy(input);
      const s0 = boardStats(input), s1 = boardStats(input, moved);
      const out = nodes.map((c) => ({ ...c, ...(moved.get(c.id) ?? {}) }));
      for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(cardsOverlap(out[i], out[j])).toBe(false);
      for (const c of nodes) if (c.fixed) expect(moved.has(c.id)).toBe(false);
      // (A board whose cards overlap is first pulled apart, which can add a little wire: those are compared after that.)
      if (s0.overlaps === 0) {
        expect(s1.crossings).toBeLessThanOrEqual(s0.crossings);
        expect(s1.length).toBeLessThanOrEqual(s0.length + 0.5);
      }
      expect([...tidy(input)]).toEqual([...moved]);
      before += s0.crossings;
      afterC += s1.crossings;
    }
    // Taken together, random tangles lose well over a third of their crossings.
    expect(afterC).toBeLessThan(before * 0.65);
  });

  it('reads a real game: cards with their sizes, wires with their ports, and Wells that stay put', () => {
    const g = newGame();
    g.credits = 1e6;
    const well = g.nodes.find((n) => n.type === 'well')!;
    // A second Market, behind the Well, with a wire that has to loop back to it.
    const m2 = placeNode(g, 'market', 100, 400)!;
    connect(g, well.id, 0, m2.id);
    const input = tidyInput(g, GRID);
    expect(input.nodes).toHaveLength(g.nodes.length);
    expect(input.nodes.find((n) => n.id === well.id)!.fixed).toBe(true);
    expect(input.wires).toEqual([{ from: well.id, to: m2.id, ay: 36, by: 36 }]);
    // Four deposits have no Well on them.
    expect(input.deposits).toHaveLength(g.deposits.length - 1);
    const moved = tidy(input);
    expect(moved.has(well.id)).toBe(false);
    expect(moved.has(m2.id)).toBe(true);
    expect(boardStats(input, moved).backward).toBe(0);
  });
});

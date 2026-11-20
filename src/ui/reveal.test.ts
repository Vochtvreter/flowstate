// What of the interface is on show at each point of the game (reveal.ts). These run without a browser.
import { describe, expect, it } from 'vitest';
import { clearHistory, placeNode } from '../actions';
import { HOTBAR, NodeType } from '../content';
import { nodeCost } from '../economy';
import { GOALS } from '../goals';
import { Game, newGame } from '../state';
import { revealOf, slotShown } from './reveal';

function at(id: string | number, techs: string[] = []): Game {
  clearHistory();
  const g = newGame();
  g.goal = { i: typeof id === 'number' ? id : GOALS.findIndex((x) => x.id === id), ready: false };
  g.techs = techs;
  return g;
}
const slots = (g: Game) => HOTBAR.filter((t) => slotShown(g, t));

describe('start simple: the first screen is a Drill, a Market and one sentence', () => {
  it('on goal 1 nothing is on show that has no use yet', () => {
    const g = at('wire-market');
    expect(revealOf(g)).toEqual({ undo: false, zoom: false, minimap: false, trash: false, plot: false, depositWords: false, flows: false, upgrades: false, wires: false });
    expect(slots(g)).toEqual([]);
  });

  it('each part arrives with the goal that first gives it a use, and stays', () => {
    const first = (pick: (g: Game) => boolean) => GOALS.findIndex((_, i) => pick(at(i, i >= 5 ? ['P1', 'R1'] : i >= 3 ? ['P1'] : [])));
    const idOf = (i: number) => GOALS[i].id;
    expect(idOf(first((g) => revealOf(g).undo))).toBe('second-well');
    expect(idOf(first((g) => slotShown(g, 'well')))).toBe('second-well');
    expect(idOf(first((g) => revealOf(g).zoom))).toBe('build-refiner');
    expect(idOf(first((g) => revealOf(g).trash))).toBe('build-refiner');
    expect(idOf(first((g) => slotShown(g, 'market')))).toBe('upgrade-well');
    expect(idOf(first((g) => revealOf(g).depositWords))).toBe('upgrade-well'); // the Lab is goal 5's reward
    expect(idOf(first((g) => revealOf(g).minimap))).toBe('make-ink');
    expect(idOf(first((g) => revealOf(g).flows))).toBe('make-ink');
    expect(idOf(first((g) => revealOf(g).plot))).toBe('expand');
    expect(idOf(first((g) => revealOf(g).upgrades))).toBe('upgrade-well');
    // Once on show, a part is never taken away again.
    for (const key of ['undo', 'zoom', 'minimap', 'trash', 'plot', 'flows', 'upgrades'] as const) {
      let seen = false;
      for (let i = 0; i <= GOALS.length; i++) {
        const on = revealOf(at(i))[key];
        if (seen) expect(on, `${key} at goal ${i + 1}`).toBe(true);
        seen ||= on;
      }
    }
    // (A Drill that has been speeded up early shows its upgrades from then on, whatever the goal.)
    const early = at('second-well');
    early.nodes[0].lv.speed = 1;
    expect(revealOf(early).upgrades).toBe(true);
  });

  it('a slot is never shown for a machine that is locked, and every unlocked one has its slot by the Lab goal', () => {
    const g = at('wire-market');
    for (const t of HOTBAR) if (t !== 'well' && t !== 'market') expect(slotShown(g, t), t).toBe(false);
    const later = at('feed-lab', ['P1', 'R1']);
    expect(slots(later)).toEqual(['well', 'refiner', 'market', 'lab'] as NodeType[]);
  });

  it('the Market\'s slot also comes the moment a second Market can be paid for, and the minimap once the board is big', () => {
    const g = at('second-well');
    expect(slotShown(g, 'market')).toBe(false);
    g.credits = nodeCost(g, 'market');
    expect(slotShown(g, 'market')).toBe(true);
    const big = at('second-well', ['P1']);
    big.credits = 1e6;
    expect(revealOf(big).minimap).toBe(false);
    for (let i = 0; i < 6; i++) placeNode(big, 'refiner', 300 + 200 * (i % 3), 100 + 140 * Math.floor(i / 3));
    expect(big.nodes.length).toBe(8);
    expect(revealOf(big).minimap).toBe(true);
  });

  it('a save that is further on shows all of it at once', () => {
    const g = at('make-glyph', ['P1', 'R1', 'P2', 'P3', 'L1']);
    g.board.expansions = 1;
    g.credits = 1e6;
    for (let i = 0; i < 4; i++) placeNode(g, 'refiner', 300 + 200 * (i % 2), 100 + 140 * Math.floor(i / 2));
    expect(revealOf(g)).toEqual({ undo: true, zoom: true, minimap: true, trash: true, plot: true, depositWords: true, flows: true, upgrades: true, wires: true });
  });

  it('cable management comes with the sixth card on the board, whatever the goal, and stays while a wire has a pin', () => {
    const g = at('make-glyph', ['P1', 'R1', 'P2', 'P3', 'L1']);
    g.credits = 1e6;
    expect(g.nodes.length).toBe(2);
    expect(revealOf(g).wires).toBe(false);
    for (let i = 0; i < 3; i++) placeNode(g, 'refiner', 300 + 200 * i, 100);
    expect(revealOf(g).wires).toBe(false);
    placeNode(g, 'refiner', 300, 240);
    expect(g.nodes.length).toBe(6);
    expect(revealOf(g).wires).toBe(true);
    const few = at('second-well');
    const [drill, market] = few.nodes;
    few.wires.push({ id: 1, from: drill.id, port: 0, to: market.id, tier: 0, rate: 0, paid: 0, pins: [{ x: 300, y: 200 }] } as Game['wires'][number]);
    expect(revealOf(few).wires).toBe(true);
  });
});

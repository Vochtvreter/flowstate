// Which node the HUD's alert names, and what the board says at the ending (status.ts). These run without a
// browser: they only read the game.
import { describe, expect, it } from 'vitest';
import { clearHistory, connect, placeNode } from '../actions';
import { GOALS } from '../goals';
import { tick } from '../sim';
import { Game, GNode, newGame } from '../state';
import { ALERT_QUIET, alertPick, diagnose } from './status';

const run = (g: Game, seconds: number) => {
  for (let i = 0; i < seconds * 20; i++) tick(g, 0.05);
};

/** The opening board: a Well and a Market, two nodes the alert could name (what it says is made up here). */
function twoOpenWells(): { g: Game; a: GNode; b: GNode } {
  clearHistory();
  const g = newGame();
  const a = g.nodes.find((n) => n.type === 'well')!;
  const b = g.nodes.find((n) => n.type === 'market')!;
  return { g, a, b };
}

const says = (n: GNode) => `about ${n.id}`;

describe('the alert names the node the goal is about first', () => {
  it('a node the goal (or its line) is about comes before the one named last and before the worst off', () => {
    const { g, a, b } = twoOpenWells();
    g.goalAt = { i: g.goal.i, t: g.time - ALERT_QUIET - 1 };
    expect(alertPick(g, a.id, says, [b.id])?.n.id).toBe(b.id);
    // Nothing the goal is about is in trouble: the one named last keeps its place.
    expect(alertPick(g, a.id, (n) => (n.id === b.id ? null : says(n)), [b.id])?.n.id).toBe(a.id);
    expect(alertPick(g, a.id, says, [])?.n.id).toBe(a.id);
    expect(alertPick(g, b.id, says, [])?.n.id).toBe(b.id);
  });

  it('in the order the player meets them', () => {
    const { g, a, b } = twoOpenWells();
    g.goalAt = { i: g.goal.i, t: g.time - ALERT_QUIET - 1 };
    expect(alertPick(g, -1, says, [a.id, b.id])?.n.id).toBe(a.id);
    expect(alertPick(g, -1, says, [b.id, a.id])?.n.id).toBe(b.id);
  });

  it('at the start of a goal it says nothing about what the card is telling the player', () => {
    const { g, a, b } = twoOpenWells();
    g.goalAt = { i: g.goal.i, t: g.time };
    // The card is about b: the alert names a instead, then b once the opening seconds are over.
    expect(alertPick(g, -1, says, [b.id])?.n.id).toBe(a.id);
    expect(alertPick(g, -1, (n) => (n.id === b.id ? says(n) : null), [b.id])).toBeNull();
    g.goalAt = { i: g.goal.i, t: g.time - ALERT_QUIET - 1 };
    expect(alertPick(g, -1, says, [b.id])?.n.id).toBe(b.id);
  });

  it('where the goal names no node, the card is about the kinds its hint names (goal 3: the new Well)', () => {
    const { g, a, b } = twoOpenWells();
    g.goal = { i: GOALS.findIndex((x) => x.id === 'wire-all-wells'), ready: false };
    g.goalAt = { i: g.goal.i, t: g.time };
    // "Drag from the new Well's port to the same Market": nothing is said about a Well or that Market at first.
    expect(alertPick(g, -1, says, [])).toBeNull();
    g.goalAt = { i: g.goal.i, t: g.time - ALERT_QUIET - 1 };
    expect([a.id, b.id]).toContain(alertPick(g, -1, says, [])?.n.id);
  });
});

describe('the ending: a machine that makes only the Lens', () => {
  it('shows no trouble between the first Lens and free play', () => {
    clearHistory();
    const g = newGame();
    g.credits = 1e9;
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'P5', 'P7', 'L1'];
    const fab = placeNode(g, 'fabricator', 600, 300, { recipe: 'lens' })!;
    const glyph = placeNode(g, 'assembler', 300, 200, { recipe: 'glyph' })!;
    connect(g, glyph.id, 0, fab.id);
    run(g, 1);
    // Starved of Glyph (as the simulation would have it after a first Lens): said, while the demo is still on.
    expect(fab.recipe).toBe('lens');
    fab.status = 'starved';
    fab.missing = 'glyph';
    expect(diagnose(g, fab).problem).toBe('starved');
    fab.status = 'blocked';
    fab.blockedOn = 'lens';
    expect(diagnose(g, fab).problem).toBe('blocked');
    g.ended = true;
    expect(diagnose(g, fab).problem).toBeNull();
    fab.status = 'starved';
    expect(diagnose(g, fab).problem).toBeNull();
    // Anything else is still diagnosed as before.
    expect(diagnose(g, glyph).problem).toBe(diagnose({ ...g, ended: false }, glyph).problem);
  });
});

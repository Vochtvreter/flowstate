// Undo and the goal chain: undo stops at the last claim (rewards are not undoable, so neither is what earned
// them), an undo that takes away what a ready goal stands on takes its Claim too, and the board's expansion is
// one undo step like any other.
import { describe, expect, it } from 'vitest';
import { canUndo, claimGoal, connect, expandBoard, placeNode, redo, undo, upgradeAll } from '../src/actions';
import { expansionCost } from '../src/economy';
import { GOALS, activeGoal } from '../src/goals';
import { Game } from '../src/state';
import { fresh, market, run, well } from './helpers';

const at = (g: Game, id: string) => {
  g.goal = { i: GOALS.findIndex((x) => x.id === id), ready: false };
  g.goalAt = { i: g.goal.i, t: g.time };
};

describe('undo stops at the last claim', () => {
  it('"Dig up more Sand": claimed, the Drill cannot be undone, and "Sell that Sand too" is not met for nothing', () => {
    const g = fresh();
    connect(g, well(g).id, 0, market(g).id);
    run(g, 1);
    claimGoal(g);
    run(g, 15);
    const w2 = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    run(g, 0.1);
    expect(activeGoal(g)!.id).toBe('second-well');
    expect(claimGoal(g)).toBe(true);
    const c = g.credits;
    expect(canUndo()).toBe(false);
    expect(undo(g)).toBe(false);
    expect(g.credits).toBe(c);
    run(g, 0.1);
    expect(g.nodes.some((n) => n.id === w2.id)).toBe(true);
    expect({ goal: activeGoal(g)!.id, ready: g.goal.ready }).toEqual({ goal: 'wire-all-wells', ready: false });
  });

  it('"Speed up every Drill at once": claimed, the upgrade stays and so does the reward (not the reward and a Drill at level 0)', () => {
    const g = fresh();
    g.techs.push('P1', 'R1', 'S1');
    at(g, 'bulk-upgrade');
    g.credits = 50;
    expect(upgradeAll(g, 'well', 'speed')).toBe(1);
    run(g, 0.1);
    const pays = activeGoal(g)!.reward.credits!;
    expect(claimGoal(g)).toBe(true);
    expect(undo(g)).toBe(false);
    expect({ credits: g.credits, speed: well(g).lv.speed }).toEqual({ credits: pays, speed: 1 });
  });

  it('before the claim, an undo that takes away what the goal stands on takes the Claim with it; a redo gives it back', () => {
    const g = fresh();
    g.techs.push('P1', 'R1', 'S1');
    at(g, 'bulk-upgrade');
    g.credits = 50;
    expect(upgradeAll(g, 'well', 'speed')).toBe(1);
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
    expect(undo(g)).toBe(true);
    expect(g.goal.ready).toBe(false);
    expect(claimGoal(g)).toBe(false);
    expect(redo(g)).toBe(true);
    run(g, 0.1);
    expect(claimGoal(g)).toBe(true);
  });
});

describe('the board\'s expansion is one undo step', () => {
  it('pressed by mistake: undo refunds it in full, and the plot and its deposits are gone', () => {
    const g = fresh();
    g.credits = 400;
    const before = { credits: g.credits, w: g.board.w, h: g.board.h, deposits: g.deposits.map((d) => d.id) };
    const cost = expansionCost(g);
    expect(expandBoard(g)).toBe(true);
    expect(g.credits).toBe(before.credits - cost);
    expect(g.board.expansions).toBe(1);
    expect(g.deposits.length).toBe(before.deposits.length + 2);
    expect(undo(g)).toBe(true);
    expect(g.credits).toBe(before.credits);
    expect(g.board).toEqual({ w: before.w, h: before.h, expansions: 0 });
    expect(g.deposits.map((d) => d.id)).toEqual(before.deposits);
    expect(expansionCost(g)).toBe(cost);
    // Redo buys the same plot again, with its deposits where they were.
    expect(redo(g)).toBe(true);
    expect(g.credits).toBe(before.credits - cost);
    expect(g.board.expansions).toBe(1);
    expect(g.deposits.length).toBe(before.deposits.length + 2);
  });

  it('with something placed on the new plot since, that comes off first (it is the later step), then the plot', () => {
    const g = fresh();
    g.techs.push('P1', 'R1', 'P2');
    g.credits = 1000;
    expect(expandBoard(g)).toBe(true);
    const dep = g.deposits[g.deposits.length - 1];
    const w = placeNode(g, 'well', dep.x, dep.y, { depositId: dep.id })!;
    expect(undo(g)).toBe(true); // the Drill
    expect(g.nodes.some((n) => n.id === w.id)).toBe(false);
    expect(undo(g)).toBe(true); // the plot
    expect(g.board.expansions).toBe(0);
    expect(g.deposits.some((d) => d.id === dep.id)).toBe(false);
    expect(g.credits).toBe(1000);
  });

  it('once a goal has been claimed after it, it stays', () => {
    // (The plot is bought for a growth goal now, "Make 1 Plastic a second": whatever goal is claimed next, the claim
    // is where undo stops.)
    const g = fresh();
    at(g, 'second-well');
    g.credits = 1000;
    expect(expandBoard(g)).toBe(true);
    placeNode(g, 'well', 0, 0, { depositId: 2 });
    run(g, 0.1);
    expect(claimGoal(g)).toBe(true);
    expect(undo(g)).toBe(false);
    expect(g.board.expansions).toBe(1);
  });
});

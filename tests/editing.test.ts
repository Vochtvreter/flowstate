import { describe, expect, it } from 'vitest';
import {
  canDelete, canFavour, canUndo, clearHistory, connect, cutWire, deleteNode, favour, favouredWire, placeNode, pushUndo, redo, refundOf,
  setMode, setWeight, splice, undo, upgrade, upgradeWire,
} from '../src/actions';
import { RULES } from '../src/content';
import { GOALS, goalById, routerFavoursLab } from '../src/goals';
import { buyBackPrice, nodeCost, upgradeCost, upgradeValue } from '../src/economy';
import { snapshot } from '../src/state';
import { fresh, market, rich, run, take, well, wire } from './helpers';

describe('refunds are the buy-back price plus upgrades (2.7)', () => {
  it('deleting the oldest of three Refiners and re-placing it nets to zero', () => {
    const g = fresh();
    g.techs = ['P1'];
    g.credits = 1000;
    const first = placeNode(g, 'refiner', 300, 100)!;
    placeNode(g, 'refiner', 300, 300)!;
    placeNode(g, 'refiner', 300, 500)!;
    expect(1000 - g.credits).toBe(50 + 57 + 66);
    const before = g.credits;
    expect(refundOf(g, first)).toBe(66); // what a third Refiner costs, not the 50 paid for this one
    expect(buyBackPrice(g, 'refiner')).toBe(66);
    deleteNode(g, first.id);
    expect(g.credits).toBe(before + 66);
    expect(nodeCost(g, 'refiner')).toBe(66);
    expect(placeNode(g, 'refiner', 300, 100)).not.toBeNull();
    expect(g.credits).toBe(before);
  });

  it('selling everything returns exactly what was spent', () => {
    const g = fresh();
    g.techs = ['P1'];
    g.credits = 1000;
    const ids = [0, 1, 2, 3].map((i) => placeNode(g, 'refiner', 300, 100 + i * 100)!.id);
    for (const id of [ids[2], ids[0], ids[3], ids[1]]) deleteNode(g, id);
    expect(g.credits).toBe(1000);
  });

  it('refunds upgrades in full, on the node and on its wires', () => {
    const g = rich();
    g.credits = 10000;
    const r = placeNode(g, 'refiner', 300, 100)!;
    const w = connect(g, well(g).id, 0, r.id)!;
    const spent = { speed0: upgradeCost(r, 'speed'), buffer0: upgradeCost(r, 'buffer') };
    upgrade(g, r.id, 'speed');
    const speed1 = upgradeCost(r, 'speed');
    upgrade(g, r.id, 'speed');
    upgrade(g, r.id, 'buffer');
    expect(upgradeValue(r)).toBe(spent.speed0 + speed1 + spent.buffer0);
    upgradeWire(g, w.id); // Mk II, 20¢
    expect(10000 - g.credits).toBe(50 + upgradeValue(r) + 20);
    expect(refundOf(g, r)).toBe(50 + upgradeValue(r) + 20);
    deleteNode(g, r.id);
    expect(g.credits).toBe(10000);
  });

  it('the free first Market refunds nothing; a second one refunds its price', () => {
    const g = fresh();
    g.credits = 1000;
    expect(refundOf(g, market(g))).toBe(0);
    const m2 = placeNode(g, 'market', 700, 500)!;
    expect(g.credits).toBe(850);
    expect(refundOf(g, m2)).toBe(150);
    expect(refundOf(g, market(g))).toBe(150); // whichever goes, one Market is left and the next costs 150
    deleteNode(g, market(g).id);
    expect(g.credits).toBe(1000);
    expect(refundOf(g, m2)).toBe(0);
  });

  it('undo and redo still restore credits exactly', () => {
    const g = fresh();
    g.techs = ['P1'];
    g.credits = 1000;
    const a = placeNode(g, 'refiner', 300, 100)!;
    placeNode(g, 'refiner', 300, 300)!;
    deleteNode(g, a.id); // +57, the price of a second Refiner
    expect(g.credits).toBe(1000 - 50);
    undo(g);
    expect(g.credits).toBe(1000 - 107);
    undo(g);
    undo(g);
    expect(g.credits).toBe(1000);
    redo(g);
    redo(g);
    redo(g);
    expect(g.credits).toBe(1000 - 50);
    expect(g.nodes.filter((n) => n.type === 'refiner').length).toBe(1);
  });
});

describe('the last Drill cannot be deleted (2.7)', () => {
  it('refuses with a toast, and allows it again once there is another Drill', () => {
    const g = fresh();
    const only = well(g);
    expect(canDelete(g, only)).toBe(false);
    expect(refundOf(g, only)).toBe(0);
    expect(deleteNode(g, only.id)).toBe(false);
    expect(g.nodes).toContain(only);
    expect(take(g, 'toast').length).toBe(1);
    expect(canUndo()).toBe(false); // a refusal is not an undo step

    g.credits = 100;
    const second = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    expect(canDelete(g, only)).toBe(true);
    expect(deleteNode(g, only.id)).toBe(true);
    expect(take(g, 'toast').length).toBe(0);
    expect(deleteNode(g, second.id)).toBe(false);
    expect(g.nodes.filter((n) => n.type === 'well').length).toBe(1);
  });
});

describe('splice (section 7, bug 5)', () => {
  it('a Market dropped on a wire becomes a branch: the wire keeps its destination', () => {
    const g = rich();
    const r = placeNode(g, 'refiner', 400, 100)!;
    const w = connect(g, well(g).id, 0, r.id)!;
    connect(g, r.id, 0, market(g).id);
    const m2 = placeNode(g, 'market', 300, 500)!;
    expect(splice(g, w.id, m2.id)).toBe(true);
    expect(g.wires.length).toBe(3);
    expect(wire(g, w.id)).toMatchObject({ from: well(g).id, port: 0, to: r.id });
    const branch = g.wires.find((x) => x.to === m2.id)!;
    expect(branch).toMatchObject({ from: well(g).id, port: 0, tier: 0 });
    run(g, 30);
    expect(r.util).toBeGreaterThan(0.9); // the machine is still fed first
    // Labs and Dumps branch the same way.
    const lab = placeNode(g, 'lab', 300, 600)!;
    const v = placeNode(g, 'void', 600, 600)!;
    expect(splice(g, w.id, lab.id)).toBe(true);
    expect(splice(g, w.id, v.id)).toBe(true);
    expect(g.wires.filter((x) => x.from === well(g).id).map((x) => x.to).sort()).toEqual([r.id, m2.id, lab.id, v.id].sort());
    undo(g);
    expect(g.wires.some((x) => x.to === v.id)).toBe(false);
  });

  it('a node inserted into an upgraded wire keeps the tier on both halves, and the refund is not duplicated', () => {
    const g = rich();
    g.credits = 1000;
    const w = connect(g, well(g).id, 0, market(g).id)!;
    expect(upgradeWire(g, w.id)).toBe(true); // Mk II for 20¢
    expect(g.credits).toBe(980);
    const merger = placeNode(g, 'merger', 250, 220)!;
    const afterBuy = g.credits;
    expect(splice(g, w.id, merger.id)).toBe(true);
    expect(g.credits).toBe(afterBuy);
    expect(g.wires.length).toBe(2);
    const a = g.wires.find((x) => x.to === merger.id)!;
    const b = g.wires.find((x) => x.from === merger.id)!;
    expect(a).toMatchObject({ from: well(g).id, port: 0, tier: 1 });
    expect(b).toMatchObject({ to: market(g).id, port: 0, tier: 1 });
    expect(a.paid + b.paid).toBe(20);
    cutWire(g, a.id);
    cutWire(g, b.id);
    expect(g.credits).toBe(afterBuy + 20);
  });

  it('refuses Drills and nodes that are already wired, and undoes in one step', () => {
    const g = rich();
    const w = connect(g, well(g).id, 0, market(g).id)!;
    const w2 = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    expect(splice(g, w.id, w2.id)).toBe(false);
    const r = placeNode(g, 'refiner', 250, 220)!;
    expect(splice(g, w.id, r.id)).toBe(true);
    expect(r.recipe).toBe('shard');
    expect(splice(g, g.wires[0].id, r.id)).toBe(false); // already wired
    undo(g);
    expect(g.wires.length).toBe(1);
    expect(g.wires[0]).toMatchObject({ id: w.id, from: well(g).id, to: market(g).id });
  });
});

describe('undo guards (section 7, bugs 1 and 6)', () => {
  it('refuses to undo when that would push credits below zero', () => {
    const g = fresh();
    g.techs = ['P1'];
    g.credits = 100;
    const r = placeNode(g, 'refiner', 300, 100)!;
    deleteNode(g, r.id);
    expect(g.credits).toBe(100);
    g.credits = 10; // the refund has been spent on something that cannot be undone
    expect(undo(g)).toBe(false);
    expect(g.credits).toBe(10);
    expect(g.nodes.some((n) => n.id === r.id)).toBe(false);
    expect(take(g, 'toast').length).toBe(1);
    expect(canUndo()).toBe(true); // the step is kept for later
    g.credits = 60;
    expect(undo(g)).toBe(true);
    expect(g.credits).toBe(10);
    expect(g.nodes.some((n) => n.id === r.id)).toBe(true);
  });

  it('accepts a move as a free undo step', () => {
    const g = fresh();
    const m = market(g);
    const before = snapshot(g);
    const x = m.x;
    m.x += 200;
    expect(pushUndo(g, before)).toBe(true);
    undo(g);
    expect(market(g).x).toBe(x);
  });

  it('drops a stale drag snapshot, so a node deleted mid-drag cannot come back for free', () => {
    const g = fresh();
    g.techs = ['P1'];
    g.credits = 100;
    const r = placeNode(g, 'refiner', 300, 100)!;
    expect(g.credits).toBe(50);
    const dragStart = snapshot(g); // pointer down on the Refiner
    deleteNode(g, r.id); // Delete pressed mid-drag: +50¢
    expect(g.credits).toBe(100);
    expect(pushUndo(g, dragStart)).toBe(false); // pointer up
    undo(g); // undoes the delete and takes the refund back
    expect(g.nodes.some((n) => n.id === r.id)).toBe(true);
    expect(g.credits).toBe(50);
    undo(g);
    expect(g.credits).toBe(100);
    expect(canUndo()).toBe(false);
  });
});

describe('Favour: the one-press Router preset', () => {
  /** A Drill feeding a Router that leads to a Lab and to the Market, still in Even mode. */
  function routed() {
    const g = rich();
    const router = placeNode(g, 'router', 400, 100)!;
    const lab = placeNode(g, 'lab', 700, 100)!;
    connect(g, well(g).id, 0, router.id);
    const toMarket = connect(g, router.id, 0, market(g).id)!;
    const toLab = connect(g, router.id, 0, lab.id)!;
    return { g, router, lab, toMarket, toLab };
  }

  it('puts the Router in Ratio mode, 3 : 1 toward the chosen wire, and the items follow', () => {
    const { g, router, toMarket, toLab } = routed();
    expect(router.mode).toBe('even');
    expect(favouredWire(g, router.id)).toBeNull();
    expect(canFavour(g, router.id, toLab.id)).toBe(true);
    expect(favour(g, router.id, toLab.id)).toBe(true);
    expect(router.mode).toBe('ratio');
    expect([wire(g, toLab.id).weight, wire(g, toMarket.id).weight]).toEqual([RULES.router.favour, RULES.router.rest]);
    expect([RULES.router.favour, RULES.router.rest]).toEqual([3, 1]);
    expect(favouredWire(g, router.id)).toBe(toLab.id);
    run(g, 40);
    expect(wire(g, toLab.id).rate).toBeCloseTo(0.75, 1);
    expect(wire(g, toMarket.id).rate).toBeCloseTo(0.25, 1);
    // Pressing it again changes nothing and is refused; the other wire can be favoured instead.
    expect(canFavour(g, router.id, toLab.id)).toBe(false);
    expect(favour(g, router.id, toLab.id)).toBe(false);
    expect(canFavour(g, router.id, toMarket.id)).toBe(true);
    expect(favour(g, router.id, toMarket.id)).toBe(true);
    expect(favouredWire(g, router.id)).toBe(toMarket.id);
    expect([wire(g, toLab.id).weight, wire(g, toMarket.id).weight]).toEqual([1, 3]);
  });

  it('is one undo step, whatever mode and weights the Router had', () => {
    const { g, router, toMarket, toLab } = routed();
    setMode(g, router.id, 'priority');
    setWeight(g, toMarket.id, 7);
    setWeight(g, toLab.id, 2);
    expect(favouredWire(g, router.id)).toBe(toMarket.id); // Priority favours its first wire
    clearHistory();
    expect(favour(g, router.id, toLab.id)).toBe(true);
    expect(canUndo()).toBe(true);
    expect(undo(g)).toBe(true);
    expect(canUndo()).toBe(false); // one step, not three
    expect(g.nodes.find((n) => n.id === router.id)!.mode).toBe('priority');
    expect([wire(g, toMarket.id).weight, wire(g, toLab.id).weight]).toEqual([7, 2]);
    expect(redo(g)).toBe(true);
    expect(g.nodes.find((n) => n.id === router.id)!.mode).toBe('ratio');
    expect([wire(g, toMarket.id).weight, wire(g, toLab.id).weight]).toEqual([1, 3]);
    expect(g.credits).toBe(1e9 - 25 - 100); // free: only the Router and the Lab were paid for
  });

  it('with three wires the chosen one gets 3 and each of the others 1', () => {
    const { g, router, toMarket, toLab } = routed();
    const third = connect(g, router.id, 0, placeNode(g, 'void', 700, 400)!.id)!;
    expect(favour(g, router.id, third.id)).toBe(true);
    expect([toMarket, toLab, third].map((w) => wire(g, w.id).weight)).toEqual([1, 1, 3]);
    expect(favouredWire(g, router.id)).toBe(third.id);
    // Equal weights favour nobody.
    setWeight(g, third.id, 1);
    expect(favouredWire(g, router.id)).toBeNull();
    expect(canFavour(g, router.id, third.id)).toBe(true);
  });

  it('refuses anything that is not a wire leaving a Router with a choice to make', () => {
    const { g, router, lab, toLab } = routed();
    const feed = g.wires.find((w) => w.to === router.id)!;
    expect(canFavour(g, router.id, feed.id)).toBe(false); // the wire into the Router
    expect(favour(g, router.id, feed.id)).toBe(false);
    expect(canFavour(g, lab.id, toLab.id)).toBe(false); // not a Router
    expect(canFavour(g, well(g).id, feed.id)).toBe(false);
    expect(canFavour(g, 99999, toLab.id)).toBe(false);
    expect(favouredWire(g, lab.id)).toBeNull();
    // A Router with a single wire has nothing to favour it over.
    const lone = placeNode(g, 'router', 400, 400)!;
    const only = connect(g, lone.id, 0, market(g).id)!;
    expect(canFavour(g, lone.id, only.id)).toBe(false);
    expect(favour(g, lone.id, only.id)).toBe(false);
    expect(favouredWire(g, lone.id)).toBeNull();
    expect(router.mode).toBe('even'); // none of that touched anything
  });

  it('is what goal 13 asks for: one press on the Lab\'s wire completes "Route more to a Lab than to the Market"', () => {
    const { g, router, toLab, toMarket } = routed();
    g.goal = { i: GOALS.findIndex((x) => x.id === 'route-lab'), ready: false };
    run(g, 1);
    expect(routerFavoursLab(g)).toBe(false);
    expect(favour(g, router.id, toMarket.id)).toBe(true); // the wrong wire does not count
    run(g, 0.1);
    expect(g.goal.ready).toBe(false);
    expect(favour(g, router.id, toLab.id)).toBe(true);
    // (Done once the Router's own wires show more going to the Lab: their rates take a few seconds to settle.)
    run(g, 8);
    expect(g.goal.ready).toBe(true);
    const hint = goalById('route-lab')!.hint;
    expect(hint.mouse).toContain('press Favour on the Lab\'s wire');
    expect(hint.touch).toContain('tap Favour on the Lab\'s wire');
    expect(hint.mouse).not.toMatch(/ratio/i);
  });
});

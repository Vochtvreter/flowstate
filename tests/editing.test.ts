import { describe, expect, it } from 'vitest';
import {
  canDelete, canUndo, connect, cutWire, deleteNode, placeNode, pushUndo, redo, refundOf, splice, undo, upgrade, upgradeWire,
} from '../src/actions';
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

describe('the last Well cannot be deleted (2.7)', () => {
  it('refuses with a toast, and allows it again once there is another Well', () => {
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
    // Labs and Voids branch the same way.
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

  it('refuses Wells and nodes that are already wired, and undoes in one step', () => {
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

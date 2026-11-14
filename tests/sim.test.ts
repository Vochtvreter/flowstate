import { describe, expect, it } from 'vitest';
import { connect, cutWire, deleteNode, placeNode, redo, setMode, setWeight, undo, upgrade } from '../src/actions';
import { nodeCost, price, research, techAvailable } from '../src/economy';
import { TECHS } from '../src/content';
import { deserialize, serialize } from '../src/state';
import { fresh as newGame, market, rich, run, well } from './helpers';

describe('simulation', () => {
  it('a well wired to a market earns a clean 1¢ per second', () => {
    const g = newGame();
    connect(g, well(g).id, 0, market(g).id);
    run(g, 60);
    // 1 glint/s is under the demand of 2/s, so every item sells at full price
    expect(price(g, 'glint')).toBeCloseTo(1, 5);
    expect(g.credits).toBeGreaterThan(59);
    expect(g.credits).toBeLessThanOrEqual(60.001);
    expect(g.wires[0].rate).toBeCloseTo(1, 1);
  });

  it('never grants Refining by itself: it is a goal reward and cannot be bought', () => {
    const g = newGame();
    connect(g, well(g).id, 0, market(g).id);
    run(g, 120);
    expect(g.lifetime).toBeGreaterThan(50);
    expect(g.techs).not.toContain('P1');
    g.data = { a: 1e6, b: 1e6, g: 1e6 };
    for (const id of ['P1', 'R1', 'L1', 'C1']) {
      expect(techAvailable(g, TECHS[id])).toBe(false);
      expect(research(g, id)).toBe(false);
    }
  });

  it('refiner converts 2 glint into 1 shard and reports starvation', () => {
    const g = rich();
    const r = placeNode(g, 'refiner', 300, 100)!;
    connect(g, well(g).id, 0, r.id);
    expect(r.recipe).toBe('shard'); // auto-recipe
    connect(g, r.id, 0, market(g).id);
    run(g, 60);
    // needs 1 glint/s, gets 1 glint/s: full utilisation, 0.5 shard/s
    expect(r.rate).toBeCloseTo(0.5, 1);
    expect(r.status).toBe('working');
    upgrade(g, r.id, 'speed');
    upgrade(g, r.id, 'speed');
    upgrade(g, r.id, 'speed');
    run(g, 60);
    expect(r.status).toBe('starved');
    expect(r.missing).toBe('glint');
  });

  it('backpressure blocks a machine whose byproduct has nowhere to go', () => {
    const g = rich();
    const w = placeNode(g, 'well', 0, 0, { depositId: 3 })!; // murk
    const r = placeNode(g, 'refiner', 300, 400)!;
    connect(g, w.id, 0, r.id);
    expect(r.recipe).toBe('ink');
    connect(g, r.id, 0, market(g).id); // ink only; silt port (1) left open
    run(g, 60);
    expect(r.status).toBe('blocked');
    expect(r.blockedOn).toBe('silt');
    expect(w.status).toBe('blocked');
    const v = placeNode(g, 'void', 500, 500)!;
    connect(g, r.id, 1, v.id);
    run(g, 60);
    expect(r.status).toBe('working');
  });

  it('fan-out splits evenly and skips blocked outputs', () => {
    const g = rich();
    const m2 = placeNode(g, 'market', 600, 400)!;
    connect(g, well(g).id, 0, market(g).id);
    connect(g, well(g).id, 0, m2.id);
    run(g, 30);
    expect(g.wires[0].rate).toBeCloseTo(0.5, 1);
    expect(g.wires[1].rate).toBeCloseTo(0.5, 1);
    // Replace one market with an unconfigured machine: everything goes to the other.
    const dead = placeNode(g, 'assembler', 600, 600)!;
    cutWire(g, g.wires[1].id);
    connect(g, well(g).id, 0, dead.id);
    run(g, 30);
    expect(g.wires[0].rate).toBeCloseTo(1, 1);
  });

  it('router ratio and priority modes', () => {
    const g = rich();
    const r = placeNode(g, 'router', 300, 100)!;
    const m2 = placeNode(g, 'market', 600, 400)!;
    connect(g, well(g).id, 0, r.id);
    const a = connect(g, r.id, 0, market(g).id)!;
    const b = connect(g, r.id, 0, m2.id)!;
    setMode(g, r.id, 'ratio');
    setWeight(g, a.id, 3);
    run(g, 40);
    const wa = g.wires.find((w) => w.id === a.id)!;
    const wb = g.wires.find((w) => w.id === b.id)!;
    expect(wa.rate / wb.rate).toBeCloseTo(3, 0);
    setMode(g, r.id, 'priority');
    run(g, 40);
    expect(g.wires.find((w) => w.id === a.id)!.rate).toBeCloseTo(1, 1);
    expect(g.wires.find((w) => w.id === b.id)!.rate).toBeLessThan(0.05);
  });

  it('lab turns items into data', () => {
    const g = rich();
    const lab = placeNode(g, 'lab', 300, 100)!;
    connect(g, well(g).id, 0, lab.id);
    run(g, 20);
    expect(g.data.a).toBeGreaterThan(15);
    expect(g.data.a).toBeLessThan(21);
  });

  it('a mixed stream through a merger feeds a two-input assembler, and T2 items give β', () => {
    const g = rich();
    const murk = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    const ember = placeNode(g, 'well', 0, 0, { depositId: 4 })!;
    const ink = placeNode(g, 'refiner', 300, 300)!;
    const spark = placeNode(g, 'refiner', 300, 500)!;
    connect(g, murk.id, 0, ink.id);
    connect(g, ember.id, 0, spark.id);
    expect(ink.recipe).toBe('ink');
    expect(spark.recipe).toBe('spark');
    const merger = placeNode(g, 'merger', 500, 400)!;
    connect(g, ink.id, 0, merger.id);
    connect(g, spark.id, 0, merger.id);
    connect(g, ink.id, 1, placeNode(g, 'void', 500, 600)!.id); // silt
    const asm = placeNode(g, 'assembler', 700, 400)!;
    connect(g, merger.id, 0, asm.id);
    expect(asm.recipe).toBe('glyph');
    const lab = placeNode(g, 'lab', 900, 400)!;
    connect(g, asm.id, 0, lab.id);
    run(g, 120);
    expect(g.made.glyph).toBe(true);
    expect(asm.rate).toBeGreaterThan(0.2);
    expect(g.data.b).toBeGreaterThan(50);
  });

  it('wire capacity limits flow', () => {
    const g = rich();
    for (let i = 0; i < 8; i++) upgrade(g, well(g).id, 'speed'); // ~6/s
    connect(g, well(g).id, 0, market(g).id);
    run(g, 30);
    expect(g.wires[0].rate).toBeCloseTo(4, 1); // Mk I cap
  });
});

describe('editing', () => {
  it('delete refunds in full and undo/redo restore credits', () => {
    const g = newGame();
    g.credits = 100;
    g.techs = ['P1'];
    const cost = nodeCost(g, 'refiner');
    const r = placeNode(g, 'refiner', 300, 100)!;
    expect(g.credits).toBe(100 - cost);
    upgrade(g, r.id, 'speed');
    const afterUpgrade = g.credits;
    deleteNode(g, r.id);
    expect(g.credits).toBe(100);
    undo(g);
    expect(g.credits).toBe(afterUpgrade);
    expect(g.nodes.some((n) => n.id === r.id)).toBe(true);
    undo(g);
    undo(g);
    expect(g.credits).toBe(100);
    expect(g.nodes.some((n) => n.id === r.id)).toBe(false);
    redo(g);
    expect(g.credits).toBe(100 - cost);
  });

  it('wells need a free deposit', () => {
    const g = newGame();
    g.credits = 100;
    expect(placeNode(g, 'well', 0, 0, { depositId: 1 })).toBeNull(); // occupied
    expect(placeNode(g, 'well', 0, 0, { depositId: 3 })).toBeNull(); // murk locked
    expect(placeNode(g, 'well', 0, 0, { depositId: 2 })).not.toBeNull();
  });

  it('save round-trips', () => {
    const g = newGame();
    connect(g, well(g).id, 0, market(g).id);
    run(g, 10);
    const g2 = deserialize(serialize(g))!;
    expect(g2.nodes.length).toBe(g.nodes.length);
    expect(g2.wires.length).toBe(1);
    expect(g2.credits).toBe(g.credits);
    expect(g2.goal).toEqual(g.goal);
    expect(g2.stats).toEqual(g.stats);
  });
});

import { describe, expect, it } from 'vitest';
import { connect, cutWire, deleteNode, placeNode, redo, setMode, setWeight, undo, upgrade } from '../src/actions';
import { nodeCost, price } from '../src/economy';
import { offlineGains, tick } from '../src/sim';
import { Game, deserialize, newGame, serialize } from '../src/state';

function run(g: Game, seconds: number, dt = 0.05) {
  for (let t = 0; t < seconds; t += dt) tick(g, dt);
}

function rich(): Game {
  const g = newGame();
  g.credits = 1e9;
  g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'P5', 'L1', 'L4', 'L6', 'L2', 'L5'];
  return g;
}

const well = (g: Game) => g.nodes.find((n) => n.type === 'well')!;
const market = (g: Game) => g.nodes.find((n) => n.type === 'market')!;

describe('simulation', () => {
  it('a well wired to a market earns credits with saturation', () => {
    const g = newGame();
    connect(g, well(g).id, 0, market(g).id);
    run(g, 60);
    // 1 glint/s, demand 2/s => price settles near 0.667
    expect(price(g, 'glint')).toBeCloseTo(2 / 3, 1);
    expect(g.credits).toBeGreaterThan(35);
    expect(g.credits).toBeLessThan(60);
    expect(g.wires[0].rate).toBeCloseTo(1, 1);
  });

  it('grants Refining after 50 lifetime credits', () => {
    const g = newGame();
    connect(g, well(g).id, 0, market(g).id);
    run(g, 120);
    expect(g.techs).toContain('P1');
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
    for (let i = 0; i < 6; i++) upgrade(g, well(g).id, 'speed'); // ~3.8/s
    connect(g, well(g).id, 0, market(g).id);
    run(g, 30);
    expect(g.wires[0].rate).toBeCloseTo(2, 1); // Mk I cap
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

  it('save round-trips and offline gains scale with time', () => {
    const g = newGame();
    connect(g, well(g).id, 0, market(g).id);
    run(g, 10);
    const g2 = deserialize(serialize(g))!;
    expect(g2.nodes.length).toBe(g.nodes.length);
    expect(g2.wires.length).toBe(1);
    const before = g2.credits;
    const gains = offlineGains(g2, 3600);
    expect(gains.credits).toBeGreaterThan(2000);
    expect(gains.credits).toBeLessThan(2800);
    expect(g2.credits).toBeCloseTo(before + gains.credits, 3);
  });
});

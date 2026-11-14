import { describe, expect, it } from 'vitest';
import { connect, cutWire, deleteNode, placeNode, redo, setMode, setWeight, undo, upgrade } from '../src/actions';
import { nodeCost, price, research, techAvailable } from '../src/economy';
import { TECHS } from '../src/content';
import { tick } from '../src/sim';
import { Game, deserialize, serialize } from '../src/state';
import { fresh as newGame, market, rich, run, well, wire } from './helpers';

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

describe('wire rates are steady when a machine takes its inputs in gulps', () => {
  /** Run for `seconds`; for each wire return the true throughput, the lowest and highest rate shown, and how far a plain moving average of the flow swings. */
  function watch(g: Game, seconds: number, ids: number[], dt = 0.05) {
    const out = ids.map(() => ({ real: 0, lo: Infinity, hi: -Infinity, naiveLo: Infinity, naiveHi: -Infinity }));
    const naive = ids.map((id) => g.wires.find((w) => w.id === id)!.rate);
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      tick(g, dt);
      ids.forEach((id, k) => {
        const w = g.wires.find((x) => x.id === id)!;
        const o = out[k];
        o.real += w.flow / (steps * dt);
        o.lo = Math.min(o.lo, w.rate);
        o.hi = Math.max(o.hi, w.rate);
        naive[k] += (w.flow / dt - naive[k]) * (1 - Math.exp(-dt / 1.5)); // how the rate used to be measured
        o.naiveLo = Math.min(o.naiveLo, naive[k]);
        o.naiveHi = Math.max(o.naiveHi, naive[k]);
      });
    }
    return out;
  }

  it('a Refiner that is kept full takes two Glint every two seconds: its wire reads a flat 1.0/s, the leftover wire 0.25/s', () => {
    const g = rich();
    upgrade(g, well(g).id, 'speed'); // 1.25 Glint/s, the Refiner takes 1
    const r = placeNode(g, 'refiner', 400, 100)!;
    const feed = connect(g, well(g).id, 0, r.id)!;
    const sell = connect(g, well(g).id, 0, market(g).id)!;
    const out = connect(g, r.id, 0, market(g).id)!; // one whole Shard every two seconds
    run(g, 30);
    const [toRefiner, toMarket, shard] = watch(g, 120, [feed.id, sell.id, out.id]);
    // The flow really does come in gulps: measured the old way these numbers swing by a quarter and more.
    expect(toRefiner.naiveHi - toRefiner.naiveLo).toBeGreaterThan(0.2);
    expect((toMarket.naiveHi - toMarket.naiveLo) / 0.25).toBeGreaterThan(0.5);
    expect((shard.naiveHi - shard.naiveLo) / 0.5).toBeGreaterThan(0.5);
    // The long-run value is exact...
    expect(toRefiner.real).toBeCloseTo(1, 6);
    expect(toMarket.real).toBeCloseTo(0.25, 6);
    expect(shard.real).toBeCloseTo(0.5, 6);
    // ...and what is shown sits on it, without moving.
    for (const [w, real] of [[toRefiner, 1], [toMarket, 0.25], [shard, 0.5]] as const) {
      expect(w.lo).toBeCloseTo(real, 4);
      expect(w.hi).toBeCloseTo(real, 4);
    }
  });

  it('a pattern of uneven gulps is exact too: Ink shared by an Assembler and the Market', () => {
    // One Ink every 2 s; the Assembler takes one every 3 s, so it is handed Ink after 4 s, 2 s, 4 s, 2 s...
    // and Spark (one every 2.5 s) after 2.5, 2.5, 2.5, 2.5 and 5 s.
    const g = rich();
    const m = market(g);
    const ink = placeNode(g, 'refiner', 400, 400)!;
    const spark = placeNode(g, 'refiner', 400, 540)!;
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 3 })!.id, 0, ink.id);
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 4 })!.id, 0, spark.id);
    connect(g, ink.id, 1, placeNode(g, 'void', 700, 650)!.id);
    const glyph = placeNode(g, 'assembler', 700, 450, { recipe: 'glyph' })!;
    const ids = [
      connect(g, ink.id, 0, glyph.id)!.id, connect(g, ink.id, 0, m.id)!.id,
      connect(g, spark.id, 0, glyph.id)!.id, connect(g, spark.id, 0, m.id)!.id,
      connect(g, glyph.id, 0, m.id)!.id,
    ];
    run(g, 90);
    const seen = watch(g, 120, ids);
    const real = [1 / 3, 1 / 6, 1 / 3, 1 / 15, 1 / 3];
    seen.forEach((w, i) => {
      expect(w.real).toBeCloseTo(real[i], 6);
      expect(w.lo).toBeCloseTo(real[i], 3);
      expect(w.hi).toBeCloseTo(real[i], 3);
    });
    expect(seen[0].naiveHi - seen[0].naiveLo).toBeGreaterThan(0.2); // 0.33/s used to read anywhere from 0.2 to 0.5
  });

  it('a long round is exact too: with Efficiency a machine skips its inputs on every fifth or sixth craft', () => {
    // The Glyph line again, with Efficiency on the Assembler and on the Ink Refiner: the Assembler now asks
    // for Ink on four crafts out of five, and a round of the pattern on the Ink wire is eight gulps and 30 s.
    const g = rich();
    g.techs.push('U1');
    const m = market(g);
    const ink = placeNode(g, 'refiner', 400, 400)!;
    const spark = placeNode(g, 'refiner', 400, 540)!;
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 3 })!.id, 0, ink.id);
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 4 })!.id, 0, spark.id);
    connect(g, ink.id, 1, placeNode(g, 'void', 700, 650)!.id);
    const glyph = placeNode(g, 'assembler', 700, 450, { recipe: 'glyph' })!;
    const ids = [connect(g, ink.id, 0, glyph.id)!.id, connect(g, ink.id, 0, m.id)!.id, connect(g, spark.id, 0, glyph.id)!.id, connect(g, glyph.id, 0, m.id)!.id];
    connect(g, spark.id, 0, m.id);
    upgrade(g, glyph.id, 'eff');
    upgrade(g, glyph.id, 'eff');
    upgrade(g, ink.id, 'eff');
    run(g, 180);
    const seen = watch(g, 600, ids);
    const real = [4 / 15, 0.5 - 4 / 15, 4 / 15, 1 / 3];
    seen.forEach((w, i) => {
      expect(w.real, `wire ${i}`).toBeCloseTo(real[i], 3);
      expect(w.lo, `wire ${i}`).toBeGreaterThan(real[i] * 0.98);
      expect(w.hi, `wire ${i}`).toBeLessThan(real[i] * 1.02);
    });
    expect((seen[0].naiveHi - seen[0].naiveLo) / real[0]).toBeGreaterThan(0.5);
  });

  it('a run of equal gulps and then an odd one is one round, not a pattern of one: a Router topping up a full Silo', () => {
    // The Refiner takes two Glint from the Silo every 2 s; the Router refills that in six short gulps and a
    // longer one. Six equal gulps in a row used to be read as the whole pattern, 22% high, once every round.
    const g = rich();
    for (let i = 0; i < 4; i++) upgrade(g, well(g).id, 'speed'); // 2.44 Glint/s
    const router = placeNode(g, 'router', 300, 100)!;
    const silo = placeNode(g, 'silo', 450, 100)!;
    const r = placeNode(g, 'refiner', 600, 100, { recipe: 'shard' })!;
    connect(g, well(g).id, 0, router.id);
    const fill = connect(g, router.id, 0, silo.id)!;
    const sell = connect(g, router.id, 0, market(g).id)!;
    connect(g, silo.id, 0, r.id);
    connect(g, r.id, 0, market(g).id);
    silo.inb.glint = 199; // as good as full
    run(g, 60);
    const [toSilo, toMarket] = watch(g, 300, [fill.id, sell.id]);
    expect(toSilo.real).toBeCloseTo(1, 3);
    expect(toSilo.lo).toBeGreaterThan(0.98);
    expect(toSilo.hi).toBeLessThan(1.02);
    expect(toMarket.lo).toBeGreaterThan(toMarket.real * 0.98);
    expect(toMarket.hi).toBeLessThan(toMarket.real * 1.02);
  });

  it('still follows a change within seconds: starting, speeding up, stopping', () => {
    const g = rich();
    upgrade(g, well(g).id, 'speed');
    const r = placeNode(g, 'refiner', 400, 100)!;
    const feed = connect(g, well(g).id, 0, r.id)!;
    connect(g, well(g).id, 0, market(g).id);
    const out = connect(g, r.id, 0, market(g).id)!;
    run(g, 6);
    expect(wire(g, feed.id).rate).toBeGreaterThan(0.8); // already close after a few seconds
    run(g, 24);
    expect(wire(g, feed.id).rate).toBeCloseTo(1, 3);
    // Two Speed levels on the Refiner: it can take 1.38/s now, so it gets all 1.25 the Well makes, steadily.
    upgrade(g, r.id, 'speed');
    upgrade(g, r.id, 'speed');
    run(g, 10);
    expect(wire(g, feed.id).rate).toBeCloseTo(1.25, 2);
    expect(wire(g, out.id).rate).toBeGreaterThan(0.6); // it works through what its buffer held first, a little faster
    run(g, 30);
    expect(wire(g, out.id).rate).toBeCloseTo(0.625, 3);
    // Cut the Shard wire: the Refiner fills up and stops taking Glint. The reading falls away instead of sticking.
    cutWire(g, out.id);
    run(g, 20);
    expect(wire(g, feed.id).rate).toBeLessThan(0.02);
  });

  it('steady flow is measured as before, and a wire at capacity still reads its capacity', () => {
    const g = rich();
    for (let i = 0; i < 8; i++) upgrade(g, well(g).id, 'speed'); // 5.96 Glint/s into a Mk I wire
    const direct = connect(g, well(g).id, 0, market(g).id)!;
    run(g, 20);
    expect(wire(g, direct.id).rate).toBeCloseTo(4, 3);
    expect(wire(g, direct.id).rate).toBeGreaterThanOrEqual(4 * 0.97); // what "Upgrade saturated wires" looks for
    expect(wire(g, direct.id).gulp!.past.length).toBe(0); // no pauses, so no gulps
  });

  it('is display only: scrambling every wire\'s reading changes nothing else', () => {
    const build = () => {
      const g = rich();
      g.credits = 5000;
      upgrade(g, well(g).id, 'speed');
      const r = placeNode(g, 'refiner', 400, 100)!;
      const lab = placeNode(g, 'lab', 700, 300)!;
      connect(g, well(g).id, 0, r.id);
      connect(g, well(g).id, 0, market(g).id);
      connect(g, r.id, 0, market(g).id);
      connect(g, r.id, 0, lab.id);
      return g;
    };
    const a = build();
    const b = build();
    for (let i = 0; i < 1200; i++) {
      tick(a, 0.05);
      tick(b, 0.05);
      for (const w of b.wires) {
        w.rate = (i * 7919) % 13;
        delete w.gulp;
      }
    }
    expect(b.credits).toBe(a.credits);
    expect(b.data).toEqual(a.data);
    expect(b.sold).toEqual(a.sold);
    expect(b.nodes.map((n) => [n.util, n.rate, n.inb, n.outb])).toEqual(a.nodes.map((n) => [n.util, n.rate, n.inb, n.outb]));
  });

  it('the measurement survives a save, so a reloaded game shows the same numbers', () => {
    const g = rich();
    upgrade(g, well(g).id, 'speed');
    const r = placeNode(g, 'refiner', 400, 100)!;
    const feed = connect(g, well(g).id, 0, r.id)!;
    connect(g, well(g).id, 0, market(g).id);
    connect(g, r.id, 0, market(g).id);
    run(g, 31.3);
    const copy = deserialize(serialize(g))!;
    expect(wire(copy, feed.id).gulp).toEqual(wire(g, feed.id).gulp);
    run(g, 10);
    run(copy, 10);
    expect(wire(copy, feed.id).rate).toBeCloseTo(wire(g, feed.id).rate, 9);
    // A wire from a save made before this existed just starts measuring afresh.
    const old = JSON.parse(serialize(g));
    for (const w of old.wires) delete w.gulp;
    const loaded = deserialize(JSON.stringify(old))!;
    run(loaded, 10);
    expect(wire(loaded, feed.id).rate).toBeCloseTo(1, 2);
  });
});

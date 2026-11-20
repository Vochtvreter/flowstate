// The ledger (src/flows.ts): how much of each material is made, where it goes, and where it falls short.
import { describe, expect, it } from 'vitest';
import { connect, placeNode, upgrade } from '../src/actions';
import { MAT_IDS, MATERIALS } from '../src/content';
import { MatFlow, flows, traceOf } from '../src/flows';
import { lineFrom } from '../src/graph';
import { Game } from '../src/state';
import { market, rich, run, well } from './helpers';
import { playByTheCard } from './cardPlayer';

const of = (g: Game, mat: string): MatFlow => flows(g).find((r) => r.mat === mat)!;

describe('the ledger: a row for each material on the board', () => {
  it('the opening board: one row, Sand, stuck with no exit; wired to the Market it is all sold', () => {
    const g = rich();
    run(g, 12);
    expect(flows(g).map((r) => r.mat)).toEqual(['glint']);
    expect(of(g, 'glint')).toMatchObject({ state: 'stuck', at: well(g).id, makers: [well(g).id], users: [] });
    expect(of(g, 'glint').can).toBeCloseTo(1, 5);
    connect(g, well(g).id, 0, market(g).id);
    run(g, 20);
    const sand = of(g, 'glint');
    expect(sand).toMatchObject({ state: 'ok', at: null });
    expect(sand.made).toBeCloseTo(1, 1);
    expect(sand.sold).toBeCloseTo(1, 1);
    expect(sand.used + sand.studied + sand.dumped).toBe(0);
  });

  it('rows come in the order of the recipes, one for everything made or used, and no other', () => {
    const g = rich();
    const refiner = placeNode(g, 'refiner', 400, 120)!;
    connect(g, well(g).id, 0, refiner.id);
    connect(g, refiner.id, 0, market(g).id);
    run(g, 20);
    expect(flows(g).map((r) => MATERIALS[r.mat].name)).toEqual(['Sand', 'Glass']);
    // An Assembler set by hand to Circuit uses Plastic and Copper that nothing makes: both rows appear, short of a maker.
    const a = placeNode(g, 'assembler', 700, 400)!;
    a.recipe = 'glyph';
    g.rev++;
    run(g, 20);
    expect(flows(g).map((r) => MATERIALS[r.mat].name)).toEqual(['Sand', 'Glass', 'Plastic', 'Copper', 'Circuit']);
    const order = flows(g).map((r) => MAT_IDS.indexOf(r.mat));
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('what is made is accounted for: to machines, sold, studied', () => {
    const g = rich();
    const refiner = placeNode(g, 'refiner', 400, 120)!;
    const lab = placeNode(g, 'lab', 700, 120)!;
    connect(g, well(g).id, 0, refiner.id);
    connect(g, well(g).id, 0, market(g).id);
    connect(g, refiner.id, 0, lab.id);
    upgrade(g, well(g).id, 'speed');
    run(g, 60);
    const sand = of(g, 'glint'), glass = of(g, 'shard');
    // The Drill gives 1.25 a second: the Refiner takes its 1 (machines are fed first), the Market the rest.
    expect(sand.can).toBeCloseTo(1.25, 5);
    expect(sand.made).toBeCloseTo(1.25, 1);
    expect(sand.wanted).toBeCloseTo(1, 5);
    expect(sand.used).toBeCloseTo(1, 1);
    expect(sand.sold).toBeCloseTo(0.25, 1);
    expect(sand.state).toBe('ok');
    expect(glass.made).toBeCloseTo(0.5, 1);
    expect(glass.studied).toBeCloseTo(0.5, 1);
    expect(glass.sold).toBe(0);
    expect(glass.state).toBe('ok');
    // Nothing is counted twice: what leaves a row is what was made of it.
    for (const r of flows(g)) expect(r.used + r.sold + r.studied + r.dumped).toBeCloseTo(r.made, 1);
  });

  it('short: two Refiners on one Drill want twice what it gives, and the row points at the Drill', () => {
    const g = rich();
    const a = placeNode(g, 'refiner', 400, 100)!;
    const b = placeNode(g, 'refiner', 400, 240)!;
    for (const r of [a, b]) {
      connect(g, well(g).id, 0, r.id);
      connect(g, r.id, 0, market(g).id);
    }
    run(g, 60);
    const sand = of(g, 'glint');
    expect(sand.state).toBe('short');
    expect(sand.at).toBe(well(g).id);
    expect(sand.wanted).toBeCloseTo(2, 5);
    expect(sand.used).toBeCloseTo(1, 1);
    expect(sand.users.sort()).toEqual([a.id, b.id].sort());
    expect(of(g, 'shard').state).toBe('ok');
    // Speed on the Drill until it gives more than the two a second they want: no longer short, and some to spare.
    for (let i = 0; i < 4; i++) upgrade(g, well(g).id, 'speed');
    run(g, 60);
    expect(of(g, 'glint')).toMatchObject({ state: 'spare', at: null });
    expect(of(g, 'glint').used).toBeCloseTo(2, 1);
  });

  it('short of something nothing makes: the row points at the machine that waits', () => {
    const g = rich();
    const oil = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    const plastic = placeNode(g, 'refiner', 400, 400)!;
    connect(g, oil.id, 0, plastic.id);
    connect(g, plastic.id, 1, placeNode(g, 'void', 600, 600)!.id);
    const a = placeNode(g, 'assembler', 700, 400)!;
    connect(g, plastic.id, 0, a.id);
    connect(g, a.id, 0, market(g).id);
    run(g, 40);
    expect(of(g, 'spark')).toMatchObject({ state: 'short', at: a.id, makers: [], made: 0 });
    // The Tar goes to the Dump, all of it.
    expect(of(g, 'silt').dumped).toBeCloseTo(of(g, 'silt').made, 1);
    expect(of(g, 'silt').state).toBe('ok');
  });

  it('stuck comes before spare, and spare is no fault: a Drill ahead of its Lab', () => {
    const g = rich();
    const lab = placeNode(g, 'lab', 500, 120)!;
    connect(g, well(g).id, 0, lab.id);
    for (let i = 0; i < 3; i++) upgrade(g, well(g).id, 'speed');
    run(g, 40);
    expect(of(g, 'glint')).toMatchObject({ state: 'spare', at: null });
    expect(of(g, 'glint').studied).toBeCloseTo(1, 1);
    expect(of(g, 'glint').can).toBeGreaterThan(1.9);
  });

  it('a whole demo, played by the card: every material from Sand to the Phone has its row, and nothing made is unaccounted for', () => {
    const { g } = playByTheCard();
    run(g, 30);
    const rows = flows(g);
    expect(rows.map((r) => MATERIALS[r.mat].name)).toEqual(['Sand', 'Oil', 'Ore', 'Quartz', 'Glass', 'Plastic', 'Tar', 'Copper', 'Silicon', 'Screen', 'Circuit', 'Phone']);
    for (const r of rows) {
      expect(r.makers.length, r.mat).toBeGreaterThan(0);
      expect(r.made, r.mat).toBeLessThanOrEqual(r.can * 1.05 + 0.01);
      // (Buffers fill and drain, and a Lab or a Market reads a little late: within a fifth, or a twentieth of an item a second.)
      const gone = r.used + r.sold + r.studied + r.dumped;
      expect(Math.abs(gone - r.made), `${r.mat}: made ${r.made.toFixed(2)}, gone ${gone.toFixed(2)}`).toBeLessThanOrEqual(Math.max(0.05, r.made * 0.2));
    }
  });
});

describe('tracing a material on the board', () => {
  it('its makers, the machines that use it, the wires that carry it and where those end, through a Router too', () => {
    const g = rich();
    const refiner = placeNode(g, 'refiner', 400, 120)!;
    const router = placeNode(g, 'router', 640, 120)!;
    const lab = placeNode(g, 'lab', 860, 60)!;
    const w1 = connect(g, well(g).id, 0, refiner.id)!;
    const w2 = connect(g, well(g).id, 0, market(g).id)!;
    const w3 = connect(g, refiner.id, 0, router.id)!;
    const w4 = connect(g, router.id, 0, lab.id)!;
    const w5 = connect(g, router.id, 0, market(g).id)!;
    run(g, 5);
    const sand = traceOf(g, 'glint');
    expect([...sand.nodes].sort()).toEqual([well(g).id, refiner.id, market(g).id].sort());
    expect([...sand.wires].sort()).toEqual([w1.id, w2.id].sort());
    const glass = traceOf(g, 'shard');
    expect([...glass.nodes].sort()).toEqual([refiner.id, router.id, lab.id, market(g).id].sort());
    expect([...glass.wires].sort()).toEqual([w3.id, w4.id, w5.id].sort());
    // Nothing on this board has to do with Copper.
    expect(traceOf(g, 'spark').nodes.size + traceOf(g, 'spark').wires.size).toBe(0);
  });
});

describe('a card\'s line, for moving it as one block', () => {
  it('the card and everything it feeds; never a Drill, and not the Market that other lines sell at too', () => {
    const g = rich();
    const sand = well(g);
    const glass = placeNode(g, 'refiner', 400, 120)!;
    const lab = placeNode(g, 'lab', 700, 120)!;
    const oil = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    const plastic = placeNode(g, 'refiner', 400, 400)!;
    const dump = placeNode(g, 'void', 640, 520)!;
    connect(g, sand.id, 0, glass.id);
    connect(g, glass.id, 0, lab.id);
    connect(g, glass.id, 0, market(g).id);
    connect(g, oil.id, 0, plastic.id);
    connect(g, plastic.id, 0, market(g).id);
    connect(g, plastic.id, 1, dump.id);
    // The Glass line: the Refiner and its Lab. The Market also takes Plastic, so it belongs to neither line.
    expect(lineFrom(g, glass.id).sort()).toEqual([glass.id, lab.id].sort());
    expect(lineFrom(g, plastic.id).sort()).toEqual([plastic.id, dump.id].sort());
    // From the Drill: the same line, without the Drill, which stays on its deposit.
    expect(lineFrom(g, sand.id).sort()).toEqual([glass.id, lab.id].sort());
    // A card that feeds nothing is its own line; a Market asked for itself is that Market.
    expect(lineFrom(g, lab.id)).toEqual([lab.id]);
    expect(lineFrom(g, market(g).id)).toEqual([market(g).id]);
  });

  it('a Market that only one line sells at goes with that line, and a loop of Routers does not hang', () => {
    const g = rich();
    const glass = placeNode(g, 'refiner', 400, 120)!;
    connect(g, well(g).id, 0, glass.id);
    connect(g, glass.id, 0, market(g).id);
    expect(lineFrom(g, glass.id).sort()).toEqual([glass.id, market(g).id].sort());
    const a = placeNode(g, 'router', 600, 400)!;
    const b = placeNode(g, 'merger', 760, 400)!;
    connect(g, glass.id, 0, a.id);
    connect(g, a.id, 0, b.id);
    connect(g, b.id, 0, a.id);
    expect(lineFrom(g, glass.id).sort()).toEqual([glass.id, market(g).id, a.id, b.id].sort());
  });
});

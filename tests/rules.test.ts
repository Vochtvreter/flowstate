import { describe, expect, it } from 'vitest';
import { connect, cutWire, placeNode, setMode, setRecipe, upgrade } from '../src/actions';
import { MATERIALS, NODE_DEFS, PIPES, RULES, TECHS } from '../src/content';
import { demandBurst, demandInfo, flowMult, price, saturation, sellValue } from '../src/economy';
import { countsForFlow, flowInfo, flowProducers, inFlowState, isFlowing, worstProducer } from '../src/flow';
import { Game, START, newGame } from '../src/state';
import { fresh, market, rich, run, take, throughput, well, wire } from './helpers';

describe('numbers (2.6)', () => {
  it('wires carry 4 / 8 / 16 / 32 per second', () => {
    expect(PIPES.map((p) => p.cap)).toEqual([4, 8, 16, 32]);
  });

  it('Shard is lime, the Fabricator costs 3,000 and tech prices are the proposed ones', () => {
    expect(MATERIALS.shard.color).toBe('#B8F26B');
    expect(NODE_DEFS.fabricator.base).toBe(3000);
    expect(TECHS.P2.cost).toEqual({ a: 45 });
    expect(TECHS.P3.cost).toEqual({ a: 150 });
    expect(TECHS.P4.cost).toEqual({ a: 1000 });
    expect(TECHS.P5.cost).toEqual({ a: 1500 });
    expect(TECHS.P7.cost).toEqual({ a: 2000, b: 800 });
    expect(TECHS.P9.cost).toEqual({ b: 700, g: 400 });
    expect(TECHS.L8.cost).toEqual({ g: 200 });
  });
});

describe('starting board (2.7)', () => {
  it('puts the Market diagonally below-right of the Well, inside about 430 × 250, clear of every deposit', () => {
    const g = newGame();
    const w = well(g);
    const m = market(g);
    const W = 172, H = 72; // node footprint (src/ui/geom.ts)
    expect(m.x).toBe(START.market.x);
    expect(m.x).toBeGreaterThan(w.x + W);
    expect(m.y).toBeGreaterThan(w.y + H);
    expect(m.x + W - w.x).toBeLessThanOrEqual(440);
    expect(m.y + H - w.y).toBeLessThanOrEqual(260);
    for (const d of g.deposits) {
      const apart = m.x >= d.x + W || d.x >= m.x + W || m.y >= d.y + H || d.y >= m.y + H;
      expect(apart, `Market overlaps deposit ${d.id}`).toBe(true);
    }
    expect(m.x + W).toBeLessThanOrEqual(g.board.w);
    expect(m.y + H).toBeLessThanOrEqual(g.board.h);
  });
});

describe('machines-first fan-out (2.1)', () => {
  it('a plain port feeds the machine first and sells only what is left', () => {
    const g = rich();
    const r = placeNode(g, 'refiner', 400, 100)!;
    const toMarket = connect(g, well(g).id, 0, market(g).id)!; // the Market is wired first on purpose
    const toRefiner = connect(g, well(g).id, 0, r.id)!;
    connect(g, r.id, 0, market(g).id);
    run(g, 20);
    // The Refiner needs all of the Well's 1/s: nothing is left to sell raw.
    let [fed, sold] = throughput(g, 40, [toRefiner.id, toMarket.id]);
    expect(fed).toBeCloseTo(1, 1);
    expect(sold).toBeLessThan(0.03);
    expect(r.util).toBeGreaterThan(0.95);
    expect(r.status).toBe('working');
    // Speed the Well up: the Refiner still takes its 1/s and the surplus is sold.
    for (let i = 0; i < 3; i++) upgrade(g, well(g).id, 'speed'); // ~1.95/s
    run(g, 20);
    [fed, sold] = throughput(g, 40, [toRefiner.id, toMarket.id]);
    expect(fed).toBeCloseTo(1, 1);
    expect(sold).toBeCloseTo(0.95, 1);
    expect(r.util).toBeGreaterThan(0.95);
    expect(well(g).status).toBe('working');
  });

  it('pass-through nodes are served before sinks too', () => {
    const g = rich();
    const m2 = placeNode(g, 'market', 700, 500)!;
    const merger = placeNode(g, 'merger', 400, 100)!;
    const direct = connect(g, well(g).id, 0, market(g).id)!;
    const viaMerger = connect(g, well(g).id, 0, merger.id)!;
    connect(g, merger.id, 0, m2.id);
    run(g, 30);
    expect(wire(g, viaMerger.id).rate).toBeCloseTo(1, 1);
    expect(wire(g, direct.id).rate).toBeLessThan(0.03);
  });

  it('Markets, Labs and Voids share the remainder evenly', () => {
    const g = rich();
    for (let i = 0; i < 3; i++) upgrade(g, well(g).id, 'speed'); // ~1.95/s
    const r = placeNode(g, 'refiner', 400, 100)!;
    const lab = placeNode(g, 'lab', 400, 500)!;
    const v = placeNode(g, 'void', 700, 500)!;
    const toLab = connect(g, well(g).id, 0, lab.id)!;
    const toVoid = connect(g, well(g).id, 0, v.id)!;
    const toMarket = connect(g, well(g).id, 0, market(g).id)!;
    const toRefiner = connect(g, well(g).id, 0, r.id)!;
    connect(g, r.id, 0, market(g).id);
    run(g, 20);
    const [fed, studied, dumped, sold] = throughput(g, 40, [toRefiner.id, toLab.id, toVoid.id, toMarket.id]);
    expect(fed).toBeCloseTo(1, 1);
    const rest = (Math.pow(1.25, 3) - 1) / 3;
    expect(studied).toBeCloseTo(rest, 1);
    expect(dumped).toBeCloseTo(rest, 1);
    expect(sold).toBeCloseTo(rest, 1);
  });

  it('a Router in Even mode still splits evenly across everything', () => {
    const g = rich();
    const router = placeNode(g, 'router', 300, 100)!;
    const r = placeNode(g, 'refiner', 500, 100)!;
    connect(g, well(g).id, 0, router.id);
    const toRefiner = connect(g, router.id, 0, r.id)!;
    const toMarket = connect(g, router.id, 0, market(g).id)!;
    connect(g, r.id, 0, market(g).id);
    expect(router.mode).toBe('even');
    run(g, 40);
    expect(wire(g, toRefiner.id).rate).toBeCloseTo(0.5, 1);
    expect(wire(g, toMarket.id).rate).toBeCloseTo(0.5, 1);
    expect(r.util).toBeLessThan(0.6);
    // Ratio mode keeps working as before.
    setMode(g, router.id, 'ratio');
    wire(g, toRefiner.id).weight = 3;
    run(g, 40);
    expect(wire(g, toRefiner.id).rate / wire(g, toMarket.id).rate).toBeCloseTo(3, 0);
  });
});

describe('demand with two prices (2.2)', () => {
  it('sells at full price up to the demand rate', () => {
    const g = fresh();
    connect(g, well(g).id, 0, market(g).id);
    run(g, 60);
    const d = demandInfo(g, 'glint');
    expect(d.demand).toBe(2);
    expect(d.rate).toBeCloseTo(1, 2);
    expect(d.fullRate).toBeCloseTo(1, 2);
    expect(d.surplusRate).toBe(0);
    expect(d.unitPrice).toBe(1);
    expect(d.surplusPrice).toBe(0.25);
    expect(d.income).toBeCloseTo(1, 2);
    expect(saturation(g, 'glint')).toBe(1);
    expect(g.creditRate).toBeCloseTo(1, 2);
  });

  it('sells the surplus at a flat 25%', () => {
    const g = fresh();
    g.credits = 1000;
    for (let i = 0; i < 5; i++) upgrade(g, well(g).id, 'speed'); // 1.25^5 = 3.05/s
    connect(g, well(g).id, 0, market(g).id);
    run(g, 40);
    const before = g.credits;
    run(g, 60);
    const rate = Math.pow(1.25, 5);
    const expected = 2 * 1 + (rate - 2) * 0.25; // 2/s at 1¢ plus the rest at 0.25¢
    expect((g.credits - before) / 60).toBeCloseTo(expected, 2);
    const d = demandInfo(g, 'glint');
    expect(d.rate).toBeCloseTo(rate, 1);
    expect(d.fullRate).toBe(2);
    expect(d.surplusRate).toBeCloseTo(rate - 2, 1);
    expect(d.fullRate + d.surplusRate).toBeCloseTo(d.rate, 9);
    expect(d.income).toBeCloseTo(expected, 1);
    // price() and saturation() keep working for display: the average over both prices.
    expect(saturation(g, 'glint')).toBeCloseTo(expected / rate, 1);
    expect(price(g, 'glint')).toBeCloseTo(expected / rate, 1);
  });

  it('pays full price for a machine that delivers in bursts below the demand rate', () => {
    const g = rich();
    g.credits = 1000;
    const r = placeNode(g, 'refiner', 400, 100)!;
    connect(g, well(g).id, 0, r.id);
    connect(g, r.id, 0, market(g).id);
    const before = g.credits;
    run(g, 120);
    // 0.5 Shard/s arrives one whole Shard at a time; demand is 1.5/s
    expect(g.sold.shard).toBeGreaterThan(50);
    expect(g.credits - before).toBeCloseTo(g.sold.shard! * 3, 6);
  });

  it('banks a few seconds of unused demand, no more', () => {
    const g = fresh();
    const burst = demandBurst(g, 'glint');
    expect(burst).toBe(2 * RULES.demand.burstSeconds);
    // The first sale after a quiet spell: the banked amount at full price, the rest as surplus.
    expect(sellValue(g, 'glint', burst + 4)).toBeCloseTo(burst + 4 * 0.25, 9);
    expect(sellValue(g, 'glint', 4)).toBeCloseTo(1, 9);
    // Slow items always have room for one whole item.
    expect(demandBurst(g, 'paradox')).toBeGreaterThanOrEqual(1);
  });

  it('Wider Demand raises the full-price rate', () => {
    const g = fresh();
    g.techs.push('C2');
    expect(demandInfo(g, 'glint').demand).toBe(3);
  });
});

/** Six mature producers, all running flat out: five Wells selling to the Market and one Refiner. */
function humming(): { g: Game; refiner: number; wells: number[] } {
  const g = rich();
  const wells = [well(g).id];
  for (const dep of [2, 3, 4, 5]) wells.push(placeNode(g, 'well', 0, 0, { depositId: dep })!.id);
  for (const id of wells) connect(g, id, 0, market(g).id);
  upgrade(g, wells[0], 'speed'); // a little more Glint than the Refiner needs
  const r = placeNode(g, 'refiner', 400, 100)!;
  connect(g, wells[0], 0, r.id);
  connect(g, r.id, 0, market(g).id);
  return { g, refiner: r.id, wells };
}

describe('Flow (2.3)', () => {
  it('is the smoothed share of mature, wired producers at 90% utilisation or more', () => {
    const { g } = humming();
    run(g, 19);
    expect(flowProducers(g).length).toBe(0); // nothing is 20 s old yet
    expect(g.flow).toBe(0);
    run(g, 16);
    const info = flowInfo(g);
    expect(info.producers).toBe(6);
    expect(info.flowing).toBe(6);
    expect(g.flow).toBeGreaterThan(0.98);
    expect(worstProducer(g)).toBeNull();
  });

  it('ignores producers with no wire, young producers, and everything that is not a Well or machine', () => {
    const { g, wells } = humming();
    run(g, 40);
    expect(g.flow).toBeGreaterThan(0.99);
    // A machine with no wire at all sits idle but does not count.
    const loose = placeNode(g, 'refiner', 700, 600)!;
    // A new, starved machine has a wire but is not counted until it is 20 s old.
    const young = placeNode(g, 'assembler', 900, 300)!;
    connect(g, wells[0], 0, young.id);
    // A Lab that gets nothing is not a producer.
    const lab = placeNode(g, 'lab', 900, 500)!;
    connect(g, wells[1], 0, lab.id);
    run(g, 15);
    expect(countsForFlow(g, loose)).toBe(false);
    expect(countsForFlow(g, young)).toBe(false);
    expect(countsForFlow(g, lab)).toBe(false);
    expect(flowInfo(g).producers).toBe(6);
    expect(g.flow).toBeGreaterThan(0.99);
    // Once the starved machine is 20 s old it counts, and Flow drops to 6 of 7.
    run(g, 20);
    expect(countsForFlow(g, young)).toBe(true);
    expect(flowInfo(g).producers).toBe(7);
    expect(g.flow).toBeCloseTo(6 / 7, 1);
    expect(worstProducer(g)).toBe(young);
    expect(countsForFlow(g, loose)).toBe(false);
  });

  it('changing a recipe makes a machine new again', () => {
    const { g, refiner } = humming();
    run(g, 40);
    const r = g.nodes.find((n) => n.id === refiner)!;
    expect(countsForFlow(g, r)).toBe(true);
    setRecipe(g, refiner, 'ink');
    expect(r.born).toBe(g.time);
    expect(countsForFlow(g, r)).toBe(false);
    run(g, 21);
    expect(countsForFlow(g, r)).toBe(true);
    // So does picking its first recipe: a machine placed long ago and only wired up now.
    const late = placeNode(g, 'refiner', 700, 300)!;
    run(g, 30);
    expect(late.recipe).toBeNull();
    connect(g, well(g).id, 0, late.id);
    expect(late.recipe).toBe('shard');
    expect(late.born).toBe(g.time);
    expect(countsForFlow(g, late)).toBe(false);
  });

  it('goes by utilisation, not by the status pill', () => {
    const { g, refiner } = humming();
    run(g, 40);
    const r = g.nodes.find((n) => n.id === refiner)!;
    r.status = 'working'; // what the grace period shows after every rewire
    r.util = 0.5;
    expect(isFlowing(r)).toBe(false);
    expect(flowInfo(g).flowing).toBe(5);
    expect(worstProducer(g)).toBe(r);
    r.util = 0.9;
    expect(isFlowing(r)).toBe(true);
  });

  it('multiplies sale prices by 1 + 0.2 × Flow, only once unlocked', () => {
    const locked = fresh();
    connect(locked, well(locked).id, 0, market(locked).id);
    run(locked, 60);
    expect(locked.flow).toBeGreaterThan(0.99); // one mature producer at full tilt
    expect(locked.flowOn).toBe(false);
    expect(flowMult(locked)).toBe(1);
    expect(locked.creditRate).toBeCloseTo(1, 2);
    expect(locked.flowStreak).toBe(0);
    expect(locked.flowHold).toBe(0);

    const on = fresh();
    on.flowOn = true;
    connect(on, well(on).id, 0, market(on).id);
    run(on, 60);
    expect(flowMult(on)).toBeCloseTo(1.2, 2);
    expect(on.creditRate).toBeCloseTo(1.2, 2);
    expect(demandInfo(on, 'glint').unitPrice).toBe(1); // the helper reports the bonus separately
    expect(demandInfo(on, 'glint').mult).toBeCloseTo(1.2, 2);
    expect(flowInfo(on).bonus).toBeCloseTo(0.2, 2);
    // Sales are the only place the bonus is applied.
    expect(on.stats.fromSales).toBeCloseTo(on.credits, 6);
    expect(on.credits).toBeGreaterThan(locked.credits);
  });

  it('raises one Flow State event per streak: 100% for 10 s with at least six producers', () => {
    const { g, wells } = humming();
    g.flowOn = true;
    run(g, 25); // everything turns 20 s old at once, so the streak starts at 20 s
    expect(take(g, 'flow-state').length).toBe(0);
    expect(inFlowState(g)).toBe(false);
    run(g, 6);
    const first = take(g, 'flow-state');
    expect(first.length).toBe(1);
    expect(first[0].first).toBe(true);
    expect(inFlowState(g)).toBe(true);
    run(g, 30);
    expect(take(g, 'flow-state').length).toBe(0); // same streak, no second event
    expect(g.flowStreak).toBeGreaterThan(40);
    expect(g.stats.flowStates).toBe(1);

    // Break it: a Well feeding only a machine that takes nothing backs up.
    cutWire(g, g.wires.find((w) => w.from === wells[3])!.id);
    const dead = placeNode(g, 'assembler', 900, 300)!;
    connect(g, wells[3], 0, dead.id);
    run(g, 30);
    expect(g.flowStreak).toBe(0);
    expect(inFlowState(g)).toBe(false);
    const best = g.flowBest;
    expect(best).toBeGreaterThan(40);

    // Fix it: a new streak, a second event, and it is no longer the first.
    connect(g, wells[3], 0, market(g).id);
    cutWire(g, g.wires.find((w) => w.to === dead.id)!.id);
    run(g, 30);
    const second = take(g, 'flow-state');
    expect(second.length).toBe(1);
    expect(second[0].first).toBe(false);
    expect(g.flowBest).toBe(best);
  });

  it('needs six producers for Flow State', () => {
    const g = rich();
    g.flowOn = true;
    const ids = [well(g).id];
    for (const dep of [2, 3, 4, 5]) ids.push(placeNode(g, 'well', 0, 0, { depositId: dep })!.id);
    for (const id of ids) connect(g, id, 0, market(g).id);
    run(g, 60);
    expect(flowInfo(g).producers).toBe(5);
    expect(g.flow).toBeGreaterThan(0.99);
    expect(take(g, 'flow-state').length).toBe(0);
    expect(g.flowStreak).toBe(0);
  });

  it('times how long Flow has been held at 75% or more', () => {
    const { g, wells } = humming();
    g.flowOn = true;
    run(g, 40);
    expect(g.flowHold).toBeGreaterThan(10);
    // Two of six producers back up: 67% is not enough.
    cutWire(g, g.wires.find((w) => w.from === wells[3])!.id);
    cutWire(g, g.wires.find((w) => w.from === wells[4])!.id);
    connect(g, wells[3], 0, placeNode(g, 'assembler', 900, 300)!.id);
    connect(g, wells[4], 0, placeNode(g, 'assembler', 900, 500)!.id);
    run(g, 30);
    expect(g.flow).toBeLessThan(0.74);
    expect(g.flowHold).toBe(0);
  });
});

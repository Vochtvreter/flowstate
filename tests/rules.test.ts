import { describe, expect, it } from 'vitest';
import { connect, cutWire, deleteNode, expandBoard, placeNode, setMode, setRecipe, upgrade, upgradeWire } from '../src/actions';
import { MATERIALS, MAT_IDS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, RULES, TECHS } from '../src/content';
import {
  cycleTime, dataYield, demandBurst, demandInfo, demandShown, expansionCost, flowMult, nodeCostAt, price, research, saturation, sellValue,
  techAvailable, techHidden, upgradeCostAt, wellRate,
} from '../src/economy';
import { GOALS } from '../src/goals';
import { countsForFlow, flowInfo, flowProducers, inFlowState, isFlowing, worstProducer } from '../src/flow';
import { tick } from '../src/sim';
import { Game, START, deserialize, newGame, serialize } from '../src/state';
import { fresh, market, rich, run, take, throughput, well, wire } from './helpers';

describe('numbers (2.6)', () => {
  it('wires carry 4 / 8 / 16 / 32 per second', () => {
    expect(PIPES.map((p) => p.cap)).toEqual([4, 8, 16, 32]);
  });

  it('Shard is lime; machine and tech prices are the ones tuned with the pacing bot', () => {
    expect(MATERIALS.shard.color).toBe('#B8F26B');
    expect(NODE_DEFS.assembler.base).toBe(600);
    expect(NODE_DEFS.fabricator.base).toBe(7100);
    // The second Assembler (Prism) is a purchase in its own right: 1,500¢, so that part of what the Fabricator
    // used to ask for is paid before the Fabricator goal begins. The other machines grow gently.
    expect([0, 1, 2].map((n) => nodeCostAt('assembler', n))).toEqual([600, 1500, 3750]);
    expect([0, 1].map((n) => nodeCostAt('fabricator', n))).toEqual([7100, 8165]);
    expect([0, 1, 2].map((n) => nodeCostAt('refiner', n))).toEqual([50, 57, 66]);
    // The Processing spine the goal chain asks for.
    expect(TECHS.P2.cost).toEqual({ a: 45 });
    expect(TECHS.P3.cost).toEqual({ a: 215 });
    expect(TECHS.P4.cost).toEqual({ a: 1140 });
    expect(TECHS.P5.cost).toEqual({ a: 1420 });
    expect(TECHS.P7.cost).toEqual({ a: 720, b: 100 }); // lower than the curve: the card players' last wait is for credits, not for α
    // Free play needs all three kinds of Data, and Reclamation cannot be had before the first Lens.
    expect(TECHS.P6.cost).toEqual({ a: 300, g: 25 });
    expect(TECHS.P8.cost).toEqual({ a: 1200, b: 300, g: 100 });
    expect(TECHS.P9.cost).toEqual({ a: 2500, b: 500, g: 450 });
  });

  it('side techs are impulse buys: none costs more than a third of the spine tech it competes with', () => {
    // Before the first Glyph only α exists, and every α side tech is small next to Assembly: together they
    // cost less than a seventh of it. (Wider Demand used to be among them at 200 α; nothing sells over
    // demand that early, and an expert who bought it on impulse reached Glyph most of a minute later.)
    for (const id of ['R2', 'L2', 'L3']) {
      expect(Object.keys(TECHS[id].cost), id).toEqual(['a']);
      expect(TECHS[id].cost.a!, id).toBeLessThanOrEqual(0.35 * TECHS.P4.cost.a!);
    }
    expect(['R2', 'L2', 'L3'].reduce((sum, id) => sum + TECHS[id].cost.a!, 0)).toBeLessThan(TECHS.P4.cost.a! / 7);
    // After it, the β side techs are either small next to Fabrication's β price or dearer than it.
    for (const id of ['L5', 'L4', 'L6', 'U1', 'S3', 'L7', 'R3', 'C2', 'C4']) {
      expect(Object.keys(TECHS[id].cost), id).toEqual(['b']);
      const b = TECHS[id].cost.b!;
      expect(b <= 90 || b > TECHS.P7.cost.b!, `${id} at ${b}β`).toBe(true);
    }
    // Nothing that is only useful after the demo can be bought before γ exists.
    for (const id of ['P6', 'P8', 'P9', 'U2', 'C5', 'L8']) expect(TECHS[id].cost.g, id).toBeGreaterThan(0);
  });

  it('Efficiency Tuning waits for Assembly: it costs β, and there is no β before the first Glyph', () => {
    // It used to hang on Refining alone, and sat in the tree with a β price ten minutes before any β existed.
    expect(TECHS.U1.requires).toEqual(['P1', 'P4']);
    const g = fresh();
    g.techs = ['P1', 'R1', 'P2', 'P3'];
    g.data = { a: 1e6, b: 1e6, g: 1e6 };
    expect(techAvailable(g, TECHS.U1)).toBe(false);
    expect(research(g, 'U1')).toBe(false);
    g.techs.push('P4');
    expect(techAvailable(g, TECHS.U1)).toBe(true);
    expect(research(g, 'U1')).toBe(true);
  });

  it('a Lab makes Data by tier, except from Silt: a by-product is worth 1 α, not 3', () => {
    const g = fresh();
    const made = (m: MatId) => dataYield(g, m);
    expect(made('glint')).toEqual({ tier: 'a', amount: 1 });
    expect(made('shard')).toEqual({ tier: 'a', amount: 3 });
    expect(made('ink')).toEqual({ tier: 'a', amount: 3 });
    expect(made('silt')).toEqual({ tier: 'a', amount: 1 });
    expect(made('clay')).toEqual({ tier: 'a', amount: 3 }); // three Silt make one Clay: the same α either way
    expect(made('glyph')).toEqual({ tier: 'b', amount: 5 });
    expect(made('lens')).toEqual({ tier: 'g', amount: 8 });
    // Deep Analysis multiplies Silt's amount like any other.
    g.techs.push('R3');
    expect(made('silt').amount).toBe(1.5);
    expect(made('shard').amount).toBe(4.5);
    // Silt is the only material with an amount of its own.
    expect(MAT_IDS.filter((m) => MATERIALS[m].study != null)).toEqual(['silt']);
  });

  it('prices board expansions at 200 × 2.5ⁿ', () => {
    const g = fresh();
    expect(expansionCost(g)).toBe(200);
    g.board.expansions = 1;
    expect(expansionCost(g)).toBe(500);
    g.board.expansions = 2;
    expect(expansionCost(g)).toBe(1250);
  });

  it('prices Speed upgrades per node type, growing 1.6× per level', () => {
    expect([0, 1, 2].map((l) => upgradeCostAt('well', 'speed', l))).toEqual([50, 80, 128]);
    expect([0, 1, 2].map((l) => upgradeCostAt('refiner', 'speed', l))).toEqual([32, 51, 82]);
    expect([0, 1].map((l) => upgradeCostAt('assembler', 'speed', l))).toEqual([100, 160]);
    expect([0, 1].map((l) => upgradeCostAt('fabricator', 'speed', l))).toEqual([400, 640]);
    expect([0, 1].map((l) => upgradeCostAt('lab', 'speed', l))).toEqual([50, 80]);
    // Efficiency and Buffer have their own tables: a dearer machine does not make them dearer.
    expect(['refiner', 'assembler', 'fabricator'].map((t) => upgradeCostAt(t as NodeType, 'eff', 0))).toEqual([75, 300, 1200]);
    expect(upgradeCostAt('refiner', 'eff', 1)).toBe(120);
    expect(['refiner', 'assembler', 'fabricator', 'silo'].map((t) => upgradeCostAt(t as NodeType, 'buffer', 0))).toEqual([20, 80, 320, 80]);
    for (const type of ['refiner', 'assembler', 'fabricator'] as NodeType[]) {
      expect(upgradeCostAt(type, 'eff', 0), type).toBeLessThan(NODE_DEFS[type].base * 2);
    }
  });

  it('a first or second Speed level pays for itself in one to three minutes where the input exists', () => {
    const probe = well(fresh());
    const worth = (list: [MatId, number][]) => list.reduce((s, [m, q]) => s + (MATERIALS[m].value < 1 ? 0 : MATERIALS[m].value * q), 0);
    const check = (what: string, cost: number, gain: number) => {
      const seconds = Math.round(cost / gain);
      expect(seconds, `${what}: ${cost}¢ for +${gain.toFixed(2)}¢/s`).toBeGreaterThanOrEqual(60);
      expect(seconds, `${what}: ${cost}¢ for +${gain.toFixed(2)}¢/s`).toBeLessThanOrEqual(180);
    };
    // Wells: the extra raw material is refined by a machine that has room for it.
    for (const raw of ['glint', 'murk', 'ember', 'breeze'] as MatId[]) {
      const r = Object.values(RECIPES).find((x) => x.inputs.length === 1 && x.inputs[0][0] === raw)!;
      for (const level of [0, 1]) {
        const rate = (lv: number) => wellRate({ ...probe, material: raw, lv: { speed: lv, eff: 0, buffer: 0 } });
        const more = rate(level + 1) - rate(level);
        check(`${raw} Well L${level + 1}`, upgradeCostAt('well', 'speed', level), (more / r.inputs[0][1]) * worth(r.outputs));
      }
    }
    // Machines of the demo: the extra input was backing up, so everything the faster machine makes is a gain.
    for (const id of ['shard', 'ink', 'spark', 'mist', 'glyph', 'prism', 'lens']) {
      const r = RECIPES[id];
      for (const level of [0, 1]) {
        const rate = (lv: number) => 1 / cycleTime({ ...probe, lv: { speed: lv, eff: 0, buffer: 0 } }, r);
        check(`${id} L${level + 1}`, upgradeCostAt(r.machine, 'speed', level), (rate(level + 1) - rate(level)) * worth(r.outputs));
      }
    }
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

/** An Ink Refiner (0.5/s) whose port feeds a Glyph Assembler (needs 0.33/s) and a Router that leads to a Lab and a Market. */
function routerOnAMachinePort() {
  const g = rich();
  const m = market(g);
  const ink = placeNode(g, 'refiner', 400, 400)!;
  const spark = placeNode(g, 'refiner', 400, 540)!;
  connect(g, placeNode(g, 'well', 0, 0, { depositId: 3 })!.id, 0, ink.id);
  connect(g, placeNode(g, 'well', 0, 0, { depositId: 4 })!.id, 0, spark.id);
  for (let i = 0; i < 2; i++) upgrade(g, g.nodes.find((n) => n.material === 'ember')!.id, 'speed'); // plenty of Spark
  connect(g, ink.id, 1, placeNode(g, 'void', 700, 650)!.id);
  const router = placeNode(g, 'router', 650, 380)!;
  const viaRouter = connect(g, ink.id, 0, router.id)!;
  const toLab = connect(g, router.id, 0, placeNode(g, 'lab', 900, 300)!.id)!;
  connect(g, router.id, 0, m.id);
  setMode(g, router.id, 'ratio');
  toLab.weight = 3;
  const glyph = placeNode(g, 'assembler', 700, 500, { recipe: 'glyph' })!;
  const toGlyph = connect(g, ink.id, 0, glyph.id)!;
  connect(g, spark.id, 0, glyph.id);
  connect(g, spark.id, 0, m.id);
  connect(g, glyph.id, 0, m.id);
  run(g, 60);
  return { g, glyph, viaRouter: viaRouter.id, toGlyph: toGlyph.id };
}

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

  it('a junction on the way to a machine is served before the sinks', () => {
    const g = rich();
    const merger = placeNode(g, 'merger', 400, 100)!;
    const refiner = placeNode(g, 'refiner', 700, 100)!;
    const direct = connect(g, well(g).id, 0, market(g).id)!;
    const viaMerger = connect(g, well(g).id, 0, merger.id)!;
    connect(g, merger.id, 0, refiner.id);
    connect(g, refiner.id, 0, market(g).id);
    run(g, 20);
    const [junction, sold] = throughput(g, 40, [viaMerger.id, direct.id]);
    expect(junction).toBeCloseTo(1, 1);
    expect(sold).toBeLessThan(0.03);
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

  it('a machine that hands over whole items feeds the next machine first as well', () => {
    // A Refiner finishes one Shard at a time. A wire used to take a fifth of an item per tick, so the rest of
    // each Shard spilled to the Market on the same port and the Assembler starved at 60%.
    const g = rich();
    const m = market(g);
    const shard = placeNode(g, 'refiner', 400, 100)!;
    const mist = placeNode(g, 'refiner', 400, 600)!;
    connect(g, well(g).id, 0, shard.id);
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 5 })!.id, 0, mist.id);
    const prism = placeNode(g, 'assembler', 700, 300, { recipe: 'prism' })!; // 2 Shard per 4 s: all the Refiner makes
    const sell = connect(g, shard.id, 0, m.id)!; // "sell the rest" was wired first
    const feed = connect(g, shard.id, 0, prism.id)!;
    connect(g, mist.id, 0, prism.id);
    connect(g, mist.id, 0, m.id);
    connect(g, prism.id, 0, m.id);
    run(g, 40);
    const [fed, sold] = throughput(g, 120, [feed.id, sell.id]);
    expect(fed).toBeCloseTo(0.5, 2);
    expect(sold).toBeLessThan(0.01);
    expect(prism.util).toBeGreaterThan(0.97);
    expect(prism.status).toBe('working');
    // The Mist Refiner makes 0.4/s and the Assembler needs 0.25: the rest of the Mist is sold.
    expect(g.soldRate.mist).toBeCloseTo(0.15, 1);
  });

  it('the first Assembler runs flat out when it is wired onto two Refiners that already sell and study', () => {
    // What goal 15 asks for, on the board goals 9 to 11 leave behind.
    const g = rich();
    const m = market(g);
    const lab = placeNode(g, 'lab', 900, 100)!;
    const line = (deposit: number, y: number) => {
      const r = placeNode(g, 'refiner', 400, y)!;
      connect(g, placeNode(g, 'well', 0, 0, { depositId: deposit })!.id, 0, r.id);
      connect(g, r.id, 0, m.id);
      connect(g, r.id, 0, lab.id);
      return r;
    };
    const ink = line(3, 400);
    const spark = line(4, 540);
    connect(g, ink.id, 1, placeNode(g, 'void', 700, 650)!.id);
    run(g, 30);
    const glyph = placeNode(g, 'assembler', 700, 450, { recipe: 'glyph' })!;
    connect(g, ink.id, 0, glyph.id);
    connect(g, spark.id, 0, glyph.id);
    connect(g, glyph.id, 0, m.id);
    run(g, 60);
    expect(glyph.util).toBeGreaterThan(0.97); // needs a third of an Ink and of a Spark per second; 0.5 and 0.4 are made
    expect(glyph.status).toBe('working');
    expect(glyph.rate).toBeCloseTo(1 / 3, 1);
  });

  it('a wire still carries no more than its capacity over time, and what does not fit is sold', () => {
    const g = rich();
    const m = market(g);
    for (let i = 0; i < 8; i++) upgrade(g, well(g).id, 'speed'); // 5.96 Glint/s
    const r = placeNode(g, 'refiner', 400, 100)!;
    for (let i = 0; i < 10; i++) upgrade(g, r.id, 'speed'); // could take 5.08 Glint/s
    const feed = connect(g, well(g).id, 0, r.id)!; // Mk I: 4/s
    const sell = connect(g, well(g).id, 0, m.id)!;
    connect(g, r.id, 0, m.id);
    run(g, 30);
    const [fed, sold] = throughput(g, 60, [feed.id, sell.id]);
    expect(fed).toBeCloseTo(4, 1);
    expect(fed).toBeLessThanOrEqual(4.001);
    expect(sold).toBeCloseTo(Math.pow(1.25, 8) - 4, 1);
    // A stockpile released down an idle wire: one second's worth passes at once, then the steady 4/s.
    const silo = placeNode(g, 'silo', 400, 500)!;
    const fill = connect(g, placeNode(g, 'well', 0, 0, { depositId: 3 })!.id, 0, silo.id)!;
    run(g, 100);
    cutWire(g, fill.id);
    const out = connect(g, silo.id, 0, placeNode(g, 'void', 800, 500)!.id)!;
    const [burst] = throughput(g, 1, [out.id]);
    expect(burst).toBeLessThanOrEqual(4 * (1 + RULES.wires.burstSeconds) + 1e-6);
    const [steady] = throughput(g, 10, [out.id]);
    expect(steady).toBeCloseTo(4, 1);
    expect(steady).toBeLessThanOrEqual(4.001);
  });

  it('a Router to a Lab and a Market on a machine\'s port waits for the machine', () => {
    // Goal 13 has the player build exactly this Router; the Assembler of goal 15 then lands on the same port.
    expect(RULES.fanOut.deadEndJunctionsLast).toBe(true);
    const { glyph, viaRouter, toGlyph, g } = routerOnAMachinePort();
    const [routed, fed] = throughput(g, 120, [viaRouter, toGlyph]);
    expect(fed).toBeCloseTo(1 / 3, 1); // all it needs
    expect(routed).toBeCloseTo(0.5 - 1 / 3, 1); // the Router gets what is left
    expect(glyph.util).toBeGreaterThan(0.97);
    expect(glyph.status).toBe('working');
  });

  /** A Well making 1.95 Glint/s whose port feeds a Refiner (takes 1/s), a Market, and whatever `build` hangs on it. */
  function sharedPort(build: (g: Game, port: (to: number) => number) => number) {
    const g = rich();
    for (let i = 0; i < 3; i++) upgrade(g, well(g).id, 'speed');
    const refiner = placeNode(g, 'refiner', 400, 100)!;
    const port = (to: number) => connect(g, well(g).id, 0, to)!.id;
    const toMarket = port(market(g).id);
    const toJunction = build(g, port);
    const toRefiner = port(refiner.id);
    connect(g, refiner.id, 0, market(g).id);
    run(g, 30);
    const [fed, junction, sold] = throughput(g, 60, [toRefiner, toJunction, toMarket]);
    return { g, fed, junction, sold, refiner };
  }
  const SPARE = Math.pow(1.25, 3) - 1; // what the Refiner leaves: 0.95/s

  it('junction → junction → Market is a dead end: it shares the leftovers with the Market', () => {
    const { fed, junction, sold, refiner } = sharedPort((g, port) => {
      const a = placeNode(g, 'merger', 400, 300)!;
      const b = placeNode(g, 'router', 600, 300)!;
      connect(g, a.id, 0, b.id);
      connect(g, b.id, 0, placeNode(g, 'market', 800, 300)!.id);
      return port(a.id);
    });
    expect(fed).toBeCloseTo(1, 1);
    expect(refiner.util).toBeGreaterThan(0.97);
    expect(junction).toBeCloseTo(SPARE / 2, 1);
    expect(sold).toBeCloseTo(SPARE / 2, 1);
  });

  it('junction → machine and Market counts as a machine: it is served with the Refiner, evenly', () => {
    const { fed, junction, sold, refiner } = sharedPort((g, port) => {
      const router = placeNode(g, 'router', 400, 300)!;
      const second = placeNode(g, 'refiner', 600, 300)!;
      connect(g, router.id, 0, second.id);
      connect(g, router.id, 0, placeNode(g, 'market', 800, 300)!.id);
      connect(g, second.id, 0, market(g).id);
      return port(router.id);
    });
    // 1.95/s shared evenly by the Refiner and the Router: neither gets the 1/s it could take, nothing is left to sell.
    expect(fed).toBeCloseTo(Math.pow(1.25, 3) / 2, 1);
    expect(junction).toBeCloseTo(Math.pow(1.25, 3) / 2, 1);
    expect(sold).toBeLessThan(0.03);
    expect(refiner.util).toBeGreaterThan(0.95);
  });

  it('a loop of junctions leads nowhere by itself, and leads to a machine when one hangs off it', () => {
    // Merger → Router → back to the Merger, and on to a Market: a dead end.
    const loop = sharedPort((g, port) => {
      const a = placeNode(g, 'merger', 400, 300)!;
      const b = placeNode(g, 'router', 600, 300)!;
      connect(g, a.id, 0, b.id);
      connect(g, b.id, 0, a.id);
      connect(g, b.id, 0, placeNode(g, 'market', 800, 300)!.id);
      return port(a.id);
    });
    expect(loop.fed).toBeCloseTo(1, 1);
    expect(loop.junction).toBeCloseTo(SPARE / 2, 1);
    expect(loop.sold).toBeCloseTo(SPARE / 2, 1);
    expect(Number.isFinite(loop.g.credits)).toBe(true);
    // The same loop with a Refiner hanging off the Router: now it is on the way to a machine.
    const feeding = sharedPort((g, port) => {
      const a = placeNode(g, 'merger', 400, 300)!;
      const b = placeNode(g, 'router', 600, 300)!;
      const second = placeNode(g, 'refiner', 800, 300, { recipe: 'shard' })!;
      connect(g, a.id, 0, b.id);
      connect(g, b.id, 0, a.id);
      connect(g, b.id, 0, second.id);
      connect(g, second.id, 0, market(g).id);
      return port(a.id);
    });
    expect(feeding.fed).toBeCloseTo(Math.pow(1.25, 3) / 2, 1);
    expect(feeding.junction).toBeCloseTo(Math.pow(1.25, 3) / 2, 1);
    expect(feeding.sold).toBeLessThan(0.03);
  });

  it('a Silo follows the same rule: a store with no machine behind it waits, one that feeds a machine does not', () => {
    const store = sharedPort((g, port) => port(placeNode(g, 'silo', 400, 300)!.id));
    expect(store.fed).toBeCloseTo(1, 1);
    // It took its share of the leftovers until it was full (200 items), so the Market sold the other half.
    expect(store.sold).toBeCloseTo(SPARE / 2, 1);
    const buffer = sharedPort((g, port) => {
      const silo = placeNode(g, 'silo', 400, 300)!;
      const second = placeNode(g, 'refiner', 600, 300)!;
      connect(g, silo.id, 0, second.id);
      connect(g, second.id, 0, market(g).id);
      return port(silo.id);
    });
    expect(buffer.fed).toBeCloseTo(Math.pow(1.25, 3) / 2, 1);
    expect(buffer.sold).toBeLessThan(0.03);
  });

  it('with the switch off, every junction is served with the machines (the first reading of the plan)', () => {
    RULES.fanOut.deadEndJunctionsLast = false;
    try {
      const { glyph, viaRouter, toGlyph, g } = routerOnAMachinePort();
      const [routed, fed] = throughput(g, 120, [viaRouter, toGlyph]);
      expect(routed).toBeCloseTo(0.25, 1);
      expect(fed).toBeCloseTo(0.25, 1); // it needs 0.33
      expect(glyph.util).toBeLessThan(0.85);
    } finally {
      RULES.fanOut.deadEndJunctionsLast = true;
    }
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

  it('notes the first time something keeps selling over demand, once per save', () => {
    const g = fresh();
    g.credits = 1000;
    connect(g, well(g).id, 0, market(g).id);
    run(g, 60);
    expect(g.seenSurplus).toBe(false); // 1/s of Glint against a demand of 2/s
    for (let i = 0; i < 5; i++) upgrade(g, well(g).id, 'speed'); // 3.05/s
    // The bank of unused demand (8 s worth) has to run dry first, then the surplus has to last a few seconds.
    run(g, 8);
    expect(g.seenSurplus).toBe(false);
    expect(take(g, 'surplus').length).toBe(0);
    expect(g.techs).not.toContain('C1');
    g.events = [];
    run(g, 20);
    expect(g.seenSurplus).toBe(true);
    // Market Lens arrives with it, announced just before: the gauges exist by the time the notice is read.
    expect(g.techs).toContain('C1');
    expect(g.events.filter((e) => e.kind === 'tech' || e.kind === 'surplus').map((e) => (e.kind === 'tech' ? e.id : e.kind))).toEqual(['C1', 'surplus']);
    const events = take(g, 'surplus');
    expect(events.length).toBe(1);
    expect(events[0].mat).toBe('glint');
    expect(events[0].text).toBe('Glint is selling faster than Markets want it: the extra goes for 25% of the price.');
    run(g, 60);
    expect(take(g, 'surplus').length).toBe(0); // one-off
    expect(g.techs.filter((id) => id === 'C1')).toEqual(['C1']);
    // The flag is saved, so a reload does not announce it again.
    const copy = deserialize(serialize(g))!;
    expect(copy.seenSurplus).toBe(true);
    run(copy, 30);
    expect(take(copy, 'surplus').length).toBe(0);
    // A save from before the flag starts without it.
    const old = JSON.parse(serialize(fresh()));
    delete old.seenSurplus;
    expect(deserialize(JSON.stringify(old))!.seenSurplus).toBe(false);
  });

  it('does not mistake one burst over the bank for a surplus, nor a machine that delivers whole items under demand', () => {
    // A Silo emptied into the Market at once: more than the bank holds for a moment, then nothing.
    const g = rich();
    const silo = placeNode(g, 'silo', 400, 100)!;
    const fill = connect(g, well(g).id, 0, silo.id)!;
    run(g, 30); // about 30 Glint stored; the bank holds 16
    cutWire(g, fill.id);
    const out = connect(g, silo.id, 0, market(g).id)!;
    upgradeWire(g, out.id); // Mk II: 8/s, so it empties in a few seconds
    run(g, 2);
    expect(g.sold.glint).toBeGreaterThan(16);
    run(g, 30);
    expect(g.seenSurplus).toBe(false);
    // Shard at 0.5/s in whole items against a demand of 1.5/s never touches the surplus price.
    const r = placeNode(g, 'refiner', 400, 300)!;
    connect(g, well(g).id, 0, r.id);
    connect(g, r.id, 0, market(g).id);
    run(g, 120);
    expect(g.seenSurplus).toBe(false);
    expect(take(g, 'surplus').length).toBe(0);
  });

  it('notices a slow machine too: whole items every few seconds, each sale over demand', () => {
    // Two Fabricators' worth of Lens (two every 6 s against a demand of one every 4 s) sell 18% under full
    // price for as long as they run. The over-demand sales come 6 s apart, and a Paradox line's up to 12 s.
    for (const [mat, every, n] of [['lens', 6, 2], ['paradox', 12, 2]] as const) {
      const g = rich();
      const silo = placeNode(g, 'silo', 400, 100)!;
      connect(g, silo.id, 0, market(g).id);
      const before = g.credits;
      let next = 0;
      for (let t = 0; t < 120; t += 0.05) {
        if (t >= next) {
          silo.inb[mat] = (silo.inb[mat] ?? 0) + n;
          next += every;
        }
        tick(g, 0.05);
      }
      expect(g.credits - before, mat).toBeLessThan(0.9 * (g.sold[mat] ?? 0) * MATERIALS[mat].value);
      expect(g.seenSurplus, mat).toBe(true);
      expect(take(g, 'surplus').map((e) => e.mat), mat).toEqual([mat]);
    }
    // One whole item now and then, under demand on average, is not: a Lens every 6 s.
    const g = rich();
    const silo = placeNode(g, 'silo', 400, 100)!;
    connect(g, silo.id, 0, market(g).id);
    for (let t = 0, next = 0; t < 120; t += 0.05) {
      if (t >= next) {
        silo.inb.lens = (silo.inb.lens ?? 0) + 1;
        next += 6;
      }
      tick(g, 0.05);
    }
    expect(g.seenSurplus).toBe(false);
  });

  it('Wider Demand raises the full-price rate', () => {
    const g = fresh();
    g.techs.push('C2');
    expect(demandInfo(g, 'glint').demand).toBe(3);
  });

  it('demand stays hidden until it bites: no Market Lens from a goal, and no Commerce branch before the first surplus', () => {
    const commerce = ['C1', 'C2', 'C4', 'C5'];
    expect(Object.values(TECHS).filter((t) => t.branch === 'commerce').map((t) => t.id).sort()).toEqual(commerce);
    expect(commerce.every((id) => TECHS[id].needsSurplus)).toBe(true);
    // Market Lens is never bought and never paid by a goal.
    expect(TECHS.C1.auto).toBeTruthy();
    expect(GOALS.some((x) => x.reward.techs?.includes('C1'))).toBe(false);
    const g = rich();
    g.data = { a: 1e6, b: 1e6, g: 1e6 };
    for (const id of commerce) {
      expect(techHidden(g, TECHS[id]), id).toBe(true);
      expect(techAvailable(g, TECHS[id]), id).toBe(false);
      expect(research(g, id), id).toBe(false);
    }
    expect(demandShown(g)).toBe(false);
    // The first sale over demand: Market Lens is granted, and Wider Demand can be researched.
    connect(g, well(g).id, 0, market(g).id);
    for (let i = 0; i < 6; i++) upgrade(g, well(g).id, 'speed');
    run(g, 40);
    expect(g.seenSurplus).toBe(true);
    expect(demandShown(g)).toBe(true);
    expect(g.techs).toContain('C1');
    for (const id of commerce) expect(techHidden(g, TECHS[id]), id).toBe(false);
    expect(techAvailable(g, TECHS.C1)).toBe(false); // owned
    expect(techAvailable(g, TECHS.C2)).toBe(true);
    expect(techAvailable(g, TECHS.C4)).toBe(false); // behind Wider Demand, as before
    expect(research(g, 'C2')).toBe(true);
    expect(research(g, 'C4')).toBe(true);
    // Saved and loaded, it stays that way.
    const copy = deserialize(serialize(g))!;
    expect(copy.techs).toContain('C1');
    expect(techHidden(copy, TECHS.C5)).toBe(false);
  });

  it('nothing a player can read before that moment names demand: goal cards, node blurbs, the techs in view', () => {
    const names = /demand|surplus|full price/i;
    for (const goal of GOALS) {
      for (const text of [goal.title, goal.hint.mouse, goal.hint.touch, goal.meanwhile?.text.mouse ?? '', goal.meanwhile?.text.touch ?? '']) {
        expect(text, `${goal.id}: ${text}`).not.toMatch(names);
      }
    }
    // The hotbar and the inspector show a node's blurb from the first second (the Market's used to explain demand).
    for (const def of Object.values(NODE_DEFS)) expect(def.blurb, def.type).not.toMatch(names);
    // Every tech that says the word is one of the hidden ones.
    for (const t of Object.values(TECHS)) {
      if ([t.name, t.desc, t.auto ?? '', ...t.unlocks].some((text) => names.test(text))) expect(t.needsSurplus, t.id).toBe(true);
    }
  });

  it('a save that already owns Market Lens or Wider Demand keeps them, and keeps the branch in view', () => {
    // Before this rule "Fill your first order" paid Market Lens, with no surplus ever seen.
    const old = JSON.parse(serialize(fresh()));
    old.techs = ['P1', 'R1', 'L1', 'C1'];
    old.seenSurplus = false;
    const g = deserialize(JSON.stringify(old))!;
    g.data = { a: 1e6, b: 1e6, g: 1e6 };
    run(g, 1);
    expect(g.techs).toContain('C1');
    expect(g.seenSurplus).toBe(false);
    for (const id of ['C1', 'C2', 'C4', 'C5']) expect(techHidden(g, TECHS[id]), id).toBe(false);
    expect(research(g, 'C2')).toBe(true);
    const again = deserialize(serialize(g))!;
    expect(again.techs).toContain('C2');
    expect(demandInfo(again, 'glint').demand).toBe(3);
    expect(techAvailable(again, TECHS.C4)).toBe(true);
    // A save that had seen a surplus before Market Lens came with it is given Market Lens on load.
    const seen = JSON.parse(serialize(fresh()));
    seen.techs = ['P1', 'R1'];
    seen.seenSurplus = true;
    const h = deserialize(JSON.stringify(seen))!;
    expect(h.techs).toEqual(['P1', 'R1', 'C1']);
    run(h, 1);
    expect(take(h, 'surplus')).toEqual([]);
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
    // A new, starved machine on its way to the Market is not counted until it is 20 s old.
    const young = placeNode(g, 'assembler', 900, 300)!;
    connect(g, wells[0], 0, young.id);
    connect(g, young.id, 0, market(g).id);
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

  it('counts only producers whose output can reach a Market or a Lab', () => {
    // Six Wells into a Void are not a supply line: no producers, no Flow, no Flow State.
    const g = rich();
    g.flowOn = true;
    const sink = placeNode(g, 'void', 600, 300)!;
    const wells = [well(g).id];
    for (const dep of [2, 3, 4, 5]) wells.push(placeNode(g, 'well', 0, 0, { depositId: dep })!.id);
    expandBoard(g);
    wells.push(placeNode(g, 'well', 0, 0, { depositId: g.deposits[g.deposits.length - 1].id })!.id);
    expect(wells.length).toBe(6);
    for (const id of wells) connect(g, id, 0, sink.id);
    run(g, 60);
    expect(g.nodes.filter((n) => n.type === 'well').every((n) => n.util > 0.99)).toBe(true); // all running flat out
    expect(flowInfo(g)).toMatchObject({ producers: 0, flowing: 0 });
    expect(g.flow).toBe(0);
    expect(g.flowHold).toBe(0);
    expect(take(g, 'flow-state').length).toBe(0);
    expect(inFlowState(g)).toBe(false);
    expect(flowMult(g)).toBe(1);

    // A path counts however long it is: Well → Refiner → Merger → Lab makes both the Well and the Refiner producers.
    const refiner = placeNode(g, 'refiner', 400, 100)!;
    const merger = placeNode(g, 'merger', 700, 100)!;
    connect(g, wells[0], 0, refiner.id);
    connect(g, refiner.id, 0, merger.id);
    run(g, 25);
    expect(countsForFlow(g, refiner)).toBe(false); // the Merger leads nowhere yet
    expect(countsForFlow(g, well(g))).toBe(false);
    connect(g, merger.id, 0, placeNode(g, 'lab', 900, 100)!.id);
    expect(countsForFlow(g, refiner)).toBe(true);
    expect(countsForFlow(g, well(g))).toBe(true);
    expect(flowInfo(g).producers).toBe(2);
    // One of two outputs is enough: an Ink Refiner that sells its Ink counts even though the Silt is dumped.
    const ink = placeNode(g, 'refiner', 400, 400, { recipe: 'ink' })!;
    connect(g, wells[2], 0, ink.id);
    connect(g, ink.id, 1, sink.id);
    run(g, 25);
    expect(countsForFlow(g, ink)).toBe(false);
    connect(g, ink.id, 0, market(g).id);
    expect(countsForFlow(g, ink)).toBe(true);
    // The other Wells still pour into the Void and still do not count.
    expect(flowInfo(g).producers).toBe(4);
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
    connect(g, dead.id, 0, market(g).id); // what it made could be sold, so the Well still counts
    run(g, 30);
    expect(g.flowStreak).toBe(0);
    expect(inFlowState(g)).toBe(false);
    const best = g.flowBest;
    expect(best).toBeGreaterThan(40);

    // Fix it: a new streak, a second event, and it is no longer the first.
    connect(g, wells[3], 0, market(g).id);
    deleteNode(g, dead.id);
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

  it('times how long Flow has been held at 95% or more: on a board of under nineteen producers, all of them', () => {
    expect(RULES.flow.holdShare).toBe(0.95);
    const { g, wells } = humming();
    g.flowOn = true;
    run(g, 40);
    expect(g.flowHold).toBeGreaterThan(10);
    // One of six producers backs up: 83% is not enough any more...
    const stall = (id: number, y: number) => {
      cutWire(g, g.wires.find((w) => w.from === id)!.id);
      const dead = placeNode(g, 'assembler', 900, y)!;
      connect(g, id, 0, dead.id);
      connect(g, dead.id, 0, market(g).id);
    };
    stall(wells[3], 300);
    run(g, 15); // (the machine it now starves is too new to count yet)
    expect(g.flow).toBeGreaterThan(0.8);
    expect(g.flow).toBeLessThan(0.86);
    expect(g.flowHold).toBe(0);
    // ...and with a second one stalled, and both starved machines counted, Flow is at a half.
    stall(wells[4], 500);
    run(g, 30);
    expect(g.flow).toBeLessThan(0.55);
    expect(g.flowHold).toBe(0);
  });
});

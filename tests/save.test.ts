import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimGoal, claimOrder, connect, deleteNode, placeNode, upgrade } from '../src/actions';
import { advice, applyAdvice, lineAdvice } from '../src/advice';
import { RULES, TECHS } from '../src/content';
import { endDemo, endStats, offlineCap, research, techAvailable, techHidden } from '../src/economy';
import { GOALS, activeGoal, goalById, goalView } from '../src/goals';
import { startOrders } from '../src/orders';
import { offlineGains } from '../src/sim';
import { Game, cloneGame, deserialize, newGame, serialize } from '../src/state';
import { fresh, market, rich, run, take, well } from './helpers';

afterEach(() => vi.unstubAllGlobals());

/** Everything about a game that a save holds, minus the save time. */
const saved = (g: Game) => {
  const o = JSON.parse(serialize(g));
  delete o.savedAt;
  return o;
};

/** A one-Well line that is past the demo, with something queued and a little Data. */
function afterDemo(): Game {
  const g = fresh();
  g.techs = ['P1', 'R1'];
  g.credits = 500;
  const lab = placeNode(g, 'lab', 700, 100)!;
  for (let i = 0; i < 3; i++) upgrade(g, well(g).id, 'speed'); // ~1.95/s
  connect(g, well(g).id, 0, market(g).id);
  connect(g, well(g).id, 0, lab.id);
  run(g, 30);
  g.ended = true;
  g.events = [];
  return g;
}

describe('time away (2.7 and section 7, bug 2)', () => {
  it('pays nothing while the demo has not ended, and leaves the game alone', () => {
    const g = afterDemo();
    g.ended = false;
    const before = saved(g);
    expect(offlineGains(g, 3600)).toEqual({ credits: 0, a: 0, b: 0, g: 0 });
    expect(saved(g)).toEqual(before);
    expect(g.events).toEqual([]);
  });

  it('after the demo, pays half the live rate', () => {
    const g = afterDemo();
    const rate = Math.pow(1.25, 3); // Market and Lab share the Well evenly
    const before = { credits: g.credits, a: g.data.a, lifetime: g.lifetime };
    const gains = offlineGains(g, 3600);
    expect(gains.credits).toBeCloseTo(0.5 * (rate / 2) * 3600, -2);
    expect(gains.a).toBeCloseTo(0.5 * (rate / 2) * 3600, -2);
    expect(gains.b).toBe(0);
    expect(gains.g).toBe(0);
    expect(g.credits).toBeCloseTo(before.credits + gains.credits, 6);
    expect(g.lifetime).toBeCloseTo(before.lifetime + gains.credits, 6);
    expect(g.data.a).toBeCloseTo(before.a + gains.a, 6);
    expect(g.stats.fromAway).toBeCloseTo(gains.credits, 6);
    // Scales with the time away.
    const g2 = afterDemo();
    expect(offlineGains(g2, 1800).credits).toBeCloseTo(gains.credits / 2, 6);
  });

  it('is estimated on a copy: nothing but credits and Data changes on the live game', () => {
    const g = afterDemo();
    // Things the old estimate got wrong: a queued tech researched for free, sales and time advancing.
    g.queue = ['R2'];
    g.data.a = 79; // one α short: the estimate must not finish the research
    const before = saved(g);
    const nodes = JSON.stringify(g.nodes);
    const gains = offlineGains(g, 7200);
    expect(gains.credits).toBeGreaterThan(0);
    const after = saved(g);
    expect(g.techs).toEqual(['P1', 'R1']);
    expect(g.queue).toEqual(['R2']);
    expect(g.time).toBe(before.time);
    expect(g.sold).toEqual(before.sold);
    expect(JSON.stringify(g.nodes)).toBe(nodes);
    expect(g.events).toEqual([]);
    expect(g.data.a).toBeCloseTo(79 + gains.a, 6);
    // The only differences are the payout itself.
    for (const key of Object.keys(before)) {
      if (['credits', 'lifetime', 'data', 'stats'].includes(key)) continue;
      expect(after[key], key).toEqual(before[key]);
    }
  });

  it('is capped at 2 hours, or 8 with Long Absence', () => {
    const base = afterDemo();
    expect(offlineCap(base)).toBe(2 * 3600);
    const twoHours = offlineGains(deserialize(serialize(base))!, 2 * 3600);
    const tenHours = offlineGains(deserialize(serialize(base))!, 10 * 3600);
    expect(tenHours.credits).toBeCloseTo(twoHours.credits, 6);
    const long = deserialize(serialize(base))!;
    long.techs.push('R4');
    expect(offlineCap(long)).toBe(8 * 3600);
    expect(offlineGains(long, 10 * 3600).credits).toBeCloseTo(twoHours.credits * 4, 3);
  });

  it('Long Absence cannot be researched, or seen, until the demo has ended', () => {
    const g = fresh();
    g.techs = ['P1', 'R1'];
    g.data.a = 1e6;
    expect(techHidden(g, TECHS.R4)).toBe(true);
    expect(techAvailable(g, TECHS.R4)).toBe(false);
    expect(research(g, 'R4')).toBe(false);
    g.queue = ['R4'];
    run(g, 1);
    expect(g.techs).not.toContain('R4');
    g.ended = true;
    expect(techHidden(g, TECHS.R4)).toBe(false);
    expect(techAvailable(g, TECHS.R4)).toBe(true);
    run(g, 0.1); // the queue picks it up
    expect(g.techs).toContain('R4');
  });
});

describe('the end of the demo (2.7)', () => {
  it('the first Lens sets `ended` once, raises one event and records the time', () => {
    const g = rich();
    const m = market(g);
    const line = (deposit: number, y: number) => {
      const w = deposit === 1 ? well(g) : placeNode(g, 'well', 0, 0, { depositId: deposit })!;
      const r = placeNode(g, 'refiner', 400, y)!;
      connect(g, w.id, 0, r.id);
      return r;
    };
    const shard = line(1, 100);
    const shard2 = line(2, 200);
    const ink = line(3, 400);
    const spark = line(4, 540);
    const mist = line(5, 640);
    connect(g, ink.id, 1, placeNode(g, 'void', 700, 700)!.id);
    const glyph = placeNode(g, 'assembler', 700, 450, { recipe: 'glyph' })!;
    connect(g, ink.id, 0, glyph.id);
    connect(g, spark.id, 0, glyph.id);
    const prism = placeNode(g, 'assembler', 700, 150, { recipe: 'prism' })!;
    connect(g, shard.id, 0, prism.id);
    connect(g, shard2.id, 0, prism.id);
    connect(g, mist.id, 0, prism.id);
    const fab = placeNode(g, 'fabricator', 950, 300, { recipe: 'lens' })!;
    connect(g, glyph.id, 0, fab.id);
    connect(g, prism.id, 0, fab.id);
    connect(g, fab.id, 0, m.id);
    expect(g.ended).toBe(false);
    run(g, 120);
    expect(g.made.lens).toBe(true);
    expect(g.ended).toBe(true);
    expect(take(g, 'demo-end').length).toBe(1);
    expect(g.stats.firstLensAt).toBeGreaterThan(0);
    expect(g.stats.firstLensAt).toBe(g.madeAt.lens);
    expect(g.stats.fromSales).toBeGreaterThan(0);
    expect(g.stats.nodesBuilt).toBe(13);
    expect(g.stats.wiresMade).toBe(14);
    const at = g.stats.firstLensAt;
    run(g, 60);
    endDemo(g);
    expect(take(g, 'demo-end').length).toBe(0);
    expect(g.stats.firstLensAt).toBe(at);
    // Claiming the Lens goal later does not end the demo a second time.
    g.goal = { i: 21, ready: false };
    run(g, 0.1);
    expect(activeGoal(g)!.id).toBe('make-lens');
    expect(claimGoal(g)).toBe(true);
    expect(take(g, 'demo-end').length).toBe(0);
  });

  it('keeps credits from sales, goals and orders apart, and sums them up for the end screen', () => {
    const g = fresh();
    connect(g, well(g).id, 0, market(g).id);
    run(g, 10);
    claimGoal(g);
    expect(g.stats.fromGoals).toBe(12);
    expect(g.stats.fromSales).toBeCloseTo(g.credits - 12, 6);
    expect(g.stats.fromSales + g.stats.fromGoals + g.stats.fromOrders + g.stats.fromAway).toBeCloseTo(g.lifetime, 6);
    g.flowBest = 42;
    const end = endStats(g);
    expect(end.playTime).toBeCloseTo(10, 6);
    expect(end.firstLensAt).toBeNull();
    expect(end.totalEarned).toBeCloseTo(g.lifetime, 6);
    expect(end).toMatchObject({ fromGoals: 12, fromOrders: 0, nodesBuilt: 0, wiresMade: 1, ordersFilled: 0, bestFlowStreak: 42, techs: 0, materials: 1 });
  });
});

/** A save exactly as the build before goals, orders and Flow wrote it. */
function oldSave() {
  const ghost = { inb: {}, outb: {}, prog: 0, crafting: false, cycles: 0, status: 'working', util: 1, fBlocked: 0, fStarved: 0, rate: 1, missing: null, blockedOn: null, gain: 0, gainB: {}, grace: 0 };
  const node = (id: number, type: string, x: number, y: number, extra: object = {}) => ({
    id, type, x, y, recipe: null, material: null, depositId: null, lv: { speed: 0, eff: 0, buffer: 0 }, paid: 0, mode: 'even', ...ghost, ...extra,
  });
  const wire = (id: number, from: number, to: number) => ({ id, from, port: 0, to, tier: 0, paid: 0, weight: 1, filter: null, rate: 1, mat: null, mixed: false, budget: 0, flow: 0 });
  return {
    v: 1, nextId: 40,
    nodes: [
      node(10, 'well', 100, 120, { material: 'glint', depositId: 1, lv: { speed: 2, eff: 0, buffer: 0 }, paid: 23 }),
      node(11, 'market', 620, 200),
      node(12, 'well', 100, 260, { material: 'glint', depositId: 2, paid: 12 }),
      node(13, 'refiner', 360, 100, { recipe: 'shard', paid: 50 }),
      node(14, 'lab', 620, 60, { paid: 100 }),
      node(15, 'refiner', 360, 400, { recipe: 'gone-recipe', paid: 58 }),
    ],
    wires: [wire(20, 10, 13), wire(21, 13, 11), wire(22, 12, 11), wire(23, 13, 14), wire(24, 10, 999)],
    deposits: newGame().deposits,
    board: { w: 1240, h: 760, expansions: 0 },
    credits: 321.5, lifetime: 900,
    data: { a: 60, b: 0, g: 0 },
    techs: ['P1', 'R1', 'C1', 'X9', 'P1'],
    queue: ['P2', 'NOPE', 'R1'],
    made: { glint: true, shard: true },
    sold: { glint: 400, shard: 120 },
    soldRate: { glint: 1, shard: 0.25 },
    paused: false, time: 600, savedAt: 1700000000000,
    creditRate: 2, dataRate: { a: 0.75, b: 0, g: 0 },
  };
}

describe('loading saves', () => {
  it('loads a save from before the rule changes and fills every new field', () => {
    const g = deserialize(JSON.stringify(oldSave()))!;
    expect(g).not.toBeNull();
    expect(g.v).toBe(1);
    expect(g.credits).toBe(321.5);
    // Unknown and duplicate tech ids are dropped; the queue loses unknown and owned ids.
    expect(g.techs).toEqual(['P1', 'R1', 'C1']);
    expect(g.queue).toEqual(['P2']);
    // Dangling wires and recipes are dropped as before.
    expect(g.wires.map((w) => w.id)).toEqual([20, 21, 22, 23]);
    expect(g.nodes.find((n) => n.id === 15)!.recipe).toBeNull();
    // New fields get their defaults.
    expect(g.goal).toEqual({ i: 0, ready: false });
    expect(g.order).toBeNull();
    expect(g.ordersOn).toBe(false);
    expect(g.flowOn).toBe(false);
    expect(g.flow).toBe(0);
    expect(g.flowStreak).toBe(0);
    expect(g.flowBest).toBe(0);
    expect(g.flowHold).toBe(0);
    expect(g.ended).toBe(false);
    expect(g.orderSeed).toBe(RULES.orders.seed >>> 0);
    expect(g.demandLeft).toEqual({});
    expect(g.madeAt).toEqual({ glint: 0, shard: 0 });
    expect(g.stats).toEqual(newGame().stats);
    for (const n of g.nodes) expect(n.born).toBe(0);
    // Every field a new game has is present.
    for (const key of Object.keys(newGame())) expect(g[key as keyof Game], key).not.toBeUndefined();
  });

  it('an old save keeps playing: goals already met are claimed one after another', () => {
    const g = deserialize(JSON.stringify(oldSave()))!;
    run(g, 5);
    expect(g.techs).toContain('P2'); // the queued research went through (45α of the 60α saved)
    const claimed: string[] = [];
    while (g.goal.ready && claimed.length < 30) {
      claimed.push(activeGoal(g)!.id);
      claimGoal(g);
    }
    expect(claimed).toEqual([
      'wire-market', 'second-well', 'wire-all-wells', 'build-refiner', 'sell-shard', 'upgrade-well', 'feed-lab', 'research-murk',
    ]);
    expect(activeGoal(g)!.id).toBe('make-ink');
    expect(take(g, 'milestone').length).toBe(0); // materials made before the save are not announced again
    run(g, 30);
    expect(g.credits).toBeGreaterThan(321.5);
  });

  it('an old save that already has a Lens is past the demo, without replaying the ending', () => {
    const raw = oldSave();
    (raw.made as Record<string, boolean>).lens = true;
    const g = deserialize(JSON.stringify(raw))!;
    expect(g.ended).toBe(true);
    run(g, 1);
    expect(take(g, 'demo-end').length).toBe(0);
  });

  it('survives junk in the new fields', () => {
    const raw = {
      ...oldSave(), goal: { i: 'three', ready: 1 }, order: { mat: 'unobtainium', need: 5 },
      stats: { ordersFilled: 2, fromGoals: 'plenty', firstLensAt: 'noon' }, flow: 'lots', orderSeed: null, demandLeft: 7, flowOn: 1,
    };
    const g = deserialize(JSON.stringify(raw))!;
    expect(g.goal).toEqual({ i: 0, ready: true });
    expect(g.order).toBeNull();
    expect(g.stats.ordersFilled).toBe(2);
    expect(g.stats.fromSales).toBe(0);
    expect(g.stats.fromGoals).toBe(0);
    expect(g.stats.firstLensAt).toBeNull();
    expect(g.demandLeft).toEqual({});
    expect(g.flowOn).toBe(true);
    expect(g.flow).toBe(0);
    expect(g.orderSeed).toBe(RULES.orders.seed >>> 0);
    run(g, 1);
    // A half-written order is repaired rather than trusted.
    const half = deserialize(JSON.stringify({ ...oldSave(), ordersOn: true, order: { mat: 'shard', need: 10, ready: true } }))!;
    expect(half.order).toEqual({ mat: 'shard', need: 10, base: 0, got: 0, reward: { credits: 0, a: 0, b: 0, g: 0 }, created: 0, lastProgress: 0, ready: true });
    expect(claimOrder(half)).toBe(true);
    expect(Number.isFinite(half.credits)).toBe(true);
  });

  it('a wire\'s rate bookkeeping from a save is checked too: junk is dropped and measured afresh', () => {
    const g = rich();
    upgrade(g, well(g).id, 'speed');
    const r = placeNode(g, 'refiner', 400, 100)!;
    const feed = connect(g, well(g).id, 0, r.id)!;
    connect(g, well(g).id, 0, market(g).id);
    connect(g, r.id, 0, market(g).id);
    run(g, 30);
    const raw = JSON.parse(serialize(g));
    expect(raw.wires[0].gulp.past.length).toBeGreaterThan(0);
    raw.wires[0].gulp = { n: 'many', t: null, past: 'gone' };
    raw.wires[0].rate = 'fast';
    raw.wires[1].gulp = { n: 1, t: 1, on: 0, idle: 0, armed: true, past: [1, 2, 3], est: 1, max: 2 }; // an odd number of entries
    raw.wires[2].gulp = 7;
    const copy = deserialize(JSON.stringify(raw))!;
    expect(copy.wires.every((w) => w.gulp === undefined)).toBe(true);
    expect(copy.wires[0].rate).toBe(0);
    const before = copy.credits;
    run(copy, 20); // nothing throws, and the readings settle again
    expect(copy.wires.find((w) => w.id === feed.id)!.rate).toBeCloseTo(1, 1);
    expect(copy.credits).toBeGreaterThan(before);
    for (const w of copy.wires) expect(Number.isFinite(w.rate)).toBe(true);
  });

  it('still rejects other save versions', () => {
    expect(deserialize(JSON.stringify({ ...oldSave(), v: 2 }))).toBeNull();
    expect(deserialize('not json')).toBeNull();
  });

  it('round-trips goals, orders, Flow and stats', () => {
    const g = rich();
    connect(g, well(g).id, 0, market(g).id);
    g.flowOn = true;
    g.ordersOn = true;
    run(g, 40);
    claimGoal(g);
    const copy = deserialize(serialize(g))!;
    for (const key of ['goal', 'order', 'orderSeed', 'ordersOn', 'flowOn', 'flow', 'flowStreak', 'flowBest', 'flowHold', 'ended', 'stats', 'madeAt', 'demandLeft'] as const) {
      expect(copy[key], key).toEqual(g[key]);
    }
    expect(copy.nodes.map((n) => n.born)).toEqual(g.nodes.map((n) => n.born));
  });
});

/** A game caught in the middle of things: a part-filled order, a goal waiting to be claimed, Flow running, research queued. */
function midGame(): Game {
  const g = rich();
  g.techs = ['P1', 'R1', 'P2', 'P3'];
  const m = market(g);
  const line = (deposit: number, y: number) => {
    const w = deposit === 1 ? well(g) : placeNode(g, 'well', 0, 0, { depositId: deposit })!;
    const r = placeNode(g, 'refiner', 400, y)!;
    connect(g, w.id, 0, r.id);
    connect(g, r.id, 0, m.id);
    return r;
  };
  line(1, 100);
  const ink = line(3, 400);
  connect(g, ink.id, 1, placeNode(g, 'void', 700, 600)!.id);
  line(4, 540);
  upgrade(g, g.nodes.find((n) => n.material === 'ember')!.id, 'speed'); // or the Spark Refiner is short of Ember and holds Flow back
  for (let i = 0; i < 6; i++) upgrade(g, well(g).id, 'speed'); // the surplus Glint is sold over demand
  connect(g, well(g).id, 0, m.id);
  g.flowOn = true;
  run(g, 40);
  g.ordersOn = true;
  startOrders(g);
  g.goal = { i: GOALS.findIndex((x) => x.id === 'hold-flow'), ready: false };
  g.queue = ['P4'];
  run(g, 12.5);
  g.events = [];
  return g;
}

/** What a save holds, minus the save time and the two per-node fields that are reset on every load. */
function comparable(g: Game) {
  const o = saved(g);
  for (const n of o.nodes) {
    delete n.grace;
    delete n.gain;
    delete n.gainB;
  }
  return o;
}

describe('save → load → save, mid-goal and mid-order', () => {
  it('the game it is taken from really is in the middle of things', () => {
    const g = midGame();
    expect(g.order!.got).toBeGreaterThan(0);
    expect(g.order!.ready).toBe(false);
    expect(g.goal.ready).toBe(true);
    expect(g.flowHold).toBeGreaterThan(10);
    expect(Object.keys(g.demandLeft).length).toBeGreaterThan(0); // demand is partly used up
    expect(g.nodes.some((n) => n.crafting && n.prog > 0)).toBe(true); // a machine is mid-craft
  });

  it('reloading changes nothing that is saved, and a second round trip changes nothing at all', () => {
    const g = midGame();
    const once = deserialize(serialize(g))!;
    expect(comparable(once)).toEqual(comparable(g));
    const twice = deserialize(serialize(once))!;
    expect(saved(twice)).toEqual(saved(once));
    expect(saved(cloneGame(g)!)).toEqual(saved(once));
  });

  it('the reloaded game claims the same goal and the same order for the same pay, once each', () => {
    const g = midGame();
    const copy = deserialize(serialize(g))!;
    expect(copy.goal).toEqual(g.goal);
    expect(goalView(copy)!.ready).toBe(true);
    const credits = copy.credits;
    expect(claimGoal(copy)).toBe(true);
    expect(copy.credits).toBe(credits + goalById('hold-flow')!.reward.credits!);
    expect(claimGoal(g)).toBe(true);
    expect(copy.goal).toEqual(g.goal);
    // Saved after the claim, it stays claimed: a reload cannot pay the same goal again.
    const again = deserialize(serialize(copy))!;
    expect(again.goal).toEqual({ i: copy.goal.i, ready: false });
    expect(claimGoal(again)).toBe(false);
    expect(again.credits).toBe(copy.credits);

    // Both finish the same order at the same moment and are paid the same.
    let seconds = 0;
    while (!g.order!.ready && seconds++ < 300) {
      run(g, 1);
      run(copy, 1);
      expect(copy.order!.got).toBeCloseTo(g.order!.got, 0);
    }
    expect(g.order!.ready).toBe(true);
    run(copy, 1.5);
    expect(copy.order!.ready).toBe(true);
    expect(copy.order!.reward).toEqual(g.order!.reward);
    const before = { g: g.credits, copy: copy.credits };
    expect(claimOrder(g)).toBe(true);
    expect(claimOrder(copy)).toBe(true);
    expect(copy.credits - before.copy).toBe(g.credits - before.g);
    expect(copy.order!.mat).toBe(g.order!.mat); // the next order is the same one too
    expect(claimOrder(copy)).toBe(false);
  });

  it('plays on like the original', () => {
    const g = midGame();
    const copy = deserialize(serialize(g))!;
    const start = g.lifetime;
    run(g, 120);
    run(copy, 120);
    expect((copy.lifetime - start) / (g.lifetime - start)).toBeCloseTo(1, 2);
    expect(copy.flowHold).toBeCloseTo(g.flowHold, 0);
    expect(copy.techs).toEqual(g.techs);
    expect(copy.time).toBeCloseTo(g.time, 6);
  });
});

describe('damaged and old saves cannot poison the game', () => {
  const finiteTotals = (g: Game) => {
    for (const v of [g.credits, g.lifetime, g.time, g.data.a, g.data.b, g.data.g, g.creditRate, g.flow]) expect(Number.isFinite(v)).toBe(true);
  };

  it('numbers that are not numbers never reach the simulation', () => {
    const raw = {
      ...JSON.parse(serialize(midGame())),
      credits: 'lots', lifetime: null, time: 'late', data: { a: 'x', b: -5 },
      demandLeft: { glint: 'x', shard: -3, unobtainium: 2, ink: 0.5 },
      madeAt: { glint: 'early', nope: 4 }, sold: { glint: 'many', bogus: 1, shard: 12 }, soldRate: 7, made: { glint: true, bogus: true, shard: 1 },
    };
    const g = deserialize(JSON.stringify(raw))!;
    expect(g.credits).toBe(0);
    expect(g.data).toEqual({ a: 0, b: 0, g: 0 });
    expect(g.demandLeft).toEqual({ ink: 0.5 });
    expect(g.madeAt).toEqual({ glint: 0, shard: 0 });
    expect(g.sold).toEqual({ shard: 12 });
    expect(g.made).toEqual({ glint: true, shard: true });
    run(g, 30); // used to throw on the unknown material, or turn credits into NaN
    finiteTotals(g);
    expect(g.credits).toBeGreaterThan(0);
  });

  it('an order from a save cannot carry a negative reward or impossible progress', () => {
    const raw = { ...oldSave(), ordersOn: true, order: { mat: 'glint', need: 5, base: -9, got: 99, ready: true, reward: { credits: -500, a: -50, b: 'x', g: 3 } } };
    const g = deserialize(JSON.stringify(raw))!;
    expect(g.order).toMatchObject({ need: 5, base: 0, got: 5, reward: { credits: 0, a: 0, b: 0, g: 3 } });
    const before = { credits: g.credits, a: g.data.a };
    expect(claimOrder(g)).toBe(true);
    expect(g.credits).toBe(before.credits);
    expect(g.data.a).toBe(before.a);
    expect(g.data.g).toBe(3);
  });

  it('Data left far below zero by the old time-away bug is reset, so research is possible again', () => {
    const raw = { ...oldSave(), data: { a: -10760, b: 0, g: 0 }, queue: [], credits: -75 };
    const g = deserialize(JSON.stringify(raw))!;
    expect(g.data.a).toBe(0);
    expect(g.credits).toBe(0); // the old undo bug could leave credits below zero too
    run(g, 60);
    expect(g.data.a).toBeGreaterThan(10);
  });

  it('a save further down the chain than its unlocks is repaired on the first tick', () => {
    // "Goal 17" with no Flow meter could never finish "Hold 75% Flow"; with no Router, never "Route more to a Lab".
    const raw = { ...oldSave(), goal: { i: GOALS.findIndex((x) => x.id === 'hold-flow'), ready: false }, techs: [] };
    const g = deserialize(JSON.stringify(raw))!;
    expect(g.flowOn).toBe(false);
    run(g, 0.05);
    expect(g.flowOn).toBe(true);
    expect(g.ordersOn).toBe(true);
    expect(g.order).not.toBeNull();
    expect([...g.techs].sort()).toEqual(['L1', 'P1', 'R1']); // Market Lens is no longer a goal's to give
    expect(g.ended).toBe(false); // nothing beyond the goals already claimed
    expect(g.credits).toBeCloseTo(321.5, 0); // and no reward is paid again
    expect(g.stats.fromGoals).toBe(0);
    // A consistent save raises no unlock events when it loads.
    const mid = midGame();
    mid.techs.push('L1', 'C1');
    const loaded = deserialize(serialize(mid))!;
    run(loaded, 1);
    expect(take(loaded, 'unlock')).toEqual([]);
    expect(take(loaded, 'tech')).toEqual([]);
  });

  it('saves from the build before the cards had lines: a tip pending, the Flow goal half done, Market Lens owned', () => {
    // What that build wrote: no `edits`, no `goalAt`, no `flowNear`, and Market Lens from "Fill your first order".
    const older = (g: Game) => {
      const raw = JSON.parse(serialize(g));
      delete raw.edits;
      delete raw.goalAt;
      delete raw.flowNear;
      return deserialize(JSON.stringify(raw))!;
    };
    // 1. Saved in the wait for Ember Deposits with a tip on the card, and the card's own line ("study the Ink") not done.
    const g = rich();
    g.techs = ['P1', 'R1', 'P2'];
    g.credits = 300;
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    const shard = placeNode(g, 'refiner', 400, 100)!;
    connect(g, well(g).id, 0, shard.id);
    connect(g, shard.id, 0, m.id);
    connect(g, shard.id, 0, placeNode(g, 'lab', 900, 100)!.id);
    const ink = placeNode(g, 'refiner', 400, 400)!;
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 3 })!.id, 0, ink.id);
    connect(g, ink.id, 0, m.id);
    connect(g, ink.id, 1, placeNode(g, 'void', 700, 600)!.id);
    g.goal = { i: GOALS.findIndex((x) => x.id === 'make-spark'), ready: false };
    run(g, 40);
    const pending = advice(g)!;
    expect(pending.text.mouse).toBe('Place a Well on the free Glint deposit (13¢), wired to the Lab: 1 α each.');
    const step = lineAdvice(g)!;
    expect(step.text.mouse).toBe('Wire the Ink Refiner\'s Ink port to the Lab: Ink is 3 α each in a Lab.');
    const loaded = older(g);
    expect(loaded.edits).toEqual([]);
    run(loaded, 1);
    // The tip is there again at once (nothing says the player has just touched the board), and can be followed.
    const again = advice(loaded)!;
    expect(again.text).toEqual(pending.text);
    expect(again.saves!).toBeGreaterThanOrEqual(15);
    // So is the card's own line for this goal, and its next step (which the tip never repeats).
    expect(goalView(loaded)!.meanwhile).toEqual({ text: 'Drag from the Ink Refiner\'s Ink port to the Lab too: studied Ink is 3 α each.', done: false });
    const stepAgain = lineAdvice(loaded)!;
    expect(stepAgain.text).toEqual(step.text);
    expect(stepAgain.wire).toEqual(step.wire);
    expect(applyAdvice(loaded, stepAgain)).toBe(true);
    expect(goalView(loaded)!.meanwhile!.done).toBe(true);
    expect(lineAdvice(loaded)).toBeNull();
    expect(advice(loaded)).toBeNull(); // and now the adviser keeps quiet for a while, like in any game
    run(loaded, 300);
    expect(loaded.data.a).toBeGreaterThan(TECHS.P3.cost.a!);
    finiteTotals(loaded);

    // 2. Saved in the middle of "Hold 95% Flow" on a board with one producer short: it has 90 s from the load, then the valve.
    const flow = midGame();
    flow.flowHold = 0;
    flow.goal = { i: GOALS.findIndex((x) => x.id === 'hold-flow'), ready: false };
    const ember = flow.nodes.find((n) => n.material === 'ember')!;
    const second = placeNode(flow, 'refiner', 400, 700, { recipe: 'spark' })!; // a second Spark Refiner on the one Ember Well: both go short
    connect(flow, ember.id, 0, second.id);
    connect(flow, second.id, 0, market(flow).id);
    run(flow, 60);
    expect(flow.goal.ready).toBe(false);
    const flowLoaded = older(flow);
    expect(flowLoaded.flowNear).toBe(0);
    run(flowLoaded, 1);
    const view = goalView(flowLoaded)!;
    expect(view.flow!.of - view.flow!.running).toBeGreaterThanOrEqual(1);
    expect(view.flow!.need).toBe(RULES.flow.holdShare);
    run(flowLoaded, 60);
    expect(flowLoaded.goal.ready).toBe(false); // 61 s after the load: the bar still stands
    expect(goalView(flowLoaded)!.flow!.valve).toBeUndefined();
    finiteTotals(flowLoaded);

    // 3. A save that owns Market Lens (and one that went on to Wider Demand) keeps them, and still sees the branch.
    const lens = midGame();
    lens.techs.push('L1', 'C1', 'C2');
    const lensLoaded = older(lens);
    expect(lensLoaded.techs).toEqual(expect.arrayContaining(['C1', 'C2']));
    expect(lensLoaded.seenSurplus).toBe(lens.seenSurplus);
    for (const id of ['C1', 'C2', 'C4', 'C5']) expect(techHidden(lensLoaded, TECHS[id]), id).toBe(false);
    run(lensLoaded, 5);
    expect(lensLoaded.techs.filter((id) => id === 'C1')).toEqual(['C1']);
    // A fresh game, by contrast, sees none of it.
    for (const id of ['C1', 'C2', 'C4', 'C5']) expect(techHidden(fresh(), TECHS[id]), id).toBe(true);
  });

  it('a goal index beyond the list means "everything claimed", not a crash', () => {
    const g = deserialize(JSON.stringify({ ...oldSave(), goal: { i: 9999, ready: true } }))!;
    run(g, 1);
    expect(g.goal).toEqual({ i: GOALS.length, ready: false });
    expect(goalView(g)).toBeNull();
    expect(claimGoal(g)).toBe(false);
    expect(g.ordersOn && g.flowOn && g.ended).toBe(true);
    finiteTotals(g);
  });

  it('a board with no Well and no credits (possible in the old build) is given the price of one', () => {
    const raw = oldSave();
    raw.nodes = raw.nodes.filter((n) => n.type !== 'well');
    raw.credits = 0.4;
    const g = deserialize(JSON.stringify(raw))!;
    expect(g.credits).toBe(10);
    const w = placeNode(g, 'well', 0, 0, { depositId: 1 });
    expect(w).not.toBeNull();
    expect(g.credits).toBe(0);
    expect(deleteNode(g, w!.id)).toBe(false); // and from now on the last Well stays
    // A board that has a Well is left alone, however poor.
    const poor = deserialize(JSON.stringify({ ...oldSave(), credits: 0.4 }))!;
    expect(poor.credits).toBe(0.4);
  });
});

describe('save time (section 7, bug 9)', () => {
  it('stamps the save time when visible, and not while the page is hidden', () => {
    const g = fresh();
    g.savedAt = 1000;
    vi.stubGlobal('document', { hidden: true });
    expect(JSON.parse(serialize(g)).savedAt).toBe(1000);
    expect(g.savedAt).toBe(1000);
    vi.stubGlobal('document', { hidden: false });
    const stamped = JSON.parse(serialize(g)).savedAt;
    expect(stamped).toBeGreaterThan(1700000000000);
    expect(g.savedAt).toBe(stamped);
  });

  it('works where there is no document at all', () => {
    expect(typeof document).toBe('undefined');
    const g = fresh();
    g.savedAt = 1000;
    expect(JSON.parse(serialize(g)).savedAt).toBeGreaterThan(1000);
  });
});

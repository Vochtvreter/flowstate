import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimGoal, claimOrder, connect, placeNode, upgrade } from '../src/actions';
import { RULES, TECHS } from '../src/content';
import { endDemo, endStats, offlineCap, research, techAvailable, techHidden } from '../src/economy';
import { activeGoal } from '../src/goals';
import { offlineGains } from '../src/sim';
import { Game, deserialize, newGame, serialize } from '../src/state';
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

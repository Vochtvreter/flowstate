import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimOrder, connect, cutWire, placeNode, upgrade } from '../src/actions';
import { RULES } from '../src/content';
import { forecast, lookahead, measure } from '../src/forecast';
import {
  makeOrder, marketRates, neededTier, orderCandidates, orderReachesMarket, orderReward, orderView, outputRates, startOrders, stopNewOrders,
} from '../src/orders';
import { Game, Order, deserialize, serialize } from '../src/state';
import { market, rich, run, take, well } from './helpers';

/**
 * A small factory that makes and sells Glint, Shard, Ink (+ Silt) and Spark, in that order of first make.
 * Research still to buy: plenty that costs α, so orders pay α.
 */
function factory(): Game {
  const g = rich();
  g.techs = ['P1', 'R1', 'P2', 'P3'];
  const m = market(g);
  const shard = placeNode(g, 'refiner', 400, 100)!;
  connect(g, well(g).id, 0, shard.id);
  connect(g, shard.id, 0, m.id);
  run(g, 10);
  const murk = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
  const ink = placeNode(g, 'refiner', 400, 400)!;
  connect(g, murk.id, 0, ink.id);
  connect(g, ink.id, 0, m.id);
  connect(g, ink.id, 1, placeNode(g, 'void', 700, 600)!.id);
  run(g, 10);
  const ember = placeNode(g, 'well', 0, 0, { depositId: 4 })!;
  const spark = placeNode(g, 'refiner', 400, 540)!;
  connect(g, ember.id, 0, spark.id);
  connect(g, spark.id, 0, m.id);
  run(g, 30);
  g.events = [];
  return g;
}

function unlock(g: Game) {
  g.ordersOn = true;
  startOrders(g);
}

afterEach(() => vi.restoreAllMocks());

describe('orders (2.5)', () => {
  it('there is no order until Orders are unlocked', () => {
    const g = factory();
    run(g, 5);
    expect(g.order).toBeNull();
    expect(orderView(g)).toBeNull();
    expect(claimOrder(g)).toBe(false);
    expect(take(g, 'order-new').length).toBe(0);
  });

  it('asks for something the player makes right now, never junk, sized to 45–90 s of what reaches Markets', () => {
    const g = factory();
    g.stats.ordersFilled = 1; // the first order has its own, shorter size (below)
    expect(outputRates(g).shard).toBeCloseTo(0.5, 1);
    expect(outputRates(g).spark).toBeCloseTo(0.4, 1);
    // Everything this factory makes is sold, so what reaches Markets is what is made.
    const rates = marketRates(g);
    expect(rates.shard).toBeCloseTo(0.5, 1);
    expect(rates.ink).toBeCloseTo(0.5, 1);
    expect(rates.spark).toBeCloseTo(0.4, 1);
    expect(orderCandidates(g)).toEqual(['spark', 'ink', 'shard']); // newest first; no Silt, no raw materials
    for (let i = 0; i < 200; i++) {
      const o = makeOrder(g);
      expect(['spark', 'ink', 'shard']).toContain(o.mat);
      const rate = rates[o.mat]!;
      expect(o.need).toBeGreaterThanOrEqual(Math.max(RULES.orders.minNeed, Math.floor(rate * RULES.orders.minSeconds) - 2));
      expect(o.need).toBeLessThanOrEqual(Math.ceil(rate * RULES.orders.maxSeconds) + 2);
      expect(o.base).toBe(g.sold[o.mat]);
      expect(o.got).toBe(0);
      expect(o.ready).toBe(false);
      expect(o.created).toBe(g.time);
    }
  });

  it('prefers the newest material', () => {
    const g = factory();
    const count: Record<string, number> = {};
    for (let i = 0; i < 600; i++) {
      const o = makeOrder(g);
      count[o.mat] = (count[o.mat] ?? 0) + 1;
    }
    expect(count.spark).toBeGreaterThan(count.ink);
    expect(count.ink).toBeGreaterThan(count.shard);
    expect(count.spark / 600).toBeCloseTo(RULES.orders.pick[0], 1);
  });

  it('never asks for less than the minimum, and falls back when nothing refined is being made', () => {
    const g = rich();
    connect(g, well(g).id, 0, market(g).id);
    run(g, 10);
    // Only raw Glint is produced: that is what gets asked for.
    expect(orderCandidates(g)).toEqual(['glint']);
    g.stats.ordersFilled = 1;
    const o = makeOrder(g);
    expect(o.mat).toBe('glint');
    expect(o.need).toBeGreaterThanOrEqual(45);
    // Nothing is produced at all (the Well is backed up): still a valid order.
    cutWire(g, g.wires[0].id);
    run(g, 30);
    const idle = makeOrder(g);
    expect(idle.mat).toBe('glint');
    expect(idle.need).toBe(RULES.orders.minNeed);
    // The same holds for a player who has not filled one yet: with nothing selling there is no "quick" first order.
    g.stats.ordersFilled = 0;
    expect(makeOrder(g).need).toBe(RULES.orders.minNeed);
  });

  it('sizes an order from what is sold, not from what is made', () => {
    // Half the Shard is studied: 0.5/s is made, 0.25/s reaches the Market.
    const g = factory();
    g.stats.ordersFilled = 1;
    const shard = g.nodes.find((n) => n.recipe === 'shard')!;
    connect(g, shard.id, 0, placeNode(g, 'lab', 900, 100)!.id);
    run(g, 20);
    expect(outputRates(g).shard).toBeCloseTo(0.5, 1);
    expect(marketRates(g).shard).toBeCloseTo(0.25, 1);
    let seen = 0;
    for (let i = 0; i < 200; i++) {
      const o = makeOrder(g);
      if (o.mat !== 'shard') continue;
      seen++;
      expect(o.need).toBeGreaterThanOrEqual(Math.floor(0.25 * RULES.orders.minSeconds) - 1);
      expect(o.need).toBeLessThanOrEqual(Math.ceil(0.25 * RULES.orders.maxSeconds) + 1); // 23 at most, where output would give 45
    }
    expect(seen).toBeGreaterThan(5);
    // So it really does take 45 to 90 s, with nothing rerouted.
    unlock(g);
    while (g.order!.mat !== 'shard') g.order = makeOrder(g);
    const o = g.order!;
    let seconds = 0;
    while (!o.ready && seconds < 200) {
      run(g, 1);
      seconds++;
    }
    expect(seconds).toBeGreaterThanOrEqual(RULES.orders.minSeconds - 6);
    expect(seconds).toBeLessThanOrEqual(RULES.orders.maxSeconds + 6);
  });

  it('counts a line built a moment ago for what it will sell, and leaves the live game alone', () => {
    const g = factory();
    const mist = placeNode(g, 'refiner', 400, 640)!;
    g.techs.push('P5');
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 5 })!.id, 0, mist.id);
    connect(g, mist.id, 0, market(g).id);
    run(g, 1); // nothing has come out of it yet
    expect(g.soldRate.mist ?? 0).toBe(0);
    const state = () => serialize(g).replace(/"savedAt":\d+/, '');
    const before = state();
    const rates = marketRates(g);
    expect(rates.mist).toBeGreaterThan(0.3); // 0.4/s once it runs
    expect(rates.mist).toBeLessThanOrEqual(0.41);
    expect(state()).toBe(before); // measured on a copy
    expect(forecast(g)).toBe(forecast(g)); // and kept until the board or the clock moves
    const f = forecast(g);
    expect(f.seconds).toBe(40);
    expect(f.credits).toBeCloseTo(0.5 * 3 + 0.5 * 4 + 0.4 * 6 + rates.mist! * 6, 1);
    run(g, 0.05);
    expect(forecast(g)).not.toBe(f);
  });

  it('a look-ahead copy never rolls an order: the one it has can be filled and claimed, then there is none', () => {
    const g = factory();
    unlock(g);
    const seed = g.orderSeed;
    const copy = lookahead(g)!;
    expect(copy.order).toEqual(g.order);
    measure(copy, 200);
    expect(copy.order!.ready).toBe(true);
    expect(claimOrder(copy)).toBe(true);
    expect(copy.stats.ordersFilled).toBe(1);
    expect(copy.order).toBeNull();
    measure(copy, 200);
    expect(copy.order).toBeNull();
    expect(copy.orderSeed).toBe(seed); // no draw was made
    expect(claimOrder(copy)).toBe(false);
    // The live game is where it was.
    expect(g.orderSeed).toBe(seed);
    expect(g.order!.got).toBe(0);
    // An order nobody delivers to simply goes away in a copy.
    const idle = factory();
    unlock(idle);
    stopNewOrders(idle);
    for (const w of [...idle.wires]) cutWire(idle, w.id);
    run(idle, RULES.orders.staleSeconds + 5);
    expect(idle.order).toBeNull();
  });

  /** The board a player has when Orders unlock by following the goal card: Shard sold and studied, Ink sold, Spark with no wire out. */
  function byTheCardAtOrders(): Game {
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3'];
    const m = market(g);
    upgrade(g, well(g).id, 'speed');
    connect(g, well(g).id, 0, m.id);
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 2 })!.id, 0, m.id);
    const shard = placeNode(g, 'refiner', 400, 100)!;
    connect(g, well(g).id, 0, shard.id);
    connect(g, shard.id, 0, m.id);
    connect(g, shard.id, 0, placeNode(g, 'lab', 900, 100)!.id);
    const ink = placeNode(g, 'refiner', 400, 400)!;
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 3 })!.id, 0, ink.id);
    connect(g, ink.id, 0, m.id);
    connect(g, ink.id, 1, placeNode(g, 'void', 700, 600)!.id);
    run(g, 60);
    const spark = placeNode(g, 'refiner', 400, 540)!;
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 4 })!.id, 0, spark.id);
    run(g, 12); // the first Spark is made; the goal is claimed a few seconds later
    g.events = [];
    return g;
  }

  it('the first order asks for something already selling and fills in 30 to 40 s with nothing rerouted', () => {
    for (let seed = 0; seed < 12; seed++) {
      const g = byTheCardAtOrders();
      g.orderSeed = (g.orderSeed + seed * 7919) >>> 0;
      expect(orderCandidates(g)[0]).toBe('ink'); // Spark is newer, but none of it is sold
      const wires = g.wires.length;
      unlock(g);
      const o = g.order!;
      expect(['ink', 'shard']).toContain(o.mat);
      expect(orderView(g)!.reachesMarket).toBe(true);
      // It counts from the instant it appears...
      run(g, 4);
      expect(o.got, `seed ${seed}`).toBeGreaterThan(0);
      // ...and is filled in 30 to 40 seconds, on the wires that were already there.
      let seconds = 4;
      while (!o.ready && seconds < 120) {
        run(g, 1);
        seconds++;
      }
      expect(seconds, `seed ${seed}: ${o.need} ${o.mat}`).toBeGreaterThanOrEqual(30);
      expect(seconds, `seed ${seed}: ${o.need} ${o.mat}`).toBeLessThanOrEqual(40);
      expect(g.wires.length).toBe(wires);
      expect(o.need).toBeGreaterThanOrEqual(RULES.orders.first.minNeed);
    }
  });

  it('stays a first order until one has been filled, even if it is swapped', () => {
    const g = byTheCardAtOrders();
    unlock(g);
    const sized = (o: Order) => o.need / marketRates(g)[o.mat]!;
    expect(sized(g.order!)).toBeGreaterThan(30);
    expect(sized(g.order!)).toBeLessThan(40);
    const again = makeOrder(g, g.order!.mat);
    expect(sized(again)).toBeLessThan(40);
    g.stats.ordersFilled = 1;
    let longer = 0;
    for (let i = 0; i < 40; i++) if (sized(makeOrder(g)) > 44) longer++;
    expect(longer).toBeGreaterThan(30); // 45 to 90 s from then on (a few are held up by the minimum of 8)
  });

  it('prefers what is selling, and says so when the ordered material reaches no Market', () => {
    const g = byTheCardAtOrders();
    g.stats.ordersFilled = 1;
    // Newest first among what is sold, then what is not: Spark has no wire out.
    expect(orderCandidates(g)).toEqual(['ink', 'shard', 'spark']);
    const count: Record<string, number> = {};
    for (let i = 0; i < 400; i++) {
      const o = makeOrder(g);
      count[o.mat] = (count[o.mat] ?? 0) + 1;
      if (o.mat === 'spark') expect(o.need).toBe(RULES.orders.minNeed); // 45–90 s of nothing
    }
    expect(count.ink).toBeGreaterThan(count.shard);
    expect(count.shard).toBeGreaterThan(count.spark);
    expect(count.spark).toBeGreaterThan(0);

    // An order for Spark: the chip can say it is not reaching a Market, at once.
    unlock(g);
    while (g.order!.mat !== 'spark') g.order = makeOrder(g);
    expect(orderReachesMarket(g)).toBe(false);
    let view = orderView(g)!;
    expect(view.reachesMarket).toBe(false);
    expect(view.rate).toBe(0);
    expect(view.eta).toBe(Infinity);
    run(g, 20);
    expect(orderView(g)!.reachesMarket).toBe(false);
    expect(g.order!.got).toBe(0);
    // One wire later it is, as soon as the first Spark is sold.
    const spark = g.nodes.find((n) => n.recipe === 'spark')!;
    connect(g, spark.id, 0, market(g).id);
    run(g, 1);
    view = orderView(g)!;
    expect(view.reachesMarket).toBe(true);
    expect(view.rate).toBeGreaterThan(0);
    expect(view.eta).toBeLessThan(120);
    // A slow trickle still counts between deliveries.
    for (let t = 0; t < 12; t++) {
      run(g, 1);
      expect(orderView(g)!.reachesMarket).toBe(true);
    }
    run(g, 30);
    expect(g.order!.ready).toBe(true);
    expect(orderView(g)!.reachesMarket).toBe(true);
    expect(orderView(g)!.eta).toBe(0);
    // And when the player takes the wire away again, the chip says so after a while.
    expect(claimOrder(g)).toBe(true);
    g.order = { ...makeOrder(g), mat: 'spark', base: g.sold.spark ?? 0 };
    cutWire(g, g.wires.find((w) => w.from === spark.id)!.id);
    run(g, 40);
    expect(orderView(g)!.reachesMarket).toBe(false);
  });

  it('pays mostly Data of the tier the player needs next, plus some credits', () => {
    const g = factory();
    expect(neededTier(g)).toBe('a');
    const r = orderReward(g, 'spark', 30);
    expect(r.a).toBe(90); // what studying 30 Spark would give: 3α each
    expect(r.b).toBe(0);
    expect(r.g).toBe(0);
    expect(r.credits).toBe(90); // half of 30 × 6¢
    expect(r.a).toBeGreaterThanOrEqual(r.credits);

    // Once β is what is missing (and the player has met β), orders pay β instead.
    g.made.glyph = true;
    g.data.a = 1e6;
    g.techs.push('P4');
    expect(neededTier(g)).toBe('b');
    const rb = orderReward(g, 'spark', 30);
    expect(rb.a).toBe(0);
    expect(rb.b).toBe(23); // 90 α-worth is 22.5 β
    // A tier the player has never produced is not paid, even if it is needed.
    g.data.b = 1e6;
    for (const id of ['P5', 'P7']) g.techs.push(id);
    expect(neededTier(g)).not.toBe('g');
    g.made.lens = true;
    expect(neededTier(g)).toBe('g');
  });

  it('counts only items sold after it appeared, becomes ready once, and is claimed with a tap', () => {
    const g = factory();
    const soldBefore = { ...g.sold };
    unlock(g);
    const made = take(g, 'order-new');
    expect(made.length).toBe(1);
    expect(made[0].quiet).toBe(false);
    const o = g.order!;
    expect(made[0].order).toBe(o);
    expect(o.base).toBe(soldBefore[o.mat]);
    expect(o.got).toBe(0);
    run(g, 5);
    expect(o.got).toBeGreaterThan(0);
    expect(o.got).toBeCloseTo(g.sold[o.mat]! - o.base, 6);
    expect(o.ready).toBe(false);
    expect(claimOrder(g)).toBe(false);
    expect(orderView(g)!.need).toBe(o.need);

    run(g, 120); // at most 90 s of output is asked for
    expect(o.ready).toBe(true);
    expect(o.got).toBe(o.need);
    expect(take(g, 'order-ready').length).toBe(1);
    run(g, 30);
    expect(take(g, 'order-ready').length).toBe(0); // once
    expect(g.order).toBe(o); // a filled order waits: no timer, no failure

    const before = { credits: g.credits, a: g.data.a, lifetime: g.lifetime };
    expect(claimOrder(g)).toBe(true);
    expect(g.credits).toBeCloseTo(before.credits + o.reward.credits, 9);
    expect(g.lifetime).toBeCloseTo(before.lifetime + o.reward.credits, 9);
    expect(g.data.a).toBeCloseTo(before.a + o.reward.a, 9);
    expect(g.stats.ordersFilled).toBe(1);
    expect(g.stats.fromOrders).toBe(o.reward.credits);
    const claimed = take(g, 'order-claimed');
    expect(claimed.length).toBe(1);
    expect(claimed[0].reward).toEqual(o.reward);
    // The next order is there at once and starts from zero.
    expect(take(g, 'order-new').length).toBe(1);
    expect(g.order).not.toBe(o);
    expect(g.order!.mat).not.toBe(o.mat); // something else this time
    expect(g.order!.got).toBe(0);
    expect(g.order!.base).toBe(g.sold[g.order!.mat]);
    expect(claimOrder(g)).toBe(false);
  });

  it('quietly swaps an order nobody delivers to for two minutes, for a different material', () => {
    const g = factory();
    unlock(g);
    take(g, 'order-new');
    // Stop selling whatever it asks for.
    const first = g.order!;
    const source = g.nodes.find((n) => n.recipe === first.mat)!;
    cutWire(g, g.wires.find((w) => w.from === source.id && w.port === 0)!.id);
    connect(g, source.id, 0, placeNode(g, 'void', 900, 300)!.id);
    run(g, RULES.orders.staleSeconds - 5);
    expect(g.order).toBe(first);
    expect(take(g, 'order-new').length).toBe(0);
    run(g, 10);
    const swapped = take(g, 'order-new');
    expect(swapped.length).toBe(1);
    expect(swapped[0].quiet).toBe(true);
    expect(g.order).not.toBe(first);
    expect(g.order!.mat).not.toBe(first.mat);
    expect(g.stats.ordersFilled).toBe(0);
    expect(take(g, 'order-claimed').length).toBe(0);
  });

  it('an order with steady deliveries is never swapped, however long it takes', () => {
    const g = factory();
    unlock(g);
    const o = g.order!;
    o.need = 100000;
    run(g, RULES.orders.staleSeconds * 3);
    expect(g.order).toBe(o);
  });

  it('is deterministic: the same play gives the same orders, and never calls Math.random', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used');
    });
    const play = (): Order[] => {
      const g = factory();
      unlock(g);
      const seen: Order[] = [];
      for (let i = 0; i < 6; i++) {
        seen.push({ ...g.order! });
        run(g, 150);
        if (!claimOrder(g)) run(g, 150);
      }
      return seen;
    };
    const a = play();
    const b = play();
    expect(a).toEqual(b);
    expect(new Set(a.map((o) => `${o.mat}:${o.need}`)).size).toBeGreaterThan(1);
  });

  it('keeps its seed in the save: a reloaded game rolls the same next order', () => {
    const g = factory();
    unlock(g);
    run(g, 150);
    const copy = deserialize(serialize(g))!;
    expect(copy.order).toEqual(g.order);
    expect(copy.orderSeed).toBe(g.orderSeed);
    expect(claimOrder(g)).toBe(true);
    expect(claimOrder(copy)).toBe(true);
    expect(copy.order).toEqual(g.order);
    // A different seed gives a different sequence sooner or later.
    const other = deserialize(serialize(g))!;
    other.orderSeed = 12345;
    const seq = (x: Game) => Array.from({ length: 8 }, () => makeOrder(x)).map((o) => `${o.mat}:${o.need}`).join(' ');
    expect(seq(other)).not.toBe(seq(g));
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimOrder, connect, cutWire, placeNode } from '../src/actions';
import { RULES } from '../src/content';
import { makeOrder, neededTier, orderCandidates, orderReward, orderView, outputRates, startOrders } from '../src/orders';
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

  it('asks for something the player makes right now, never junk, sized to 45–90 s of output', () => {
    const g = factory();
    const rates = outputRates(g);
    expect(rates.shard).toBeCloseTo(0.5, 1);
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
    const o = makeOrder(g);
    expect(o.mat).toBe('glint');
    expect(o.need).toBeGreaterThanOrEqual(45);
    // Nothing is produced at all (the Well is backed up): still a valid order.
    cutWire(g, g.wires[0].id);
    run(g, 30);
    const idle = makeOrder(g);
    expect(idle.mat).toBe('glint');
    expect(idle.need).toBe(RULES.orders.minNeed);
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

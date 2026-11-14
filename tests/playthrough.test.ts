// Coarse regression for the tuning: a scripted player (no bot, no cleverness) does exactly what the goal
// card asks. If a price or a reward drifts so far that the opening no longer chains, this fails.
import { describe, expect, it } from 'vitest';
import { claimGoal, connect, placeNode, upgrade } from '../src/actions';
import { has, nodeCost, research, upgradeCost } from '../src/economy';
import { GOALS, activeGoal } from '../src/goals';
import { Game, GNode } from '../src/state';
import { fresh, market, run, well } from './helpers';

/** A player who follows the card: claims in order and keeps a tally of reward money against purchases. */
function player(g: Game) {
  const p = {
    /** Reward credits claimed so far minus everything bought. Never negative = sales were not needed. */
    purse: 0,
    claimed: [] as string[],
    longestWait: 0,
    /** The active goal must be `id`, done and claimable. */
    claim(id: string) {
      run(g, 0.5); // one beat for the game to notice, as a person would need
      expect(activeGoal(g)!.id).toBe(id);
      expect(g.goal.ready, `"${activeGoal(g)!.title}" should be done`).toBe(true);
      const reward = activeGoal(g)!.reward;
      expect(claimGoal(g)).toBe(true);
      p.purse += reward.credits ?? 0;
      p.claimed.push(id);
    },
    /** Buy something that the rewards claimed so far must cover on their own. */
    pay<T>(what: string, price: number, buy: () => T): NonNullable<T> {
      expect(price, `${what} costs ${price}¢ but the rewards so far have only left ${p.purse}¢`).toBeLessThanOrEqual(p.purse);
      const before = g.credits;
      const got = buy();
      expect(got, what).toBeTruthy();
      expect(before - g.credits).toBeCloseTo(price, 6);
      p.purse -= price;
      return got as NonNullable<T>;
    },
    /** Let the game run until `ready()` holds; fails if that takes longer than `limit` seconds. */
    wait(what: string, limit: number, ready: () => boolean) {
      let waited = 0;
      let ok = ready(); // `ready` may be an action that only succeeds once, such as researching a tech
      while (!ok && waited < limit) {
        run(g, 1);
        waited++;
        ok = ready();
      }
      expect(ok, `${what}: still not there after ${limit}s`).toBe(true);
      p.longestWait = Math.max(p.longestWait, waited);
    },
  };
  return p;
}

/** Goals 1 to 7, played without a pause: wire, second Well, Refiner, first Shard, Well upgrade, Lab. */
function opening(g: Game) {
  const p = player(g);
  const w1 = well(g);
  const m = market(g);

  connect(g, w1.id, 0, m.id);
  p.claim('wire-market');

  const w2 = p.pay('the second Well', nodeCost(g, 'well'), () => placeNode(g, 'well', 0, 0, { depositId: 2 }));
  p.claim('second-well');

  connect(g, w2.id, 0, m.id);
  p.claim('wire-all-wells');
  expect(has(g, 'P1')).toBe(true);

  const refiner = p.pay('the first Refiner', nodeCost(g, 'refiner'), () => placeNode(g, 'refiner', 400, 100));
  connect(g, w1.id, 0, refiner.id);
  p.claim('build-refiner');

  connect(g, refiner.id, 0, m.id);
  run(g, 6); // two Glint in, two seconds of refining, one Shard out and sold
  p.claim('sell-shard');
  expect(has(g, 'R1')).toBe(true);

  p.pay('a Well upgrade', upgradeCost(w1, 'speed'), () => upgrade(g, w1.id, 'speed'));
  p.claim('upgrade-well');

  const lab = p.pay('the first Lab', nodeCost(g, 'lab'), () => placeNode(g, 'lab', 700, 100));
  connect(g, refiner.id, 0, lab.id);
  run(g, 6);
  p.claim('feed-lab');
  return { p, w1, w2, m, refiner, lab };
}

describe('scripted playthrough', () => {
  it('the first five goals (and the two after) are claimed in order, every purchase paid for by the rewards before it', () => {
    const g = fresh();
    const { p } = opening(g);
    expect(p.claimed.slice(0, 5)).toEqual(GOALS.slice(0, 5).map((x) => x.id));
    expect(p.claimed).toEqual(GOALS.slice(0, 7).map((x) => x.id));
    // Reward money alone bought the Well, the Refiner, the upgrade and the Lab: nothing had to be waited for.
    expect(p.purse).toBeGreaterThanOrEqual(0);
    expect(g.time).toBeLessThan(30);
    expect(g.credits).toBeGreaterThanOrEqual(p.purse);
    expect(g.stats.fromGoals).toBe(GOALS.slice(0, 7).reduce((s, x) => s + (x.reward.credits ?? 0), 0));
  });

  it('doing only what the card asks reaches Orders in a few minutes, with no wait over two and a half', () => {
    const g = fresh();
    const { p, m, lab } = opening(g);
    const build = (what: string, limit: number, price: () => number, make: () => GNode | null): GNode => {
      p.wait(`credits for ${what}`, limit, () => g.credits >= price());
      const n = make();
      expect(n, what).not.toBeNull();
      return n!;
    };

    // Goal 8: the first research is the first real wait.
    p.wait('α for Murk Deposits', 90, () => research(g, 'P2'));
    p.claim('research-murk');

    // Goal 9: a Well on the Murk deposit and a Refiner from its port.
    const murk = build('the Murk Well', 30, () => nodeCost(g, 'well'), () => placeNode(g, 'well', 0, 0, { depositId: 3 }));
    const ink = build('the Ink Refiner', 60, () => nodeCost(g, 'refiner'), () => placeNode(g, 'refiner', 400, 420));
    connect(g, murk.id, 0, ink.id);
    expect(ink.recipe).toBe('ink');
    connect(g, ink.id, 0, m.id);
    p.wait('the first Ink', 15, () => !!g.made.ink);
    p.claim('make-ink');

    // Goal 10: the Silt needs an exit before the Refiner jams.
    const sink = placeNode(g, 'void', 700, 560)!;
    connect(g, ink.id, 1, sink.id);
    p.wait('the Ink Refiner running', 20, () => g.goal.ready);
    p.claim('silt-exit');
    connect(g, ink.id, 0, lab.id); // study some Ink too, as the Lab goal taught

    // Goal 11: Ember Deposits, an Ember Well and a Spark Refiner.
    p.wait('α for Ember Deposits', 150, () => research(g, 'P3'));
    const ember = build('the Ember Well', 30, () => nodeCost(g, 'well'), () => placeNode(g, 'well', 0, 0, { depositId: 4 }));
    const spark = build('the Spark Refiner', 60, () => nodeCost(g, 'refiner'), () => placeNode(g, 'refiner', 400, 560));
    connect(g, ember.id, 0, spark.id);
    expect(spark.recipe).toBe('spark');
    connect(g, spark.id, 0, m.id);
    p.wait('the first Spark', 15, () => !!g.made.spark);
    p.claim('make-spark');

    expect(p.claimed).toEqual(GOALS.slice(0, 11).map((x) => x.id));
    expect(g.ordersOn).toBe(true);
    expect(g.order).not.toBeNull();
    expect(p.longestWait).toBeLessThan(150);
    expect(g.time).toBeLessThan(6 * 60);
    expect(g.credits).toBeGreaterThanOrEqual(0);
  });
});

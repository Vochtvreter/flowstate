// Coarse regression for the tuning: a scripted player (no bot, no cleverness) does exactly what the goal
// card asks. If a price or a reward drifts so far that the opening no longer chains, this fails.
import { describe, expect, it } from 'vitest';
import { claimGoal, claimOrder, connect, expandBoard, placeNode, setMode, setWeight, upgrade } from '../src/actions';
import { NodeType, RECIPES, TECHS } from '../src/content';
import { expansionCost, has, nodeCost, research, techAffordable, upgradeCost } from '../src/economy';
import { GOALS, MAIN_GOALS, activeGoal, goalById } from '../src/goals';
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

// ---------------------------------------------------------------------------------------------------
// The whole demo, by the card.
//
// A player who does ONLY what each goal card says, in the card's own words, one action every six seconds:
// no upgrade the card did not ask for, no second Lab, no extra machines, no side techs. This is the floor
// for a newcomer, and it is not the pacing bot's "slow" policy: that bot wires every Refiner to a Lab,
// builds Routers for Data and upgrades whatever it can, all unprompted.
//
// The test proves that every goal can be done from the state the one before leaves behind. It also pins
// how long this player waits. As tuned, they are held up by α Data, not credits: three to six minutes each
// on Spark, Glyph, Mist and the Fabricator, with thousands of credits in the bank. Three of those are over
// the plan's four minutes on one goal; see the bounds at the end.
// ---------------------------------------------------------------------------------------------------

/** Plays the demo to the first Lens by the card. `studyAll`: also wires every new Refiner to the Lab, as goal 7 taught for Shard. */
function byTheCard(studyAll: boolean) {
  const g = fresh();
  const HANDS = 6; // seconds per action
  const spent: { id: string; title: string; seconds: number; waitedFor: string }[] = [];
  let last = 0;
  let waitedFor = '';
  const m = market(g);
  const act = () => run(g, HANDS);

  /** "Keep an eye on the order card: send what it asks for to a Market, then claim it." */
  const tendOrder = () => {
    const o = g.order;
    if (!o) return;
    if (o.ready) {
      act();
      claimOrder(g);
      return;
    }
    for (const n of g.nodes) {
      const port = n.recipe ? RECIPES[n.recipe].outputs.findIndex((out) => out[0] === o.mat) : -1;
      if (port < 0 || g.wires.some((w) => w.from === n.id && w.port === port && w.to === m.id)) continue;
      act();
      connect(g, n.id, port, m.id);
    }
  };
  /** Let the game run until `ready()`; orders are tended meanwhile. Fails after 15 minutes: that would be a wall. */
  const wait = (what: string, ready: () => boolean) => {
    const from = g.time;
    while (!ready()) {
      expect(g.time - from, `still waiting for ${what} after 15 minutes`).toBeLessThan(900);
      run(g, 1);
      tendOrder();
    }
    if (g.time - from > 30) waitedFor = what;
  };
  const claim = (id: string) => {
    expect(activeGoal(g)!.id).toBe(id);
    wait(`"${activeGoal(g)!.title}" to complete`, () => g.goal.ready);
    act();
    expect(claimGoal(g)).toBe(true);
    spent.push({ id, title: goalById(id)!.title, seconds: g.time - last, waitedFor });
    last = g.time;
    waitedFor = '';
  };
  const buy = (type: NodeType, opts: { depositId?: number; recipe?: string } = {}): GNode => {
    wait(`credits for a ${type}`, () => g.credits >= nodeCost(g, type));
    act();
    const n = placeNode(g, type, 300 + 60 * g.nodes.length, 60 + 45 * g.nodes.length, opts);
    expect(n, type).not.toBeNull();
    return n!;
  };
  const wire = (from: GNode, to: GNode, port = 0) => {
    act();
    expect(connect(g, from.id, port, to.id), `${from.type} → ${to.type}`).not.toBeNull();
  };
  /** "Build X from a port": place it and wire it in one gesture. */
  const from = (source: GNode, type: NodeType, port = 0): GNode => {
    const n = buy(type);
    expect(connect(g, source.id, port, n.id)).not.toBeNull();
    return n;
  };
  const study = (id: string) => {
    wait(`${id === 'P7' ? 'α and β' : 'α'} for ${TECHS[id].name}`, () => techAffordable(g, TECHS[id]));
    act();
    expect(research(g, id)).toBe(true);
  };

  // 1–7: the opening.
  const w1 = well(g);
  wire(w1, m);
  claim('wire-market');
  const w2 = buy('well', { depositId: 2 });
  claim('second-well');
  wire(w2, m);
  claim('wire-all-wells');
  const shard = from(w1, 'refiner');
  claim('build-refiner');
  wire(shard, m);
  claim('sell-shard');
  wait('credits for a Well upgrade', () => g.credits >= upgradeCost(w1, 'speed'));
  act();
  expect(upgrade(g, w1.id, 'speed')).toBe(true);
  claim('upgrade-well');
  const lab = from(shard, 'lab');
  claim('feed-lab');
  // 8–11: Murk, Silt, Ember.
  study('P2');
  claim('research-murk');
  const ink = from(buy('well', { depositId: 3 }), 'refiner');
  expect(ink.recipe).toBe('ink');
  claim('make-ink');
  wire(ink, m); // "sell the Ink at the Market..."
  from(ink, 'void', 1); // "...then pick Void for the Silt"
  claim('silt-exit');
  if (studyAll) wire(ink, lab);
  study('P3');
  const spark = from(buy('well', { depositId: 4 }), 'refiner');
  expect(spark.recipe).toBe('spark');
  claim('make-spark');
  if (studyAll) wire(spark, lab);
  // 12–14: orders, the Router, the board.
  claim('first-order');
  const router = from(ink, 'router'); // "Build a Router from a machine's port..."
  const toLab = connect(g, router.id, 0, lab.id)!; // "...wire it to a Lab and to a Market..."
  act();
  wire(router, m);
  act();
  setMode(g, router.id, 'ratio'); // "...set it to Ratio and give the Lab the bigger share"
  setWeight(g, toLab.id, 3);
  claim('route-lab');
  wait('credits to expand the board', () => g.credits >= expansionCost(g));
  act();
  expect(expandBoard(g)).toBe(true);
  claim('expand');
  // 15–17: Glyph, Flow, β.
  study('P4');
  const glyph = buy('assembler', { recipe: 'glyph' });
  wire(ink, glyph);
  wire(spark, glyph);
  claim('make-glyph');
  claim('hold-flow');
  wire(glyph, lab); // "Drag from the Assembler's port to a Lab"
  claim('study-glyph');
  // 18–20: Mist, Prism, three orders.
  study('P5');
  const mist = from(buy('well', { depositId: 5 }), 'refiner');
  expect(mist.recipe).toBe('mist');
  claim('make-mist');
  if (studyAll) wire(mist, lab);
  const prism = buy('assembler', { recipe: 'prism' });
  wire(shard, prism);
  wire(mist, prism);
  claim('make-prism');
  claim('three-orders');
  // 21–22: the Fabricator and the Lens.
  study('P7');
  const fab = buy('fabricator', { recipe: 'lens' });
  claim('build-fabricator');
  wire(prism, fab);
  wire(glyph, fab);
  claim('make-lens');
  return { g, spent };
}

describe('the whole demo, by the card', () => {
  it('every goal can be done, in order, by doing only what its card says', () => {
    const { g, spent } = byTheCard(false);
    for (const v of [false, true]) { const r = byTheCard(v); console.log(v, Math.round(r.g.stats.firstLensAt!), r.spent.filter((x) => x.seconds > 120).map((x) => `${x.title} ${Math.round(x.seconds)}s (${x.waitedFor})`).join(' | '), Math.round(r.g.stats.fromSales + r.g.stats.fromGoals + r.g.stats.fromOrders), r.g.stats.ordersFilled); }
    expect(spent.map((x) => x.id)).toEqual(GOALS.slice(0, MAIN_GOALS).map((x) => x.id));
    expect(g.ended).toBe(true);
    expect(g.stats.firstLensAt).not.toBeNull();
    expect(g.credits).toBeGreaterThanOrEqual(0);
    // Nothing the card did not ask for: one Lab, no side techs, one upgrade.
    expect(g.nodes.filter((n) => n.type === 'lab').length).toBe(1);
    expect([...g.techs].sort()).toEqual(['C1', 'L1', 'P1', 'P2', 'P3', 'P4', 'P5', 'P7', 'R1']);
    expect(g.nodes.reduce((s, n) => s + n.lv.speed + n.lv.eff + n.lv.buffer, 0)).toBe(1);
  });

  it('gets this player to the Lens inside the 28 minutes the plan allows a slow player', () => {
    const { g } = byTheCard(false);
    expect(g.stats.firstLensAt!).toBeLessThan(28 * 60); // 25:08 as tuned
    expect(g.stats.firstLensAt!).toBeGreaterThan(20 * 60); // and the demo is not over in a flash either
  });

  it('but keeps them waiting on Data: KNOWN GAP, three goals take longer than the plan\'s four minutes', () => {
    const { g, spent } = byTheCard(false);
    const long = spent.filter((x) => x.seconds > 180);
    // What they wait for is always Data, never credits...
    expect(long.map((x) => `${x.title}: ${x.waitedFor}`)).toEqual([
      'Make your first Spark: α for Ember Deposits',
      'Assemble your first Glyph: α for Assembly',
      'Make your first Mist: α for Breeze Deposits',
      'Build a Fabricator: α and β for Fabrication',
    ]);
    // ...while credits pile up with nothing on the card to spend them on.
    expect(g.stats.fromSales + g.stats.fromGoals + g.stats.fromOrders).toBeGreaterThan(8000);
    // As tuned: 185 s, 317 s, 367 s and 272 s. The bounds stop it getting worse; the plan's own limit is 240 s,
    // so lowering them is the goal. (Decision for the designer: cheaper spine techs, or a card that teaches
    // feeding the Lab; see the next test for what one habit is worth.)
    expect(Math.max(...spent.map((x) => x.seconds))).toBeLessThan(400);
    expect(spent.filter((x) => x.seconds > 240).length).toBeLessThanOrEqual(3);
  });

  it('one habit the cards never ask for, wiring every Refiner to the Lab, saves this player over three minutes', () => {
    const plain = byTheCard(false);
    const studious = byTheCard(true);
    expect(studious.g.stats.firstLensAt!).toBeLessThan(plain.g.stats.firstLensAt! - 180);
    expect(studious.g.stats.firstLensAt!).toBeLessThan(23 * 60); // 21:24 as tuned
    expect(Math.max(...studious.spent.map((x) => x.seconds))).toBeLessThan(320); // 297 s on Mist: still over four minutes
  });
});

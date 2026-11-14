// The adviser (src/advice.ts): what it says, and above all that what it says is true.
import { describe, expect, it } from 'vitest';
import { claimOrder, connect, cutWire, favour, placeNode, setMode, upgrade } from '../src/actions';
import { ADVICE, Advice, advice, adviceTrials, applyAdvice, waitInfo, waitKind } from '../src/advice';
import { RULES, TECHS } from '../src/content';
import { nodeCost, techAffordable } from '../src/economy';
import { flowInfo } from '../src/flow';
import { lookahead } from '../src/forecast';
import { GOALS, activeGoal } from '../src/goals';
import { makeOrder, orderReward, orderView, startOrders } from '../src/orders';
import { tick } from '../src/sim';
import { Game, cloneGame, serialize } from '../src/state';
import { playByTheCard } from './cardPlayer';
import { fresh, market, rich, run, well } from './helpers';

const at = (g: Game, id: string) => { g.goal = { i: GOALS.findIndex((x) => x.id === id), ready: false }; };
const state = (g: Game) => serialize(g).replace(/"savedAt":\d+/, '');

/**
 * The truth a tip is held to: run a copy of the game forward at the game's own pace until the wait it is in
 * ends, with nobody playing (the order it has is claimed when it fills; no new one is rolled).
 * Returns the seconds that took, or Infinity after `limit`.
 */
function waitEnds(copy: Game, limit: number, dt = 0.1): number {
  const kind = waitKind(copy);
  const goal = copy.goal.i;
  const filled = copy.stats.ordersFilled;
  const over = () => copy.goal.i !== goal || copy.goal.ready
    || (kind === 'order' ? copy.stats.ordersFilled > filled : kind === 'flow' ? false : waitKind(copy) !== kind);
  if (over()) return 0;
  for (let t = dt; t <= limit; t += dt) {
    tick(copy, dt);
    if (copy.order?.ready) claimOrder(copy);
    if (over()) return t;
  }
  return Infinity;
}

/** How the same wait goes with the tip and without it. */
function trial(g: Game, a: Advice, limit = 900) {
  const withTip = lookahead(g)!;
  const without = lookahead(g)!;
  const applied = applyAdvice(withTip, a);
  return { applied, tip: applied ? waitEnds(withTip, limit) : Infinity, idle: waitEnds(without, limit), withTip, without };
}

/** Wording every tip must keep to. */
function checkWording(a: Advice) {
  for (const text of [a.text.mouse, a.text.touch]) {
    expect(text.length, text).toBeGreaterThan(20);
    expect(text.length, text).toBeLessThan(200);
    expect(text.endsWith('.'), text).toBe(true);
    expect(text.slice(0, -1), `one sentence: ${text}`).not.toMatch(/[.!?] /);
    expect(text, text).not.toMatch(/undefined|NaN|null|\[object/);
    expect(text, text).not.toMatch(/\b(key|Ctrl|Shift|Delete|Backspace|Esc)\b/);
  }
  expect(a.text.touch, a.text.touch).not.toMatch(/\b(click|drag|press)\b/i);
  expect(a.text.mouse, a.text.mouse).not.toMatch(/\btap\b/i);
  // The price is in the sentence when there is one.
  if (a.cost) expect(a.text.mouse, a.text.mouse).toContain(`${Math.round(a.cost)}¢`);
  if (a.research) expect(a.text.mouse).toContain(TECHS[a.research].name);
}

/** A small factory in the middle of the game: Shard sold and studied, Ink sold with its Silt dumped, Ember sold raw. */
function midGame(): Game {
  const g = rich();
  g.techs = ['P1', 'R1', 'P2', 'P3', 'L1', 'C1'];
  g.credits = 400;
  const m = market(g);
  upgrade(g, well(g).id, 'speed');
  connect(g, well(g).id, 0, m.id);
  const shard = placeNode(g, 'refiner', 400, 100)!;
  connect(g, well(g).id, 0, shard.id);
  connect(g, shard.id, 0, m.id);
  connect(g, shard.id, 0, placeNode(g, 'lab', 900, 100)!.id);
  const ink = placeNode(g, 'refiner', 400, 400)!;
  connect(g, placeNode(g, 'well', 0, 0, { depositId: 3 })!.id, 0, ink.id);
  connect(g, ink.id, 0, m.id);
  connect(g, ink.id, 1, placeNode(g, 'void', 700, 600)!.id);
  connect(g, placeNode(g, 'well', 0, 0, { depositId: 4 })!.id, 0, m.id);
  run(g, 40);
  g.events = [];
  return g;
}

describe('waitInfo: what the card is waiting for', () => {
  it('is null unless the active goal is saving for something it cannot pay yet', () => {
    const g = fresh();
    expect(waitInfo(g)).toBeNull(); // "Wire the Well to the Market" asks for an action
    expect(waitKind(g)).toBeNull();
    connect(g, well(g).id, 0, market(g).id);
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
    expect(waitInfo(g)).toBeNull(); // ready to claim
    at(g, 'second-well');
    g.credits = nodeCost(g, 'well');
    expect(waitInfo(g)).toBeNull(); // can be paid for now: that is an action, not a wait
    g.credits = 4;
    expect(waitKind(g)).toBe('credits');
    const w = waitInfo(g)!;
    expect(w.unit).toBe('¢');
    expect(w.have).toBe(4);
    expect(w.need).toBe(12); // the second Well
    expect(w.eta).toBeCloseTo(8, 0); // 1¢ a second from the one Well
    g.goal = { i: GOALS.length, ready: false };
    expect(waitInfo(g)).toBeNull(); // every goal claimed
  });

  it('gives Infinity when nothing is coming in', () => {
    const g = fresh();
    at(g, 'second-well');
    expect(waitInfo(g)).toEqual({ unit: '¢', have: 0, need: 12, eta: Infinity });
    at(g, 'research-murk');
    g.techs = ['P1', 'R1'];
    expect(waitInfo(g)).toEqual({ unit: 'α', have: 0, need: 45, eta: Infinity });
  });

  it('for a tech with two prices, names the one that takes longest', () => {
    const g = midGame();
    g.techs.push('P4', 'P5');
    at(g, 'build-fabricator');
    g.data = { a: 100, b: 90, g: 0 };
    // α is coming in (Shard is studied), β is not: β is what the player is really waiting for.
    let w = waitInfo(g)!;
    expect(waitKind(g)).toBe('data');
    expect(w).toMatchObject({ unit: 'β', have: 90, need: 100, eta: Infinity });
    g.data.b = 100;
    w = waitInfo(g)!;
    expect(w.unit).toBe('α');
    expect(w.need).toBe(700);
    expect(w.eta).toBeGreaterThan(600 / 0.75 - 40); // 0.25 Shard/s at 3 α each: about 800 s
    expect(w.eta).toBeLessThan(600 / 0.75 + 40);
    // Researched: the same goal now waits for the Fabricator's price.
    g.techs.push('P7');
    g.credits = 100;
    w = waitInfo(g)!;
    expect(w.unit).toBe('¢');
    expect(w.need).toBe(nodeCost(g, 'fabricator'));
    expect(w.have).toBe(100);
    g.credits = 1e6;
    expect(waitInfo(g)).toBeNull();
  });

  it('counts a goal that asks for Data in hand, and leaves Flow and orders to waitKind', () => {
    const g = midGame();
    at(g, 'study-glyph');
    g.data.b = 4;
    expect(waitInfo(g)).toMatchObject({ unit: 'β', have: 4, need: 10 });
    at(g, 'hold-flow');
    expect(waitInfo(g)).toBeNull();
    expect(waitKind(g)).toBe('flow');
    at(g, 'first-order');
    expect(waitKind(g)).toBeNull(); // no order yet
    g.ordersOn = true;
    startOrders(g);
    expect(waitKind(g)).toBe('order');
    expect(waitInfo(g)).toBeNull();
    g.order!.ready = true;
    expect(waitKind(g)).toBeNull(); // the card says: claim it
  });
});

describe('advice: the repertoire, one board at a time', () => {
  it('says nothing when there is no wait, or the wait is nearly over', () => {
    const g = midGame();
    at(g, 'wire-market');
    expect(advice(g)).toBeNull();
    at(g, 'expand');
    g.credits = 195; // 200 needed, a few credits a second coming in
    expect(waitInfo(g)!.eta).toBeLessThan(ADVICE.minWait);
    expect(advice(g)).toBeNull();
  });

  it('Data wait: wire something better into the Lab, and say why', () => {
    const g = midGame();
    at(g, 'make-glyph'); // Assembly: 800 α
    const a = advice(g)!;
    expect(a.kind).toBe('data');
    expect(a.wire).toBeDefined();
    // Silt is thrown away and Ink is sold; both are worth 3 α in the Lab and save the same time. Silt costs no sales.
    expect(a.text.mouse).toBe('Drag from the Ink Refiner\'s Silt port to the Lab: Silt is worth 3 α each in a Lab, and you are throwing it away.');
    expect(a.text.touch).toBe('Tap the Ink Refiner\'s Silt port, then tap the Lab: Silt is worth 3 α each in a Lab, and you are throwing it away.');
    expect(a.cost).toBe(0);
    expect(a.steps).toBe(1);
    expect(a.saves!).toBeGreaterThan(60);
    expect(a.eta).toBeGreaterThan(a.saves!);
    checkWording(a);
    const t = trial(g, a);
    expect(t.applied).toBe(true);
    expect(t.tip).toBeLessThan(t.idle);
    // "Worth more Data than": a Lab that studies raw Glint is offered Shard.
    const h = rich();
    h.techs = ['P1', 'R1'];
    const shard = placeNode(h, 'refiner', 400, 100)!;
    connect(h, well(h).id, 0, shard.id);
    connect(h, shard.id, 0, market(h).id);
    const second = placeNode(h, 'well', 0, 0, { depositId: 2 })!;
    connect(h, second.id, 0, placeNode(h, 'lab', 900, 100)!.id);
    run(h, 30);
    at(h, 'research-murk');
    h.data.a = 0;
    h.credits = 0;
    TECHS.P2.cost = { a: 400 };
    try {
      const b = advice(h)!;
      expect(b.text.mouse).toBe('Drag from the Shard Refiner\'s port to the Lab: Shard is worth more Data than Glint.');
      expect(trial(h, b).tip).toBeLessThan(trial(h, b).idle);
    } finally {
      TECHS.P2.cost = { a: 45 };
    }
  });

  it('Data wait: a full Lab is sped up, and when that is not enough a second Lab is built', () => {
    const g = midGame();
    const lab = g.nodes.find((n) => n.type === 'lab')!;
    // Give the Lab more than it can study: both Refiners and two Wells.
    for (const n of g.nodes) if ((n.recipe === 'ink' || n.type === 'well') && n.id !== well(g).id) connect(g, n.id, 0, lab.id);
    connect(g, g.nodes.find((n) => n.recipe === 'ink')!.id, 1, lab.id);
    run(g, 30);
    expect(lab.util).toBeGreaterThan(0.95);
    at(g, 'make-glyph');
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const a = advice(g);
      if (!a) break;
      checkWording(a);
      const t = trial(g, a);
      expect(t.tip, a.text.mouse).toBeLessThan(t.idle);
      seen.add(a.upgrade ? `upgrade ${g.nodes.find((n) => n.id === a.node)!.type}` : a.build ? `build ${a.build}` : a.research ? `research ${a.research}` : 'other');
      expect(applyAdvice(g, a)).toBe(true);
      run(g, 20);
    }
    // More Lab is what this board needs: a faster Lab, a second one, or Lab Speed.
    expect([...seen].some((x) => x === 'upgrade lab' || x === 'build lab' || x === 'research R2'), [...seen].join()).toBe(true);
  });

  it('credits wait: sell what backs up or is not sold at all', () => {
    const g = midGame();
    g.credits = 0;
    // A Mist line whose Refiner has no wire out, as the goal card leaves it.
    g.techs.push('P5');
    const mist = placeNode(g, 'refiner', 400, 640, { recipe: 'mist' });
    expect(mist).toBeNull(); // no credits: build it the honest way
    g.credits = 200;
    const breeze = placeNode(g, 'well', 0, 0, { depositId: 5 })!;
    const refiner = placeNode(g, 'refiner', 400, 640)!;
    connect(g, breeze.id, 0, refiner.id);
    run(g, 20);
    g.credits = 0;
    at(g, 'make-prism'); // an Assembler: 600¢
    const a = advice(g)!;
    expect(a.kind).toBe('credits');
    expect(a.text.mouse).toBe('Drag from the Mist Refiner\'s port to the Market: nothing is done with its Mist, which sells for 6¢ each.');
    expect(a.wire).toEqual({ from: refiner.id, to: market(g).id, port: 0 });
    expect(a.node).toBe(refiner.id);
    checkWording(a);
    const t = trial(g, a);
    expect(t.tip).toBeLessThan(t.idle - 20);
    expect(a.saves!).toBeGreaterThan(20);
  });

  it('credits wait: names what is over demand, and does not tell the player to make more of it', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'P2'];
    const m = market(g);
    for (let i = 0; i < 6; i++) upgrade(g, well(g).id, 'speed'); // 3.8 Glint/s against a demand of 2
    connect(g, well(g).id, 0, m.id);
    const murk = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    connect(g, murk.id, 0, placeNode(g, 'void', 700, 600)!.id); // made, and thrown away
    run(g, 60);
    expect(g.seenSurplus).toBe(true);
    g.credits = 30;
    at(g, 'make-glyph');
    g.techs.push('P4'); // researched: the wait is for the Assembler's 600¢
    const a = advice(g)!;
    expect(a.kind).toBe('credits');
    expect(a.text.mouse).toBe('Drag from the Murk Well\'s port to the Market: Glint is over demand, so the extra sells at a quarter; Murk sells too, for 1¢ each.');
    checkWording(a);
    const t = trial(g, a);
    expect(t.tip).toBeLessThan(t.idle);
    // Nothing on offer speeds up the Glint Well: its extra would sell at a quarter.
    const trials = adviceTrials(g)!;
    for (const x of trials.trials) if (/Glint Well and buy Speed/.test(x.text)) expect(x.worth, x.text).toBe(false);
  });

  it('credits wait: with Data to spare, stop studying what the Market would buy', () => {
    const g = midGame();
    g.techs.push('P4', 'P5', 'P7');
    g.data = { a: 5000, b: 5000, g: 0 };
    g.credits = 0; // nothing can be bought: only free changes are on offer
    at(g, 'build-fabricator');
    run(g, 0.1);
    const a = advice(g)!;
    expect(a.kind).toBe('credits');
    expect(a.text.mouse).toBe('Select the wire from the Shard Refiner to the Lab and remove it: Shard sells for 3¢ each, and you have the α you need for now.');
    expect(a.text.touch).toBe('Tap the wire from the Shard Refiner to the Lab and remove it: Shard sells for 3¢ each, and you have the α you need for now.');
    const shard = g.nodes.find((n) => n.recipe === 'shard')!;
    const lab = g.nodes.find((n) => n.type === 'lab')!;
    expect(a.cut).toEqual({ wire: g.wires.find((w) => w.from === shard.id && w.to === lab.id)!.id, from: shard.id, to: lab.id });
    expect(a.cost).toBe(0);
    checkWording(a);
    const t = trial(g, a, 4000);
    expect(t.tip).toBeLessThan(t.idle);
    expect(applyAdvice(g, a)).toBe(true);
    expect(g.wires.some((w) => w.from === shard.id && w.to === lab.id)).toBe(false);
    expect(applyAdvice(g, a)).toBe(false); // the wire is gone
    // While that Data is still wanted, study wires are left alone.
    const h = midGame();
    h.techs.push('P4', 'P5', 'P7');
    h.data = { a: 0, b: 5000, g: 0 };
    h.credits = 100;
    at(h, 'build-fabricator');
    expect(adviceTrials(h)!.trials.some((x) => /remove it/.test(x.text))).toBe(false);
  });

  it('an order for something that reaches no Market: says where to reroute, on the order goal and in a Data wait', () => {
    const g = midGame();
    // Spark is made and has no wire out, as the card leaves it at goal 11.
    const ember = g.nodes.find((n) => n.material === 'ember')!;
    cutWire(g, g.wires.find((w) => w.from === ember.id)!.id);
    const spark = placeNode(g, 'refiner', 400, 540)!;
    connect(g, ember.id, 0, spark.id);
    run(g, 20);
    g.ordersOn = true;
    g.stats.ordersFilled = 1;
    startOrders(g);
    g.order = { ...makeOrder(g), mat: 'spark', need: 8, base: g.sold.spark ?? 0, reward: orderReward(g, 'spark', 8) };
    expect(orderView(g)!.reachesMarket).toBe(false);
    at(g, 'three-orders');
    expect(waitKind(g)).toBe('order');
    const a = advice(g)!;
    expect(a.kind).toBe('credits');
    expect(a.text.mouse).toBe('Drag from the Spark Refiner\'s port to the Market: the order counts what is sold, and no Spark reaches a Market.');
    expect(a.wire).toEqual({ from: spark.id, to: market(g).id, port: 0 });
    expect(a.eta).toBe(Infinity); // the order would never fill
    expect(a.saves).toBe(Infinity);
    checkWording(a);
    const t = trial(g, a);
    expect(t.idle).toBe(Infinity);
    expect(t.tip).toBeLessThan(60);
    // The same order during a wait for α that it would pay: rerouting is one of the things tried.
    at(g, 'make-glyph');
    expect(g.order!.reward.a).toBeGreaterThan(0);
    expect(adviceTrials(g)!.trials.some((x) => /no Spark reaches a Market/.test(x.text) && x.doable)).toBe(true);
    const b = advice(g)!;
    const tb = trial(g, b);
    expect(tb.tip).toBeLessThan(tb.idle);
  });

  it('Flow goal: names the producer that is furthest from flowing, and its fix', () => {
    // Three Wells sell; three feed Refiners that take less than they make, and back up.
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P5'];
    g.flowOn = true;
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    for (const dep of [2, 3, 4, 5]) {
      const w = placeNode(g, 'well', 0, 0, { depositId: dep })!;
      if (dep === 2) connect(g, w.id, 0, m.id);
      else {
        for (let i = 0; i < 3; i++) upgrade(g, w.id, 'speed');
        const r = placeNode(g, 'refiner', 400, 100 * dep)!;
        connect(g, w.id, 0, r.id);
        connect(g, r.id, 0, m.id);
        if (dep === 3) connect(g, r.id, 1, placeNode(g, 'void', 700, 650)!.id);
      }
    }
    run(g, 40);
    expect(flowInfo(g)).toMatchObject({ producers: 8, flowing: 5 }); // 63%: under the goal's 75%
    at(g, 'hold-flow');
    run(g, 1);
    expect(g.goal.ready).toBe(false);
    expect(waitKind(g)).toBe('flow');
    const fixes: string[] = [];
    for (let i = 0; i < 3 && !g.goal.ready; i++) {
      const a = advice(g)!;
      expect(a, 'a Flow tip').not.toBeNull();
      expect(a.kind).toBe('flow');
      expect(a.text.mouse).toMatch(/^(The|A|An) \w+ Well is holding Flow back because it makes more \w+ than its machines take: drag from (the|a|an) \w+ Well's port to the Market\.$/);
      expect(a.text.touch).toMatch(/is holding Flow back because .*: tap (the|a|an) \w+ Well's port, then tap the Market\.$/);
      checkWording(a);
      const before = flowInfo(g).flowing;
      const idle = lookahead(g)!;
      expect(applyAdvice(g, a)).toBe(true);
      fixes.push(a.text.mouse);
      run(g, 25);
      for (let s = 0; s < 250; s++) tick(idle, 0.1);
      // True: more producers flow with the fix than without it.
      expect(flowInfo(g).flowing).toBeGreaterThan(before);
      expect(flowInfo(g).flowing).toBeGreaterThan(flowInfo(idle).flowing);
    }
    // One or two deliberate fixes and the goal is done.
    expect(fixes.length).toBeGreaterThanOrEqual(1);
    expect(fixes.length).toBeLessThanOrEqual(2);
    expect(g.goal.ready).toBe(true);
    expect(advice(g)).toBeNull();
  });

  it('Flow goal: a starved machine is traced to the Well that cannot keep up', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3'];
    g.flowOn = true;
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    const ember = placeNode(g, 'well', 0, 0, { depositId: 4 })!; // 0.8/s for a Refiner that wants 1/s
    const spark = placeNode(g, 'refiner', 400, 540)!;
    connect(g, ember.id, 0, spark.id);
    connect(g, spark.id, 0, m.id);
    run(g, 40);
    expect(flowInfo(g)).toMatchObject({ producers: 3, flowing: 2 });
    at(g, 'hold-flow');
    const a = advice(g)!;
    expect(a.kind).toBe('flow');
    expect(a.text.mouse).toBe('The Spark Refiner is holding Flow back because it is short of Ember: click the Ember Well and buy Speed (50¢).');
    expect(a.text.touch).toBe('The Spark Refiner is holding Flow back because it is short of Ember: tap the Ember Well and buy Speed (50¢).');
    expect(a.node).toBe(ember.id);
    expect(a.upgrade).toBe('speed');
    expect(a.cost).toBe(50);
    checkWording(a);
    expect(applyAdvice(g, a)).toBe(true);
    run(g, 30);
    expect(flowInfo(g)).toMatchObject({ producers: 3, flowing: 3 });
    expect(g.goal.ready).toBe(true);
  });

  it('with Bulk Upgrade, offers "Upgrade all" where every node of a kind is the bottleneck', () => {
    // Three Ember Wells each feed a Refiner that could take a quarter more.
    const g = rich();
    g.techs = ['P1', 'R1', 'P3', 'S1'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    g.deposits.push({ id: 801, x: 100, y: 700, mat: 'ember' }, { id: 802, x: 100, y: 840, mat: 'ember' });
    for (const dep of [4, 801, 802]) {
      const w = placeNode(g, 'well', 0, 0, { depositId: dep })!;
      const r = placeNode(g, 'refiner', 400, w.y)!;
      connect(g, w.id, 0, r.id);
      connect(g, r.id, 0, m.id);
    }
    run(g, 40);
    g.credits = 200;
    at(g, 'build-fabricator'); // a long save: 7,800¢
    g.techs.push('P7');
    const trials = adviceTrials(g)!.trials;
    const bulk = trials.find((x) => /Upgrade all/.test(x.text))!;
    expect(bulk.text).toBe('Click a Well and press Upgrade all on Speed (200¢): they are running flat out, and more of what they make means more credits.');
    expect(bulk.worth).toBe(true);
    const a = advice(g)!;
    checkWording(a);
    const t = trial(g, a);
    expect(t.tip).toBeLessThan(t.idle);
    if (a.all) {
      expect(applyAdvice(g, a)).toBe(true);
      expect(g.nodes.filter((n) => n.type === 'well').every((n) => n.lv.speed === 1)).toBe(true);
    }
  });
});

describe('advice: how it behaves', () => {
  it('never touches the live game, and keeps its verdict until the board or the clock moves on', () => {
    const g = midGame();
    at(g, 'make-glyph');
    run(g, 0.1);
    const before = state(g);
    const a = advice(g);
    expect(a).not.toBeNull();
    adviceTrials(g);
    waitInfo(g);
    expect(state(g)).toBe(before);
    expect(advice(g)).toBe(a); // the same verdict, not worked out again
    run(g, 5);
    expect(advice(g)).toBe(a);
    run(g, ADVICE.refresh);
    const later = advice(g);
    expect(later).not.toBe(a); // looked at afresh
    expect(later!.text).toEqual(a!.text); // and still the best thing to do
    expect(applyAdvice(g, later!)).toBe(true);
    const next = advice(g); // the board changed: a new verdict at once
    expect(next?.text.mouse).not.toBe(a!.text.mouse);
  });

  it('applyAdvice goes through the normal actions: paid for, undoable, and refused when it no longer applies', () => {
    const g = midGame();
    const lab = g.nodes.find((n) => n.type === 'lab')!;
    const upgradeTip: Advice = { kind: 'data', text: { mouse: '', touch: '' }, eta: 0, node: lab.id, upgrade: 'speed', cost: 50 };
    g.credits = 60;
    expect(applyAdvice(g, upgradeTip)).toBe(true);
    expect(g.credits).toBe(10);
    expect(lab.lv.speed).toBe(1);
    expect(applyAdvice(g, upgradeTip)).toBe(false); // 80¢ now, and only 10 in hand
    expect(lab.lv.speed).toBe(1);
    // A build that cannot be finished is rolled back whole.
    g.credits = 1000;
    const ink = g.nodes.find((n) => n.recipe === 'ink')!;
    const nodes = g.nodes.length;
    const wires = g.wires.length;
    const bad: Advice = { kind: 'credits', text: { mouse: '', touch: '' }, eta: 0, build: 'refiner', node: ink.id, port: 0, recipe: 'shard', to: 99999 };
    expect(applyAdvice(g, bad)).toBe(false);
    expect(g.nodes.length).toBe(nodes);
    expect(g.wires.length).toBe(wires);
    expect(g.credits).toBe(1000);
    // A wire that already exists, a Router setting that is already so, a tip with nothing in it.
    const m = market(g);
    expect(applyAdvice(g, { kind: 'credits', text: { mouse: '', touch: '' }, eta: 0, wire: { from: ink.id, to: m.id } })).toBe(false);
    expect(applyAdvice(g, { kind: 'credits', text: { mouse: '', touch: '' }, eta: 0 })).toBe(false);
    expect(applyAdvice(g, { kind: 'credits', text: { mouse: '', touch: '' }, eta: 0, build: 'nonsense' })).toBe(false);
    const router = placeNode(g, 'router', 600, 300)!;
    connect(g, ink.id, 0, router.id);
    const toLab = connect(g, router.id, 0, lab.id)!;
    connect(g, router.id, 0, m.id);
    setMode(g, router.id, 'ratio');
    const fav: Advice = { kind: 'data', text: { mouse: '', touch: '' }, eta: 0, node: router.id, favour: { router: router.id, wire: toLab.id } };
    expect(applyAdvice(g, fav)).toBe(true);
    expect(applyAdvice(g, fav)).toBe(false);
    expect(favour(g, router.id, toLab.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// The property: on real boards, every tip is affordable, can be done, and is true.
//
// The boards come from the scripted newcomer (tests/cardPlayer.ts), with and without tips, across order
// seeds and two speeds of hands: every few seconds of every wait, whatever the adviser says is collected
// with the game as it stood. Each tip is then tried: one copy of that game gets the tip, one gets nothing,
// both run on at the game's own pace with nobody playing, and the wait must end strictly sooner with the
// tip. "Saves about 50 s" must not be an empty promise either.
// ---------------------------------------------------------------------------------------------------

interface Case { g: Game; a: Advice; from: string }

function collect(): Case[] {
  const cases: Case[] = [];
  const seen = new Set<string>();
  const runs: { tips: boolean; seed: number; hands?: number; studyAll?: boolean }[] = [
    { tips: false, seed: 0 }, { tips: false, seed: 2, studyAll: true },
    { tips: true, seed: 0 }, { tips: true, seed: 1 }, { tips: true, seed: 3, hands: 10 },
  ];
  for (const o of runs) {
    let idle = 0;
    playByTheCard({
      ...o,
      onIdle: (g) => {
        if (idle++ % 4) return;
        const a = advice(g);
        if (!a) return;
        // The same tip on the same goal is tried a few times as the wait goes on, not every time.
        const key = `${o.tips}|${o.seed}|${g.goal.i}|${a.text.mouse}`;
        const n = [...seen].filter((k) => k.startsWith(key)).length;
        if (n >= 2) return;
        seen.add(`${key}|${n}`);
        cases.push({ g: cloneGame(g)!, a, from: `${o.tips ? 'tips' : 'card'}/${o.seed} ${activeGoal(g)!.id} at ${Math.round(g.time)}s` });
      },
    });
  }
  return cases;
}

describe('every tip on a real board is affordable, can be done, and is true', () => {
  const cases = collect();

  it('there are plenty of them, of every kind and for most of the repertoire', () => {
    expect(cases.length).toBeGreaterThan(60);
    const kinds = new Set(cases.map((c) => c.a.kind));
    expect(kinds.has('data')).toBe(true);
    expect(kinds.has('credits')).toBe(true);
    const what = (a: Advice) => (a.cut ? 'cut' : a.favour ? 'favour' : a.research ? 'research' : a.build ? `build ${a.build}` : a.upgrade ? 'upgrade' : 'wire');
    const seen = new Set(cases.map((c) => what(c.a)));
    for (const x of ['wire', 'upgrade', 'build lab', 'build well', 'cut']) expect([...seen], x).toContain(x);
  });

  it('affordable and worded properly', () => {
    for (const { g, a, from } of cases) {
      expect(a.cost ?? 0, from).toBeLessThanOrEqual(g.credits + 1e-6);
      if (a.research) expect(techAffordable(g, TECHS[a.research]), from).toBe(true);
      checkWording(a);
      expect(a.eta, from).toBeGreaterThan(ADVICE.minWait);
      if (a.kind !== 'flow') expect(a.saves, from).toBeGreaterThanOrEqual(ADVICE.minSaves);
    }
  });

  it('can be done, and the wait ends strictly sooner with it than without', () => {
    const report: string[] = [];
    let smallest = Infinity;
    let worstRatio = Infinity;
    let rescued = 0;
    for (const { g, a, from } of cases) {
      const before = state(g);
      const t = trial(g, a);
      expect(state(g), from).toBe(before); // trying it changed nothing
      expect(t.applied, `${from}: ${a.text.mouse}`).toBe(true);
      const line = `${from}: with ${isFinite(t.tip) ? t.tip.toFixed(0) : '∞'}s, without ${isFinite(t.idle) ? t.idle.toFixed(0) : '∞'}s, promised ${a.saves?.toFixed(0)}s :: ${a.text.mouse}`;
      report.push(line);
      expect(isFinite(t.tip), line).toBe(true);
      expect(t.tip, line).toBeLessThan(t.idle);
      // The saving it promised is real: at least half of it, give or take a couple of seconds.
      if (isFinite(t.idle) && a.saves != null && isFinite(a.saves)) {
        expect(t.idle - t.tip, line).toBeGreaterThanOrEqual(0.5 * a.saves - 2);
        smallest = Math.min(smallest, t.idle - t.tip);
        worstRatio = Math.min(worstRatio, (t.idle - t.tip) / a.saves);
      } else if (!isFinite(t.idle)) rescued++;
    }
    expect(report.length).toBe(cases.length);
    // One line for whoever tunes the adviser next: how honest the promises were.
    console.info(`adviser: ${cases.length} tips tried on real boards; smallest real saving ${smallest.toFixed(1)} s; `
      + `least-kept promise delivered ${(worstRatio * 100).toFixed(0)}% of what it said; ${rescued} ended a wait that would not have ended.`);
  });
});

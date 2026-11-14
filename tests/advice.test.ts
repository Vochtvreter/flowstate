// The adviser (src/advice.ts): what it says, and above all that what it says is true.
import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, claimOrder, clearHistory, connect, cutWire, favour, placeNode, redo, setMode, undo, upgrade } from '../src/actions';
import { ADVICE, Advice, advice, adviceTrials, applyAdvice, waitInfo, waitKind } from '../src/advice';
import { MAT_IDS, RULES, TECHS } from '../src/content';
import { demandInfo, nodeCost, research, techAffordable } from '../src/economy';
import { countsForFlow, flowInfo, isFlowing } from '../src/flow';
import { forecast, lookahead } from '../src/forecast';
import { GOALS, activeGoal } from '../src/goals';
import { makeOrder, marketRates, orderReward, orderView, startOrders } from '../src/orders';
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
  // A wait for credits or Data is over when waitInfo has nothing left to count. Where the card asks for a
  // research and then a machine, the research is done the moment it can be (it is what the card says to do),
  // and the wait goes on until the machine can be paid for too.
  const over = () => {
    if (copy.goal.i !== goal || copy.goal.ready) return true;
    if (kind === 'order') return copy.stats.ordersFilled > filled;
    if (kind === 'flow') return false;
    const step = activeGoal(copy)?.step?.(copy) ?? null;
    if (step && 'tech' in step && techAffordable(copy, TECHS[step.tech])) research(copy, step.tech);
    return waitInfo(copy) === null;
  };
  if (over()) return 0;
  for (let t = dt; t <= limit; t += dt) {
    tick(copy, dt);
    if (copy.order?.ready) claimOrder(copy);
    if (over()) return t;
  }
  return Infinity;
}

/** How the same wait goes with the tip and without it. */
function trial(g: Game, a: Advice, limit = 900, dt = 0.1) {
  const withTip = lookahead(g)!;
  const without = lookahead(g)!;
  const applied = applyAdvice(withTip, a);
  return { applied, tip: applied ? waitEnds(withTip, limit, dt) : Infinity, idle: waitEnds(without, limit, dt), withTip, without };
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

  it('for a tech with two prices, and for a research followed by a machine, names whatever takes longest', () => {
    const g = midGame();
    g.techs.push('P4', 'P5');
    at(g, 'build-fabricator');
    g.data = { a: 100, b: 90, g: 0 };
    g.credits = 1e6; // the Fabricator itself is paid for: only Fabrication's two prices are in the way
    // α is coming in (Shard is studied), β is not: β is what the player is really waiting for.
    let w = waitInfo(g)!;
    expect(waitKind(g)).toBe('data');
    expect(w).toMatchObject({ unit: 'β', have: 90, need: 100, eta: Infinity });
    g.data.b = 100;
    w = waitInfo(g)!;
    const alpha = TECHS.P7.cost.a!;
    expect(w.unit).toBe('α');
    expect(w.need).toBe(alpha);
    expect(w.eta).toBeGreaterThan((alpha - 100) / 0.75 - 60); // 0.25 Shard/s at 3 α each
    expect(w.eta).toBeLessThan((alpha - 100) / 0.75 + 60);
    // The card asks for the Fabricator straight after the research. While its price is further off than the
    // α, the wait is for credits, and so are the tips: the card is still counting α.
    g.data.a = alpha - 150;
    g.credits = 400;
    w = waitInfo(g)!;
    expect(w).toMatchObject({ unit: '¢', have: 400, need: nodeCost(g, 'fabricator') });
    expect(w.eta).toBeGreaterThan(150 / 0.75 + 60);
    expect(waitKind(g)).toBe('credits');
    expect(activeGoal(g)!.progress!(g)![2]).toBe('α');
    expect(activeGoal(g)!.step!(g)).toEqual({ tech: 'P7', then: nodeCost(g, 'fabricator') });
    // With the α and β in hand the card asks for an action (research): no wait, whatever the credits.
    g.data.a = alpha;
    expect(waitInfo(g)).toBeNull();
    expect(waitKind(g)).toBeNull();
    // Researched: the same goal now waits for the Fabricator's price alone.
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
    expect(waitInfo(g)).toMatchObject({ unit: 'β', have: 4, need: RULES.goals.studyBeta });
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
    at(g, 'make-glyph'); // Assembly
    g.credits = 1e6; // the Assembler is paid for: the wait is for α alone
    const a = advice(g)!;
    expect(a.kind).toBe('data');
    expect(a.wire).toBeDefined();
    // Ink is sold and Silt is thrown away. Ink is worth 3 α in the Lab, Silt (a by-product) only 1: Ink first.
    expect(a.text.mouse).toBe('Drag from the Ink Refiner\'s Ink port to the Lab: Ink is worth 3 α each in a Lab.');
    expect(a.text.touch).toBe('Tap the Ink Refiner\'s Ink port, then tap the Lab: Ink is worth 3 α each in a Lab.');
    expect(a.cost).toBe(0);
    expect(a.steps).toBe(1);
    expect(a.saves!).toBeGreaterThan(60);
    expect(a.eta).toBeGreaterThan(a.saves!);
    checkWording(a);
    const t = trial(g, a, 3000);
    expect(t.applied).toBe(true);
    expect(t.tip).toBeLessThan(t.idle);
    // The Silt that is being dumped is on the list too, for what it is worth.
    const silt = adviceTrials(g)!.trials.find((x) => /Silt port/.test(x.text))!;
    expect(silt.text).toBe('Drag from the Ink Refiner\'s Silt port to the Lab: Silt is worth 1 α each in a Lab, and you are throwing it away.');
    expect(silt.doable).toBe(true);
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

  it('Data wait: a tech that pays for itself inside the wait is worth its price', () => {
    const g = midGame();
    const lab = g.nodes.find((n) => n.type === 'lab')!;
    // Far more on offer than one Lab can study, and nowhere else for it to go: Ink, and two Wells that feed only the Lab.
    connect(g, g.nodes.find((n) => n.recipe === 'ink')!.id, 0, lab.id);
    const ember = g.nodes.find((n) => n.material === 'ember')!;
    cutWire(g, g.wires.find((w) => w.from === ember.id)!.id);
    connect(g, ember.id, 0, lab.id);
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 2 })!.id, 0, lab.id);
    run(g, 30);
    expect(lab.util).toBeGreaterThan(0.95);
    at(g, 'make-glyph'); // Assembly, then the Assembler
    run(g, 0.1);
    g.credits = 600; // the Assembler's price is in hand, and nothing else can be bought with credits
    g.data.a = 60;
    const a = advice(g)!;
    expect(a.kind).toBe('data');
    expect(a.research).toBe('R2');
    expect(a.text.mouse).toBe('Open the Tech tree and research Lab Speed (50α): your Lab is full, and this doubles how fast Labs study.');
    expect(a.text.touch).toBe('Tap Tech and research Lab Speed (50α): your Lab is full, and this doubles how fast Labs study.');
    expect(a.cost).toBe(0);
    checkWording(a);
    const t = trial(g, a, 3000);
    expect(t.tip).toBeLessThan(t.idle - 20); // although it spends 50 of the α being saved
    expect(applyAdvice(g, a)).toBe(true);
    expect(g.techs).toContain('R2');
    expect(g.data.a).toBeCloseTo(10, 0);
    // With less α than it costs, it is not on offer.
    const h = midGame();
    at(h, 'make-glyph');
    run(h, 0.1);
    h.data.a = 40;
    expect(adviceTrials(h)!.trials.some((x) => /research/.test(x.text))).toBe(false);
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
    expect(flowInfo(g)).toMatchObject({ producers: 8, flowing: 5 }); // 63%: the goal asks for 95%, which on a board this size is all of them
    at(g, 'hold-flow');
    run(g, 1);
    expect(g.goal.ready).toBe(false);
    expect(waitKind(g)).toBe('flow');
    const fixes: string[] = [];
    for (let i = 0; i < 4 && !g.goal.ready; i++) {
      const a = advice(g)!;
      expect(a, 'a Flow tip').not.toBeNull();
      expect(a.kind).toBe('flow');
      // The tip names the Well it gets flowing, and what to act on (here the same Well).
      expect(a.culprit).toBe(a.node);
      expect(isFlowing(g.nodes.find((n) => n.id === a.culprit)!)).toBe(false);
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
    // Three Wells back up: three deliberate fixes, one tip each, and the goal is done.
    expect(fixes.length).toBe(3);
    expect(new Set(fixes).size).toBe(3);
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

describe('advice: a long save, followed tip by tip', () => {
  it('every tip is true, and between them they use the dearer parts of the repertoire', () => {
    // 7,700¢ to go for the Fabricator on a few credits a second, with Bulk Upgrade and Data to spare.
    const g = midGame();
    g.techs.push('P4', 'P5', 'P7', 'S1');
    g.data = { a: 5000, b: 5000, g: 0 };
    g.credits = 100;
    at(g, 'build-fabricator');
    run(g, 0.1);
    const kinds: string[] = [];
    const said: string[] = [];
    let last = Infinity;
    for (let i = 0; i < 14; i++) {
      const a = advice(g);
      if (!a) break;
      expect(a.kind).toBe('credits');
      checkWording(a);
      expect(a.cost ?? 0).toBeLessThanOrEqual(g.credits + 1e-6);
      const t = trial(g, a, 6000, 0.25);
      expect(t.applied, a.text.mouse).toBe(true);
      expect(t.tip, a.text.mouse).toBeLessThan(t.idle);
      kinds.push(a.research ? 'research' : a.cut ? 'cut' : a.all ? 'upgrade all' : a.upgrade ? 'upgrade' : a.build ? `build ${a.build}` : a.favour ? 'favour' : 'wire');
      said.push(a.text.mouse);
      expect(applyAdvice(g, a)).toBe(true);
      run(g, 20);
      // The wait really does get shorter as the tips are followed.
      const eta = waitInfo(g)!.eta;
      if (i >= 2) expect(eta, said.join(' | ')).toBeLessThan(last);
      last = eta;
    }
    expect(kinds.length).toBeGreaterThanOrEqual(8);
    expect(kinds, kinds.join()).toContain('build well');
    expect(kinds, kinds.join()).toContain('build refiner');
    expect(kinds, kinds.join()).toContain('upgrade all');
    // A Refiner built by a tip arrives wired at both ends and working.
    const built = said.find((x) => /pick Refiner/.test(x))!;
    expect(built).toMatch(/^Drag from (the|a|an) \w+ Well's port into empty space, pick Refiner \(\d+¢\) and wire it to the Market: \w+ sells for more than the \w+ it is made of\.$/);
    expect(g.nodes.filter((n) => n.type === 'refiner').every((n) => n.util > 0.5)).toBe(true);
    // Along the way raw Glint sold over its demand. Whenever something still does, the adviser knows: its
    // sentences say so (the unit test above pins the wording).
    expect(g.seenSurplus).toBe(true);
    const glutted = MAT_IDS.some((m) => demandInfo(g, m).surplusRate * demandInfo(g, m).unitPrice > 0.05);
    const glut = adviceTrials(g)!.trials.filter((x) => /over demand/.test(x.text));
    if (glutted) expect(glut.length).toBeGreaterThan(0);
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

  it('leaves the player\'s undo and redo history alone: nothing it tries on a copy becomes an Undo step', () => {
    // Every candidate is tried through the normal actions on a look-ahead copy. Those steps used to land in the
    // one undo history: after a single verdict, Undo "took back" eight purchases nobody had made and paid 159¢.
    const g = midGame();
    at(g, 'make-glyph');
    run(g, 0.1);
    clearHistory();
    const lab = g.nodes.find((n) => n.type === 'lab')!;
    expect(upgrade(g, lab.id, 'speed')).toBe(true);
    expect(undo(g)).toBe(true); // one step waiting to be redone
    const before = state(g);
    expect(advice(g)).not.toBeNull();
    expect(adviceTrials(g)!.trials.some((x) => x.doable)).toBe(true);
    waitInfo(g);
    forecast(g);
    marketRates(g);
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);
    expect(undo(g)).toBe(false);
    expect(state(g)).toBe(before);
    expect(redo(g)).toBe(true);
    expect(lab.lv.speed).toBe(1);
    // A look-ahead copy can be changed like any game, but has no history of its own to walk.
    const copy = lookahead(g)!;
    const copyLab = copy.nodes.find((n) => n.type === 'lab')!;
    clearHistory();
    expect(upgrade(copy, copyLab.id, 'speed')).toBe(true);
    expect(copyLab.lv.speed).toBe(2);
    expect(canUndo()).toBe(false);
    expect(upgrade(g, lab.id, 'speed')).toBe(true);
    expect(undo(copy)).toBe(false); // the step on the stack is the live game's
    expect(redo(copy)).toBe(false);
    expect(undo(g)).toBe(true);
    expect(lab.lv.speed).toBe(1);
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
    { tips: false, seed: 2, studyAll: true },
    { tips: true, seed: 0 }, { tips: true, seed: 1 }, { tips: true, seed: 2 }, { tips: true, seed: 3, hands: 10 },
  ];
  for (const o of runs) {
    let idle = 0;
    playByTheCard({
      ...o,
      wall: 30 * 60, // without tips a wait can take twenty minutes
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
    const count: Record<string, number> = {};
    for (const c of cases) count[what(c.a)] = (count[what(c.a)] ?? 0) + 1;
    for (const x of ['wire', 'upgrade', 'build lab', 'build well', 'cut']) expect(Object.keys(count), x).toContain(x);
    // Which parts of the repertoire real boards exercised; the rest is covered on built boards above.
    console.info(`adviser: tips collected from real boards, by action: ${Object.entries(count).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  });

  it('affordable and worded properly', () => {
    for (const { g, a, from } of cases) {
      expect(a.cost ?? 0, from).toBeLessThanOrEqual(g.credits + 1e-6);
      if (a.research) expect(techAffordable(g, TECHS[a.research]), from).toBe(true);
      checkWording(a);
      expect(a.eta, from).toBeGreaterThan(ADVICE.minWait);
      // A tip is given for at least minSaves, and kept while it still saves keepSaves.
      if (a.kind !== 'flow') expect(a.saves, from).toBeGreaterThanOrEqual(ADVICE.keepSaves);
      else expect(a.culprit, from).toBeDefined();
    }
  });

  it('can be done, and the wait ends strictly sooner with it than without', () => {
    const report: string[] = [];
    let smallest = Infinity;
    let worstRatio = Infinity;
    let rescued = 0;
    for (const { g, a, from } of cases) {
      const before = state(g);
      // Without tips a wait can be most of an hour: follow it to its end, within reason (and at a coarser step).
      const limit = Math.min(4500, Math.max(900, 1.3 * (isFinite(a.eta) ? a.eta : 0)));
      const t = trial(g, a, limit, limit > 900 ? 0.25 : 0.1);
      expect(state(g), from).toBe(before); // trying it changed nothing
      expect(t.applied, `${from}: ${a.text.mouse}`).toBe(true);
      const line = `${from}: with ${isFinite(t.tip) ? t.tip.toFixed(0) : '∞'}s, without ${isFinite(t.idle) ? t.idle.toFixed(0) : '∞'}s, promised ${a.saves?.toFixed(0)}s :: ${a.text.mouse}`;
      report.push(line);
      if (a.kind === 'flow' && a.saves == null) {
        // A Flow tip that does not finish the goal on its own: the producer it names flows with it, and not without.
        const withTip = lookahead(g)!;
        const without = lookahead(g)!;
        expect(applyAdvice(withTip, a), line).toBe(true);
        for (let i = 0; i < 500; i++) {
          tick(withTip, 0.1);
          tick(without, 0.1);
        }
        const flows = (x: Game) => x.nodes.some((n) => n.id === a.culprit && countsForFlow(x, n) && isFlowing(n));
        expect(flows(withTip), line).toBe(true);
        expect(flows(without), line).toBe(false);
        continue;
      }
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

// The adviser (src/advice.ts): what it says, and above all that what it says is true.
import { describe, expect, it } from 'vitest';
import {
  canRedo, canUndo, claimOrder, clearHistory, connect, cutWire, deleteNode, expandBoard, favour, favouredWire, placeNode, redo, setMode, undo,
  upgrade, upgradeAll,
} from '../src/actions';
import { ADVICE, Advice, SAY, advice, adviceQuiet, adviceTrials, applyAdvice, lineAdvice, waitInfo, waitKind } from '../src/advice';
import { DATA_NAMES, DATA_YIELD, MATERIALS, MAT_IDS, NODE_DEFS, RECIPES, RULES, TECHS } from '../src/content';
import { costText, demandInfo, nodeCost, nodeCostAt, research, techAffordable, upgradeCostAt } from '../src/economy';
import { countsForFlow, flowInfo, isFlowing } from '../src/flow';
import { forecast, lookahead } from '../src/forecast';
import { GOALS, activeGoal, goalView } from '../src/goals';
import { makeOrder, marketRates, orderReward, orderView, startOrders } from '../src/orders';
import { tick } from '../src/sim';
import { Game, cloneGame, deserialize, serialize } from '../src/state';
import { playByTheCard } from './cardPlayer';
import { fresh, market, realWaitEnds, rich, run, well } from './helpers';

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

/**
 * Seconds a tip saves in the real game, under `n` order sequences: the game's own first, then others (what
 * the next order asks for is luck, and an order's pay arrives in a lump: one sequence alone can hide a good
 * tip or flatter a poor one). Infinity where the wait would not have ended without the tip.
 */
function realGains(g: Game, a: Advice, limit = 1500, n = 3, dt = 0.1): number[] {
  const gains: number[] = [];
  for (let k = 0; k < n; k++) {
    const withTip = cloneGame(g)!;
    const without = cloneGame(g)!;
    withTip.orderSeed = without.orderSeed = (g.orderSeed + k * 7919) >>> 0;
    expect(applyAdvice(withTip, a), a.text.mouse).toBe(true);
    const idle = realWaitEnds(without, limit, dt);
    const tip = realWaitEnds(withTip, limit, dt);
    gains.push(isFinite(idle) ? idle - tip : isFinite(tip) ? Infinity : NaN);
  }
  clearHistory();
  return gains;
}

/** A tip as it reads, prices aside. */
const reads = (text: string) => text.replace(/\d+¢/g, '¢');

/** One sentence of at most 90 characters, with nothing broken in it. */
function checkSentence(text: string) {
  expect([...text].length, text).toBeGreaterThan(20);
  expect([...text].length, text).toBeLessThanOrEqual(RULES.tips.maxLength);
  expect(text.endsWith('.'), text).toBe(true);
  expect(text.slice(0, -1), `one sentence: ${text}`).not.toMatch(/[.!?] /);
  expect(text, text).not.toMatch(/undefined|NaN|null|\[object|Infinity/);
  expect(text, text).not.toMatch(/\b(key|Ctrl|Shift|Delete|Backspace|Esc)\b/);
  // One wording serves mouse and touch: it names no click, drag, tap or key.
  expect(text, text).not.toMatch(/\b(click|drag|press|tap|select)\b/i);
}

/** Wording, and what else every tip must carry. */
function checkWording(a: Advice) {
  checkSentence(a.text.mouse);
  checkSentence(a.text.touch);
  // The price is in the sentence when there is one.
  if (a.cost) expect(a.text.mouse, a.text.mouse).toContain(`${Math.round(a.cost)}¢`);
  if (a.research) expect(a.text.mouse).toContain(TECHS[a.research].name);
  // Every tip says what it saves: a number of seconds, or Infinity when the wait would not end without it.
  expect(typeof a.saves, a.text.mouse).toBe('number');
  expect(a.saves!, a.text.mouse).toBeGreaterThanOrEqual(0);
  // At least 15 s, unless it is a Flow tip (which is held to getting its producer flowing).
  if (a.kind !== 'flow') expect(a.saves!, a.text.mouse).toBeGreaterThanOrEqual(ADVICE.minSaves);
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

/** midGame with a Glyph line on top: Ember refined into Spark, Ink and Spark assembled, Glyph sold and studied. */
function glyphGame(): Game {
  const g = midGame();
  g.techs.push('P4');
  g.credits = 2000;
  const m = market(g);
  const lab = g.nodes.find((n) => n.type === 'lab')!;
  const ember = g.nodes.find((n) => n.material === 'ember')!;
  cutWire(g, g.wires.find((w) => w.from === ember.id)!.id);
  const spark = placeNode(g, 'refiner', 400, 540)!;
  connect(g, ember.id, 0, spark.id);
  connect(g, spark.id, 0, m.id);
  const glyph = placeNode(g, 'assembler', 700, 470, { recipe: 'glyph' })!;
  connect(g, g.nodes.find((n) => n.recipe === 'ink')!.id, 0, glyph.id);
  connect(g, spark.id, 0, glyph.id);
  connect(g, glyph.id, 0, m.id);
  connect(g, glyph.id, 0, lab.id);
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
    expect(waitInfo(g)).toEqual({ unit: '¢', have: 0, need: 12, eta: Infinity, name: 'the Well' });
    at(g, 'research-murk');
    g.techs = ['P1', 'R1'];
    expect(waitInfo(g)).toEqual({ unit: 'α', have: 0, need: 45, eta: Infinity, name: 'Murk Deposits' });
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
    expect(w.name).toBe('Fabrication'); // what the α is for
    expect(w.eta).toBeGreaterThan((alpha - 100) / 0.75 - 60); // 0.25 Shard/s at 3 α each
    expect(w.eta).toBeLessThan((alpha - 100) / 0.75 + 60);
    // The card asks for the Fabricator straight after the research. While its price is further off than the
    // α, the wait is for credits, and so are the tips: the card is still counting α.
    g.data.a = alpha - 150;
    g.credits = 400;
    w = waitInfo(g)!;
    expect(w).toMatchObject({ unit: '¢', have: 400, need: nodeCost(g, 'fabricator'), name: 'the Fabricator' });
    expect(w.eta).toBeGreaterThan(150 / 0.75 + 60);
    expect(waitKind(g)).toBe('credits');
    expect(activeGoal(g)!.progress!(g)![2]).toBe('α');
    expect(activeGoal(g)!.step!(g)).toEqual({ tech: 'P7', then: nodeCost(g, 'fabricator'), thenWhat: 'the Fabricator' });
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
    expect(w.name).toBe('the Fabricator');
    g.credits = 1e6;
    expect(waitInfo(g)).toBeNull();
  });

  it('names what is being saved for, as a card would: the tech, or the thing the credits buy', () => {
    const g = midGame();
    const name = (id: string) => {
      at(g, id);
      return waitInfo(g)?.name;
    };
    g.credits = 0;
    g.data = { a: 0, b: 0, g: 0 };
    g.techs = ['P1', 'R1'];
    expect(name('second-well')).toBe('the Well');
    expect(name('upgrade-well')).toBe('the Speed upgrade');
    expect(name('research-murk')).toBe('Murk Deposits');
    expect(name('expand')).toBe('the expansion');
    g.techs.push('P2', 'L1');
    expect(name('route-lab')).toBe('the Router');
    expect(name('make-spark')).toBe('Ember Deposits');
    expect(name('make-glyph')).toBe('Assembly');
    g.techs.push('P3', 'P4');
    expect(name('make-glyph')).toBe('the Assembler');
    expect(name('make-mist')).toBe('Breeze Deposits');
    g.techs.push('P5');
    expect(name('build-fabricator')).toBeDefined();
    g.data = { a: 1e6, b: 0, g: 0 };
    expect(name('build-fabricator')).toBe('Fabrication'); // β is what it is short of
    // A goal that counts Data in hand and buys nothing has no name to give.
    at(g, 'study-glyph');
    expect(waitInfo(g)).not.toBeNull();
    expect(waitInfo(g)!.name).toBeUndefined();
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
    g.techs = g.techs.filter((id) => id !== 'P3');
    at(g, 'make-spark'); // Ember Deposits: 215 α, and no orders yet (they come with this goal's reward)
    g.credits = 1e6; // the Well and the Refiner are paid for: the wait is for α alone
    // Ink is sold and Silt is thrown away. Ink is worth 3 α in the Lab, Silt (a by-product) only 1: Ink first.
    // On this goal that is the card's own "while you wait" line, and the line's next step is that very wire...
    const step = lineAdvice(g)!;
    expect(step.text.mouse).toBe('Wire the Ink Refiner\'s Ink port to the Lab: Ink is 3 α each in a Lab.');
    // ...so the adviser leaves it to the card and says the next best thing: nothing is said twice.
    expect(adviceTrials(g)!.trials.some((x) => /Ink port to the Lab/.test(x.text))).toBe(false);
    const other = advice(g)!;
    expect(other.text.mouse).toMatch(/^Place a Well on the free Glint deposit \(\d+¢\), wired to the Lab: 1 α each\.$/);
    checkWording(other);
    // The Silt that is being dumped is on the list too, for what it is worth.
    const silt = adviceTrials(g)!.trials.find((x) => /Silt port/.test(x.text))!;
    expect(silt.text).toBe('Wire the Ink Refiner\'s Silt port to the Lab: you are throwing away 1 α each.');
    expect(silt.doable).toBe(true);
    // The step is a tip in everything but the promise: it can be carried out, and the wait ends sooner for it.
    expect(step.kind).toBe('data');
    expect(step.wire).toBeDefined();
    expect(step.text.touch).toBe(step.text.mouse);
    expect(step.cost).toBe(0);
    expect(step.steps).toBe(1);
    expect(step.saves).toBeUndefined();
    checkSentence(step.text.mouse);
    const t = trial(g, step, 3000);
    expect(t.applied).toBe(true);
    expect(t.tip).toBeLessThan(t.idle - 60);
    // The same board once orders exist. An order asks for 45–90 s of what is SOLD of a material and pays α by
    // the item: Ink taken from the Market makes every Ink order smaller. The look-ahead counts the orders to
    // come, so the Ink wire is worth less than it was, and raw material (which no order asks for while
    // something refined is made) is now the better tip. Not the free Glint deposit, though: on this card that
    // deposit is the line's ("a Well and a Lab built from its port"), and a tip does not give it another ending.
    const o = midGame();
    at(o, 'make-glyph'); // Assembly: 1,140 α
    o.credits = 1e6;
    run(o, 0.1);
    expect(o.ordersOn).toBe(true);
    const line = lineAdvice(o)!;
    expect(line.text.mouse).toMatch(/^Place a Well on the free Glint deposit \(\d+¢\), then build a Lab from its port\.$/);
    expect(line.build).toBe('well');
    expect(line.deposit).toBe(2);
    expect(line.to).toBeUndefined();
    expect(line.steps).toBe(1);
    expect(adviceTrials(o)!.trials.some((x) => /free Glint deposit/.test(x.text))).toBe(false);
    const b = advice(o)!;
    expect(b.text.mouse).toBe('Wire the Ember Well\'s port to the Lab: Ember is 1 α each in a Lab.');
    expect(b.wire).toBeDefined();
    expect(b.steps).toBe(1);
    checkWording(b);
    const ink = adviceTrials(o)!.trials.find((x) => /Ink port to the Lab/.test(x.text))!;
    expect(ink.doable).toBe(true);
    // True in the real game, where orders keep coming, under this order sequence and four others.
    for (const gain of realGains(o, b, 2000, 5)) expect(gain).toBeGreaterThan(30);
    // Once the line's Well stands, its next step is the Lab from that Well's port, and no tip wires that Well elsewhere.
    expect(applyAdvice(o, line)).toBe(true);
    const placed = o.nodes.find((n) => n.depositId === 2)!;
    const next = lineAdvice(o)!;
    expect(next.text.mouse).toMatch(/^Build a Lab from the new Glint Well's port \(\d+¢\): a Lab of its own is 1 α a second\.$/);
    expect(next).toMatchObject({ build: 'lab', node: placed.id, port: 0, steps: 1 });
    run(o, 25);
    expect(adviceTrials(o)!.trials.some((x) => /a Glint Well's port to the (Lab|Market)/.test(x.text))).toBe(false);
    expect(applyAdvice(o, lineAdvice(o)!)).toBe(true);
    expect(o.wires.some((w) => w.from === placed.id && o.nodes.find((n) => n.id === w.to)!.type === 'lab')).toBe(true);
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
      expect(b.text.mouse).toBe('Wire the Shard Refiner\'s port to the Lab: it gives more Data than Glint.');
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
      run(g, 25);
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
    expect(a.text.mouse).toBe('Research Lab Speed (50α): your Lab is full, and Labs then study twice as fast.');
    expect(a.text.touch).toBe(a.text.mouse);
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
    expect(adviceTrials(h)!.trials.some((x) => /^Research /.test(x.text))).toBe(false);
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
    run(g, 25);
    g.credits = 0;
    at(g, 'make-prism'); // an Assembler: 600¢
    const a = advice(g)!;
    expect(a.kind).toBe('credits');
    expect(a.text.mouse).toBe('Wire the Mist Refiner\'s port to the Market: its Mist is not sold (6¢ each).');
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
    expect(a.text.mouse).toBe('Wire the Murk Well\'s port to the Market: Glint is over demand, Murk is not.');
    checkWording(a);
    const t = trial(g, a);
    expect(t.tip).toBeLessThan(t.idle);
    // Nothing on offer speeds up the Glint Well: its extra would sell at a quarter.
    const trials = adviceTrials(g)!;
    for (const x of trials.trials) if (/Glint Well runs flat out/.test(x.text)) expect(x.worth, x.text).toBe(false);
  });

  it('...but not before the game has introduced demand: until the first surplus is noted, no tip names it', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'P2'];
    const m = market(g);
    for (let i = 0; i < 6; i++) upgrade(g, well(g).id, 'speed');
    connect(g, well(g).id, 0, m.id);
    const murk = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    connect(g, murk.id, 0, placeNode(g, 'void', 700, 600)!.id);
    run(g, 60);
    g.credits = 30;
    at(g, 'make-glyph');
    g.techs.push('P4');
    // The same board at the moment before the 'surplus' event: Glint already sells over its demand, the game
    // has not said so yet (it waits a few seconds), and Market Lens has not been granted.
    g.seenSurplus = false;
    g.techs = g.techs.filter((t) => t !== 'C1');
    const trials = adviceTrials(g)!;
    expect(trials.trials.length).toBeGreaterThan(0);
    for (const x of trials.trials) expect(x.text, x.text).not.toMatch(/demand/i);
    const a = advice(g)!;
    expect(a.text.mouse).toBe('Wire the Murk Well\'s port to the Market: Murk sells for 1¢ each.');
    checkWording(a);
  });

  it('"cut this wire" is only ever said when the goal card says it too, and then the card\'s own step says it', () => {
    // "Build a Fabricator", researched: 7,100¢ to save, the β long covered, and half the Glyph going into the Lab.
    const g = glyphGame();
    g.techs.push('P5', 'P7');
    g.data = { a: 5000, b: 5000, g: 0 };
    g.credits = 0; // nothing can be bought: only free changes are on offer
    at(g, 'build-fabricator');
    run(g, 0.1);
    const glyph = g.nodes.find((n) => n.recipe === 'glyph')!;
    const shard = g.nodes.find((n) => n.recipe === 'shard')!;
    const lab = g.nodes.find((n) => n.type === 'lab')!;
    const wire = g.wires.find((w) => w.from === glyph.id && w.to === lab.id)!;
    // The card says it: its "while you wait" line.
    expect(goalView(g)!.meanwhile).toEqual({ text: 'You have the β you need: cut the wire from the Glyph Assembler to the Lab.', done: false });
    expect(activeGoal(g)!.meanwhile!.cuts!(g)).toEqual([wire.id]);
    // The line's step says which wire, in the words of the button ("Cut wire"), for the card's "Show me".
    const a = lineAdvice(g)!;
    expect(a.kind).toBe('credits');
    expect(a.text.mouse).toBe('Cut the wire from the Glyph Assembler to the Lab: sold, each Glyph is 20¢.');
    expect(a.text.touch).toBe(a.text.mouse);
    expect(a.cut).toEqual({ wire: wire.id, from: glyph.id, to: lab.id });
    expect(a.node).toBe(glyph.id);
    expect(a.cost).toBe(0);
    expect(a.saves).toBeUndefined(); // a line's step promises nothing: its worth is tested, not measured on the spot
    checkSentence(a.text.mouse);
    const t = trial(g, a, 4000);
    expect(t.tip).toBeLessThan(t.idle - 60);
    // The adviser does not say it as well: the card has it. And it cuts nothing else. The Shard wire into the
    // same Lab is as useless right now (no α is needed either), and a card asked for it once ("Build a Lab
    // and feed it"): no tip takes it back.
    expect(g.wires.some((w) => w.from === shard.id && w.to === lab.id)).toBe(true);
    expect(adviceTrials(g)!.trials.some((x) => /^(Cut|Remove) /.test(x.text))).toBe(false);
    expect(advice(g)?.cut).toBeUndefined();
    expect(applyAdvice(g, a)).toBe(true);
    expect(g.wires.some((w) => w.id === wire.id)).toBe(false);
    expect(goalView(g)!.meanwhile!.done).toBe(true);
    expect(lineAdvice(g)).toBeNull();
    expect(applyAdvice(g, a)).toBe(false); // the wire is gone
    run(g, 25);
    expect(adviceTrials(g)!.trials.some((x) => /^(Cut|Remove) /.test(x.text))).toBe(false);
    expect(advice(g)?.cut).toBeUndefined();

    // Two wires take Glyph to Labs: the line's step is the first, and the adviser may name the other one, which
    // the card's "Show me" is not pointing at. It is still a wire the card asks to go, and only such a wire.
    const two = glyphGame();
    two.techs.push('P5', 'P7');
    two.data = { a: 5000, b: 5000, g: 0 };
    two.credits = 1e5;
    const glyph2 = two.nodes.find((n) => n.recipe === 'glyph')!;
    const lab2 = placeNode(two, 'lab', 900, 500)!;
    const extra = connect(two, glyph2.id, 0, lab2.id)!;
    two.credits = 0;
    two.edits = [];
    at(two, 'build-fabricator');
    run(two, 0.1);
    const cuts = activeGoal(two)!.meanwhile!.cuts!(two);
    expect(cuts.length).toBe(2);
    expect(cuts).toContain(extra.id);
    expect(lineAdvice(two)!.cut!.wire).toBe(cuts[0]);
    // Both read the same ("...from the Glyph Assembler to a Lab..."), so neither is said as a tip while the line is up.
    expect(adviceTrials(two)!.trials.some((x) => /^Cut /.test(x.text))).toBe(false);
    expect(applyAdvice(two, lineAdvice(two)!)).toBe(true);
    expect(lineAdvice(two)!.cut!.wire).toBe(cuts[1]);
    expect(applyAdvice(two, lineAdvice(two)!)).toBe(true);
    expect(goalView(two)!.meanwhile!.done).toBe(true);
    expect(lineAdvice(two)).toBeNull();

    // While the β is still wanted, neither the card nor the adviser asks for it.
    const h = glyphGame();
    h.techs.push('P5');
    h.data = { a: 5000, b: 10, g: 0 };
    h.credits = 0;
    at(h, 'build-fabricator');
    run(h, 0.1);
    expect(goalView(h)!.meanwhile).toBeUndefined();
    expect(lineAdvice(h)).toBeNull();
    expect(adviceTrials(h)!.trials.some((x) => /^(Cut|Remove) /.test(x.text))).toBe(false);
    // Nor when the Fabricator's price is already in hand: selling Glyph would bring nothing sooner.
    h.data.b = 5000;
    h.credits = 1e6;
    expect(goalView(h)!.meanwhile).toBeUndefined();
    // And on any other goal there is no such tip at all, whatever the board studies.
    const k = glyphGame();
    k.data = { a: 5000, b: 5000, g: 0 };
    k.credits = 0;
    k.techs.push('P5');
    at(k, 'make-prism'); // an Assembler to save for: 1,500¢
    run(k, 0.1);
    expect(waitKind(k)).toBe('credits');
    expect(lineAdvice(k)).toBeNull();
    expect(adviceTrials(k)!.trials.some((x) => /^(Cut|Remove) /.test(x.text))).toBe(false);
  });

  it('a Router that a card turned toward a Lab is never turned away from it', () => {
    // "Route more to a Lab than to the Market" had the player press Favour on the Lab's wire. In a wait for
    // credits "more of what passes is sold" would be true, and so would "the order counts Ink sold": neither is said.
    const g = midGame();
    const ink = g.nodes.find((n) => n.recipe === 'ink')!;
    const lab = g.nodes.find((n) => n.type === 'lab')!;
    const router = placeNode(g, 'router', 600, 300)!;
    connect(g, ink.id, 0, router.id);
    const toLab = connect(g, router.id, 0, lab.id)!;
    const toMarket = connect(g, router.id, 0, market(g).id)!;
    run(g, 30);
    g.techs.push('P4');
    g.credits = 0;
    at(g, 'make-glyph'); // the Assembler: 600¢
    run(g, 0.1);
    // Not favoured yet: turning it toward the Market is on the list...
    expect(adviceTrials(g)!.trials.some((x) => /^Favour the Market's wire on the Router: /.test(x.text))).toBe(true);
    // ...once the Lab is favoured, as the card asks, it no longer is.
    expect(favour(g, router.id, toLab.id)).toBe(true);
    run(g, 25);
    expect(adviceTrials(g)!.trials.some((x) => /^Favour /.test(x.text))).toBe(false);
    g.ordersOn = true;
    g.stats.ordersFilled = 1;
    startOrders(g);
    g.order = { ...makeOrder(g), mat: 'ink', need: 40, base: g.sold.ink ?? 0, reward: orderReward(g, 'ink', 40) };
    at(g, 'three-orders');
    expect(waitKind(g)).toBe('order');
    expect(adviceTrials(g)!.trials.some((x) => /^Favour /.test(x.text))).toBe(false);
    // A Router the player turned toward the Market by hand can still be turned toward the Lab in a wait for α.
    expect(favour(g, router.id, toMarket.id)).toBe(true);
    at(g, 'make-mist');
    g.data.a = 0;
    const turnBack = 'Favour the Lab\'s wire on the Router: more of what passes is studied for α.';
    // (Not within a minute of the player pressing Favour on the Lab's wire themselves: that would be asking twice.)
    run(g, 25);
    expect(adviceTrials(g)!.trials.some((x) => x.text === turnBack)).toBe(false);
    run(g, 40);
    expect(adviceTrials(g)!.trials.some((x) => x.text === turnBack)).toBe(true);
  });

  it('an order for something that reaches no Market: says where to reroute, on the order goal and in a Data wait', () => {
    const g = midGame();
    // Spark is made and has no wire out, as the card leaves it at goal 11.
    const ember = g.nodes.find((n) => n.material === 'ember')!;
    cutWire(g, g.wires.find((w) => w.from === ember.id)!.id);
    const spark = placeNode(g, 'refiner', 400, 540)!;
    connect(g, ember.id, 0, spark.id);
    run(g, 25);
    g.ordersOn = true;
    g.stats.ordersFilled = 1;
    startOrders(g);
    g.order = { ...makeOrder(g), mat: 'spark', need: 8, base: g.sold.spark ?? 0, reward: orderReward(g, 'spark', 8) };
    expect(orderView(g)!.reachesMarket).toBe(false);
    at(g, 'three-orders');
    expect(waitKind(g)).toBe('order');
    const a = advice(g)!;
    expect(a.kind).toBe('credits');
    expect(a.text.mouse).toBe('Wire the Spark Refiner\'s port to the Market: the order wants it sold, and none is.');
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
    expect(adviceTrials(g)!.trials.some((x) => /the order wants it sold, and none is/.test(x.text) && x.doable)).toBe(true);
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
      expect(a.text.mouse).toMatch(/^(The|A|An) \w+ Well makes more \w+ than is taken: wire its port to the Market\.$/);
      expect(a.text.touch).toBe(a.text.mouse);
      checkWording(a);
      const before = flowInfo(g).flowing;
      const idle = lookahead(g)!;
      expect(applyAdvice(g, a)).toBe(true);
      fixes.push(a.text.mouse);
      expect(advice(g)).toBeNull(); // quiet for 20 s after a change, on the Flow goal too
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
    expect(a.text.mouse).toBe('The Spark Refiner needs more Ember: buy Speed on the Ember Well (50¢).');
    expect(a.text.touch).toBe(a.text.mouse);
    // Two of three producers flow: the goal's valve would let this board through after a minute and a half.
    // With the fix all three flow, and the goal is done more than a minute sooner.
    expect(isFinite(a.eta)).toBe(true);
    expect(a.eta).toBeGreaterThan(85);
    expect(a.saves!).toBeGreaterThan(50);
    expect(isFinite(a.saves!)).toBe(true);
    expect(a.node).toBe(ember.id);
    expect(a.upgrade).toBe('speed');
    expect(a.cost).toBe(50);
    checkWording(a);
    expect(applyAdvice(g, a)).toBe(true);
    run(g, 30);
    expect(flowInfo(g)).toMatchObject({ producers: 3, flowing: 3 });
    expect(g.goal.ready).toBe(true);
  });

  it('Flow goal: a machine starved through a Router that favours a Lab is a board the adviser cannot fix, and the valve lets it through', () => {
    // The Ink goes into a Router that favours the Lab (goal 13), and the Assembler was wired from the Router: it
    // gets a fifth of the Ink. The fix that works is to favour the Assembler's wire instead, and that is what
    // the adviser used to say; it would take back what a goal card asked for, so it is no longer said. A wire
    // of its own from the Ink Refiner brings the Assembler to nine tenths of the Ink it needs: it dips under
    // the mark every few seconds, which is not "flowing", and so that is not a tip either.
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'L1'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    const ink = placeNode(g, 'refiner', 400, 400, { recipe: 'ink' })!;
    const spark = placeNode(g, 'refiner', 400, 540, { recipe: 'spark' })!;
    const murk = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    const ember = placeNode(g, 'well', 0, 0, { depositId: 4 })!;
    upgrade(g, ember.id, 'speed');
    connect(g, murk.id, 0, ink.id);
    connect(g, ember.id, 0, spark.id);
    connect(g, ink.id, 1, placeNode(g, 'void', 700, 650)!.id);
    connect(g, spark.id, 0, m.id);
    const router = placeNode(g, 'router', 600, 400)!;
    const lab = placeNode(g, 'lab', 800, 300)!;
    connect(g, ink.id, 0, router.id);
    const toLab = connect(g, router.id, 0, lab.id)!;
    connect(g, router.id, 0, m.id);
    favour(g, router.id, toLab.id);
    const glyph = placeNode(g, 'assembler', 800, 500, { recipe: 'glyph' })!;
    connect(g, router.id, 0, glyph.id);
    connect(g, spark.id, 0, glyph.id);
    connect(g, glyph.id, 0, m.id);
    run(g, 60);
    g.flowOn = true;
    expect(isFlowing(glyph)).toBe(false);
    at(g, 'hold-flow');
    run(g, 1);
    expect(flowInfo(g)).toMatchObject({ producers: 6, flowing: 5 });
    // What was weighed: the wire from the Ink Refiner, and more Ink. Never the Router.
    const trials = adviceTrials(g)!.trials;
    expect(trials.map((x) => x.text)).toContain('The Glyph Assembler needs more Ink: wire the Ink Refiner\'s Ink port to it.');
    expect(trials.some((x) => /favour/i.test(x.text))).toBe(false);
    expect(trials.every((x) => !x.worth)).toBe(true);
    expect(advice(g)).toBeNull();
    // Five of six for a minute and a half: the bar is not met...
    run(g, 80);
    expect(g.goal.ready).toBe(false);
    expect(g.flowHold).toBe(0);
    expect(goalView(g)!.flow).toMatchObject({ of: 6, running: 5, need: RULES.flow.holdShare });
    // ...and then the valve opens, and its ten seconds run where the player can see them.
    run(g, 10);
    expect(g.goal.ready).toBe(false);
    expect(goalView(g)!.flow).toMatchObject({ of: 6, running: 5, valve: true });
    expect(goalView(g)!.progress![0]).toBeGreaterThan(0);
    run(g, 10);
    expect(g.goal.ready).toBe(true);
    expect(favouredWire(g, router.id)).toBe(toLab.id); // the Router still stands as the card left it
  });

  it('Flow goal: a fix that only brings a producer closer to flowing is not a tip; the goal\'s valve lets that board through', () => {
    // An Ember Well (0.8/s) feeds two Spark Refiners that want 1/s each. One more level of Speed (1.0/s) leaves
    // both short, and nothing else is on offer: there is no free Ember deposit.
    const g = rich();
    g.techs = ['P1', 'R1', 'P3'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    const second = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    connect(g, second.id, 0, m.id);
    const ember = placeNode(g, 'well', 0, 0, { depositId: 4 })!;
    for (let i = 0; i < 2; i++) {
      const r = placeNode(g, 'refiner', 400, 500 + 120 * i, { recipe: 'spark' })!;
      connect(g, ember.id, 0, r.id);
      connect(g, r.id, 0, m.id);
    }
    run(g, 40);
    g.flowOn = true;
    g.credits = 60; // one level of Speed on the Ember Well, no more
    at(g, 'hold-flow');
    run(g, 1);
    expect(flowInfo(g)).toMatchObject({ producers: 5, flowing: 3 });
    const trials = adviceTrials(g)!.trials;
    expect(trials.some((x) => /needs more Ember: buy Speed on the Ember Well \(50¢\)/.test(x.text))).toBe(true);
    expect(trials.every((x) => !x.worth)).toBe(true);
    expect(advice(g)).toBeNull();
    // Two producers short is one too many for the valve as well: the goal waits for the player.
    run(g, 120);
    expect(g.goal.ready).toBe(false);
    expect(goalView(g)!.flow).toMatchObject({ of: 5, running: 3 });
    // With credits for two levels the first tip is still not offered alone (it fixes nothing by itself)...
    g.credits = 200;
    run(g, 1);
    const a = advice(g);
    if (a) {
      // ...unless the look-ahead shows it getting a Refiner flowing: then it must be true.
      const withTip = lookahead(g)!;
      expect(applyAdvice(withTip, a)).toBe(true);
      for (let i = 0; i < 500; i++) tick(withTip, 0.1);
      expect(withTip.nodes.some((n) => n.id === a.culprit && isFlowing(n))).toBe(true);
    }
  });

  it('Flow goal: a machine placed without a recipe and wired to the Market is told what to wire into it', () => {
    const g = rich();
    g.techs = ['P1', 'R1'];
    g.flowOn = true;
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    const second = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    connect(g, second.id, 0, m.id);
    const blank = placeNode(g, 'refiner', 400, 300)!; // from the hotbar: no recipe yet
    connect(g, blank.id, 0, m.id);
    run(g, 40);
    expect(blank.recipe).toBeNull();
    expect(flowInfo(g)).toMatchObject({ producers: 3, flowing: 2 }); // it counts, and can never flow as it is
    at(g, 'hold-flow');
    run(g, 1);
    const a = advice(g)!;
    expect(a, 'a tip for the machine with no recipe').not.toBeNull();
    expect(a.culprit).toBe(blank.id);
    expect(a.wire).toMatchObject({ to: blank.id });
    expect(a.text.mouse).toBe('The Refiner has nothing to work on: wire a Glint Well\'s port to it.');
    checkWording(a);
    expect(applyAdvice(g, a)).toBe(true);
    expect(g.nodes.find((n) => n.id === blank.id)!.recipe).toBe('shard');
    run(g, 60);
    expect(g.goal.ready).toBe(true);
  });

  it('a wait that can never end is never met with silence: no Lab, no Market, two kinds of Data with nothing coming in', () => {
    // No Lab at all (the player deleted it): the card waits for α that cannot come.
    const noLab = midGame();
    noLab.techs = noLab.techs.filter((id) => id !== 'P3');
    deleteNode(noLab, noLab.nodes.find((n) => n.type === 'lab')!.id);
    at(noLab, 'make-spark'); // α for Ember Deposits, before there are orders to pay any
    run(noLab, 10);
    expect(advice(noLab)).toBeNull(); // even here: nothing for 20 s after the player's own change
    run(noLab, 15);
    expect(waitInfo(noLab)).toMatchObject({ unit: 'α', eta: Infinity });
    const lab = advice(noLab)!;
    expect(lab, 'a tip with no Lab on the board').not.toBeNull();
    expect(lab.build).toBe('lab');
    expect(lab.text.mouse).toMatch(/^Build a Lab from the \w+ Refiner's (\w+ )?port \(100¢\): a Lab turns \w+ into α\.$/);
    checkWording(lab);
    expect(lab.saves).toBe(Infinity);
    const rescue = trial(noLab, lab, 3000, 0.25);
    expect(rescue.tip).toBeLessThan(Infinity);
    expect(rescue.idle).toBe(Infinity);

    // No Market (it can be deleted; the first one is free): the card waits for credits that cannot come.
    const noMarket = midGame();
    noMarket.techs.push('P4');
    deleteNode(noMarket, market(noMarket).id);
    noMarket.credits = 0;
    at(noMarket, 'make-glyph');
    run(noMarket, 25);
    expect(waitInfo(noMarket)).toMatchObject({ unit: '¢', eta: Infinity });
    const shop = advice(noMarket)!;
    expect(shop, 'a tip with no Market on the board').not.toBeNull();
    expect(shop.build).toBe('market');
    expect(shop.cost).toBe(0);
    expect(shop.text.mouse).toMatch(/^Build a Market from the \w+ Refiner's (\w+ )?port: nothing sells without one\.$/);
    expect(shop.text.touch).toBe(shop.text.mouse);
    checkWording(shop);
    expect(applyAdvice(noMarket, shop)).toBe(true);
    run(noMarket, 30);
    expect(noMarket.credits).toBeGreaterThan(10);

    // Two kinds of Data wanted and nothing coming in of either: no one action ends that wait, and the adviser
    // used to say nothing at all. Now it gets one kind moving, then the other. (A research priced in α and β on
    // a board with no Lab, before there are orders: orders pay a little of whatever Data is shortest, and with
    // them such a wait is very long rather than endless.)
    const g = glyphGame();
    g.techs = g.techs.filter((id) => id !== 'P2');
    deleteNode(g, g.nodes.find((n) => n.type === 'lab')!.id);
    g.data = { a: 0, b: 0, g: 0 };
    g.credits = 1e6;
    at(g, 'research-murk');
    const price = TECHS.P2.cost;
    TECHS.P2.cost = { a: 300, b: 40 };
    try {
      run(g, 25);
      expect(g.ordersOn).toBe(false);
      expect(g.dataRate.a + g.dataRate.b).toBeLessThan(0.01);
      expect(waitInfo(g)!.eta).toBe(Infinity);
      const first = advice(g)!;
      expect(first, 'a tip while two kinds of Data are stuck').not.toBeNull();
      expect(first.kind).toBe('data');
      expect(first.build).toBe('lab');
      // It does not end the wait on its own (the other kind is still stuck), but the wait cannot end without it.
      expect(first.saves).toBe(Infinity);
      expect(first.eta).toBe(Infinity);
      checkWording(first);
      expect(applyAdvice(g, first)).toBe(true);
      run(g, 25);
      expect(Number(g.dataRate.a > 0.01) + Number(g.dataRate.b > 0.01)).toBe(1);
      expect(waitInfo(g)!.eta).toBe(Infinity);
      const second = advice(g)!;
      expect(second, 'a tip for the kind of Data that is still stuck').not.toBeNull();
      expect(second.text.mouse).not.toBe(first.text.mouse);
      expect(second.saves).toBe(Infinity); // this one does end it
      expect(applyAdvice(g, second)).toBe(true);
      run(g, 30);
      expect(g.dataRate.a).toBeGreaterThan(0);
      expect(g.dataRate.b).toBeGreaterThan(0);
      expect(isFinite(waitInfo(g)!.eta)).toBe(true);
    } finally {
      TECHS.P2.cost = price;
    }
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
    expect(bulk.text).toBe('Your Wells run flat out: use Upgrade all on Speed (200¢) for more credits.');
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

describe('advice: how much a tip has to save', () => {
  it('15 s, and 1% of a very long wait; a share of 8% was measured and not adopted', () => {
    expect(ADVICE).toMatchObject({ minSaves: 15, minShare: 0.01, estSaves: 15, estShare: 0.04, horizon: 300 });
    // What 8% would do to a player far from the path: a save of some twenty minutes, followed tip by tip.
    const follow = () => {
      const g = midGame();
      g.techs.push('P4', 'P5', 'P7', 'S1');
      g.data = { a: 5000, b: 5000, g: 0 };
      g.credits = 100;
      at(g, 'build-fabricator');
      run(g, 0.1);
      let tips = 0;
      for (let i = 0; i < 14; i++) {
        const a = advice(g);
        if (!a) break;
        tips++;
        expect(a.saves!, a.text.mouse).toBeGreaterThanOrEqual(ADVICE.minSaves);
        expect(applyAdvice(g, a)).toBe(true);
        run(g, 25);
      }
      return { tips, left: waitInfo(g)!.eta + g.time };
    };
    const now = follow();
    expect(now.tips).toBeGreaterThanOrEqual(6);
    const share = ADVICE.minShare;
    ADVICE.minShare = 0.08;
    try {
      // It hears half as many tips, each of them true, and the save ends minutes later for it.
      const strict = follow();
      expect(strict.tips).toBeLessThanOrEqual(now.tips - 3);
      expect(strict.left).toBeGreaterThan(now.left + 60);
    } finally {
      ADVICE.minShare = share;
    }
    clearHistory();
  });
});

describe('advice: a long save, followed tip by tip', () => {
  it('every tip is true and worth at least 15 s, no two in a row ask for the same thing, and then it falls silent', () => {
    // 7,000¢ to go for the Fabricator on a few credits a second, with Bulk Upgrade and Data to spare.
    const g = midGame();
    g.techs.push('P4', 'P5', 'P7', 'S1');
    g.data = { a: 5000, b: 5000, g: 0 };
    g.credits = 100;
    at(g, 'build-fabricator');
    run(g, 0.1);
    const kinds: string[] = [];
    const said: string[] = [];
    const at_: number[] = [];
    let silent = 0;
    let last = Infinity;
    for (let i = 0; i < 20 && silent < 3; i++) {
      const a = advice(g);
      if (!a) {
        silent++;
        run(g, 30);
        continue;
      }
      expect(silent, 'once it has nothing more to say it stays silent').toBe(0);
      expect(a.kind).toBe('credits');
      checkWording(a);
      expect(a.cost ?? 0).toBeLessThanOrEqual(g.credits + 1e-6);
      const t = trial(g, a, 6000, 0.25);
      expect(t.applied, a.text.mouse).toBe(true);
      expect(t.tip, a.text.mouse).toBeLessThan(t.idle);
      kinds.push(a.research ? 'research' : a.cut ? 'cut' : a.all ? 'upgrade all' : a.upgrade ? 'upgrade' : a.build ? `build ${a.build}` : a.favour ? 'favour' : 'wire');
      said.push(a.text.mouse.replace(/\d+¢/g, '¢'));
      at_.push(g.time);
      expect(applyAdvice(g, a)).toBe(true);
      // Nothing for 20 s after it is followed, however much there is still to gain.
      run(g, 5);
      expect(advice(g)).toBeNull();
      expect(adviceQuiet(g)).toBeCloseTo(15, 1);
      run(g, 20);
      // The wait really does get shorter as the tips are followed.
      const eta = waitInfo(g)!.eta;
      if (i >= 2) expect(eta, said.join(' | ')).toBeLessThan(last);
      last = eta;
    }
    expect(kinds.length).toBeGreaterThanOrEqual(6);
    expect(silent).toBe(3); // the save goes on for minutes, and nothing left is worth 15 s
    expect(waitInfo(g)!.eta).toBeGreaterThan(60);
    expect(kinds, kinds.join()).toContain('build well');
    expect(kinds, kinds.join()).toContain('build refiner');
    expect(kinds, kinds.join()).toContain('upgrade all');
    // Never the same tip twice running (prices aside), and the same one only comes back after a minute.
    for (let i = 1; i < said.length; i++) {
      expect(said[i], `tips ${i} and ${i + 1}`).not.toBe(said[i - 1]);
      for (let k = 0; k < i; k++) if (said[k] === said[i]) expect(at_[i] - at_[k], said[i]).toBeGreaterThanOrEqual(RULES.tips.repeatAfter);
    }
    // A Refiner built by a tip arrives wired at both ends and working.
    const built = said.find((x) => /^Build a Refiner/.test(x))!;
    expect(built).toMatch(/^Build a Refiner from (the|a|an) \w+ Well's port \(¢\) and sell its \w+: ¢ each\.$/);
    expect(g.nodes.filter((n) => n.type === 'refiner').every((n) => n.util > 0.5)).toBe(true);
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
    run(g, 25); // the adviser says nothing for 20 s after a change, and an undo is one
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
// The words: nothing the adviser can say is longer than 90 characters.
//
// Every sentence is built by one of the functions in SAY, from names and numbers. Here each is called with
// every name the game has (every node with either article, every port, every material, every Data amount)
// and the largest prices there can be, and the longest result is measured.
// ---------------------------------------------------------------------------------------------------

describe('the words: every sentence of the repertoire fits the card', () => {
  const an = (noun: string) => `${/^[AEIOU]/.test(noun) ? 'an' : 'a'} ${noun}`;
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const both = (noun: string) => [`the ${noun}`, an(noun)];
  const mats = MAT_IDS.map((m) => MATERIALS[m].name);
  const raws = MAT_IDS.filter((m) => MATERIALS[m].tier === 0).map((m) => MATERIALS[m].name);
  const wells = raws.map((m) => `${m} Well`);
  const machineNouns = [...Object.values(RECIPES).map((r) => `${r.name} ${NODE_DEFS[r.machine].name}`), 'Refiner', 'Assembler', 'Fabricator'];
  const machines = machineNouns.flatMap(both);
  const producers = [...wells, ...machineNouns].flatMap(both);
  const Producers = producers.map(cap);
  const Machines = machines.map(cap);
  // "the Ink Refiner's port", "the Ink Refiner's Silt port" for a machine with two outputs, and "its port".
  const ports = [
    ...producers.map((n) => `${n}'s port`),
    ...Object.values(RECIPES).filter((r) => r.outputs.length > 1).flatMap((r) => both(`${r.name} ${NODE_DEFS[r.machine].name}`).flatMap((n) => r.outputs.map(([m]) => `${n}'s ${MATERIALS[m].name} port`))),
  ];
  const own = ['its port', ...Object.values(RECIPES).filter((r) => r.outputs.length > 1).flatMap((r) => r.outputs.map(([m]) => `its ${MATERIALS[m].name} port`))];
  const labs = both('Lab');
  const markets = both('Market');
  const units = Object.values(DATA_NAMES);
  // What a Lab makes of one item, with Deep Analysis and without.
  const yields = [...new Set(MAT_IDS.flatMap((m) => {
    const y = MATERIALS[m].study ?? DATA_YIELD[MATERIALS[m].tier].amount;
    return [y, y * 1.5];
  }))];
  const values = [...new Set(MAT_IDS.map((m) => MATERIALS[m].value))];
  // Speed level 25 on a Fabricator, and a hundredth Lab: nothing in the game costs more than these.
  const upgradePrice = upgradeCostAt('fabricator', 'speed', 24);
  const bulkPrice = 10 * upgradePrice;
  const buildPrice = nodeCostAt('lab', 40);
  const techs = Object.values(TECHS).map((t) => [t.name, costText(t)] as const);

  function* combos(lists: readonly (readonly unknown[])[], i = 0, acc: unknown[] = []): Generator<unknown[]> {
    if (i === lists.length) {
      yield acc;
      return;
    }
    for (const x of lists[i]) yield* combos(lists, i + 1, [...acc, x]);
  }

  // Who can be short of what, and what makes it: a machine, one of its inputs, and a Well or machine that gives that input.
  const makers = (m: string) => [
    ...wells.filter((w) => w === `${m} Well`),
    ...Object.values(RECIPES).filter((r) => r.outputs.some(([out]) => MATERIALS[out].name === m)).map((r) => `${r.name} ${NODE_DEFS[r.machine].name}`),
  ].flatMap(both);
  const shortOf = Object.values(RECIPES).flatMap((r) => r.inputs.flatMap(([m]) =>
    both(`${r.name} ${NODE_DEFS[r.machine].name}`).flatMap((who) => makers(MATERIALS[m].name).map((maker) => [cap(who), MATERIALS[m].name, maker, upgradePrice] as const))));

  // For each sentence: the values each argument can take (every combination is tried), or the tuples themselves.
  const cases: { [K in keyof typeof SAY]: readonly (readonly unknown[])[] | { tuples: readonly (readonly unknown[])[] } } = {
    study: [ports, labs, mats, yields, units],
    studyWaste: [ports, labs, yields, units],
    studyBetter: [ports, labs, mats],
    sellUnsold: [ports, markets, mats, values],
    sell: [ports, markets, mats, values],
    sellBacking: [ports, markets, mats, values],
    sellNotGlut: [ports, markets, mats, mats],
    sellGlut: [ports, markets, mats],
    order: [ports, markets, mats],
    orderStuck: [ports, markets],
    speed: [Producers, [upgradePrice], ['credits', ...units]],
    speedLab: [labs.map(cap), [upgradePrice], units],
    speedOrder: [producers, [upgradePrice], mats],
    bulk: [['Well', 'Refiner', 'Assembler', 'Fabricator'], [bulkPrice], ['credits', ...units]],
    bulkLabs: [[bulkPrice], units],
    favourStudy: [['Lab'], units],
    favourSell: [['Market']],
    favourOrder: [['Market'], mats],
    labSpeed: [[TECHS.R2.name], [costText(TECHS.R2)]],
    deepAnalysis: [[TECHS.R3.name], [costText(TECHS.R3)]],
    widerDemand: [[TECHS.C2.name], [costText(TECHS.C2)], mats],
    // A wire into a Lab from the machine that makes the thing, or from a Router, Merger or Silo it passes through.
    cut: [[...machines, ...['Router', 'Merger', 'Silo'].flatMap(both)], labs, mats, values],
    labFull: [ports, [buildPrice]],
    labNone: [ports, [buildPrice], mats, units],
    market: [ports, [buildPrice, 0]],
    refiner: [wells.flatMap(both).map((n) => `${n}'s port`), [buildPrice], mats, values],
    wellStudy: [raws, [buildPrice], labs],
    wellSell: [raws, [buildPrice], markets, values],
    wellFeed: [Machines, raws, [buildPrice]],
    flowSell: [Producers, mats, own, markets],
    flowNowhere: [Producers, mats, own, markets],
    flowSpeed: { tuples: shortOf },
    flowWire: [Machines, mats, ports],
    flowNone: [Machines, mats, ports],
    flowFavour: [Machines, mats],
    flowBlank: [Machines, ports],
    flowTaker: [Producers, machines, [upgradePrice]],
    // The steps of a goal card's line: a Well on a deposit, a Lab from that Well's port, the board's expansion.
    lineWell: [raws, [buildPrice]],
    lineLab: [raws, [buildPrice]],
    lineExpand: [[buildPrice * 10]],
  };

  it('the largest prices are eight digits, and the tech names are the real ones', () => {
    expect(upgradePrice).toBeGreaterThan(3e7);
    expect(String(Math.round(bulkPrice)).length).toBe(9);
    expect(buildPrice).toBeGreaterThan(1e6);
    expect(techs.length).toBe(Object.keys(TECHS).length);
    expect(RULES.tips.maxLength).toBe(90);
  });

  for (const name of Object.keys(SAY) as (keyof typeof SAY)[]) {
    it(`${name}: at most 90 characters, one sentence, no click, drag, tap or key`, () => {
      const say = SAY[name] as (...args: unknown[]) => string;
      const spec = cases[name];
      expect(spec, `no cases for ${name}`).toBeDefined();
      const all = 'tuples' in spec ? spec.tuples : combos(spec);
      let longest = '';
      let first = '';
      let n = 0;
      for (const args of all) {
        const text = say(...args);
        if (!n++) first = text;
        if ([...text].length > [...longest].length) longest = text;
      }
      expect(n).toBeGreaterThan(0);
      checkSentence(longest);
      // And an ordinary one reads as a sentence too.
      checkSentence(first);
    });
  }

  it('realistic pairings of the longest names stay inside the limit with room to spare', () => {
    // A Fabricator short of what another Fabricator makes, at the dearest Speed level there is: the longest "needs more" there can be.
    expect(shortOf.length).toBeGreaterThan(40);
    expect([...SAY.flowSpeed('The Paradox Fabricator', 'Dynamo', 'the Dynamo Fabricator', upgradePrice)].length).toBe(89);
    expect(SAY.flowSpeed('The Spark Refiner', 'Ember', 'the Ember Well', 50)).toBe('The Spark Refiner needs more Ember: buy Speed on the Ember Well (50¢).');
    expect(SAY.speed('A Glint Well', 80, 'α')).toBe('A Glint Well runs flat out: buy Speed (80¢) for more α.');
    expect(SAY.market('the Ink Refiner\'s Ink port', 0)).toBe('Build a Market from the Ink Refiner\'s Ink port: nothing sells without one.');
  });
});

// ---------------------------------------------------------------------------------------------------
// Manners: when the adviser keeps quiet.
// ---------------------------------------------------------------------------------------------------

describe('advice: few tips, and never in a chain', () => {
  /** A wait for α with plenty to say: Ink and both raw Wells unstudied, credits for a second Lab. */
  function waiting(): Game {
    const g = midGame();
    at(g, 'make-glyph');
    g.credits = 1e6;
    run(g, 0.1);
    return g;
  }

  it('says nothing for 20 s after the player changes the board, whatever the change', () => {
    expect(RULES.tips.quiet).toBe(20);
    const g = waiting();
    expect(adviceQuiet(g)).toBe(0);
    const first = advice(g)!;
    expect(first).not.toBeNull();
    // Following the tip...
    expect(applyAdvice(g, first)).toBe(true);
    expect(adviceQuiet(g)).toBe(20);
    expect(advice(g)).toBeNull();
    expect(adviceTrials(g)!.trials.some((x) => x.worth)).toBe(true); // there is more to gain: it is being polite, not empty-handed
    run(g, 19.5);
    expect(advice(g)).toBeNull();
    run(g, 1);
    expect(adviceQuiet(g)).toBe(0);
    const second = advice(g);
    expect(second).not.toBeNull();
    // ...or doing something of one's own: an upgrade, a research, an undo, a wire nobody asked for.
    const lab = g.nodes.find((n) => n.type === 'lab')!;
    for (const change of [() => upgrade(g, lab.id, 'speed'), () => research(g, 'L2'), () => undo(g), () => !!connect(g, well(g).id, 0, lab.id), () => expandBoard(g)]) {
      run(g, 30);
      g.data.a = 100;
      expect(adviceQuiet(g)).toBe(0);
      expect(change()).toBe(true);
      expect(adviceQuiet(g)).toBe(20);
      expect(advice(g)).toBeNull();
      run(g, 10);
      expect(advice(g)).toBeNull();
    }
    // Claiming is not a change to the board, and neither is waiting.
    run(g, 30);
    expect(adviceQuiet(g)).toBe(0);
    // The notes are part of the game: a copy (a save, or a game handed to a worker) answers the same.
    expect(connect(g, well(g).id, 0, market(g).id) || upgrade(g, lab.id, 'speed')).toBeTruthy();
    const copy = deserialize(serialize(g))!;
    expect(copy.edits).toEqual(g.edits);
    expect(adviceQuiet(copy)).toBe(20);
    expect(advice(copy)).toBeNull();
    run(copy, 21);
    run(g, 21);
    expect(advice(copy)?.text).toEqual(advice(g)?.text);
  });

  it('never asks again for what has just been done to the same kind of node, for a minute', () => {
    expect(RULES.tips.repeatAfter).toBe(60);
    // Two Labs, both full (two Wells into each): "buy Speed" on one, then on the other, then on the first
    // again, was the old chain.
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3'];
    g.deposits.push({ id: 901, x: 100, y: 800, mat: 'glint' }, { id: 902, x: 100, y: 940, mat: 'murk' });
    connect(g, well(g).id, 0, market(g).id);
    const lab = placeNode(g, 'lab', 900, 100)!;
    const second = placeNode(g, 'lab', 900, 400)!;
    for (const [dep, to] of [[2, lab], [3, lab], [901, second], [902, second]] as const) connect(g, placeNode(g, 'well', 0, 0, { depositId: dep })!.id, 0, to.id);
    run(g, 40);
    expect(lab.util).toBeGreaterThan(0.95);
    expect(second.util).toBeGreaterThan(0.95);
    at(g, 'make-glyph'); // 1,140 α at 2 α a second
    g.credits = 700; // the Assembler's price is in hand: the wait is for α alone
    g.data.a = 0;
    run(g, 0.1);
    const speedOnLab = (x: { text: string }) => /^A Lab is full: buy Speed/.test(x.text);
    expect(adviceTrials(g)!.trials.filter(speedOnLab).length).toBe(2);
    // The player buys Speed on one Lab (a tip said so, or they thought of it themselves).
    expect(upgrade(g, lab.id, 'speed')).toBe(true);
    expect(g.edits![g.edits!.length - 1]).toEqual({ at: g.time, what: 'upgrade:speed:Lab' });
    run(g, 25);
    // The other Lab is as full as before, and Speed on it is as good a move as it was: it is not said.
    expect(second.util).toBeGreaterThan(0.95);
    expect(adviceTrials(g)!.trials.filter(speedOnLab).length).toBe(0);
    expect(advice(g)?.text.mouse ?? '').not.toMatch(/^A Lab is full/);
    // After a minute it may be said again.
    run(g, 36);
    expect(adviceTrials(g)!.trials.filter(speedOnLab).length).toBe(2);
    // A different action on the same node, or the same action on another kind of node, was never held back.
    const h = waiting();
    const hLab = h.nodes.find((n) => n.type === 'lab')!;
    expect(upgrade(h, hLab.id, 'speed')).toBe(true);
    run(h, 25);
    const next = advice(h)!;
    expect(next).not.toBeNull();
    expect(next.text.mouse).not.toMatch(/^(The|A) Lab is full: buy Speed/);
  });

  it('every change is noted as what it was, and nothing older than a minute is kept', () => {
    const g = rich();
    g.techs.push('S1', 'R2');
    const m = market(g);
    const notes = () => g.edits!.map((e) => e.what);
    expect(g.edits).toEqual([]);
    connect(g, well(g).id, 0, m.id);
    const r = placeNode(g, 'refiner', 400, 100)!;
    connect(g, well(g).id, 0, r.id);
    const lab = placeNode(g, 'lab', 700, 100)!;
    const w = connect(g, r.id, 0, lab.id)!;
    upgrade(g, lab.id, 'speed');
    placeNode(g, 'well', 0, 0, { depositId: 2 });
    expect(notes()).toEqual([
      'wire:Glint Well>Market', 'build:refiner', 'wire:Glint Well>Shard Refiner', 'build:lab', 'wire:Shard Refiner>Lab', 'upgrade:speed:Lab', 'build:well:glint',
    ]);
    run(g, 10);
    cutWire(g, w.id);
    upgradeAll(g, 'well', 'speed');
    const router = placeNode(g, 'router', 600, 300)!;
    connect(g, r.id, 0, router.id);
    const toLab = connect(g, router.id, 0, lab.id)!;
    connect(g, router.id, 0, m.id);
    favour(g, router.id, toLab.id);
    g.data.b = 1000;
    expect(research(g, 'R3')).toBe(true);
    expect(notes().slice(7)).toEqual([
      'cut:Shard Refiner>Lab', 'upgrade:speed:Glint Well', 'upgrade:speed:Glint Well', 'upgrade-all:speed:well', 'build:router', 'wire:Shard Refiner>Router',
      'wire:Router>Lab', 'wire:Router>Market', 'favour:Lab', 'research:R3',
    ]);
    // A minute on, the next change drops what came before it.
    run(g, 55);
    setMode(g, router.id, 'even');
    expect(g.edits!.length).toBeLessThan(17);
    expect(notes()).toContain('research:R3');
    expect(notes()).not.toContain('build:refiner');
    run(g, 61);
    deleteNode(g, router.id);
    expect(notes()).toEqual(['edit']);
    // A look-ahead copy has notes of its own: trying a tip on it does not make the adviser go quiet on the game.
    run(g, 25);
    const copy = lookahead(g)!;
    upgrade(copy, copy.nodes.find((n) => n.type === 'lab')!.id, 'speed');
    expect(adviceQuiet(copy)).toBe(20);
    expect(adviceQuiet(g)).toBe(0);
  });

  it('a tip that has left the card does not come back while the board is as it is', () => {
    // The wait runs down, the saving with it. Second by second, with nobody touching the board, a tip may
    // appear, stay and go: it never goes and comes back, and two tips never take turns.
    for (const id of ['make-glyph', 'make-mist', 'build-fabricator']) {
      const g = glyphGame();
      g.techs.push('P5');
      at(g, id);
      g.data = { a: 0, b: 200, g: 0 };
      g.credits = 300;
      if (id === 'make-glyph') g.techs = g.techs.filter((t) => t !== 'P4' && t !== 'P5');
      run(g, 0.1);
      const seen: string[] = [];
      for (let t = 0; t < 900 && waitKind(g) && g.rev === g.rev; t++) {
        const a = advice(g);
        const text = a ? a.text.mouse : '';
        if (seen[seen.length - 1] !== text) seen.push(text);
        if (a) expect(a.saves!, text).toBeGreaterThanOrEqual(ADVICE.minSaves);
        run(g, 1);
      }
      const tips = seen.filter(Boolean);
      expect(new Set(tips).size, `${id}: ${seen.join(' | ')}`).toBe(tips.length);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// The property: on real boards, every tip is affordable, can be done, and is true.
//
// The boards come from the scripted newcomer (tests/cardPlayer.ts): with the cards' "while you wait" lines and
// without them (a player who reads only the hints leaves far more for the adviser to say, so most of the
// repertoire is exercised there), with tips and without, across order seeds and two speeds of hands. Every few
// seconds of every wait, whatever the adviser says is collected with the game as it stood. Each tip is then
// tried: one copy of that game gets the tip, one gets nothing, both run on at the game's own pace with nobody
// playing, and the wait must end strictly sooner with the tip. "Saves about 50 s" must not be an empty
// promise either.
// ---------------------------------------------------------------------------------------------------

interface Case { g: Game; a: Advice; from: string }
interface Followed { name: string; tips: { at: number; text: string; kind: Advice['kind']; saves: number | undefined }[] }

/** A board in the middle of one of the long waits, as a player who reads only hints and tips has it. */
interface Mid { g: Game; from: string }

function collect(): { cases: Case[]; runs: Followed[]; mids: Mid[]; studying: Game[] } {
  const cases: Case[] = [];
  const followed: Followed[] = [];
  const mids: Mid[] = [];
  /** The card players' boards at the first idle second of "Study Glyph for β" (the Glyph wire just made). */
  const studying: Game[] = [];
  const seen = new Set<string>();
  const runs: { tips: boolean; seed: number; hands?: number; studyAll?: boolean; meanwhile?: boolean }[] = [
    { tips: true, seed: 0 }, { tips: true, seed: 1 }, { tips: true, seed: 2 }, { tips: true, seed: 3, hands: 10 }, { tips: false, seed: 4 },
    { tips: true, seed: 0, meanwhile: false }, { tips: true, seed: 1, meanwhile: false }, { tips: true, seed: 2, meanwhile: false, hands: 10 },
    { tips: false, seed: 2, meanwhile: false, studyAll: true },
  ];
  for (const o of runs) {
    let idle = 0;
    const name = `${o.meanwhile === false ? 'hints' : 'cards'}${o.tips ? '+tips' : ''}/${o.seed}`;
    const waited = new Map<number, number>();
    let study = false;
    const r = playByTheCard({
      ...o,
      wall: 30 * 60, // with the hints alone a wait can take a quarter of an hour
      onIdle: (g) => {
        if (!study && o.meanwhile !== false && !o.hands && activeGoal(g)!.id === 'study-glyph') {
          study = true;
          studying.push(cloneGame(g)!);
        }
        // The board 20 s and 60 s into the waits for Assembly, Breeze Deposits and the Fabricator, from the two
        // players who follow tips and no lines: where two near-equal tips once took turns on the card.
        if (o.tips && o.meanwhile === false && !o.hands && waitKind(g) && ['make-glyph', 'make-mist', 'build-fabricator'].includes(activeGoal(g)!.id)) {
          const n = (waited.get(g.goal.i) ?? 0) + 1;
          waited.set(g.goal.i, n);
          if (n === 20 || n === 60) mids.push({ g: cloneGame(g)!, from: `${name} ${activeGoal(g)!.id}, ${n} s into the wait` });
        }
        if (idle++ % 4) return;
        const a = advice(g);
        if (!a) return;
        // The same tip on the same goal is tried once, not every few seconds of the wait.
        const key = `${name}|${g.goal.i}|${a.text.mouse}`;
        if (seen.has(key)) return;
        seen.add(key);
        cases.push({ g: cloneGame(g)!, a, from: `${name} ${activeGoal(g)!.id} at ${Math.round(g.time)}s` });
      },
    });
    followed.push({ name, tips: r.tips.map((t) => ({ at: t.at, text: t.text, kind: t.kind, saves: t.saves })) });
  }
  return { cases, runs: followed, mids, studying };
}

describe('every tip on a real board is affordable, can be done, and is true', () => {
  const { cases, runs, mids, studying } = collect();
  const what = (a: Advice) => (a.cut ? 'cut' : a.favour ? 'favour' : a.research ? 'research' : a.build ? `build ${a.build}` : a.upgrade ? (a.all ? 'upgrade all' : 'upgrade') : 'wire');

  it('there are plenty of them, of every kind and for most of the repertoire', () => {
    expect(cases.length).toBeGreaterThan(30);
    const count: Record<string, number> = {};
    for (const c of cases) count[`${c.a.kind}: ${what(c.a)}`] = (count[`${c.a.kind}: ${what(c.a)}`] ?? 0) + 1;
    // Which parts of the repertoire real boards exercised; the rest is covered on built boards above.
    console.info(`adviser: ${cases.length} tips collected from real boards, by kind and action: ${Object.entries(count).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    for (const x of ['data: wire', 'data: upgrade', 'data: build lab', 'data: build well', 'flow: upgrade']) expect(Object.keys(count), x).toContain(x);
  });

  it('left alone in the middle of a long wait, no tip goes and comes back, and two tips never take turns', () => {
    // On these boards (the card player who follows tips and no lines, 20 s and 60 s into the waits of goals 15,
    // 18 and 21) "buy Speed on the Lab" and "build a second Lab" used to alternate every half minute. Watched
    // here second by second for four minutes with nobody touching anything, not even the order's Claim (the
    // case that showed it): whatever is said is said once.
    expect(mids.length).toBe(12);
    expect(new Set(mids.map((m) => activeGoal(m.g)!.id)).size).toBe(3);
    let said = 0;
    for (const { g, from } of mids) {
      const goal = g.goal.i;
      const rev = g.rev;
      const seen: string[] = [];
      for (let t = 0; t < 240 && g.goal.i === goal && !g.goal.ready && waitKind(g); t++) {
        const text = reads(advice(g)?.text.mouse ?? '');
        if (seen[seen.length - 1] !== text) seen.push(text);
        run(g, 1);
      }
      expect(g.rev, from).toBe(rev);
      const tips = seen.filter(Boolean);
      said += tips.length;
      expect(new Set(tips).size, `${from}: ${seen.map((x) => x || '—').join(' | ')}`).toBe(tips.length);
    }
    expect(said).toBeGreaterThanOrEqual(3); // (the adviser did have things to say on them)
  });

  it('"Study Glyph for β" with raw Wells crowding the one Lab: Glyph starves, and within half a minute the adviser says what ends it', () => {
    // A Lab studies one item a second and takes what arrived first. A player who wired their raw Wells into
    // the Lab of goal 7 (instead of giving each a Lab of its own, or on top of that) and then wires the Glyph
    // in, as this card says, gets next to no β: the Wells keep the Lab full. The rule stands; what is tested
    // is that the game says so in time. The boards are the card players' own at this goal, bent two ways.
    expect(studying.length).toBe(4);
    const typeOf = (g: Game, id: number) => g.nodes.find((n) => n.id === id)!.type;
    const crowd: Record<string, (g: Game, lab: number) => void> = {
      // "A Well and a Lab built from its port" misread: the new Wells go into the Lab that stands, and no Lab is built.
      'no Lab of their own': (g, lab) => {
        for (const other of g.nodes.filter((n) => n.type === 'lab' && n.id !== lab)) {
          const fed = g.wires.filter((w) => w.to === other.id).map((w) => w.from);
          expect(deleteNode(g, other.id)).toBe(true);
          for (const from of fed) connect(g, from, 0, lab);
        }
      },
      // Every Well wired to the Lab as well as wherever it went (the adviser's own "Glint is 1 α each in a Lab", taken as a rule).
      'every Well into the Lab too': (g, lab) => {
        for (const w of g.nodes.filter((n) => n.type === 'well')) connect(g, w.id, 0, lab);
      },
    };
    const report: string[] = [];
    for (const [i, board] of studying.entries()) {
      for (const [how, make] of Object.entries(crowd)) {
        const g = cloneGame(board)!;
        const from = `board ${i}, ${how}`;
        const lab = g.nodes.find((n) => n.type === 'lab')!;
        const glyph = g.nodes.find((n) => n.recipe === 'glyph')!;
        // Back to the moment before the hint was followed; the Wells went in first.
        expect(cutWire(g, g.wires.find((w) => w.from === glyph.id && w.to === lab.id)!.id), from).toBe(true);
        make(g, lab.id);
        expect(g.wires.filter((w) => w.to === lab.id && typeOf(g, w.from) === 'well').length, from).toBeGreaterThanOrEqual(2);
        g.edits = [];
        run(g, 30);
        g.data.b = 0;
        // "Drag from the Assembler's port to a Lab."
        expect(connect(g, glyph.id, 0, lab.id), from).not.toBeNull();
        run(g, 5);
        expect(waitKind(g)).toBe('data');
        expect(waitInfo(g)).toMatchObject({ unit: 'β', need: RULES.goals.studyBeta });
        expect(advice(g), from).toBeNull(); // the quiet after the player's own change
        run(g, 16);
        // 21 s after the wire, 9 s before the half minute is up: the one thing that ends it, by name.
        const a = advice(g)!;
        expect(a, from).not.toBeNull();
        expect(a.text.mouse, from).toMatch(/^Build a Lab from the Glyph Assembler's port \(\d+¢\): the Lab you have is full\.$/);
        expect(a).toMatchObject({ kind: 'data', build: 'lab', node: glyph.id, port: 0, steps: 1 });
        expect(a.cost!).toBeLessThanOrEqual(g.credits);
        expect(a.saves!, from).toBeGreaterThanOrEqual(60);
        checkWording(a);
        // Left alone, four more minutes do not bring the 40 β.
        const idle = cloneGame(g)!;
        run(idle, 240);
        expect(idle.goal.ready, from).toBe(false);
        // Followed: Glyph has a Lab of its own, and the goal is done within the minute after.
        expect(applyAdvice(g, a), from).toBe(true);
        let took = 0;
        while (!g.goal.ready && took < 200) {
          run(g, 1);
          took++;
        }
        report.push(`${from}: β after four idle minutes ${idle.data.b.toFixed(0)} of 40; with the tip, done ${took} s later`);
        expect(took, from).toBeLessThanOrEqual(60);
        clearHistory();
      }
    }
    console.info(`"Study Glyph for β" on a crowded Lab:\n  ${report.join('\n  ')}`);
  });

  it('affordable, worded properly, worth 15 s, and never against a goal card', () => {
    for (const { g, a, from } of cases) {
      expect(a.cost ?? 0, from).toBeLessThanOrEqual(g.credits + 1e-6);
      if (a.research) expect(techAffordable(g, TECHS[a.research]), from).toBe(true);
      checkWording(a);
      expect(a.eta, from).toBeGreaterThan(ADVICE.minWait);
      if (a.kind === 'flow') expect(a.culprit, from).toBeDefined();
      // "Cut this wire" only where the active card's own line asks for that wire to go.
      if (a.cut) expect(activeGoal(g)!.meanwhile?.cuts?.(g) ?? [], `${from}: ${a.text.mouse}`).toContain(a.cut.wire);
      // A Router that favours a Lab (as "Route more to a Lab" asks) is left that way.
      if (a.favour) {
        const now = favouredWire(g, a.favour.router);
        const to = now == null ? null : g.nodes.find((n) => n.id === g.wires.find((w) => w.id === now)!.to)!;
        expect(to?.type, `${from}: ${a.text.mouse}`).not.toBe('lab');
      }
      // Nothing the active card asks the player to take away is put back.
      if (a.wire) {
        const asked = (activeGoal(g)!.meanwhile?.cuts?.(g) ?? []).map((id) => g.wires.find((w) => w.id === id)!);
        expect(asked.some((w) => w.from === a.wire!.from && g.nodes.find((n) => n.id === a.wire!.to)?.type === 'lab'), `${from}: ${a.text.mouse}`).toBe(false);
      }
      // The player had not touched the board for 20 s when it was said.
      expect(adviceQuiet(g), from).toBe(0);
    }
  });

  it('what was followed: at least 20 s after the tip before, and never the same thing twice running', () => {
    let followed = 0;
    for (const { name, tips } of runs) {
      followed += tips.length;
      for (let i = 1; i < tips.length; i++) {
        expect(tips[i].at - tips[i - 1].at, `${name}: ${tips[i].text}`).toBeGreaterThanOrEqual(RULES.tips.quiet + 15);
        const same = tips[i].text.replace(/\d+¢/g, '¢') === tips[i - 1].text.replace(/\d+¢/g, '¢');
        if (same) expect(tips[i].at - tips[i - 1].at, `${name}: ${tips[i].text}`).toBeGreaterThanOrEqual(RULES.tips.repeatAfter);
      }
      for (const t of tips) if (t.kind !== 'flow') expect(t.saves!, `${name}: ${t.text}`).toBeGreaterThanOrEqual(ADVICE.minSaves);
    }
    expect(followed).toBeGreaterThan(20);
  });

  it('can be done, and in the real game the wait ends sooner with it than without', () => {
    // The real game, not the adviser's own look-ahead: plain copies in which orders keep being rolled and are
    // claimed ten seconds late, at the game's own 20 ticks a second, under the game's order sequence and one
    // other.
    //
    // For the player the build is tuned for (the cards, their lines, and tips) every tip is better outright.
    // A player who ignores the lines sits in waits of five to eight minutes in which orders bring in a third of
    // the α, in lumps of 40 to 130: there the same tip on the same board can gain a minute or lose half of one
    // depending on which orders happen to be rolled, and on the second it is followed. Those tips are held to
    // what they do on the whole: nine in ten outcomes better, and on average most of what was promised.
    const report: string[] = [];
    let rescued = 0;
    const outcomes: number[] = [];
    let promised = 0;
    let delivered = 0;
    let smallestOwn = Infinity;
    for (const { g, a, from } of cases) {
      const before = state(g);
      if (a.kind === 'flow') {
        // A Flow tip: the producer it names flows with it, and goes on flowing, and does not without it; or the goal is done sooner.
        const withTip = lookahead(g)!;
        const without = lookahead(g)!;
        expect(applyAdvice(withTip, a), from).toBe(true);
        let dips = 0;
        for (let i = 0; i < 700; i++) {
          tick(withTip, 0.1);
          tick(without, 0.1);
          if (i >= 500 && !withTip.goal.ready && !withTip.nodes.some((n) => n.id === a.culprit && countsForFlow(withTip, n) && isFlowing(n))) dips++;
        }
        const flows = (x: Game) => x.nodes.some((n) => n.id === a.culprit && countsForFlow(x, n) && isFlowing(n));
        const sooner = withTip.goal.ready && !without.goal.ready;
        expect(sooner || (flows(withTip) && dips === 0 && !flows(without)), `${from}: ${a.text.mouse}`).toBe(true);
        expect(state(g), from).toBe(before); // trying it changed nothing
        continue;
      }
      // With the hints alone a wait can be a quarter of an hour: follow it to its end, within reason.
      const limit = Math.min(4500, Math.max(900, 1.5 * (isFinite(a.eta) ? a.eta : 0)));
      const gains = realGains(g, a, limit, 2, 0.05);
      expect(state(g), from).toBe(before); // trying it changed nothing
      const line = `${from}: gains ${gains.map((x) => (isFinite(x) ? x.toFixed(0) : '∞')).join(', ')} s, promised ${a.saves?.toFixed(0)} s :: ${a.text.mouse}`;
      report.push(line);
      for (const x of gains) expect(Number.isNaN(x), line).toBe(false); // with the tip the wait ends, every time
      if (gains.some((x) => !isFinite(x))) {
        rescued++;
        continue;
      }
      if (from.startsWith('cards')) {
        // The tuned player: better under the game's own order sequence and the other, by most of what was promised.
        for (const x of gains) expect(x, line).toBeGreaterThanOrEqual(0.5 * a.saves! - 2);
        smallestOwn = Math.min(smallestOwn, gains[0]);
      }
      // Anyone: never worse by more than an order or two can explain.
      for (const x of gains) expect(x, line).toBeGreaterThan(-60);
      outcomes.push(...gains);
      promised += a.saves! * gains.length;
      delivered += gains.reduce((x, y) => x + y, 0);
    }
    expect(outcomes.length).toBeGreaterThan(40);
    const better = outcomes.filter((x) => x > 0.5).length;
    expect(better / outcomes.length, report.join('\n')).toBeGreaterThanOrEqual(0.9);
    expect(delivered / promised, report.join('\n')).toBeGreaterThanOrEqual(0.6);
    expect(smallestOwn).toBeGreaterThanOrEqual(10);
    // One line for whoever tunes the adviser next: how honest the promises were.
    console.info(`adviser: ${outcomes.length / 2} tips timed in the real game on real boards, under two order sequences each: ${better} of ${outcomes.length} outcomes better, `
      + `worst ${Math.min(...outcomes).toFixed(0)} s; on average ${(100 * delivered / promised).toFixed(0)}% of what was promised; for the card-following player the smallest saving was ${smallestOwn.toFixed(1)} s; `
      + `${rescued} ended a wait that would not have ended.`);
  });
});

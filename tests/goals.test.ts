import { describe, expect, it } from 'vitest';
import { claimGoal, connect, cutWire, expandBoard, placeNode, setMode, setWeight, undo, upgrade, upgradeAll } from '../src/actions';
import { RULES, TECHS } from '../src/content';
import { has, nodeCost, research } from '../src/economy';
import { GOALS, MAIN_GOALS, activeGoal, goalAge, goalById, goalView, rewardText, routerFavoursLab } from '../src/goals';
import { Game, deserialize, serialize } from '../src/state';
import { fresh, market, rich, run, take, well } from './helpers';

const indexOf = (id: string) => GOALS.findIndex((x) => x.id === id);

/** Jump straight to a goal, as if everything before it had been claimed. */
function at(g: Game, id: string) {
  g.goal = { i: indexOf(id), ready: false };
}

describe('goal chain: the table (2.4)', () => {
  it('has the 22 goals of the plan, in order, then four free-play goals', () => {
    expect(MAIN_GOALS).toBe(22);
    expect(GOALS.map((x) => x.title).slice(0, 22)).toEqual([
      'Wire the Well to the Market',
      'Place a second Well',
      'Wire it to the Market too',
      'Build a Refiner from a Well\'s port',
      'Sell your first Shard',
      'Upgrade a Well',
      'Build a Lab and feed it',
      'Research Murk Deposits',
      'Refine Murk into Ink',
      'Give the Silt somewhere to go',
      'Make your first Spark',
      'Fill your first order',
      'Route more to a Lab than to the Market',
      'Expand the board',
      'Assemble your first Glyph',
      'Hold 95% Flow for 10 seconds',
      'Study Glyph for β',
      'Make your first Mist',
      'Assemble your first Prism',
      'Fill three orders',
      'Build a Fabricator',
      'Make your first Lens',
    ]);
    expect(GOALS.slice(22).map((x) => x.id)).toEqual(['make-clay', 'make-coil', 'make-dynamo', 'make-paradox']);
    expect(GOALS.slice(0, 22).every((x) => !x.free)).toBe(true);
    expect(GOALS.slice(22).every((x) => x.free)).toBe(true);
  });

  it('gives every goal a unique id and a hint for mouse and for touch', () => {
    expect(new Set(GOALS.map((x) => x.id)).size).toBe(GOALS.length);
    for (const goal of GOALS) {
      expect(goal.hint.mouse.length, goal.id).toBeGreaterThan(10);
      expect(goal.hint.touch.length, goal.id).toBeGreaterThan(10);
      // Touch wording never asks for a click, a drag or a key.
      expect(goal.hint.touch, goal.id).not.toMatch(/\b(click|drag|press|key)\b/i);
    }
  });

  it('pays the rewards of the plan, as tuned with the pacing bot', () => {
    const reward = (id: string) => goalById(id)!.reward;
    expect(reward('wire-market')).toEqual({ credits: 12 });
    expect(reward('second-well')).toEqual({ credits: 10 });
    expect(reward('wire-all-wells')).toEqual({ credits: 50, techs: ['P1'] });
    expect(reward('sell-shard')).toEqual({ credits: 70, techs: ['R1'] });
    expect(reward('upgrade-well')).toEqual({ credits: 50 });
    expect(reward('feed-lab')).toEqual({ a: 15 });
    expect(reward('make-spark')).toEqual({ a: 25, unlock: 'orders' });
    expect(reward('first-order')).toEqual({ credits: 200, techs: ['L1'] });
    expect(reward('make-glyph')).toEqual({ credits: 150, unlock: 'flow' });
    expect(reward('hold-flow')).toEqual({ credits: 150 });
    expect(reward('make-prism')).toEqual({ credits: 600, b: 40 });
    expect(reward('three-orders')).toEqual({ credits: 1200, b: 60, techs: ['S1'] });
    expect(reward('build-fabricator')).toEqual({ b: 40 });
    expect(reward('make-lens')).toEqual({ unlock: 'end' });
    expect(rewardText(reward('wire-all-wells'))).toBe('Refining + 50¢');
    expect(rewardText(reward('make-spark'))).toBe('Orders + 25α');
    expect(rewardText(reward('three-orders'))).toBe('Bulk Upgrade + 1200¢ + 60β');
  });

  it('flags four goals as big celebrations (the fifth is the first Flow State)', () => {
    expect(GOALS.filter((x) => x.big).map((x) => x.id)).toEqual(['sell-shard', 'feed-lab', 'make-glyph', 'make-lens']);
  });

  it('is the only way to get Refining, Lab, Routing and Bulk Upgrade', () => {
    const granted = GOALS.flatMap((x) => x.reward.techs ?? []).sort();
    expect(granted).toEqual(['L1', 'P1', 'R1', 'S1']);
    // The one other tech that cannot be bought is Market Lens: it comes with the first sale over demand (tests/rules.test.ts).
    const auto = Object.values(TECHS).filter((t) => t.auto).map((t) => t.id).sort();
    expect(auto).toEqual(['C1', ...granted]);
    const g = fresh();
    g.data = { a: 1e6, b: 1e6, g: 1e6 };
    for (const id of auto) expect(research(g, id)).toBe(false);
    // The tech tree says which goal grants each of them.
    for (const goal of GOALS) for (const id of goal.reward.techs ?? []) expect(TECHS[id].auto).toContain(goal.title);
  });
});

describe('goal chain: ready, claim, skip ahead', () => {
  it('becomes ready when the condition holds, then waits for a claim', () => {
    const g = fresh();
    run(g, 1);
    expect(g.goal).toEqual({ i: 0, ready: false });
    expect(claimGoal(g)).toBe(false);
    connect(g, well(g).id, 0, market(g).id);
    run(g, 1);
    expect(g.goal).toEqual({ i: 0, ready: true });
    const ready = take(g, 'goal-ready');
    expect(ready.length).toBe(1);
    expect(ready[0].goal).toBe('wire-market');
    expect(ready[0].index).toBe(0);
    run(g, 5);
    expect(take(g, 'goal-ready').length).toBe(0); // raised once, not every tick
    expect(g.stats.fromGoals).toBe(0); // nothing is paid before the claim

    const before = g.credits;
    expect(claimGoal(g)).toBe(true);
    expect(g.credits).toBeCloseTo(before + 12, 9);
    expect(g.stats.fromGoals).toBe(12);
    const claimed = take(g, 'goal-claimed');
    expect(claimed.length).toBe(1);
    expect(claimed[0].goal).toBe('wire-market');
    expect(claimed[0].reward).toEqual({ credits: 12 });
    expect(claimed[0].big).toBe(false);
    expect(g.goal).toEqual({ i: 1, ready: false });
    expect(claimGoal(g)).toBe(false); // the next goal is not done yet
  });

  it('stays ready even if the condition stops holding', () => {
    const g = fresh();
    const w = connect(g, well(g).id, 0, market(g).id)!;
    run(g, 1);
    cutWire(g, w.id);
    run(g, 1);
    expect(g.goal.ready).toBe(true);
    expect(claimGoal(g)).toBe(true);
  });

  it('a goal already met when it is reached is ready at once', () => {
    const g = fresh();
    g.credits = 100;
    // Do goals 1 to 3 before claiming anything.
    connect(g, well(g).id, 0, market(g).id);
    const w2 = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    connect(g, w2.id, 0, market(g).id);
    run(g, 1);
    expect(g.goal).toEqual({ i: 0, ready: true });
    take(g, 'goal-ready');

    expect(claimGoal(g)).toBe(true);
    expect(g.goal).toEqual({ i: 1, ready: true }); // no tick needed
    expect(take(g, 'goal-ready').map((e) => e.goal)).toEqual(['second-well']);
    expect(claimGoal(g)).toBe(true);
    expect(g.goal).toEqual({ i: 2, ready: true });
    expect(has(g, 'P1')).toBe(false);
    const credits = g.credits;
    expect(claimGoal(g)).toBe(true);
    // Refining + 50¢, and the next goal (build a Refiner) is not met yet.
    expect(has(g, 'P1')).toBe(true);
    expect(g.credits).toBeCloseTo(credits + 50, 9);
    expect(take(g, 'tech').map((e) => e.id)).toEqual(['P1']);
    expect(g.goal).toEqual({ i: 3, ready: false });
    expect(activeGoal(g)!.id).toBe('build-refiner');
  });

  it('marks the big celebrations on the claim event and grants the Lab', () => {
    const g = fresh();
    at(g, 'sell-shard');
    g.sold.shard = 1;
    run(g, 0.1);
    expect(claimGoal(g)).toBe(true);
    const ev = take(g, 'goal-claimed')[0];
    expect(ev.big).toBe(true);
    expect(ev.reward.techs).toEqual(['R1']);
    expect(has(g, 'R1')).toBe(true);
  });

  it('hands over Bulk Upgrade with "Fill three orders", before the Fabricator has to be saved for', () => {
    expect(indexOf('three-orders')).toBe(indexOf('build-fabricator') - 1);
    const g = rich();
    g.techs = ['P1', 'R1', 'L1', 'C1'];
    g.credits = 1000;
    const second = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    expect(has(g, 'S1')).toBe(false);
    expect(upgradeAll(g, 'well', 'speed')).toBe(2); // the action itself has never needed the tech; the button does
    at(g, 'three-orders');
    g.stats.ordersFilled = 3;
    run(g, 0.1);
    expect(claimGoal(g)).toBe(true);
    expect(has(g, 'S1')).toBe(true);
    expect(take(g, 'tech').map((e) => e.id)).toEqual(['S1']);
    expect(take(g, 'goal-claimed')[0].reward.techs).toEqual(['S1']);
    // One press now upgrades every Well by a level, cheapest first, as one undo step.
    const before = g.credits;
    expect(upgradeAll(g, 'well', 'speed')).toBe(2);
    expect([well(g).lv.speed, second.lv.speed]).toEqual([2, 2]);
    expect(before - g.credits).toBe(80 + 80);
    expect(undo(g)).toBe(true);
    expect([well(g).lv.speed, g.nodes.find((n) => n.id === second.id)!.lv.speed]).toEqual([1, 1]);
    expect(g.credits).toBe(before);
    // It cannot be bought, by anyone, at any price.
    const poor = fresh();
    poor.techs = ['R1', 'L1'];
    poor.data = { a: 1e6, b: 1e6, g: 1e6 };
    expect(research(poor, 'S1')).toBe(false);
    expect(TECHS.S1.cost).toEqual({});
  });

  it('unlocks Orders, the Flow meter and the end of the demo', () => {
    const g = rich();
    at(g, 'make-spark');
    g.made.spark = true;
    run(g, 0.1);
    expect(g.ordersOn).toBe(false);
    expect(claimGoal(g)).toBe(true);
    expect(g.ordersOn).toBe(true);
    expect(g.order).not.toBeNull();
    expect(g.data.a).toBe(25);
    expect(take(g, 'unlock').map((e) => e.what)).toEqual(['orders']);
    expect(take(g, 'order-new').length).toBe(1);

    at(g, 'make-glyph');
    g.made.glyph = true;
    run(g, 0.1);
    expect(g.flowOn).toBe(false);
    expect(claimGoal(g)).toBe(true);
    expect(g.flowOn).toBe(true);
    expect(take(g, 'unlock').map((e) => e.what)).toEqual(['flow']);

    at(g, 'make-lens');
    g.made.lens = true;
    run(g, 0.1);
    expect(claimGoal(g)).toBe(true);
    expect(g.ended).toBe(true);
    expect(activeGoal(g)!.free).toBe(true);
  });

  it('ends quietly after the last free-play goal', () => {
    const g = fresh();
    g.goal = { i: GOALS.length - 1, ready: false };
    g.made.paradox = true;
    run(g, 0.1);
    expect(claimGoal(g)).toBe(true);
    expect(g.goal).toEqual({ i: GOALS.length, ready: false });
    expect(activeGoal(g)).toBeNull();
    expect(goalView(g)).toBeNull();
    run(g, 1);
    expect(claimGoal(g)).toBe(false);
  });
});

describe('goal chain: conditions and progress', () => {
  it('shows what is being saved up for', () => {
    const g = fresh();
    at(g, 'second-well');
    g.credits = 7;
    const cost = nodeCost(g, 'well');
    expect(cost).toBe(12); // exactly what goal 1 pays
    expect(goalView(g)!.progress).toEqual([7, 12, '¢']);
    g.credits = 500;
    expect(goalView(g)!.progress).toEqual([12, 12, '¢']);

    at(g, 'research-murk');
    g.data.a = 20;
    expect(goalView(g)!.progress).toEqual([20, 45, 'α']);

    at(g, 'make-glyph');
    g.techs = ['P1', 'R1', 'P2', 'P3'];
    expect(goalView(g)!.progress).toEqual([20, TECHS.P4.cost.a, 'α']);
    g.techs.push('P4');
    g.credits = 100;
    expect(goalView(g)!.progress).toEqual([100, nodeCost(g, 'assembler'), '¢']);
  });

  it('numbers the card and words the hint for the input in use', () => {
    const g = fresh();
    const mouse = goalView(g)!;
    expect(mouse.number).toBe(1);
    expect(mouse.total).toBe(22);
    expect(mouse.hint).toMatch(/Drag/);
    expect(goalView(g, true)!.hint).toMatch(/Tap/);
    g.goal = { i: 22, ready: false };
    const free = goalView(g)!;
    expect(free.free).toBe(true);
    expect(free.number).toBe(1);
    expect(free.total).toBe(4);
  });

  it('"Wire it to the Market too" needs a wire out of every Well', () => {
    const g = fresh();
    g.credits = 100;
    at(g, 'wire-all-wells');
    connect(g, well(g).id, 0, market(g).id);
    const w2 = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    run(g, 0.1);
    expect(g.goal.ready).toBe(false);
    expect(goalView(g)!.progress).toEqual([1, 2, 'Wells']);
    connect(g, w2.id, 0, market(g).id);
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
  });

  it('"Give the Silt somewhere to go" needs the Silt port wired and the Refiner running', () => {
    const g = rich();
    at(g, 'silt-exit');
    const w = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    const r = placeNode(g, 'refiner', 400, 400)!;
    connect(g, w.id, 0, r.id);
    connect(g, r.id, 0, market(g).id);
    run(g, 30);
    expect(r.status).toBe('blocked');
    expect(g.goal.ready).toBe(false);
    connect(g, r.id, 1, placeNode(g, 'void', 700, 600)!.id);
    run(g, 0.1);
    expect(g.goal.ready).toBe(false); // wired, but not running yet
    run(g, 10);
    expect(g.goal.ready).toBe(true);
  });

  it('"Route more to a Lab than to the Market" needs a Router that favours the Lab', () => {
    const g = rich();
    at(g, 'route-lab');
    const router = placeNode(g, 'router', 400, 100)!;
    const lab = placeNode(g, 'lab', 700, 100)!;
    connect(g, well(g).id, 0, router.id);
    const toMarket = connect(g, router.id, 0, market(g).id)!;
    const toLab = connect(g, router.id, 0, lab.id)!;
    run(g, 1);
    expect(routerFavoursLab(g)).toBe(false); // Even mode
    setMode(g, router.id, 'ratio');
    expect(routerFavoursLab(g)).toBe(false); // 1 : 1
    setWeight(g, toMarket.id, 3);
    expect(routerFavoursLab(g)).toBe(false); // favours the Market
    setWeight(g, toLab.id, 4);
    expect(routerFavoursLab(g)).toBe(true);
    setMode(g, router.id, 'priority');
    expect(routerFavoursLab(g)).toBe(false); // the Market wire comes first
    run(g, 0.1);
    expect(g.goal.ready).toBe(false);
    setMode(g, router.id, 'ratio');
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
  });

  it('every card that has the player make something new says to sell it', () => {
    // Without this a newcomer who does only what the card says leaves Spark, Glyph, Mist and Prism unsold:
    // the machines block, and the Fabricator has to be paid for from Shard and Ink alone.
    for (const [id, what] of [['make-spark', 'sell the Spark'], ['make-glyph', 'sell its Glyph at the Market'], ['make-mist', 'sell the Mist'], ['make-prism', 'sell its Prism at the Market']]) {
      const hint = goalById(id)!.hint;
      expect(hint.mouse, id).toContain(what);
      expect(hint.touch, id).toContain(what);
    }
    expect(goalById('silt-exit')!.hint.mouse).toContain('sell the Ink at the Market');
  });

  it('a goal that asks for a research and then a machine says so: the step carries the price that follows', () => {
    const g = fresh();
    const step = (id: string) => {
      at(g, id);
      return activeGoal(g)!.step!(g);
    };
    g.techs = ['P1', 'R1', 'P2', 'P3'];
    // Assembly, then the first Assembler; Breeze Deposits, then a Well and a Refiner; Fabrication, then the Fabricator.
    expect(step('make-glyph')).toEqual({ tech: 'P4', then: nodeCost(g, 'assembler') });
    g.techs.push('P4');
    expect(step('make-glyph')).toEqual({ credits: 600 });
    expect(step('make-mist')).toEqual({ tech: 'P5', then: nodeCost(g, 'well') + nodeCost(g, 'refiner') });
    g.techs.push('P5');
    expect(step('build-fabricator')).toEqual({ tech: 'P7', then: 7100 });
    // What the card shows is still the Data for the research.
    expect(activeGoal(g)!.progress!(g)).toEqual([0, 1180, 'α']);
    g.techs.push('P7');
    expect(step('build-fabricator')).toEqual({ credits: 7100 });
    // A research with nothing to buy after it carries no price.
    g.techs = ['P1', 'R1'];
    expect(step('research-murk')).toEqual({ tech: 'P2' });
  });

  it('"Study Glyph for β" asks for 40 β in hand', () => {
    const g = rich();
    at(g, 'study-glyph');
    g.data.b = 39;
    expect(goalView(g)!.progress).toEqual([39, 40, 'β']);
    expect(activeGoal(g)!.done(g)).toBe(false);
    g.data.b = 40;
    expect(activeGoal(g)!.done(g)).toBe(true);
  });

  it('"Hold 95% Flow" reads the hold timer, and "Expand the board" the expansion count', () => {
    const g = rich();
    at(g, 'hold-flow');
    g.flowHold = 4;
    expect(goalView(g)!.progress).toEqual([4, 10, 's']);
    expect(activeGoal(g)!.done(g)).toBe(false);
    g.flowHold = 10;
    expect(activeGoal(g)!.done(g)).toBe(true);

    at(g, 'expand');
    expect(activeGoal(g)!.done(g)).toBe(false);
    expect(expandBoard(g)).toBe(true);
    expect(activeGoal(g)!.done(g)).toBe(true);
  });
});

/** Wells that sell and flow, and Spark Refiners that never can: each has one Ember Well (0.8/s) for the 1/s it wants. */
function flowBoard(wells: number, starved: number): Game {
  const g = rich();
  const m = market(g);
  connect(g, well(g).id, 0, m.id);
  let id = 900;
  for (let i = 1; i < wells; i++) {
    g.deposits.push({ id: ++id, x: 100, y: 800 + 140 * i, mat: 'glint' });
    connect(g, placeNode(g, 'well', 0, 0, { depositId: id })!.id, 0, m.id);
  }
  for (let i = 0; i < starved; i++) {
    g.deposits.push({ id: ++id, x: 500, y: 800 + 140 * i, mat: 'ember' });
    const r = placeNode(g, 'refiner', 700, 800 + 140 * i, { recipe: 'spark' })!;
    connect(g, placeNode(g, 'well', 0, 0, { depositId: id })!.id, 0, r.id);
    connect(g, r.id, 0, m.id);
  }
  run(g, 40);
  g.flowOn = true; // the meter is unlocked now, as the Glyph goal's reward does it
  g.events = [];
  at(g, 'hold-flow');
  return g;
}

describe('"Hold 95% Flow": the bar, and the valve for a board nobody can fix', () => {
  it('the card shows the share, how many producers run, and the share needed', () => {
    const g = flowBoard(8, 1); // 8 Glint Wells and an Ember Well flow, the Spark Refiner does not: 9 of 10
    run(g, 10);
    const v = goalView(g)!;
    expect(v.flow).toBeDefined();
    expect(v.flow!.of).toBe(10);
    expect(v.flow!.running).toBe(9);
    expect(v.flow!.pct).toBeCloseTo(0.9, 2);
    expect(v.flow!.pct).toBe(g.flow);
    expect(v.flow!.need).toBe(RULES.flow.holdShare);
    expect(v.progress).toEqual([0, 10, 's']);
    expect(v.ready).toBe(false);
    // No other goal carries it.
    at(g, 'study-glyph');
    expect(goalView(g)!.flow).toBeUndefined();
  });

  it('keeps the bar for 90 s; after that, all but one producer flowing for 10 s is enough', () => {
    const g = flowBoard(8, 1);
    expect(RULES.flow.valveAfter).toBe(90);
    expect(RULES.flow.holdShare).toBe(0.95);
    run(g, 0.05);
    const start = g.time;
    run(g, 89.5);
    expect(goalAge(g)).toBeCloseTo(89.5, 6); // counted from the first tick that saw the goal
    expect(g.goal.ready).toBe(false); // 90% for a minute and a half is not 95%
    expect(g.flowHold).toBe(0);
    expect(g.flowNear).toBeGreaterThan(80); // ...but it has been "all but one" all along
    expect(goalView(g)!.flow!.need).toBe(0.95);
    run(g, 1);
    expect(g.goal.ready).toBe(true); // the valve opens at 90 s, and those ten seconds have long been held
    expect(g.time - start).toBeLessThan(91);
    expect(take(g, 'goal-ready').map((e) => e.goal)).toEqual(['hold-flow']);
    expect(claimGoal(g)).toBe(true);
    expect(claimGoal(g)).toBe(false);
  });

  it('with the valve open the card shows the lower bar, and the ten seconds still have to be held', () => {
    const g = flowBoard(8, 2); // 10 of 12 flow: one too few even for the valve
    run(g, 100);
    expect(g.goal.ready).toBe(false);
    const v = goalView(g)!;
    expect(v.flow).toMatchObject({ of: 12, running: 10 });
    expect(v.flow!.need).toBeCloseTo(11 / 12, 9);
    expect(v.progress).toEqual([0, 10, 's']);
    // Fix one of the two (a faster Ember Well): eleven of twelve, and the count-down starts from there.
    const ember = g.nodes.find((n) => n.material === 'ember')!;
    expect(upgrade(g, ember.id, 'speed')).toBe(true);
    let waited = 0;
    while (goalView(g)!.progress![0] <= 0 && waited++ < 60) run(g, 1);
    expect(waited).toBeLessThan(40); // the Refiner fills up and Flow settles at eleven of twelve
    expect(g.goal.ready).toBe(false);
    expect(goalView(g)!.flow).toMatchObject({ of: 12, running: 11 });
    run(g, 8);
    expect(g.goal.ready).toBe(false);
    expect(goalView(g)!.progress![0]).toBeGreaterThan(7);
    run(g, 2);
    expect(g.goal.ready).toBe(true);
  });

  it('the valve never passes a board where nothing flows, and never lowers the bar for a board that meets it', () => {
    // One producer, not flowing: "all but one" of one is none, and that is not enough.
    const lone = rich();
    lone.flowOn = true;
    const r = placeNode(lone, 'refiner', 400, 100, { recipe: 'spark' })!; // nothing feeds it
    connect(lone, r.id, 0, market(lone).id);
    run(lone, 30);
    at(lone, 'hold-flow');
    run(lone, 200);
    expect(goalView(lone)!.flow).toMatchObject({ of: 1, running: 0, need: 0.95 });
    expect(lone.goal.ready).toBe(false);
    // Two producers, one flowing: after 90 s that is all but one.
    connect(lone, well(lone).id, 0, market(lone).id);
    run(lone, 5);
    expect(lone.goal.ready).toBe(false);
    run(lone, 40);
    expect(goalView(lone)!.flow).toMatchObject({ of: 2, running: 1, need: 0.5 });
    expect(lone.goal.ready).toBe(true);
    // A board that flows passes in ten seconds, valve or no valve.
    const fine = flowBoard(6, 0);
    run(fine, 9);
    expect(fine.goal.ready).toBe(false);
    run(fine, 2);
    expect(fine.goal.ready).toBe(true);
  });

  it('the time on the goal is counted from its claim, survives a save, and starts afresh in a save from before the valve', () => {
    const g = flowBoard(8, 1);
    at(g, 'make-glyph');
    g.made.glyph = true;
    run(g, 0.1);
    expect(claimGoal(g)).toBe(true); // "Hold 95% Flow" becomes the goal now
    expect(activeGoal(g)!.id).toBe('hold-flow');
    expect(goalAge(g)).toBe(0);
    run(g, 60);
    expect(goalAge(g)).toBeCloseTo(60, 6);
    const copy = deserialize(serialize(g))!;
    expect(goalAge(copy)).toBeCloseTo(60, 6);
    run(copy, 29);
    expect(copy.goal.ready).toBe(false);
    run(copy, 2);
    expect(copy.goal.ready).toBe(true);
    // A save taken mid-goal by the build before this one has no such count: its 90 s start when it is loaded.
    const raw = JSON.parse(serialize(g));
    delete raw.goalAt;
    delete raw.flowNear;
    const old = deserialize(JSON.stringify(raw))!;
    expect(old.flowNear).toBe(0);
    expect(goalAge(old)).toBe(0);
    run(old, 89);
    expect(old.goal.ready).toBe(false);
    run(old, 2);
    expect(old.goal.ready).toBe(true);
  });
});

describe('goal chain: the first minutes, played for real', () => {
  it('each reward pays for the next step, up to the first research', () => {
    const g = fresh();
    const claim = (id: string) => {
      expect(activeGoal(g)!.id).toBe(id);
      expect(g.goal.ready, `${id} should be ready`).toBe(true);
      expect(claimGoal(g)).toBe(true);
    };
    const w1 = well(g);
    const m = market(g);

    connect(g, w1.id, 0, m.id);
    run(g, 0.5);
    claim('wire-market'); // +12¢ buys the second Well at once
    const w2 = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    expect(w2).not.toBeNull();
    run(g, 0.5);
    claim('second-well');
    connect(g, w2.id, 0, m.id);
    run(g, 0.5);
    claim('wire-all-wells'); // Refining + 50¢ buys the Refiner at once
    const r = placeNode(g, 'refiner', 400, 100, { recipe: 'shard' })!;
    expect(r).not.toBeNull();
    connect(g, w1.id, 0, r.id);
    run(g, 0.5);
    claim('build-refiner');
    connect(g, r.id, 0, m.id);
    run(g, 6);
    claim('sell-shard'); // the Lab + 70¢
    expect(has(g, 'R1')).toBe(true);
    expect(upgrade(g, w1.id, 'speed')).toBe(true);
    run(g, 0.5);
    claim('upgrade-well');
    const lab = placeNode(g, 'lab', 700, 100)!;
    expect(lab, `a Lab costs 100¢, have ${g.credits.toFixed(1)}¢`).not.toBeNull();
    connect(g, r.id, 0, lab.id);
    run(g, 6);
    claim('feed-lab'); // +15α
    expect(g.time).toBeLessThan(30); // no waiting anywhere so far
    // The first research is the first real wait: Murk Deposits costs 45α.
    expect(research(g, 'P2')).toBe(false);
    let waited = 0;
    while (!research(g, 'P2') && waited < 180) {
      run(g, 1);
      waited++;
    }
    expect(has(g, 'P2')).toBe(true);
    expect(waited).toBeLessThan(90);
    run(g, 0.1);
    claim('research-murk');
    expect(g.stats.fromGoals).toBe(12 + 10 + 50 + 20 + 70 + 50 + 40);
    expect(g.stats.nodesBuilt).toBe(3);
    expect(g.stats.wiresMade).toBe(5);
  });
});

describe('milestones', () => {
  it('announces each new material once, pays nothing, and stays silent about the starting Glint', () => {
    const g = rich();
    const r = placeNode(g, 'refiner', 400, 100)!;
    connect(g, well(g).id, 0, r.id);
    const credits = g.credits;
    const lifetime = g.lifetime;
    run(g, 30);
    const events = take(g, 'milestone');
    expect(events).toEqual([{ kind: 'milestone', mat: 'shard', reward: 0 }]);
    expect(g.credits).toBe(credits);
    expect(g.lifetime).toBe(lifetime);
    expect(g.made.shard).toBe(true);
    expect(g.madeAt.shard).toBeGreaterThan(0);
    run(g, 30);
    expect(take(g, 'milestone').length).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { claimGoal, connect, cutWire, expandBoard, placeNode, setMode, setWeight, upgrade } from '../src/actions';
import { TECHS } from '../src/content';
import { has, nodeCost, research } from '../src/economy';
import { GOALS, MAIN_GOALS, activeGoal, goalById, goalView, rewardText, routerFavoursLab } from '../src/goals';
import { Game } from '../src/state';
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
      'Hold 75% Flow for 10 seconds',
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
    expect(reward('first-order')).toEqual({ techs: ['L1', 'C1'] });
    expect(reward('make-glyph')).toEqual({ credits: 300, unlock: 'flow' });
    expect(reward('hold-flow')).toEqual({ credits: 300 });
    expect(reward('make-prism')).toEqual({ credits: 600, b: 40 });
    expect(reward('three-orders')).toEqual({ credits: 1200, b: 60 });
    expect(reward('build-fabricator')).toEqual({ b: 40 });
    expect(reward('make-lens')).toEqual({ unlock: 'end' });
    expect(rewardText(reward('wire-all-wells'))).toBe('Refining + 50¢');
    expect(rewardText(reward('make-spark'))).toBe('Orders + 25α');
  });

  it('flags four goals as big celebrations (the fifth is the first Flow State)', () => {
    expect(GOALS.filter((x) => x.big).map((x) => x.id)).toEqual(['sell-shard', 'feed-lab', 'make-glyph', 'make-lens']);
  });

  it('is the only way to get Refining, Lab, Routing and Market Lens', () => {
    const granted = GOALS.flatMap((x) => x.reward.techs ?? []).sort();
    expect(granted).toEqual(['C1', 'L1', 'P1', 'R1']);
    const auto = Object.values(TECHS).filter((t) => t.auto).map((t) => t.id).sort();
    expect(auto).toEqual(granted);
    const g = fresh();
    g.data = { a: 1e6, b: 1e6, g: 1e6 };
    for (const id of granted) expect(research(g, id)).toBe(false);
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

  it('"Hold 75% Flow" reads the hold timer, and "Expand the board" the expansion count', () => {
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

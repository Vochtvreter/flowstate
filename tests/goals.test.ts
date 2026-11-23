import { describe, expect, it } from 'vitest';
import { claimGoal, connect, cutWire, expandBoard, favour, placeNode, redo, setMode, setWeight, undo, upgrade, upgradeAll } from '../src/actions';
import { MATERIALS, RECIPES, RULES, TECHS } from '../src/content';
import { has, nodeCost, research } from '../src/economy';
import { GOALS, MAIN_GOALS, activeGoal, goalAge, goalById, goalDeposit, goalView, recipeFeeds, rewardText, routerFavoursLab } from '../src/goals';
import { Game, deserialize, serialize } from '../src/state';
import { fresh, market, rich, run, take, well } from './helpers';

const indexOf = (id: string) => GOALS.findIndex((x) => x.id === id);

/** Jump straight to a goal, as if everything before it had been claimed. */
function at(g: Game, id: string) {
  g.goal = { i: indexOf(id), ready: false };
}

describe('goal chain: the table (2.4)', () => {
  it('has 25 goals, in order, then four free-play goals: a growth goal stands before each new chapter', () => {
    expect(MAIN_GOALS).toBe(25);
    expect(GOALS.map((x) => x.title).slice(0, 25)).toEqual([
      'Sell your Sand',
      'Dig up more Sand',
      'Sell that Sand too',
      'Turn Sand into Glass',
      'Sell your first Glass',
      'Make 1 Glass a second',
      'Make 1.2 Glass a second',
      'Study Glass in a Lab',
      'Open up the Oil deposit',
      'Turn Oil into Plastic',
      'Give the Tar somewhere to go',
      'Fill your first order',
      'Make 1 Plastic a second',
      'Make and sell Copper',
      'Hold 95% Flow for 10 seconds',
      'Make 1 Copper a second',
      'Make your first Circuit',
      'Study Circuits for β',
      'Make 0.6 Circuits a second',
      'Make and sell Silicon',
      'Make your first Screen',
      'Speed up every Drill at once',
      'Make 0.5 Screens a second',
      'Build a Fabricator',
      'Make your first Phone',
    ]);
    expect(GOALS.slice(25).map((x) => x.id)).toEqual(['make-clay', 'make-coil', 'make-dynamo', 'make-paradox']);
    expect(GOALS.slice(0, 25).every((x) => !x.free)).toBe(true);
    expect(GOALS.slice(25).every((x) => x.free)).toBe(true);
  });

  it('new things come one chapter at a time: each step of the spine is locked until the growth goal before it is claimed', () => {
    // The growth goals, what each asks for, and what its claim brings: the Lab, then a step of the spine opened for research.
    const growth = GOALS.filter((x) => x.meanwhile?.some((l) => l.grow)).map((x) => {
      const grow = x.meanwhile!.find((l) => l.grow)!.grow!;
      return [x.id, grow.mat, grow.rate, x.reward.techs ?? x.reward.opens] as const;
    });
    expect(growth).toEqual([
      ['grow-shard', 'shard', 1, undefined],
      ['tune-shard', 'shard', 1.2, ['R1']],
      ['grow-ink', 'ink', 1, ['P3']],
      ['grow-spark', 'spark', 1, ['P4']],
      ['grow-glyph', 'glyph', 0.6, ['P5']],
      ['grow-prism', 'prism', 0.5, ['P7']],
    ]);
    // Every locked tech is opened by exactly one goal, and the goal that asks for its research comes straight after.
    const locked = Object.values(TECHS).filter((t) => t.locked).map((t) => t.id);
    expect(locked).toEqual(['P3', 'P4', 'P5', 'P7']);
    for (const id of locked) {
      const opens = GOALS.filter((x) => x.reward.opens?.includes(id));
      expect(opens.length, id).toBe(1);
      const next = GOALS[GOALS.indexOf(opens[0]) + 1];
      expect(next.hint.mouse, id).toContain(`Research ${TECHS[id].name}`);
      // ...and the claim pays at least half of what that research costs in α: a lock, then a wait for Data, would be two walls.
      expect(opens[0].reward.a ?? 0, id).toBeGreaterThanOrEqual((TECHS[id].cost.a ?? 0) / 2);
    }
    // No growth goal asks for more than the Markets buy at full price: a player who goes a little past the card is not
    // met by the surplus price for it.
    for (const [id, mat, rate] of growth) expect(rate, id).toBeLessThanOrEqual(0.85 * MATERIALS[mat].demand);
    // Until the goal is claimed the research cannot be bought, whatever Data is in hand; from then on it can.
    const g = fresh();
    g.techs = ['P1', 'R1', 'P2'];
    g.data = { a: 1e6, b: 1e6, g: 1e6 };
    expect(research(g, 'P3')).toBe(false);
    at(g, 'grow-ink');
    g.goal.ready = true;
    expect(claimGoal(g)).toBe(true);
    expect(g.opened).toEqual(['P3']);
    expect(take(g, 'goal-claimed')[0].text).toBe('Make 1 Plastic a second: opens Ore Deposits + 120α');
    expect(research(g, 'P3')).toBe(true);
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
    expect(reward('sell-shard')).toEqual({ credits: 70 });
    expect(reward('grow-shard')).toEqual({ credits: 125 });
    expect(reward('tune-shard')).toEqual({ credits: 100, techs: ['R1'] });
    expect(reward('feed-lab')).toEqual({ a: 20 });
    expect(reward('silt-exit')).toEqual({ a: 20, unlock: 'orders' });
    expect(reward('first-order')).toEqual({ credits: 200 });
    expect(reward('grow-ink')).toEqual({ a: 120, opens: ['P3'] });
    expect(reward('make-spark')).toEqual({ a: 25, unlock: 'flow' });
    expect(reward('hold-flow')).toEqual({ credits: 150 });
    expect(reward('grow-spark')).toEqual({ a: 400, opens: ['P4'] });
    expect(reward('make-glyph')).toEqual({ credits: 150 });
    expect(reward('grow-glyph')).toEqual({ a: 600, opens: ['P5'] });
    expect(reward('grow-prism')).toEqual({ a: 400, opens: ['P7'] });
    expect(reward('make-prism')).toEqual({ credits: 600, b: 40, techs: ['S1'] });
    expect(reward('bulk-upgrade')).toEqual({ credits: 1200, b: 60 });
    expect(reward('build-fabricator')).toEqual({ b: 40 });
    expect(reward('make-lens')).toEqual({ unlock: 'end' });
    expect(rewardText(reward('wire-all-wells'))).toBe('Refining + 50¢');
    expect(rewardText(reward('make-spark'))).toBe('Flow meter + 25α');
    expect(rewardText(reward('silt-exit'))).toBe('Orders + 20α');
    expect(rewardText(reward('grow-spark'))).toBe('opens Assembly + 400α');
    expect(rewardText(reward('make-prism'))).toBe('Bulk Upgrade + 600¢ + 40β');
  });

  it('flags the firsts and the growth goals that open something as big celebrations: a peak every minute or two', () => {
    // The six firsts (Glass, Data, Copper, Circuit, Screen, Phone), and the five growth goals whose claim brings the
    // next chapter: a line the player has widened is a peak of its own. (The twelfth is the first Flow State.)
    expect(GOALS.filter((x) => x.big).map((x) => x.id)).toEqual([
      'sell-shard', 'tune-shard', 'feed-lab', 'grow-ink', 'make-spark', 'grow-spark', 'make-glyph', 'grow-glyph', 'make-prism', 'grow-prism', 'make-lens',
    ]);
    // None of them is a free-play goal, and the card's view says the same as the table.
    for (const goal of GOALS) {
      if (goal.big) expect(goal.free, goal.id).toBeFalsy();
      const g = fresh();
      g.goal = { i: GOALS.indexOf(goal), ready: false };
      expect(goalView(g)!.big, goal.id).toBe(!!goal.big);
    }
  });

  it('the first Copper and the first Screen carry the big flag on their claim, with the Flow meter and the reward', () => {
    for (const [id, mat] of [['make-spark', 'spark'], ['make-prism', 'prism']] as const) {
      const g = fresh();
      g.goal = { i: GOALS.findIndex((x) => x.id === id), ready: false };
      g.made[mat] = true;
      if (mat === 'spark') g.sold.spark = 1; // (that card asks for the sale)
      run(g, 0.05);
      expect(g.goal.ready, id).toBe(true);
      g.events = [];
      const before = { credits: g.credits, a: g.data.a, b: g.data.b };
      expect(claimGoal(g)).toBe(true);
      const ev = take(g, 'goal-claimed');
      expect(ev.length).toBe(1);
      expect(ev[0]).toMatchObject({ goal: id, big: true, reward: goalById(id)!.reward });
      if (id === 'make-spark') {
        expect(g.flowOn).toBe(true);
        expect(g.data.a - before.a).toBe(25);
      } else {
        expect(g.credits - before.credits).toBe(600);
        expect(g.data.b - before.b).toBe(40);
      }
    }
    // The goals between them are not big: the next one after the first Copper, for one.
    expect(goalById('first-order')!.big).toBeFalsy();
    expect(goalById('make-mist')!.big).toBeFalsy();
  });

  it('is the only way to get Refining, Lab and Bulk Upgrade', () => {
    // (Routing was one of them, with a card that had the player build a Router. It is a research now, 50α behind
    // Oil Deposits, for whoever wants one.)
    const granted = GOALS.flatMap((x) => x.reward.techs ?? []).sort();
    expect(granted).toEqual(['P1', 'R1', 'S1']);
    expect(TECHS.L1).toMatchObject({ cost: { a: 50 }, requires: ['R1', 'P2'] });
    expect(TECHS.L1.auto).toBeUndefined();
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
    // The Lab is not the first Glass's any more: it comes with the second growth goal, "Make 1.2 Glass a second".
    expect(ev.reward.techs).toBeUndefined();
    expect(has(g, 'R1')).toBe(false);
    at(g, 'tune-shard');
    g.goal.ready = true;
    expect(claimGoal(g)).toBe(true);
    const lab = take(g, 'goal-claimed')[0];
    expect(lab.big).toBe(true);
    expect(lab.reward.techs).toEqual(['R1']);
    expect(has(g, 'R1')).toBe(true);
  });

  it('hands over Bulk Upgrade with the first Screen, and the next card asks for one press of it, before the Fabricator has to be saved for', () => {
    expect(indexOf('make-prism')).toBe(indexOf('bulk-upgrade') - 1);
    // (Then the Screen line is widened, "Make 0.5 Screens a second", and its claim opens Fabrication.)
    expect(indexOf('bulk-upgrade')).toBe(indexOf('grow-prism') - 1);
    expect(indexOf('grow-prism')).toBe(indexOf('build-fabricator') - 1);
    const g = rich();
    g.techs = ['P1', 'R1', 'L1', 'C1', 'P4', 'P5'];
    g.credits = 1000;
    const second = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    expect(has(g, 'S1')).toBe(false);
    expect(upgradeAll(g, 'well', 'speed')).toBe(2); // the action itself has never needed the tech; the button does
    at(g, 'make-prism');
    g.made.prism = true;
    run(g, 0.1);
    expect(claimGoal(g)).toBe(true);
    expect(has(g, 'S1')).toBe(true);
    expect(take(g, 'tech').map((e) => e.id)).toEqual(['S1']);
    expect(take(g, 'goal-claimed')[0].reward.techs).toEqual(['S1']);
    // "Speed up every Drill at once": not met on arrival, though the Drills were upgraded all at once before.
    expect(activeGoal(g)!.id).toBe('bulk-upgrade');
    run(g, 1);
    expect(g.goal.ready).toBe(false);
    expect(goalView(g)!.hint).toBe('Select a Drill and press Upgrade all beside Speed.');
    expect(goalView(g, true)!.hint).toBe('Tap a Drill and tap Upgrade all beside Speed.');
    // (Why, the card says under the title: the same for a mouse and a finger.)
    expect(goalView(g)!.why).toBe(goalView(g, true)!.why);
    expect(goalView(g)!.why).toContain('Upgrade all raises every machine of one kind');
    // One press now upgrades every Drill by a level, cheapest first, as one undo step, and meets the card.
    const before = g.credits;
    expect(upgradeAll(g, 'well', 'speed')).toBe(2);
    expect([well(g).lv.speed, second.lv.speed]).toEqual([2, 2]);
    expect(before - g.credits).toBe(80 + 80);
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
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

  it('"Speed up every Drill at once" keeps its Claim a minute and more after the press: through an undo of something else, and a reload', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'L1', 'S1'];
    g.credits = 1000;
    placeNode(g, 'well', 0, 0, { depositId: 2 });
    at(g, 'bulk-upgrade');
    run(g, 1);
    expect(g.goal.ready).toBe(false);
    expect(upgradeAll(g, 'well', 'speed')).toBe(2);
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
    // The edit notes forget anything older than a minute, at the next edit: the press must not go with them.
    run(g, RULES.tips.repeatAfter + 10);
    expect(placeNode(g, 'router', 200, 200)).not.toBeNull();
    expect((g.edits ?? []).some((e) => e.what.startsWith('upgrade-all:'))).toBe(false);
    expect(undo(g)).toBe(true); // the Router, nothing to do with the goal
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
    const back = deserialize(serialize(g))!;
    run(back, 0.5);
    expect(activeGoal(back)!.id).toBe('bulk-upgrade');
    expect(back.goal.ready).toBe(true);
    expect(claimGoal(back)).toBe(true);
  });

  it('"Speed up every Drill at once" counts a press on the Drills only, and an undo of that press takes its Claim back', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'L1', 'S1'];
    g.credits = 5000;
    placeNode(g, 'well', 0, 0, { depositId: 2 });
    placeNode(g, 'refiner', 300, 100, { recipe: 'shard' });
    placeNode(g, 'refiner', 300, 300, { recipe: 'shard' });
    placeNode(g, 'lab', 500, 100);
    at(g, 'bulk-upgrade');
    run(g, 1);
    // Upgrade all on another kind is not what the card asks for (it was taken as the goal's press).
    expect(upgradeAll(g, 'refiner', 'speed')).toBe(2);
    expect(upgradeAll(g, 'lab', 'speed')).toBe(1);
    run(g, 0.5);
    expect(g.goal.ready).toBe(false);
    // On the Drills it is.
    const before = g.credits;
    expect(upgradeAll(g, 'well', 'speed')).toBe(2);
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
    // Undone, the press is refunded and the goal is not met any more: no reward for a press given back...
    expect(undo(g)).toBe(true);
    expect(g.credits).toBe(before);
    run(g, 0.5);
    expect(g.goal.ready).toBe(false);
    expect(claimGoal(g)).toBe(false);
    // ...and redone, it is met again.
    expect(redo(g)).toBe(true);
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
    // An undo of the Refiners' press, made before, leaves the Drills' press standing (it came later: it goes first).
    expect(undo(g)).toBe(true); // the Drills' press
    expect(undo(g)).toBe(true); // the Lab's
    run(g, 0.1);
    expect(g.goal.ready).toBe(false);
    expect(redo(g)).toBe(true); // the Lab's again
    run(g, 0.1);
    expect(g.goal.ready).toBe(false);
    expect(redo(g)).toBe(true); // the Drills' again
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
    expect(claimGoal(g)).toBe(true);
  });

  it('unlocks Orders, the Flow meter and the end of the demo', () => {
    const g = rich();
    // Orders come with the Tar goal: two refined things are selling by then.
    at(g, 'silt-exit');
    run(g, 0.1);
    expect(g.ordersOn).toBe(false);
    g.goal.ready = true;
    expect(claimGoal(g)).toBe(true);
    expect(g.ordersOn).toBe(true);
    expect(g.order).not.toBeNull();
    expect(g.data.a).toBe(20);
    expect(take(g, 'unlock').map((e) => e.what)).toEqual(['orders']);
    expect(take(g, 'order-new').length).toBe(1);

    // The Flow meter comes with the first Copper sold: its Ore Drill is too slow for its Refiner, which is the
    // next card's lesson.
    at(g, 'make-spark');
    g.made.spark = true;
    run(g, 0.1);
    expect(g.goal.ready).toBe(false); // made, but not sold yet: the card's last gesture is the sale
    g.sold.spark = 1;
    run(g, 0.1);
    expect(g.flowOn).toBe(false);
    expect(claimGoal(g)).toBe(true);
    expect(g.flowOn).toBe(true);
    expect(g.data.a).toBe(20 + 25);
    expect(take(g, 'unlock').map((e) => e.what)).toEqual(['flow']);
    expect(activeGoal(g)!.id).toBe('hold-flow');

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
    expect(goalView(g)!.progress).toEqual([20, TECHS.P2.cost.a, 'α']);

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
    expect(mouse.total).toBe(25);
    expect(mouse.hint).toMatch(/Drag/);
    expect(goalView(g, true)!.hint).toMatch(/Tap/);
    g.goal = { i: MAIN_GOALS, ready: false };
    const free = goalView(g)!;
    expect(free.free).toBe(true);
    expect(free.number).toBe(1);
    expect(free.total).toBe(4);
  });

  it('"Sell that Sand too" needs a wire out of every Drill', () => {
    const g = fresh();
    g.credits = 100;
    at(g, 'wire-all-wells');
    connect(g, well(g).id, 0, market(g).id);
    const w2 = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    run(g, 0.1);
    expect(g.goal.ready).toBe(false);
    expect(goalView(g)!.progress).toEqual([1, 2, 'Drills']);
    connect(g, w2.id, 0, market(g).id);
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
  });

  it('"Give the Tar somewhere to go" needs the Tar port wired and the Refiner running', () => {
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

  it('a Router favours the Lab when its settings send more there than to the Market', () => {
    // (A card asked for this, "Route more to a Lab than to the Market". Routing is a research and no card now; the
    // adviser still reads the setting: a Router turned toward a Lab is never turned away from it by a tip.)
    const g = rich();
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
    setMode(g, router.id, 'ratio');
    expect(routerFavoursLab(g)).toBe(true);
    // One press does the same.
    setWeight(g, toLab.id, 1);
    expect(routerFavoursLab(g)).toBe(false);
    expect(favour(g, router.id, toLab.id)).toBe(true);
    expect(routerFavoursLab(g)).toBe(true);
  });

  it('every card that has the player make something new says to sell it', () => {
    // Without this a newcomer who does only what the card says leaves Copper, Circuit, Silicon and Screen unsold:
    // the machines block, and the Fabricator has to be paid for from Glass and Plastic alone.
    for (const [id, what] of [['make-spark', 'sell the Copper'], ['make-glyph', 'wire it to the Market'], ['make-mist', 'sell the Silicon'], ['make-prism', 'wire it to the Market']]) {
      const hint = goalById(id)!.hint;
      expect(hint.mouse, id).toContain(what);
      expect(hint.touch, id).toContain(what);
    }
    expect(goalById('silt-exit')!.hint.mouse).toContain('Wire the Refiner\'s Plastic port to the Market');
    // And the card says so before anyone asks how: in its title, or in its why.
    for (const id of ['make-spark', 'make-mist']) expect(goalById(id)!.title, id).toMatch(/sell/);
    for (const id of ['make-glyph', 'make-prism']) expect(goalById(id)!.why, id).toMatch(/sells for \d+¢/);
    expect(goalById('silt-exit')!.why).toContain('Plastic sells');
  });

  it('the Assembler cards say where to build from, and name the Market before the wire that completes the goal', () => {
    // The goal completes with the first Circuit (or Screen), and a card that is ready shows Claim and no hint. With
    // the Market last in the sentence, the gesture still to come was the sale, and it was the one left out.
    expect(goalById('make-glyph')!.hint.mouse).toBe('Research Assembly, build an Assembler from a Refiner\'s Plastic port, wire it to the Market, then wire Copper into it to make a Circuit.');
    expect(goalById('make-prism')!.hint.mouse).toBe('Build another Assembler from the Silicon Refiner\'s port, wire it to the Market, then wire Glass into it to make a Screen.');
    expect(goalById('build-fabricator')!.hint.mouse).toBe('Research Fabrication, then save up and build a Fabricator from the Screen Assembler\'s port: orders and a high Flow get you there faster.');
    const longest = (touch: boolean) => Math.max(...['silt-exit', 'grow-spark'].map((id) => [...(touch ? goalById(id)!.hint.touch : goalById(id)!.hint.mouse)].length));
    for (const id of ['make-glyph', 'make-prism', 'build-fabricator']) {
      const hint = goalById(id)!.hint;
      expect(hint.touch, id).toBe(hint.mouse); // nothing in them names a click, a drag or a tap
      expect(hint.mouse, id).not.toMatch(/\b(click|drag|tap|press|key)\b/i);
      expect([...hint.mouse].length, id).toBeLessThanOrEqual(longest(false));
      expect([...hint.touch].length, id).toBeLessThanOrEqual(longest(true));
    }
    // Done to the letter on a real board: built from the named port the machine arrives wired and set to its
    // recipe, and the goal is not complete until the last wire of the sentence is made.
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'P5', 'P7'];
    const m = market(g);
    const make = (dep: number, recipe: string) => {
      const r = placeNode(g, 'refiner', 400, 100 * dep, { recipe })!;
      connect(g, placeNode(g, 'well', 0, 0, { depositId: dep })!.id, 0, r.id);
      connect(g, r.id, 0, m.id);
      return r;
    };
    const shard = placeNode(g, 'refiner', 400, 100, { recipe: 'shard' })!;
    connect(g, well(g).id, 0, shard.id);
    connect(g, shard.id, 0, m.id);
    const ink = make(3, 'ink');
    connect(g, ink.id, 1, placeNode(g, 'void', 700, 650)!.id); // (its Tar has somewhere to go)
    const spark = make(4, 'spark');
    const mist = make(5, 'mist');
    run(g, 20);
    at(g, 'make-glyph');
    const glyph = placeNode(g, 'assembler', 700, 300)!; // "build an Assembler from the Refiner's Plastic port"
    connect(g, ink.id, 0, glyph.id);
    expect(glyph.recipe).toBe('glyph');
    connect(g, glyph.id, 0, m.id); // "wire it to the Market"
    run(g, 20);
    expect(g.goal.ready).toBe(false);
    connect(g, spark.id, 0, glyph.id); // "then wire Copper into it"
    run(g, 10);
    expect(g.goal.ready).toBe(true);
    expect(g.sold.glyph ?? 0).toBeGreaterThan(0); // sold from the first one
    at(g, 'make-prism');
    const prism = placeNode(g, 'assembler', 700, 500)!; // "Build another Assembler from the Silicon Refiner's port"
    connect(g, mist.id, 0, prism.id);
    expect(prism.recipe).toBe('prism');
    connect(g, prism.id, 0, m.id);
    run(g, 20);
    expect(g.goal.ready).toBe(false);
    connect(g, shard.id, 0, prism.id);
    run(g, 20);
    expect(g.goal.ready).toBe(true);
    expect(g.sold.prism ?? 0).toBeGreaterThan(0);
    at(g, 'build-fabricator');
    run(g, 0.1);
    expect(g.goal.ready).toBe(false);
    const fab = placeNode(g, 'fabricator', 1000, 500)!; // "build a Fabricator from the Screen Assembler's port"
    connect(g, prism.id, 0, fab.id);
    expect(fab.recipe).toBe('lens');
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
  });

  it('a goal that asks for a research and then a machine says so: the step carries the price that follows', () => {
    const g = fresh();
    const step = (id: string) => {
      at(g, id);
      return activeGoal(g)!.step!(g);
    };
    g.techs = ['P1', 'R1', 'P2', 'P3'];
    // Assembly, then the first Assembler; Quartz Deposits, then a Drill and a Refiner; Fabrication, then the Fabricator.
    // Each also names what the credits are for, as a card would (waitInfo(g).name passes it on).
    expect(step('make-glyph')).toEqual({ tech: 'P4', then: nodeCost(g, 'assembler'), thenWhat: 'the Assembler' });
    g.techs.push('P4');
    expect(step('make-glyph')).toEqual({ credits: 1200, what: 'the Assembler' });
    expect(step('make-mist')).toEqual({ tech: 'P5', then: nodeCost(g, 'well') + nodeCost(g, 'refiner'), thenWhat: 'the Drill and the Refiner' });
    g.techs.push('P5');
    expect(step('build-fabricator')).toEqual({ tech: 'P7', then: 8500, thenWhat: 'the Fabricator' });
    // What the card shows is still the Data for the research.
    expect(activeGoal(g)!.progress!(g)).toEqual([0, 600, 'α']);
    g.techs.push('P7');
    expect(step('build-fabricator')).toEqual({ credits: 8500, what: 'the Fabricator' });
    // A research with nothing to buy after it carries no price.
    g.techs = ['P1', 'R1'];
    expect(step('research-murk')).toEqual({ tech: 'P2' });
  });

  it('"Study Circuits for β" asks for 40 β in hand', () => {
    const g = rich();
    at(g, 'study-glyph');
    g.data.b = 39;
    expect(goalView(g)!.progress).toEqual([39, 40, 'β']);
    expect(activeGoal(g)!.done(g)).toBe(false);
    g.data.b = 40;
    expect(activeGoal(g)!.done(g)).toBe(true);
  });

  it('"Hold 95% Flow" reads the hold timer', () => {
    const g = rich();
    at(g, 'hold-flow');
    g.flowHold = 4;
    expect(goalView(g)!.progress).toEqual([4, 10, 's']);
    expect(activeGoal(g)!.done(g)).toBe(false);
    g.flowHold = 10;
    expect(activeGoal(g)!.done(g)).toBe(true);
  });
});

/** Drills that sell and flow, and Copper Refiners that never can: each has one Ore Drill (0.8/s) for the 1/s it wants. */
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
  g.flowOn = true; // the meter is unlocked now, as the Copper goal's reward does it
  g.events = [];
  at(g, 'hold-flow');
  return g;
}

describe('"Hold 95% Flow": the bar, and the valve for a board nobody can fix', () => {
  it('the card shows the share, how many producers run, and the share needed', () => {
    const g = flowBoard(8, 1); // 8 Sand Drills and an Ore Drill flow, the Copper Refiner does not: 9 of 10
    run(g, 10);
    const v = goalView(g)!;
    expect(v.flow).toBeDefined();
    expect(v.flow!.of).toBe(10);
    expect(v.flow!.running).toBe(9);
    expect(v.flow!.pct).toBeCloseTo(0.9, 2);
    expect(v.flow!.pct).toBe(g.flow);
    expect(v.flow!.need).toBe(RULES.flow.holdShare);
    expect(v.flow!.valve).toBeUndefined(); // the bar has not come down yet
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
    expect(goalView(g)!.flow!.valve).toBeUndefined();
    expect(goalView(g)!.progress).toEqual([0, 10, 's']);
    run(g, 1);
    // The valve opens at 90 s. The ten seconds are counted from that moment, where the player can see them:
    // the long stretch at "all but one" before it does not pass the goal the instant the bar comes down.
    expect(g.goal.ready).toBe(false);
    let v = goalView(g)!;
    expect(v.flow!.valve).toBe(true);
    expect(v.flow!.need).toBeCloseTo(0.9, 9);
    expect(v.progress![0]).toBeCloseTo(0.5, 6);
    expect(v.progress!.slice(1)).toEqual([10, 's']);
    // The count runs with the clock, a second a second.
    run(g, 4);
    expect(goalView(g)!.progress![0]).toBeCloseTo(4.5, 6);
    run(g, 5);
    expect(g.goal.ready).toBe(false); // 99.5 s
    expect(goalView(g)!.progress![0]).toBeCloseTo(9.5, 6);
    run(g, 0.6);
    expect(g.goal.ready).toBe(true); // 100 s after the goal came up, never before
    expect(g.time - start).toBeGreaterThanOrEqual(100);
    expect(g.time - start).toBeLessThan(100.2);
    v = goalView(g)!;
    expect(v.flow!.valve).toBe(true); // the flag stays for as long as the goal does
    expect(take(g, 'goal-ready').map((e) => e.goal)).toEqual(['hold-flow']);
    expect(claimGoal(g)).toBe(true);
    expect(claimGoal(g)).toBe(false);
    expect(goalView(g)!.flow).toBeUndefined();
  });

  it('under the valve the count stops and starts again with the board, like the bar\'s own', () => {
    const g = flowBoard(8, 1);
    // A second Copper Refiner on the same Ore Drill, its port not wired yet: it does not count toward Flow.
    const ember = g.nodes.find((n) => n.material === 'ember')!;
    const extra = placeNode(g, 'refiner', 400, 700, { recipe: 'spark' })!;
    connect(g, ember.id, 0, extra.id);
    run(g, 94);
    expect(goalView(g)!.flow).toMatchObject({ of: 10, running: 9, valve: true });
    expect(goalView(g)!.progress![0]).toBeGreaterThan(3);
    // Wired to the Market it counts, and the two Refiners share what one was short of: nine of eleven.
    const sold = connect(g, extra.id, 0, market(g).id)!;
    run(g, 6);
    expect(goalView(g)!.flow).toMatchObject({ of: 11, running: 9, valve: true });
    expect(goalView(g)!.progress![0]).toBe(0);
    run(g, 20);
    expect(g.goal.ready).toBe(false); // two short is one too many, valve or no valve
    // Taken off again, the count starts from nothing: ten more seconds, not the four held before.
    expect(cutWire(g, sold.id)).toBe(true);
    let waited = 0;
    while (goalView(g)!.progress![0] <= 0 && waited++ < 60) run(g, 1);
    expect(waited).toBeLessThan(40);
    expect(g.goal.ready).toBe(false);
    run(g, 8);
    expect(g.goal.ready).toBe(false);
    run(g, 2.5);
    expect(g.goal.ready).toBe(true);
  });

  it('with the valve open the card shows the lower bar, and the ten seconds still have to be held', () => {
    const g = flowBoard(8, 2); // 10 of 12 flow: one too few even for the valve
    run(g, 100);
    expect(g.goal.ready).toBe(false);
    const v = goalView(g)!;
    expect(v.flow).toMatchObject({ of: 12, running: 10 });
    expect(v.flow!.need).toBeCloseTo(11 / 12, 9);
    expect(v.progress).toEqual([0, 10, 's']);
    // Fix one of the two (a faster Ore Drill): eleven of twelve, and the count-down starts from there.
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
    expect(goalView(lone)!.flow).toMatchObject({ of: 1, running: 0, need: 0.95, valve: true });
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
    // A lone producer that does not flow is not passed by the later steps either: the slack stays at none.
    const alone = rich();
    alone.flowOn = true;
    connect(alone, placeNode(alone, 'refiner', 400, 100, { recipe: 'spark' })!.id, 0, market(alone).id);
    run(alone, 30);
    at(alone, 'hold-flow');
    run(alone, 700);
    expect(goalView(alone)!.flow).toMatchObject({ of: 1, running: 0, need: 0.95, valve: true, slack: 0 });
    expect(alone.goal.ready).toBe(false);
  });

  it('after all but two, one more may be short every 120 s, up to all but one: a board on which one producer flows passes in the end', () => {
    // One Drill that sells and five Refiners wired to the Market with nothing to work on: one of six flows.
    const g = rich();
    g.flowOn = true;
    connect(g, well(g).id, 0, market(g).id);
    for (let i = 0; i < 5; i++) connect(g, placeNode(g, 'refiner', 400, 100 + 140 * i, { recipe: 'spark' })!.id, 0, market(g).id);
    run(g, 30);
    at(g, 'hold-flow');
    expect(RULES.flow.valveEvery).toBe(120);
    run(g, 0.05);
    const seen: Record<number, number> = {};
    while (!g.goal.ready && goalAge(g) < 900) {
      run(g, 0.5);
      const v = goalView(g)!.flow!;
      expect(v).toMatchObject({ of: 6, running: 1 });
      // A whole number, never more than all but one.
      expect(Number.isInteger(v.slack ?? 0)).toBe(true);
      expect(v.slack ?? 0).toBeLessThanOrEqual(5);
      seen[v.slack ?? 0] ??= Math.round(goalAge(g));
    }
    // The steps, at 90 and 180 s and then every 120 s, to all but five of six (one flowing is enough) at 540 s...
    expect(seen).toEqual({ 0: 1, 1: 90, 2: 180, 3: 300, 4: 420, 5: 540 });
    // ...and its ten seconds are held from that moment.
    expect(g.goal.ready).toBe(true);
    expect(goalAge(g)).toBeGreaterThanOrEqual(550);
    expect(goalAge(g)).toBeLessThan(552);
    expect(goalView(g)!.flow!.need).toBeCloseTo(1 / 6, 9);
  });

  it('a board three short passes ten seconds after the third step opens (all but three, at 300 s), and a save keeps the count', () => {
    const g = flowBoard(6, 3); // 6 Sand Drills and 3 Ore Drills flow, 3 Copper Refiners never can: 9 of 12
    run(g, 0.05);
    run(g, 299);
    expect(g.goal.ready).toBe(false);
    expect(goalView(g)!.flow).toMatchObject({ of: 12, running: 9, valve: true, slack: 2 });
    expect(g.flowNearLate).toBe(0); // the third step is not open yet: nothing counts toward it
    run(g, 1.5);
    expect(goalView(g)!.flow).toMatchObject({ slack: 3 });
    expect(goalView(g)!.flow!.need).toBeCloseTo(9 / 12, 9);
    // Nine of twelve has been the case all along: the ten seconds count from the step's opening, not before.
    expect(g.goal.ready).toBe(false);
    run(g, 4);
    const mid = deserialize(serialize(g))!;
    expect(mid.flowNearLate).toBeCloseTo(g.flowNearLate!, 9);
    expect(goalView(mid)!.progress![0]).toBeCloseTo(goalView(g)!.progress![0], 6);
    run(mid, 4);
    expect(mid.goal.ready).toBe(false);
    run(mid, 1.6);
    expect(mid.goal.ready).toBe(true);
    expect(goalAge(mid)).toBeGreaterThanOrEqual(310);
    expect(goalAge(mid)).toBeLessThan(311);
  });

  it('the time on the goal is counted from its claim, survives a save, and starts afresh in a save from before the valve', () => {
    const g = flowBoard(8, 1);
    at(g, 'make-spark');
    g.sold.spark = 1;
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
    expect(goalView(copy)!.flow!.valve).toBeUndefined();
    run(copy, 2);
    expect(copy.goal.ready).toBe(false); // the valve is open (second 91), and its ten seconds have begun
    expect(goalView(copy)!.flow!.valve).toBe(true);
    // A save made while the valve's count is running picks it up where it was.
    const mid = deserialize(serialize(copy))!;
    expect(goalView(mid)!.progress![0]).toBeCloseTo(goalView(copy)!.progress![0], 6);
    run(mid, 8.5);
    expect(mid.goal.ready).toBe(false);
    run(mid, 1);
    expect(mid.goal.ready).toBe(true); // 100 s on the goal in all
    run(copy, 9.5);
    expect(copy.goal.ready).toBe(true);
    // A save taken mid-goal by the build before this one has no such count: its 90 s start when it is loaded.
    const raw = JSON.parse(serialize(g));
    delete raw.goalAt;
    delete raw.flowNear;
    const old = deserialize(JSON.stringify(raw))!;
    expect(old.flowNear).toBe(0);
    expect(goalAge(old)).toBe(0);
    run(old, 99);
    expect(old.goal.ready).toBe(false);
    run(old, 2);
    expect(old.goal.ready).toBe(true);
  });
});

describe('the card says what to bring about and why, and keeps the gesture for whoever asks how', () => {
  const GESTURE = /\b(click|clicks|drag|drags|tap|taps|press|presses|select|key|keys|swipe|button)\b/i;

  it('every goal has a why: a sentence or two about the game\'s world, the same for a mouse and a finger, with no gesture in it', () => {
    for (const goal of GOALS) {
      const g = fresh();
      at(g, goal.id);
      const mouse = goalView(g)!, touch = goalView(g, true)!;
      expect(mouse.why, goal.id).toBe(goal.why);
      expect(touch.why, goal.id).toBe(goal.why);
      expect([...goal.why].length, goal.id).toBeGreaterThanOrEqual(40);
      // It stands where the hint stood: no longer than the longest hint the card was laid out for.
      expect([...goal.why].length, goal.id).toBeLessThanOrEqual(125);
      expect(goal.why, goal.id).not.toMatch(GESTURE);
      expect(goal.why, goal.id).toMatch(/[.]$/);
      // The how is still there, for the "How?" button, and is another sentence.
      expect(mouse.hint, goal.id).toBe(goal.hint.mouse);
      expect(goal.hint.mouse, goal.id).not.toBe(goal.why);
    }
  });

  it('a title is an outcome: none names a gesture, a port or a wire', () => {
    for (const goal of GOALS) {
      expect(goal.title, goal.id).not.toMatch(GESTURE);
      expect(goal.title, goal.id).not.toMatch(/\b(port|wire|Wire)\b/);
    }
    expect(goalById('wire-market')!.title).toBe('Sell your Sand');
    expect(goalById('build-refiner')!.title).toBe('Turn Sand into Glass');
  });

  it('a Refiner placed from the build bar: the how is the wire into it, not a second Refiner from a port', () => {
    const g = fresh();
    g.techs = ['P1'];
    g.credits = 1000;
    at(g, 'build-refiner');
    expect(goalView(g)!.hint).toBe('Drag from a Drill\'s port into empty space, let go, and pick Refiner.');
    const loose = placeNode(g, 'refiner', 500, 120)!;
    expect(goalView(g)!.hint).toBe('Drag from a Drill\'s port to the Refiner.');
    expect(goalView(g, true)!.hint).toBe('Tap a Drill\'s port, then tap the Refiner.');
    // The why does not change, and the wire completes the goal.
    expect(goalView(g)!.why).toBe(goalById('build-refiner')!.why);
    connect(g, well(g).id, 0, loose.id);
    run(g, 1);
    expect(g.goal.ready).toBe(true);
    // The same for a Lab placed loose on "Study Glass in a Lab".
    const h = fresh();
    h.techs = ['P1', 'R1'];
    h.credits = 1000;
    at(h, 'feed-lab');
    expect(goalView(h)!.hint).toBe('Drag from a Refiner\'s port into empty space and pick Lab.');
    placeNode(h, 'lab', 700, 300);
    expect(goalView(h)!.hint).toBe('Drag from a Refiner\'s port to the Lab.');
    // The words other parts of the game read for what they name are the goal's own, whatever the board.
    expect(goalById('build-refiner')!.hint.mouse).toContain('pick Refiner');
  });

  it('the first Glass is worth the trouble by the card\'s own numbers, which are the game\'s', () => {
    expect(goalById('build-refiner')!.why).toBe(`Two Sand sell for ${2 * MATERIALS.glint.value}¢. Melted into one Glass they sell for ${MATERIALS.shard.value}¢. A Refiner does the melting.`);
    expect(MATERIALS.shard.value).toBeGreaterThan(2 * MATERIALS.glint.value);
    expect(goalById('make-glyph')!.why).toContain(`sells for ${MATERIALS.glyph.value}¢`);
    expect(goalById('make-prism')!.why).toContain(`sells for ${MATERIALS.prism.value}¢`);
  });

  it('a goal about a recipe shows it: every "make" goal, and no other', () => {
    const shown = Object.fromEntries(GOALS.filter((x) => x.recipe).map((x) => [x.id, x.recipe]));
    expect(shown).toEqual({
      'build-refiner': 'shard', 'make-ink': 'ink', 'make-spark': 'spark', 'make-glyph': 'glyph', 'make-mist': 'mist', 'make-prism': 'prism', 'make-lens': 'lens',
      'make-clay': 'clay', 'make-coil': 'coil', 'make-dynamo': 'dynamo', 'make-paradox': 'paradox',
    });
    for (const goal of GOALS) {
      const g = fresh();
      at(g, goal.id);
      expect(goalView(g)!.recipe, goal.id).toBe(goal.recipe ? RECIPES[goal.recipe] : undefined);
    }
  });

  it('where several things are put together, the card ticks off each input as it is wired in, and what comes out when it goes somewhere', () => {
    const g = rich();
    at(g, 'make-glyph');
    // No Assembler yet: nothing to tick. (And nothing for a recipe with one input, ever.)
    expect(recipeFeeds(g, RECIPES.glyph)).toBeNull();
    expect(goalView(g)!.fed).toBeUndefined();
    expect(recipeFeeds(g, RECIPES.shard)).toBeNull();
    const murk = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    const ember = placeNode(g, 'well', 0, 0, { depositId: 4 })!;
    const ink = placeNode(g, 'refiner', 400, 400)!;
    const spark = placeNode(g, 'refiner', 400, 560)!;
    connect(g, murk.id, 0, ink.id);
    connect(g, ember.id, 0, spark.id);
    // An Assembler with no recipe yet is the one the card is about.
    const glyph = placeNode(g, 'assembler', 700, 400)!;
    expect(recipeFeeds(g, RECIPES.glyph)).toEqual({ fed: { ink: false, spark: false }, out: false });
    connect(g, ink.id, 0, glyph.id);
    expect(goalView(g)!.fed).toEqual({ fed: { ink: true, spark: false }, out: false });
    connect(g, glyph.id, 0, market(g).id);
    expect(goalView(g)!.fed).toEqual({ fed: { ink: true, spark: false }, out: true });
    // Through a Router counts as wired in.
    const router = placeNode(g, 'router', 560, 620)!;
    connect(g, spark.id, 0, router.id);
    connect(g, router.id, 0, glyph.id);
    expect(goalView(g)!.fed).toEqual({ fed: { ink: true, spark: true }, out: true });
    // Ready to claim: the card shows Claim, and ticks nothing.
    run(g, 20);
    expect(g.goal.ready).toBe(true);
    expect(goalView(g)!.fed).toBeUndefined();
  });
});

describe('goalDeposit: the free deposit a goal asks for a Drill on (the board frames it when a game opens)', () => {
  it('names the deposit while placing the Drill is the next gesture, and nothing once it stands or before the research', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'L1'];
    at(g, 'second-well');
    expect(goalDeposit(g)).toBe(2); // the free Sand deposit
    at(g, 'make-ink');
    expect(goalDeposit(g)).toBeNull(); // Oil Deposits not researched: the card's next gesture is in the tech tree
    g.techs.push('P2');
    expect(goalDeposit(g)).toBe(3); // the Oil deposit
    placeNode(g, 'well', 0, 0, { depositId: 3 });
    expect(goalDeposit(g)).toBeNull(); // the Drill stands: the hint has moved on to its Refiner (goalFocus names it)
    at(g, 'make-spark');
    g.techs.push('P3');
    expect(goalDeposit(g)).toBe(4); // the Ore deposit
    g.goal.ready = true;
    expect(goalDeposit(g)).toBeNull();
    at(g, 'hold-flow');
    expect(goalDeposit(g)).toBeNull();
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
    claim('wire-market'); // +12¢ buys the second Drill at once
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
    claim('sell-shard'); // +70¢ buys the second Refiner at once
    expect(has(g, 'R1')).toBe(false);
    // "Make 1 Glass a second": a Refiner for the Drill that only sells. The card counts what the Refiners turn out.
    expect(goalView(g)!.progress).toEqual([expect.any(Number), 1, 'Glass a second']);
    const r2 = placeNode(g, 'refiner', 400, 260, { recipe: 'shard' })!;
    expect(r2).not.toBeNull();
    connect(g, w2.id, 0, r2.id);
    connect(g, r2.id, 0, m.id);
    run(g, 1);
    expect(g.goal.ready).toBe(false); // a Refiner just built has made nothing yet
    run(g, 19);
    claim('grow-shard'); // +125¢ buys the four levels of Speed the next card's own way takes
    // "Make 1.2 Glass a second": Speed on a Refiner alone leaves it waiting for Sand...
    for (const n of [r, r2]) expect(upgrade(g, n.id, 'speed')).toBe(true);
    run(g, 20);
    expect(g.goal.ready).toBe(false);
    expect(goalView(g)!.progress![0]).toBeLessThan(1.1);
    // ...and Speed on the Drills that feed them gets there.
    for (const n of [w1, w2]) expect(upgrade(g, n.id, 'speed')).toBe(true);
    run(g, 20);
    expect(goalView(g)).toMatchObject({ ready: true });
    claim('tune-shard'); // the Lab + 100¢
    expect(has(g, 'R1')).toBe(true);
    const lab = placeNode(g, 'lab', 700, 100)!;
    expect(lab, `a Lab costs 100¢, have ${g.credits.toFixed(1)}¢`).not.toBeNull();
    connect(g, r.id, 0, lab.id);
    run(g, 6);
    claim('feed-lab'); // +20α
    expect(g.time).toBeLessThan(90); // no waiting anywhere so far, but for the two rates to show
    // The first research is the first real wait: Oil Deposits costs 40α.
    expect(research(g, 'P2')).toBe(false);
    let waited = 0;
    while (!research(g, 'P2') && waited < 180) {
      run(g, 1);
      waited++;
    }
    expect(has(g, 'P2')).toBe(true);
    expect(waited).toBeLessThan(60);
    run(g, 0.1);
    claim('research-murk');
    expect(g.stats.fromGoals).toBe(12 + 10 + 50 + 20 + 70 + 125 + 100 + 40);
    expect(g.stats.nodesBuilt).toBe(4);
    expect(g.stats.wiresMade).toBe(7);
  });
});

describe('milestones', () => {
  it('announces each new material once, pays nothing, and stays silent about the starting Sand', () => {
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

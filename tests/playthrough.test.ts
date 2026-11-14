// Coarse regression for the tuning: a scripted player (no bot, no cleverness) does exactly what the goal
// card asks. If a price or a reward drifts so far that the opening no longer chains, this fails.
import { describe, expect, it } from 'vitest';
import { claimGoal, connect, placeNode, upgrade } from '../src/actions';
import { has, nodeCost, research, upgradeCost } from '../src/economy';
import { GOALS, MAIN_GOALS, activeGoal } from '../src/goals';
import { Game, GNode } from '../src/state';
import { CardRun, clock, playByTheCard } from './cardPlayer';
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
// A player who does ONLY what each goal card says, in the card's own words, one action every six seconds
// (tests/cardPlayer.ts): no upgrade the card did not ask for, no second Lab, no extra machines, no side
// techs. With the adviser (src/advice.ts) on top, following a tip once it has been on offer for 15 seconds of
// a wait, that is the newcomer the build is tuned for: `npm run pacing` judges that player (who also claims
// 8–16 s late) against the targets, and tests/pacing.test.ts pins seed 0 of it. Here the same script proves
// that every goal can be done from the state the one before leaves behind, with the tips and without, and
// pins what the tips are worth.
// ---------------------------------------------------------------------------------------------------

const on = (run: CardRun, id: string) => run.spent.find((x) => x.id === id)!;
const lens = (r: CardRun) => r.g.stats.firstLensAt!;
const SPINE = ['L1', 'P1', 'P2', 'P3', 'P4', 'P5', 'P7', 'R1', 'S1']; // what the goal chain grants or asks for

// Without tips a wait can last twenty minutes: the prices are set for a player who follows them. (One run,
// shared by both groups of tests: it is an hour of game time.)
const plain = playByTheCard({ tendOrders: 'asked', wall: 30 * 60 });

describe('the whole demo, by the card alone', () => {

  it('every goal can be done, in order, by doing only what its card says', () => {
    const { g, spent } = plain;
    expect(spent.map((x) => x.id)).toEqual(GOALS.slice(0, MAIN_GOALS).map((x) => x.id));
    expect(g.ended).toBe(true);
    expect(g.stats.firstLensAt).not.toBeNull();
    expect(g.credits).toBeGreaterThanOrEqual(0);
    // Nothing the card did not ask for: one Lab and no side techs. The only upgrades are the Well's of goal 6
    // and what the Flow ring led to on goal 16.
    expect(g.nodes.filter((n) => n.type === 'lab').length).toBe(1);
    expect([...g.techs].sort()).toEqual(SPINE);
    expect(plain.tips.every((t) => t.kind === 'flow')).toBe(true);
    expect(g.nodes.reduce((s, n) => s + n.lv.speed + n.lv.eff + n.lv.buffer, 0)).toBe(1 + plain.tips.length);
  });

  it('"Hold 95% Flow" is earned: it does not complete until the one machine short of its input is fixed', () => {
    // The card sends the player to the Flow ring; what holds Flow back is the Spark Refiner, short of Ember.
    const fixes = plain.tips.filter((t) => t.goal === 'hold-flow');
    expect(fixes.length).toBeGreaterThanOrEqual(1);
    expect(fixes.length).toBeLessThanOrEqual(2);
    expect(fixes[0].text).toBe('The Spark Refiner is holding Flow back because it is short of Ember: click the Ember Well and buy Speed (50¢).');
    expect(on(plain, 'hold-flow').seconds).toBeGreaterThan(30);
    expect(on(plain, 'hold-flow').seconds).toBeLessThan(120);
  });

  it('but it is a slow game: every long wait is for α, with credits piling up, which is what the adviser is for', () => {
    const { g, spent } = plain;
    const long = spent.filter((x) => x.seconds > 180);
    expect(long.map((x) => `${x.title}: ${x.waitedFor}`)).toEqual([
      'Make your first Spark: α for Ember Deposits',
      'Assemble your first Glyph: α for Assembly',
      'Make your first Mist: α for Breeze Deposits',
      'Build a Fabricator: α and β for Fabrication',
    ]);
    // Close to an hour to the Lens, against about twenty minutes with the tips.
    expect(lens(plain)).toBeGreaterThan(40 * 60);
    expect(lens(plain)).toBeLessThan(65 * 60);
    expect(g.stats.fromSales + g.stats.fromGoals + g.stats.fromOrders).toBeGreaterThan(15000);
    // The two-price rule never shows itself to this player.
    expect(g.seenSurplus).toBe(false);
  });
});

describe('the whole demo, by the card and the tips', () => {
  // The newcomer: card and tips, at six seconds an action for four order seeds, and once at ten seconds.
  const runs = [0, 1, 2, 3].map((seed) => ({ name: `seed ${seed}`, run: playByTheCard({ tips: true, seed }) }));
  runs.push({ name: '10 s hands', run: playByTheCard({ tips: true, seed: 0, hands: 10 }) });

  it('every goal can still be done in order, and the tips are the only thing this player does unprompted', () => {
    for (const { name, run } of runs) {
      const { g, spent, tips } = run;
      expect(spent.map((x) => x.id), name).toEqual(GOALS.slice(0, MAIN_GOALS).map((x) => x.id));
      expect(g.ended, name).toBe(true);
      expect(g.credits, name).toBeGreaterThanOrEqual(0);
      expect(tips.length, name).toBeGreaterThan(8);
      expect(spent.reduce((s, x) => s + x.tips, 0), name).toBe(tips.length);
      // Every upgrade on the board beyond the one goal 6 asks for was a tip.
      const levels = g.nodes.reduce((s, n) => s + n.lv.speed + n.lv.eff + n.lv.buffer, 0);
      expect(levels - 1, name).toBeLessThanOrEqual(tips.filter((t) => /buy Speed|Upgrade all/.test(t.text)).length * 8);
      if (levels > 1) expect(tips.some((t) => /buy Speed|Upgrade all/.test(t.text)), name).toBe(true);
      // No tech was researched that the card did not ask for, unless a tip said so.
      const side = g.techs.filter((id) => !SPINE.includes(id));
      expect(side.length, name).toBe(tips.filter((t) => /research/.test(t.text)).length);
    }
  });

  it('the tips are worth following: half an hour off the Lens, and no goal takes four minutes', () => {
    for (const { name, run } of runs.slice(0, 4)) {
      expect(lens(run), name).toBeLessThan(lens(plain) - 20 * 60);
      // The Data waits are where the card-only player sat idle longest.
      for (const id of ['make-spark', 'make-glyph', 'make-mist', 'build-fabricator']) expect(on(run, id).seconds, `${name} ${id}`).toBeLessThan(on(plain, id).seconds);
      expect(run.longestTipless, name).toBeLessThan(plain.longestTipless);
    }
    for (const { name, run } of runs) {
      // Four minutes at six seconds an action, five for the slower hands.
      expect(Math.max(...run.spent.map((x) => x.seconds)), name).toBeLessThanOrEqual(name === '10 s hands' ? 300 : 240);
      // The first order starts counting at once and is done in about half a minute, for everyone.
      expect(on(run, 'first-order').tipless, name).toBeLessThanOrEqual(45);
      // The Flow goal takes a fix or two, each named by the adviser.
      const fixes = run.tips.filter((t) => t.goal === 'hold-flow');
      expect(fixes.length, name).toBeGreaterThanOrEqual(1);
      expect(fixes.length, name).toBeLessThanOrEqual(3);
      expect(fixes.every((t) => t.kind === 'flow' && /is holding Flow back because/.test(t.text)), name).toBe(true);
      // The two-price rule never bites before the Lens.
      expect(run.surplusAt, name).toBeNull();
    }
  });

  it('BASELINE (printed, not asserted): each goal\'s time, and the longest wait with no tip, per run', () => {
    const all = [{ name: 'no tips', run: plain }, ...runs];
    const pad = (v: string | number, n: number) => String(v).padStart(n);
    const lines: string[] = [];
    lines.push(`${'seconds on each goal (tips followed)'.padEnd(42)}${all.map((x) => pad(x.name, 12)).join('')}`);
    GOALS.slice(0, MAIN_GOALS).forEach((goal, i) => {
      lines.push(`${pad(i + 1, 2)} ${goal.title.padEnd(39)}${all.map((x) => {
        const t = x.run.spent[i];
        return pad(`${Math.round(t.seconds)}${t.tips ? ` (${t.tips})` : ''}`, 12);
      }).join('')}`);
    });
    const row = (label: string, f: (r: CardRun) => string | number) => lines.push(`${label.padEnd(42)}${all.map((x) => pad(f(x.run), 12)).join('')}`);
    row('first Lens', (r) => clock(lens(r)));
    row('longest on one goal (s)', (r) => Math.round(Math.max(...r.spent.map((x) => x.seconds))));
    row('time on "Build a Fabricator" (s)', (r) => Math.round(on(r, 'build-fabricator').seconds));
    row('longest wait with no tip on offer (s)', (r) => r.longestTipless);
    row('...on which goal', (r) => r.spent.reduce((m, x) => (x.tipless > m.tipless ? x : m)).id.slice(0, 11));
    row('tips followed', (r) => r.tips.length);
    row('first sale over demand', (r) => (r.surplusAt == null ? 'never' : clock(r.surplusAt)));
    row('credits from sales and orders', (r) => `${Math.round((100 * (r.g.stats.fromSales + r.g.stats.fromOrders)) / (r.g.stats.fromSales + r.g.stats.fromOrders + r.g.stats.fromGoals))}%`);
    console.info(`\nCARD-PLUS-TIPS BASELINE (the tests' own newcomer; the targets are judged on the pacing tool's)\n${lines.join('\n')}\n\nTips followed, seed 0:\n${runs[0].run.tips.map((t) =>
      `  ${clock(t.at)} ${t.goal.padEnd(16)} saves ${t.saves == null ? '?' : isFinite(t.saves) ? Math.round(t.saves) + ' s' : 'the wait'}${t.cost ? `, ${t.cost}¢` : ''}: ${t.text}`).join('\n')}\n`);
    expect(lines.length).toBe(MAIN_GOALS + 9);
  });
});

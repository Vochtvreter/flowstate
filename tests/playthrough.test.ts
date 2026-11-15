// Coarse regression for the tuning: a scripted player (no bot, no cleverness) does exactly what the goal
// card asks. If a price or a reward drifts so far that the opening no longer chains, this fails.
import { describe, expect, it } from 'vitest';
import { claimGoal, connect, placeNode, upgrade } from '../src/actions';
import { has, nodeCost, research, upgradeCost } from '../src/economy';
import { RULES } from '../src/content';
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
// (tests/cardPlayer.ts): the hint, and during a wait the card's "while you wait" line. No upgrade the card did
// not ask for, no extra machines, no side techs. With the adviser (src/advice.ts) on top, following a tip
// once it has been on offer for 15 seconds of a wait, that is the newcomer the build is tuned for: `npm run
// pacing` judges that player (who also claims 8–16 s late) against the targets, with tips and without, and
// tests/pacing.test.ts pins seeds 0–3 of it. Here the same script proves that every goal can be done from the
// state the one before leaves behind, and pins what the cards' lines and the tips are each worth.
// ---------------------------------------------------------------------------------------------------

const on = (run: CardRun, id: string) => run.spent.find((x) => x.id === id)!;
const lens = (r: CardRun) => r.g.stats.firstLensAt!;
const SPINE = ['L1', 'P1', 'P2', 'P3', 'P4', 'P5', 'P7', 'R1', 'S1']; // what the goal chain grants or asks for
const LONG = ['make-spark', 'make-glyph', 'make-mist', 'build-fabricator'];

// The hints alone, without the "while you wait" lines: a wait can last a quarter of an hour. (One run, shared:
// it is most of an hour of game time.)
const bare = playByTheCard({ meanwhile: false, tendOrders: 'asked', wall: 30 * 60 });
// The cards as they are: hints and lines, and never a tip (but for the Flow goal, whose card sends the player to the ring).
const plain = playByTheCard({ tendOrders: 'asked' });

describe('the whole demo, by the card alone', () => {
  it('every goal can be done, in order, by doing only what its card says', () => {
    for (const run of [bare, plain]) {
      const { g, spent } = run;
      expect(spent.map((x) => x.id)).toEqual(GOALS.slice(0, MAIN_GOALS).map((x) => x.id));
      expect(g.ended).toBe(true);
      expect(g.stats.firstLensAt).not.toBeNull();
      expect(g.credits).toBeGreaterThanOrEqual(0);
      // No side techs, and no tip but the Flow ring's. The only upgrades are what the cards asked for: the Well's
      // of goal 6, one level on every Well with "Upgrade all" (goal 20), and the steps of the lines (the Flow fix,
      // Speed on the pairs), or the ring's fix where no line named it.
      // (Market Lens comes by itself with the first sale over demand.)
      expect(g.techs.filter((id) => id !== 'C1').sort()).toEqual(SPINE);
      expect(g.techs.includes('C1')).toBe(g.seenSurplus);
      expect(run.tips.every((t) => t.kind === 'flow')).toBe(true);
      const levels = g.nodes.reduce((s, n) => s + n.lv.speed + n.lv.eff + n.lv.buffer, 0);
      expect(levels).toBe(1 + run.bulkLevels + run.tips.length + run.lines.filter((x) => x.upgrade).length);
    }
    // With the lines the player never needs the ring's tip: the Flow goal's line names the fix.
    expect(plain.tips.length).toBe(0);
    // The hints ask for one Lab. The lines add five more, four of them with a Well of their own, on a board expanded twice.
    expect(bare.g.nodes.filter((n) => n.type === 'lab').length).toBe(1);
    expect(bare.g.board.expansions).toBe(1);
    expect(plain.g.nodes.filter((n) => n.type === 'lab').length).toBe(6);
    expect(plain.g.nodes.filter((n) => n.type === 'well').length).toBe(bare.g.nodes.filter((n) => n.type === 'well').length + 4);
    expect(plain.g.board.expansions).toBe(2);
    // ...Ink is studied, and Glyph no longer is by the time the Fabricator is saved for.
    const wired = (g: typeof plain.g, recipe: string, type: string) =>
      g.wires.some((w) => g.nodes.find((n) => n.id === w.from)?.recipe === recipe && g.nodes.find((n) => n.id === w.to)?.type === type);
    expect(wired(plain.g, 'ink', 'lab')).toBe(true);
    expect(wired(bare.g, 'ink', 'lab')).toBe(false);
    expect(wired(plain.g, 'glyph', 'lab')).toBe(false);
    expect(wired(bare.g, 'glyph', 'lab')).toBe(true);
  });

  it('"Hold 95% Flow" is earned: it does not complete until the one machine short of its input is fixed', () => {
    // The card sends the player to the Flow ring; what holds Flow back is the Spark Refiner, short of Ember. The
    // card's line names the fix, in the words the ring's tip used to: "buy Speed on the Ember Well" (or "its Ember
    // Well", where an Ember Well with a Lab of its own stands too).
    const steps = plain.lines.filter((x) => x.goal === 'hold-flow');
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps[0].text).toMatch(/^The Spark Refiner needs more Ember: buy Speed on (the|an|its) Ember Well \(50¢\)\.$/);
    expect(on(plain, 'hold-flow').seconds).toBeGreaterThan(20);
    expect(on(plain, 'hold-flow').seconds).toBeLessThan(60);
    // A player who ignores the lines gets no tip for it either (a tip never says what the card says): the valve
    // lets that board through, all but one producer flowing, after 90 s.
    expect(bare.tips.filter((t) => t.goal === 'hold-flow')).toEqual([]);
    expect(on(bare, 'hold-flow').seconds).toBeGreaterThan(RULES.flow.valveAfter);
    expect(on(bare, 'hold-flow').seconds).toBeLessThan(RULES.flow.valveAfter + 30);
  });

  it('the lines are what makes it a twenty-minute game: with the hints alone every long wait is for α, and long', () => {
    const long = bare.spent.filter((x) => x.seconds > 180);
    expect(long.map((x) => `${x.title}: ${x.waitedFor}`)).toEqual([
      'Make your first Spark: α for Ember Deposits',
      'Assemble your first Glyph: α for Assembly',
      'Make your first Mist: α for Breeze Deposits',
      'Build a Fabricator: α and β for Fabrication',
    ]);
    // Most of an hour to the Lens with the hints alone, about twenty minutes with the lines: no tip involved.
    expect(lens(bare)).toBeGreaterThan(40 * 60);
    expect(lens(bare)).toBeLessThan(70 * 60);
    expect(lens(plain)).toBeGreaterThan(17 * 60);
    expect(lens(plain)).toBeLessThan(22 * 60);
    for (const id of LONG) expect(on(plain, id).seconds, id).toBeLessThan(0.75 * on(bare, id).seconds);
    // No goal takes four and a half minutes (the pacing tool's card-only player, who claims late, has six).
    expect(Math.max(...plain.spent.map((x) => x.seconds))).toBeLessThan(270);
    expect(plain.g.stats.fromSales + plain.g.stats.fromGoals + plain.g.stats.fromOrders).toBeGreaterThan(9000);
    // The two-price rule does not show itself to this player before the Fabricator is saved for (then the raw
    // goods the last line sends to the Market can go over demand), and Market Lens comes with it.
    if (plain.surplusAt != null) expect(plain.surplusAt).toBeGreaterThan(on(plain, 'bulk-upgrade').seconds + plain.spent.slice(0, GOALS.findIndex((x) => x.id === 'bulk-upgrade')).reduce((s, x) => s + x.seconds, 0) - 1);
    expect(plain.g.techs.includes('C1')).toBe(plain.g.seenSurplus);
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
      expect(spent.reduce((s, x) => s + x.tips, 0), name).toBe(tips.length);
      // Every upgrade on the board beyond what the cards asked for (goal 6's, goal 20's "Upgrade all", the
      // lines' steps) was a tip.
      const levels = g.nodes.reduce((s, n) => s + n.lv.speed + n.lv.eff + n.lv.buffer, 0) - 1 - run.bulkLevels - run.lines.filter((x) => x.upgrade).length;
      expect(levels, name).toBeGreaterThanOrEqual(0);
      expect(levels, name).toBeLessThanOrEqual(tips.filter((t) => /buy Speed|Upgrade all/.test(t.text)).length * 8);
      if (levels > 0) expect(tips.some((t) => /buy Speed|Upgrade all/.test(t.text)), name).toBe(true);
      // No tech was researched that the card did not ask for, unless a tip said so. (Market Lens comes by itself.)
      const side = g.techs.filter((id) => !SPINE.includes(id) && id !== 'C1');
      expect(side.length, name).toBe(tips.filter((t) => /^Research /.test(t.text)).length);
    }
  });

  it('tips are few and large: a handful a run, none under 15 s, and the game does not depend on them', () => {
    for (const { name, run } of runs) {
      const { tips } = run;
      // The Flow goal's fix is the card's own line now; the adviser adds at most a handful, and the game does
      // not wait for any of them (the lines carry the moves the tips used to).
      const fixes = tips.filter((t) => t.goal === 'hold-flow');
      expect(fixes.length, name).toBeLessThanOrEqual(3);
      expect(fixes.every((t) => t.kind === 'flow' && / (needs more|gets no|makes more|has nowhere|has nothing|is backed up|is short)/.test(t.text)), name).toBe(true);
      expect(run.lines.some((x) => x.goal === 'hold-flow'), name).toBe(true);
      expect(tips.length, name).toBeLessThanOrEqual(8);
      for (const t of tips) {
        expect(t.saves, `${name}: ${t.text}`).toBeDefined();
        if (t.kind !== 'flow') expect(t.saves!, `${name}: ${t.text}`).toBeGreaterThanOrEqual(15);
        expect([...t.text].length, t.text).toBeLessThanOrEqual(90);
      }
      // After a tip is followed the next one is at least 20 s (and the 15 s it is on offer) away.
      for (let i = 1; i < tips.length; i++) expect(tips[i].at - tips[i - 1].at, `${name}: ${tips[i].text}`).toBeGreaterThanOrEqual(35);
    }
    for (const { name, run } of runs.slice(0, 4)) {
      // With the tips the Lens comes a little sooner than by the cards alone, not half an hour sooner as it once did.
      expect(lens(run), name).toBeLessThan(lens(plain) + 30);
      expect(lens(run), name).toBeGreaterThan(lens(plain) - 4 * 60);
    }
    for (const { name, run } of runs) {
      // Four minutes at six seconds an action, five for the slower hands.
      expect(Math.max(...run.spent.map((x) => x.seconds)), name).toBeLessThanOrEqual(name === '10 s hands' ? 300 : 240);
      // The first order starts counting at once and is done in about half a minute, for everyone.
      expect(on(run, 'first-order').tipless, name).toBeLessThanOrEqual(45);
      // The two-price rule never bites before the Fabricator is saved for.
      if (run.surplusAt != null) expect(run.surplusAt, name).toBeGreaterThan(14 * 60);
      expect(run.g.techs.includes('C1'), name).toBe(run.g.seenSurplus);
    }
  });

  it('BASELINE (printed, not asserted): each goal\'s time, and the tips, per run', () => {
    const all = [{ name: 'hints only', run: bare }, { name: 'cards', run: plain }, ...runs];
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
    console.info(`\nCARD BASELINE (the tests' own newcomer; the targets are judged on the pacing tool's)\n${lines.join('\n')}\n\nTips followed, seed 0:\n${runs[0].run.tips.map((t) =>
      `  ${clock(t.at)} ${t.goal.padEnd(16)} saves ${t.saves == null ? '?' : isFinite(t.saves) ? Math.round(t.saves) + ' s' : 'the wait'}${t.cost ? `, ${t.cost}¢` : ''}: ${t.text}`).join('\n')}\n`);
    expect(lines.length).toBe(MAIN_GOALS + 9);
  });
});

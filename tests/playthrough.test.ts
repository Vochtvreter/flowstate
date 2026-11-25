// Coarse regression for the tuning: a scripted player (no bot, no cleverness) does exactly what the goal
// card asks. If a price or a reward drifts so far that the opening no longer chains, this fails.
import { describe, expect, it } from 'vitest';
import { claimGoal, connect, placeNode, upgrade } from '../src/actions';
import { has, nodeCost, research, upgradeCost } from '../src/economy';
import { RULES } from '../src/content';
import { activeGoal, goalsOf } from '../src/goals';

/** The goals a game of the chain plays, and how many of them are the demo's. */
const GOALS = goalsOf('chain');
const MAIN_GOALS = GOALS.filter((x) => !x.free).length;
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

/** Goals 1 to 8, played without a pause: wire, second Drill, Refiner, first Glass, a second Refiner, Speed on both lines, Lab. */
function opening(g: Game) {
  const p = player(g);
  const w1 = well(g);
  const m = market(g);

  connect(g, w1.id, 0, m.id);
  p.claim('wire-market');

  const w2 = p.pay('the second Drill', nodeCost(g, 'well'), () => placeNode(g, 'well', 0, 0, { depositId: 2 }));
  p.claim('second-well');

  connect(g, w2.id, 0, m.id);
  p.claim('wire-all-wells');
  expect(has(g, 'P1')).toBe(true);

  const refiner = p.pay('the first Refiner', nodeCost(g, 'refiner'), () => placeNode(g, 'refiner', 400, 100));
  connect(g, w1.id, 0, refiner.id);
  p.claim('build-refiner');

  connect(g, refiner.id, 0, m.id);
  run(g, 6); // two Sand in, two seconds of refining, one Glass out and sold
  p.claim('sell-shard');
  expect(has(g, 'R1')).toBe(false); // the Lab is earned by growing the Glass line first

  // "Make 1 Glass a second": a Refiner for the Drill that only sells.
  const second = p.pay('the second Refiner', nodeCost(g, 'refiner'), () => placeNode(g, 'refiner', 400, 260));
  connect(g, w2.id, 0, second.id);
  connect(g, second.id, 0, m.id);
  run(g, 20); // (judged by what the Refiners turn out, which takes a few seconds to show)
  p.claim('grow-shard');

  // "Make 1.2 Glass a second": a level of Speed on each Refiner and on the Drill that feeds it.
  for (const n of [refiner, second]) p.pay('Speed on a Refiner', upgradeCost(n, 'speed'), () => upgrade(g, n.id, 'speed'));
  for (const n of [w1, w2]) p.pay('Speed on a Drill', upgradeCost(n, 'speed'), () => upgrade(g, n.id, 'speed'));
  run(g, 25);
  p.claim('tune-shard');
  expect(has(g, 'R1')).toBe(true);

  const lab = p.pay('the first Lab', nodeCost(g, 'lab'), () => placeNode(g, 'lab', 700, 100));
  connect(g, refiner.id, 0, lab.id);
  run(g, 6);
  p.claim('feed-lab');
  return { p, w1, w2, m, refiner, lab };
}

describe('scripted playthrough', () => {
  it('the first eight goals are claimed in order, every purchase paid for by the rewards before it', () => {
    const g = fresh();
    const { p } = opening(g);
    expect(p.claimed).toEqual(GOALS.slice(0, 8).map((x) => x.id));
    // Reward money alone bought the Drill, both Refiners, four levels of Speed and the Lab: nothing had to be
    // waited for but the two growth goals' rates to show.
    expect(p.purse).toBeGreaterThanOrEqual(0);
    expect(g.time).toBeLessThan(90);
    expect(g.credits).toBeGreaterThanOrEqual(p.purse);
    expect(g.stats.fromGoals).toBe(GOALS.slice(0, 8).reduce((s, x) => s + (x.reward.credits ?? 0), 0));
  });

  it('doing only what the card asks reaches Orders in a few minutes, with no wait over a minute and a half', () => {
    const g = fresh();
    const { p, m, lab } = opening(g);
    const build = (what: string, limit: number, price: () => number, make: () => GNode | null): GNode => {
      p.wait(`credits for ${what}`, limit, () => g.credits >= price());
      const n = make();
      expect(n, what).not.toBeNull();
      return n!;
    };

    // Goal 8: the first research is the first real wait.
    p.wait('α for Oil Deposits', 90, () => research(g, 'P2'));
    p.claim('research-murk');

    // Goal 9: a Drill on the Oil deposit and a Refiner from its port.
    const murk = build('the Oil Drill', 30, () => nodeCost(g, 'well'), () => placeNode(g, 'well', 0, 0, { depositId: 3 }));
    const ink = build('the Plastic Refiner', 60, () => nodeCost(g, 'refiner'), () => placeNode(g, 'refiner', 400, 420));
    connect(g, murk.id, 0, ink.id);
    expect(ink.recipe).toBe('ink');
    connect(g, ink.id, 0, m.id);
    p.wait('the first Plastic', 15, () => !!g.made.ink);
    p.claim('make-ink');

    // Goal 10: the Tar needs an exit before the Refiner jams.
    const sink = placeNode(g, 'void', 700, 560)!;
    connect(g, ink.id, 1, sink.id);
    p.wait('the Plastic Refiner running', 20, () => g.goal.ready);
    p.claim('silt-exit');
    void lab;

    // Orders come with that claim, and Ore Deposits stays locked until the Plastic line has been widened.
    expect(p.claimed).toEqual(GOALS.slice(0, 11).map((x) => x.id));
    expect(activeGoal(g)!.id).toBe('first-order');
    expect(g.ordersOn).toBe(true);
    expect(g.order).not.toBeNull();
    g.data.a = 1e6;
    expect(research(g, 'P3')).toBe(false);
    expect(p.longestWait).toBeLessThan(90);
    expect(g.time).toBeLessThan(4 * 60);
    expect(g.credits).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------------------------------
// The whole demo, by the card.
//
// A player who does ONLY what each goal card says, in the card's own words, one action every six seconds
// (tests/cardPlayer.ts): the hint; on a growth goal ("Make 1 Glass a second") the one way its line gives, a step
// at a time; and during a wait the card's "while you wait" line. No upgrade the card did not ask for, no extra
// machines, no side techs. With the adviser (src/advice.ts) on top, following a tip
// once it has been on offer for 15 seconds of a wait, that is the newcomer the build is tuned for: `npm run
// pacing` judges that player (who also claims 8–16 s late) against the targets, with tips and without, and
// tests/pacing.test.ts pins seeds 0–3 of it. Here the same script proves that every goal can be done from the
// state the one before leaves behind, and pins what the cards' lines and the tips are each worth.
// ---------------------------------------------------------------------------------------------------

const on = (run: CardRun, id: string) => run.spent.find((x) => x.id === id)!;
const lens = (r: CardRun) => r.g.stats.firstLensAt!;
const SPINE = ['P1', 'P2', 'P3', 'P4', 'P5', 'P7', 'R1', 'S1']; // what the goal chain grants or asks for
/** The goals whose card asks for a research: each comes straight after the growth goal that opens it. */
const RESEARCH = ['make-spark', 'make-glyph', 'make-mist', 'build-fabricator'];

// The hints and the growth goals' own way, without the "while you wait" lines (the Flow fix, the cut of the Circuit
// wire, the tune-up before the Fabricator).
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
      // No side techs, and no tip but the Flow ring's. The only upgrades are what the cards asked for: one level on
      // every Drill with "Upgrade all", and the steps of the lines (Speed on the way to a growth goal's rate, the
      // Flow fix, the tune-up), or the ring's fix where no line named it.
      // (Market Lens comes by itself with the first sale over demand.)
      expect(g.techs.filter((id) => id !== 'C1').sort()).toEqual([...SPINE].sort());
      expect(g.techs.includes('C1')).toBe(g.seenSurplus);
      expect(run.tips.every((t) => t.kind === 'flow')).toBe(true);
      const levels = g.nodes.reduce((s, n) => s + n.lv.speed + n.lv.eff + n.lv.buffer, 0);
      expect(levels).toBe(run.bulkLevels + run.tips.length + run.lines.filter((x) => x.upgrade).length);
      // What the growth goals leave on the board by the first Phone: two lines of each refined thing they ask for
      // (Glass, Plastic, Copper), two Assemblers of each kind, on a board expanded twice. One Lab: the cards ask
      // for no other. (It was one Refiner of each kind, and a Drill with a Lab of its own on every spare deposit.)
      const making = (recipe: string) => g.nodes.filter((n) => n.recipe === recipe).length;
      for (const recipe of ['shard', 'ink', 'spark', 'glyph', 'prism']) expect(making(recipe), recipe).toBeGreaterThanOrEqual(2);
      expect(g.board.expansions).toBe(2);
      expect(g.nodes.filter((n) => n.type === 'lab').length).toBe(1);
      expect(g.nodes.filter((n) => n.type === 'router').length).toBe(0);
    }
    // With the lines the player never needs the ring's tip: the Flow goal's line names the fix.
    expect(plain.tips.length).toBe(0);
    // Circuit is studied for β, and no longer is by the time the Fabricator is saved for (the card's line cuts that wire).
    const wired = (g: typeof plain.g, recipe: string, type: string) =>
      g.wires.some((w) => g.nodes.find((n) => n.id === w.from)?.recipe === recipe && g.nodes.find((n) => n.id === w.to)?.type === type);
    expect(wired(plain.g, 'glyph', 'lab')).toBe(false);
    expect(wired(bare.g, 'glyph', 'lab')).toBe(true);
    // And where the tune-up found a deposit standing free, it is in use: a line more than the growth goals asked for.
    expect(plain.g.nodes.filter((n) => n.type === 'well').length).toBeGreaterThan(bare.g.nodes.filter((n) => n.type === 'well').length);
  });

  it('"Hold 95% Flow" is earned: it does not complete until the one machine short of its input is fixed', () => {
    // The card sends the player to the Flow ring; what holds Flow back is the Copper Refiner, short of Ore. The
    // card's line names the fix, in the words the ring's tip used to: "buy Speed on the Ore Drill" (or "its Ore
    // Drill", where an Ore Drill with a Lab of its own stands too).
    const steps = plain.lines.filter((x) => x.goal === 'hold-flow');
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps[0].text).toMatch(/^The Copper Refiner needs more Ore: buy Speed on (the|an|its) Ore Drill \(50¢\)\.$/);
    expect(on(plain, 'hold-flow').seconds).toBeGreaterThan(20);
    expect(on(plain, 'hold-flow').seconds).toBeLessThan(60);
    // A player who ignores the lines gets no tip for it either (a tip never says what the card says): the valve
    // lets that board through, all but one producer flowing, after 90 s.
    expect(bare.tips.filter((t) => t.goal === 'hold-flow')).toEqual([]);
    expect(on(bare, 'hold-flow').seconds).toBeGreaterThan(RULES.flow.valveAfter);
    expect(on(bare, 'hold-flow').seconds).toBeLessThan(RULES.flow.valveAfter + 30);
  });

  it('no goal is a wait for Data: a research comes with the claim that opens it, and the one long goal is the save for the Fabricator', () => {
    for (const run of [bare, plain]) {
      // (A wait of more than half a minute is noted with what it was for.)
      for (const id of RESEARCH) expect(on(run, id).waitedFor, id).not.toMatch(/^α/);
      const long = run.spent.filter((x) => x.seconds > 150);
      expect(long.map((x) => `${x.title}: ${x.waitedFor}`)).toEqual(['Build a Fabricator: credits for a fabricator']);
    }
    // About sixteen minutes to the Phone by the cards (this player claims within seconds and takes no time over a
    // growth card; the pacing tool's card-only player, who claims 8–16 s late and looks at each growth card for
    // twelve, at 17:47–18:29). The "while you wait" lines are worth a minute or two of that, not half an hour as they
    // were when every research was a wait: they are the Flow fix and the tune-up now.
    expect(lens(plain)).toBeGreaterThan(14 * 60);
    expect(lens(plain)).toBeLessThan(19 * 60);
    expect(lens(bare)).toBeGreaterThan(lens(plain));
    expect(lens(bare)).toBeLessThan(lens(plain) + 4 * 60);
    expect(on(plain, 'build-fabricator').seconds).toBeLessThan(on(bare, 'build-fabricator').seconds);
    // No goal takes four and a half minutes.
    expect(Math.max(...plain.spent.map((x) => x.seconds))).toBeLessThan(270);
    expect(plain.g.stats.fromSales + plain.g.stats.fromGoals + plain.g.stats.fromOrders).toBeGreaterThan(9000);
    // The two-price rule does not show itself to this player before the Phone: nothing the cards ask for sells over
    // its demand (the growth goals stop short of it, and the tune-up builds only what still sells at full price).
    // Market Lens comes with it, in free play.
    if (plain.surplusAt != null) expect(plain.surplusAt).toBeGreaterThanOrEqual(lens(plain));
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
      // Every upgrade on the board beyond what the cards asked for (the press of "Upgrade all", the lines' steps)
      // was a tip.
      const levels = g.nodes.reduce((s, n) => s + n.lv.speed + n.lv.eff + n.lv.buffer, 0) - run.bulkLevels - run.lines.filter((x) => x.upgrade).length;
      expect(levels, name).toBeGreaterThanOrEqual(0);
      expect(levels, name).toBeLessThanOrEqual(tips.filter((t) => /buy Speed|Upgrade all/.test(t.text)).length * 8);
      if (levels > 0) expect(tips.some((t) => /buy Speed|Upgrade all/.test(t.text)), name).toBe(true);
      // No tech was researched that the card did not ask for (its hints and its lines), unless a tip said so.
      // (Market Lens comes by itself.)
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
      // With the tips the Phone comes a little sooner than by the cards alone, not half an hour sooner as it once did.
      expect(lens(run), name).toBeLessThan(lens(plain) + 30);
      expect(lens(run), name).toBeGreaterThan(lens(plain) - 4 * 60);
    }
    for (const { name, run } of runs) {
      // Four minutes at six seconds an action, five for the slower hands.
      expect(Math.max(...run.spent.map((x) => x.seconds)), name).toBeLessThanOrEqual(name === '10 s hands' ? 300 : 240);
      // The first order starts counting at once and is done in about half a minute, for everyone.
      expect(on(run, 'first-order').tipless, name).toBeLessThanOrEqual(45);
      // The two-price rule never bites before the Fabricator is saved for.
      if (run.surplusAt != null) expect(run.surplusAt, name).toBeGreaterThan(12 * 60);
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
    row('first Phone', (r) => clock(lens(r)));
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

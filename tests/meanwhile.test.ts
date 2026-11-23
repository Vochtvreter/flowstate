// The goal cards' "while you wait" lines (Goal.meanwhile in src/goals.ts): what they say, the order they come
// in, when they show, that each is true on the board a card-following player has, that nothing later undoes
// them, and that lineAdvice (the step the card's "Show me" acts out) follows each one to the end.
import { describe, expect, it } from 'vitest';
import { claimGoal, claimOrder, clearHistory, connect, cutWire, expandBoard, favour, freeDeposits, placeNode, upgrade } from '../src/actions';
import { ADVICE, Advice, advice, adviceTrials, applyAdvice, lineAdvice, tuneState } from '../src/advice';
import { NODE_DEFS, RULES, TECHS } from '../src/content';
import { demandRate, nodeCost } from '../src/economy';
import { GOALS, MAIN_GOALS, Meanwhile, activeGoal, goalById, goalFocus, goalView, meanwhileAt, meanwhileOf, outrun, refineNext } from '../src/goals';
import { Game, cloneGame, deserialize, nodeNoun, serialize } from '../src/state';
import { Bot, CFG, POLICIES } from '../tools/pacing';
import { followMeanwhile, playByTheCard } from './cardPlayer';
import { fresh, market, realWaitEnds, rich, run, well } from './helpers';

/** This goal comes up on the board as it stands: as the game notes it, with the lines that are done already (they are not shown). */
const at = (g: Game, id: string) => {
  g.goal = { i: GOALS.findIndex((x) => x.id === id), ready: false };
  g.goalAt = { i: g.goal.i, t: g.time, had: (GOALS[g.goal.i].meanwhile ?? []).filter((l) => l.done(g)).map((l) => l.id) };
};
const typeOf = (g: Game, id: number) => g.nodes.find((n) => n.id === id)?.type;
const wired = (g: Game, recipe: string, type: string) => g.wires.some((w) => g.nodes.find((n) => n.id === w.from)?.recipe === recipe && typeOf(g, w.to) === type);
/** The lines of each goal that has any, in the order the card shows them. */
const ORDER: Record<string, string[]> = {
  'grow-shard': ['grow-shard'],
  'tune-shard': ['tune-shard'],
  'grow-ink': ['grow-ink'],
  'hold-flow': ['flow-fix'],
  'grow-spark': ['grow-spark'],
  'grow-glyph': ['grow-glyph'],
  'make-prism': ['cut-glyph'],
  'grow-prism': ['grow-prism'],
  'build-fabricator': ['cut-glyph', 'tune-up'],
  'make-lens': ['prism-fab', 'glyph-fab'],
};
/** The growth goals' lines: one way to a rate (Meanwhile.grow, Meanwhile.way). The line's id is its goal's. */
const GROWTH: Record<string, { mat: string; rate: number; tune?: boolean }> = {
  'grow-shard': { mat: 'shard', rate: 1 },
  'tune-shard': { mat: 'shard', rate: 1.2, tune: true },
  'grow-ink': { mat: 'ink', rate: 1 },
  'grow-spark': { mat: 'spark', rate: 1 },
  'grow-glyph': { mat: 'glyph', rate: 0.6 },
  'grow-prism': { mat: 'prism', rate: 0.5 },
};
const TEXT: Record<string, { mouse: string; touch: string }> = {
  // (A growth goal's line reads its next step's own words while there is one: Meanwhile.say. These are for a board it
  // has no step for.)
  'grow-shard': { mouse: 'More Refiners, each with Sand of its own: any way that gets you there counts.', touch: '' },
  'tune-shard': { mouse: 'Faster Refiners, and faster Drills to feed them: any way that gets you there counts.', touch: '' },
  'grow-ink': { mouse: 'More Oil, more Refiners or faster ones: any way that gets you there counts.', touch: '' },
  'grow-spark': { mouse: 'More Ore, more Refiners or faster ones: any way that gets you there counts.', touch: '' },
  'grow-glyph': { mouse: 'More Assemblers or faster ones: any way that gets you there counts.', touch: '' },
  'grow-prism': { mouse: 'More Assemblers or faster ones, and the Glass and Silicon to feed them: any way counts.', touch: '' },
  // (Its words once done. While there is a step, the card reads the line's words for the board: Meanwhile.say, below.)
  'flow-fix': {
    mouse: 'Click the Flow ring to find what holds Flow back, and give it what it lacks.',
    touch: 'Tap the Flow ring to find what holds Flow back, and give it what it lacks.',
  },
  'cut-glyph': { mouse: 'You have the β you need: cut the wire from the Circuit Assembler to the Lab.', touch: '' },
  // (Its words once ticked. While a step is on offer, the card reads the words for that step: Meanwhile.say.)
  'tune-up': { mouse: 'Your line is tuned: nothing else pays for itself before the Fabricator.', touch: '' },
  'prism-fab': { mouse: 'Wire the Screen Assembler\'s port to the Fabricator: a Phone takes one Screen.', touch: '' },
  'glyph-fab': { mouse: 'Wire the Circuit Assembler\'s port to the Fabricator: a Phone takes two Circuits.', touch: '' },
};
for (const t of Object.values(TEXT)) if (!t.touch) t.touch = t.mouse;
const lineOf = (id: string): Meanwhile => GOALS.flatMap((x) => x.meanwhile ?? []).find((l) => l.id === id)!;
/**
 * The Fabricator card's tune-up, whose steps are only on the card while they pay for themselves before the
 * Fabricator can be bought (Meanwhile.closes): it may leave the card with work left, and a copy of a board (which
 * does not remember what was on offer a moment ago) may not have it where the game it was copied from did.
 */
const EARNING = ['tune-up'];

/** The most steps each line can take on the scripted boards. */
const MOST: Record<string, number> = {
  // A growth goal's own way: a Refiner (with its wire to the Market); four levels of Speed and one to spare; the plot,
  // a Drill, a Refiner, a Dump's wire, and a level of Speed where a new Drill is too slow; an Assembler and its second input.
  'grow-shard': 2, 'tune-shard': 6, 'grow-ink': 6, 'grow-spark': 6, 'grow-glyph': 4, 'grow-prism': 5,
  'flow-fix': 4, 'cut-glyph': 1, 'prism-fab': 1, 'glyph-fab': 1,
  // A level of Speed or two on each outrun Refiner; a Drill, a Refiner and its wire to the Market on each free deposit.
  'tune-up': 15,
};

describe('"while you wait": the lines', () => {
  it('ten goals carry lines, in this order, and no other goal does; six of them are the growth goals, whose line is one way to a rate', () => {
    expect(Object.fromEntries(GOALS.filter((x) => x.meanwhile?.length).map((x) => [x.id, x.meanwhile!.map((l) => l.id)]))).toEqual(ORDER);
    for (const [id, text] of Object.entries(TEXT)) expect(lineOf(id).text, id).toEqual(text);
    // A line that stands on two goals is the same line: what it asks for, and when it is done, do not change.
    expect(goalById('make-prism')!.meanwhile![0]).toBe(goalById('build-fabricator')!.meanwhile![0]);
    // The growth goals: the line carries the material and the rate its goal's title names, and is marked as one way.
    for (const goal of GOALS) {
      for (const line of goal.meanwhile ?? []) {
        const grow = GROWTH[line.id];
        expect(line.grow, line.id).toEqual(grow);
        expect(!!line.way, line.id).toBe(!!grow);
        if (!grow) continue;
        expect(line.id).toBe(goal.id);
        expect(goal.title).toMatch(new RegExp(`^Make ${String(grow.rate).replace('.', '\\.')} \\w+ a second$`));
        // The card's count is that rate, to two places, with the thing's name.
        const g = fresh();
        at(g, goal.id);
        expect(goalView(g)!.progress).toEqual([0, grow.rate, expect.stringMatching(/^[A-Z][a-z]+ a second$/)]);
      }
    }
    expect(MAIN_GOALS).toBe(25);
    expect(GOALS.length).toBe(29);
  });

  it('each is one sentence of at most 90 characters; touch wording names no click, drag, hover or key, mouse wording no tap', () => {
    for (const goal of GOALS) {
      for (const line of goal.meanwhile ?? []) {
        for (const text of [line.text.mouse, line.text.touch]) {
          expect([...text].length, text).toBeLessThanOrEqual(RULES.tips.maxLength);
          expect([...text].length, text).toBeGreaterThan(30);
          expect(text.endsWith('.'), text).toBe(true);
          expect(text.slice(0, -1), text).not.toMatch(/[.!?] /);
        }
        expect(line.text.touch, line.id).not.toMatch(/\b(click|drag|press|hover|key|select)\b/i);
        expect(line.text.mouse, line.id).not.toMatch(/\btap\b/i);
      }
    }
  });

  it('a growth goal\'s line reads its next step\'s own words, is marked as one way, and goes with the goal\'s Claim', () => {
    // "Make 1 Glass a second" on the board the first five goals leave: two Drills that sell, one Refiner.
    const g = rich();
    g.techs = ['P1'];
    g.credits = 300;
    const m = market(g);
    const w1 = well(g);
    connect(g, w1.id, 0, m.id);
    const w2 = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    connect(g, w2.id, 0, m.id);
    const shard = placeNode(g, 'refiner', 300, 100, { recipe: 'shard' })!;
    connect(g, w1.id, 0, shard.id);
    connect(g, shard.id, 0, m.id);
    run(g, 20);
    at(g, 'grow-shard');
    const said = 'Build a Refiner from a Sand Drill\'s port (57¢): its Glass sells for 3¢ each.';
    for (const touch of [false, true]) expect(goalView(g, touch)!.meanwhile).toEqual({ text: said, done: false, way: true });
    expect(meanwhileAt(g)).toMatchObject({ step: 1, of: 1 });
    const a = lineAdvice(g)!;
    // One gesture at a time: the Refiner from the port of the Drill that only sells, then its wire to the Market.
    expect(a).toMatchObject({ build: 'refiner', node: w2.id, port: 0, recipe: 'shard', cost: 57 });
    expect(a.text.mouse).toBe(said);
    expect(applyAdvice(g, a)).toBe(true);
    const b = lineAdvice(g)!;
    expect(b.wire).toMatchObject({ to: m.id, port: 0 });
    expect(b.text.mouse).toBe('Wire a Glass Refiner\'s port to the Market: its Glass is not sold (3¢ each).');
    expect(goalView(g)!.meanwhile).toMatchObject({ text: b.text.mouse, way: true });
    expect(applyAdvice(g, b)).toBe(true);
    // Built and sold, and coming up to speed: nothing more to do but watch the count.
    run(g, 2);
    expect(lineAdvice(g)).toBeNull();
    expect(goalView(g)!.meanwhile).toMatchObject({ text: TEXT['grow-shard'].mouse, done: false, way: true });
    expect(goalView(g)!.progress![0]).toBeLessThan(1);
    // The rate is there: a goal that is ready to claim shows Claim and nothing else.
    run(g, 20);
    expect(g.goal.ready).toBe(true);
    expect(goalView(g)!.meanwhile).toBeUndefined();
    expect(meanwhileOf(g)).toBeNull();
    expect(lineAdvice(g)).toBeNull();
    // A goal with no line has none.
    for (const id of ['wire-market', 'research-murk', 'make-spark', 'make-glyph', 'study-glyph', 'make-mist', 'bulk-upgrade', 'make-clay']) {
      at(g, id);
      expect(goalView(g)!.meanwhile, id).toBeUndefined();
    }
    clearHistory();
  });

  it('"cut the Circuit wire" is asked only while the β is covered (in hand or still to come from the cards) and the Fabricator is not paid for', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'P5'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    const glyph = placeNode(g, 'assembler', 700, 400, { recipe: 'glyph' })!;
    const lab = placeNode(g, 'lab', 900, 100)!;
    connect(g, glyph.id, 0, m.id);
    const w = connect(g, glyph.id, 0, lab.id)!;
    const line = lineOf('cut-glyph');
    const need = TECHS.P7.cost.b!;
    // On "Make your first Screen" the β to come (this card's and the next one's) covers Fabrication already.
    at(g, 'make-prism');
    g.credits = 0;
    g.data.b = 0;
    expect((goalById('make-prism')!.reward.b ?? 0) + (goalById('bulk-upgrade')!.reward.b ?? 0)).toBeGreaterThanOrEqual(need);
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['cut-glyph'].mouse, done: false });
    // On "Build a Fabricator" nothing is to come: β in hand only.
    at(g, 'build-fabricator');
    g.data.b = need - 1;
    expect(meanwhileOf(g)?.id).not.toBe('cut-glyph');
    expect(line.cuts!(g)).toEqual([]);
    g.data.b = need;
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['cut-glyph'].mouse, done: false });
    expect(line.cuts!(g)).toEqual([w.id]);
    // The research spends the β: the line stays (Fabrication is owned, nothing else in the demo needs β).
    g.data.b = 0;
    g.techs.push('P7');
    expect(meanwhileOf(g)!.id).toBe('cut-glyph');
    // The price in hand: nothing would come sooner by selling.
    g.credits = nodeCost(g, 'fabricator');
    expect(meanwhileOf(g)).toBeNull();
    expect(line.cuts!(g)).toEqual([]);
    g.credits = 100;
    expect(followMeanwhile(g)).toBe(true);
    expect(g.wires.some((x) => x.id === w.id)).toBe(false);
    expect(line.done(g)).toBe(true);
    clearHistory();
  });
});

// ---------------------------------------------------------------------------------------------------
// True, and never undone: on the boards of the scripted card player (tests/cardPlayer.ts).
// ---------------------------------------------------------------------------------------------------

interface Snap { goal: string; line: string; g: Game; from: string }

/**
 * Plays a run and keeps the board as it stood the first time each line came up undone. On the way, every idle
 * second, lineAdvice(g) is held to its word: no step without a line, none for a line that is done, and a step
 * it does give can be paid for and carried out there and then (`bad` lists every moment that was not so).
 */
function snapshots(name: string, opts: Parameters<typeof playByTheCard>[0]) {
  const snaps: Snap[] = [];
  /** The board the first time the player waited on each goal, line or none. */
  const idle: Record<string, Game> = {};
  const bad: string[] = [];
  const seen = { seconds: 0, steps: 0, done: 0, none: 0 };
  const run = playByTheCard({
    ...opts,
    onIdle: (g) => {
      const goal = activeGoal(g)!;
      const line = meanwhileOf(g);
      const step = lineAdvice(g);
      const where = `${name}, ${goal.id}/${line?.id ?? '-'} at ${Math.round(g.time)} s`;
      idle[goal.id] ??= cloneGame(g)!;
      seen.seconds++;
      if (!line) seen.none++;
      else if (line.done(g)) seen.done++;
      if (step) {
        seen.steps++;
        if (!line || line.done(g)) bad.push(`${where}: a step with ${line ? 'the line done' : 'no line'}: ${step.text.mouse}`);
        if ((step.cost ?? 0) > g.credits + 1e-6) bad.push(`${where}: not affordable: ${step.text.mouse}`);
        const copy = cloneGame(g)!;
        if (!applyAdvice(copy, step)) bad.push(`${where}: could not be done: ${step.text.mouse}`);
      }
      if (!line || line.done(g) || snaps.some((s) => s.goal === goal.id && s.line === line.id)) return;
      snaps.push({ goal: goal.id, line: line.id, g: cloneGame(g)!, from: where });
    },
  });
  return { run, snaps, idle, bad, seen };
}

/** The tests' card player, with the cards alone and with the tips on four order sequences: played once, used by the blocks below. */
let played: { cards: ReturnType<typeof snapshots>; tips: ReturnType<typeof snapshots>[] } | null = null;
const cardRuns = () => (played ??= {
  cards: snapshots('cards', { tendOrders: 'asked' }),
  tips: [0, 1, 2, 3].map((seed) => snapshots(`cards and tips, seed ${seed}`, { tips: true, seed })),
});

/** The player who does this line's gestures, the way the card player does, six seconds of hands each: for realWaitEnds. Counts them. */
const doing = (line: string, count: { n: number }) => (g: Game) => (meanwhileOf(g)?.id === line && followMeanwhile(g) ? (count.n++, 6) : 0);

describe('"while you wait": each line is true, and nothing undoes it', () => {
  const { cards, tips } = cardRuns();

  it('every line comes up for the player who follows the cards, with the tips and without', () => {
    // (The two lines of "Make your first Phone" only come up for a Fabricator that is not fed: this player wires
    // what the hint names straight after the build. The Flow line only when something is short.)
    const all = Object.entries(ORDER).flatMap(([goal, lines]) => lines.map((l) => `${goal}/${l}`)).filter((x) => !x.startsWith('make-lens/'));
    for (const t of [cards, ...tips]) {
      const got = t.snaps.map((s) => `${s.goal}/${s.line}`);
      // Each at most once.
      expect(new Set(got).size).toBe(got.length);
      // A line on two goals comes up on one or the other (done on the first, it is done on the second).
      const shared = (x: string) => x.endsWith('/cut-glyph');
      // (The Fabricator card's tune-up comes up where its steps pay: checked on the pacing tool's players, further down.)
      const earning = (x: string) => EARNING.some((id) => x.endsWith(`/${id}`));
      for (const x of all) if (!shared(x) && !earning(x)) expect(got, x).toContain(x);
      expect(got.some((x) => x.endsWith('/cut-glyph')), 'the Circuit sold').toBe(true);
    }
  });

  it('doing what a line says ends that goal\'s wait sooner than not doing it, in the real game', () => {
    const report: string[] = [];
    const measured = new Set<string>();
    for (const { goal, line, g, from } of [...cards.snaps, ...tips.flatMap((t) => t.snaps)]) {
      // (A growth goal is not a wait: its line is the way to it, and without it the goal does not end at all. Those
      // are followed to the end in the block on lineAdvice, below.)
      if (lineOf(line).way) continue;
      const gains: number[] = [];
      const gestures = { n: 0 };
      let finished = true;
      // The game's own order sequence, and another: orders pay in lumps, and which one comes next is luck.
      for (let k = 0; k < 2; k++) {
        const done = cloneGame(g)!;
        const left = cloneGame(g)!;
        done.orderSeed = left.orderSeed = (g.orderSeed + k * 7919) >>> 0;
        const idle = realWaitEnds(left, 1500, 0.05);
        const withIt = realWaitEnds(done, 1500, 0.05, doing(line, gestures));
        finished &&= lineOf(line).done(done);
        expect(isFinite(idle) && isFinite(withIt), from).toBe(true);
        gains.push(idle - withIt);
      }
      clearHistory();
      report.push(`${from}: ${gains.map((x) => x.toFixed(0)).join(', ')} s sooner${gestures.n ? '' : ' (not one gesture could be paid for before the wait ended)'}`);
      // A line on two goals can stand on the first while the credits it needs go to that card's own purchase
      // (lineAdvice keeps them): what of it can be done there must cost that wait nothing, and it is finished,
      // and judged, on the second.
      if (!finished && line === 'cut-glyph') {
        for (const x of gains) expect(x, from).toBeGreaterThanOrEqual(0);
        continue;
      }
      // The Fabricator card's tune-up promises less: of each step only that the Fabricator is not later for it.
      // Held to that here (a few seconds either way are the orders' lumps); what it is worth is measured on the
      // pacing tool's players below.
      // (So does the cut of the Circuit wire: it is for the saves ahead, and done where the card first asks.)
      if (EARNING.includes(line) || line === 'cut-glyph') {
        expect((gains[0] + gains[1]) / 2, `${goal}/${line}: ${from}`).toBeGreaterThanOrEqual(0);
        continue;
      }
      measured.add(line);
      // Sooner under either sequence, and by 15 s on average: a line takes the player's hands for a while.
      for (const x of gains) expect(x, from).toBeGreaterThan(0);
      expect((gains[0] + gains[1]) / 2, `${goal}/${line}: ${from}`).toBeGreaterThanOrEqual(15);
    }
    // The one "while you wait" line that is held to 15 s here is the Flow goal's. (The research waits and the lines
    // that shortened them are gone: a research comes with the claim that opens it. "cut-glyph" is done on the Screen
    // card, where it ends no wait; its worth is on the Fabricator card, measured on the pacing tool's player below.)
    expect([...measured].sort()).toEqual(['flow-fix']);
    console.info(`"while you wait" lines, seconds each ends its wait sooner (two order sequences):\n  ${report.join('\n  ')}`);
  });

  it('what a line asked for is still there at the first Phone, and no tip ever went against one', () => {
    for (const { run } of [cards, ...tips]) {
      const g = run.g;
      // What the growth goals had the player build: two lines of each refined thing, two Assemblers of each kind,
      // on a board expanded twice.
      for (const recipe of ['shard', 'ink', 'spark', 'glyph', 'prism']) expect(g.nodes.filter((n) => n.recipe === recipe).length, recipe).toBeGreaterThanOrEqual(2);
      expect(g.board.expansions).toBe(2);
      expect(wired(g, 'glyph', 'lab'), 'Circuit is no longer studied').toBe(false); // the cut on the Screen and Fabricator cards
      for (const t of run.tips) {
        expect(t.text, t.text).not.toMatch(/^(Cut|Remove) /);
        expect(t.text, t.text).not.toMatch(/^Favour /);
        if (t.goal === 'build-fabricator' || t.goal === 'make-lens') expect(t.text, t.text).not.toMatch(/Circuit Assembler's port to (the|a) Lab/);
      }
    }
  });

  it('a card that asks for a wire to go is the only thing that ever takes one away: the adviser has nothing to add once it is done', () => {
    for (const t of tips) {
      const snap = t.snaps.find((s) => s.line === 'cut-glyph')!;
      const g = cloneGame(snap.g)!;
      expect(followMeanwhile(g)).toBe(true);
      run(g, 25);
      const a = advice(g);
      expect(a?.cut).toBeUndefined();
      if (a?.wire) expect(g.nodes.find((n) => n.id === a.wire!.from)!.recipe).not.toBe('glyph');
    }
    clearHistory();
    expect(claimGoal(fresh())).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// True for the players the pacing is judged by, too (tools/pacing.ts): the card-only player, who never takes
// a tip. Their boards are not the boards above: they claim 8 to 16 s late, which shifts what each wait is for.
// ---------------------------------------------------------------------------------------------------

describe('"while you wait": worth it to the pacing tool\'s card-only player', () => {
  const SEEDS = [0, 1, 2, 3];
  const play = (policy: string, seed: number, skip: string[] = [], onLine: typeof CFG.onLine = null) => {
    CFG.skipLines = skip;
    CFG.onLine = onLine;
    try {
      const bot = new Bot(POLICIES[policy], seed, 45);
      bot.run();
      return bot;
    } finally {
      CFG.skipLines = [];
      CFG.onLine = null;
    }
  };
  /** Seconds a run spent on the goals a line stands on: from the claim before each to its own. */
  const spent = (bot: Bot, line: string) => {
    let s = 0;
    GOALS.forEach((goal, i) => {
      if (!goal.meanwhile?.some((l) => l.id === line)) return;
      s += bot.goalClaimedAt[goal.id] - bot.goalClaimedAt[GOALS[i - 1].id];
    });
    return s;
  };

  it('the card-only player who leaves a "while you wait" line out is never sooner for it, and 15 s later without the Flow goal\'s', () => {
    // Not the lines of "Make your first Phone": this player wires what the hint names anyway (the lines are for a
    // person who did not, and are checked on such boards below).
    // (Nor the growth goals': without its line a growth goal does not end for this player at all.)
    const lines = ['flow-fix', 'cut-glyph', 'tune-up'];
    const report: string[] = [];
    const gains: [string, number][] = [];
    for (const seed of SEEDS) {
      const plain = play('cardonly', seed);
      expect(plain.g.ended).toBe(true);
      for (const line of lines) {
        const without = play('cardonly', seed, [line]);
        expect(without.g.ended, `seed ${seed}, without ${line}`).toBe(true);
        const gain = spent(without, line) - spent(plain, line);
        report.push(`seed ${seed} ${line}: ${Math.round(spent(plain, line))} s with it, ${Math.round(spent(without, line))} s without`);
        gains.push([`seed ${seed}: ${line}`, gain]);
      }
    }
    console.info(`the card-only player of the pacing tool, each line left out in turn:\n  ${report.join('\n  ')}`);
    // The Flow goal's line names the fix, where without it the valve has to pass the board: half a minute and more.
    // The cut of the Circuit wire and the tune-up are for the save for the Fabricator: they put work into that wait,
    // and promise of each step only that the Fabricator is not later for it. Never a loss; a few seconds on average.
    const least = (what: string) => (what.endsWith('flow-fix') ? 15 : 0);
    for (const [what, gain] of gains) expect(gain, what).toBeGreaterThanOrEqual(least(what));
    const tune = gains.filter(([what]) => what.endsWith('tune-up')).map(([, gain]) => gain);
    expect(tune.reduce((a, b) => a + b, 0) / tune.length, 'the tune-up, on average').toBeGreaterThanOrEqual(3);
  }, 600_000);
});

// ---------------------------------------------------------------------------------------------------
// lineAdvice(g): the line's next step in the shape of a tip, for the card's "Show me" (src/advice.ts).
// ---------------------------------------------------------------------------------------------------

/** One sentence of at most 90 characters that names no click, drag, tap or key: the same for mouse and touch. */
function checkStep(a: Advice, from: string) {
  expect(a.text.touch, from).toBe(a.text.mouse);
  const text = a.text.mouse;
  expect([...text].length, text).toBeLessThanOrEqual(RULES.tips.maxLength);
  expect([...text].length, text).toBeGreaterThan(30);
  expect(text.endsWith('.'), text).toBe(true);
  expect(text.slice(0, -1), text).not.toMatch(/[.!?] /);
  expect(text, text).not.toMatch(/\b(click|drag|press|tap|select|key)\b/i);
  expect(text, text).not.toMatch(/undefined|NaN|null|Infinity/);
  if (a.cost) expect(text, text).toContain(`${Math.round(a.cost)}¢`);
  // No saving is promised, nothing was measured.
  expect(a.saves, from).toBeUndefined();
  expect(a.eta, from).toBe(0);
  expect(a.steps, from).toBe(1);
  // Exactly one thing to do (a research too: Lab Speed, then Deep Analysis, on "Make and sell Silicon").
  expect([a.wire, a.build, a.cut, a.expand, a.upgrade, a.research].filter((x) => x != null).length, from).toBe(1);
  expect(a.favour ?? a.to ?? a.all, from).toBeUndefined();
}

/**
 * Follow lineAdvice from this board until the line is done: every step it gives is checked and carried out,
 * and while it gives none the game runs on (nobody plays: the step is waiting for credits). Returns the steps.
 */
function followSteps(g: Game, line: string, from: string): Advice[] {
  const steps: Advice[] = [];
  const id = activeGoal(g)!.id;
  let waited = 0;
  for (;;) {
    if (g.goal.ready) break; // (the goal came first: the card shows Claim)
    const now = meanwhileOf(g);
    // (The Fabricator card's tune-up may leave with work left, once no step of it pays.)
    if (!now && EARNING.includes(line)) break;
    // (The Flow goal's line is off the card while the level just bought shows, and until the board is old enough to be judged.)
    if (!now && line === 'flow-fix') {
      run(g, 1);
      expect(++waited, `${from}: no line for ten minutes`).toBeLessThan(600);
      continue;
    }
    expect(now, `${from}: a line stays on the card while it is followed`).not.toBeNull();
    if (now!.id !== line || now!.done(g)) break;
    const a = lineAdvice(g);
    if (!a) {
      run(g, 1);
      expect(++waited, `${from}: no step for ten minutes`).toBeLessThan(600);
      expect(activeGoal(g)!.id).toBe(id);
      if (g.goal.ready) break;
      continue;
    }
    checkStep(a, from);
    expect(a.cost ?? 0, `${from}: affordable when given: ${a.text.mouse}`).toBeLessThanOrEqual(g.credits + 1e-6);
    const before = { nodes: g.nodes.length, wires: g.wires.length, expansions: g.board.expansions, credits: g.credits };
    expect(applyAdvice(g, a), `${from}: doable when given: ${a.text.mouse}`).toBe(true);
    // (Six seconds of hands, as the card player: a Flow fix shows in utilisation only after a moment.)
    const after = { nodes: g.nodes.length, wires: g.wires.length, expansions: g.board.expansions, credits: g.credits };
    // It did what it said, and nothing else.
    expect(after.expansions - before.expansions).toBe(a.expand ? 1 : 0);
    expect(after.nodes - before.nodes).toBe(a.build ? 1 : 0);
    // (Whatever is built from a port arrives wired to it: a Lab, a Refiner, a Dump.)
    expect(after.wires - before.wires).toBe(a.wire ? 1 : a.cut ? -1 : a.build && a.node != null ? 1 : 0);
    expect(before.credits - after.credits).toBeCloseTo(a.cost ?? 0, 6);
    run(g, 6);
    steps.push(a);
    expect(steps.length, `${from}: ${steps.map((x) => x.text.mouse).join(' / ')}`).toBeLessThanOrEqual(MOST[line]);
  }
  return steps;
}

describe('lineAdvice: the next step of the card\'s line, for its "Show me"', () => {
  const SEEDS = [0, 1, 2, 3];
  /** The boards of the pacing tool's card players at the moment each began a line. */
  const pacingBoards = (policy: string, seed: number): Snap[] => {
    const snaps: Snap[] = [];
    CFG.onLine = (g, goal, line) => snaps.push({ goal, line, g: cloneGame(g)!, from: `pacing ${policy}/${seed}, ${goal}/${line} at ${Math.round(g.time)} s` });
    try {
      new Bot(POLICIES[policy], seed, 45).run();
    } finally {
      CFG.onLine = null;
    }
    return snaps;
  };
  const { cards, tips } = cardRuns();
  const boards: Snap[] = [
    ...cards.snaps, ...tips.flatMap((t) => t.snaps),
    ...SEEDS.flatMap((seed) => [...pacingBoards('cardonly', seed), ...pacingBoards('newcomer10', seed)]),
    // (A copy of a board on which the Fabricator card's tune-up was on its last seconds may not have it.)
  ].filter((b) => !EARNING.includes(b.line) || meanwhileOf(b.g)?.id === b.line);

  it('the boards are the card players\' own: every line but those of goal 22, from the tests\' player and from the pacing tool\'s', () => {
    const lines = new Set(boards.map((b) => b.line));
    for (const id of Object.keys(TEXT)) if (id !== 'prism-fab' && id !== 'glyph-fab') expect(lines.has(id), id).toBe(true);
    for (const b of boards) {
      expect(activeGoal(b.g)!.id, b.from).toBe(b.goal);
      expect(meanwhileOf(b.g)!.id, b.from).toBe(b.line);
      expect(meanwhileOf(b.g)!.done(b.g), b.from).toBe(false);
    }
  });

  it('followed one step at a time (the game running until each can be paid for), every line ends done, in a bounded number of steps', () => {
    const report: Record<string, Set<string>> = {};
    for (const { line, g, from } of boards) {
      const h = cloneGame(g)!;
      const steps = followSteps(h, line, from);
      if (lineOf(line).way) {
        // A growth goal's own way: followed to its end, the rate is there and the card shows Claim.
        expect(h.goal.ready, `${from}: ${steps.map((a) => a.text.mouse).join(' / ')}`).toBe(true);
        expect(steps.length, from).toBeGreaterThanOrEqual(1);
        (report[line] ??= new Set()).add(steps.map((a) => a.text.mouse.replace(/\d+¢/g, 'N¢')).join('  →  '));
        clearHistory();
        continue;
      }
      if (h.goal.ready) continue; // (the goal came first: nothing more on the card)
      // (A copy has no memory of the step that was on offer: where it was on its last seconds, nothing is given.)
      if (EARNING.includes(line) && !steps.length) continue;
      expect(steps.length, from).toBeGreaterThanOrEqual(1);
      expect(lineOf(line).done(h), from).toBe(true);
      (report[line] ??= new Set()).add(steps.map((a) => a.text.mouse.replace(/\d+¢/g, 'N¢')).join('  →  '));
      clearHistory();
    }
    console.info(`lineAdvice, step by step on the card players' boards:\n  ${Object.entries(report).map(([id, set]) => `${id}: ${[...set].slice(0, 3).join('\n      or: ')}`).join('\n  ')}`);
    // The growth goals, by their card's own way: one gesture at a time.
    for (const seq of report['grow-shard']) expect(seq).toBe('Build a Refiner from a Sand Drill\'s port (N¢): its Glass sells for N¢ each.  →  Wire a Glass Refiner\'s port to the Market: its Glass is not sold (N¢ each).');
    // Speed on the Refiners, and on the Drills that then cannot keep up: never the board's next plot.
    for (const seq of report['tune-shard']) {
      expect(seq).toMatch(/^A Glass Refiner runs flat out: buy Speed \(N¢\) for more Glass\./);
      expect(seq).toMatch(/A Glass Refiner needs more Sand: buy Speed on its Sand Drill \(N¢\)\./);
      expect(seq).not.toMatch(/expand|deposit/i);
    }
    // More land where every deposit is in use, a Drill, a Refiner, its Plastic to the Market and its Tar to the Dump.
    for (const seq of report['grow-ink']) {
      expect(seq).toMatch(/^Every Oil deposit is in use: expand the board \(N¢\) for another\.  →  Place a Drill on the free Oil deposit \(N¢\), then build a Refiner from it\.  →  Build a Refiner from an Oil Drill's port \(N¢\): its Plastic sells for N¢ each\.  →  Wire a Refiner's Plastic port to the Market: its Plastic is not sold \(N¢ each\)\.  →  Wire a Refiner's Tar port to the Dump: it stops when its Tar piles up\./);
    }
    // The same for Ore, and then the new Ore Drill is too slow for its Refiner, as the first one was.
    // (Where the Flow goal went by with the first Ore Drill still too slow, that Drill's level of Speed comes first.)
    for (const seq of report['grow-spark']) {
      expect(seq).toMatch(/^Every Ore deposit is in use: expand the board \(N¢\) for another\.  →  .*Place a Drill on the free Ore deposit \(N¢\), then build a Refiner from it\.  →  Build a Refiner from an Ore Drill's port \(N¢\): its Copper sells for N¢ each\.  →  Wire a Copper Refiner's port to the Market: its Copper is not sold \(N¢ each\)\./);
      expect(seq).toMatch(/A Copper Refiner needs more Ore: buy Speed on its Ore Drill \(N¢\)\.$/);
    }
    // A second Assembler from the Plastic line that feeds none, its Circuit sold, Copper wired in.
    for (const seq of report['grow-glyph']) {
      expect(seq).toMatch(/^Build an Assembler from a Refiner's Plastic port \(N¢\) for more Circuit\.  →  Wire a Circuit Assembler's port to the Market: its Circuit is not sold \(N¢ each\)\.  →  A Circuit Assembler gets no Copper: wire a Copper Refiner's port to it\./);
    }
    for (const seq of report['grow-prism']) {
      expect(seq).toMatch(/^Build an Assembler from a Glass Refiner's port \(N¢\) for more Screen\.  →  Wire a Screen Assembler's port to the Market: its Screen is not sold \(N¢ each\)\.  →  A Screen Assembler gets no Silicon: wire the Silicon Refiner's port to it\./);
    }
    for (const seq of report['flow-fix'] ?? []) expect(seq).toMatch(/needs more \w+: buy Speed on (the|an?|its) \w+ (Drill|Refiner)/);
    for (const seq of report['cut-glyph']) expect(seq).toMatch(/^Cut the wire from (the|a) Circuit Assembler to (the|a) Lab: sold, each Circuit is N¢\.$/);
    // The tune-up: a level of Speed where a Drill outruns its Refiner; a Drill on a free deposit, its Refiner, and the wire to the Market.
    for (const seq of report['tune-up']) {
      expect(seq).toMatch(/(^|  →  )((The|An?) \w+ Drill outruns its Refiner: buy Speed on the Refiner \(N¢\)\.|Place a Drill on the free \w+ deposit \(N¢\), then build a Refiner from it\.|Build a Refiner from (the|an?) \w+ Drill's port \(N¢\): its \w+ sells for N¢ each\.)/);
      expect(seq).not.toMatch(/Build a Refiner from [^→]*$/); // never left with its product unsold: the wire to the Market follows
      expect(seq).not.toMatch(/Place a Drill on [^→]*$/); // nor a Drill left standing alone
    }
  });

  it('through whole runs it never gives a step without a line or for a line that is done, and every step it gives can be done on the spot', () => {
    for (const t of [cards, ...tips]) {
      expect(t.bad, t.bad.join('\n')).toEqual([]);
      // The check saw all of it: waits with no line, lines done, and steps on offer.
      expect(t.seen.seconds).toBeGreaterThan(300);
      expect(t.seen.none).toBeGreaterThan(30);
      expect(t.seen.steps).toBeGreaterThanOrEqual(5);
    }
    // Ready to claim, a goal with no line, the chain finished: nothing.
    const g = cloneGame(boards.find((b) => b.line === 'grow-ink')!.g)!;
    expect(lineAdvice(g)).not.toBeNull();
    g.goal.ready = true;
    expect(lineAdvice(g)).toBeNull();
    for (const id of ['wire-market', 'study-glyph', 'bulk-upgrade', 'make-clay']) {
      at(g, id);
      expect(lineAdvice(g), id).toBeNull();
    }
    g.goal = { i: GOALS.length, ready: false };
    expect(lineAdvice(g)).toBeNull();
    expect(lineAdvice(fresh())).toBeNull();
  });

  it('costs no look-ahead: it leaves the game as it is, and a call takes microseconds', () => {
    const now = () => performance.now();
    let worst = 0;
    for (const { g, from } of boards) {
      const before = serialize(g).replace(/"savedAt":\d+/, '');
      const rev = g.rev;
      const N = 200;
      lineAdvice(g); // (the board's lookup tables are built on the first call after a change)
      const t0 = now();
      for (let i = 0; i < N; i++) lineAdvice(g);
      const each = (now() - t0) / N;
      worst = Math.max(worst, each);
      expect(each, `${from}: ${each.toFixed(4)} ms a call`).toBeLessThan(0.5);
      expect(serialize(g).replace(/"savedAt":\d+/, ''), from).toBe(before);
      expect(g.rev).toBe(rev);
    }
    console.info(`lineAdvice: ${(worst * 1000).toFixed(1)} µs a call at the worst of ${boards.length} boards`);
  });

  it('the step is what the line says, to the letter', () => {
    // Two Sand Drills that sell, each with a Refiner whose Glass is sold: what "Make 1.2 Glass a second" comes up on.
    const g = rich();
    g.techs = ['P1'];
    const m = market(g);
    const wells = [well(g), placeNode(g, 'well', 0, 0, { depositId: 2 })!];
    const refiners = wells.map((w, i) => {
      connect(g, w.id, 0, m.id);
      const r = placeNode(g, 'refiner', 400, 100 + 160 * i, { recipe: 'shard' })!;
      connect(g, w.id, 0, r.id);
      connect(g, r.id, 0, m.id);
      return r;
    });
    run(g, 25);
    at(g, 'tune-shard');
    // Everything runs flat out and it is not enough: a level of Speed on a Refiner, the cheapest first. Never the
    // board's next plot, though it would bring a Sand deposit: this is the goal Speed is the way to.
    let a = lineAdvice(g)!;
    expect(a).toMatchObject({ kind: 'credits', upgrade: 'speed', node: refiners[0].id, cost: 32 });
    expect(a.text.mouse).toBe('A Glass Refiner runs flat out: buy Speed (32¢) for more Glass.');
    expect(a.expand ?? a.build ?? a.wire).toBeUndefined();
    expect(applyAdvice(g, a)).toBe(true);
    // That Refiner now takes more Sand than its Drill brings up, and says so: Speed on the Drill that feeds it.
    run(g, 12);
    expect(refiners[0].status).toBe('starved');
    a = lineAdvice(g)!;
    expect(a).toMatchObject({ upgrade: 'speed', node: wells[0].id, culprit: refiners[0].id, cost: 50 });
    expect(a.text.mouse).toBe('A Glass Refiner needs more Sand: buy Speed on its Sand Drill (50¢).');
    // Not affordable: no step, and the card says what it is saving for.
    g.credits = 49;
    expect(lineAdvice(g)).toBeNull();
    expect(goalView(g)!.meanwhile).toMatchObject({ text: a.text.mouse.replace(' (50¢)', ' (50¢)'), way: true, held: { cost: 50, sym: '¢' } });
    g.credits = 1e9;
    expect(applyAdvice(g, lineAdvice(g)!)).toBe(true);
    clearHistory();

    // "Make 1 Plastic a second" on a board whose one Oil deposit is in use: the next plot first (it brings another),
    // then a Drill there (given only with its Refiner's price in hand as well), the Refiner, its Plastic to the
    // Market, its Tar to the Dump that stands.
    const h = rich();
    h.techs = ['P1', 'R1', 'P2'];
    const hm = market(h);
    connect(h, well(h).id, 0, hm.id);
    const oil = placeNode(h, 'well', 0, 0, { depositId: 3 })!;
    const ink = placeNode(h, 'refiner', 400, 400, { recipe: 'ink' })!;
    connect(h, oil.id, 0, ink.id);
    connect(h, ink.id, 0, hm.id);
    const dump = placeNode(h, 'void', 700, 560)!;
    connect(h, ink.id, 1, dump.id);
    run(h, 25);
    at(h, 'grow-ink');
    a = lineAdvice(h)!;
    expect(a).toMatchObject({ expand: true, cost: 360 });
    expect(a.text.mouse).toBe('Every Oil deposit is in use: expand the board (360¢) for another.');
    expect(applyAdvice(h, a)).toBe(true);
    const free = freeDeposits(h).find((d) => d.mat === 'murk')!;
    a = lineAdvice(h)!;
    expect(a).toMatchObject({ build: 'well', deposit: free.id, cost: nodeCost(h, 'well') });
    expect(a.node ?? a.to ?? a.port).toBeUndefined();
    expect(a.text.mouse).toBe(`Place a Drill on the free Oil deposit (${nodeCost(h, 'well')}¢), then build a Refiner from it.`);
    h.credits = nodeCost(h, 'well') + nodeCost(h, 'refiner') - 1;
    expect(lineAdvice(h)).toBeNull(); // the Drill alone can be paid for, but not its Refiner: neither is asked for yet
    h.credits = 1e9;
    expect(applyAdvice(h, a)).toBe(true);
    const placed = h.nodes.find((n) => n.depositId === free.id)!;
    a = lineAdvice(h)!;
    expect(a).toMatchObject({ build: 'refiner', node: placed.id, port: 0, recipe: 'ink' });
    expect(a.text.mouse).toBe(`Build a Refiner from an Oil Drill's port (${nodeCost(h, 'refiner')}¢): its Plastic sells for 4¢ each.`);
    expect(applyAdvice(h, a)).toBe(true);
    const second = h.nodes.filter((n) => n.recipe === 'ink').find((n) => n.id !== ink.id)!;
    a = lineAdvice(h)!;
    expect(a).toMatchObject({ wire: { from: second.id, to: hm.id, port: 0 }, cost: 0 });
    expect(a.text.mouse).toBe('Wire a Refiner\'s Plastic port to the Market: its Plastic is not sold (4¢ each).');
    expect(applyAdvice(h, a)).toBe(true);
    a = lineAdvice(h)!;
    expect(a).toMatchObject({ wire: { from: second.id, to: dump.id, port: 1 }, cost: 0 });
    expect(a.text.mouse).toBe('Wire a Refiner\'s Tar port to the Dump: it stops when its Tar piles up.');
    expect(applyAdvice(h, a)).toBe(true);
    // Nothing more to do: the new Refiner is coming up to speed, and then the rate is there.
    run(h, 3);
    expect(lineAdvice(h)).toBeNull();
    run(h, 25);
    expect(h.goal.ready).toBe(true);
    clearHistory();

    // A Refiner the player has placed from the build bar, with nothing wired into it, is wired first; and a goal
    // met another way is met: a third line the card never asked for counts like any other.
    const k = rich();
    k.techs = ['P1'];
    const km = market(k);
    connect(k, well(k).id, 0, km.id);
    const r1 = placeNode(k, 'refiner', 400, 100, { recipe: 'shard' })!;
    connect(k, well(k).id, 0, r1.id);
    connect(k, r1.id, 0, km.id);
    const w2 = placeNode(k, 'well', 0, 0, { depositId: 2 })!;
    const loose = placeNode(k, 'refiner', 400, 300)!;
    run(k, 20);
    at(k, 'grow-shard');
    a = lineAdvice(k)!;
    expect(a).toMatchObject({ wire: { from: w2.id, to: loose.id, port: 0 } });
    expect(a.text.mouse).toBe('The Refiner has nothing to work on: wire a Sand Drill\'s port to it.');
    expect(applyAdvice(k, a)).toBe(true);
    expect(loose.recipe).toBe('shard');
    expect(applyAdvice(k, lineAdvice(k)!)).toBe(true); // its Glass to the Market
    run(k, 25);
    expect(k.goal.ready).toBe(true);
    clearHistory();
  });
});

// ---------------------------------------------------------------------------------------------------
// What counts as done, where the board is not the card player's.
// ---------------------------------------------------------------------------------------------------

describe('"while you wait": done means done on any board', () => {
  it('the Screen and Fabricator cards: Circuit that reaches a Lab through a Router is still studied, and the wire to cut is the Router\'s', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'P5', 'L1', 'L2'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    const glyph = placeNode(g, 'assembler', 700, 400, { recipe: 'glyph' })!;
    const lab = placeNode(g, 'lab', 1000, 100)!;
    const router = placeNode(g, 'router', 850, 400)!;
    connect(g, glyph.id, 0, router.id);
    const toLab = connect(g, router.id, 0, lab.id)!;
    connect(g, router.id, 0, m.id);
    favour(g, router.id, toLab.id);
    const merger = placeNode(g, 'merger', 850, 600)!;
    const shard = placeNode(g, 'refiner', 400, 100, { recipe: 'shard' })!;
    const r2 = placeNode(g, 'router', 600, 100)!;
    const spark = placeNode(g, 'refiner', 400, 540, { recipe: 'spark' })!;
    at(g, 'build-fabricator');
    g.credits = 100;
    g.data.b = TECHS.P7.cost.b!;
    const line = lineOf('cut-glyph');
    expect(g.wires.some((w) => w.from === glyph.id && w.to === lab.id)).toBe(false);
    expect(goalView(g)!.meanwhile).toMatchObject({ text: TEXT['cut-glyph'].mouse, done: false });
    expect(line.cuts!(g)).toEqual([toLab.id]);
    const a = lineAdvice(g)!;
    expect(a.cut).toEqual({ wire: toLab.id, from: router.id, to: lab.id });
    expect(a.node).toBe(router.id);
    expect(a.text.mouse).toBe('Cut the wire from a Router to the Lab: sold, each Circuit is 20¢.'); // (two Routers stand on this board)
    expect(adviceTrials(g)!.trials.some((x) => /^Cut /.test(x.text))).toBe(false); // the card's step, not a tip
    expect(applyAdvice(g, a)).toBe(true);
    expect(line.done(g)).toBe(true);
    expect(line.cuts!(g)).toEqual([]);
    // Through two junctions, and with a wire of its own beside it: every wire that takes Circuit into a Lab is listed.
    connect(g, router.id, 0, merger.id);
    const viaMerger = connect(g, merger.id, 0, lab.id)!;
    const direct = connect(g, glyph.id, 0, lab.id)!;
    expect(line.done(g)).toBe(false);
    expect([...line.cuts!(g)].sort()).toEqual([viaMerger.id, direct.id].sort());
    cutWire(g, viaMerger.id);
    cutWire(g, direct.id);
    connect(g, shard.id, 0, r2.id);
    connect(g, r2.id, 0, lab.id);
    expect(line.done(g)).toBe(true);
    connect(g, spark.id, 0, router.id);
    const again = connect(g, router.id, 0, lab.id)!;
    expect(line.cuts!(g)).toEqual([again.id]);
    expect(lineAdvice(g)!.text.mouse).toBe('Cut the wire from a Router to the Lab: sold, each Circuit is 20¢.');
    clearHistory();
  });

  it('"Hold 95% Flow": the step is the Flow fix the ring leads to, and the line is done once everything flows', () => {
    const { cards } = cardRuns();
    const snap = cards.snaps.find((s) => s.line === 'flow-fix');
    expect(snap, 'the card player meets a short producer on the Flow goal').toBeDefined();
    const g = cloneGame(snap!.g)!;
    const a = lineAdvice(g)!;
    expect(a.upgrade ?? a.wire).toBeDefined();
    expect(a.culprit).toBeDefined();
    // goalFocus names the short producer, then what feeds it: what the step is about.
    expect(goalFocus(g)).toEqual([a.culprit!, a.node!]);
    // The line's words name the node the step acts on, in both wordings, and say no more than a card line may.
    const name = nodeNoun(g.nodes.find((n) => n.id === a.node)!);
    for (const touch of [false, true]) {
      const text = goalView(g, touch)!.meanwhile!.text;
      expect(text).toContain(name);
      expect(text).not.toMatch(/machine it picks/);
      expect([...text].length).toBeLessThanOrEqual(90);
    }
    const t0 = g.time;
    while (!g.goal.ready && g.time - t0 < 120) {
      const step = lineAdvice(g);
      if (step) applyAdvice(g, step);
      run(g, 2);
    }
    // Long before the valve (90 s).
    expect(g.goal.ready, `${Math.round(g.time - t0)} s`).toBe(true);
    expect(g.time - t0).toBeLessThan(60);
    clearHistory();
  });
});

// ---------------------------------------------------------------------------------------------------
// "Make your first Phone": the card says which wire, and the Phone follows.
// ---------------------------------------------------------------------------------------------------

describe('"Make your first Phone": a line for each input the Fabricator lacks', () => {
  /** The board as the card players have it when "Build a Fabricator" is claimed, the Fabricator fed nothing but what the card built it from. */
  const board = (where: 'port' | 'apart') => {
    const { cards } = cardRuns();
    // (The first moment the player waited on "Build a Fabricator": saving for it, Fabrication researched or not.)
    const g = cloneGame(cards.idle['build-fabricator'])!;
    g.techs = [...new Set([...g.techs, 'P7'])];
    g.credits = 1e5;
    const prism = g.nodes.find((n) => n.recipe === 'prism')!;
    const f = placeNode(g, 'fabricator', prism.x + 240, prism.y)!;
    if (where === 'port') connect(g, prism.id, 0, f.id);
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
    expect(claimGoal(g)).toBe(true);
    expect(activeGoal(g)!.id).toBe('make-lens');
    return { g, f, prism };
  };

  it('built from the Screen Assembler\'s port: the one line asks for the Circuit wire, the progress counts inputs, and the Phone follows within 30 s', () => {
    const { g, f } = board('port');
    const v = goalView(g)!;
    // The goal's own requirement, not something to do while waiting: the card says "Next step". The Screen line was
    // done when the goal came up (the Fabricator was built from the Screen Assembler's port): it is not shown, ticked,
    // and not counted.
    expect(g.goalAt!.had).toEqual(['prism-fab']);
    expect(v.meanwhile).toEqual({ text: TEXT['glyph-fab'].mouse, done: false, required: true });
    expect(v.progress).toEqual([1, 2, 'inputs wired']);
    expect(v.inputs).toEqual([{ mat: 'prism', name: 'Screen', fed: true }, { mat: 'glyph', name: 'Circuit', fed: false }]);
    // (Two Circuit Assemblers stand by now: the line names the one with the most to spare.)
    const glyph = g.nodes.find((n) => n.id === lineAdvice(g)!.wire!.from)!;
    expect(glyph.recipe).toBe('glyph');
    expect(goalFocus(g)).toEqual([glyph.id, f.id]);
    // Left alone, nothing happens.
    const left = cloneGame(g)!;
    run(left, 300);
    expect(left.goal.ready).toBe(false);
    // The step, and the Phone.
    const a = lineAdvice(g)!;
    expect(a).toMatchObject({ wire: { from: glyph.id, to: f.id, port: 0 }, node: glyph.id });
    expect(a.text.mouse).toBe('Wire a Circuit Assembler\'s port to the Phone Fabricator: a Phone takes two Circuits.');
    expect(applyAdvice(g, a)).toBe(true);
    expect(goalView(g)!.progress).toEqual([0, 1, 'Phone']);
    const t0 = g.time;
    while (!g.goal.ready && g.time - t0 < 60) run(g, 1);
    expect(g.time - t0, 'seconds to the first Phone').toBeLessThanOrEqual(30);
    clearHistory();
  });

  it('built anywhere else: the Screen first ("1 of 2"), then the Circuit, and the Phone follows within 30 s', () => {
    const { g, f, prism } = board('apart');
    expect(g.nodes.find((n) => n.id === f.id)!.recipe).toBeNull();
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['prism-fab'].mouse, done: false, step: 1, of: 2, required: true });
    expect(goalView(g)!.progress).toEqual([0, 2, 'inputs wired']);
    expect(goalFocus(g)).toEqual([prism.id, f.id]);
    let steps = 0;
    const t0 = g.time;
    while (!g.goal.ready && g.time - t0 < 90) {
      const a = lineAdvice(g);
      if (a) {
        expect(applyAdvice(g, a)).toBe(true);
        steps++;
      }
      run(g, 1);
    }
    expect(steps).toBe(2);
    expect(g.nodes.find((n) => n.id === f.id)!.recipe).toBe('lens');
    expect(g.time - t0).toBeLessThanOrEqual(32);
    clearHistory();
  });
});

// ---------------------------------------------------------------------------------------------------
// "Build a Fabricator": the tune-up, the one line whose steps are only said while they pay.
// ---------------------------------------------------------------------------------------------------

describe('"Build a Fabricator": the tune-up before the Fabricator', () => {
  const PRICE = () => NODE_DEFS.fabricator.base;

  /**
   * A board made by hand, on "Build a Fabricator" with Fabrication still to research: a Sand Drill that feeds a
   * Glass Refiner and sells the rest; an Oil Drill with a level of Speed (1.25 a second) that feeds a Plastic Refiner
   * and nothing else (it takes 1); an Ore Drill and a second Sand Drill that each feed a Lab and nothing else.
   * Run for half a minute so that everything counts for Flow, then 2,000¢ in hand, Fabrication's β and no α.
   */
  const board = (credits = 2000, alpha = 0) => {
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3', 'L1', 'P4', 'R2', 'R3', 'P5', 'S1'];
    const m = market(g);
    const glint = well(g);
    const shard = placeNode(g, 'refiner', 400, 100, { recipe: 'shard' })!;
    connect(g, glint.id, 0, shard.id);
    connect(g, glint.id, 0, m.id);
    connect(g, shard.id, 0, m.id);
    const murk = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    upgrade(g, murk.id, 'speed');
    const ink = placeNode(g, 'refiner', 400, 400, { recipe: 'ink' })!;
    connect(g, murk.id, 0, ink.id);
    connect(g, ink.id, 0, m.id);
    connect(g, ink.id, 1, placeNode(g, 'void', 700, 520)!.id);
    const ember = placeNode(g, 'well', 0, 0, { depositId: 4 })!;
    upgrade(g, ember.id, 'speed');
    const emberLab = placeNode(g, 'lab', 400, 560)!;
    connect(g, ember.id, 0, emberLab.id);
    const glint2 = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    const glintLab = placeNode(g, 'lab', 400, 260)!;
    connect(g, glint2.id, 0, glintLab.id);
    run(g, 30);
    g.credits = credits;
    g.data = { a: alpha, b: TECHS.P7.cost.b!, g: 0 };
    at(g, 'build-fabricator');
    clearHistory();
    return { g, m, murk, ink, ember, emberLab, glint2, glintLab };
  };

  it('a line that is done when its goal comes up is not shown, ticked, and is not counted', () => {
    const { g, m, ink } = board();
    // No Circuit is studied on this board: "cut the wire from the Circuit Assembler to the Lab" is done already.
    expect(lineOf('cut-glyph').done(g)).toBe(true);
    expect(g.goalAt!.had).toEqual(['cut-glyph']);
    // The card shows the tune-up, as the only line: no "2 of 2".
    const v = goalView(g)!.meanwhile!;
    expect(v).toEqual({ text: 'The Oil Drill outruns its Refiner: buy Speed on the Refiner (32¢).', done: false });
    expect(meanwhileAt(g)).toMatchObject({ step: 1, of: 1 });
    // The game notes it by itself when the goal comes up (a save from before this was kept: on its first tick).
    delete g.goalAt!.had;
    // (And before that tick the card reads the same: it is drawn once before it, and keeps the count it first read.)
    expect(meanwhileAt(g)).toMatchObject({ step: 1, of: 1 });
    run(g, 0.05);
    expect(g.goalAt!.had).toEqual(['cut-glyph']);
    expect(deserialize(serialize(g))!.goalAt!.had).toEqual(['cut-glyph']);
    // Where the Circuit is still studied, that line is first of two, and the tune-up second.
    const glyph = placeNode(g, 'assembler', 700, 300, { recipe: 'glyph' })!;
    connect(g, glyph.id, 0, m.id);
    const wire = connect(g, glyph.id, 0, g.nodes.find((n) => n.type === 'lab')!.id)!;
    g.credits = 2000;
    run(g, 0.05); // (undone: it is a line like any other again)
    expect(g.goalAt!.had).toEqual([]);
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['cut-glyph'].mouse, done: false, step: 1, of: 2 });
    expect(cutWire(g, wire.id)).toBe(true);
    expect(goalView(g)!.meanwhile).toMatchObject({ done: false, step: 2, of: 2 });
    expect(lineAdvice(g)).toMatchObject({ upgrade: 'speed', node: ink.id });
    // The same on the other cards: "Make and sell Silicon" with the second expansion done reads "1 of 2" (see above),
    // and "Make your first Phone" with the Screen wired shows the Circuit line alone (see below).
    clearHistory();
  });

  it('a Drill that outruns the one machine it feeds: a level of Speed on that machine, given past the reserve while it pays', () => {
    const { g, murk, ink } = board();
    expect(meanwhileOf(g)!.id).toBe('tune-up');
    const a = lineAdvice(g)!;
    checkStep(a, 'the tune-up');
    expect(a).toMatchObject({ kind: 'credits', upgrade: 'speed', node: ink.id, culprit: murk.id, cost: 32 });
    expect(a.text.mouse).toBe('The Oil Drill outruns its Refiner: buy Speed on the Refiner (32¢).');
    // The card reads the step's own sentence, the same for a finger, and has nothing to save for: the Fabricator's
    // whole price is still to come (the reserve would hold any step that costs credits), and the step is given.
    expect(goalView(g, true)!.meanwhile).toEqual({ text: a.text.mouse, done: false });
    expect(g.credits).toBeLessThan(PRICE());
    expect(goalFocus(g)).toEqual([murk.id, ink.id]);
    expect(applyAdvice(g, a)).toBe(true);
    expect(ink.lv.speed).toBe(1);
    // The Refiner now takes 1.18 of the Drill's 1.25: nothing is outrun. What is left of the line (the Drills that
    // only feed Labs) waits for Fabrication's α: until that is in hand the card leaves the line out, unticked.
    expect(outrun(g)).toEqual({ labs: null, level: null });
    expect(goalView(g)!.meanwhile).toBeUndefined();
    expect(lineAdvice(g)).toBeNull();
    clearHistory();
  });

  it('then a Refiner from each Drill that only feeds a Lab, its product wired to the Market: the dearest first, and ticked when none is left', () => {
    const { g, m, ember, glint2 } = board();
    g.data.a = TECHS.P7.cost.a!;
    expect(applyAdvice(g, lineAdvice(g)!)).toBe(true); // the level of Speed
    // The card reads each step's own sentence.
    let a = lineAdvice(g)!;
    expect(goalView(g)!.meanwhile).toEqual({ text: a.text.mouse, done: false });
    checkStep(a, 'the tune-up');
    expect(a).toMatchObject({ kind: 'credits', build: 'refiner', node: ember.id, port: 0, recipe: 'spark', cost: nodeCost(g, 'refiner') });
    expect(a.text.mouse).toBe(`Build a Refiner from the Ore Drill's port (${nodeCost(g, 'refiner')}¢): its Copper sells for 6¢ each.`);
    expect(applyAdvice(g, a)).toBe(true);
    const spark = g.nodes.find((n) => n.recipe === 'spark')!;
    expect(g.wires.some((w) => w.from === ember.id && w.to === spark.id)).toBe(true);
    // Its product first: a Refiner is never left with nowhere to send what it makes.
    a = lineAdvice(g)!;
    checkStep(a, 'the tune-up');
    expect(a).toMatchObject({ wire: { from: spark.id, to: m.id, port: 0 }, cost: 0 });
    expect(a.text.mouse).toBe('Wire the Copper Refiner\'s port to the Market: its Copper is not sold (6¢ each).');
    expect(goalView(g)!.meanwhile).toEqual({ text: a.text.mouse, done: false });
    expect(applyAdvice(g, a)).toBe(true);
    // Then the next Drill, the same two gestures.
    a = lineAdvice(g)!;
    expect(a).toMatchObject({ build: 'refiner', node: glint2.id, port: 0, recipe: 'shard' });
    expect(a.text.mouse).toMatch(/^Build a Refiner from a Sand Drill's port \(\d+¢\): its Glass sells for 3¢ each\.$/);
    expect(applyAdvice(g, a)).toBe(true);
    a = lineAdvice(g)!;
    expect(a.text.mouse).toBe('Wire a Glass Refiner\'s port to the Market: its Glass is not sold (3¢ each).');
    expect(applyAdvice(g, a)).toBe(true);
    // No Drill is left that only feeds a Lab: done, ticked, in the line's own words.
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['tune-up'].mouse, done: true });
    expect(lineAdvice(g)).toBeNull();
    // The Labs are still wired, and get what the Refiners leave (machines are fed first).
    expect(g.wires.filter((w) => g.nodes.find((n) => n.id === w.to)!.type === 'lab').length).toBe(2);
    // Nothing raw was wired to the Market for it, and nothing it sells is over its demand.
    run(g, 40);
    for (const mat of ['spark', 'shard', 'ink'] as const) expect(g.soldRate[mat] ?? 0, mat).toBeLessThanOrEqual(demandRate(g, mat));
    expect(g.seenSurplus).toBe(false);
    clearHistory();
  });

  it('a Plastic Refiner built for it gets its Plastic sold and a Dump for its Tar; a Drill whose product the Markets would not buy is left alone', () => {
    const { g, m, ember, glint2, emberLab } = board();
    g.data.a = TECHS.P7.cost.a!;
    expect(applyAdvice(g, lineAdvice(g)!)).toBe(true); // the level of Speed
    // Copper already sells at its demand: no Refiner is asked for on the Ore Drill. The Sand Drill comes instead.
    g.soldRate.spark = demandRate(g, 'spark');
    expect(refineNext(g)).toMatchObject({ well: glint2, out: 'shard' });
    delete g.soldRate.spark;
    // A second Oil Drill that only feeds a Lab (the board's first expansion brings the deposit).
    expect(expandBoard(g)).toBe(true);
    const dep = g.deposits.find((d) => d.mat === 'murk' && !g.nodes.some((n) => n.depositId === d.id))!;
    const murk2 = placeNode(g, 'well', dep.x, dep.y, { depositId: dep.id })!;
    connect(g, murk2.id, 0, emberLab.id);
    g.credits = 2000;
    // Ore first (Copper is the dearest), then Oil (Plastic), then Sand (Glass).
    const order: string[] = [];
    for (let i = 0; i < 12 && !lineOf('tune-up').done(g); i++) {
      const a = lineAdvice(g)!;
      checkStep(a, 'the tune-up');
      order.push(a.text.mouse.replace(/\d+¢/g, 'N¢'));
      expect(applyAdvice(g, a)).toBe(true);
    }
    expect(order).toEqual([
      'Build a Refiner from the Ore Drill\'s port (N¢): its Copper sells for N¢ each.',
      'Wire the Copper Refiner\'s port to the Market: its Copper is not sold (N¢ each).',
      'Build a Refiner from an Oil Drill\'s port (N¢): its Plastic sells for N¢ each.',
      'Wire a Refiner\'s Plastic port to the Market: its Plastic is not sold (N¢ each).',
      'Build a Dump from a Refiner\'s Tar port: it stops when its Tar piles up.',
      'Build a Refiner from a Sand Drill\'s port (N¢): its Glass sells for N¢ each.',
      'Wire a Glass Refiner\'s port to the Market: its Glass is not sold (N¢ each).',
      // Then the deposit that stands free (the plot brought a Sand deposit too): a Drill, its Refiner, and the wire.
      'Place a Drill on the free Sand deposit (N¢), then build a Refiner from it.',
      'Build a Refiner from a Sand Drill\'s port (N¢): its Glass sells for N¢ each.',
      'Wire a Glass Refiner\'s port to the Market: its Glass is not sold (N¢ each).',
    ]);
    // While the Dump is the step, the card reads that sentence; the Dump is free.
    expect(g.nodes.filter((n) => n.type === 'void').length).toBe(2);
    // A Drill too slow to keep a Refiner flowing is not asked for one (an Ore Drill at no level gives 0.8 of the 1 it takes).
    ember.lv.speed = 0;
    const h = board();
    h.ember.lv.speed = 0;
    h.g.rev++;
    expect(refineNext(h.g)).toMatchObject({ well: h.glint2 });
    clearHistory();
    void m;
  });

  it('where Drills outrun their Labs and Lab Speed is not researched, that research is the step, from the α Fabrication does not need', () => {
    const { g, glint2 } = board();
    g.techs = g.techs.filter((t) => t !== 'R2' && t !== 'R3');
    upgrade(g, glint2.id, 'speed');
    upgrade(g, glint2.id, 'speed'); // 1.56 a second into a Lab that studies 1
    g.credits = 2000;
    run(g, 5);
    expect(outrun(g).labs).toMatchObject({ n: glint2, research: 'R2' });
    // Fabrication's 720α come first: without 50α over them the research is not asked for (the level of Speed is).
    g.data.a = TECHS.P7.cost.a! + TECHS.R2.cost.a! - 1;
    expect(lineAdvice(g)).toMatchObject({ upgrade: 'speed' });
    g.data.a += 1;
    const a = lineAdvice(g)!;
    checkStep(a, 'the tune-up');
    expect(a).toMatchObject({ research: 'R2', cost: 0, culprit: glint2.id });
    expect(a.text.mouse).toBe('Your Drills outrun their Labs: research Lab Speed (50α) and they flow again.');
    expect(goalView(g)!.meanwhile).toEqual({ text: a.text.mouse, done: false });
    expect(applyAdvice(g, a)).toBe(true);
    expect(g.techs).toContain('R2');
    expect(outrun(g).labs).toBeNull();
    clearHistory();
  });

  it('a step is only said while it pays for itself before the Fabricator can be bought; then the line leaves, and does not come back', () => {
    // The price nearly in hand: nothing can pay for itself in the seconds left. No line, no step, nothing "saved for".
    const near = board(PRICE() - 20, TECHS.P7.cost.a!);
    expect(goalView(near.g)!.meanwhile).toBeUndefined();
    expect(lineAdvice(near.g)).toBeNull();
    expect(tuneState(near.g)).toBe('none');
    // The price in hand: the same (and the card asks for the Fabricator).
    near.g.credits = PRICE();
    expect(goalView(near.g)!.meanwhile).toBeUndefined();

    // On offer, and then the credits come in (an order's pay, say): the step stays through ADVICE.lineHold seconds,
    // then the line leaves the card, unticked: nothing of it was done.
    const { g } = board();
    g.data.a = TECHS.P7.cost.a!;
    expect(lineAdvice(g)).toMatchObject({ upgrade: 'speed' });
    g.credits = PRICE() - 20;
    expect(lineAdvice(g), 'the dwell').toMatchObject({ upgrade: 'speed' });
    for (let t = 0; t < ADVICE.lineHold + 2; t++) {
      run(g, 1);
      g.credits = PRICE() - 20;
      goalView(g);
    }
    expect(goalView(g)!.meanwhile).toBeUndefined();
    expect(lineAdvice(g)).toBeNull();
    expect(tuneState(g)).toBe('none');
    // That kind of step does not come back when the seconds left grow again (credits spent elsewhere): it is shut
    // for this goal. (The other kind, a Refiner on a Lab's Drill, was never on offer here, and still may be.)
    g.credits = 2000;
    run(g, 1);
    expect(lineAdvice(g)).toMatchObject({ build: 'refiner' });
    expect(outrun(g).level).not.toBeNull();
    // (It is remembered beside the game, not in it: a copy, or the save loaded again, looks afresh.)
    expect(lineAdvice(cloneGame(g)!)).toMatchObject({ upgrade: 'speed' });

    // With a step of it done, the same moment ticks the line instead: "nothing else pays for itself".
    const k = board().g;
    k.data.a = TECHS.P7.cost.a!;
    expect(applyAdvice(k, lineAdvice(k)!)).toBe(true); // the level of Speed
    expect(lineAdvice(k)).toMatchObject({ build: 'refiner' });
    k.credits = PRICE() - 20;
    for (let t = 0; t < ADVICE.lineHold + 2; t++) {
      run(k, 1);
      k.credits = PRICE() - 20;
      goalView(k);
    }
    expect(goalView(k)!.meanwhile).toEqual({ text: TEXT['tune-up'].mouse, done: true });
    expect(lineAdvice(k)).toBeNull();
    k.credits = 2000;
    run(k, 1);
    expect(goalView(k)!.meanwhile).toEqual({ text: TEXT['tune-up'].mouse, done: true });
    clearHistory();
  });

  it('the payback, in numbers: what a step brings in, times three quarters of the seconds left less its lead, against its price', () => {
    const { g } = board();
    g.data.a = TECHS.P7.cost.a!;
    expect(ADVICE.payShare).toBe(0.75);
    expect(ADVICE.payLead).toEqual({ speed: 4, build: 14 });
    expect(applyAdvice(g, lineAdvice(g)!)).toBe(true);
    // A Refiner on the Ore Drill: 0.5 Copper a second at 6¢ is 3¢ a second (no Flow bonus on this board), for 66¢.
    const cost = nodeCost(g, 'refiner');
    expect(cost).toBe(66);
    const rate = g.creditRate;
    expect(rate).toBeGreaterThan(1);
    // It pays when 3 × (0.75 × left − 14) ≥ 66: with 48 s or more left at the income of the moment.
    const leftNeeded = (cost / 3 + 14) / 0.75;
    for (const [left, given] of [[leftNeeded + 4, true], [leftNeeded - 4, false]] as const) {
      const h = cloneGame(g)!;
      h.credits = PRICE() - left * h.creditRate;
      expect(!!lineAdvice(h), `${left.toFixed(0)} s left`).toBe(given);
    }
    clearHistory();
  });
});

describe('"Build a Fabricator": the tune-up in whole runs of the pacing tool\'s card-only player', () => {
  const FAB = GOALS.findIndex((x) => x.id === 'build-fabricator');
  /** The real game from this board until the Fabricator's price is in hand: nobody plays, orders are claimed `lag` s after they fill. `first`: a step to do at once, and then the free gestures that finish it, six seconds apart. */
  const priceIn = (from: Game, lag: number, first: Advice | null) => {
    const g = cloneGame(from)!;
    const need = nodeCost(g, 'fabricator');
    let next = 0;
    if (first) {
      expect(applyAdvice(g, first), first.text.mouse).toBe(true);
      next = 6;
    }
    let ready: number | null = null;
    let t = 0;
    while (t < 600 && g.credits < need) {
      run(g, 0.05);
      t += 0.05;
      g.events.length = 0;
      if (g.order?.ready) {
        ready ??= t;
        if (t - ready >= lag) {
          claimOrder(g);
          ready = null;
        }
      } else ready = null;
      if (first && t >= next) {
        const a = tuneState(g) === 'open' ? lineAdvice(g) : null;
        // What the step still lacks is carried out: a wire, a Dump, and for a Drill placed on a free deposit the
        // Refiner from its port (the two were given as one decision).
        const second = !!a && first.build === 'well' && a.build === 'refiner' && g.nodes.find((n) => n.id === a.node)?.depositId === first.deposit;
        if (a && ((!a.cost && !a.research && !a.upgrade) || second) && applyAdvice(g, a)) next = t + 6;
      }
    }
    return t;
  };

  it('claiming late or at once: every paid step is honest, the card never blinks, nothing is shown already ticked, and nothing sells over demand', () => {
    const report: string[] = [];
    for (const delay of [[8, 16], [1, 3]] as [number, number][]) {
      for (const seed of [0, 1, 2, 3]) {
        const who = `claiming ${delay.join('–')} s late, seed ${seed}`;
        const bot = new Bot({ ...POLICIES.cardonly, claimDelay: delay }, seed, 45);
        const gains: number[] = [];
        let steps = 0;
        let lastStep = '';
        const step = bot.lineStep.bind(bot);
        bot.lineStep = () => {
          const want = step();
          const g = bot.g;
          if (!want || g.goal.i !== FAB || g.time < bot.freeAt || want.cost > g.credits || meanwhileOf(g)?.id !== 'tune-up') return want;
          const key = `${g.time.toFixed(2)}|${want.label}`;
          if (key === lastStep) return want;
          lastStep = key;
          steps++;
          const a = lineAdvice(g)!;
          // A step that costs credits is a decision: the Fabricator's price must not be later for it, in the real game.
          if (a.cost) gains.push(priceIn(g, delay[0] + 4, null) - priceIn(g, delay[0] + 4, a));
          return want;
        };
        // The card, looked at on every tick of every goal, as the page looks at it.
        const undone = new Set<string>();
        const bad: string[] = [];
        let shown: { key: string; rev: number } | null = null;
        let gone: { key: string; rev: number; at: number } | null = null;
        let blinks = 0;
        const note = bot.noteNothing.bind(bot);
        bot.noteNothing = () => {
          note();
          const g = bot.g;
          const v = goalView(g)?.meanwhile;
          const line = meanwhileOf(g);
          if (!v || !line) {
            if (shown && shown.key !== '-') gone = { ...shown, at: g.time };
            shown = { key: '-', rev: g.rev };
            return;
          }
          const id = `${g.goal.i}/${line.id}`;
          const a = lineAdvice(g);
          if (!v.done) undone.add(id);
          // Ticked: only a line the card has shown undone on this goal. Undone: a Show me, or what it is saving for.
          // (Or one whose step this player took on the very tick it came up: the Flow goal's, for whoever claims at once.)
          else if (!undone.has(id) && !bot.linesBegun.has(`${activeGoal(g)!.id}/${line.id}`)) bad.push(`${id} shown already ticked at ${Math.round(g.time)} s`);
          // (A growth goal's line has no step while what was built last comes up to speed: the count on the card is the reason.)
          if (!v.done && !a && !v.held && !line.way) bad.push(`${id} up with no step and no reason at ${Math.round(g.time)} s`);
          if (g.goal.i !== FAB) return;
          const key = `${v.text}|${v.done ? 'done' : 'step'}`;
          if (shown && shown.key !== key && shown.rev === g.rev && gone && gone.key === key && gone.rev === g.rev && g.time - gone.at < 30) blinks++;
          if (shown && shown.key !== key) gone = { ...shown, at: g.time };
          shown = { key, rev: g.rev };
        };
        bot.run();
        expect(bot.g.ended, who).toBe(true);
        expect(bad, `${who}: ${bad.slice(0, 3).join('; ')}`).toEqual([]);
        expect(blinks, `${who}: a step given, taken back and given again on an untouched board`).toBe(0);
        // The line was followed: two levels of Speed, a Refiner or two with their wires.
        expect(steps, `${who}: steps of the tune-up`).toBeGreaterThanOrEqual(4);
        expect(gains.length, who).toBeGreaterThanOrEqual(3);
        for (const x of gains) expect(x, `${who}: seconds a paid step brought the Fabricator's price nearer`).toBeGreaterThanOrEqual(-0.5);
        // Nothing over its demand before the Phone (the tool's own check for this player, here for the eager one too).
        expect(bot.surplusAt == null || bot.surplusAt.t >= (bot.madeAt.lens ?? Infinity), `${who}: first sale over demand`).toBe(true);
        const nothing = bot.nothing.perGoal[FAB] ?? 0;
        const stretch = bot.nothing.stretches.filter((x) => x.goal === FAB).reduce((m, x) => Math.max(m, x.to - x.from), 0);
        report.push(`${who}: ${steps} steps, paid ones ${gains.map((x) => x.toFixed(1)).join(', ')} s sooner; nothing to do on the goal ${Math.round(nothing)} s, ${Math.round(stretch)} s at a stretch`);
        // The save for the Fabricator is the one long wait of the demo (three minutes at 8,500¢): under two minutes of it
        // with nothing to do, for the player who claims at once too, and no stretch over a minute.
        expect(nothing, `${who}: nothing to do on "Build a Fabricator"`).toBeLessThanOrEqual(120);
        expect(stretch, `${who}: longest stretch of it`).toBeLessThanOrEqual(60);
        clearHistory();
      }
    }
    console.info(`the tune-up, on the pacing tool's card-only player:\n  ${report.join('\n  ')}`);
  }, 600_000);
});

// ---------------------------------------------------------------------------------------------------
// goalFocus(g): the nodes the hint or line is about, on the scripted boards.
// ---------------------------------------------------------------------------------------------------

describe('goalFocus: the nodes the card is about', () => {
  it('on the card player\'s boards, at every goal, every id is a node on the board, and it is the node the hint or line means', () => {
    const seen: Record<string, string[]> = {};
    playByTheCard({
      tendOrders: 'asked',
      onIdle: (g) => {
        const ids = goalFocus(g);
        const goal = activeGoal(g)!;
        for (const id of ids) expect(g.nodes.some((n) => n.id === id), `${goal.id}: ${id}`).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
        const kinds = ids.map((id) => {
          const n = g.nodes.find((x) => x.id === id)!;
          return n.recipe ? `${n.type}:${n.recipe}` : n.material ? `${n.type}:${n.material}` : n.type;
        }).join(' ');
        // Keyed by the line on the card, if one is up and not done (the focus is then the line's).
        const line = meanwhileOf(g);
        const key = `${goal.id}${line && !line.done(g) ? '/' + line.id : ''}`;
        if (!(seen[key] ??= []).includes(kinds)) seen[key].push(kinds);
      },
    });
    clearHistory();
    console.info(`goalFocus on the card player's boards:\n  ${Object.entries(seen).map(([id, k]) => `${id}: ${k.join(' | ')}`).join('\n  ')}`);
    // What each card names, among what it showed while the player waited.
    expect(seen['grow-shard/grow-shard']).toContain('well:glint'); // a Refiner from the port of the Sand Drill that only sells
    expect(seen['grow-shard/grow-shard']).toContain('refiner:shard market'); // its Glass to the Market
    expect(seen['tune-shard/tune-shard']).toContain('refiner:shard'); // Speed on a Refiner
    expect(seen['tune-shard/tune-shard']).toContain('refiner:shard well:glint'); // the Refiner that waits, and the Drill that feeds it
    expect(seen['grow-ink/grow-ink']).toContain(''); // the board's next plot, and a Drill on its deposit: no node yet
    expect(seen['grow-ink/grow-ink']).toContain('refiner:ink void'); // the new Refiner's Tar to the Dump
    expect(seen['grow-glyph/grow-glyph'].some((k) => /^refiner:ink$/.test(k))).toBe(true); // an Assembler from a Plastic port
    if (seen['hold-flow/flow-fix']) expect(seen['hold-flow/flow-fix']).toContain('refiner:spark well:ember');
    for (const key of ['make-prism/cut-glyph', 'build-fabricator/cut-glyph']) if (seen[key]) expect(seen[key]).toContain('assembler:glyph lab');
    expect(seen['make-prism/cut-glyph'] ?? seen['build-fabricator/cut-glyph'], 'the cut came up on one of the two').toBeDefined();
  });

  it('the hints, by goal: the port the card names, and where it goes', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3'];
    const m = market(g);
    const w = well(g);
    at(g, 'wire-market');
    expect(goalFocus(g)).toEqual([w.id, m.id]);
    connect(g, w.id, 0, m.id);
    at(g, 'build-refiner');
    expect(goalFocus(g)).toEqual([w.id]);
    const shard = placeNode(g, 'refiner', 300, 100, { recipe: 'shard' })!;
    connect(g, w.id, 0, shard.id);
    at(g, 'sell-shard');
    expect(goalFocus(g)).toEqual([shard.id, m.id]);
    at(g, 'feed-lab');
    expect(goalFocus(g)).toEqual([shard.id]); // "Drag from a Refiner's port into empty space and pick Lab"
    at(g, 'make-ink');
    expect(goalFocus(g)).toEqual([]); // the Drill goes on a deposit: no node yet
    const mw = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    expect(goalFocus(g)).toEqual([mw.id]); // "...then drag from its port and pick Refiner"
    const ink = placeNode(g, 'refiner', 400, 400, { recipe: 'ink' })!;
    connect(g, mw.id, 0, ink.id);
    at(g, 'silt-exit');
    expect(goalFocus(g)).toEqual([ink.id, m.id]);
    connect(g, ink.id, 0, m.id);
    expect(goalFocus(g)).toEqual([ink.id]); // "...then drag from the second port and pick Dump"
    // A growth goal: the nodes of its line's next step (here the Glass Refiner whose Glass is not sold, and the Market).
    at(g, 'grow-shard');
    expect(goalFocus(g)).toEqual([shard.id, m.id]);
    at(g, 'bulk-upgrade');
    expect(goalFocus(g)).toEqual([w.id]);
    // Ready to claim: nothing.
    g.goal.ready = true;
    expect(goalFocus(g)).toEqual([]);
    clearHistory();
  });
});

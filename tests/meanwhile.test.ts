// The goal cards' "while you wait" lines (Goal.meanwhile in src/goals.ts): what they say, when they show,
// that each is true on the board a card-following player has, and that nothing later undoes them.
import { describe, expect, it } from 'vitest';
import { claimGoal, clearHistory, connect, cutWire, expandBoard, favour, freeDeposits, placeNode } from '../src/actions';
import { Advice, advice, adviceTrials, applyAdvice, lineAdvice } from '../src/advice';
import { RULES, TECHS } from '../src/content';
import { expansionCost, nodeCost } from '../src/economy';
import { GOALS, MAIN_GOALS, activeGoal, goalById, goalView, meanwhileOf } from '../src/goals';
import { Game, cloneGame, serialize } from '../src/state';
import { Bot, CFG, POLICIES } from '../tools/pacing';
import { followMeanwhile, playByTheCard } from './cardPlayer';
import { fresh, market, realWaitEnds, rich, run, well } from './helpers';

const at = (g: Game, id: string) => { g.goal = { i: GOALS.findIndex((x) => x.id === id), ready: false }; };
const typeOf = (g: Game, id: number) => g.nodes.find((n) => n.id === id)?.type;
const wired = (g: Game, recipe: string, type: string) => g.wires.some((w) => g.nodes.find((n) => n.id === w.from)?.recipe === recipe && typeOf(g, w.to) === type);
/** Labs that study what Wells give them and nothing else. */
const wellLabs = (g: Game) => g.nodes.filter((n) => {
  const fed = n.type === 'lab' ? g.wires.filter((w) => w.to === n.id) : [];
  return fed.length > 0 && fed.every((w) => typeOf(g, w.from) === 'well');
}).length;

const LINES: Record<string, { mouse: string; touch: string }> = {
  'make-spark': {
    mouse: 'Drag from the Ink Refiner\'s Ink port to the Lab too: studied Ink is 3 α each.',
    touch: 'Tap the Ink Refiner\'s Ink port, then tap the Lab too: studied Ink is 3 α each.',
  },
  'make-glyph': {
    mouse: 'Give each new deposit a Well and a Lab built from its port: each pair is 1 α a second.',
    touch: 'Give each new deposit a Well and a Lab built from its port: each pair is 1 α a second.',
  },
  'make-mist': {
    mouse: 'Expand the board again, then give a new deposit a Well and a Lab of its own.',
    touch: 'Expand the board again, then give a new deposit a Well and a Lab of its own.',
  },
  'build-fabricator': {
    mouse: 'You have the β you need: cut the wire from the Glyph Assembler to the Lab.',
    touch: 'You have the β you need: cut the wire from the Glyph Assembler to the Lab.',
  },
};

describe('"while you wait": the four lines', () => {
  it('the four goals with a long wait carry one each, and no other goal does; the chain is still 22 and 4', () => {
    expect(GOALS.filter((x) => x.meanwhile).map((x) => x.id)).toEqual(Object.keys(LINES));
    for (const [id, text] of Object.entries(LINES)) expect(goalById(id)!.meanwhile!.text, id).toEqual(text);
    expect(MAIN_GOALS).toBe(22);
    expect(GOALS.length).toBe(26);
  });

  it('each is one sentence of at most 90 characters, and the touch wording names no click, drag or key', () => {
    for (const goal of GOALS) {
      if (!goal.meanwhile) continue;
      for (const text of [goal.meanwhile.text.mouse, goal.meanwhile.text.touch]) {
        expect([...text].length, text).toBeLessThanOrEqual(RULES.tips.maxLength);
        expect([...text].length, text).toBeGreaterThan(30);
        expect(text.endsWith('.'), text).toBe(true);
        expect(text.slice(0, -1), text).not.toMatch(/[.!?] /);
      }
      expect(goal.meanwhile.text.touch, goal.id).not.toMatch(/\b(click|drag|press|key|select)\b/i);
      expect(goal.meanwhile.text.mouse, goal.id).not.toMatch(/\btap\b/i);
    }
  });

  it('the card shows a line only while it applies, in the wording for the input in use, and ticks it off when done', () => {
    // "Make your first Spark": needs an Ink Refiner and a Lab to say "wire the Ink to the Lab".
    const g = rich();
    g.techs = ['P1', 'R1', 'P2'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    at(g, 'make-spark');
    expect(goalView(g)!.meanwhile).toBeUndefined();
    const ink = placeNode(g, 'refiner', 400, 400, { recipe: 'ink' })!;
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 3 })!.id, 0, ink.id);
    connect(g, ink.id, 0, m.id);
    expect(goalView(g)!.meanwhile).toBeUndefined(); // no Lab yet
    const lab = placeNode(g, 'lab', 900, 100)!;
    expect(goalView(g)!.meanwhile).toEqual({ text: LINES['make-spark'].mouse, done: false });
    expect(goalView(g, true)!.meanwhile).toEqual({ text: LINES['make-spark'].touch, done: false });
    connect(g, ink.id, 1, lab.id); // the Silt port is not the Ink port
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    const w = connect(g, ink.id, 0, lab.id)!;
    expect(goalView(g)!.meanwhile).toEqual({ text: LINES['make-spark'].mouse, done: true });
    cutWire(g, w.id);
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    // A goal that is ready to claim shows Claim and nothing else.
    g.made.spark = true;
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
    expect(goalView(g)!.meanwhile).toBeUndefined();
    expect(meanwhileOf(g)).toBeNull();
    // Goals without a line never have one.
    for (const id of ['wire-market', 'research-murk', 'hold-flow', 'study-glyph', 'make-prism', 'make-lens', 'make-clay']) {
      at(g, id);
      expect(goalView(g)!.meanwhile, id).toBeUndefined();
    }
  });

  it('"a Well and a Lab of its own" means just that: a Well wired into a Lab that studies other things does not count', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    const shard = placeNode(g, 'refiner', 400, 100)!;
    connect(g, well(g).id, 0, shard.id);
    const lab = placeNode(g, 'lab', 900, 100)!;
    connect(g, shard.id, 0, lab.id);
    for (const dep of [2, 3, 4]) connect(g, placeNode(g, 'well', 0, 0, { depositId: dep })!.id, 0, m.id);
    at(g, 'make-glyph');
    // No free deposit (the Breeze one is locked): nothing to place a Well on, so the line is not shown.
    expect(goalView(g)!.meanwhile).toBeUndefined();
    expect(expandBoard(g)).toBe(true); // Glint and Murk appear
    expect(goalView(g)!.meanwhile).toEqual({ text: LINES['make-glyph'].mouse, done: false });
    // A raw Well into the Lab that studies Shard: 1 α each, but it takes the Shard's place. Not what the card asks.
    const second = g.nodes.find((n) => n.depositId === 2)!;
    connect(g, second.id, 0, lab.id);
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    // One deposit done: half of it.
    expect(followMeanwhile(g)).toBe(true); // the Well
    expect(goalView(g)!.meanwhile!.done).toBe(false); // (a Well with no wire keeps the line up)
    expect(followMeanwhile(g)).toBe(true); // its Lab
    expect(wellLabs(g)).toBe(1);
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    expect(followMeanwhile(g)).toBe(true);
    expect(followMeanwhile(g)).toBe(true);
    expect(wellLabs(g)).toBe(2);
    expect(goalView(g)!.meanwhile).toEqual({ text: LINES['make-glyph'].mouse, done: true });
    expect(followMeanwhile(g)).toBe(false); // nothing more to do

    // "Make your first Mist": one more pair, on a board that has to grow first. Only until Breeze Deposits is
    // researched: after that the card itself asks for a Well on the Breeze deposit, and the line would get in its way.
    at(g, 'make-mist');
    expect(goalView(g)!.meanwhile).toEqual({ text: LINES['make-mist'].mouse, done: false });
    const expansions = g.board.expansions;
    expect(followMeanwhile(g)).toBe(true);
    expect(g.board.expansions).toBe(expansions + 1);
    expect(followMeanwhile(g)).toBe(true);
    expect(followMeanwhile(g)).toBe(true);
    expect(wellLabs(g)).toBe(3);
    expect(goalView(g)!.meanwhile!.done).toBe(true);
    const h = cloneGame(g)!;
    const extra = h.nodes.filter((n) => n.type === 'lab').pop()!;
    cutWire(h, h.wires.find((w) => w.to === extra.id)!.id);
    expect(goalView(h)!.meanwhile!.done).toBe(false);
    h.techs.push('P5');
    expect(goalView(h)!.meanwhile).toBeUndefined();
    clearHistory();
  });

  it('goal 18\'s line is ticked for the player who does exactly what it says, whatever they did with the line before it', () => {
    // A player who left the first expansion's deposits alone (the Glyph card's line never followed).
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    expect(expandBoard(g)).toBe(true);
    at(g, 'make-mist');
    expect(wellLabs(g)).toBe(0);
    expect(goalView(g)!.meanwhile).toEqual({ text: LINES['make-mist'].mouse, done: false });
    // A Well and a Lab of its own on a deposit of the FIRST expansion is not what this line asks for.
    const first = g.deposits[g.deposits.length - 2];
    const w0 = placeNode(g, 'well', first.x, first.y, { depositId: first.id })!;
    connect(g, w0.id, 0, placeNode(g, 'lab', 900, 500)!.id);
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    // "Expand the board again, then give a new deposit a Well and a Lab of its own."
    expect(expandBoard(g)).toBe(true);
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    const fresh2 = g.deposits[g.deposits.length - 1];
    const w = placeNode(g, 'well', fresh2.x, fresh2.y, { depositId: fresh2.id })!;
    expect(goalView(g)!.meanwhile!.done).toBe(false); // the Well alone
    const lab = placeNode(g, 'lab', 900, 300)!;
    const wire = connect(g, w.id, 0, lab.id)!;
    expect(wellLabs(g)).toBe(2);
    expect(goalView(g)!.meanwhile).toEqual({ text: LINES['make-mist'].mouse, done: true });
    // Its Lab has to be its own: with a Refiner's output wired in as well, it is no longer that.
    const shard = placeNode(g, 'refiner', 400, 100)!;
    connect(g, well(g).id, 0, shard.id);
    const mixed = connect(g, shard.id, 0, lab.id)!;
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    cutWire(g, mixed.id);
    expect(goalView(g)!.meanwhile!.done).toBe(true);
    // Done stays on the card after Breeze Deposits is researched; undone, the line goes then (the card itself asks for a Well).
    g.techs.push('P5');
    expect(goalView(g)!.meanwhile!.done).toBe(true);
    cutWire(g, wire.id);
    expect(goalView(g)!.meanwhile).toBeUndefined();
    clearHistory();
  });

  it('"cut the Glyph wire" is asked only while the β is covered and the Fabricator is not paid for', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'P5'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    const glyph = placeNode(g, 'assembler', 700, 400, { recipe: 'glyph' })!;
    const lab = placeNode(g, 'lab', 900, 100)!;
    connect(g, glyph.id, 0, m.id);
    const w = connect(g, glyph.id, 0, lab.id)!;
    at(g, 'build-fabricator');
    const line = goalById('build-fabricator')!.meanwhile!;
    const need = TECHS.P7.cost.b!;
    // β short: studying Glyph is what the research needs.
    g.credits = 0;
    g.data.b = need - 1;
    expect(goalView(g)!.meanwhile).toBeUndefined();
    expect(line.cuts!(g)).toEqual([]);
    // β covered, credits short: sell it.
    g.data.b = need;
    expect(goalView(g)!.meanwhile).toEqual({ text: LINES['build-fabricator'].mouse, done: false });
    expect(line.cuts!(g)).toEqual([w.id]);
    // The research spends the β: the line stays (Fabrication is owned, nothing else in the demo needs β).
    g.data.b = 0;
    g.techs.push('P7');
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    // The price in hand: nothing would come sooner by selling.
    g.credits = nodeCost(g, 'fabricator');
    expect(goalView(g)!.meanwhile).toBeUndefined();
    expect(line.cuts!(g)).toEqual([]);
    g.credits = 100;
    expect(followMeanwhile(g)).toBe(true);
    expect(g.wires.some((x) => x.id === w.id)).toBe(false);
    expect(goalView(g)!.meanwhile).toEqual({ text: LINES['build-fabricator'].mouse, done: true });
    expect(followMeanwhile(g)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// True, and never undone: on the boards of the scripted card player (tests/cardPlayer.ts).
// ---------------------------------------------------------------------------------------------------

interface Snap { id: string; g: Game; from: string }

/**
 * Plays a run and keeps the board as it stood the first time each line came up undone. On the way, every idle
 * second, lineAdvice(g) is held to its word: no step without a line, none for a line that is done, and a step
 * it does give can be paid for and carried out there and then (`bad` lists every moment that was not so).
 */
function snapshots(name: string, opts: Parameters<typeof playByTheCard>[0]) {
  const snaps: Snap[] = [];
  const bad: string[] = [];
  const seen = { seconds: 0, steps: 0, done: 0, none: 0 };
  const run = playByTheCard({
    ...opts,
    onIdle: (g) => {
      const goal = activeGoal(g)!;
      const line = meanwhileOf(g);
      const step = lineAdvice(g);
      const where = `${name}, ${goal.id} at ${Math.round(g.time)} s`;
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
      if (!line || line.done(g) || snaps.some((s) => s.id === goal.id)) return;
      snaps.push({ id: goal.id, g: cloneGame(g)!, from: where });
    },
  });
  return { run, snaps, bad, seen };
}

/** The tests' card player, with the cards alone and with the tips on four order sequences: played once, used by the blocks below. */
let played: { cards: ReturnType<typeof snapshots>; tips: ReturnType<typeof snapshots>[] } | null = null;
const cardRuns = () => (played ??= {
  cards: snapshots('cards', { tendOrders: 'asked' }),
  tips: [0, 1, 2, 3].map((seed) => snapshots(`cards and tips, seed ${seed}`, { tips: true, seed })),
});

describe('"while you wait": each line is true, and nothing undoes it', () => {
  const { cards, tips } = cardRuns();

  it('every line comes up, in order, for the player who follows the cards, with the tips and without', () => {
    for (const t of [cards, ...tips]) expect(t.snaps.map((s) => s.id)).toEqual(Object.keys(LINES));
  });

  it('doing what the line says ends that goal\'s wait sooner than not doing it, in the real game', () => {
    const report: string[] = [];
    for (const { id, g, from } of [...cards.snaps, ...tips.flatMap((t) => t.snaps)]) {
      const gains: number[] = [];
      // The game's own order sequence, and another: orders pay in lumps, and which one comes next is luck.
      for (let k = 0; k < 2; k++) {
        const done = cloneGame(g)!;
        const left = cloneGame(g)!;
        done.orderSeed = left.orderSeed = (g.orderSeed + k * 7919) >>> 0;
        // Every gesture of the line, as the card player makes them.
        let gestures = 0;
        while (followMeanwhile(done)) gestures++;
        expect(gestures, from).toBeGreaterThanOrEqual(1);
        expect(meanwhileOf(done)!.done(done), from).toBe(true);
        const idle = realWaitEnds(left, 1500, 0.05);
        const withIt = realWaitEnds(done, 1500, 0.05);
        expect(isFinite(idle) && isFinite(withIt), from).toBe(true);
        gains.push(idle - withIt);
      }
      clearHistory();
      report.push(`${from}: ${gains.map((x) => x.toFixed(0)).join(', ')} s sooner`);
      // Sooner under either sequence, and by a good deal on average: these are the structural moves.
      for (const x of gains) expect(x, from).toBeGreaterThan(0);
      expect((gains[0] + gains[1]) / 2, from).toBeGreaterThanOrEqual(id === 'build-fabricator' ? 5 : 15);
    }
    console.info(`"while you wait" lines, seconds each ends its wait sooner (two order sequences):\n  ${report.join('\n  ')}`);
  });

  it('what a line asked for is still there at the first Lens, and no tip ever went against one', () => {
    for (const { run } of [cards, ...tips]) {
      const g = run.g;
      expect(wired(g, 'ink', 'lab'), 'Ink is still studied').toBe(true); // goal 11's line
      expect(wellLabs(g), 'three Wells with a Lab each').toBe(3); // goals 15 and 18
      expect(g.board.expansions).toBe(2);
      expect(wired(g, 'glyph', 'lab'), 'Glyph is no longer studied').toBe(false); // goal 21's line
      for (const t of run.tips) {
        expect(t.text, t.text).not.toMatch(/^(Cut|Remove) /);
        expect(t.text, t.text).not.toMatch(/^Favour /);
        if (t.goal === 'build-fabricator' || t.goal === 'make-lens') expect(t.text, t.text).not.toMatch(/Glyph Assembler's port to (the|a) Lab/);
      }
    }
    // The Router of "Route more to a Lab" hangs on the Spark Refiner, as that card now says, and still favours the Lab.
    expect(goalById('route-lab')!.hint.mouse).toContain('Build a Router from the Spark Refiner\'s port');
    expect(goalById('route-lab')!.hint.touch).toContain('Build a Router from the Spark Refiner\'s port');
    for (const { run } of [cards, ...tips]) {
      const router = run.g.nodes.find((n) => n.type === 'router')!;
      expect(run.g.nodes.find((n) => n.id === run.g.wires.find((w) => w.to === router.id)!.from)!.recipe).toBe('spark');
    }
  });

  it('a card that asks for a wire to go is the only thing that ever takes one away: the adviser has nothing to add once it is done', () => {
    for (const t of tips) {
      const snap = t.snaps.find((s) => s.id === 'build-fabricator')!;
      const g = cloneGame(snap.g)!;
      expect(followMeanwhile(g)).toBe(true);
      run(g, 25);
      const a = advice(g);
      expect(a?.cut).toBeUndefined();
      if (a?.wire) expect(g.nodes.find((n) => n.id === a.wire!.from)!.recipe).not.toBe('glyph');
    }
    clearHistory();
    // The goal after the Fabricator wires Glyph into it: claimable as ever.
    const g = fresh();
    expect(claimGoal(g)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// True for the players the pacing is judged by, too (tools/pacing.ts): the card-only player, who never takes
// a tip, and the newcomer, who takes them. Their boards are not the boards above: they claim 8 to 16 s late,
// which shifts what each wait is for. (At 900 α for Fabrication the card-only player had the Fabricator's
// price in hand before the research on every seed, and the last line was worth nothing to them.)
// ---------------------------------------------------------------------------------------------------

describe('"while you wait": true for the pacing tool\'s card players', () => {
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
  /** Seconds a run spent on a goal: from the claim before it to its own. */
  const spent = (bot: Bot, id: string) => {
    const i = GOALS.findIndex((x) => x.id === id);
    return bot.goalClaimedAt[id] - bot.goalClaimedAt[GOALS[i - 1].id];
  };

  it('the card-only player who leaves one line out spends longer on that goal (goals 11, 15 and 18)', () => {
    const report: string[] = [];
    for (const seed of SEEDS) {
      const plain = play('cardonly', seed);
      expect(plain.g.ended).toBe(true);
      for (const [id, atLeast] of [['make-spark', 60], ['make-glyph', 60], ['make-mist', 10]] as const) {
        const without = play('cardonly', seed, [id]);
        expect(without.g.ended, `seed ${seed}, without the line of ${id}`).toBe(true);
        const gain = spent(without, id) - spent(plain, id);
        report.push(`seed ${seed} ${id}: ${Math.round(spent(plain, id))} s with the line, ${Math.round(spent(without, id))} s without`);
        expect(gain, `seed ${seed}: ${id}`).toBeGreaterThanOrEqual(atLeast);
        // And the whole demo is longer for it.
        expect(without.g.stats.firstLensAt!, `seed ${seed}: ${id}`).toBeGreaterThan(plain.g.stats.firstLensAt!);
      }
    }
    console.info(`the card-only player of the pacing tool, each line left out in turn:\n  ${report.join('\n  ')}`);
  });

  it('the Fabricator line: on the board each of them has when it comes up, the wait ends sooner with the wire gone', () => {
    const report: string[] = [];
    for (const policy of ['cardonly', 'newcomer']) {
      for (const seed of SEEDS) {
        let snap: Game | null = null;
        play(policy, seed, [], (g, goal) => {
          if (goal === 'build-fabricator') snap = cloneGame(g);
        });
        expect(snap, `${policy}/${seed}: the line came up`).not.toBeNull();
        const g: Game = snap!;
        const gains: number[] = [];
        // The game's own order sequence, and another.
        for (let k = 0; k < 2; k++) {
          const done = cloneGame(g)!;
          const left = cloneGame(g)!;
          done.orderSeed = left.orderSeed = (g.orderSeed + k * 7919) >>> 0;
          expect(followMeanwhile(done)).toBe(true);
          expect(meanwhileOf(done)!.done(done)).toBe(true);
          const idle = realWaitEnds(left, 1500, 0.05);
          const withIt = realWaitEnds(done, 1500, 0.05);
          expect(isFinite(idle) && isFinite(withIt)).toBe(true);
          gains.push(idle - withIt);
        }
        clearHistory();
        report.push(`${policy}/${seed}: ${gains.map((x) => x.toFixed(0)).join(', ')} s sooner`);
        for (const x of gains) expect(x, `${policy}/${seed}`).toBeGreaterThan(0);
        expect((gains[0] + gains[1]) / 2, `${policy}/${seed}`).toBeGreaterThanOrEqual(5);
      }
    }
    console.info(`the Fabricator line on the pacing tool's boards (two order sequences):\n  ${report.join('\n  ')}`);
  });
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
  // Exactly one thing to do.
  expect([a.wire, a.build, a.cut, a.expand].filter((x) => x != null).length, from).toBe(1);
  expect(a.upgrade ?? a.favour ?? a.research ?? a.to, from).toBeUndefined();
}

/** What is on the board, without ids or places: node kinds and what is wired to what. */
const shape = (g: Game) => {
  const kind = (id: number) => {
    const n = g.nodes.find((x) => x.id === id)!;
    return `${n.type}${n.recipe ? ':' + n.recipe : ''}${n.material ? ':' + n.material : ''}`;
  };
  return {
    nodes: g.nodes.map((n) => kind(n.id)).sort(),
    wires: g.wires.map((w) => `${kind(w.from)}/${w.port}>${kind(w.to)}`).sort(),
    expansions: g.board.expansions,
  };
};

/** The most steps a line can take: one wire; two Wells and two Labs; the board, a Well and a Lab; one wire. */
const MOST: Record<string, number> = { 'make-spark': 1, 'make-glyph': 4, 'make-mist': 3, 'build-fabricator': 1 };

/**
 * Follow lineAdvice from this board until the line is done: every step it gives is checked and carried out,
 * and while it gives none the game runs on (nobody plays: the step is waiting for credits). Returns the steps.
 */
function followSteps(g: Game, from: string): Advice[] {
  const steps: Advice[] = [];
  const id = activeGoal(g)!.id;
  let waited = 0;
  for (;;) {
    const line = meanwhileOf(g);
    expect(line, `${from}: the line stays on the card while it is followed`).not.toBeNull();
    if (line!.done(g)) break;
    const a = lineAdvice(g);
    if (!a) {
      run(g, 1);
      expect(++waited, `${from}: no step for ten minutes`).toBeLessThan(600);
      expect(activeGoal(g)!.id).toBe(id);
      continue;
    }
    checkStep(a, from);
    expect(a.cost ?? 0, `${from}: affordable when given: ${a.text.mouse}`).toBeLessThanOrEqual(g.credits + 1e-6);
    const before = { nodes: g.nodes.length, wires: g.wires.length, expansions: g.board.expansions, credits: g.credits };
    expect(applyAdvice(g, a), `${from}: doable when given: ${a.text.mouse}`).toBe(true);
    // It did what it said, and nothing else.
    expect(g.board.expansions - before.expansions).toBe(a.expand ? 1 : 0);
    expect(g.nodes.length - before.nodes).toBe(a.build ? 1 : 0);
    expect(g.wires.length - before.wires).toBe(a.wire ? 1 : a.cut ? -1 : a.build === 'lab' ? 1 : 0);
    expect(before.credits - g.credits).toBeCloseTo(a.cost ?? 0, 6);
    steps.push(a);
    expect(steps.length, `${from}: ${steps.map((x) => x.text.mouse).join(' / ')}`).toBeLessThanOrEqual(MOST[id]);
  }
  // Done: there is no further step, and the card ticks the line.
  expect(lineAdvice(g), from).toBeNull();
  expect(goalView(g)!.meanwhile!.done, from).toBe(true);
  return steps;
}

describe('lineAdvice: the next step of the card\'s line, for its "Show me"', () => {
  const SEEDS = [0, 1, 2, 3];
  /** The boards of the pacing tool's card players at the moment each began a line. */
  const pacingBoards = (policy: string, seed: number): Snap[] => {
    const snaps: Snap[] = [];
    CFG.onLine = (g, goal) => snaps.push({ id: goal, g: cloneGame(g)!, from: `pacing ${policy}/${seed}, ${goal} at ${Math.round(g.time)} s` });
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
    ...SEEDS.flatMap((seed) => [...pacingBoards('cardonly', seed), ...pacingBoards('newcomer', seed)]),
  ];

  it('the boards are the card players\' own: all four lines, from the tests\' player and from the pacing tool\'s, on seeds 0 to 3', () => {
    expect(boards.length).toBe(4 * (1 + 4 + 4 + 4));
    for (const id of Object.keys(LINES)) expect(boards.filter((b) => b.id === id).length, id).toBe(13);
    for (const b of boards) {
      expect(activeGoal(b.g)!.id, b.from).toBe(b.id);
      expect(meanwhileOf(b.g)!.done(b.g), b.from).toBe(false);
    }
  });

  it('followed one step at a time (the game running until each can be paid for), every line ends done, in a bounded number of steps', () => {
    const report: Record<string, Set<string>> = {};
    for (const { id, g, from } of boards) {
      const h = cloneGame(g)!;
      const steps = followSteps(h, from);
      expect(steps.length, from).toBeGreaterThanOrEqual(1);
      expect(steps.length, from).toBe(MOST[id]); // on these boards each line takes all its steps
      (report[id] ??= new Set()).add(steps.map((a) => a.text.mouse.replace(/\d+¢/g, 'N¢')).join('  →  '));
      // What it leads to is what the scripted players do when they read the line themselves.
      const read = cloneGame(g)!;
      let waited = 0;
      while (!meanwhileOf(read)!.done(read)) {
        if (!followMeanwhile(read)) {
          run(read, 1);
          expect(++waited, from).toBeLessThan(600);
        }
      }
      expect(shape(h), from).toEqual(shape(read));
      clearHistory();
    }
    expect(Object.keys(report).sort()).toEqual(Object.keys(LINES).sort());
    console.info(`lineAdvice, step by step on the card players' boards:\n  ${Object.entries(report).map(([id, set]) => `${id}: ${[...set].join('\n      or: ')}`).join('\n  ')}`);
    // The sentences, as they read on those boards.
    expect([...report['make-spark']]).toEqual(['Wire the Ink Refiner\'s Ink port to the Lab: Ink is 3 α each in a Lab.']);
    // (By then the board has four Labs, three of them a Well's own: "a Lab".)
    expect([...report['build-fabricator']]).toEqual(['Cut the wire from the Glyph Assembler to a Lab: sold, each Glyph is N¢.']);
    for (const seq of report['make-glyph']) {
      expect(seq).toMatch(/^Place a Well on the free (Glint|Murk) deposit \(N¢\), then build a Lab from its port\.  →  Build a Lab from the new (Glint|Murk) Well's port \(N¢\): a Lab of its own is 1 α a second\.  →  Place a Well/);
    }
    for (const seq of report['make-mist']) {
      expect(seq).toMatch(/^Expand the board \(N¢\): it brings new deposits for a Well and a Lab of its own\.  →  Place a Well on the free (Ember|Glint) deposit \(N¢\), then build a Lab from its port\.  →  Build a Lab from the new (Ember|Glint) Well's port /);
    }
  });

  it('through whole runs it never gives a step without a line or for a line that is done, and every step it gives can be done on the spot', () => {
    for (const t of [cards, ...tips]) {
      expect(t.bad, t.bad.join('\n')).toEqual([]);
      // The check saw all of it: waits with no line, lines done, and steps on offer.
      expect(t.seen.seconds).toBeGreaterThan(500);
      expect(t.seen.none).toBeGreaterThan(100);
      expect(t.seen.done).toBeGreaterThan(100);
      expect(t.seen.steps).toBeGreaterThanOrEqual(9); // 1 + 4 + 3 + 1
    }
    // Ready to claim, a goal with no line, the chain finished: nothing.
    const g = cloneGame(boards.find((b) => b.id === 'make-spark')!.g)!;
    expect(lineAdvice(g)).not.toBeNull();
    g.goal.ready = true;
    expect(lineAdvice(g)).toBeNull();
    for (const id of ['wire-market', 'hold-flow', 'study-glyph', 'make-prism', 'make-lens', 'make-clay']) {
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
      const N = 400;
      lineAdvice(g); // (the board's lookup tables are built on the first call after a change)
      const t0 = now();
      for (let i = 0; i < N; i++) lineAdvice(g);
      const each = (now() - t0) / N;
      worst = Math.max(worst, each);
      expect(each, `${from}: ${each.toFixed(4)} ms a call`).toBeLessThan(0.25);
      expect(serialize(g).replace(/"savedAt":\d+/, ''), from).toBe(before);
      expect(g.rev).toBe(rev);
      // A step that has to be worked out afresh (the board just changed) is as cheap: no copy of the game is run.
      const h = cloneGame(g)!;
      const t1 = now();
      const first = lineAdvice(h);
      expect(now() - t1, from).toBeLessThan(5);
      expect(first).not.toBeNull();
    }
    console.info(`lineAdvice: ${(worst * 1000).toFixed(1)} µs a call at the worst of ${boards.length} boards`);
    // For scale: one verdict of the adviser on the same boards runs copies of the game for tens of milliseconds.
    expect(worst).toBeLessThan(0.25);
  });

  it('the step is what the line says, to the letter', () => {
    // "Make your first Spark": the Ink port, never the Silt port; with two Labs, the one with room.
    const g = rich();
    g.techs = ['P1', 'R1', 'P2'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    const ink = placeNode(g, 'refiner', 400, 400, { recipe: 'ink' })!;
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 3 })!.id, 0, ink.id);
    connect(g, ink.id, 0, m.id);
    at(g, 'make-spark');
    expect(lineAdvice(g)).toBeNull(); // no Lab: the line is not on the card
    const lab = placeNode(g, 'lab', 900, 100)!;
    let a = lineAdvice(g)!;
    expect(a).toMatchObject({ kind: 'data', node: ink.id, wire: { from: ink.id, to: lab.id, port: 0 }, cost: 0 });
    expect(a.text.mouse).toBe('Wire the Ink Refiner\'s Ink port to the Lab: Ink is 3 α each in a Lab.');
    const other = placeNode(g, 'lab', 900, 300)!;
    expect(lineAdvice(g)!.text.mouse).toBe('Wire the Ink Refiner\'s Ink port to a Lab: Ink is 3 α each in a Lab.');
    connect(g, ink.id, 1, other.id); // Silt into a Lab is not Ink studied
    expect(lineAdvice(g)).not.toBeNull();
    expect(applyAdvice(g, lineAdvice(g)!)).toBe(true);
    expect(goalView(g)!.meanwhile!.done).toBe(true);
    expect(lineAdvice(g)).toBeNull();

    // "Assemble your first Glyph": a Well on a free deposit, then a Lab from its port; nothing when it cannot be paid for.
    const h = rich();
    h.techs = ['P1', 'R1', 'P2', 'P3'];
    connect(h, well(h).id, 0, market(h).id);
    for (const dep of [2, 3, 4]) connect(h, placeNode(h, 'well', 0, 0, { depositId: dep })!.id, 0, market(h).id);
    at(h, 'make-glyph');
    expect(lineAdvice(h)).toBeNull(); // no free deposit the player could use (Breeze is locked): no line
    expect(expandBoard(h)).toBe(true);
    const [first] = freeDeposits(h);
    a = lineAdvice(h)!;
    expect(a).toMatchObject({ kind: 'data', build: 'well', deposit: first.id, cost: nodeCost(h, 'well') });
    expect(a.node ?? a.to ?? a.port).toBeUndefined();
    h.credits = nodeCost(h, 'well') - 1;
    expect(lineAdvice(h)).toBeNull(); // a moment later, with the credits, it is back
    h.credits = 1e9;
    expect(applyAdvice(h, a)).toBe(true);
    const placed = h.nodes.find((n) => n.depositId === first.id)!;
    a = lineAdvice(h)!;
    expect(a).toMatchObject({ kind: 'data', build: 'lab', node: placed.id, port: 0, cost: nodeCost(h, 'lab') });
    expect(a.deposit).toBeUndefined();
    h.credits = nodeCost(h, 'lab') - 1;
    expect(lineAdvice(h)).toBeNull();
    h.credits = 1e9;
    expect(applyAdvice(h, a)).toBe(true);
    const own = h.nodes.filter((n) => n.type === 'lab').pop()!;
    expect(h.wires.filter((w) => w.to === own.id).map((w) => w.from)).toEqual([placed.id]);
    expect(goalView(h)!.meanwhile!.done).toBe(false); // one pair of two

    // "Make your first Mist": the line names the board first. A deposit of the first expansion is still free
    // here, and the step is the expansion all the same; then a Well on a deposit that came with it.
    at(h, 'make-mist');
    expect(freeDeposits(h).length).toBe(1);
    const price = expansionCost(h);
    a = lineAdvice(h)!;
    expect(a).toMatchObject({ kind: 'data', expand: true, cost: price });
    expect(a.text.mouse).toBe(`Expand the board (${price}¢): it brings new deposits for a Well and a Lab of its own.`);
    expect(a.build ?? a.wire ?? a.node).toBeUndefined();
    h.credits = price - 1;
    expect(lineAdvice(h)).toBeNull();
    h.credits = price + 500;
    expect(applyAdvice(h, a)).toBe(true);
    expect(h.board.expansions).toBe(2);
    expect(h.credits).toBe(500);
    const fresh2 = h.deposits.slice(-2).map((d) => d.id);
    a = lineAdvice(h)!;
    expect(a.build).toBe('well');
    expect(fresh2).toContain(a.deposit);
    expect(applyAdvice(h, a)).toBe(true);
    a = lineAdvice(h)!;
    expect(a.build).toBe('lab');
    expect(h.nodes.find((n) => n.id === a.node)!.depositId).toBe(fresh2[0]);
    expect(applyAdvice(h, a)).toBe(true);
    expect(goalView(h)!.meanwhile!.done).toBe(true);
    expect(lineAdvice(h)).toBeNull();
    clearHistory();
  });
});

// ---------------------------------------------------------------------------------------------------
// What counts as done, where the board is not the card player's.
// ---------------------------------------------------------------------------------------------------

describe('"while you wait": done means done on any board', () => {
  it('goal 21: Glyph that reaches a Lab through a Router is still studied, and the wire to cut is the Router\'s', () => {
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
    // (Placed now, while there are credits; wired further down.)
    const merger = placeNode(g, 'merger', 850, 600)!;
    const shard = placeNode(g, 'refiner', 400, 100, { recipe: 'shard' })!;
    const r2 = placeNode(g, 'router', 600, 100)!;
    const spark = placeNode(g, 'refiner', 400, 540, { recipe: 'spark' })!;
    at(g, 'build-fabricator');
    g.credits = 100;
    g.data.b = TECHS.P7.cost.b!;
    const line = goalById('build-fabricator')!.meanwhile!;
    // No wire runs from the Glyph Assembler to a Lab, and the line is not done: the Glyph is studied all the same.
    expect(g.wires.some((w) => w.from === glyph.id && w.to === lab.id)).toBe(false);
    expect(goalView(g)!.meanwhile).toEqual({ text: LINES['build-fabricator'].mouse, done: false });
    expect(line.cuts!(g)).toEqual([toLab.id]);
    const a = lineAdvice(g)!;
    expect(a.cut).toEqual({ wire: toLab.id, from: router.id, to: lab.id });
    expect(a.node).toBe(router.id);
    expect(a.text.mouse).toBe('Cut the wire from a Router to the Lab: sold, each Glyph is 20¢.'); // (two Routers stand on this board)
    expect(adviceTrials(g)!.trials.some((x) => /^Cut /.test(x.text))).toBe(false); // the card's step, not a tip
    expect(applyAdvice(g, a)).toBe(true);
    expect(goalView(g)!.meanwhile!.done).toBe(true);
    expect(line.cuts!(g)).toEqual([]);
    expect(lineAdvice(g)).toBeNull();
    // Through two junctions, and with a wire of its own beside it: every wire that takes Glyph into a Lab is listed.
    connect(g, router.id, 0, merger.id);
    const viaMerger = connect(g, merger.id, 0, lab.id)!;
    const direct = connect(g, glyph.id, 0, lab.id)!;
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    expect([...line.cuts!(g)].sort()).toEqual([viaMerger.id, direct.id].sort());
    // Something else through a Router into a Lab is nobody's business here: Shard is not Glyph.
    cutWire(g, viaMerger.id);
    cutWire(g, direct.id);
    connect(g, shard.id, 0, r2.id);
    connect(g, r2.id, 0, lab.id);
    expect(goalView(g)!.meanwhile!.done).toBe(true);
    expect(line.cuts!(g)).toEqual([]);
    // A Router that carries Glyph and Spark both: its wire into the Lab still takes Glyph there, and the
    // sentence names the Glyph (the dearer of the two), whatever came down the wire first.
    connect(g, spark.id, 0, router.id);
    const again = connect(g, router.id, 0, lab.id)!;
    expect(line.cuts!(g)).toEqual([again.id]);
    expect(lineAdvice(g)!.text.mouse).toBe('Cut the wire from a Router to the Lab: sold, each Glyph is 20¢.');
    clearHistory();
  });

  it('goal 11: Ink that reaches a Lab through a Router is studied Ink; Silt is not', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'L1'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    const ink = placeNode(g, 'refiner', 400, 400, { recipe: 'ink' })!;
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 3 })!.id, 0, ink.id);
    const lab = placeNode(g, 'lab', 900, 100)!;
    at(g, 'make-spark');
    const siltRouter = placeNode(g, 'router', 650, 600)!;
    connect(g, ink.id, 1, siltRouter.id);
    connect(g, siltRouter.id, 0, lab.id);
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    const router = placeNode(g, 'router', 650, 400)!;
    connect(g, ink.id, 0, router.id);
    connect(g, router.id, 0, m.id);
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    connect(g, router.id, 0, lab.id);
    expect(goalView(g)!.meanwhile!.done).toBe(true);
    expect(lineAdvice(g)).toBeNull();
    clearHistory();
  });

  it('goal 15: one Well wired into two Labs is one pair, not two', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    for (const dep of [2, 3, 4]) connect(g, placeNode(g, 'well', 0, 0, { depositId: dep })!.id, 0, m.id);
    expect(expandBoard(g)).toBe(true);
    at(g, 'make-glyph');
    const [d1, d2] = freeDeposits(g);
    const w1 = placeNode(g, 'well', 0, 0, { depositId: d1.id })!;
    const labA = placeNode(g, 'lab', 900, 100)!;
    const labB = placeNode(g, 'lab', 900, 300)!;
    connect(g, w1.id, 0, labA.id);
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    const second = connect(g, w1.id, 0, labB.id)!;
    // Two Labs fed by Wells alone, and one Well between them: it has 1 α a second to give, not 2.
    expect(wellLabs(g)).toBe(2);
    expect(goalView(g)!.meanwhile).toEqual({ text: LINES['make-glyph'].mouse, done: false });
    // The line still has a step: the other deposit.
    const a = lineAdvice(g)!;
    expect(a).toMatchObject({ build: 'well', deposit: d2.id });
    expect(applyAdvice(g, a)).toBe(true);
    const w2 = g.nodes.find((n) => n.depositId === d2.id)!;
    // The second Well into the SAME two Labs: two Wells, two Labs, each can have one. Done.
    const x = connect(g, w2.id, 0, labA.id)!;
    expect(goalView(g)!.meanwhile!.done).toBe(true);
    // A Lab can only be one Well's own: both Wells into Lab A alone is one pair again. (With no deposit left
    // and no Well unwired, the card has nothing more to ask and drops the line.)
    const line = goalById('make-glyph')!.meanwhile!;
    cutWire(g, second.id);
    expect(line.done(g)).toBe(false);
    expect(goalView(g)!.meanwhile).toBeUndefined();
    expect(lineAdvice(g)).toBeNull();
    // Lab A takes both Wells, Lab B only the first: a pair each all the same (A with the second Well, B with the first).
    connect(g, w1.id, 0, labB.id);
    expect(goalView(g)!.meanwhile!.done).toBe(true);
    cutWire(g, x.id);
    expect(line.done(g)).toBe(false);
    // As the card says it: the second Well, unwired again, gets a Lab built from its port.
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    const b = lineAdvice(g)!;
    expect(b).toMatchObject({ build: 'lab', node: w2.id });
    expect(applyAdvice(g, b)).toBe(true);
    expect(goalView(g)!.meanwhile!.done).toBe(true);
    expect(lineAdvice(g)).toBeNull();

    // Goal 18 counts the same way: three Labs on two Wells are not three pairs.
    at(g, 'make-mist');
    expect(g.nodes.filter((n) => n.type === 'lab').length).toBe(3);
    expect(wellLabs(g)).toBe(3);
    expect(goalView(g)!.meanwhile).toEqual({ text: LINES['make-mist'].mouse, done: false });
    clearHistory();
  });
});

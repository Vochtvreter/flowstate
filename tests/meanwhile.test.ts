// The goal cards' "while you wait" lines (Goal.meanwhile in src/goals.ts): what they say, the order they come
// in, when they show, that each is true on the board a card-following player has, that nothing later undoes
// them, and that lineAdvice (the step the card's "Show me" acts out) follows each one to the end.
import { describe, expect, it } from 'vitest';
import { claimGoal, clearHistory, connect, cutWire, expandBoard, favour, freeDeposits, placeNode } from '../src/actions';
import { Advice, advice, adviceTrials, applyAdvice, lineAdvice } from '../src/advice';
import { RULES, TECHS } from '../src/content';
import { nodeCost } from '../src/economy';
import { GOALS, MAIN_GOALS, Meanwhile, activeGoal, goalById, goalFocus, goalView, meanwhileAt, meanwhileOf } from '../src/goals';
import { Game, cloneGame, nodeNoun, serialize } from '../src/state';
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
/** Labs that study what Wells give them and nothing else. */
const wellLabs = (g: Game) => g.nodes.filter((n) => {
  const fed = n.type === 'lab' ? g.wires.filter((w) => w.to === n.id) : [];
  return fed.length > 0 && fed.every((w) => typeOf(g, w.from) === 'well');
}).length;

/** The lines of each goal that has any, in the order the card shows them. */
const ORDER: Record<string, string[]> = {
  'make-spark': ['ink-lab', 'glint-lab'],
  'make-glyph': ['well-labs', 'expand-labs'],
  'hold-flow': ['flow-fix'],
  'make-mist': ['expand-labs', 'speed-pairs', 'deep-analysis'],
  'make-prism': ['cut-glyph'],
  'build-fabricator': ['cut-glyph', 'flow-tune', 'refine-wells'],
  'make-lens': ['prism-fab', 'glyph-fab'],
};
const TEXT: Record<string, { mouse: string; touch: string }> = {
  'ink-lab': {
    mouse: 'Drag from the Ink Refiner\'s Ink port to the Lab too: studied Ink is 3 α each.',
    touch: 'Tap the Ink Refiner\'s Ink port, then tap the Lab too: studied Ink is 3 α each.',
  },
  'glint-lab': { mouse: 'Build a Lab from the port of the Glint Well that only sells: studied Glint is 1 α each.', touch: '' },
  'well-labs': { mouse: 'Give each new deposit a Well and a Lab built from its port: each pair is 1 α a second.', touch: '' },
  'expand-labs': { mouse: 'Expand the board again and give both new deposits a Well and a Lab of its own.', touch: '' },
  // (Its words once done. While there is a step, the card reads the line's words for the board: Meanwhile.say, below.)
  'flow-fix': {
    mouse: 'Click the Flow ring to find what holds Flow back, and give it what it lacks.',
    touch: 'Tap the Flow ring to find what holds Flow back, and give it what it lacks.',
  },
  'speed-pairs': { mouse: 'Buy Speed on each Well with a Lab of its own, and on that Lab when it is full.', touch: '' },
  'deep-analysis': { mouse: 'Research Lab Speed, then Deep Analysis: every item studied gives half as much Data again.', touch: '' },
  'cut-glyph': { mouse: 'You have the β you need: cut the wire from the Glyph Assembler to the Lab.', touch: '' },
  // (Its words once done. While there is a step, the card reads the step's own sentence: Meanwhile.say.)
  'flow-tune': { mouse: 'Your line is tuned: every sale pays more until the Fabricator is yours.', touch: '' },
  'refine-wells': { mouse: 'You have enough α: build a Refiner from a Well that only feeds a Lab, and sell its goods.', touch: '' },
  'prism-fab': { mouse: 'Wire the Prism Assembler\'s port to the Fabricator: a Lens takes one Prism.', touch: '' },
  'glyph-fab': { mouse: 'Wire the Glyph Assembler\'s port to the Fabricator: a Lens takes two Glyph.', touch: '' },
};
for (const t of Object.values(TEXT)) if (!t.touch) t.touch = t.mouse;
/** What "expand-labs" reads once its next step is no longer the board's expansion (Meanwhile.say). */
const FREE = 'Give each free deposit a Well and a Lab of its own.';
const lineOf = (id: string): Meanwhile => GOALS.flatMap((x) => x.meanwhile ?? []).find((l) => l.id === id)!;
/**
 * The Fabricator card's two lines, whose steps are only on the card while they pay for themselves before the
 * Fabricator can be bought (Meanwhile.closes): they may leave the card with work left, and a copy of a board (which
 * does not remember what was on offer a moment ago) may not have them where the game it was copied from did.
 */
const EARNING = ['flow-tune', 'refine-wells'];

/** The most steps each line can take on the scripted boards (the board, then a Well and a Lab for each deposit; a pair is two presses). */
const MOST: Record<string, number> = {
  'ink-lab': 1, 'glint-lab': 1, 'well-labs': 4, 'expand-labs': 5, 'flow-fix': 3, 'speed-pairs': 10, 'deep-analysis': 2, 'cut-glyph': 1, 'prism-fab': 1, 'glyph-fab': 1,
  // A level of Speed or two on each outrun Refiner; a Refiner, its wire to the Market and (for Ink) a Void, on each of four Wells.
  'flow-tune': 6, 'refine-wells': 9,
};

describe('"while you wait": the lines', () => {
  it('seven goals carry lines, in this order, and no other goal does; the chain is still 22 and 4', () => {
    expect(Object.fromEntries(GOALS.filter((x) => x.meanwhile?.length).map((x) => [x.id, x.meanwhile!.map((l) => l.id)]))).toEqual(ORDER);
    for (const [id, text] of Object.entries(TEXT)) expect(lineOf(id).text, id).toEqual(text);
    // A line that stands on two goals is the same line: what it asks for, and when it is done, do not change.
    expect(goalById('make-glyph')!.meanwhile![1]).toBe(goalById('make-mist')!.meanwhile![0]);
    expect(goalById('make-prism')!.meanwhile![0]).toBe(goalById('build-fabricator')!.meanwhile![0]);
    expect(MAIN_GOALS).toBe(22);
    expect(GOALS.length).toBe(26);
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

  it('shown one at a time: the first that applies and is not done, "2 of 2" after the first, the last one ticked once all are done', () => {
    // "Make your first Spark": Ink into the Lab, then a Lab of its own for the Glint Well that only sells.
    const g = rich();
    g.techs = ['P1', 'R1', 'P2'];
    const m = market(g);
    const w1 = well(g);
    connect(g, w1.id, 0, m.id);
    const w2 = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    connect(g, w2.id, 0, m.id);
    const shard = placeNode(g, 'refiner', 300, 100, { recipe: 'shard' })!;
    connect(g, w1.id, 0, shard.id);
    connect(g, shard.id, 0, m.id);
    at(g, 'make-spark');
    // No Ink Refiner yet: the first line does not apply, the second (a Lab for the Glint Well that only sells) does.
    expect(goalView(g)!.meanwhile).toMatchObject({ text: TEXT['glint-lab'].mouse, done: false, step: 2, of: 2 });
    const ink = placeNode(g, 'refiner', 400, 400, { recipe: 'ink' })!;
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 3 })!.id, 0, ink.id);
    connect(g, ink.id, 0, m.id);
    const lab = placeNode(g, 'lab', 900, 100)!;
    connect(g, shard.id, 0, lab.id);
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['ink-lab'].mouse, done: false, step: 1, of: 2 });
    expect(goalView(g, true)!.meanwhile).toEqual({ text: TEXT['ink-lab'].touch, done: false, step: 1, of: 2 });
    connect(g, ink.id, 1, lab.id); // the Silt port is not the Ink port
    expect(meanwhileOf(g)!.id).toBe('ink-lab');
    const inkWire = connect(g, ink.id, 0, lab.id)!;
    // The first is done: the second comes up.
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['glint-lab'].mouse, done: false, step: 2, of: 2 });
    expect(meanwhileAt(g)).toMatchObject({ step: 2, of: 2 });
    const a = lineAdvice(g)!;
    expect(a).toMatchObject({ build: 'lab', node: w2.id, port: 0 });
    expect(applyAdvice(g, a)).toBe(true);
    // Both done: the last one stays on the card, ticked.
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['glint-lab'].mouse, done: true, step: 2, of: 2 });
    expect(lineAdvice(g)).toBeNull();
    // Undo the first: it is back on the card.
    cutWire(g, inkWire.id);
    expect(goalView(g)!.meanwhile).toMatchObject({ text: TEXT['ink-lab'].mouse, done: false, step: 1 });
    // A goal that is ready to claim shows Claim and nothing else.
    g.sold.spark = 1;
    run(g, 0.1);
    expect(g.goal.ready).toBe(true);
    expect(goalView(g)!.meanwhile).toBeUndefined();
    expect(meanwhileOf(g)).toBeNull();
    // A goal with a single line has no step and no count.
    at(g, 'hold-flow');
    for (const id of ['wire-market', 'research-murk', 'study-glyph', 'bulk-upgrade', 'make-clay']) {
      at(g, id);
      expect(goalView(g)!.meanwhile, id).toBeUndefined();
    }
    clearHistory();
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
    // No free deposit (the Breeze one is locked): nothing to place a Well on, so the first line is not shown;
    // the second (the board's next expansion) is.
    expect(meanwhileOf(g)!.id).toBe('expand-labs');
    expect(expandBoard(g)).toBe(true); // Glint and Murk appear
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['well-labs'].mouse, done: false, step: 1, of: 2 });
    // A raw Well into the Lab that studies Shard: 1 α each, but it takes the Shard's place. Not what the card asks.
    const second = g.nodes.find((n) => n.depositId === 2)!;
    connect(g, second.id, 0, lab.id);
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    expect(followMeanwhile(g)).toBe(true); // a Well
    expect(followMeanwhile(g)).toBe(true); // its Lab
    expect(wellLabs(g)).toBe(1);
    expect(meanwhileOf(g)!.id).toBe('well-labs');
    expect(followMeanwhile(g)).toBe(true);
    expect(followMeanwhile(g)).toBe(true);
    expect(wellLabs(g)).toBe(2);
    // Done: the second line, the board's next expansion and its two deposits.
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['expand-labs'].mouse, done: false, step: 2, of: 2 });
    const expansions = g.board.expansions;
    expect(followMeanwhile(g)).toBe(true);
    expect(g.board.expansions).toBe(expansions + 1);
    // Once the board has grown, the line reads what is left of it: the free deposits (it said "Expand the board
    // again" on the Mist card while its Show me pointed at a Lab and a deposit, and was ticked with no expansion made).
    expect(goalView(g)!.meanwhile).toEqual({ text: FREE, done: false, step: 2, of: 2 });
    for (let i = 0; i < 4; i++) expect(followMeanwhile(g), `step ${i}`).toBe(true);
    expect(wellLabs(g)).toBe(4);
    expect(goalView(g)!.meanwhile).toEqual({ text: FREE, done: true, step: 2, of: 2 });
    expect(followMeanwhile(g)).toBe(false); // nothing more to do

    // "Make your first Mist": the same expansion is done already, so the card goes on to Speed on the pairs. A line
    // that was done when the goal came up is not shown ticked, and not counted: two lines are left, not three.
    at(g, 'make-mist');
    expect(g.goalAt!.had).toEqual(['expand-labs']);
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['speed-pairs'].mouse, done: false, step: 1, of: 2 });
    let presses = 0;
    while (meanwhileOf(g)?.id === 'speed-pairs' && followMeanwhile(g)) presses++;
    // Four pairs: a Well and then its Lab each, but the Ember Well alone (0.8 a second: its Lab had room).
    expect(presses).toBe(7);
    // Then Lab Speed and Deep Analysis. With no α in hand the step is saved for in Data, and the card says so
    // (nothing is coming in on this board, so no time); with the Data, the two researches.
    expect(goalView(g)!.meanwhile).toEqual({
      text: TEXT['deep-analysis'].mouse, done: false, step: 2, of: 2, held: { cost: TECHS.R2.cost.a, sym: 'α', eta: Infinity },
    });
    expect(lineAdvice(g)).toBeNull();
    g.data = { a: 1e4, b: 1e4, g: 0 };
    expect(goalView(g)!.meanwhile!.held).toBeUndefined();
    expect(followMeanwhile(g)).toBe(true);
    expect(g.techs).toContain('R2');
    expect(followMeanwhile(g)).toBe(true);
    expect(g.techs).toContain('R3');
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['deep-analysis'].mouse, done: true, step: 2, of: 2 });
    clearHistory();
  });

  it('"Make your first Mist" picks up the second expansion where the Glyph card left it', () => {
    // A player who left the first expansion's deposits alone and spent the credits on the Assembler first.
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    expect(expandBoard(g)).toBe(true);
    at(g, 'make-mist');
    expect(wellLabs(g)).toBe(0);
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['expand-labs'].mouse, done: false, step: 1, of: 3 });
    // A Well and a Lab of its own on a deposit of the FIRST expansion is not what this line asks for.
    const first = g.deposits[g.deposits.length - 2];
    const w0 = placeNode(g, 'well', first.x, first.y, { depositId: first.id })!;
    connect(g, w0.id, 0, placeNode(g, 'lab', 900, 500)!.id);
    expect(goalView(g)!.meanwhile!.done).toBe(false);
    // The step is the expansion, then a Well and a Lab on each of its deposits.
    expect(lineAdvice(g)).toMatchObject({ expand: true });
    let steps = 0;
    while (meanwhileOf(g)?.id === 'expand-labs' && followMeanwhile(g)) steps++;
    expect(steps).toBe(5);
    expect(meanwhileOf(g)!.id).toBe('speed-pairs');
    // Breeze Deposits researched: the card itself asks for a Well on the Breeze deposit, and no line gets in its way.
    g.techs.push('P5');
    expect(lineAdvice(g)?.deposit).toBeUndefined();
    clearHistory();
  });

  it('"cut the Glyph wire" is asked only while the β is covered (in hand or still to come from the cards) and the Fabricator is not paid for', () => {
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
    // On "Assemble your first Prism" the β to come (this card's and the next one's) covers Fabrication already.
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
    // (The two lines of "Make your first Lens" only come up for a Fabricator that is not fed: this player wires
    // what the hint names straight after the build. The Flow line only when something is short.)
    const all = Object.entries(ORDER).flatMap(([goal, lines]) => lines.map((l) => `${goal}/${l}`)).filter((x) => !x.startsWith('make-lens/'));
    for (const t of [cards, ...tips]) {
      const got = t.snaps.map((s) => `${s.goal}/${s.line}`);
      // Each at most once, and the second expansion on one goal or the other.
      expect(new Set(got).size).toBe(got.length);
      // A line on two goals comes up on one or the other (done on the first, it is done on the second).
      const shared = (x: string) => x.endsWith('/expand-labs') || x.endsWith('/cut-glyph');
      // (The Fabricator card's two come up where their steps pay: checked on the pacing tool's players, further down.)
      const earning = (x: string) => EARNING.some((id) => x.endsWith(`/${id}`));
      for (const x of all) if (!shared(x) && !earning(x)) expect(got, x).toContain(x);
      expect(got.some((x) => x.endsWith('/expand-labs')), 'the second expansion').toBe(true);
      expect(got.some((x) => x.endsWith('/cut-glyph')), 'the Glyph sold').toBe(true);
    }
  });

  it('doing what a line says ends that goal\'s wait sooner than not doing it, in the real game', () => {
    const report: string[] = [];
    const measured = new Set<string>();
    for (const { goal, line, g, from } of [...cards.snaps, ...tips.flatMap((t) => t.snaps)]) {
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
      if (!finished && (line === 'expand-labs' || line === 'cut-glyph')) {
        for (const x of gains) expect(x, from).toBeGreaterThanOrEqual(0);
        continue;
      }
      // The Fabricator card's two promise less: each step only that the Fabricator is not later for it. Held to
      // that here (a few seconds either way are the orders' lumps); what they are worth is measured on the pacing
      // tool's players below.
      if (EARNING.includes(line)) {
        expect((gains[0] + gains[1]) / 2, `${goal}/${line}: ${from}`).toBeGreaterThanOrEqual(0);
        continue;
      }
      measured.add(line);
      // Sooner under either sequence, and by 15 s on average: a line takes the player's hands for a while.
      for (const x of gains) expect(x, from).toBeGreaterThan(0);
      expect((gains[0] + gains[1]) / 2, `${goal}/${line}: ${from}`).toBeGreaterThanOrEqual(15);
    }
    // Not "cut-glyph": this player now has the Prism Assembler's price in hand on goal 19 and does the cut there,
    // where it ends no wait; its worth is on goal 21, measured on the pacing tool's card-only player below.
    expect([...measured].sort()).toEqual(['deep-analysis', 'expand-labs', 'flow-fix', 'glint-lab', 'ink-lab', 'speed-pairs', 'well-labs']);
    console.info(`"while you wait" lines, seconds each ends its wait sooner (two order sequences):\n  ${report.join('\n  ')}`);
  });

  it('what a line asked for is still there at the first Lens, and no tip ever went against one', () => {
    for (const { run } of [cards, ...tips]) {
      const g = run.g;
      expect(wired(g, 'ink', 'lab'), 'Ink is still studied').toBe(true); // goal 11's first line
      expect(wellLabs(g), 'five Wells with a Lab each').toBe(5); // goals 11, 15 and 18
      expect(g.board.expansions).toBe(2);
      expect(wired(g, 'glyph', 'lab'), 'Glyph is no longer studied').toBe(false); // the cut on goals 19 and 21
      for (const t of run.tips) {
        expect(t.text, t.text).not.toMatch(/^(Cut|Remove) /);
        expect(t.text, t.text).not.toMatch(/^Favour /);
        if (t.goal === 'build-fabricator' || t.goal === 'make-lens') expect(t.text, t.text).not.toMatch(/Glyph Assembler's port to (the|a) Lab/);
      }
    }
    // The Router of "Route more to a Lab" hangs on the Spark Refiner, as that card says, and still favours the Lab.
    for (const { run } of [cards, ...tips]) {
      const router = run.g.nodes.find((n) => n.type === 'router')!;
      expect(run.g.nodes.find((n) => n.id === run.g.wires.find((w) => w.to === router.id)!.from)!.recipe).toBe('spark');
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

  it('the card-only player who leaves one line out spends at least 15 s longer on the goals it stands on, on every seed', () => {
    // Not the lines of "Make your first Lens": this player wires what the hint names anyway (the lines are for a
    // person who did not, and are checked on such boards below).
    const lines = ['ink-lab', 'glint-lab', 'well-labs', 'expand-labs', 'flow-fix', 'speed-pairs', 'deep-analysis', 'cut-glyph'];
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
    // "glint-lab" is the exception: 13–25 s. Ember Deposits came down to 195α, so goal 11's wait is shorter, and
    // what the Glint Well's Lab of its own brings after it (1 α a second, through goals 12 to 15) is not counted.
    for (const [what, gain] of gains) expect(gain, what).toBeGreaterThanOrEqual(what.endsWith('glint-lab') ? 10 : 15);
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
  // Exactly one thing to do (a research too: Lab Speed, then Deep Analysis, on "Make your first Mist").
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
    // (One of the Fabricator card's two may leave with work left, once its next step no longer pays.)
    if (!now && EARNING.includes(line)) break;
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
    // (Whatever is built from a port arrives wired to it: a Lab, a Refiner, a Void.)
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
    // (A copy of a board on which one of the Fabricator card's lines was on its last seconds may not have it.)
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
      if (h.goal.ready) continue; // (the goal came first: nothing more on the card)
      // (A copy has no memory of the step that was on offer: where it was on its last seconds, nothing is given.)
      if (EARNING.includes(line) && !steps.length) continue;
      expect(steps.length, from).toBeGreaterThanOrEqual(1);
      expect(lineOf(line).done(h), from).toBe(true);
      (report[line] ??= new Set()).add(steps.map((a) => a.text.mouse.replace(/\d+¢/g, 'N¢')).join('  →  '));
      clearHistory();
    }
    console.info(`lineAdvice, step by step on the card players' boards:\n  ${Object.entries(report).map(([id, set]) => `${id}: ${[...set].slice(0, 3).join('\n      or: ')}`).join('\n  ')}`);
    expect([...report['ink-lab']]).toEqual(['Wire the Ink Refiner\'s Ink port to the Lab: Ink is 3 α each in a Lab.']);
    for (const seq of report['glint-lab']) expect(seq).toMatch(/^Build a Lab from a Glint Well's port \(N¢\): Glint is 1 α each in a Lab\.$/);
    for (const seq of report['well-labs'] ?? []) expect(seq).toMatch(/^(Place a Well on the free (Glint|Murk) deposit \(N¢\), then build a Lab from its port\.|Build a Lab from the new (Glint|Murk) Well's port)/);
    for (const seq of report['flow-fix'] ?? []) expect(seq).toMatch(/needs more \w+: buy Speed on (the|an?|its) \w+ (Well|Refiner)/);
    for (const seq of report['cut-glyph']) expect(seq).toMatch(/^Cut the wire from the Glyph Assembler to (the|a) Lab: sold, each Glyph is N¢\.$/);
    for (const seq of report['flow-tune']) expect(seq).toMatch(/^(The|An?) \w+ Well outruns its Refiner: buy Speed on the Refiner \(N¢\)\./);
    for (const seq of report['refine-wells']) expect(seq).toMatch(/^Build a Refiner from (the|an?) \w+ Well's port \(N¢\): its \w+ sells for N¢ each\.  →  Wire (the|an?) \w+ Refiner's (\w+ )?port to the Market: its \w+ is not sold \(N¢ each\)\./);
  });

  it('through whole runs it never gives a step without a line or for a line that is done, and every step it gives can be done on the spot', () => {
    for (const t of [cards, ...tips]) {
      expect(t.bad, t.bad.join('\n')).toEqual([]);
      // The check saw all of it: waits with no line, lines done, and steps on offer.
      expect(t.seen.seconds).toBeGreaterThan(400);
      expect(t.seen.none).toBeGreaterThan(50);
      expect(t.seen.steps).toBeGreaterThanOrEqual(5);
    }
    // Ready to claim, a goal with no line, the chain finished: nothing.
    const g = cloneGame(boards.find((b) => b.line === 'ink-lab')!.g)!;
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
    // "Make your first Spark": the Ink port, never the Silt port; with two Labs, the one with room.
    const g = rich();
    g.techs = ['P1', 'R1', 'P2'];
    const m = market(g);
    connect(g, well(g).id, 0, m.id);
    const ink = placeNode(g, 'refiner', 400, 400, { recipe: 'ink' })!;
    connect(g, placeNode(g, 'well', 0, 0, { depositId: 3 })!.id, 0, ink.id);
    connect(g, ink.id, 0, m.id);
    at(g, 'make-spark');
    expect(meanwhileOf(g)!.id).toBe('glint-lab'); // no Lab: the first line is not on the card
    expect(lineAdvice(g)).toMatchObject({ build: 'lab', node: well(g).id, port: 0 });
    const lab = placeNode(g, 'lab', 900, 100)!;
    let a = lineAdvice(g)!;
    expect(a).toMatchObject({ kind: 'data', node: ink.id, wire: { from: ink.id, to: lab.id, port: 0 }, cost: 0 });
    expect(a.text.mouse).toBe('Wire the Ink Refiner\'s Ink port to the Lab: Ink is 3 α each in a Lab.');
    const other = placeNode(g, 'lab', 900, 300)!;
    expect(lineAdvice(g)!.text.mouse).toBe('Wire the Ink Refiner\'s Ink port to a Lab: Ink is 3 α each in a Lab.');
    connect(g, ink.id, 1, other.id); // Silt into a Lab is not Ink studied
    expect(lineAdvice(g)).not.toBeNull();
    expect(applyAdvice(g, lineAdvice(g)!)).toBe(true);
    expect(lineOf('ink-lab').done(g)).toBe(true);

    // "Assemble your first Glyph": a Well on a free deposit, then a Lab from its port; nothing when it cannot be paid for.
    const h = rich();
    h.techs = ['P1', 'R1', 'P2', 'P3'];
    connect(h, well(h).id, 0, market(h).id);
    for (const dep of [2, 3, 4]) connect(h, placeNode(h, 'well', 0, 0, { depositId: dep })!.id, 0, market(h).id);
    at(h, 'make-glyph');
    expect(meanwhileOf(h)!.id).toBe('expand-labs'); // no free deposit the player could use (Breeze is locked): the second line
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
    expect(applyAdvice(h, a)).toBe(true);
    const own = h.nodes.filter((n) => n.type === 'lab').pop()!;
    expect(h.wires.filter((w) => w.to === own.id).map((w) => w.from)).toEqual([placed.id]);
    expect(meanwhileOf(h)!.id).toBe('well-labs'); // one pair of two

    // The line keeps the credits the card's own next purchase needs: with Assembly researched and the
    // Assembler not bought, only what is left over it. And a Well and the Lab from its port are one step: the
    // Well is offered only when its Lab can be paid for too, so that no goal ends with the Well standing alone.
    h.techs.push('P4');
    h.credits = nodeCost(h, 'assembler') + nodeCost(h, 'well') + nodeCost(h, 'lab') - 1;
    expect(lineAdvice(h)).toBeNull();
    expect(goalView(h)!.meanwhile!.held).toEqual({ cost: nodeCost(h, 'assembler') + nodeCost(h, 'well') + nodeCost(h, 'lab'), sym: '¢', eta: expect.any(Number) });
    h.credits += 1;
    expect(lineAdvice(h)).toMatchObject({ build: 'well' });
    expect(goalView(h)!.meanwhile!.held).toBeUndefined();
    // Once that Well stands, its Lab is given from the credits in hand even where the reserve has grown since (the
    // pair brings α in faster, so the research is nearer and more of the Assembler is kept back): held, the Lab
    // waited for the Assembler and the goal could end with the Well blocked (seen with a player who claims at once).
    const k = cloneGame(h)!;
    expect(applyAdvice(k, lineAdvice(k)!)).toBe(true);
    const alone = k.nodes.find((n) => n.type === 'well' && !k.wires.some((x) => x.from === n.id))!;
    k.credits = nodeCost(k, 'lab'); // all of it would be kept back for the Assembler
    expect(lineAdvice(k)).toMatchObject({ build: 'lab', node: alone.id, port: 0 });
    expect(goalView(k)!.meanwhile!.held).toBeUndefined();
    k.credits = nodeCost(k, 'lab') - 1; // short of the Lab itself: saved for, the Lab's price alone
    expect(lineAdvice(k)).toBeNull();
    expect(goalView(k)!.meanwhile!.held).toEqual({ cost: nodeCost(k, 'lab'), sym: '¢', eta: expect.any(Number) });

    // "Make your first Mist", second line: Speed on a Well with a Lab of its own, then on its Lab.
    h.credits = 1e9;
    while (followMeanwhile(h)) { /* the rest of the Glyph card's lines */ }
    at(h, 'make-mist');
    expect(meanwhileOf(h)!.id).toBe('speed-pairs');
    a = lineAdvice(h)!;
    expect(a).toMatchObject({ upgrade: 'speed', node: placed.id });
    expect(a.text.mouse).toMatch(/^Buy Speed on (the|a) Glint Well \(50¢\): its Lab of its own then gets more to study\.$/);
    expect(applyAdvice(h, a)).toBe(true);
    a = lineAdvice(h)!;
    expect(a).toMatchObject({ upgrade: 'speed', node: own.id });
    expect(a.text.mouse).toBe('Buy Speed on the Glint Well\'s own Lab (50¢): the pair then gives more α.');
    clearHistory();
  });
});

// ---------------------------------------------------------------------------------------------------
// What counts as done, where the board is not the card player's.
// ---------------------------------------------------------------------------------------------------

describe('"while you wait": done means done on any board', () => {
  it('goals 19 and 21: Glyph that reaches a Lab through a Router is still studied, and the wire to cut is the Router\'s', () => {
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
    expect(goalView(g)!.meanwhile).toEqual({ text: TEXT['cut-glyph'].mouse, done: false });
    expect(line.cuts!(g)).toEqual([toLab.id]);
    const a = lineAdvice(g)!;
    expect(a.cut).toEqual({ wire: toLab.id, from: router.id, to: lab.id });
    expect(a.node).toBe(router.id);
    expect(a.text.mouse).toBe('Cut the wire from a Router to the Lab: sold, each Glyph is 20¢.'); // (two Routers stand on this board)
    expect(adviceTrials(g)!.trials.some((x) => /^Cut /.test(x.text))).toBe(false); // the card's step, not a tip
    expect(applyAdvice(g, a)).toBe(true);
    expect(line.done(g)).toBe(true);
    expect(line.cuts!(g)).toEqual([]);
    // Through two junctions, and with a wire of its own beside it: every wire that takes Glyph into a Lab is listed.
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
    expect(lineOf('ink-lab').done(g)).toBe(false);
    const router = placeNode(g, 'router', 650, 400)!;
    connect(g, ink.id, 0, router.id);
    connect(g, router.id, 0, m.id);
    expect(lineOf('ink-lab').done(g)).toBe(false);
    connect(g, router.id, 0, lab.id);
    expect(lineOf('ink-lab').done(g)).toBe(true);
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
    connect(g, w1.id, 0, labB.id);
    // Two Labs fed by Wells alone, and one Well between them: it has 1 α a second to give, not 2.
    expect(wellLabs(g)).toBe(2);
    expect(lineOf('well-labs').done(g)).toBe(false);
    const a = lineAdvice(g)!;
    expect(a).toMatchObject({ build: 'well', deposit: d2.id });
    expect(applyAdvice(g, a)).toBe(true);
    const w2 = g.nodes.find((n) => n.depositId === d2.id)!;
    connect(g, w2.id, 0, labA.id);
    expect(lineOf('well-labs').done(g)).toBe(true);
    clearHistory();
  });

  it('goal 16: the step is the Flow fix the ring leads to, and the line is done once everything flows', () => {
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
// "Make your first Lens": the card says which wire, and the Lens follows.
// ---------------------------------------------------------------------------------------------------

describe('"Make your first Lens": a line for each input the Fabricator lacks', () => {
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

  it('built from the Prism Assembler\'s port: the one line asks for the Glyph wire, the progress counts inputs, and the Lens follows within 30 s', () => {
    const { g, f } = board('port');
    const v = goalView(g)!;
    // The goal's own requirement, not something to do while waiting: the card says "Next step". The Prism line was
    // done when the goal came up (the Fabricator was built from the Prism Assembler's port): it is not shown, ticked,
    // and not counted.
    expect(g.goalAt!.had).toEqual(['prism-fab']);
    expect(v.meanwhile).toEqual({ text: TEXT['glyph-fab'].mouse, done: false, required: true });
    expect(v.progress).toEqual([1, 2, 'inputs wired']);
    expect(v.inputs).toEqual([{ mat: 'prism', name: 'Prism', fed: true }, { mat: 'glyph', name: 'Glyph', fed: false }]);
    const glyph = g.nodes.find((n) => n.recipe === 'glyph')!;
    expect(goalFocus(g)).toEqual([glyph.id, f.id]);
    // Left alone, nothing happens.
    const left = cloneGame(g)!;
    run(left, 300);
    expect(left.goal.ready).toBe(false);
    // The step, and the Lens.
    const a = lineAdvice(g)!;
    expect(a).toMatchObject({ wire: { from: glyph.id, to: f.id, port: 0 }, node: glyph.id });
    expect(a.text.mouse).toBe('Wire the Glyph Assembler\'s port to the Lens Fabricator: a Lens takes two Glyph.');
    expect(applyAdvice(g, a)).toBe(true);
    expect(goalView(g)!.progress).toEqual([0, 1, 'Lens']);
    const t0 = g.time;
    while (!g.goal.ready && g.time - t0 < 60) run(g, 1);
    expect(g.time - t0, 'seconds to the first Lens').toBeLessThanOrEqual(30);
    clearHistory();
  });

  it('built anywhere else: the Prism first ("1 of 2"), then the Glyph, and the Lens follows within 30 s', () => {
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
    expect(seen['make-spark/ink-lab']).toContain('refiner:ink lab'); // the Ink Refiner's Ink port to the Lab
    expect(seen['make-spark/glint-lab']).toContain('well:glint'); // a Lab from the port of the Glint Well that only sells
    expect(seen['make-glyph/well-labs'].some((k) => /^well:(glint|murk|ember)$/.test(k) || k === '')).toBe(true); // a Lab from the new Well's port
    if (seen['hold-flow/flow-fix']) expect(seen['hold-flow/flow-fix']).toContain('refiner:spark well:ember');
    for (const key of ['make-prism/cut-glyph', 'build-fabricator/cut-glyph']) if (seen[key]) expect(seen[key]).toContain('assembler:glyph lab');
    expect(seen['make-prism/cut-glyph'] ?? seen['build-fabricator/cut-glyph'], 'the cut came up on one of the two').toBeDefined();
  });

  it('the hints, by goal: the port the card names, and where it goes', () => {
    const g = rich();
    g.techs = ['P1', 'R1', 'P2', 'P3', 'L1'];
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
    expect(goalFocus(g)).toEqual([shard.id]); // "Drag from the Refiner's port into empty space and pick Lab"
    at(g, 'make-ink');
    expect(goalFocus(g)).toEqual([]); // the Well goes on a deposit: no node yet
    const mw = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    expect(goalFocus(g)).toEqual([mw.id]); // "...then drag from its port and pick Refiner"
    const ink = placeNode(g, 'refiner', 400, 400, { recipe: 'ink' })!;
    connect(g, mw.id, 0, ink.id);
    at(g, 'silt-exit');
    expect(goalFocus(g)).toEqual([ink.id, m.id]);
    connect(g, ink.id, 0, m.id);
    expect(goalFocus(g)).toEqual([ink.id]); // "...then drag from the second port and pick Void"
    const spark = placeNode(g, 'refiner', 400, 540, { recipe: 'spark' })!;
    at(g, 'route-lab');
    expect(goalFocus(g)).toEqual([spark.id]);
    const router = placeNode(g, 'router', 600, 540)!;
    connect(g, spark.id, 0, router.id);
    const lab = placeNode(g, 'lab', 900, 100)!;
    expect(goalFocus(g)).toEqual([router.id, lab.id, m.id]);
    at(g, 'bulk-upgrade');
    expect(goalFocus(g)).toEqual([w.id]);
    // Ready to claim: nothing.
    g.goal.ready = true;
    expect(goalFocus(g)).toEqual([]);
    clearHistory();
  });
});

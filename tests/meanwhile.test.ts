// The goal cards' "while you wait" lines (Goal.meanwhile in src/goals.ts): what they say, when they show,
// that each is true on the board a card-following player has, and that nothing later undoes them.
import { describe, expect, it } from 'vitest';
import { claimGoal, clearHistory, connect, cutWire, expandBoard, placeNode } from '../src/actions';
import { advice } from '../src/advice';
import { RULES, TECHS } from '../src/content';
import { nodeCost } from '../src/economy';
import { GOALS, MAIN_GOALS, activeGoal, goalById, goalView, meanwhileOf } from '../src/goals';
import { Game, cloneGame } from '../src/state';
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
    mouse: 'You have the β you need: remove the wire from the Glyph Assembler to the Lab.',
    touch: 'You have the β you need: remove the wire from the Glyph Assembler to the Lab.',
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

  it('"remove the Glyph wire" is asked only while the β is covered and the Fabricator is not paid for', () => {
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

/** Plays a run and keeps the board as it stood the first time each line came up undone. */
function snapshots(name: string, opts: Parameters<typeof playByTheCard>[0]) {
  const snaps: Snap[] = [];
  const run = playByTheCard({
    ...opts,
    onIdle: (g) => {
      const goal = activeGoal(g)!;
      const line = meanwhileOf(g);
      if (!line || line.done(g) || snaps.some((s) => s.id === goal.id)) return;
      snaps.push({ id: goal.id, g: cloneGame(g)!, from: `${name}, ${goal.id} at ${Math.round(g.time)} s` });
    },
  });
  return { run, snaps };
}

describe('"while you wait": each line is true, and nothing undoes it', () => {
  const cards = snapshots('cards', { tendOrders: 'asked' });
  const tips = [0, 1, 2, 3].map((seed) => snapshots(`cards and tips, seed ${seed}`, { tips: true, seed }));

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
        expect(t.text, t.text).not.toMatch(/^Remove /);
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

// The dwell on the step of a goal card's "while you wait" line (ADVICE.lineHold, lineGiven in src/advice.ts).
//
// A step that costs credits is only given from what the card's own next purchase does not need (the reserve), and
// the reserve is worked out from the game's smoothed rates, which ripple as the machines work in bursts. Without a
// dwell the card's row blinked on a board nobody had touched: "Show me", then "Saving for this · about 2½ min", then
// "Show me" again, seconds apart. Held to here: once given, a step stays given through the ripple; it lets go after
// lineHold seconds of a steady shortfall, and at once when the credits are spent; the dwell belongs to one step of
// one game; and what the card says it is saving for (lineHeld, through goalView) agrees with the step at every look.
// Each case is run again with the dwell off (ADVICE.lineHold = 0, the rule as it was), where the same check fails.
import { describe, expect, it } from 'vitest';
import { applyAdvice, ADVICE, lineAdvice, lineHeld } from '../src/advice';
import { connect, expandBoard, freeDeposits, placeNode, upgrade } from '../src/actions';
import { TECHS } from '../src/content';
import { nodeCost } from '../src/economy';
import { GOALS, goalView, meanwhileOf, ownPairs } from '../src/goals';
import { Game, cloneGame, deserialize, serialize } from '../src/state';
import { Bot, POLICIES } from '../tools/pacing';
import { market, rich, well } from './helpers';

const at = (g: Game, id: string) => {
  g.goal = { i: GOALS.findIndex((x) => x.id === id), ready: false };
  g.goalAt = { i: g.goal.i, t: g.time };
};

/** The dwell as shipped, in game seconds (the checks count against this, not against whatever a control has set). */
const HOLD = 10;
/** Credits a second at the top and at the bottom of the ripple (what Game.creditRate swings between on a card player's board of minute seven). */
const HIGH = 4.3;
const LOW = 3.3;
/** Seconds until Assembly's α is in hand on the board below, and what is left free over the step's price at the top of the ripple. */
const WAIT = 150;
const SPARE = 50;

/**
 * "Assemble your first Circuit" where the blinking was seen: its second line up, the first expansion's deposits
 * each with a Drill and a Lab, the board expanded again. The line's next step is a Drill on a free deposit of the
 * second expansion, given only with its Lab's price free as well. Assembly is 150 s away at 1 α a second, so of the
 * Assembler's 600¢ the reserve keeps what the credits a second do not bring in by then: nothing at 4.3 ¢/s, 105¢ at
 * 3.3 ¢/s. The player holds the step's price and 50¢ more: covered at the top of the ripple, 55¢ short at the
 * bottom, and in hand throughout. Nothing here runs the simulation: the rates are set by hand, the clock too.
 */
function board(): { g: Game; need: number; t0: number } {
  const g = rich();
  g.techs = ['P1', 'R1', 'P2', 'P3'];
  connect(g, well(g).id, 0, market(g).id);
  for (const dep of [2, 3, 4]) connect(g, placeNode(g, 'well', 0, 0, { depositId: dep })!.id, 0, market(g).id);
  at(g, 'make-glyph');
  expect(expandBoard(g)).toBe(true);
  for (let i = 0; i < 6 && meanwhileOf(g)?.id === 'well-labs'; i++) expect(applyAdvice(g, lineAdvice(g)!)).toBe(true);
  expect(meanwhileOf(g)!.id).toBe('expand-labs');
  expect(lineAdvice(g)).toMatchObject({ expand: true });
  expect(applyAdvice(g, lineAdvice(g)!)).toBe(true);
  expect(lineAdvice(g)).toMatchObject({ build: 'well' });
  expect(freeDeposits(g).length).toBeGreaterThanOrEqual(2);
  g.time = 400;
  g.data.a = TECHS.P4.cost.a! - WAIT;
  g.dataRate.a = 1;
  g.creditRate = HIGH;
  const need = nodeCost(g, 'well') + nodeCost(g, 'lab');
  g.credits = need + SPARE;
  expect(nodeCost(g, 'assembler') - LOW * WAIT).toBeGreaterThan(SPARE); // short at the bottom of the ripple...
  expect(nodeCost(g, 'assembler') - HIGH * WAIT).toBeLessThanOrEqual(0); // ...and nothing kept back at the top
  return { g, need, t0: g.time };
}

type Face = 'step' | 'held';

/**
 * What the card's row shows right now: "Show me" (a step) or "Saving for this" (held). Never both and never
 * neither, whichever of the two is asked first, and asking again at the same moment changes nothing.
 */
function face(g: Game, heldFirst = false): Face {
  const ask = () => ({ step: lineAdvice(g), held: lineHeld(g), view: goalView(g)!.meanwhile!.held ?? null });
  const first = heldFirst ? { held: lineHeld(g), step: lineAdvice(g), view: goalView(g)!.meanwhile!.held ?? null } : ask();
  const again = ask();
  const where = `at ${g.time.toFixed(2)} s, ${g.creditRate.toFixed(2)} ¢/s, ${g.credits.toFixed(0)}¢`;
  expect(!!first.step !== !!first.held, `a step or held, one and only one, ${where}`).toBe(true);
  expect(first.view, where).toEqual(first.held);
  expect(!!again.step, where).toBe(!!first.step);
  expect(again.held, where).toEqual(first.held);
  return first.step ? 'step' : 'held';
}

/** Run `f` with the dwell set to `hold` seconds (0: off, the rule as it was). */
function withHold<T>(hold: number, f: () => T): T {
  const was = ADVICE.lineHold;
  ADVICE.lineHold = hold;
  try {
    return f();
  } finally {
    ADVICE.lineHold = was;
  }
}

/** The ripple: the credits a second swing between LOW and HIGH every 3.3 s, starting at the top. */
const ripple = (t: number) => (HIGH + LOW) / 2 + ((HIGH - LOW) / 2) * Math.cos((2 * Math.PI * t) / 3.3);

/** Look at the row every `dt` seconds for `seconds`, the rate following `rate(t)`; the faces seen, with their times. */
function watch(g: Game, seconds: number, dt: number, rate: (t: number) => number): { t: number; face: Face }[] {
  const t0 = g.time;
  const out: { t: number; face: Face }[] = [];
  for (let k = 0; k * dt <= seconds + 1e-9; k++) {
    const t = Math.round(k * dt * 1000) / 1000;
    g.time = t0 + t;
    g.creditRate = rate(t);
    out.push({ t, face: face(g, k % 2 === 1) });
  }
  return out;
}

/** Changes of face in a list of looks. */
const changes = (looks: { face: Face }[]) => looks.filter((x, i) => i > 0 && x.face !== looks[i - 1].face).length;

/** A case of the dwell: its checks hold as the game is, and the very same checks fail with the dwell off (the rule as it was). */
function dwellCase(name: string, body: () => void) {
  it(name, () => {
    body();
    expect(() => withHold(0, body), 'with ADVICE.lineHold = 0 the same checks must fail').toThrow();
    expect(ADVICE.lineHold).toBe(HOLD);
  });
}

describe('the step of a card\'s line does not blink with the reserve (ADVICE.lineHold)', () => {
  it('the constant: ten game seconds', () => {
    expect(ADVICE.lineHold).toBe(HOLD);
  });

  dwellCase('through a ripple of the credits a second the step stays on offer; with no dwell it comes and goes, saying "about 2½ min" each time', () => {
    const { g } = board();
    const control = cloneGame(g)!;
    // A minute of looks, twenty a second, on a board nobody touches.
    const looks = watch(g, 60, 0.05, ripple);
    expect(looks.every((x) => x.face === 'step')).toBe(true);
    expect(changes(looks)).toBe(0);
    // The control: the same board, the same ripple, no dwell. The same two checks fail.
    const before = withHold(0, () => {
      const seen = watch(control, 60, 0.05, ripple);
      // Each time it is withdrawn the row says it is saving for the Assembler and the step together, minutes away.
      control.creditRate = LOW;
      const held = lineHeld(control)!;
      expect(held.sym).toBe('¢');
      expect(held.cost).toBe(nodeCost(control, 'assembler') + nodeCost(control, 'well') + nodeCost(control, 'lab'));
      expect(held.eta).toBeGreaterThan(120);
      return seen;
    });
    expect(before.every((x) => x.face === 'step')).toBe(false);
    // 60 s of a 3.3 s ripple: withdrawn and given again some eighteen times.
    expect(changes(before)).toBeGreaterThanOrEqual(30);
    // The dwell is never the stricter of the two: wherever the free funds alone give the step, it is given.
    before.forEach((x, i) => {
      if (x.face === 'step') expect(looks[i].face, `at ${x.t} s`).toBe('step');
    });
  });

  dwellCase('it lets go after lineHold seconds of a steady shortfall, and the count starts over whenever the free funds cover it again', () => {
    const { g, need } = board();
    // Covered once, at the first look; from then on the income stays at the bottom of the ripple.
    const steady = (t: number) => (t === 0 ? HIGH : LOW);
    const looks = watch(cloneGame(g)!, 30, 0.5, steady);
    for (const x of looks) expect(x.face, `at ${x.t} s`).toBe(x.t < HOLD ? 'step' : 'held');
    expect(changes(looks)).toBe(1); // ...and once withdrawn it does not come back by itself
    // Covered again for one look at 6 s: ten seconds from there.
    const again = watch(cloneGame(g)!, 30, 0.5, (t) => (t === 0 || t === 6 ? HIGH : LOW));
    for (const x of again) expect(x.face, `at ${x.t} s`).toBe(x.t < 6 + HOLD ? 'step' : 'held');
    // What the row says once it has let go: the Assembler and the step together.
    const h = cloneGame(g)!;
    watch(h, 12, 0.5, steady);
    expect(lineAdvice(h)).toBeNull();
    expect(goalView(h)!.meanwhile!.held).toEqual({ cost: need + nodeCost(h, 'assembler'), sym: '¢', eta: expect.any(Number) });
    // With the dwell off the same board withdraws the step at the first look that is short.
    const off = withHold(0, () => watch(cloneGame(g)!, 30, 0.5, steady));
    for (const x of off) expect(x.face, `at ${x.t} s`).toBe(x.t === 0 ? 'step' : 'held');
    // A longer dwell is a longer hold: the constant is what is counted.
    const long = withHold(20, () => watch(cloneGame(g)!, 30, 0.5, steady));
    for (const x of long) expect(x.face, `at ${x.t} s`).toBe(x.t < 20 ? 'step' : 'held');
  });

  dwellCase('credits that are spent withdraw it at once, and it only comes back when the free funds cover it', () => {
    const { g, need } = board();
    expect(face(g)).toBe('step');
    g.time += 2;
    g.creditRate = LOW;
    expect(face(g)).toBe('step'); // short by the reserve, in hand: kept
    // The player spends on something else: the step's own price is no longer in hand.
    g.credits = need - 1;
    expect(face(g)).toBe('held');
    expect(lineAdvice(g)).toBeNull();
    // The credits come back a second later, the reserve still does not leave them free: not given by the dwell again...
    g.time += 1;
    g.credits = need + SPARE;
    expect(face(g)).toBe('held');
    g.time += 1;
    expect(face(g)).toBe('held');
    // ...only when the free funds cover it.
    g.creditRate = HIGH;
    expect(face(g)).toBe('step');
    g.creditRate = LOW;
    expect(face(g)).toBe('step');
    // The step that is being kept can be carried out: the credits are there.
    expect(applyAdvice(g, lineAdvice(g)!)).toBe(true);
  });

  dwellCase('the dwell belongs to one step: not the next step, the same step at another price, another step at the same price, another goal, a game whose clock went back, or a copy', () => {
    /** The board with its step on offer by the dwell alone: covered two seconds ago, 55¢ short now, the price in hand. */
    const kept = () => {
      const b = board();
      expect(face(b.g)).toBe('step');
      b.g.time += 2;
      b.g.creditRate = LOW;
      expect(face(b.g)).toBe('step');
      return b;
    };
    const short = (g: Game) => {
      g.creditRate = LOW;
      g.credits = nodeCost(g, 'well') + nodeCost(g, 'lab') + SPARE;
    };

    // The next step. The Drill is placed and its Lab built (the Lab from the credits in hand, as ever); the Drill the
    // line asks for after that is another step: short, it is held at once.
    let { g } = kept();
    const first = lineAdvice(g)!;
    expect(first).toMatchObject({ build: 'well' });
    expect(applyAdvice(g, first)).toBe(true);
    g.credits = nodeCost(g, 'lab');
    expect(lineAdvice(g)).toMatchObject({ build: 'lab' });
    expect(applyAdvice(g, lineAdvice(g)!)).toBe(true);
    short(g);
    expect(lineAdvice(cloneGame(g)!)).toBeNull(); // (a step that costs credits is next, and the free funds do not cover it)
    expect(lineHeld(g)).not.toBeNull();
    expect(face(g)).toBe('held');
    g.creditRate = HIGH;
    expect(lineAdvice(g)).toMatchObject({ build: 'well' });
    expect(lineAdvice(g)!.deposit).not.toBe(first.deposit);

    // The same step at another price: a Lab built elsewhere makes the step's Lab dearer.
    ({ g } = kept());
    const was = lineAdvice(g)!;
    g.credits = 1e6;
    expect(placeNode(g, 'lab', 900, 100)).toBeTruthy();
    short(g);
    expect(face(g)).toBe('held');
    g.creditRate = HIGH;
    expect(lineAdvice(g)).toMatchObject({ build: 'well', deposit: was.deposit });

    // Another step at the very same price. On "Make your first Silicon" the line that buys Speed on each Drill with a Lab
    // of its own goes from pair to pair, and a level costs the same on every Drill. The first pair's Drill is on offer
    // and kept; its level is bought, and its Lab's too, by hand, before the card is looked at again: what the line
    // asks for now is the next pair's Drill, for the price the kept step had. It is another step: held at once.
    const m = board().g;
    m.techs.push('P4');
    at(m, 'make-mist');
    m.credits = 1e6;
    for (let i = 0; i < 12 && meanwhileOf(m)?.id === 'expand-labs'; i++) expect(applyAdvice(m, lineAdvice(m)!)).toBe(true);
    expect(meanwhileOf(m)!.id).toBe('speed-pairs');
    for (const k of ['a', 'b', 'g'] as const) {
      m.data[k] = Math.max(0, (TECHS.P5.cost[k] ?? 0) - WAIT);
      m.dataRate[k] = 1;
    }
    const level = lineAdvice(m)!;
    expect(level).toMatchObject({ upgrade: 'speed' });
    const pair = ownPairs(m).find((x) => x.wells.some((w) => w.id === level.node))!;
    expect(pair).toBeTruthy();
    const price = level.cost!;
    m.creditRate = 1e3; // nothing of the card's purchase is kept back...
    m.credits = price + SPARE;
    expect(face(m)).toBe('step');
    m.time += 2;
    m.creditRate = 0; // ...and now all of it is
    expect(face(m)).toBe('step'); // kept
    m.credits = 1e6;
    expect(applyAdvice(m, lineAdvice(m)!)).toBe(true);
    expect(upgrade(m, pair.lab.id, 'speed')).toBe(true);
    m.credits = price + SPARE;
    const next = lineAdvice(Object.assign(cloneGame(m)!, { credits: 1e6 }))!;
    expect(next).toMatchObject({ upgrade: 'speed', cost: price });
    expect(next.node).not.toBe(level.node);
    expect(face(m)).toBe('held');
    m.creditRate = 1e3;
    expect(lineAdvice(m)).toMatchObject({ upgrade: 'speed', node: next.node });

    // Another goal with the same line and the same step ("Make your first Silicon" picks the expansion up where the
    // Circuit card left it): nothing is carried over. (With no credits coming in, all of its purchase is kept back.)
    ({ g } = kept());
    const glyph = lineAdvice(g)!;
    g.creditRate = 0;
    expect(face(g)).toBe('step'); // still the Circuit card: kept, whatever the reserve has grown to
    g.techs.push('P4');
    at(g, 'make-mist');
    expect(meanwhileOf(g)!.id).toBe('expand-labs');
    expect(face(g)).toBe('held');
    g.credits = 1e6;
    expect(lineAdvice(g)).toMatchObject({ build: 'well', deposit: glyph.deposit });

    // A game whose clock has gone back (a state from before put into the same game): no dwell, then or after.
    ({ g } = kept());
    g.time -= 5;
    expect(face(g)).toBe('held');
    g.time += 5;
    expect(face(g)).toBe('held');

    // A copy, and a save loaded again, start without it; the game they were taken from keeps its own. Nothing of
    // the dwell is in the save: the text is the same before the step was ever looked at and after.
    const fresh = board();
    const text = serialize(fresh.g).replace(/"savedAt":\d+/, '');
    ({ g } = kept());
    g.time = fresh.t0;
    g.creditRate = HIGH;
    expect(serialize(g).replace(/"savedAt":\d+/, '')).toBe(text);
    g.time += 2;
    g.creditRate = LOW;
    expect(face(cloneGame(g)!)).toBe('held');
    expect(face(deserialize(serialize(g))!)).toBe('held');
    expect(face(g)).toBe('step');
  });

  dwellCase('counted in game time from the looks: twenty looks a second or one give the same row, and a sparser look never shows a step the denser one does not', () => {
    const { g } = board();
    // The ripple, looked at every tick and once a second: on offer at every look, both ways.
    const dense = watch(cloneGame(g)!, 60, 0.05, ripple);
    const sparse = watch(cloneGame(g)!, 60, 1, ripple);
    expect(dense.every((x) => x.face === 'step')).toBe(true);
    expect(sparse.every((x) => x.face === 'step')).toBe(true);
    // Covered for half a second in every seven, then never again after 30 s. Whoever looks often enough to see the
    // half seconds keeps the step until ten seconds after the last of them (28.45 s); whoever looks every 2.5 s
    // only ever sees the first, and lets go ten seconds after that. Looking less often can lose a step, never gain one.
    const bursts = (t: number) => (t < 30 && t % 7 < 0.5 ? HIGH : LOW);
    const often = watch(cloneGame(g)!, 60, 0.05, bursts);
    const seldom = watch(cloneGame(g)!, 60, 2.5, bursts);
    const last = Math.max(...often.filter((x) => bursts(x.t) === HIGH).map((x) => x.t));
    expect(last).toBe(28.45);
    for (const x of often) expect(x.face, `at ${x.t} s`).toBe(x.t < last + HOLD ? 'step' : 'held');
    expect(seldom.filter((x) => bursts(x.t) === HIGH).map((x) => x.t)).toEqual([0]);
    for (const x of seldom) expect(x.face, `at ${x.t} s`).toBe(x.t < HOLD ? 'step' : 'held');
    const faceAt = new Map(often.map((x) => [x.t, x.face]));
    for (const x of seldom) if (x.face === 'step') expect(faceAt.get(x.t), `at ${x.t} s`).toBe('step');
  });
});

describe('the dwell in the real game: the pacing tool\'s card player who claims 4 to 8 s late, to minute seven', () => {
  /**
   * Seed 0 up to 7 min 12 s, the card looked at on every tick as the page looks at it. Around 6:50 this player has
   * just built the Lab of the Ore Drill of the second expansion and the line asks for a Drill on the Sand deposit;
   * their hands are busy for six seconds more. Returns every look at a line that is up and not done.
   */
  const play = (hold: number) => withHold(hold, () => {
    const bot = new Bot({ ...POLICIES.cardonly, claimDelay: [4, 8] }, 0, 7.2);
    const looks: { t: number; face: Face; text: string; alone: boolean }[] = [];
    const bad: string[] = [];
    const note = bot.noteNothing.bind(bot);
    bot.noteNothing = () => {
      note();
      const g = bot.g;
      const v = goalView(g);
      const mw = v && !v.ready ? v.meanwhile : undefined;
      if (!mw || mw.done) return;
      const a = lineAdvice(g);
      // A step or held, one and only one (on this player's boards a line that is not done always has a next step).
      if (!!a === !!mw.held) bad.push(`${g.time.toFixed(2)}: step ${!!a}, held ${!!mw.held}`);
      // The free funds alone: a copy of the game has no memory of what was given.
      const free = !!lineAdvice(cloneGame(g)!);
      if (free && !a) bad.push(`${g.time.toFixed(2)}: the free funds cover the step and it is not given`);
      looks.push({ t: g.time, face: a ? 'step' : 'held', text: a ? a.text.mouse : '', alone: !!a && !free });
    };
    bot.run();
    return { looks, bad };
  });
  /** Stretches of "Saving for this" shorter than ten seconds with the same step on offer right before and right after. */
  const blinks = (looks: { t: number; face: Face; text: string }[]) => {
    let n = 0;
    for (let i = 1; i < looks.length; i++) {
      if (looks[i].face !== 'held' || looks[i - 1].face !== 'step') continue;
      let j = i;
      while (j < looks.length && looks[j].face === 'held') j++;
      if (j < looks.length && looks[j].text === looks[i - 1].text && looks[j].t - looks[i].t < 10) n++;
      i = j;
    }
    return n;
  };

  it('with the dwell the row does not blink once; without it, the same seven minutes blink at least five times', () => {
    const now = play(HOLD);
    const before = play(0);
    expect(now.bad, now.bad.join('\n')).toEqual([]);
    expect(before.bad, before.bad.join('\n')).toEqual([]);
    expect(blinks(now.looks)).toBe(0);
    expect(blinks(before.looks)).toBeGreaterThanOrEqual(5);
    // The dwell did the keeping: there were looks at which the free funds alone would not have given the step...
    expect(now.looks.filter((x) => x.alone).length).toBeGreaterThan(20);
    // ...and with it off there is none: the control is the rule as it was.
    expect(before.looks.filter((x) => x.alone).length).toBe(0);
    console.info(`line dwell, seed 0 claiming 4-8 s late, to 7:12: blinks ${blinks(before.looks)} -> ${blinks(now.looks)}; looks kept by the dwell alone ${now.looks.filter((x) => x.alone).length} of ${now.looks.length}`);
  });
});

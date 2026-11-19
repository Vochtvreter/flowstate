// The adviser asked through its worker's code (src/ui/advice-core.ts) must say exactly what it says when
// asked directly: the goal card moved onto the worker so that the page never works a verdict out, and
// nothing about the tips may change with it.
//
// Two things could go wrong. A copy of the game could differ from the game (it is a structured clone, as
// postMessage makes one). And the adviser's memory between calls, which hangs on the game OBJECT, could be
// lost when every call brings a new copy: the verdict it keeps for some seconds, the tip it holds on to.
// advice-core pours every copy into one long-lived game for that reason; the second test follows a wait
// second by second, on the live game and through the core side by side.
import { describe, expect, test } from 'vitest';
import { Advice, advice, adviceQuiet, applyAdvice, waitInfo, waitKind } from '../src/advice';
import { connect, cutWire, upgrade } from '../src/actions';
import { RULES } from '../src/content';
import { research } from '../src/economy';
import { activeGoal } from '../src/goals';
import { Game, cloneGame } from '../src/state';
import { AdviceAnswer, answer } from '../src/ui/advice-core';
import { boardKey, builtRev } from '../src/ui/advice-client';
import { playByTheCard } from './cardPlayer';
import { run } from './helpers';

/** A plain copy as the page posts it: a structured clone of the game without its pending events. */
const post = (g: Game, id: number, fresh: boolean) => answer({ id, key: `k${id}`, fresh, game: structuredClone({ ...g, events: [] }) });

const said = (a: Advice | null) => (a ? { text: a.text, saves: a.saves, eta: a.eta, cost: a.cost, kind: a.kind } : null);

/**
 * Boards from the scripted newcomer's run: one every `every` seconds of waiting. With `lines` false the
 * player ignores the cards' "while you wait" lines; the adviser then has far more to say (it offers a
 * card-follower two tips a run), which is what these tests need boards for.
 */
function boards(every: number, lines = true): Game[] {
  const out: Game[] = [];
  let n = 0;
  playByTheCard({
    tips: true,
    meanwhile: lines,
    onIdle: (g) => {
      if (!waitKind(g) || n++ % every) return;
      const copy = cloneGame(g)!;
      copy.rev = g.rev;
      out.push(copy);
    },
  });
  return out;
}

const real = boards(12);
const loose = boards(5, false);

describe('the adviser through its worker code', () => {

  test('a copy of the game gets the answer the game itself gets', () => {
    expect(real.length).toBeGreaterThan(25);
    expect(loose.length).toBeGreaterThan(25);
    let tips = 0;
    [...real, ...loose].forEach((g, i) => {
      // Two independent copies: asking changes nothing in the game, but each call keeps its own notes.
      const direct = cloneGame(g)!;
      const kind = waitKind(direct);
      const info = waitInfo(direct);
      const a = advice(direct);
      const via = post(g, i, true);
      expect(via.error).toBeUndefined();
      expect(via.kind).toBe(kind);
      expect(via.info).toEqual(info);
      expect(said(via.advice)).toEqual(said(a));
      expect(via.advice).toEqual(a);
      expect(via.time).toBe(g.time);
      expect(via.goal).toBe(g.goal.i);
      if (a) tips++;
    });
    expect(tips).toBeGreaterThan(10);
  });

  test('followed second by second, it keeps and changes its verdicts exactly as on the live game', () => {
    // A long Data wait, a credits wait and the Flow goal, each from the moment the newcomer starts waiting.
    // (The Flow goal of the player who follows the lines is short: the waits of the one who reads none stand in.)
    const starts = ['make-glyph', 'build-fabricator', 'hold-flow', 'make-mist'].map((id) => [...real, ...loose].find((g) => waitKind(g) && idOf(g) === id)!);
    let id = 1000;
    let kept = 0, fresh = 0;
    for (const start of starts) {
      expect(start).toBeTruthy();
      const g = cloneGame(start)!;
      let first = true;
      let before: AdviceAnswer | null = null;
      for (let s = 0; s < 75 && !g.goal.ready; s++) {
        run(g, 1);
        g.events.length = 0;
        const a = advice(g);
        const via = post(g, id++, first);
        first = false;
        expect(via.kind).toBe(waitKind(g));
        expect(via.info).toEqual(waitInfo(g));
        expect(via.advice).toEqual(a);
        // The verdict was not worked out again: it is the one from a second ago, a second older. (Seconds with
        // no wait at all, once the credits are in hand and nobody builds, have no verdict to keep or work out.)
        if (before && via.kind && Math.abs(before.life - 1 - via.life) < 1e-6) kept++;
        else if (via.kind) fresh++;
        before = via;
        // Half-way, the player does what the tip says: a different board, and both must think again.
        if (s === 30 && a) expect(applyAdvice(g, a)).toBe(true);
      }
    }
    // Most seconds the kept verdict answers; a new one is worked out every few seconds, not every second.
    expect(kept).toBeGreaterThan(fresh * 3);
    expect(fresh).toBeGreaterThan(8);
  });

  test('a game that makes the adviser throw is an answer with no tip, not an exception', () => {
    // A board the adviser has a tip for, so it is certain to look at the nodes it is not given.
    const tipped = loose.find((g) => advice(cloneGame(g)!))!;
    expect(tipped).toBeTruthy();
    const broken = { ...tipped, nodes: null } as unknown as Game;
    const a = answer({ id: 1, key: 'x', fresh: true, game: broken });
    expect(a.error).toBeTruthy();
    expect(a.advice).toBeNull();
    expect(a.kind).toBeNull();
    // ...and the next good copy is answered as usual.
    const good = post(tipped, 2, false).advice;
    expect(good).toBeTruthy();
    expect(good).toEqual(advice(cloneGame(tipped)!));
  });
});

// The adviser keeps three things between calls. Two are in the game itself and
// travel with every copy (Game.edits: the quiet after a change, and no repeat of what was just done). The
// third hangs on the game OBJECT (which tip was on offer, which have left): it only works here because the
// copies are poured into one long-lived game. Each is held to through the worker's code, as the page uses it.
describe('what the adviser remembers, through its worker code', () => {
  const reads = (a: Advice | null) => (a ? a.text.mouse.replace(/ \(\d+[¢αβγ]\)/g, '') : '');

  test('the quiet after a change to the board: no tip for 20 s, and each answer stands only until the quiet is over', () => {
    expect(RULES.tips.quiet).toBe(20);
    // A board with a tip on offer, and a change the tip did not ask for.
    const g = cloneGame(loose.find((x) => advice(cloneGame(x)!) && x.credits >= 80)!)!;
    let id = 5000;
    expect(post(g, id++, true).advice).not.toBeNull();
    const well = g.nodes.find((n) => n.type === 'well')!;
    expect(upgrade(g, well.id, 'speed')).toBe(true);
    const at = g.time;
    expect(g.edits![g.edits!.length - 1].at).toBe(at);
    let quiet = 0;
    for (let s = 0; s < 19; s++) {
      const via = post(g, id++, false);
      // (The copy carries the edit: the worker's game knows of it without being told.)
      expect(via.advice, `${s} s after the change`).toBeNull();
      expect(via.kind).toBe(waitKind(g));
      expect(via.life).toBeCloseTo(Math.min(15, adviceQuiet(g)), 6);
      expect(via.time + via.life).toBeLessThanOrEqual(at + 20 + 1e-6);
      quiet++;
      run(g, 1);
      g.events.length = 0;
    }
    expect(quiet).toBe(19);
    // Past the quiet the worker's game answers as the live game does (here: the tip is back, or another is on offer).
    run(g, 1.5);
    const a = advice(g);
    expect(post(g, id++, false).advice).toEqual(a);
    expect(adviceQuiet(g)).toBe(0);
  });

  test('a tip is said once on an untouched board; an adviser handed a new game each time would say it again and again', () => {
    // The newcomer who follows tips and no lines, a minute and a half into the wait for Quartz Deposits (order seed
    // 3): two tips come and go there, and without the adviser's memory they come back again and again. (It was a
    // minute into the wait for Assembly, on seed 1, with an earlier build's prices and Labs.)
    let n = 0;
    let board: Game | null = null;
    playByTheCard({
      tips: true, seed: 3, meanwhile: false,
      onIdle: (g) => {
        if (board || !waitKind(g) || activeGoal(g)!.id !== 'make-mist') return;
        if (++n === 90) { board = cloneGame(g)!; board.rev = g.rev; }
      },
    });
    expect(board).not.toBeNull();
    const kept = cloneGame(board!)!;   // asked through the worker's code, as one game that lives on
    const fresh = cloneGame(board!)!;  // asked as a new game every second
    kept.rev = fresh.rev = board!.rev;
    const through: string[] = [];
    const forgetful: string[] = [];
    let id = 6000;
    for (let s = 0; s < 150 && !kept.goal.ready && waitKind(kept); s++) {
      const a = reads(post(kept, id++, s === 0).advice);
      if (through[through.length - 1] !== a) through.push(a);
      const b = reads(advice(cloneGame(fresh)!));
      if (forgetful[forgetful.length - 1] !== b) forgetful.push(b);
      run(kept, 1);
      run(fresh, 1);
      kept.events.length = fresh.events.length = 0;
    }
    const tips = through.filter(Boolean);
    expect(tips.length).toBeGreaterThanOrEqual(2);
    expect(new Set(tips).size, through.map((x) => x || '—').join(' | ')).toBe(tips.length);
    // (The control: without the memory the same two tips come back many times. If this ever stops being so, the board no longer tests anything.)
    const again = forgetful.filter(Boolean);
    expect(again.length - new Set(again).size).toBeGreaterThanOrEqual(5);
  });

  test('"the wait will not end without it" arrives as Infinity, a number, after the copy there and the copy back', () => {
    // Saving for the Fabricator with every wire into a Market cut: nothing is sold, the wait would never end.
    const g = cloneGame(real.find((x) => waitKind(x) === 'credits' && idOf(x) === 'build-fabricator')!)!;
    const markets = new Set(g.nodes.filter((x) => x.type === 'market').map((x) => x.id));
    for (const w of g.wires.filter((x) => markets.has(x.to)).map((x) => x.id)) expect(cutWire(g, w)).toBe(true);
    g.edits = [];
    run(g, 2);
    g.events.length = 0;
    // What the worker posts back is a structured clone of the answer.
    const back = structuredClone(post(g, 7000, true));
    expect(back.error).toBeUndefined();
    expect(back.info!.eta).toBe(Infinity);
    expect(back.advice).not.toBeNull();
    expect(back.advice!.saves).toBe(Infinity);
    expect(typeof back.advice!.saves).toBe('number');
    // (Through JSON it would not: that is why the page and the worker never talk in JSON.)
    expect(JSON.parse(JSON.stringify(back)).advice.saves).toBeNull();
  });
});

const idOf = (g: Game) => ['wire-market', 'second-well', 'wire-all-wells', 'build-refiner', 'sell-shard', 'upgrade-well', 'feed-lab', 'research-murk', 'make-ink',
  'silt-exit', 'make-spark', 'first-order', 'route-lab', 'expand', 'make-glyph', 'hold-flow', 'study-glyph', 'make-mist', 'make-prism', 'bulk-upgrade',
  'build-fabricator', 'make-lens'][g.goal.i];

describe('what counts as "the board changed" for a tip', () => {
  test('moving or merely touching a node does not; building, wiring, upgrading and researching do', () => {
    const g = cloneGame(real[10])!;
    const key = boardKey(g);
    const rev = builtRev(g);
    // The board bumps g.rev for a drag that ends where it began, and moves x and y for one that does not.
    g.rev++;
    expect(builtRev(g)).toBe(rev);
    g.nodes[1].x += 40;
    g.nodes[1].y += 20;
    g.rev++;
    expect(builtRev(g)).toBe(rev);
    expect(boardKey(g)).toBe(key);
    // Time passing and income change nothing either.
    run(g, 5);
    expect(boardKey(g)).toBe(key);

    g.credits += 5000;
    g.data.a += 5000;
    const well = g.nodes.find((n) => n.type === 'well')!;
    expect(upgrade(g, well.id, 'speed')).toBe(true);
    const afterUpgrade = builtRev(g);
    expect(afterUpgrade).toBeGreaterThan(rev);
    const lab = g.nodes.find((n) => n.type === 'lab')!;
    const free = g.nodes.find((n) => n.type === 'well' && !g.wires.some((w) => w.from === n.id && w.to === lab.id))!;
    expect(connect(g, free.id, 0, lab.id)).not.toBeNull();
    const afterWire = builtRev(g);
    expect(afterWire).toBeGreaterThan(afterUpgrade);
    const tech = ['P2', 'P3', 'R2', 'L3'].find((t) => research(g, t));
    expect(tech).toBeTruthy();
    expect(builtRev(g)).toBeGreaterThan(afterWire);
  });

  test('the goal and the order are part of it', () => {
    const g = cloneGame(real[10])!;
    const key = boardKey(g);
    g.goal = { i: g.goal.i, ready: true };
    expect(boardKey(g)).not.toBe(key);
    g.goal = { i: g.goal.i + 1, ready: false };
    const next = boardKey(g);
    expect(next).not.toBe(key);
    g.order = { mat: 'shard', need: 8, base: 0, got: 0, reward: { credits: 1, a: 1, b: 0, g: 0 }, created: g.time, lastProgress: g.time, ready: false };
    const withOrder = boardKey(g);
    expect(withOrder).not.toBe(next);
    g.order.ready = true;
    expect(boardKey(g)).not.toBe(withOrder);
  });
});

describe('times in words', () => {
  test('round, human numbers; nothing for a wait that never ends', async () => {
    const { aboutTime } = await import('../src/ui/hud-words');
    expect(aboutTime(3)).toBe('a few seconds');
    expect(aboutTime(8)).toBe('about 10 s');
    expect(aboutTime(12)).toBe('about 10 s');
    expect(aboutTime(38)).toBe('about 40 s');
    expect(aboutTime(54)).toBe('about 50 s');
    expect(aboutTime(55)).toBe('about 1 min');
    expect(aboutTime(89)).toBe('about 1 min');
    expect(aboutTime(95)).toBe('about 2 min');
    expect(aboutTime(218)).toBe('about 4 min');
    expect(aboutTime(3600)).toBe('over an hour');
    expect(aboutTime(Infinity)).toBe('');
  });

  test('what a move bought is said a little finer, to ten seconds under ten minutes', async () => {
    const { aboutSpan, capFirst } = await import('../src/ui/hud-words');
    expect(aboutSpan(3)).toBe('a few seconds');
    expect(aboutSpan(17.5)).toBe('about 20 s');
    expect(aboutSpan(55)).toBe('about 1 min');
    expect(aboutSpan(78)).toBe('about 1 min 20 s');
    expect(aboutSpan(122)).toBe('about 2 min');
    expect(aboutSpan(214)).toBe('about 3 min 30 s');
    expect(aboutSpan(599)).toBe('about 10 min');
    expect(aboutSpan(912)).toBe('about 15 min');
    expect(aboutSpan(Infinity)).toBe('');
    expect(capFirst('the Fabricator')).toBe('The Fabricator');
  });
});

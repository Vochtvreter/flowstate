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
import { Advice, advice, applyAdvice, waitInfo, waitKind } from '../src/advice';
import { connect, upgrade } from '../src/actions';
import { research } from '../src/economy';
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
    const starts = ['make-glyph', 'build-fabricator', 'hold-flow', 'make-mist'].map((id) => real.find((g) => waitKind(g) && idOf(g) === id)!);
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
        // The verdict was not worked out again: it is the one from a second ago, a second older.
        if (before && via.kind && Math.abs(before.life - 1 - via.life) < 1e-6) kept++;
        else fresh++;
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

const idOf = (g: Game) => ['wire-market', 'second-well', 'wire-all-wells', 'build-refiner', 'sell-shard', 'upgrade-well', 'feed-lab', 'research-murk', 'make-ink',
  'silt-exit', 'make-spark', 'first-order', 'route-lab', 'expand', 'make-glyph', 'hold-flow', 'study-glyph', 'make-mist', 'make-prism', 'three-orders',
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
});

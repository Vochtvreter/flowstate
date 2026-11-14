// Randomised property test: no sequence of board edits, undo and redo creates or destroys credits.
//
// A seeded generator plays a few hundred random actions per seed (place, upgrade, delete, wire, cut, splice,
// re-tool, Router settings and the Favour preset, expand, claim, undo, redo, stale drag snapshots, asking the
// adviser for a tip and following it) with the simulation running in between, and after every single action
// checks the books:
//
//     credits + what the board would refund + what was sunk into expansions − everything ever earned
//
// must not move. It also checks that the board stays well-formed, that nothing goes negative or non-finite, and
// that undo and redo never make a machine younger than it was (which would hide it from Flow).
// On a failure the message names the seed, the step and the action, so it can be replayed.
import { describe, expect, it } from 'vitest';
import {
  autoBalance, canConnect, canFavour, canRedo, canUndo, claimGoal, claimOrder, connect, cutWire, cutWires, deleteNode, expandBoard, favour,
  favouredWire, freeDeposits, placeNode, pushUndo, raisePriority, recipesFor, redo, refundOf, setFilter, setMode, setRecipe, setWeight, splice,
  undo, upgrade, upgradeAll, upgradeSaturatedWires, upgradeWire,
} from '../src/actions';
import { advice, applyAdvice, waitInfo } from '../src/advice';
import { HOTBAR, MAT_IDS, MatId, NodeType, TECH_IDS, Track } from '../src/content';
import { expansionCost, nodeCostAt, nodeUnlocked, research, upgradeValue } from '../src/economy';
import { GOALS } from '../src/goals';
import { orderView } from '../src/orders';
import { outPortCount, tick } from '../src/sim';
import { Game, RouterMode, Snapshot, serialize, snapshot } from '../src/state';
import { fresh } from './helpers';

function prng(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** What the whole board would refund if every node and wire were sold, one after another. */
export function boardValue(g: Game): number {
  let v = 0;
  const counts: Partial<Record<NodeType, number>> = {};
  for (const n of g.nodes) {
    counts[n.type] = (counts[n.type] ?? 0) + 1;
    v += upgradeValue(n);
  }
  for (const type of Object.keys(counts) as NodeType[]) for (let i = 0; i < counts[type]!; i++) v += nodeCostAt(type, i);
  for (const w of g.wires) v += w.paid;
  return v;
}

/** Fail with a message built only when needed (this runs tens of thousands of times). */
function must(ok: boolean, message: () => string) {
  if (!ok) throw new Error(message());
}

/** Things that must hold for any board the player can reach. */
function checkBoard(g: Game, where: string) {
  const ids = new Set<number>();
  for (const n of g.nodes) {
    must(!ids.has(n.id), () => `${where}: node id ${n.id} twice`);
    ids.add(n.id);
    for (const v of [n.x, n.y, n.util, n.rate, n.prog, n.born, n.lv.speed, n.lv.eff, n.lv.buffer]) {
      must(Number.isFinite(v), () => `${where}: node ${n.id} has a non-finite number`);
    }
    for (const bag of [n.inb, n.outb]) {
      for (const m in bag) {
        const have = bag[m as MatId] ?? 0;
        must(have >= -1e-6 && Number.isFinite(have), () => `${where}: node ${n.id} holds ${have} ${m}`);
      }
    }
  }
  const wells = g.nodes.filter((n) => n.type === 'well');
  must(wells.length >= 1, () => `${where}: no Well left`);
  must(new Set(wells.map((n) => n.depositId)).size === wells.length, () => `${where}: two Wells on one deposit`);
  const seen = new Set<string>();
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const w of g.wires) {
    must(ids.has(w.from) && ids.has(w.to), () => `${where}: wire ${w.id} hangs loose`);
    must(!ids.has(w.id), () => `${where}: wire id ${w.id} is also a node id`);
    const key = `${w.from}:${w.port}:${w.to}`;
    must(!seen.has(key), () => `${where}: duplicate wire ${key}`);
    seen.add(key);
    must(w.port < Math.max(1, outPortCount(byId.get(w.from)!)), () => `${where}: wire ${w.id} leaves a port that does not exist`);
    must(w.paid >= 0 && Number.isFinite(w.rate), () => `${where}: wire ${w.id} has a bad number`);
  }
  for (const v of [g.credits, g.lifetime, g.data.a, g.data.b, g.data.g, g.flow, g.flowHold, g.flowStreak, g.creditRate, g.time]) {
    must(Number.isFinite(v), () => `${where}: a non-finite total`);
  }
  must(g.credits >= -1e-6, () => `${where}: credits below zero (${g.credits})`);
  for (const k of ['a', 'b', 'g'] as const) must(g.data[k] >= 0, () => `${where}: negative Data`);
  must(g.flow >= 0 && g.flow <= 1, () => `${where}: Flow out of range`);
  if (g.order) must(g.order.got >= 0 && g.order.got <= g.order.need, () => `${where}: order progress out of range`);
}

/** Goals whose card can be a wait, so that the adviser has something to say: saving credits, saving Data, Flow, an order. */
const WAITING_GOALS = ['second-well', 'research-murk', 'make-spark', 'first-order', 'make-glyph', 'hold-flow', 'make-mist', 'build-fabricator']
  .map((id) => GOALS.findIndex((x) => x.id === id));

/** Play `steps` random actions and check the books after each one. Returns what happened, for the summary assertions. */
function play(seed: number, steps: number, credits: number) {
  const rnd = prng(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const pick = <T>(list: T[]): T | undefined => list[int(list.length)];
  const g = fresh();
  g.credits = credits;
  g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'P5', 'P7', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'U1'];
  g.ordersOn = true;
  g.flowOn = true;
  let sunk = 0;
  const books = () => g.credits + boardValue(g) + sunk - g.lifetime;
  const start = books();
  const stale: Snapshot[] = [];
  const done: Record<string, number> = {};
  const tracks: Track[] = ['speed', 'eff', 'buffer'];
  const modes: RouterMode[] = ['even', 'ratio', 'priority', 'filter'];

  const actions: Record<string, () => unknown> = {
    place: () => {
      const type = pick(HOTBAR.filter((t) => nodeUnlocked(g, t)))!;
      if (type === 'well') {
        const dep = pick(freeDeposits(g));
        return dep ? placeNode(g, 'well', 0, 0, { depositId: dep.id }) : null;
      }
      const recipe = rnd() < 0.5 ? pick(recipesFor(g, type))?.id ?? null : null;
      return placeNode(g, type, 200 + int(900), 60 + int(600), { recipe });
    },
    delete: () => { const n = pick(g.nodes); return n ? deleteNode(g, n.id) : false; },
    upgrade: () => { const n = pick(g.nodes); return n ? upgrade(g, n.id, pick(tracks)!) : false; },
    upgradeAll: () => upgradeAll(g, pick(HOTBAR)!, pick(tracks)!),
    connect: () => {
      const a = pick(g.nodes);
      const b = pick(g.nodes);
      if (!a || !b) return null;
      const port = int(Math.max(1, outPortCount(a)));
      return canConnect(g, a.id, port, b.id) ? connect(g, a.id, port, b.id) : null;
    },
    cut: () => { const w = pick(g.wires); return w ? cutWire(g, w.id) : false; },
    cutMany: () => cutWires(g, g.wires.filter(() => rnd() < 0.3).map((w) => w.id)),
    upgradeWire: () => { const w = pick(g.wires); return w ? upgradeWire(g, w.id) : false; },
    upgradeFullWires: () => upgradeSaturatedWires(g),
    retool: () => {
      const n = pick(g.nodes.filter((x) => recipesFor(g, x.type).length > 0));
      const r = n && pick(recipesFor(g, n.type));
      return n && r ? setRecipe(g, n.id, r.id) : false;
    },
    router: () => {
      const n = pick(g.nodes.filter((x) => x.type === 'router'));
      if (!n) return false;
      const w = pick(g.wires.filter((x) => x.from === n.id));
      const what = int(5);
      if (what === 0) return setMode(g, n.id, pick(modes)!);
      if (what === 1) return w ? setWeight(g, w.id, int(6)) : false;
      if (what === 2) return w ? setFilter(g, w.id, rnd() < 0.3 ? null : pick(MAT_IDS)!) : false;
      if (what === 3) return w ? raisePriority(g, w.id) : false;
      return autoBalance(g, n.id);
    },
    // The one-press preset, on any wire of any node: only a wire leaving a Router with a choice is accepted.
    favour: () => {
      const n = rnd() < 0.8 ? pick(g.nodes.filter((x) => x.type === 'router')) : pick(g.nodes);
      // A Router with nothing to choose between is given a second and third wire first, like any player would.
      for (let i = g.wires.filter((x) => x.from === n?.id).length; n?.type === 'router' && i < 2 + int(2); i++) {
        const to = pick(g.nodes)!;
        if (canConnect(g, n.id, 0, to.id)) connect(g, n.id, 0, to.id);
      }
      const w = rnd() < 0.8 ? pick(g.wires.filter((x) => x.from === n?.id)) : pick(g.wires);
      if (!n || !w) return false;
      const could = canFavour(g, n.id, w.id);
      const ok = favour(g, n.id, w.id);
      must(ok === could, () => `seed ${seed}: canFavour said ${could}, favour did ${ok}`);
      if (ok) must(favouredWire(g, n.id) === w.id && n.mode === 'ratio', () => `seed ${seed}: favour did not favour`);
      return ok;
    },
    // Asking the adviser: it tries a dozen changes on copies of the game. None of it may show on the live game,
    // in its save or in its undo and redo history.
    advise: () => {
      g.goal = { i: pick(WAITING_GOALS)!, ready: false };
      g.edits = []; // as if the player's hands had been free for a while: the adviser is quiet for 20 s after any change
      tick(g, 0.05); // the unlocks of the goals before it
      const before = serialize(g).replace(/"savedAt":\d+/, '');
      const history = [canUndo(), canRedo()];
      const tip = advice(g);
      waitInfo(g);
      orderView(g);
      must(serialize(g).replace(/"savedAt":\d+/, '') === before, () => `seed ${seed}: asking for advice changed the game`);
      must(canUndo() === history[0] && canRedo() === history[1], () => `seed ${seed}: asking for advice changed the undo history`);
      if (history[0] && rnd() < 0.5) undo(g); // whatever comes off the stack is the player's own step
      return !!tip;
    },
    // Following a tip is a normal action: paid for, and one undo step.
    followTip: () => {
      g.goal = { i: pick(WAITING_GOALS)!, ready: false };
      g.edits = [];
      tick(g, 0.05);
      const tip = advice(g);
      if (!tip) return false;
      must(tip.saves != null && (tip.kind === 'flow' || tip.saves >= 15), () => `seed ${seed}: "${tip.text.mouse}" says it saves ${tip.saves} s`);
      must([...tip.text.mouse].length <= 90 && [...tip.text.touch].length <= 90, () => `seed ${seed}: "${tip.text.mouse}" is longer than 90 characters`);
      const credits = g.credits;
      const ok = applyAdvice(g, tip);
      must(ok, () => `seed ${seed}: a tip could not be followed: ${tip.text.mouse}`);
      must(tip.research != null || Math.abs(credits - g.credits - (tip.cost ?? 0)) < 1e-6, () => `seed ${seed}: "${tip.text.mouse}" cost ${credits - g.credits}¢, not the ${tip.cost}¢ it said`);
      if (!tip.research && rnd() < 0.5) {
        must(undo(g), () => `seed ${seed}: a followed tip could not be undone`);
        must(Math.abs(g.credits - credits) < 1e-6, () => `seed ${seed}: undoing a tip did not give its price back`);
      }
      return true;
    },
    splice: () => { const w = pick(g.wires); const n = pick(g.nodes); return w && n ? splice(g, w.id, n.id) : false; },
    expand: () => {
      if (g.board.expansions >= 4) return false;
      const cost = expansionCost(g);
      const ok = expandBoard(g);
      if (ok) sunk += cost;
      return ok;
    },
    // Sell things and sink the refunds into an expansion, which cannot be undone: the sales can no longer all be taken back.
    sellAndSink: () => {
      const cost = expansionCost(g);
      if (g.board.expansions >= 4 || g.credits >= cost) return false;
      let sold = 0;
      while (g.credits < cost) {
        const n = pick(g.nodes.filter((x) => refundOf(g, x) > 0));
        if (!n || !deleteNode(g, n.id)) break;
        sold++;
      }
      if (!expandBoard(g)) return false;
      sunk += cost;
      // Undo as far as it goes: it must stop at a sale it cannot pay for, never dip below zero.
      let undone = 0;
      while (undone < sold && undo(g)) undone++;
      must(undone < sold, () => `seed ${seed}: every sale was undone although ${cost}¢ of the refunds is gone`);
      return true;
    },
    undo: () => { let any = false; for (let i = 1 + int(3); i > 0; i--) any = undo(g) || any; return any; },
    redo: () => { let any = false; for (let i = 1 + int(3); i > 0; i--) any = redo(g) || any; return any; },
    // A drag: the board is remembered at pointer-down, the node moves, and the step is recorded at pointer-up.
    move: () => {
      const n = pick(g.nodes.filter((x) => x.type !== 'well'));
      if (!n) return false;
      const before = snapshot(g);
      n.x += 20 * (1 + int(5));
      return pushUndo(g, before);
    },
    // The same, but something else happened in between (section 7, bug 1): the old snapshot must be refused or harmless.
    staleDrag: () => { const s = pick(stale); return s ? pushUndo(g, s) : false; },
    remember: () => { stale.push(snapshot(g)); if (stale.length > 6) stale.shift(); return true; },
    wait: () => { for (let i = 10 + int(60); i > 0; i--) tick(g, 0.05); return true; },
    claimGoal: () => claimGoal(g),
    claimOrder: () => claimOrder(g),
    research: () => { g.data.a += 40; return research(g, pick(TECH_IDS)!); },
    refundQuote: () => {
      // The quote shown on the Delete button is exactly what deleting pays.
      const n = pick(g.nodes);
      if (!n) return false;
      const quote = refundOf(g, n);
      const before = g.credits;
      if (!deleteNode(g, n.id)) return expect(quote).toBe(0);
      expect(g.credits - before).toBeCloseTo(quote, 6);
      return undo(g);
    },
  };
  // Weights: mostly building and wiring, a steady trickle of undo and redo.
  const deck: string[] = [];
  const add = (name: string, weight: number) => { for (let i = 0; i < weight; i++) deck.push(name); };
  add('place', 9); add('delete', 5); add('upgrade', 6); add('upgradeAll', 1); add('connect', 10); add('cut', 3); add('cutMany', 1);
  add('upgradeWire', 3); add('upgradeFullWires', 1); add('retool', 2); add('router', 3); add('splice', 3); add('expand', 1);
  add('undo', 6); add('redo', 4); add('move', 2); add('staleDrag', 2); add('remember', 2); add('wait', 6); add('claimGoal', 1);
  add('claimOrder', 1); add('research', 1); add('refundQuote', 2); add('sellAndSink', 3); add('favour', 2);
  add('advise', 2); add('followTip', 2);

  // When each machine (in each recipe it has had) was built or re-tooled. Undo and redo may bring an old machine
  // back, but never as a younger one: Flow ignores young producers, so that would be a way to hide a weak one.
  const builtAt = new Map<string, number>();
  const ages = () => { for (const n of g.nodes) builtAt.set(`${n.id}:${n.recipe}`, n.born); };
  ages();
  let lowest = g.credits;
  for (let step = 0; step < steps; step++) {
    const name = pick(deck)!;
    const result = actions[name]();
    if (result) done[name] = (done[name] ?? 0) + 1;
    const where = `seed ${seed}, step ${step} (${name})`;
    must(Math.abs(books() - start) < 1e-4, () => `${where}: credits were created or destroyed (${(books() - start).toFixed(4)}¢)`);
    checkBoard(g, where);
    if (name === 'undo' || name === 'redo' || name === 'staleDrag' || name === 'refundQuote' || name === 'sellAndSink') {
      for (const n of g.nodes) {
        const known = builtAt.get(`${n.id}:${n.recipe}`);
        must(known == null || n.born <= known + 1e-9, () => `${where}: node ${n.id} came back younger (born ${n.born}, was ${known})`);
      }
    }
    ages();
    lowest = Math.min(lowest, g.credits);
  }
  return { g, done, lowest };
}

describe('credits are conserved by every sequence of edits, undo and redo', () => {
  it('holds for 40 seeds × 500 random actions, and the generator really exercises every action', () => {
    const total: Record<string, number> = {};
    for (let seed = 1; seed <= 40; seed++) {
      const { done } = play(seed, 500, 2500);
      for (const k in done) total[k] = (total[k] ?? 0) + done[k];
    }
    // Every kind of action must have succeeded many times, or the test proves nothing.
    for (const name of ['place', 'delete', 'upgrade', 'connect', 'cut', 'upgradeWire', 'retool', 'router', 'splice', 'expand', 'undo', 'redo', 'move', 'wait', 'refundQuote']) {
      expect(total[name] ?? 0, `"${name}" succeeded only ${total[name] ?? 0} times`).toBeGreaterThan(20);
    }
    expect(total.claimGoal ?? 0).toBeGreaterThan(0);
    console.info(`property test: actions that succeeded: ${Object.entries(total).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    // The new actions: the Favour preset, and the adviser (asked, and followed).
    expect(total.favour ?? 0, `"favour" succeeded only ${total.favour ?? 0} times`).toBeGreaterThan(20);
    expect(total.advise ?? 0, `the adviser had a tip only ${total.advise ?? 0} times`).toBeGreaterThan(10);
    expect(total.followTip ?? 0, `a tip was followed only ${total.followTip ?? 0} times`).toBeGreaterThan(10);
  });

  it('a player with almost no credits is never pushed below zero, and unaffordable undos are refused', () => {
    let refused = 0;
    let lowest = Infinity;
    for (let seed = 101; seed <= 130; seed++) {
      const r = play(seed, 400, 350);
      lowest = Math.min(lowest, r.lowest);
      refused += r.done.sellAndSink ?? 0;
    }
    expect(lowest).toBeGreaterThanOrEqual(-1e-6);
    expect(lowest).toBeLessThan(5); // the runs really did scrape the bottom
    expect(refused).toBeGreaterThan(5);
  });
});

// A scripted newcomer: a player who does ONLY what each goal card says, in the card's own words, one action
// every few seconds: the hint, and during a wait the card's "while you wait" line (Goal.meanwhile). No
// upgrade the card did not ask for, no extra machines, no side techs.
// This is the floor for a first-time player, and it is not one of the pacing bot's fast policies: those
// wire, upgrade and build Routers on their own.
//
// With `tips` the same player also follows the adviser (src/advice.ts): when they are waiting and a tip has
// been on offer for `tipDelay` seconds, they do what it says (one action), and nothing else unprompted.
// One goal needs the adviser either way: "Hold 95% Flow" sends the player to the Flow ring to find what is
// holding Flow back, and what the ring leads them to is the fix the adviser names. So on that goal even the
// player without tips takes it.
//
// The pacing tool has its own newcomer (tools/pacing.ts), who also claims 8–16 s late; that one is judged
// against the targets. This one is the tests' fixture.
//
// Used by tests/playthrough.test.ts (every goal can be done; how long each takes) and tests/advice.test.ts
// (real game states to check tips against).
import { expect } from 'vitest';
import { claimGoal, claimOrder, connect, cutWire, expandBoard, favour, freeDeposits, placeNode, upgrade } from '../src/actions';
import { Advice, advice, applyAdvice } from '../src/advice';
import { NodeType, RECIPES, TECHS } from '../src/content';
import { expansionCost, nodeCost, research, techAffordable, upgradeCost } from '../src/economy';
import { activeGoal, goalById, meanwhileOf } from '../src/goals';
import { Game, GNode } from '../src/state';
import { fresh, market, run, well } from './helpers';

export interface CardOptions {
  /** Does what the card's "while you wait" lines say (the default). false: the hints alone, as before the lines existed. */
  meanwhile?: boolean;
  /** Also wires every new Refiner to the Lab, as goal 7 taught for Shard. */
  studyAll?: boolean;
  /** Follows the adviser's tips. */
  tips?: boolean;
  /** Seconds a tip has to be on offer before the player acts on it. */
  tipDelay?: number;
  /** Seconds per action. */
  hands?: number;
  /** Moves the order generator, like the pacing bot's seed. 0 is the sequence every new game starts with. */
  seed?: number;
  /**
   * 'always': wires whatever an order asks for to the Market whenever it is not (the card of goals 12 and 20 says
   * to). 'asked': only while one of those two goals is on the card; at other times that is left to the tips.
   */
  tendOrders?: 'always' | 'asked';
  /** Called once a second while the player has nothing to do but wait, before a "while you wait" line or a tip is acted on. */
  onIdle?: (g: Game) => void;
  /** Seconds one wait may take before the run fails: longer than this is a wall. */
  wall?: number;
}

export interface GoalTime {
  id: string;
  title: string;
  /** From the claim before it to its own claim. */
  seconds: number;
  /** What the longest wait of the goal was for (waits over 30 s only). */
  waitedFor: string;
  /** Tips followed while it was the goal, and the longest stretch of waiting with no tip on offer. */
  tips: number;
  tipless: number;
}

export interface TipTaken { at: number; goal: string; text: string; kind: Advice['kind']; eta: number; saves: number | undefined; cost: number }

/**
 * The next gesture of the active goal's "while you wait" line, read the way the hints are read. Returns false
 * when there is nothing (more) to do for it right now: no line, not applicable, done, or not affordable yet.
 */
export function followMeanwhile(g: Game): boolean {
  const line = meanwhileOf(g);
  if (!line || line.done(g)) return false;
  const lab = g.nodes.find((n) => n.type === 'lab');
  switch (activeGoal(g)!.id) {
    case 'make-spark': {
      // "Drag from the Ink Refiner's Ink port to the Lab too."
      const ink = g.nodes.find((n) => n.recipe === 'ink');
      return !!ink && !!lab && !!connect(g, ink.id, 0, lab.id);
    }
    case 'make-glyph': case 'make-mist': {
      // "Give each new deposit a Well and a Lab built from its port": one deposit after the other, a Well and
      // then its Lab (two gestures each). On "Make your first Mist" the board has to grow first: "Expand the
      // board again, then give a new deposit a Well and a Lab of its own."
      const bare = g.nodes.find((n) => n.type === 'well' && !g.wires.some((w) => w.from === n.id));
      if (bare) {
        if (g.credits < nodeCost(g, 'lab')) return false;
        const built = placeNode(g, 'lab', bare.x + 240, bare.y);
        return !!built && !!connect(g, bare.id, 0, built.id);
      }
      const d = freeDeposits(g)[0];
      if (!d && activeGoal(g)!.id === 'make-mist') return expandBoard(g);
      return !!d && g.credits >= nodeCost(g, 'well') && !!placeNode(g, 'well', d.x, d.y, { depositId: d.id });
    }
    case 'build-fabricator': {
      // "Remove the wire from the Glyph Assembler to the Lab."
      const id = line.cuts?.(g)[0];
      return id != null && cutWire(g, id);
    }
    default:
      return false;
  }
}

export interface CardRun {
  g: Game;
  spent: GoalTime[];
  tips: TipTaken[];
  /** Longest stretch of waiting with no tip on offer and nothing the card asks, over the whole run. */
  longestTipless: number;
  /** When the first surplus sale was noted (g.seenSurplus), or null. */
  surplusAt: number | null;
}

/** Plays the demo to the first Lens by the card. */
export function playByTheCard(opts: CardOptions = {}): CardRun {
  const g = fresh();
  const HANDS = opts.hands ?? 6;
  const TIP_DELAY = opts.tipDelay ?? 15;
  const WALL = opts.wall ?? 900;
  const tend = opts.tendOrders ?? (opts.tips ? 'asked' : 'always');
  g.orderSeed = (g.orderSeed + (opts.seed ?? 0) * 7919) >>> 0;
  const spent: GoalTime[] = [];
  const tips: TipTaken[] = [];
  let last = 0;
  let waitedFor = '';
  let goalTips = 0;
  let tipless = 0; // the current stretch
  let goalTipless = 0;
  let longestTipless = 0;
  let offered = 0; // seconds a tip has been on offer
  let surplusAt: number | null = null;
  const m = market(g);
  const tickSurplus = () => {
    if (surplusAt == null && g.seenSurplus) surplusAt = g.time;
  };
  const act = () => {
    run(g, HANDS);
    tipless = 0;
    tickSurplus();
  };

  /** "Keep an eye on the order card: send what it asks for to a Market, then claim it." */
  const tendOrder = () => {
    const o = g.order;
    if (!o) return;
    if (o.ready) {
      act();
      claimOrder(g);
      return;
    }
    const asked = activeGoal(g)?.id === 'first-order' || activeGoal(g)?.id === 'three-orders';
    if (tend === 'asked' && !asked) return;
    for (const n of g.nodes) {
      const port = n.recipe ? RECIPES[n.recipe].outputs.findIndex((out) => out[0] === o.mat) : -1;
      if (port < 0 || g.wires.some((w) => w.from === n.id && w.port === port && w.to === m.id)) continue;
      act();
      connect(g, n.id, port, m.id);
    }
  };
  /** One second of waiting: the order is tended, and a tip that has been on offer long enough is followed. */
  const idle = () => {
    run(g, 1);
    tickSurplus();
    tendOrder();
    opts.onIdle?.(g);
    // The card's "while you wait" line comes before any tip: it is on the card.
    const line = opts.meanwhile === false ? null : meanwhileOf(g);
    if (line && !line.done(g) && !g.goal.ready) {
      const before = g.rev;
      if (followMeanwhile(g)) {
        act();
        offered = 0;
        return;
      }
      expect(g.rev, 'a "while you wait" line that could not be followed left the board alone').toBe(before);
    }
    const tip = opts.tips || activeGoal(g)?.id === 'hold-flow' ? advice(g) : null;
    if (!tip) {
      offered = 0;
      tipless++;
      goalTipless = Math.max(goalTipless, tipless);
      longestTipless = Math.max(longestTipless, tipless);
      return;
    }
    tipless = 0;
    if (++offered < TIP_DELAY) return;
    act();
    const now = advice(g); // what it says at the moment the player gets to it
    if (now && applyAdvice(g, now)) {
      tips.push({ at: g.time, goal: activeGoal(g)!.id, text: now.text.mouse, kind: now.kind, eta: now.eta, saves: now.saves, cost: now.cost ?? 0 });
      goalTips++;
      if (now.steps === 2) act(); // a build that is then wired on is two gestures
    }
    offered = 0;
  };
  /** Let the game run until `ready()`. Fails after 15 minutes (or `wall`): that would be a wall. */
  const wait = (what: string, ready: () => boolean) => {
    const from = g.time;
    offered = 0;
    while (!ready()) {
      expect(g.time - from, `still waiting for ${what} after ${WALL / 60} minutes`).toBeLessThan(WALL);
      idle();
    }
    tipless = 0;
    if (g.time - from > 30) waitedFor = what;
  };
  const claim = (id: string) => {
    expect(activeGoal(g)!.id).toBe(id);
    wait(`"${activeGoal(g)!.title}" to complete`, () => g.goal.ready);
    act();
    expect(claimGoal(g)).toBe(true);
    spent.push({ id, title: goalById(id)!.title, seconds: g.time - last, waitedFor, tips: goalTips, tipless: goalTipless });
    last = g.time;
    waitedFor = '';
    goalTips = 0;
    goalTipless = 0;
  };
  const buy = (type: NodeType, o: { depositId?: number; recipe?: string } = {}): GNode => {
    wait(`credits for a ${type}`, () => g.credits >= nodeCost(g, type));
    act();
    const n = placeNode(g, type, 300 + 60 * g.nodes.length, 60 + 45 * g.nodes.length, o);
    expect(n, type).not.toBeNull();
    return n!;
  };
  const wire = (from: GNode, to: GNode, port = 0) => {
    if (g.wires.some((w) => w.from === from.id && w.port === port && w.to === to.id)) return; // a tip got there first
    act();
    expect(connect(g, from.id, port, to.id), `${from.type} → ${to.type}`).not.toBeNull();
  };
  /** "Build X from a port": place it and wire it in one gesture. */
  const from = (source: GNode, type: NodeType, port = 0): GNode => {
    const n = buy(type);
    expect(connect(g, source.id, port, n.id)).not.toBeNull();
    return n;
  };
  const study = (id: string) => {
    wait(`${id === 'P7' ? 'α and β' : 'α'} for ${TECHS[id].name}`, () => techAffordable(g, TECHS[id]));
    act();
    expect(research(g, id)).toBe(true);
  };

  // 1–7: the opening.
  const w1 = well(g);
  wire(w1, m);
  claim('wire-market');
  const w2 = buy('well', { depositId: 2 });
  claim('second-well');
  wire(w2, m);
  claim('wire-all-wells');
  const shard = from(w1, 'refiner');
  claim('build-refiner');
  wire(shard, m);
  claim('sell-shard');
  wait('credits for a Well upgrade', () => g.credits >= upgradeCost(w1, 'speed'));
  act();
  expect(upgrade(g, w1.id, 'speed')).toBe(true);
  claim('upgrade-well');
  const lab = from(shard, 'lab');
  claim('feed-lab');
  // 8–11: Murk, Silt, Ember.
  study('P2');
  claim('research-murk');
  const ink = from(buy('well', { depositId: 3 }), 'refiner');
  expect(ink.recipe).toBe('ink');
  claim('make-ink');
  wire(ink, m); // "sell the Ink at the Market..."
  from(ink, 'void', 1); // "...then pick Void for the Silt"
  claim('silt-exit');
  if (opts.studyAll) wire(ink, lab);
  study('P3');
  const spark = from(buy('well', { depositId: 4 }), 'refiner');
  expect(spark.recipe).toBe('spark');
  wire(spark, m); // "...and sell the Spark"
  claim('make-spark');
  if (opts.studyAll) wire(spark, lab);
  // 12–14: orders, the Router, the board.
  claim('first-order');
  const router = from(spark, 'router'); // "Build a Router from the Spark Refiner's port..."
  wire(router, lab); // "...and wire it to a Lab and to a Market..."
  wire(router, m);
  act();
  favour(g, router.id, g.wires.find((w) => w.from === router.id && w.to === lab.id)!.id); // "...then press Favour on the Lab's wire"
  claim('route-lab');
  wait('credits to expand the board', () => g.credits >= expansionCost(g));
  act();
  expect(expandBoard(g)).toBe(true);
  claim('expand');
  // 15–17: Glyph, Flow, β.
  study('P4');
  const glyph = buy('assembler', { recipe: 'glyph' });
  wire(ink, glyph);
  wire(spark, glyph);
  wire(glyph, m); // "...and sell its Glyph at the Market"
  claim('make-glyph');
  claim('hold-flow');
  wire(glyph, lab); // "Drag from the Assembler's port to a Lab"
  claim('study-glyph');
  // 18–20: Mist, Prism, three orders.
  study('P5');
  const mist = from(buy('well', { depositId: 5 }), 'refiner');
  expect(mist.recipe).toBe('mist');
  wire(mist, m); // "...and sell the Mist"
  claim('make-mist');
  if (opts.studyAll) wire(mist, lab);
  const prism = buy('assembler', { recipe: 'prism' });
  wire(shard, prism);
  wire(mist, prism);
  wire(prism, m); // "...and sell its Prism at the Market"
  claim('make-prism');
  claim('three-orders');
  // 21–22: the Fabricator and the Lens.
  study('P7');
  const fab = buy('fabricator', { recipe: 'lens' });
  claim('build-fabricator');
  wire(prism, fab);
  wire(glyph, fab);
  claim('make-lens');
  tickSurplus();
  return { g, spent, tips, longestTipless, surplusAt };
}

/** mm:ss */
export const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

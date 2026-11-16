// Which node the HUD's alert names, and what the board says at the ending (status.ts). These run without a
// browser: they only read the game.
import { describe, expect, it } from 'vitest';
import { clearHistory, connect, placeNode, upgrade, upgradeAll } from '../actions';
import { PIPES } from '../content';
import { maxLevel, upgradeCost } from '../economy';
import { GOALS } from '../goals';
import { tick } from '../sim';
import { Game, GNode, newGame } from '../state';
import { ALERT_QUIET, alertPick, bulkPlan, diagnose, starvedShort, wayOn } from './status';

const run = (g: Game, seconds: number) => {
  for (let i = 0; i < seconds * 20; i++) tick(g, 0.05);
};

/** The opening board: a Well and a Market, two nodes the alert could name (what it says is made up here). */
function twoOpenWells(): { g: Game; a: GNode; b: GNode } {
  clearHistory();
  const g = newGame();
  const a = g.nodes.find((n) => n.type === 'well')!;
  const b = g.nodes.find((n) => n.type === 'market')!;
  // (Both running, and settled: whether the alert speaks of them is decided by the words handed in, except where a
  // test says.)
  a.status = b.status = 'working';
  a.grace = b.grace = 0;
  return { g, a, b };
}

const says = (n: GNode) => `about ${n.id}`;

describe('the alert names the node the goal is about first', () => {
  it('a node the goal (or its line) is about comes before the one named last and before the worst off', () => {
    const { g, a, b } = twoOpenWells();
    g.goalAt = { i: g.goal.i, t: g.time - ALERT_QUIET - 1 };
    expect(alertPick(g, a.id, says, [b.id])?.n.id).toBe(b.id);
    // Nothing the goal is about is in trouble: the one named last keeps its place.
    expect(alertPick(g, a.id, (n) => (n.id === b.id ? null : says(n)), [b.id])?.n.id).toBe(a.id);
    expect(alertPick(g, a.id, says, [])?.n.id).toBe(a.id);
    expect(alertPick(g, b.id, says, [])?.n.id).toBe(b.id);
  });

  it('in the order the player meets them', () => {
    const { g, a, b } = twoOpenWells();
    g.goalAt = { i: g.goal.i, t: g.time - ALERT_QUIET - 1 };
    expect(alertPick(g, -1, says, [a.id, b.id])?.n.id).toBe(a.id);
    expect(alertPick(g, -1, says, [b.id, a.id])?.n.id).toBe(b.id);
  });

  it('at the start of a goal it says nothing about what the card is telling the player', () => {
    const { g, a, b } = twoOpenWells();
    g.goalAt = { i: g.goal.i, t: g.time };
    // The card is about b, which is in trouble: the card is telling the player, and the alert names nothing (not
    // a either, which it would otherwise name for the opening seconds only); b once those are over.
    expect(alertPick(g, -1, says, [b.id])).toBeNull();
    expect(alertPick(g, -1, (n) => (n.id === b.id ? says(n) : null), [b.id])).toBeNull();
    // b is fine: a may be named from the start.
    expect(alertPick(g, -1, (n) => (n.id === b.id ? null : says(n)), [b.id])?.n.id).toBe(a.id);
    g.goalAt = { i: g.goal.i, t: g.time - ALERT_QUIET - 1 };
    expect(alertPick(g, -1, says, [b.id])?.n.id).toBe(b.id);
  });

  it('while a node the card is about stands idle, it names nothing at all (goal 22: the Fabricator with no wires)', () => {
    const { g, a, b } = twoOpenWells();
    g.goalAt = { i: g.goal.i, t: g.time - ALERT_QUIET - 1 };
    // (As in the HUD: an idle node has nothing to be named for.)
    const words = (n: GNode) => (n.status === 'idle' ? null : says(n));
    // The Market has nothing wired into it yet: getting it going is what the card asks for.
    b.status = 'idle';
    expect(alertPick(g, a.id, words, [b.id])).toBeNull();
    expect(alertPick(g, -1, words, [b.id])).toBeNull();
    // Also in a goal's first seconds.
    g.goalAt = { i: g.goal.i, t: g.time };
    expect(alertPick(g, -1, words, [b.id])).toBeNull();
    g.goalAt = { i: g.goal.i, t: g.time - ALERT_QUIET - 1 };
    // An idle node the card is not about silences nothing.
    expect(alertPick(g, -1, words, [])?.n.id).toBe(a.id);
    // Wired at last, it settles for a few seconds (its grace, when the simulation calls it working) before it can be
    // judged: still the card's.
    b.status = 'working';
    b.grace = 4;
    const aOnly = (n: GNode) => (n.id === a.id ? says(n) : null);
    expect(alertPick(g, a.id, aOnly, [b.id])).toBeNull();
    // Once it runs, the rest may be named again.
    b.grace = 0;
    expect(alertPick(g, a.id, aOnly, [b.id])?.n.id).toBe(a.id);
  });

  it('where the goal names no node, the card is about the kinds its hint names (goal 3: the new Well)', () => {
    const { g, a, b } = twoOpenWells();
    g.goal = { i: GOALS.findIndex((x) => x.id === 'wire-all-wells'), ready: false };
    g.goalAt = { i: g.goal.i, t: g.time };
    // "Drag from the new Well's port to the same Market": nothing is said about a Well or that Market at first.
    expect(alertPick(g, -1, says, [])).toBeNull();
    g.goalAt = { i: g.goal.i, t: g.time - ALERT_QUIET - 1 };
    expect([a.id, b.id]).toContain(alertPick(g, -1, says, [])?.n.id);
  });
});

describe('starved means starved', () => {
  /** A Shard Refiner fed by the opening Glint Well; the simulation is not run: their states are set by hand. */
  function refinerFedByWell(): { g: Game; well: GNode; ref: GNode } {
    clearHistory();
    const g = newGame();
    g.credits = 1e9;
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4'];
    const well = g.nodes.find((n) => n.type === 'well')!;
    const ref = placeNode(g, 'refiner', 600, 520, { recipe: 'shard' })!;
    connect(g, well.id, 0, ref.id);
    well.status = 'working';
    ref.status = 'starved';
    ref.missing = 'glint';
    ref.grace = well.grace = 0;
    return { g, well, ref };
  }

  it('a machine short of an input but at work 60% of its time or more is not a problem', () => {
    const { g, ref } = refinerFedByWell();
    ref.util = 0.8;
    expect(diagnose(g, ref).problem).toBeNull();
    expect(starvedShort(g, ref)).toBe(true);
    // (Nothing for the alert to name either.)
    expect(alertPick(g, -1, (n) => (diagnose(g, n).problem ? 'trouble' : null), [])).toBeNull();
  });

  it('under 60% it is starved, as before', () => {
    const { g, ref } = refinerFedByWell();
    ref.util = 0.3;
    const dx = diagnose(g, ref);
    expect(dx.problem).toBe('starved');
    expect(dx.mat).toBe('glint');
    expect(starvedShort(g, ref)).toBe(false);
  });

  it('is judged on the share averaged over a few seconds, and does not blink at the line', () => {
    const { g, ref } = refinerFedByWell();
    // Working in bursts about a mean of 80%: dips to 55% for a moment do not make it a problem.
    ref.util = 0.8;
    expect(diagnose(g, ref).problem).toBeNull();
    for (let i = 0; i < 10; i++) {
      g.time += 0.5;
      ref.util = i % 2 ? 0.95 : 0.55;
      expect(diagnose(g, ref).problem).toBeNull();
    }
    // Truly short of input for long enough: a problem.
    for (let i = 0; i < 20; i++) {
      g.time += 0.5;
      ref.util = 0.3;
      diagnose(g, ref);
    }
    expect(diagnose(g, ref).problem).toBe('starved');
    // Back to 62%: still under the line it crossed (it is cleared at 65%), so it does not flip at once...
    for (let i = 0; i < 30; i++) {
      g.time += 0.5;
      ref.util = 0.62;
      diagnose(g, ref);
    }
    expect(diagnose(g, ref).problem).toBe('starved');
    // ...and once it is clearly back over the line, it is no problem.
    for (let i = 0; i < 30; i++) {
      g.time += 0.5;
      ref.util = 0.7;
      diagnose(g, ref);
    }
    expect(diagnose(g, ref).problem).toBeNull();
  });

  it('a machine the card is about that is merely short keeps the alert slot empty (goal 16: the Flow line is about it)', () => {
    const { g, well, ref } = refinerFedByWell();
    g.goalAt = { i: g.goal.i, t: g.time - ALERT_QUIET - 1 };
    ref.util = 0.8;
    // Something else is in trouble (say, a Well with nowhere to send its output): not named while the card's own
    // machine is short; named once the card is about something that runs.
    const words = (n: GNode) => (n.id === well.id ? 'trouble' : null);
    expect(alertPick(g, -1, words, [ref.id])).toBeNull();
    ref.status = 'working';
    expect(alertPick(g, -1, words, [ref.id])?.n.id).toBe(well.id);
  });

  it('a machine downstream of one that is merely short is starved itself, not a victim', () => {
    const { g, ref } = refinerFedByWell();
    ref.util = 0.8;
    // (Glyph takes Ink and Spark; here only its Spark matters, and the Refiner is said to make it.)
    const asm = placeNode(g, 'assembler', 900, 520, { recipe: 'glyph' })!;
    ref.recipe = 'spark';
    connect(g, ref.id, 0, asm.id);
    asm.status = 'starved';
    asm.missing = 'spark';
    asm.util = 0.2;
    asm.grace = 0;
    const dx = diagnose(g, asm);
    expect(dx.problem).toBe('starved');
    expect(dx.victim).toBe(false);
    expect(dx.culprit).toBe(ref.id);
    // A supplier that is a problem itself makes it a victim, as before.
    ref.util = 0.2;
    g.time += 40;
    diagnose(g, ref);
    expect(diagnose(g, asm).victim).toBe(true);
  });
});

describe('the ending: the board is the victory picture', () => {
  it('shows no trouble on any node between the first Lens and free play', () => {
    clearHistory();
    const g = newGame();
    g.credits = 1e9;
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'P5', 'P7', 'L1'];
    const fab = placeNode(g, 'fabricator', 600, 300, { recipe: 'lens' })!;
    const glyph = placeNode(g, 'assembler', 300, 200, { recipe: 'glyph' })!;
    connect(g, glyph.id, 0, fab.id);
    run(g, 1);
    // Starved of Glyph (as the simulation would have it after a first Lens): said, while the demo is still on.
    expect(fab.recipe).toBe('lens');
    fab.status = 'starved';
    fab.missing = 'glyph';
    expect(diagnose(g, fab).problem).toBe('starved');
    fab.status = 'blocked';
    fab.blockedOn = 'lens';
    expect(diagnose(g, fab).problem).toBe('blocked');
    // A machine that feeds it, starved too (the Mist Refiner at the victory frame).
    glyph.status = 'starved';
    glyph.missing = 'spark';
    expect(diagnose(g, glyph).problem).toBe('starved');
    g.ended = true;
    expect(diagnose(g, fab).problem).toBeNull();
    fab.status = 'starved';
    expect(diagnose(g, fab).problem).toBeNull();
    // Nothing else is in trouble at the victory either, and the alert has nothing to name.
    expect(diagnose(g, glyph).problem).toBeNull();
    expect(alertPick(g, glyph.id, (n) => (diagnose(g, n).problem ? 'trouble' : null), [])).toBeNull();
    // (Free play, or a game that has not ended: diagnosed as ever.)
    expect(diagnose({ ...g, ended: false }, glyph).problem).toBe('starved');
  });
});

describe('a blocked node: the way on', () => {
  /** The opening Glint Well one Speed level up (1.25 a second), with everything researched that these boards need. */
  function fastWell(): { g: Game; well: GNode } {
    clearHistory();
    const g = newGame();
    g.credits = 1e6;
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'L1'];
    const well = g.nodes.find((n) => n.type === 'well')!;
    upgrade(g, well.id, 'speed');
    return { g, well };
  }

  it('a Well that feeds a Lab studying as fast as it can: Speed on that Lab, and it works', () => {
    const { g, well } = fastWell();
    const lab = placeNode(g, 'lab', 500, 120)!;
    connect(g, well.id, 0, lab.id);
    run(g, 30);
    const dx = diagnose(g, well);
    expect(dx.problem).toBe('blocked');
    expect(dx.openPort).toBe(false);
    expect(dx.culprit).toBeNull();
    expect(wayOn(g, well, dx)).toEqual({ node: lab.id, speed: true, waits: null });
    // The press the box offers: the Lab takes all the Well gives, and nothing is blocked any more.
    expect(upgrade(g, lab.id, 'speed')).toBe(true);
    run(g, 30);
    expect(diagnose(g, well).problem).toBeNull();
    expect(wayOn(g, well)).toBeNull();
  });

  it('a Well that feeds a Refiner at full speed: Speed on that Refiner', () => {
    const { g, well } = fastWell();
    const ref = placeNode(g, 'refiner', 500, 120, { recipe: 'shard' })!;
    const market = g.nodes.find((n) => n.type === 'market')!;
    connect(g, well.id, 0, ref.id);
    connect(g, ref.id, 0, market.id);
    run(g, 30);
    expect(ref.status).toBe('working');
    expect(diagnose(g, well).problem).toBe('blocked');
    expect(wayOn(g, well)).toEqual({ node: ref.id, speed: true, waits: null });
  });

  it('a machine downstream that is in trouble itself stays the cause to jump to: nothing else is offered', () => {
    const { g, well } = fastWell();
    // (A Refiner with nowhere to send its Shard fills up and stops.)
    const ref = placeNode(g, 'refiner', 500, 120, { recipe: 'shard' })!;
    connect(g, well.id, 0, ref.id);
    run(g, 40);
    const dx = diagnose(g, well);
    expect(dx.problem).toBe('blocked');
    expect(dx.culprit).toBe(ref.id);
    expect(wayOn(g, well, dx)).toBeNull();
  });

  it('nothing to name: an output with no wire, and a node that is not blocked', () => {
    const { g, well } = fastWell();
    run(g, 10);
    expect(diagnose(g, well).openPort).toBe(true);
    expect(wayOn(g, well)).toBeNull();
    const lab = placeNode(g, 'lab', 500, 120)!;
    connect(g, well.id, 0, lab.id);
    well.status = 'working';
    expect(wayOn(g, well)).toBeNull();
  });

  it('through a Router, and of two that are full the one whose Speed is cheaper', () => {
    const { g, well } = fastWell();
    const router = placeNode(g, 'router', 400, 120)!;
    const lab = placeNode(g, 'lab', 700, 60)!;
    const ref = placeNode(g, 'refiner', 700, 240, { recipe: 'shard' })!;
    connect(g, well.id, 0, router.id);
    connect(g, router.id, 0, lab.id);
    connect(g, router.id, 0, ref.id);
    // (States set by hand, as elsewhere in this file: both take all they can, and the Well backs up.)
    well.status = 'blocked';
    well.blockedOn = 'glint';
    lab.rate = 1;
    ref.status = 'working';
    well.grace = lab.grace = ref.grace = 0;
    expect(upgradeCost(ref, 'speed')).toBeLessThan(upgradeCost(lab, 'speed'));
    expect(wayOn(g, well)).toEqual({ node: ref.id, speed: true, waits: null });
    // The Refiner is waiting for nothing, but it has no level left to buy: the Lab's Speed is the one on offer.
    ref.lv.speed = maxLevel(g, 'speed');
    expect(wayOn(g, well)).toEqual({ node: lab.id, speed: true, waits: null });
    // Neither has: the first of them is named, to be shown.
    lab.lv.speed = maxLevel(g, 'speed');
    expect(wayOn(g, well)).toMatchObject({ speed: false, waits: null });
    expect([lab.id, ref.id]).toContain(wayOn(g, well)!.node);
  });

  it('a Lab with room to spare is not offered Speed; one just built is not judged; a wire at capacity hides what stands beyond it', () => {
    const { g, well } = fastWell();
    const lab = placeNode(g, 'lab', 500, 120)!;
    const wire = connect(g, well.id, 0, lab.id)!;
    well.status = 'blocked';
    well.blockedOn = 'glint';
    well.grace = lab.grace = 0;
    lab.rate = 0.4;
    expect(wayOn(g, well)).toEqual({ node: lab.id, speed: false, waits: null });
    lab.rate = 1;
    expect(wayOn(g, well)?.speed).toBe(true);
    // (Only just built: not judged yet, so nothing is said about it.)
    lab.grace = 3;
    expect(wayOn(g, well)).toBeNull();
    lab.grace = 0;
    wire.rate = PIPES[wire.tier].cap;
    expect(wayOn(g, well)).toBeNull();
  });

  it('a machine that takes no more because it waits for another input: named with that input, to be shown', () => {
    const { g } = fastWell();
    const ink = placeNode(g, 'refiner', 400, 400, { recipe: 'ink' })!;
    const asm = placeNode(g, 'assembler', 700, 400, { recipe: 'glyph' })!;
    connect(g, ink.id, 0, asm.id);
    ink.status = 'blocked';
    ink.blockedOn = 'ink';
    asm.status = 'starved';
    asm.missing = 'spark';
    ink.grace = asm.grace = 0;
    const dx = diagnose(g, ink);
    expect(dx).toMatchObject({ problem: 'blocked', mat: 'ink', culprit: null, openPort: false });
    expect(wayOn(g, ink, dx)).toEqual({ node: asm.id, speed: false, waits: 'spark' });
  });
});

describe('"Upgrade all": what one press would buy', () => {
  /** Four Wells at levels 0, 0, 1 and 2 (their next levels cost 50, 50, 80 and 128). */
  function wells(credits: number): Game {
    clearHistory();
    const g = newGame();
    g.credits = 1e6;
    g.techs = ['P1', 'R1', 'P2', 'P3', 'S1'];
    for (const depositId of [2, 3, 4]) placeNode(g, 'well', 0, 0, { depositId });
    const all = g.nodes.filter((n) => n.type === 'well');
    expect(all).toHaveLength(4);
    upgrade(g, all[2].id, 'speed');
    upgrade(g, all[3].id, 'speed');
    upgrade(g, all[3].id, 'speed');
    g.credits = credits;
    return g;
  }

  it('says what the press spends and how many it raises, whatever the credits', () => {
    for (const credits of [0, 49, 50, 99, 100, 179, 180, 307, 308, 5000]) {
      const g = wells(credits);
      const plan = bulkPlan(g, 'well', 'speed');
      expect(plan.of).toBe(4);
      expect(plan.total).toBe(50 + 50 + 80 + 128);
      const raised = upgradeAll(g, 'well', 'speed');
      expect(raised, `with ${credits} credits`).toBe(plan.count);
      expect(credits - g.credits, `with ${credits} credits`).toBeCloseTo(plan.cost, 6);
    }
  });

  it('all of them when the credits reach, lowest level first when they do not, none below the cheapest', () => {
    expect(bulkPlan(wells(308), 'well', 'speed')).toEqual({ count: 4, of: 4, cost: 308, total: 308 });
    expect(bulkPlan(wells(200), 'well', 'speed')).toEqual({ count: 3, of: 4, cost: 180, total: 308 });
    expect(bulkPlan(wells(49), 'well', 'speed')).toEqual({ count: 0, of: 4, cost: 0, total: 308 });
  });

  it('a node with no level left on the track is not counted, nor paid for', () => {
    const g = wells(5000);
    const top = g.nodes.filter((n) => n.type === 'well')[3];
    top.lv.speed = maxLevel(g, 'speed');
    expect(bulkPlan(g, 'well', 'speed')).toEqual({ count: 3, of: 3, cost: 180, total: 180 });
    // (Efficiency is not a Well's track at all.)
    expect(bulkPlan(g, 'well', 'eff')).toEqual({ count: 0, of: 0, cost: 0, total: 0 });
  });
});

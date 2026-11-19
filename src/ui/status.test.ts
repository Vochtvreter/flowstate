// Which node the HUD's alert names, and what the board says at the ending (status.ts). These run without a
// browser: they only read the game.
import { describe, expect, it } from 'vitest';
import { clearHistory, connect, placeNode, upgrade, upgradeAll } from '../actions';
import { PIPES } from '../content';
import { labRate, maxLevel, upgradeCost } from '../economy';
import { GOALS } from '../goals';
import { tick } from '../sim';
import { Game, GNode, newGame } from '../state';
import { ALERT_QUIET, alertPick, bulkPlan, diagnose, limits, pillFor, starvedShort, wayOn } from './status';

const run = (g: Game, seconds: number) => {
  for (let i = 0; i < seconds * 20; i++) tick(g, 0.05);
};

/** The opening board: a Drill and a Market, two nodes the alert could name (what it says is made up here). */
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

  it('where the goal names no node, the card is about the kinds its hint names (goal 3: the new Drill)', () => {
    const { g, a, b } = twoOpenWells();
    g.goal = { i: GOALS.findIndex((x) => x.id === 'wire-all-wells'), ready: false };
    g.goalAt = { i: g.goal.i, t: g.time };
    // "Drag from the new Drill's port to the same Market": nothing is said about a Drill or that Market at first.
    expect(alertPick(g, -1, says, [])).toBeNull();
    g.goalAt = { i: g.goal.i, t: g.time - ALERT_QUIET - 1 };
    expect([a.id, b.id]).toContain(alertPick(g, -1, says, [])?.n.id);
  });
});

describe('starved means starved', () => {
  /** A Glass Refiner fed by the opening Sand Drill; the simulation is not run: their states are set by hand. */
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
    // Something else is in trouble (say, a Drill with nowhere to send its output): not named while the card's own
    // machine is short; named once the card is about something that runs.
    const words = (n: GNode) => (n.id === well.id ? 'trouble' : null);
    expect(alertPick(g, -1, words, [ref.id])).toBeNull();
    ref.status = 'working';
    expect(alertPick(g, -1, words, [ref.id])?.n.id).toBe(well.id);
  });

  it('a machine downstream of one that is merely short is starved itself, not a victim', () => {
    const { g, ref } = refinerFedByWell();
    ref.util = 0.8;
    // (Circuit takes Plastic and Copper; here only its Copper matters, and the Refiner is said to make it.)
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
  it('shows no trouble on any node between the first Phone and free play', () => {
    clearHistory();
    const g = newGame();
    g.credits = 1e9;
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'P5', 'P7', 'L1'];
    const fab = placeNode(g, 'fabricator', 600, 300, { recipe: 'lens' })!;
    const glyph = placeNode(g, 'assembler', 300, 200, { recipe: 'glyph' })!;
    connect(g, glyph.id, 0, fab.id);
    run(g, 1);
    // Starved of Circuit (as the simulation would have it after a first Phone): said, while the demo is still on.
    expect(fab.recipe).toBe('lens');
    fab.status = 'starved';
    fab.missing = 'glyph';
    expect(diagnose(g, fab).problem).toBe('starved');
    fab.status = 'blocked';
    fab.blockedOn = 'lens';
    expect(diagnose(g, fab).problem).toBe('blocked');
    // A machine that feeds it, starved too (the Silicon Refiner at the victory frame).
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
  /** The opening Sand Drill one Speed level up (1.25 a second), with everything researched that these boards need. */
  function fastWell(): { g: Game; well: GNode } {
    clearHistory();
    const g = newGame();
    g.credits = 1e6;
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'L1'];
    const well = g.nodes.find((n) => n.type === 'well')!;
    upgrade(g, well.id, 'speed');
    return { g, well };
  }

  it('a Drill that feeds a Lab studying as fast as it can: Speed on that Lab, and it works', () => {
    const { g, well } = fastWell();
    const lab = placeNode(g, 'lab', 500, 120)!;
    connect(g, well.id, 0, lab.id);
    run(g, 30);
    const dx = diagnose(g, well);
    expect(dx.problem).toBe('blocked');
    expect(dx.openPort).toBe(false);
    expect(dx.culprit).toBeNull();
    expect(wayOn(g, well, dx)).toEqual({ node: lab.id, speed: true, waits: null });
    // The press the box offers: the Lab takes all the Drill gives, and nothing is blocked any more.
    expect(upgrade(g, lab.id, 'speed')).toBe(true);
    run(g, 30);
    expect(diagnose(g, well).problem).toBeNull();
    expect(wayOn(g, well)).toBeNull();
  });

  it('a Drill that feeds a Refiner at full speed: Speed on that Refiner', () => {
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
    // (A Refiner with nowhere to send its Glass fills up and stops.)
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
    // (States set by hand, as elsewhere in this file: both take all they can, and the Drill backs up.)
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
    expect(wayOn(g, well)).toEqual({ node: lab.id, speed: false, waits: null, room: true });
    lab.rate = 1;
    expect(wayOn(g, well)?.speed).toBe(true);
    // (Only just built: not judged yet, so nothing is said about it.)
    lab.grace = 3;
    expect(wayOn(g, well)).toBeNull();
    lab.grace = 0;
    wire.rate = PIPES[wire.tier].cap;
    expect(wayOn(g, well)).toBeNull();
  });

  it('in the seconds after the Speed it offered is bought, the Lab is said to have room, never that it cannot take more', () => {
    const { g, well } = fastWell();
    const lab = placeNode(g, 'lab', 500, 120)!;
    connect(g, well.id, 0, lab.id);
    run(g, 30);
    expect(wayOn(g, well)).toEqual({ node: lab.id, speed: true, waits: null });
    expect(upgrade(g, lab.id, 'speed')).toBe(true);
    // The Drill is still called blocked while its output drains; the Lab has not reached its new rate yet.
    const said: string[] = [];
    for (let i = 0; i < 40 && diagnose(g, well).problem === 'blocked'; i++) {
      const on = wayOn(g, well)!;
      expect(on.node).toBe(lab.id);
      said.push(on.room ? 'room' : on.speed ? 'speed' : 'no more');
      run(g, 0.25);
    }
    expect(said[0]).toBe('room');
    expect(said).not.toContain('no more');
    expect(diagnose(g, well).problem).toBeNull();
  });

  it('of two with no Speed left to buy, the one that takes no more is named before the one with room', () => {
    const { g, well } = fastWell();
    const router = placeNode(g, 'router', 400, 120)!;
    const roomy = placeNode(g, 'lab', 700, 60)!;
    const full = placeNode(g, 'lab', 700, 240)!;
    connect(g, well.id, 0, router.id);
    connect(g, router.id, 0, roomy.id);
    connect(g, router.id, 0, full.id);
    well.status = 'blocked';
    well.blockedOn = 'glint';
    well.grace = roomy.grace = full.grace = 0;
    roomy.lv.speed = full.lv.speed = maxLevel(g, 'speed');
    roomy.rate = 0.2;
    full.rate = labRate(g, full);
    expect(wayOn(g, well)).toEqual({ node: full.id, speed: false, waits: null });
    full.rate = 0.2;
    expect(wayOn(g, well)).toEqual({ node: roomy.id, speed: false, waits: null, room: true });
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
  /** Four Drills at levels 0, 0, 1 and 2 (their next levels cost 50, 50, 80 and 128). */
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
    // (Efficiency is not a Drill's track at all.)
    expect(bulkPlan(g, 'well', 'eff')).toEqual({ count: 0, of: 0, cost: 0, total: 0 });
  });
});

describe('a card in trouble says what is wrong in plain words, and the machine that holds another back says so', () => {
  /** A board to build on: every tech and no worry about credits. */
  function open(): Game {
    clearHistory();
    const g = newGame();
    g.credits = 1e9;
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'L1'];
    return g;
  }
  const drill = (g: Game) => g.nodes.find((n) => n.type === 'well')!;
  const market = (g: Game) => g.nodes.find((n) => n.type === 'market')!;

  it('the opening board: the Drill\'s Sand has no exit, and the Market has nothing to say', () => {
    const g = open();
    run(g, 12);
    expect(pillFor(g, drill(g))).toEqual({ kind: 'blocked', text: 'Sand has no exit' });
    expect(pillFor(g, market(g))).toEqual({ kind: '', text: '' });
    // Wired, it has nothing to say either.
    connect(g, drill(g).id, 0, market(g).id);
    run(g, 12);
    expect(pillFor(g, drill(g))).toEqual({ kind: '', text: '' });
  });

  it('an output with no wire is named by its material: on a machine with two, the one that is stuck', () => {
    const g = open();
    const oil = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    const refiner = placeNode(g, 'refiner', 400, 400)!;
    connect(g, oil.id, 0, refiner.id);
    connect(g, refiner.id, 0, market(g).id);
    run(g, 40);
    expect(refiner.recipe).toBe('ink');
    expect(pillFor(g, refiner)).toEqual({ kind: 'blocked', text: 'Tar has no exit' });
    // (The Drill behind it only suffers from that: its ring turns amber, and the cause carries the words.)
    expect(pillFor(g, oil).text).toBe('');
  });

  it('wired and still full: "Backed up" on a machine, nothing on a Drill', () => {
    const g = open();
    const second = placeNode(g, 'well', 0, 0, { depositId: 2 })!;
    const refiner = placeNode(g, 'refiner', 400, 120)!;
    const lab = placeNode(g, 'lab', 700, 260)!;
    connect(g, drill(g).id, 0, refiner.id);
    // A Lab studies one item a second: a Drill of its own fills it, and the Glass has to wait.
    connect(g, second.id, 0, lab.id);
    for (let i = 0; i < 4; i++) upgrade(g, second.id, 'speed');
    run(g, 20);
    connect(g, refiner.id, 0, lab.id);
    run(g, 60);
    expect(diagnose(g, refiner)).toMatchObject({ problem: 'blocked', openPort: false, victim: false });
    expect(pillFor(g, refiner)).toEqual({ kind: 'blocked', text: 'Backed up' });
    expect(diagnose(g, second).problem).toBe('blocked');
    expect(pillFor(g, second)).toEqual({ kind: '', text: '' });
  });

  it('an input nothing brings: "Needs Copper"; a machine with nothing wired in: "No input"', () => {
    const g = open();
    const oil = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    const plastic = placeNode(g, 'refiner', 400, 400)!;
    connect(g, oil.id, 0, plastic.id);
    connect(g, plastic.id, 1, placeNode(g, 'void', 600, 600)!.id);
    const assembler = placeNode(g, 'assembler', 700, 400)!;
    expect(pillFor(g, assembler)).toEqual({ kind: 'idle', text: 'No input' });
    connect(g, plastic.id, 0, assembler.id);
    connect(g, assembler.id, 0, market(g).id);
    run(g, 40);
    expect(assembler.recipe).toBe('glyph');
    expect(pillFor(g, assembler)).toEqual({ kind: 'starved', text: 'Needs Copper' });
    expect(limits(g).size).toBe(0);
  });

  it('two Refiners on one Drill: each "Needs more Sand", and the Drill, flat out and green, "Can\u2019t keep up"', () => {
    const g = open();
    const a = placeNode(g, 'refiner', 400, 100)!;
    const b = placeNode(g, 'refiner', 400, 240)!;
    for (const r of [a, b]) {
      connect(g, drill(g).id, 0, r.id);
      connect(g, r.id, 0, market(g).id);
    }
    run(g, 60);
    for (const r of [a, b]) expect(pillFor(g, r)).toEqual({ kind: 'starved', text: 'Needs more Sand' });
    expect(drill(g).status).toBe('working');
    expect(diagnose(g, drill(g)).problem).toBeNull();
    expect([...limits(g)]).toEqual([drill(g).id]);
    expect(pillFor(g, drill(g))).toEqual({ kind: 'limit', text: 'Can\u2019t keep up' });
    // More Speed on the Drill, and nobody is waiting on it any more.
    for (let i = 0; i < 4; i++) upgrade(g, drill(g).id, 'speed');
    run(g, 60);
    expect(limits(g).size).toBe(0);
    expect(pillFor(g, drill(g)).text).toBe('');
    for (const r of [a, b]) expect(pillFor(g, r).text).toBe('');
  });

  it('no label is the simulation\'s word for it, and none is longer than a card is wide', () => {
    const g = open();
    const seen = new Set<string>();
    const oil = placeNode(g, 'well', 0, 0, { depositId: 3 })!;
    const plastic = placeNode(g, 'refiner', 400, 400)!;
    connect(g, oil.id, 0, plastic.id);
    for (let t = 0; t < 40; t++) {
      run(g, 1);
      for (const n of g.nodes) seen.add(pillFor(g, n).text);
    }
    seen.delete('');
    expect(seen.size).toBeGreaterThan(0);
    for (const text of seen) {
      expect(text).not.toMatch(/blocked|starved|idle/i);
      expect(text.length).toBeLessThanOrEqual(20);
    }
  });
});

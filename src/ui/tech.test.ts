// What the tech tree is allowed to show (docs/PITCH_PLAN.md section 3: "Tech tree shows less").
// These run without a browser: techTiles() and goalTech() only read the game.
import { describe, expect, it } from 'vitest';
import { BRANCHES, TECHS } from '../content';
import { claimGoal } from '../actions';
import { research, techAvailable, techGated, techHidden, techLocked } from '../economy';
import { GOALS } from '../goals';
import { Game, deserialize, newGame, serialize } from '../state';
import { Tile, delayText, goalDelay, goalSaving, goalTech, openedBy, readyCount, setCardWait, teasedSlot, techTiles } from './tech';
import { run as play } from '../../tests/helpers';

const show = (g: Game) => Object.fromEntries(techTiles(g).map((x) => [x.t.id, x.veiled ? 'veil' : x.state]));
const ids = (g: Game) => techTiles(g).map((x) => x.t.id).sort();
const byId = (g: Game, id: string): Tile | undefined => techTiles(g).find((x) => x.t.id === id);

/** Make β and γ known to the player (some of each in hand), so that what is priced in them may show. */
const meetAll = (g: Game) => {
  g.data.b = Math.max(g.data.b, 1);
  g.data.g = Math.max(g.data.g, 1);
};

/** The rule written out a second time, from the plan's wording, to check the implementation against. */
function allowed(g: Game): string[] {
  // Nothing priced in β or γ before the player has met that kind of Data (α is known from the start).
  const met = (k: 'a' | 'b' | 'g') => k === 'a' || g.data[k] > 0 || g.dataRate[k] > 0 || g.techs.some((id) => (TECHS[id]?.cost[k] ?? 0) > 0);
  const all = Object.values(TECHS).filter((t) => !techHidden(g, t) && (g.techs.includes(t.id) || (['a', 'b', 'g'] as const).every((k) => !t.cost[k] || met(k))));
  const own = (id: string) => g.techs.includes(id);
  // (In full as well: a tech that waits only for a goal to open it. It is locked, and its requirements are owned.)
  const gated = (t: (typeof all)[number]) => !!t.locked && !own(t.id) && !g.opened.includes(t.id) && t.requires.every(own);
  const full = new Set(all.filter((t) => own(t.id) || techAvailable(g, t) || gated(t) || (!t.auto && g.queue.includes(t.id))).map((t) => t.id));
  return all.filter((t) => full.has(t.id) || t.requires.every((r) => full.has(r))).map((t) => t.id).sort();
}

describe('tech tree: what is shown', () => {
  it('a new game shows only the two goal rewards that start the tree', () => {
    const g = newGame();
    expect(show(g)).toEqual({ P1: 'goal', R1: 'goal' });
  });

  it('the first visit shows 6 of 30: owned, researchable, goal rewards, and one step ahead as silhouettes', () => {
    const g = newGame();
    g.techs = ['P1', 'R1'];
    g.data.a = 47;
    // (Deep Analysis, one step behind Lab Speed, is priced in β: it stays out until the player has met β. Routing
    // is a research now, one step behind Oil Deposits: a silhouette, as Ore Deposits is.)
    expect(show(g)).toEqual({
      P1: 'own', R1: 'own',
      P2: 'rdy', R2: 'sav',
      L1: 'veil',
      P3: 'veil',
    });
    expect(Object.keys(TECHS)).toHaveLength(30);
    // Nothing of Scale tools is visible and Commerce waits for the first surplus, so both are left out.
    const branches = new Set(techTiles(g).map((x) => x.t.branch));
    expect(BRANCHES.filter((b) => branches.has(b.id)).map((b) => b.id)).toEqual(['processing', 'logistics', 'research']);
  });

  it('a silhouette names what to research first', () => {
    const g = newGame();
    g.techs = ['P1', 'R1'];
    const p3 = byId(g, 'P3')!;
    expect(p3.veiled).toBe(true);
    expect(p3.needs.map((t) => t.name)).toEqual(['Oil Deposits']);
  });

  it('nothing beyond a goal reward shows until the goal has paid it out', () => {
    const g = newGame();
    g.techs = ['P1', 'R1'];
    meetAll(g);
    for (const id of ['L3', 'L4', 'L2', 'S1', 'C2']) expect(byId(g, id)).toBeUndefined();
    g.techs.push('P2', 'L1', 'C1');
    for (const id of ['L3', 'L4', 'L2', 'C2']) expect(byId(g, id)?.veiled).toBe(false);
    // Bulk Upgrade is itself a goal reward ("Make your first Screen"), behind Assembly: once that is owned it says
    // which goal it comes from, and Auto-balance behind it stays out.
    expect(byId(g, 'S1')).toBeUndefined();
    g.techs.push('P3', 'P4');
    expect(byId(g, 'S1')?.state).toBe('goal');
    expect(byId(g, 'S3')).toBeUndefined();
    // Once that goal has paid it out, Auto-balance is one step ahead: it still needs Priority Routing.
    g.techs.push('S1');
    expect(byId(g, 'S3')?.veiled).toBe(true);
    expect(byId(g, 'S3')?.needs.map((t) => t.id)).toEqual(['L4']);
  });

  it('a tech two steps away is not shown, however many paths lead to it', () => {
    const g = newGame();
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4'];
    meetAll(g);
    // Laptop needs Reclamation (researchable) and Fabrication (a silhouette behind Quartz Deposits).
    expect(byId(g, 'P7')?.veiled).toBe(true);
    expect(byId(g, 'P8')).toBeUndefined();
    g.techs.push('P5');
    expect(byId(g, 'P8')?.veiled).toBe(true);
    expect(byId(g, 'P9')).toBeUndefined();
  });

  it('Long Absence stays out of the tree until the demo has ended', () => {
    const g = newGame();
    g.techs = ['P1', 'R1'];
    expect(byId(g, 'R4')).toBeUndefined();
    g.ended = true;
    expect(byId(g, 'R4')?.state).toBe('sav');
  });

  it('a queued tech is shown in full even before it can be researched', () => {
    const g = newGame();
    g.techs = ['P1', 'R1'];
    g.queue = ['P3'];
    const p3 = byId(g, 'P3')!;
    expect(p3.veiled).toBe(false);
    expect(p3.queued).toBe(true);
    expect(p3.state).toBe('lck');
    // ...and it counts as shown in full, so what follows it appears as a silhouette.
    expect(byId(g, 'P4')?.veiled).toBe(true);
  });

  it('ids that do not exist are ignored', () => {
    const g = newGame();
    g.techs = ['P1', 'R1', 'ZZ9', 'P99'];
    g.queue = ['NOPE'];
    expect(() => techTiles(g)).not.toThrow();
    expect(ids(g)).toEqual(allowed(g));
    expect(ids(g)).toHaveLength(6);
  });

  it('researching in any order: the tree always matches the rule, and nothing shown ever disappears', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let run = 0; run < 25; run++) {
      const g = newGame();
      g.techs = ['P1', 'R1'];
      g.ended = run % 5 === 0;
      let before = ids(g);
      for (let step = 0; step < 40; step++) {
        g.data = { a: 1e9, b: 1e9, g: 1e9 };
        const open = Object.values(TECHS).filter((t) => techAvailable(g, t));
        // Goal rewards arrive at some point too, and goals open the steps of the spine for research.
        if (rnd() < 0.2) for (const id of ['S1', 'C1']) if (!g.techs.includes(id)) g.techs.push(id);
        if (rnd() < 0.3) for (const id of ['P3', 'P4', 'P5', 'P7']) if (!g.opened.includes(id)) g.opened.push(id);
        if (!open.length) break;
        research(g, open[Math.floor(rnd() * open.length)].id);
        const now = ids(g);
        expect(now).toEqual(allowed(g));
        for (const id of before) expect(now).toContain(id);
        before = now;
      }
    }
  });
});

describe('tech tree: the tech the goal asks for', () => {
  const at = (title: string) => {
    const g = newGame();
    g.goal = { i: GOALS.findIndex((x) => x.title === title), ready: false };
    return g;
  };

  it('reads it from the goal wording', () => {
    expect(goalTech(at('Open up the Oil deposit'))).toBe('P2');
    expect(goalTech(at('Make and sell Copper'))).toBe('P3');
    expect(goalTech(at('Make your first Circuit'))).toBe('P4');
    expect(goalTech(at('Make and sell Silicon'))).toBe('P5');
    expect(goalTech(at('Build a Fabricator'))).toBe('P7');
  });

  it('is nothing once the tech is owned, the goal is ready, or the goal names no tech', () => {
    const g = at('Open up the Oil deposit');
    g.techs = ['P1', 'R1', 'P2'];
    expect(goalTech(g)).toBeNull();
    const h = at('Make and sell Copper');
    h.goal.ready = true;
    expect(goalTech(h)).toBeNull();
    expect(goalTech(at('Open up more land'))).toBeNull();
    const done = newGame();
    done.goal = { i: GOALS.length, ready: false };
    expect(goalTech(done)).toBeNull();
  });
});

describe('build bar: the one locked slot on show', () => {
  const at = (goalId: string, techs: string[]) => {
    const g = newGame();
    g.goal = { i: GOALS.findIndex((x) => x.id === goalId), ready: false };
    g.techs = techs;
    return g;
  };
  const slot = (g: Game) => {
    const s = teasedSlot(g);
    return s ? `${s.type}:${s.tech.name}${s.goal ? ' (goal)' : ''}` : null;
  };

  it('nothing is teased before the goal that pays out Refining is on the card', () => {
    expect(slot(at('wire-market', []))).toBeNull();
    expect(slot(at('second-well', []))).toBeNull();
  });

  it('the Refiner shows as a silhouette while its goal is on the card, and it cannot be opened in the tree', () => {
    const g = at('wire-all-wells', []);
    expect(GOALS[g.goal.i].reward.techs).toContain('P1');
    expect(slot(g)).toBe('refiner:Refining (goal)');
  });

  it('the Assembler waits until Assembly can be researched', () => {
    expect(slot(at('build-refiner', ['P1']))).toBeNull();
    expect(slot(at('make-spark', ['P1', 'R1', 'P2']))).toBeNull();
    expect(slot(at('make-spark', ['P1', 'R1', 'P2', 'P3']))).toBe('assembler:Assembly');
    expect(slot(at('make-glyph', ['P1', 'R1', 'P2', 'P3', 'L1']))).toBe('assembler:Assembly');
  });

  it('the Fabricator waits until Fabrication can be researched; then nothing is left to tease', () => {
    const upTo = ['P1', 'R1', 'P2', 'P3', 'L1', 'P4'];
    expect(slot(at('make-mist', upTo))).toBeNull();
    expect(slot(at('make-prism', [...upTo, 'P5']))).toBe('fabricator:Fabrication');
    expect(slot(at('make-lens', [...upTo, 'P5', 'P7']))).toBeNull();
  });

  it('a goal that names the research brings the silhouette even when the research is a step away', () => {
    // "Build a Fabricator: Research Fabrication, then..." with Quartz Deposits (its requirement) not owned.
    const g = at('build-fabricator', ['P1', 'R1', 'P2', 'P3', 'L1', 'P4']);
    expect(techAvailable(g, TECHS.P7)).toBe(false);
    expect(slot(g)).toBe('fabricator:Fabrication');
  });

  it('only machines are ever teased, and never with a price', () => {
    for (let i = 0; i < GOALS.length; i++) {
      for (const techs of [[], ['P1', 'R1'], ['P1', 'R1', 'P2', 'P3', 'L1'], ['P1', 'R1', 'P2', 'P3', 'L1', 'P4', 'P5']]) {
        const g = newGame();
        g.goal = { i, ready: false };
        g.techs = techs;
        const s = teasedSlot(g);
        if (!s) continue;
        expect(['refiner', 'assembler', 'fabricator']).toContain(s.type);
        expect(g.techs).not.toContain(s.tech.id);
        expect(s.tech.name).not.toMatch(/[0-9¢αβγ]/);
      }
    }
  });
});

describe('tech tree: a step of the spine that waits for a growth goal', () => {
  const growInk = GOALS.findIndex((x) => x.id === 'grow-ink');
  const on = () => {
    const g = newGame();
    g.goal = { i: growInk, ready: false };
    g.techs = ['P1', 'R1', 'P2'];
    return g;
  };

  it('the four locked techs are the spine after Oil, each opened by the growth goal before the card that asks for it', () => {
    const locked = Object.values(TECHS).filter((t) => t.locked).map((t) => t.id);
    expect(locked).toEqual(['P3', 'P4', 'P5', 'P7']);
    expect(locked.map((id) => GOALS.find((x) => x.reward.opens?.includes(id))!.id)).toEqual(['grow-ink', 'grow-spark', 'grow-glyph', 'grow-prism']);
    expect(locked.map((id) => openedBy(TECHS[id]))).toEqual(['Make 1 Plastic a second', 'Make 1 Copper a second', 'Make 0.6 Circuits a second', 'Make 0.5 Screens a second']);
    expect(openedBy(TECHS.P2)).toBe('');
  });

  it('it is shown in full, with its price and the goal it waits for, and cannot be researched however much Data there is', () => {
    const g = on();
    g.data.a = 5000;
    expect(techLocked(g, TECHS.P3)).toBe(true);
    expect(techGated(g, TECHS.P3)).toBe(true);
    expect(techAvailable(g, TECHS.P3)).toBe(false);
    const tile = byId(g, 'P3')!;
    expect(tile).toMatchObject({ state: 'lck', veiled: false, gate: 'Make 1 Plastic a second' });
    expect(tile.needs).toEqual([]);
    expect(research(g, 'P3')).toBe(false);
    expect(g.data.a).toBe(5000);
    // What stands behind it stays a silhouette, and names it; it is not said to wait for a goal itself.
    expect(byId(g, 'P4')).toMatchObject({ veiled: true });
    expect(byId(g, 'P4')!.gate).toBeUndefined();
    // Locked with a requirement missing: an ordinary lock, the requirement is what the tile names.
    expect(techGated(g, TECHS.P4)).toBe(false);
    expect(techLocked(g, TECHS.P4)).toBe(true);
    // Not a locked one: Routing can be researched as soon as Oil Deposits is in.
    expect(techAvailable(g, TECHS.L1)).toBe(true);
    expect(byId(g, 'L1')!.gate).toBeUndefined();
  });

  it('claiming the goal opens it: researchable at once, and a queued one is researched on the next tick', () => {
    const g = on();
    g.queue.push('P3');
    g.data.a = 500;
    play(g, 1);
    expect(g.techs).not.toContain('P3'); // queued, affordable, locked: it waits
    expect(g.queue).toEqual(['P3']);
    g.goal.ready = true;
    expect(claimGoal(g)).toBe(true);
    expect(g.opened).toEqual(['P3']);
    expect(techLocked(g, TECHS.P3)).toBe(false);
    expect(byId(g, 'P3')).toMatchObject({ state: 'rdy', veiled: false });
    expect(byId(g, 'P3')!.gate).toBeUndefined();
    play(g, 0.1);
    expect(g.techs).toContain('P3');
    expect(g.queue).toEqual([]);
    // Owned, a lock means nothing any more; and Assembly, the next one, now waits for its own goal and nothing else.
    expect(techLocked(g, TECHS.P3)).toBe(false);
    expect(byId(g, 'P4')).toMatchObject({ state: 'lck', veiled: false, gate: 'Make 1 Copper a second' });
  });

  it('a save without the list of opened techs loads with none open, and a game that owns one never loses it', () => {
    const g = on();
    g.techs.push('P3');
    const raw = JSON.parse(serialize(g));
    delete raw.opened;
    const loaded = deserialize(JSON.stringify(raw))!;
    expect(loaded.opened).toEqual([]);
    expect(loaded.techs).toContain('P3');
    expect(byId(loaded, 'P3')).toMatchObject({ state: 'own' });
  });
});

describe('tech tree: nothing priced in a kind of Data the player has not met', () => {
  // Goal 15, "Hold 95% Flow": Copper is made, Routing is researched, β does not exist yet.
  const at15 = () => {
    const g = newGame();
    g.goal = { i: GOALS.findIndex((x) => x.id === 'hold-flow'), ready: false };
    g.techs = ['P1', 'R1', 'P2', 'P3', 'L1'];
    g.data.a = 300;
    return g;
  };

  it('Priority Routing (20β) and the other β techs stay out until the player has met β', () => {
    const g = at15();
    for (const id of ['L4', 'R3', 'L7']) expect(byId(g, id)).toBeUndefined();
    // α techs show as before, and the tree says more is to come.
    expect(byId(g, 'L3')?.state).toBe('rdy');
    g.data.b = 4;
    expect(byId(g, 'L4')?.state).toBe('sav');
    // Once met, β stays met: spending it all does not take Priority Routing away again.
    g.data.b = 0;
    expect(byId(g, 'L4')?.state).toBe('sav');
  });

  it('a tech the goal on the card names is shown whatever it is priced in (Reclamation in free play needs γ)', () => {
    const g = newGame();
    g.goal = { i: GOALS.findIndex((x) => x.id === 'make-clay'), ready: false };
    g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'L1'];
    g.ended = true;
    expect(goalTech(g)).toBe('P6');
    expect(byId(g, 'P6')?.state).toBe('sav');
    expect(byId(g, 'U2')).toBeUndefined();
  });
});

describe('tech tree: the goal\'s wait', () => {
  // Goal 11, "Make and sell Copper": saving 195α for Ore Deposits.
  const at11 = (a: number, rate = 0.75) => {
    const g = newGame();
    g.goal = { i: GOALS.findIndex((x) => x.id === 'make-spark'), ready: false };
    g.techs = ['P1', 'R1', 'P2'];
    g.data.a = a;
    g.dataRate.a = rate;
    return g;
  };

  it('knows what the goal is saving for: the tech its step names, or a count of Data', () => {
    expect(goalSaving(at11(78))?.tech?.id).toBe('P3');
    expect(goalSaving(at11(78))?.need).toEqual({ a: 195 });
    const g = newGame();
    g.goal = { i: GOALS.findIndex((x) => x.id === 'study-glyph'), ready: false };
    expect(goalSaving(g)).toEqual({ tech: null, need: { b: 40 } });
    g.goal.ready = true;
    expect(goalSaving(g)).toBeNull();
  });

  it('Lab Speed at goal 11 spends α Ore needs: it says by how much, and the badge leaves it out', () => {
    const g = at11(78);
    const d = goalDelay(g, TECHS.R2)!;
    // 50α at 0.75α/s: Ore's 195α comes about 67 s later.
    expect(d.tiers).toEqual(['a']);
    expect(d.seconds).toBeCloseTo(50 / 0.75, 3);
    expect(delayText(d)).toBe('Spends α you are saving for Ore Deposits: about 1 min later.');
    expect(byId(g, 'R2')).toMatchObject({ state: 'rdy', slows: true });
    expect(readyCount(g)).toBe(0);
    // With Ore's price in hand and 50α to spare, it takes nothing from the goal.
    const rich = at11(265 + 1);
    expect(goalDelay(rich, TECHS.R2)).toBeNull();
    expect(readyCount(rich)).toBe(2); // Ore Deposits itself, and Lab Speed
    // Nothing coming in: it says so without a time.
    const dry = at11(78, 0);
    expect(delayText(goalDelay(dry, TECHS.R2)!)).toBe('Spends α you are saving for Ore Deposits.');
  });

  it('the goal\'s own tech never warns about itself; a goal that saves credits warns about nothing', () => {
    expect(goalDelay(at11(300), TECHS.P3)).toBeNull();
    const g = newGame();
    g.goal = { i: GOALS.findIndex((x) => x.id === 'hold-flow'), ready: false };
    g.techs = ['P1', 'R1', 'P2', 'P3', 'L1'];
    g.data.a = 100;
    expect(goalSaving(g)).toBeNull();
    expect(goalDelay(g, TECHS.L3)).toBeNull();
  });

  it('a goal counting β ("Study Circuits for β"): Priority Routing would take from that count', () => {
    const g = newGame();
    g.goal = { i: GOALS.findIndex((x) => x.id === 'study-glyph'), ready: false };
    g.techs = ['P1', 'R1', 'P2', 'P3', 'L1', 'P4'];
    g.data.b = 25;
    g.dataRate.b = 0.5;
    expect(delayText(goalDelay(g, TECHS.L4)!)).toBe('Spends β your goal is counting: about 40 s later.');
  });

  it('counts with the income the goal card counts with, when the card has a wait to show', () => {
    const g = at11(78, 0.75);
    // The card measured 1α/s: 137α in about 137 s.
    setCardWait(() => ({ unit: 'α', have: 78, need: 215, eta: 137 }));
    try {
      expect(goalDelay(g, TECHS.R2)!.seconds).toBeCloseTo(50, 3);
    } finally {
      setCardWait(() => null);
    }
  });

  it('puts nothing off while the goal waits longer for the credits its step needs after the research (goal 21)', () => {
    // "Research Fabrication, then save up and build a Fabricator": Fabrication's 600α come well before the 8,500¢.
    const at21 = (credits: number, creditRate: number) => {
      const g = newGame();
      g.goal = { i: GOALS.findIndex((x) => x.id === 'build-fabricator'), ready: false };
      g.techs = ['P1', 'R1', 'P2', 'P3', 'L1', 'P4', 'P5', 'S1'];
      meetAll(g);
      g.data.a = 362;
      g.dataRate.a = 3.68;
      g.data.b = 335;
      g.credits = credits;
      g.creditRate = creditRate;
      return g;
    };
    const slow = at21(1000, 9);
    expect(goalSaving(slow)?.tech?.id).toBe('P7');
    expect(goalSaving(slow)?.then).toBe(8500);
    // 50α for Lab Speed puts Fabrication's α off by about 14 s, but the Fabricator's credits are 7 min away.
    expect(goalDelay(slow, TECHS.R2)).toBeNull();
    expect(byId(slow, 'R2')).toMatchObject({ state: 'rdy', slows: false });
    // The card's own income for those credits counts the same way.
    setCardWait(() => ({ unit: '¢', have: 1000, need: 4800, eta: 264 }));
    try {
      expect(goalDelay(at21(1000, 0.01), TECHS.R2)).toBeNull();
    } finally {
      setCardWait(() => null);
    }
    // With the credits nearly in, the α is what the goal waits for: Lab Speed puts it off again.
    const rich = at21(8490, 9);
    expect(goalDelay(rich, TECHS.R2)!.seconds).toBeCloseTo(50 / 3.68, 1);
    // No credits coming in at all says nothing about when: the Data alone is counted, as before.
    expect(goalDelay(at21(1000, 0), TECHS.R2)!.seconds).toBeCloseTo(50 / 3.68, 1);
  });
});

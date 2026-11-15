// What the tech tree is allowed to show (docs/PITCH_PLAN.md section 3: "Tech tree shows less").
// These run without a browser: techTiles() and goalTech() only read the game.
import { describe, expect, it } from 'vitest';
import { BRANCHES, TECHS } from '../content';
import { research, techAvailable, techHidden } from '../economy';
import { GOALS } from '../goals';
import { Game, newGame } from '../state';
import { Tile, goalTech, teasedSlot, techTiles } from './tech';

const show = (g: Game) => Object.fromEntries(techTiles(g).map((x) => [x.t.id, x.veiled ? 'veil' : x.state]));
const ids = (g: Game) => techTiles(g).map((x) => x.t.id).sort();
const byId = (g: Game, id: string): Tile | undefined => techTiles(g).find((x) => x.t.id === id);

/** The rule written out a second time, from the plan's wording, to check the implementation against. */
function allowed(g: Game): string[] {
  const all = Object.values(TECHS).filter((t) => !techHidden(g, t));
  const own = (id: string) => g.techs.includes(id);
  const full = new Set(all.filter((t) => own(t.id) || techAvailable(g, t) || (!t.auto && g.queue.includes(t.id))).map((t) => t.id));
  return all.filter((t) => full.has(t.id) || t.requires.every((r) => full.has(r))).map((t) => t.id).sort();
}

describe('tech tree: what is shown', () => {
  it('a new game shows only the two goal rewards that start the tree', () => {
    const g = newGame();
    expect(show(g)).toEqual({ P1: 'goal', R1: 'goal' });
  });

  it('the first visit shows 7 of 29: owned, researchable, goal rewards, and one step ahead as silhouettes', () => {
    const g = newGame();
    g.techs = ['P1', 'R1'];
    g.data.a = 47;
    expect(show(g)).toEqual({
      P1: 'own', R1: 'own',
      P2: 'rdy', R2: 'sav',
      L1: 'goal',
      P3: 'veil', R3: 'veil',
    });
    expect(Object.keys(TECHS)).toHaveLength(29);
    // Nothing of Scale tools is visible and Commerce waits for the first surplus, so both are left out.
    const branches = new Set(techTiles(g).map((x) => x.t.branch));
    expect(BRANCHES.filter((b) => branches.has(b.id)).map((b) => b.id)).toEqual(['processing', 'logistics', 'research']);
  });

  it('a silhouette names what to research first', () => {
    const g = newGame();
    g.techs = ['P1', 'R1'];
    const p3 = byId(g, 'P3')!;
    expect(p3.veiled).toBe(true);
    expect(p3.needs.map((t) => t.name)).toEqual(['Murk Deposits']);
  });

  it('nothing beyond a goal reward shows until the goal has paid it out', () => {
    const g = newGame();
    g.techs = ['P1', 'R1'];
    for (const id of ['L3', 'L4', 'L2', 'S1', 'C2']) expect(byId(g, id)).toBeUndefined();
    g.techs.push('L1', 'C1');
    for (const id of ['L3', 'L4', 'L2', 'S1', 'C2']) expect(byId(g, id)?.veiled).toBe(false);
    // Bulk Upgrade is itself a goal reward ("Fill three orders"): it says so, and Auto-balance behind it stays out.
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
    // Dynamo needs Reclamation (researchable) and Fabrication (a silhouette behind Breeze Deposits).
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
    expect(ids(g)).toHaveLength(7);
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
        // Goal rewards arrive at some point too.
        if (rnd() < 0.2) for (const id of ['L1', 'C1']) if (!g.techs.includes(id)) g.techs.push(id);
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
    expect(goalTech(at('Research Murk Deposits'))).toBe('P2');
    expect(goalTech(at('Make your first Spark'))).toBe('P3');
    expect(goalTech(at('Assemble your first Glyph'))).toBe('P4');
    expect(goalTech(at('Make your first Mist'))).toBe('P5');
    expect(goalTech(at('Build a Fabricator'))).toBe('P7');
  });

  it('is nothing once the tech is owned, the goal is ready, or the goal names no tech', () => {
    const g = at('Research Murk Deposits');
    g.techs = ['P1', 'R1', 'P2'];
    expect(goalTech(g)).toBeNull();
    const h = at('Make your first Spark');
    h.goal.ready = true;
    expect(goalTech(h)).toBeNull();
    expect(goalTech(at('Expand the board'))).toBeNull();
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
    // "Build a Fabricator: Research Fabrication, then..." with Breeze Deposits (its requirement) not owned.
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

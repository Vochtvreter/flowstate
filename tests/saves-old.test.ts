// Saves from elsewhere: one written by the public version of the game (branch main), which charged less for
// everything, and saves damaged in any of the ways a save can be (a later version's, a hand edit, a crash).
// Checked against fixtures made with the public version's own code (tests/fixtures/public-version.ts) and a
// board of the scripted card player.
import { describe, expect, it } from 'vitest';
import { claimGoal, claimOrder, clearHistory, connect, deleteNode, expandBoard, favour, placeNode, refundOf, upgrade, upgradeAll } from '../src/actions';
import { TECHS } from '../src/content';
import { advice, applyAdvice, lineAdvice } from '../src/advice';
import { nodeCost, research, techAffordable, upgradeCost } from '../src/economy';
import { flowInfo } from '../src/flow';
import { GOALS, activeGoal, goalView } from '../src/goals';
import { tick } from '../src/sim';
import { BACKUP_KEY, GNode, Game, cloneGame, deserialize, loadGame, serialize } from '../src/state';
import { playByTheCard } from './cardPlayer';
import { PUBLIC_BOARD, PUBLIC_WELL_ID, PUBLIC_WELL_PAID, PUBLIC_WELL_SPEED_10 } from './fixtures/public-version';

describe('a save from the public version', () => {
  it('selling what the public version sold cheaply refunds what it cost there, not today\'s price', () => {
    const raw = JSON.parse(PUBLIC_BOARD);
    clearHistory();
    const g = deserialize(PUBLIC_BOARD)!;
    const asm = g.nodes.filter((n) => n.type === 'assembler');
    expect(asm.length).toBe(3);
    const paid = asm.reduce((s, n) => s + raw.nodes.find((x: { id: number }) => x.id === n.id).paid, 0);
    const before = g.credits;
    for (const n of [...asm].reverse()) deleteNode(g, n.id);
    const refunded = g.credits - before;
    // (It refunded 5,850¢ for 1,389¢ paid: the Fabricator for the price of a few deletes.)
    expect(refunded, `paid ${paid} in the public version, refunded ${refunded} here`).toBeLessThanOrEqual(paid + 1e-6);
    expect(refunded).toBeGreaterThan(0);
  });

  it('a Drill with Speed 10 bought there refunds what it cost there (it refunded ten times as much)', () => {
    clearHistory();
    const g = deserialize(PUBLIC_WELL_SPEED_10)!;
    const n = g.nodes.find((x) => x.id === PUBLIC_WELL_ID)!;
    const paid = JSON.parse(PUBLIC_WELL_SPEED_10).nodes.find((x: { id: number }) => x.id === PUBLIC_WELL_ID).paid;
    expect(n.lv.speed).toBe(10);
    expect(paid).toBeGreaterThanOrEqual(PUBLIC_WELL_PAID); // the Drill itself, and its ten levels
    expect(n.legacyPaid).toBe(paid);
    const c0 = g.credits;
    deleteNode(g, n.id);
    // (It refunded 9,091¢: today's price of ten levels.)
    expect(g.credits - c0).toBeLessThanOrEqual(paid);
    // What is spent on it here counts in full: one more level, and the cap grows by its price.
    clearHistory();
    const h = deserialize(PUBLIC_WELL_SPEED_10)!;
    h.credits = 1e6;
    // (The first Drill of that board: the second one is at the top level already.)
    const m = h.nodes.find((x) => x.type === 'well' && x.id !== PUBLIC_WELL_ID)!;
    const was = m.legacyPaid!;
    const price = upgradeCost(m, 'speed');
    expect(upgrade(h, m.id, 'speed')).toBe(true);
    expect(m.legacyPaid).toBe(was + price);
    expect(refundOf(h, m)).toBeLessThanOrEqual(was + price);
    // It survives a save and load of this version: the cap is not lost.
    const again = deserialize(serialize(h))!;
    expect(again.nodes.find((x) => x.id === m.id)!.legacyPaid).toBe(was + price);
    // A node bought in this version has no such cap: it refunds what it would cost to buy back.
    const fresh = placeNode(again, 'refiner', 400, 400)!;
    expect(fresh.legacyPaid).toBeUndefined();
    expect(refundOf(again, fresh)).toBe(fresh.paid);
  });

  it('loads, and a player who does what the cards say plays it to the Phone: no goal stands for good', () => {
    clearHistory();
    const g = deserialize(PUBLIC_BOARD)!;
    const log: string[] = [];
    const start = g.time;
    let last = g.time;
    let busy = 0;
    while (!g.ended && g.time - start < 2 * 3600) {
      for (let i = 0; i < 40; i++) tick(g, 0.05);
      if (g.order?.ready) claimOrder(g);
      if (g.goal.ready) {
        log.push(`${Math.round(g.time - start)} s: ${GOALS[g.goal.i].id}`);
        claimGoal(g);
        last = g.time;
        continue;
      }
      if (g.time < busy) continue;
      // What the card asks: its own gesture, its line's step, or a tip.
      const step = lineAdvice(g);
      if (hint(g)) busy = g.time + 6;
      else if (step && applyAdvice(g, step)) busy = g.time + 6;
      else {
        const tip = advice(g);
        if (tip && applyAdvice(g, tip)) busy = g.time + 6;
      }
      expect(g.time - last, `stuck on ${GOALS[g.goal.i].id}\n${log.join('\n')}`).toBeLessThan(600);
      for (const v of [g.credits, g.data.a, g.data.b, g.data.g]) expect(Number.isFinite(v)).toBe(true);
    }
    expect(g.ended, log.join('\n')).toBe(true);
  });
});

/**
 * The gestures of the hints a board from the public version still needs (the rest of its goals are met on
 * arrival): a Router toward the Lab, the board's expansion, Circuit into a
 * Lab, Fabrication and the Fabricator, the Fabricator fed, and one press of Upgrade all. True if one was made.
 */
function hint(g: Game): boolean {
  const id = activeGoal(g)!.id;
  const by = (f: (n: GNode) => boolean) => g.nodes.find(f);
  const mk = by((n) => n.type === 'market')!;
  const lab = by((n) => n.type === 'lab');
  switch (id) {
    case 'route-lab': {
      const spark = by((n) => n.recipe === 'spark')!;
      let r = by((n) => n.type === 'router');
      if (!r) {
        if (g.credits < nodeCost(g, 'router')) return false;
        r = placeNode(g, 'router', spark.x + 120, spark.y + 60)!;
        connect(g, spark.id, 0, r.id);
        connect(g, r.id, 0, lab!.id);
        connect(g, r.id, 0, mk.id);
        return true;
      }
      const w = g.wires.find((x) => x.from === r!.id && x.to === lab!.id);
      return !!w && favour(g, r.id, w.id);
    }
    case 'expand': return expandBoard(g);
    case 'study-glyph': {
      const a = by((n) => n.recipe === 'glyph')!;
      return !g.wires.some((w) => w.from === a.id && w.to === lab!.id) && !!connect(g, a.id, 0, lab!.id);
    }
    case 'bulk-upgrade': return upgradeAll(g, 'well', 'speed') > 0;
    case 'build-fabricator': {
      if (!g.techs.includes('P7')) return techAffordable(g, TECHS.P7) && research(g, 'P7');
      const p = by((n) => n.recipe === 'prism')!;
      if (g.credits < nodeCost(g, 'fabricator')) return false;
      const f = placeNode(g, 'fabricator', p.x + 200, p.y)!;
      return !!connect(g, p.id, 0, f.id);
    }
    default: return false;
  }
}

/** A board from the middle of the demo: the scripted card player's, the moment "Hold 95% Flow" comes up. */
function midBoard(): string {
  let snap: Game | null = null;
  playByTheCard({ tendOrders: 'asked', onIdle: (g) => { if (!snap && activeGoal(g)!.id === 'hold-flow') snap = cloneGame(g); } });
  clearHistory();
  return serialize(snap!);
}

type Mut = (s: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAMAGE: Record<string, Mut> = {
  'nextId missing': (s) => { delete s.nextId; },
  'nextId lower than the ids in use': (s) => { s.nextId = 12; },
  'a node with an unknown type (a save from a later version)': (s) => { s.nodes.push({ ...s.nodes[1], id: 999, type: 'teleporter' }); },
  'a node without lv': (s) => { delete s.nodes[0].lv; },
  'a node with lv.speed null (NaN written by JSON)': (s) => { s.nodes[0].lv.speed = null; },
  'a node with x null': (s) => { s.nodes[2].x = null; },
  'a null entry in nodes': (s) => { s.nodes.push(null); },
  'a null entry in wires': (s) => { s.wires.push(null); },
  'deposits missing': (s) => { delete s.deposits; },
  'board missing': (s) => { delete s.board; },
  'board.expansions a string': (s) => { s.board.expansions = '2'; },
  'credits 1e999 (Infinity)': (s) => { s.credits = 1e999; },
  'time 1e999': (s) => { s.time = 1e999; },
  'node outb holds 1e999': (s) => { s.nodes[0].outb = { glint: 1e999 }; },
  'wire tier 9 (no such pipe)': (s) => { s.wires[0].tier = 9; },
  'wire port 5 on a one-port machine': (s) => { const w = s.wires.find((x: { from: number }) => s.nodes.find((n: { id: number }) => n.id === x.from).type === 'refiner'); w.port = 5; },
  'two nodes with the same id': (s) => { s.nodes.push({ ...s.nodes.find((n: { type: string }) => n.type === 'refiner'), x: 900, y: 900 }); },
  'two Drills on one deposit': (s) => { const w = s.nodes.find((n: { type: string }) => n.type === 'well'); s.nodes.push({ ...w, id: 998 }); },
  'stats missing': (s) => { delete s.stats; },
  'goal.i a string': (s) => { s.goal = { i: '3', ready: false }; },
  'paused true and savedAt in the future': (s) => { s.paused = true; s.savedAt = Date.now() + 1e10; },
};

describe('damaged saves load and play, or are refused, and an unreadable one is kept', () => {
  const base = midBoard();
  for (const [name, mut] of Object.entries(DAMAGE)) {
    it(name, () => {
      clearHistory();
      const s = JSON.parse(base);
      mut(s);
      const g = deserialize(JSON.stringify(s).replace('"credits":null', '"credits":1e999'));
      // Every one of these loads now: a part this version cannot use is dropped or given a sound value, not the whole save.
      expect(g, name).not.toBeNull();
      const problems: string[] = [];
      try {
        for (let i = 0; i < 1200; i++) {
          tick(g!, 0.05);
          if (g!.order?.ready) claimOrder(g!);
        }
        advice(g!);
        goalView(g!);
        flowInfo(g!);
        for (const n of [...g!.nodes]) refundOf(g!, n);
        placeNode(g!, 'well', 0, 0, { depositId: 2 });
        for (const n of [...g!.nodes].slice(-2)) deleteNode(g!, n.id);
        if (!deserialize(serialize(g!))) problems.push('does not survive a second save and load');
      } catch (e) {
        problems.push('throws: ' + (e as Error).message.split('\n')[0]);
      }
      for (const [k, v] of Object.entries({ credits: g!.credits, a: g!.data.a, b: g!.data.b, time: g!.time, flow: g!.flow })) if (!Number.isFinite(v)) problems.push(`${k} = ${v}`);
      for (const n of g!.nodes) for (const [m, v] of Object.entries(n.outb ?? {})) if (!Number.isFinite(v as number)) problems.push(`node ${n.id} outb ${m} = ${v}`);
      const ids = g!.nodes.map((n) => n.id).concat(g!.wires.map((w) => w.id));
      if (new Set(ids).size !== ids.length) problems.push('duplicate ids');
      expect(g!.nextId).toBeGreaterThan(Math.max(...ids, ...g!.deposits.map((d) => d.id)));
      expect(problems).toEqual([]);
    });
  }

  it('a node of a kind this version does not know is dropped with its wires, and the rest of the board is kept', () => {
    const s = JSON.parse(base);
    const known = s.nodes.length;
    s.nodes.push({ ...s.nodes[1], id: 999, type: 'teleporter' });
    s.wires.push({ ...s.wires[0], id: 1000, from: 999 });
    const g = deserialize(JSON.stringify(s))!;
    expect(g.nodes.length).toBe(known);
    expect(g.wires.some((w) => w.id === 1000)).toBe(false);
    expect(g.wires.length).toBe(JSON.parse(base).wires.length);
  });

  it('a save that cannot be read at all is copied aside before anything can overwrite it', () => {
    const store = new Map<string, string>();
    const was = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
    };
    try {
      store.set('flowstate-save-v1', '{"v":1,"nodes":"not a list"');
      expect(loadGame()).toBeNull();
      expect(store.get(BACKUP_KEY)).toBe('{"v":1,"nodes":"not a list"');
      // A readable one leaves no copy.
      store.clear();
      store.set('flowstate-save-v1', base);
      expect(loadGame()).not.toBeNull();
      expect(store.has(BACKUP_KEY)).toBe(false);
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = was;
    }
  });
});

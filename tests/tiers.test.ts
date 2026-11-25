// The tiers (docs/TIERS.md): a game started with ?tiers plays the guided start, a first contract at a Dock, Tier 1's
// contract in place of the chain's goals 8–16, and then the chain from the first Circuit on.
import { describe, expect, it } from 'vitest';
import { claimGoal, clearHistory, connect, placeNode } from '../src/actions';
import { RULES } from '../src/content';
import { demandRate, expansionCost, has, nodeCost, nodeUnlocked } from '../src/economy';
import { GOALS, activeGoal, goalView } from '../src/goals';
import { Game, deserialize, newGame, serialize } from '../src/state';
import { PLAYERS, playTiers } from '../tools/tiers';
import { market, run, take, well } from './helpers';

const indexOf = (id: string) => GOALS.findIndex((x) => x.id === id);

function tiersAt(id: string): Game {
  clearHistory();
  const g = newGame({ tiers: true });
  g.goal = { i: indexOf(id), ready: false };
  g.credits = 1e6;
  g.techs = ['P1', 'R1', 'P2', 'P3', 'L1', 'L2'];
  run(g, 0.05);
  return g;
}

describe('the tiers: the Dock and its contract', () => {
  it('a game of the chain never meets the tiers\' goals, nor the Dock', () => {
    clearHistory();
    const g = newGame();
    g.goal = { i: indexOf('tune-shard'), ready: true };
    expect(claimGoal(g)).toBe(true);
    expect(activeGoal(g)!.id).toBe('feed-lab');
    expect(nodeUnlocked(g, 'dock')).toBe(false);
    // A goal of the tiers set by hand is passed over on the next tick.
    g.goal = { i: indexOf('tier-parts'), ready: false };
    run(g, 0.05);
    expect(activeGoal(g)!.id).toBe('build-fabricator');
    expect(g.contract ?? null).toBeNull();
  });

  it('a game of tiers goes from the guided start to the first contract, which brings the Dock', () => {
    clearHistory();
    const g = newGame({ tiers: true });
    g.goal = { i: indexOf('tune-shard'), ready: true };
    expect(claimGoal(g)).toBe(true);
    expect(activeGoal(g)!.id).toBe('dock-glass');
    expect(nodeUnlocked(g, 'dock')).toBe(true);
    expect(take(g, 'unlock').map((e) => e.what)).toEqual(['dock']);
    expect(g.contract).toMatchObject({ goal: 'dock-glass', need: { shard: 30 }, got: {} });
    expect(goalView(g)).toMatchObject({ number: 8, total: 12, progress: [0, 30, 'Glass'] });
  });

  it('the Dock takes what the contract still wants and nothing else, and pays nothing for it', () => {
    const g = tiersAt('dock-glass');
    const sand = well(g);
    const glass = placeNode(g, 'refiner', 300, 100, { recipe: 'shard' })!;
    connect(g, sand.id, 0, glass.id);
    const dock = placeNode(g, 'dock', 500, 100)!;
    expect(dock).not.toBeNull();
    // Sand is not on the contract: the wire is there, and nothing goes down it.
    const second = placeNode(g, 'well', 100, 260, { depositId: 2 })!;
    const sandWire = connect(g, second.id, 0, dock.id)!;
    connect(g, glass.id, 0, dock.id);
    const credits = g.credits;
    run(g, 30);
    expect(g.contract!.got.glint ?? 0).toBe(0);
    expect(g.wires.find((w) => w.id === sandWire.id)!.flow).toBe(0);
    expect(g.contract!.got.shard).toBeGreaterThan(10);
    expect(g.credits).toBe(credits);
    // Filled, the Dock takes no more: the Refiner backs up unless something else takes its Glass.
    run(g, 60);
    expect(g.contract!.got.shard).toBe(30);
    expect(g.goal.ready).toBe(true);
    expect(glass.status).toBe('blocked');
  });

  it('a port wired to the Dock and a Market shares between them, evenly', () => {
    const g = tiersAt('dock-glass');
    const glass = placeNode(g, 'refiner', 300, 100, { recipe: 'shard' })!;
    connect(g, well(g).id, 0, glass.id);
    const dock = placeNode(g, 'dock', 500, 100)!;
    const toDock = connect(g, glass.id, 0, dock.id)!;
    const toMarket = connect(g, glass.id, 0, market(g).id)!;
    run(g, 40);
    const a = g.wires.find((w) => w.id === toDock.id)!.rate;
    const b = g.wires.find((w) => w.id === toMarket.id)!.rate;
    expect(a).toBeGreaterThan(0.15);
    expect(Math.abs(a - b)).toBeLessThan(0.1);
  });

  it('the first contract hands over Tier 1\'s tools, Tier 1\'s hands over Tier 2\'s, and Tier 2\'s leads on to the chain', () => {
    const g = tiersAt('dock-glass');
    g.techs = ['P1', 'R1'];
    g.contract!.got.shard = 30;
    run(g, 0.05);
    expect(g.goal.ready).toBe(true);
    expect(claimGoal(g)).toBe(true);
    for (const id of ['P2', 'P3', 'L1', 'L2']) expect(has(g, id), id).toBe(true);
    expect(g.ordersOn && g.flowOn).toBe(true);
    expect(activeGoal(g)!.id).toBe('tier-refining');
    expect(g.contract).toMatchObject({ goal: 'tier-refining', need: GOALS[indexOf('tier-refining')].contract });
    expect(activeGoal(g)!.tools!.length).toBeGreaterThanOrEqual(6);
    Object.assign(g.contract!.got, g.contract!.need);
    run(g, 0.05);
    expect(claimGoal(g)).toBe(true);
    // Tier 2: Assembly and Quartz Deposits are handed over, with the routing modes, the Silo and Upgrade all.
    for (const id of ['P4', 'P5', 'L4', 'L6', 'L5', 'S1']) expect(has(g, id), id).toBe(true);
    expect(activeGoal(g)!.id).toBe('tier-parts');
    expect(g.contract).toMatchObject({ goal: 'tier-parts', need: GOALS[indexOf('tier-parts')].contract, got: {} });
    expect(activeGoal(g)!.tools!.length).toBeGreaterThanOrEqual(6);
    Object.assign(g.contract!.got, g.contract!.need);
    run(g, 0.05);
    expect(claimGoal(g)).toBe(true);
    expect(g.opened).toContain('P7');
    expect(activeGoal(g)!.id).toBe('build-fabricator');
    expect(g.contract).toBeNull();
  });

  it('demand, land and Assemblers are the tiers\' own: demand four times over, each plot and Assembler dearer by less', () => {
    const g = tiersAt('tier-refining');
    g.nodes.push({ ...g.nodes[0], id: 9001, type: 'assembler' }, { ...g.nodes[0], id: 9002, type: 'assembler' });
    expect(nodeCost(g, 'assembler')).toBe(Math.round(1200 * RULES.tiers.assemblerGrowth ** 2));
    g.nodes = g.nodes.filter((n) => n.type !== 'assembler');
    expect(demandRate(g, 'shard')).toBe(1.5 * RULES.tiers.demandMult);
    g.board.expansions = 2;
    expect(expansionCost(g)).toBe(Math.round(360 * 1.5 * 1.5));
    clearHistory();
    const chain = newGame();
    chain.board.expansions = 2;
    expect(expansionCost(chain)).toBe(Math.round(360 * 2.5 * 2.5));
    expect(demandRate(chain, 'shard')).toBe(1.5);
  });

  it('a save keeps the way of playing, the Dock and the contract; a save of chain 2 stands on the same goal', () => {
    const g = tiersAt('tier-refining');
    g.contract!.got.ink = 42;
    const back = deserialize(serialize(g))!;
    expect(back.tiers).toBe(true);
    expect(back.dockOn).toBe(true);
    expect(back.contract).toMatchObject({ goal: 'tier-refining', got: { ink: 42 } });
    run(back, 0.05);
    expect(activeGoal(back)!.id).toBe('tier-refining');
    expect(back.contract!.got.ink).toBe(42);
    // Chain 2 had no tiers' goals: its goal 16 was "Make your first Circuit".
    clearHistory();
    const old = JSON.parse(serialize(newGame()));
    const loaded = deserialize(JSON.stringify({ ...old, chain: 2, goal: { i: 16, ready: false } }))!;
    run(loaded, 0.05);
    expect(activeGoal(loaded)!.id).toBe('make-glyph');
    // Chain 3 had no Tier 2: its goal 25 was "Build a Fabricator" (a game of tiers stands there as well).
    const tiersOld = JSON.parse(serialize(newGame({ tiers: true })));
    const loaded3 = deserialize(JSON.stringify({ ...tiersOld, chain: 3, goal: { i: 25, ready: false } }))!;
    run(loaded3, 0.05);
    expect(activeGoal(loaded3)!.id).toBe('build-fabricator');
  });
});

describe('the tiers: scripted players (tools/tiers.ts)', () => {
  // Seed 0, every player through both tiers (docs/TIERS.md §13, "Measured").
  const runs = PLAYERS.map((p) => playTiers(p, 0));
  for (const tier of ['t1', 't2'] as const) {
    it(`${tier === 't1' ? 'Tier 1' : 'Tier 2'}: every player fills the contract; one who builds more fills it sooner, and the one who builds least within twice the time`, () => {
      const t = Object.fromEntries(runs.map((r) => [r.player, r[tier].seconds]));
      for (const r of runs) expect(r[tier].seconds, r.player).not.toBeNull();
      expect(t.mixed!).toBeLessThan(t.minimal!);
      expect(t.tuner!).toBeLessThan(t.minimal!);
      expect(t.wide!).toBeLessThan(t.minimal!);
      const fastest = Math.min(...runs.map((r) => r[tier].seconds!));
      expect(t.minimal!).toBeLessThanOrEqual(2 * fastest);
      // A builder's tier is six to eight minutes (docs/TIERS.md §7).
      expect(t.mixed!).toBeGreaterThan(5 * 60);
      expect(t.mixed!).toBeLessThan(8 * 60);
    });
  }
});

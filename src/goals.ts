// The goal chain (docs/PITCH_PLAN.md 2.4). DOM-free.
//
// One goal is active at a time: g.goal = { i, ready }. Every tick the active goal's done(g) is checked;
// when it holds the goal becomes ready (event 'goal-ready') and stays ready until claimGoal(g) pays the
// reward (event 'goal-claimed'), moves on, and checks the next goal at once, so a goal the player has
// already met is ready the moment it is reached. Rewards are not undoable.
//
// Reward sizes are in the GOALS table below, tuned with `npm run pacing`. Five techs are goal rewards and
// cannot be bought: Refining, Lab, Routing, Market Lens and Bulk Upgrade. Through "Build a Lab and feed it"
// the credits paid so far always cover the next purchase the card asks for (tests/playthrough.test.ts).
import { MATERIALS, MatId, NodeType, RULES, TECHS } from './content';
import { endDemo, expansionCost, grantTech, has, nodeCost, nodeCount, upgradeCost } from './economy';
import { graph } from './graph';
import { startOrders } from './orders';
import { Game, GNode, GoalReward } from './state';

/** [current, target, unit]. Unit '¢' means "saving up credits"; 'α' / 'β' / 'γ' mean saving up Data. */
export type GoalProgress = [current: number, target: number, unit: string];

export interface Goal {
  id: string;
  title: string;
  /** One sentence on how to do it, worded for mouse and keyboard, and for touch. */
  hint: { mouse: string; touch: string };
  done(g: Game): boolean;
  /** For numeric goals, and for goals where the next step has to be saved up for. null = nothing to show. */
  progress?(g: Game): GoalProgress | null;
  reward: GoalReward;
  /** One of the big celebrations (the fifth is the first Flow State, see the 'flow-state' event). */
  big?: boolean;
  /** A free-play goal after the capstone. */
  free?: boolean;
}

// ---------- helpers for predicates ----------

const count = (g: Game, type: NodeType) => nodeCount(g, type);
const made = (g: Game, m: MatId) => !!g.made[m];
const outWires = (g: Game, n: GNode, port?: number) => {
  const ports = graph(g).outs.get(n.id);
  if (!ports) return 0;
  if (port != null) return ports[port]?.length ?? 0;
  let c = 0;
  for (const ws of ports) c += ws?.length ?? 0;
  return c;
};
const inWires = (g: Game, n: GNode) => graph(g).ins.get(n.id)?.length ?? 0;

/** "Saving up": credits toward a price. */
const saving = (g: Game, cost: number): GoalProgress => [Math.min(g.credits, cost), cost, '¢'];

/** Data toward a tech: the tier the player is furthest from affording. null once it is researched. */
function savingTech(g: Game, id: string): GoalProgress | null {
  if (has(g, id)) return null;
  const cost = TECHS[id].cost;
  let best: GoalProgress | null = null;
  let worst = Infinity;
  for (const k of ['a', 'b', 'g'] as const) {
    const c = cost[k] ?? 0;
    if (c <= 0) continue;
    const share = Math.min(1, g.data[k] / c);
    if (share < worst) {
      worst = share;
      best = [Math.min(g.data[k], c), c, k === 'a' ? 'α' : k === 'b' ? 'β' : 'γ'];
    }
  }
  return best;
}

/** Research first, then save for the machine if none of that kind is free to use yet. */
function techThenNode(g: Game, tech: string, type: NodeType, recipe: string): GoalProgress | null {
  const t = savingTech(g, tech);
  if (t) return t;
  if (g.nodes.some((n) => n.recipe === recipe)) return null;
  return saving(g, nodeCost(g, type));
}

/** A raw material line: research, then a Well on the deposit, then a Refiner. */
function rawLine(g: Game, tech: string, raw: MatId, recipe: string): GoalProgress | null {
  const t = savingTech(g, tech);
  if (t) return t;
  if (!g.nodes.some((n) => n.type === 'well' && n.material === raw)) return saving(g, nodeCost(g, 'well'));
  if (!g.nodes.some((n) => n.recipe === recipe)) return saving(g, nodeCost(g, 'refiner'));
  return null;
}

const wellsWired = (g: Game) => g.nodes.filter((n) => n.type === 'well' && outWires(g, n) > 0).length;

/** An Ink Refiner whose Silt port (the second one) is wired and that is actually running. */
function siltHandled(g: Game): boolean {
  return g.nodes.some((n) => n.recipe === 'ink' && outWires(g, n, 1) > 0 && n.util >= 0.25);
}

/** A Router in use that sends more to a Lab than to a Market: a bigger ratio weight, or an earlier priority slot. */
export function routerFavoursLab(g: Game): boolean {
  const c = graph(g);
  for (const n of g.nodes) {
    if (n.type !== 'router' || !inWires(g, n)) continue;
    const wires = c.outs.get(n.id)?.[0] ?? [];
    let lab = 0, market = 0, firstLab = -1, firstMarket = -1;
    wires.forEach((w, i) => {
      const type = c.byId.get(w.to)?.type;
      if (type === 'lab') {
        lab += Math.max(0, w.weight);
        if (firstLab < 0) firstLab = i;
      } else if (type === 'market') {
        market += Math.max(0, w.weight);
        if (firstMarket < 0) firstMarket = i;
      }
    });
    if (firstLab < 0 || firstMarket < 0) continue;
    if (n.mode === 'ratio' && lab > market) return true;
    if (n.mode === 'priority' && firstLab < firstMarket) return true;
  }
  return false;
}

const hint = (mouse: string, touch: string = mouse) => ({ mouse, touch });

// ---------- the chain ----------

/** Ordered goals: 22 for the demo, then free play. */
export const GOALS: Goal[] = [
  {
    id: 'wire-market', title: 'Wire the Well to the Market',
    hint: hint('Drag from the Well\'s glowing port to the Market.', 'Tap the Well\'s glowing port, then tap the Market.'),
    done: (g) => g.wires.some((w) => graph(g).byId.get(w.from)?.type === 'well' && graph(g).byId.get(w.to)?.type === 'market'),
    reward: { credits: 12 },
  },
  {
    id: 'second-well', title: 'Place a second Well',
    hint: hint('Pick the Well in the hotbar and click the free Glint deposit.', 'Tap Well in the bottom bar, then tap the free Glint deposit.'),
    done: (g) => count(g, 'well') >= 2,
    progress: (g) => saving(g, nodeCost(g, 'well')),
    reward: { credits: 10 },
  },
  {
    id: 'wire-all-wells', title: 'Wire it to the Market too',
    hint: hint(
      'Drag from the new Well\'s port to the same Market: a Market takes any number of wires.',
      'Tap the new Well\'s port, then tap the same Market: a Market takes any number of wires.',
    ),
    done: (g) => g.nodes.every((n) => n.type !== 'well' || outWires(g, n) > 0),
    progress: (g) => [wellsWired(g), count(g, 'well'), 'Wells'],
    reward: { credits: 50, techs: ['P1'] },
  },
  {
    id: 'build-refiner', title: 'Build a Refiner from a Well\'s port',
    hint: hint(
      'Drag from a Well\'s port into empty space, let go, and pick Refiner.',
      'Tap a Well\'s port, tap an empty spot, and pick Refiner.',
    ),
    done: (g) => g.nodes.some((n) => n.type === 'refiner' && inWires(g, n) > 0),
    progress: (g) => (count(g, 'refiner') ? null : saving(g, nodeCost(g, 'refiner'))),
    reward: { credits: 20 },
  },
  {
    id: 'sell-shard', title: 'Sell your first Shard',
    hint: hint(
      'Drag from the Refiner\'s port to the Market so its Shard gets sold.',
      'Tap the Refiner\'s port, then tap the Market so its Shard gets sold.',
    ),
    done: (g) => (g.sold.shard ?? 0) >= 1,
    reward: { credits: 70, techs: ['R1'] },
    big: true,
  },
  {
    id: 'upgrade-well', title: 'Upgrade a Well',
    hint: hint(
      'Click a Well and buy a Speed upgrade: whatever the Refiner cannot use is sold.',
      'Tap a Well and buy a Speed upgrade: whatever the Refiner cannot use is sold.',
    ),
    done: (g) => g.nodes.some((n) => n.type === 'well' && n.lv.speed >= 1),
    progress: (g) => {
      const well = g.nodes.find((n) => n.type === 'well');
      return well ? saving(g, upgradeCost(well, 'speed')) : null;
    },
    reward: { credits: 50 },
  },
  {
    id: 'feed-lab', title: 'Build a Lab and feed it',
    hint: hint(
      'Drag from the Refiner\'s port into empty space and pick Lab: what it studies becomes Data instead of credits.',
      'Tap the Refiner\'s port, tap an empty spot and pick Lab: what it studies becomes Data instead of credits.',
    ),
    done: (g) => g.data.a > 0,
    progress: (g) => (count(g, 'lab') ? null : saving(g, nodeCost(g, 'lab'))),
    reward: { a: 15 },
    big: true,
  },
  {
    id: 'research-murk', title: 'Research Murk Deposits',
    hint: hint('Open the Tech tree and spend your α Data on Murk Deposits.', 'Tap Tech and spend your α Data on Murk Deposits.'),
    done: (g) => has(g, 'P2'),
    progress: (g) => savingTech(g, 'P2'),
    reward: { credits: 40 },
  },
  {
    id: 'make-ink', title: 'Refine Murk into Ink',
    hint: hint(
      'Place a Well on the Murk deposit, then drag from its port and pick Refiner.',
      'Place a Well on the Murk deposit, then tap its port, tap an empty spot and pick Refiner.',
    ),
    done: (g) => made(g, 'ink'),
    progress: (g) => rawLine(g, 'P2', 'murk', 'ink'),
    reward: { credits: 40 },
  },
  {
    id: 'silt-exit', title: 'Give the Silt somewhere to go',
    // The condition needs the Refiner running, and it also stops when Ink has nowhere to go: say so.
    hint: hint(
      'The Ink Refiner stops when Ink or Silt piles up: sell the Ink at the Market, then drag from the second port and pick Void for the Silt.',
      'The Ink Refiner stops when Ink or Silt piles up: sell the Ink at the Market, then tap the second port, tap an empty spot and pick Void for the Silt.',
    ),
    done: siltHandled,
    reward: { a: 20 },
  },
  {
    id: 'make-spark', title: 'Make your first Spark',
    hint: hint('Research Ember Deposits, then put a Well on the Ember deposit and build a Refiner from its port.'),
    done: (g) => made(g, 'spark'),
    progress: (g) => rawLine(g, 'P3', 'ember', 'spark'),
    reward: { a: 25, unlock: 'orders' },
  },
  {
    id: 'first-order', title: 'Fill your first order',
    hint: hint(
      'An order counts items sold at any Market: send enough of what it asks for there, then click Claim on the order.',
      'An order counts items sold at any Market: send enough of what it asks for there, then tap Claim on the order.',
    ),
    done: (g) => g.stats.ordersFilled >= 1,
    progress: (g) => (g.order ? [Math.floor(g.order.got + 1e-9), g.order.need, MATERIALS[g.order.mat].name] : null),
    reward: { techs: ['L1', 'C1'] },
  },
  {
    id: 'route-lab', title: 'Route more to a Lab than to the Market',
    hint: hint(
      'Build a Router from a machine\'s port and wire it to a Lab and to a Market, then select the Router and press Favour on the Lab\'s wire.',
      'Build a Router from a machine\'s port and wire it to a Lab and to a Market, then tap the Router and tap Favour on the Lab\'s wire.',
    ),
    done: routerFavoursLab,
    progress: (g) => (count(g, 'router') ? null : saving(g, nodeCost(g, 'router'))),
    reward: { a: 30 },
  },
  {
    id: 'expand', title: 'Expand the board',
    hint: hint(
      'Click Expand board at the edge of the map to reveal new deposits.',
      'Tap Expand board at the edge of the map to reveal new deposits.',
    ),
    done: (g) => g.board.expansions >= 1,
    progress: (g) => saving(g, expansionCost(g)),
    reward: { credits: 60 },
  },
  {
    id: 'make-glyph', title: 'Assemble your first Glyph',
    hint: hint('Research Assembly, then build an Assembler and wire both Ink and Spark into it.'),
    done: (g) => made(g, 'glyph'),
    progress: (g) => techThenNode(g, 'P4', 'assembler', 'glyph'),
    reward: { credits: 300, unlock: 'flow' },
    big: true,
  },
  {
    id: 'hold-flow', title: 'Hold 75% Flow for 10 seconds',
    hint: hint(
      'Flow is the share of your Wells and machines running flat out: click the Flow ring to jump to the one holding it back.',
      'Flow is the share of your Wells and machines running flat out: tap the Flow ring to jump to the one holding it back.',
    ),
    done: (g) => g.flowHold >= RULES.flow.holdSeconds,
    progress: (g) => [Math.min(g.flowHold, RULES.flow.holdSeconds), RULES.flow.holdSeconds, 's'],
    reward: { credits: 300 },
  },
  {
    id: 'study-glyph', title: 'Study Glyph for β',
    hint: hint(
      'Drag from the Assembler\'s port to a Lab: Tier 2 items become β Data.',
      'Tap the Assembler\'s port, then tap a Lab: Tier 2 items become β Data.',
    ),
    done: (g) => g.data.b >= 10,
    progress: (g) => [Math.min(g.data.b, 10), 10, 'β'],
    reward: { a: 50 },
  },
  {
    id: 'make-mist', title: 'Make your first Mist',
    hint: hint('Research Breeze Deposits, then put a Well on a Breeze deposit and build a Refiner from its port.'),
    done: (g) => made(g, 'mist'),
    progress: (g) => rawLine(g, 'P5', 'breeze', 'mist'),
    reward: { a: 50 },
  },
  {
    id: 'make-prism', title: 'Assemble your first Prism',
    hint: hint('Build another Assembler and feed it two Shard for every Mist.'),
    done: (g) => made(g, 'prism'),
    progress: (g) => techThenNode(g, 'P5', 'assembler', 'prism'),
    reward: { credits: 600, b: 40 },
  },
  {
    id: 'three-orders', title: 'Fill three orders',
    hint: hint('Keep an eye on the order card: send what it asks for to a Market, then claim it.'),
    done: (g) => g.stats.ordersFilled >= 3,
    progress: (g) => [Math.min(g.stats.ordersFilled, 3), 3, 'orders'],
    // Bulk Upgrade arrives here, just before the long save for the Fabricator.
    reward: { credits: 1200, b: 60, techs: ['S1'] },
  },
  {
    id: 'build-fabricator', title: 'Build a Fabricator',
    hint: hint('Research Fabrication, then save up for the Fabricator: orders and a high Flow get you there faster.'),
    done: (g) => count(g, 'fabricator') >= 1,
    progress: (g) => savingTech(g, 'P7') ?? saving(g, nodeCost(g, 'fabricator')),
    reward: { b: 40 },
  },
  {
    id: 'make-lens', title: 'Make your first Lens',
    hint: hint('Feed the Fabricator one Prism and two Glyph for every Lens.'),
    done: (g) => made(g, 'lens'),
    reward: { unlock: 'end' },
    big: true,
  },
  // ---------- free play ----------
  {
    id: 'make-clay', title: 'Reclaim Silt into Clay', free: true,
    hint: hint('Research Reclamation, then send Silt to a Refiner instead of the Void.'),
    done: (g) => made(g, 'clay'),
    progress: (g) => techThenNode(g, 'P6', 'refiner', 'clay'),
    reward: { credits: 200 },
  },
  {
    id: 'make-coil', title: 'Wind your first Coil', free: true,
    hint: hint('Feed an Assembler one Spark and two Clay for every Coil.'),
    done: (g) => made(g, 'coil'),
    progress: (g) => techThenNode(g, 'P6', 'assembler', 'coil'),
    reward: { credits: 600 },
  },
  {
    id: 'make-dynamo', title: 'Spin up a Dynamo', free: true,
    hint: hint('Research Dynamo, then feed a Fabricator two Coil, a Glyph and a Prism.'),
    done: (g) => made(g, 'dynamo'),
    progress: (g) => techThenNode(g, 'P8', 'fabricator', 'dynamo'),
    reward: { credits: 1800 },
  },
  {
    id: 'make-paradox', title: 'Fold a Paradox', free: true,
    hint: hint('Research Paradox, then feed a Fabricator a Lens, a Dynamo and four raw Breeze.'),
    done: (g) => made(g, 'paradox'),
    progress: (g) => techThenNode(g, 'P9', 'fabricator', 'paradox'),
    reward: { credits: 7500 },
  },
];

/** Goals in the demo itself ("Goal 4 / 22"); the rest are free play. */
export const MAIN_GOALS = GOALS.filter((x) => !x.free).length;

export const goalById = (id: string) => GOALS.find((x) => x.id === id) ?? null;

/** The active goal, or null when every goal has been claimed. */
export const activeGoal = (g: Game): Goal | null => GOALS[g.goal.i] ?? null;

export interface GoalView {
  goal: Goal;
  /** 1-based position among the main goals, or among the free-play goals when `free`. */
  number: number;
  total: number;
  free: boolean;
  ready: boolean;
  /** The hint for the input in use. */
  hint: string;
  /** null when the goal is ready, or has nothing numeric to show. */
  progress: GoalProgress | null;
  reward: GoalReward;
  big: boolean;
}

/** Everything the goal card shows. null when every goal has been claimed. */
export function goalView(g: Game, touch = false): GoalView | null {
  const goal = activeGoal(g);
  if (!goal) return null;
  const free = !!goal.free;
  return {
    goal,
    number: free ? g.goal.i - MAIN_GOALS + 1 : g.goal.i + 1,
    total: free ? GOALS.length - MAIN_GOALS : MAIN_GOALS,
    free,
    ready: g.goal.ready,
    hint: touch ? goal.hint.touch : goal.hint.mouse,
    progress: g.goal.ready ? null : goal.progress?.(g) ?? null,
    reward: goal.reward,
    big: !!goal.big,
  };
}

/** Short text for a reward, e.g. "Refining + 50¢". */
export function rewardText(r: GoalReward): string {
  const parts: string[] = [];
  for (const id of r.techs ?? []) parts.push(TECHS[id]?.name ?? id);
  if (r.unlock === 'orders') parts.push('Orders');
  if (r.unlock === 'flow') parts.push('Flow meter');
  if (r.unlock === 'end') parts.push('Demo complete');
  if (r.credits) parts.push(`${r.credits}¢`);
  if (r.a) parts.push(`${r.a}α`);
  if (r.b) parts.push(`${r.b}β`);
  if (r.g) parts.push(`${r.g}γ`);
  return parts.join(' + ');
}

// ---------- ticking and claiming ----------

/** Grant the techs and switch on the feature a goal's reward carries. Safe to repeat: whatever is already there is left alone. */
function applyUnlocks(g: Game, r: GoalReward) {
  for (const id of r.techs ?? []) grantTech(g, id);
  if (r.unlock === 'orders' && !g.ordersOn) {
    g.ordersOn = true;
    g.events.push({ kind: 'unlock', what: 'orders', text: 'Orders unlocked.' });
    startOrders(g);
  } else if (r.unlock === 'flow' && !g.flowOn) {
    g.flowOn = true;
    g.events.push({ kind: 'unlock', what: 'flow', text: 'Flow meter unlocked: the more of your line runs flat out, the better your prices.' });
  } else if (r.unlock === 'end') endDemo(g);
}

/** How far down the chain each game's unlocks have been checked. */
const unlocksChecked = new WeakMap<Game, number>();

/**
 * Keep the game consistent with its place in the chain: the index stays inside the list, and every goal
 * already claimed has its techs and its feature. In normal play this does nothing; it repairs a save that
 * says "goal 17" without the Flow meter (which goal 16 could then never finish) or without the Router.
 */
function repairChain(g: Game) {
  if (g.goal.i > GOALS.length) g.goal = { i: GOALS.length, ready: false };
  const from = unlocksChecked.get(g) ?? 0;
  if (from >= g.goal.i) return;
  for (let i = from; i < g.goal.i; i++) applyUnlocks(g, GOALS[i].reward);
  unlocksChecked.set(g, g.goal.i);
}

/** Check the active goal. Called every tick; cheap. */
export function tickGoal(g: Game) {
  repairChain(g);
  if (g.goal.ready) return;
  const goal = GOALS[g.goal.i];
  if (!goal || !goal.done(g)) return;
  g.goal.ready = true;
  g.events.push({ kind: 'goal-ready', goal: goal.id, index: g.goal.i, text: `Goal complete: ${goal.title}` });
}

/** Pay out the ready goal and move to the next one. Returns false when there is nothing to claim. */
export function claimGoal(g: Game): boolean {
  const goal = GOALS[g.goal.i];
  if (!goal || !g.goal.ready) return false;
  const r = goal.reward;
  const index = g.goal.i;
  if (r.credits) {
    g.credits += r.credits;
    g.lifetime += r.credits;
    g.stats.fromGoals += r.credits;
  }
  g.data.a += r.a ?? 0;
  g.data.b += r.b ?? 0;
  g.data.g += r.g ?? 0;
  g.goal = { i: index + 1, ready: false };
  g.events.push({ kind: 'goal-claimed', goal: goal.id, index, reward: r, big: !!goal.big, text: `${goal.title}: ${rewardText(r)}` });
  applyUnlocks(g, r);
  // A goal the player has already met is ready at once.
  tickGoal(g);
  return true;
}

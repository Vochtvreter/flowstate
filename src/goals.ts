// The goal chain (docs/PITCH_PLAN.md 2.4). DOM-free.
//
// One goal is active at a time: g.goal = { i, ready }. Every tick the active goal's done(g) is checked;
// when it holds the goal becomes ready (event 'goal-ready') and stays ready until claimGoal(g) pays the
// reward (event 'goal-claimed'), moves on, and checks the next goal at once, so a goal the player has
// already met is ready the moment it is reached. Rewards are not undoable.
//
// Reward sizes are in the GOALS table below, tuned with `npm run pacing`. Four techs are goal rewards and
// cannot be bought: Refining, Lab, Routing and Bulk Upgrade. (Market Lens used to come with the first order;
// it now arrives by itself the first time something sells over its demand, see noteSurplus in src/sim.ts.)
// Through "Build a Lab and feed it" the credits paid so far always cover the next purchase the card asks for
// (tests/playthrough.test.ts).
//
// The hints are what a newcomer does, to the letter. So every card that has the player make something new
// also says to sell it (Ink, Spark, Glyph, Mist, Prism): a player who is never told leaves their dearest
// goods unsold and their machines blocked, and cannot pay for the Fabricator.
//
// The four goals with a long wait also carry a "while you wait" line (Goal.meanwhile): the one move that
// shortens that wait most for a player who does only what the cards say. The card is the channel every
// player obeys, so the structural advice lives there and not in the adviser's tips (src/advice.ts), which
// nobody is sure to follow. How the lines were chosen is in docs/CONTENT.md ("While you wait").
import { EXPANSION_DEPOSITS, MATERIALS, MatId, NODE_DEFS, NodeType, RULES, TECHS } from './content';
import { endDemo, expansionCost, grantTech, has, nodeCost, nodeCount, upgradeCost } from './economy';
import { countsForFlow, isFlowing, nearShare } from './flow';
import { graph } from './graph';
import { startOrders } from './orders';
import { Game, GNode, GoalReward } from './state';

/** [current, target, unit]. Unit '¢' means "saving up credits"; 'α' / 'β' / 'γ' mean saving up Data. */
export type GoalProgress = [current: number, target: number, unit: string];

/**
 * The next thing a goal needs bought: a tech to research, or something that costs credits. For a tech, `then`
 * is what the card asks the player to buy with credits straight after the research (the machine it unlocks),
 * when there is such a thing: the adviser reads it to see the whole of a wait, not only its first half.
 * `what` and `thenWhat` name what the credits are for, as a card would ("the Fabricator").
 */
export type GoalStep = { tech: string; then?: number; thenWhat?: string } | { credits: number; what?: string };

export interface Goal {
  id: string;
  title: string;
  /** One sentence on how to do it, worded for mouse and keyboard, and for touch. */
  hint: { mouse: string; touch: string };
  done(g: Game): boolean;
  /** For numeric goals, and for goals where the next step has to be saved up for. null = nothing to show. */
  progress?(g: Game): GoalProgress | null;
  /**
   * The purchase the card is asking for next, when there is one: what `progress` counts toward. null when
   * nothing has to be bought (any more). The adviser (src/advice.ts) reads it to know what a wait is for.
   */
  step?(g: Game): GoalStep | null;
  reward: GoalReward;
  /** One of the big celebrations (the fifth is the first Flow State, see the 'flow-state' event). */
  big?: boolean;
  /** A free-play goal after the capstone. */
  free?: boolean;
  /** A standing line for the goal's wait: one more thing worth doing meanwhile. */
  meanwhile?: Meanwhile;
}

/**
 * One concrete thing to do while a goal's wait runs. It is true (doing it on the board a card-following player
 * has ends that wait sooner: tests/meanwhile.test.ts tries it the way tips are tried), and it is never
 * something a later card or a tip undoes.
 */
export interface Meanwhile {
  /** One sentence, worded for mouse and keyboard and for touch: at most 90 characters each. */
  text: { mouse: string; touch: string };
  /** It has been done: the card ticks the line off. */
  done(g: Game): boolean;
  /** Does the line apply right now? Absent = for as long as the goal is the active one. While it does not, the card leaves it out. */
  when?(g: Game): boolean;
  /**
   * Wires the line asks the player to remove, if it asks for that. The adviser reads it: "remove this wire"
   * is only ever a tip when a card says the same.
   */
  cuts?(g: Game): number[];
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

const tech = (id: string, then = 0, thenWhat?: string): GoalStep => (then > 0 ? { tech: id, then, ...(thenWhat ? { thenWhat } : {}) } : { tech: id });
const price = (credits: number, what?: string): GoalStep => ({ credits, ...(what ? { what } : {}) });
const THE: Record<NodeType, string> = Object.fromEntries((Object.keys(NODE_DEFS) as NodeType[]).map((t) => [t, `the ${NODE_DEFS[t].name}`])) as Record<NodeType, string>;

/** What the card shows for a step: Data toward the tech, or credits toward the price. */
const show = (g: Game, s: GoalStep | null): GoalProgress | null => (!s ? null : 'tech' in s ? savingTech(g, s.tech) : saving(g, s.credits));

/** A goal whose next step is a purchase: the step itself, and the progress shown for it. */
const buying = (step: (g: Game) => GoalStep | null) => ({ step, progress: (g: Game) => show(g, step(g)) });

/** Research first, then save for the machine if none of that kind is free to use yet. */
function techThenNode(g: Game, id: string, type: NodeType, recipe: string): GoalStep | null {
  const built = g.nodes.some((n) => n.recipe === recipe);
  if (!has(g, id)) return tech(id, built ? 0 : nodeCost(g, type), THE[type]);
  return built ? null : price(nodeCost(g, type), THE[type]);
}

/** A raw material line: research, then a Well on the deposit, then a Refiner. */
function rawLine(g: Game, id: string, raw: MatId, recipe: string): GoalStep | null {
  const well = g.nodes.some((n) => n.type === 'well' && n.material === raw);
  const refiner = g.nodes.some((n) => n.recipe === recipe);
  if (!has(g, id)) return tech(id, (well ? 0 : nodeCost(g, 'well')) + (refiner ? 0 : nodeCost(g, 'refiner')), well ? THE.refiner : refiner ? THE.well : 'the Well and the Refiner');
  if (!well) return price(nodeCost(g, 'well'), THE.well);
  if (!refiner) return price(nodeCost(g, 'refiner'), THE.refiner);
  return null;
}

const wellsWired = (g: Game) => g.nodes.filter((n) => n.type === 'well' && outWires(g, n) > 0).length;

/** An Ink Refiner whose Silt port (the second one) is wired and that is actually running. */
function siltHandled(g: Game): boolean {
  return g.nodes.some((n) => n.recipe === 'ink' && outWires(g, n, 1) > 0 && n.util >= 0.25);
}

const typeOf = (g: Game, id: number) => graph(g).byId.get(id)?.type;

/** Wires that run straight from a machine making `recipe` (its first port) into a Lab. */
const studyWires = (g: Game, recipe: string) =>
  g.wires.filter((w) => w.port === 0 && graph(g).byId.get(w.from)?.recipe === recipe && typeOf(g, w.to) === 'lab');

/**
 * Labs that study what Wells give them and nothing else: a Well with a Lab of its own is 1 α a second for
 * good. (A Well wired into a Lab that also studies Shard or Glyph does not count: it takes their place.)
 */
function wellLabs(g: Game): number {
  const c = graph(g);
  return g.nodes.filter((n) => {
    const fed = n.type === 'lab' ? c.ins.get(n.id) ?? [] : [];
    return fed.length > 0 && fed.every((w) => c.byId.get(w.from)?.type === 'well');
  }).length;
}

/**
 * Has a deposit that came with the board's second expansion (or a later one) got a Well with a Lab of its own?
 * What "Make your first Mist" asks for meanwhile, read to the letter: a player who left the first expansion's
 * deposits alone and does exactly this has done it too.
 */
function laterWellLab(g: Game): boolean {
  let n = 0;
  for (let i = 1; i < g.board.expansions; i++) n += EXPANSION_DEPOSITS[i % EXPANSION_DEPOSITS.length].length;
  if (n <= 0) return false;
  const later = new Set(g.deposits.slice(-n).map((d) => d.id));
  const c = graph(g);
  return g.nodes.some((lab) => {
    const fed = lab.type === 'lab' ? c.ins.get(lab.id) ?? [] : [];
    const wells = fed.map((w) => c.byId.get(w.from));
    return fed.length > 0 && wells.every((x) => x?.type === 'well') && wells.some((x) => x?.depositId != null && later.has(x.depositId));
  });
}

/** Is there a deposit with no Well on it that the player could put one on, or a Well that has not been wired to anything yet? */
const wellToPlace = (g: Game) => g.deposits.some((d) => has(g, MATERIALS[d.mat].tech) && !g.nodes.some((n) => n.depositId === d.id))
  || g.nodes.some((n) => n.type === 'well' && outWires(g, n) === 0);

/** Does the player hold the Data a tech costs (or the tech itself)? */
const dataFor = (g: Game, id: string, tier: 'a' | 'b' | 'g') => has(g, id) || g.data[tier] >= (TECHS[id].cost[tier] ?? 0);

/** "Build a Fabricator": Fabrication's β is covered, and the Fabricator still has to be saved for. */
const sellGlyphNow = (g: Game) => dataFor(g, 'P7', 'b') && count(g, 'fabricator') === 0 && g.credits < nodeCost(g, 'fabricator');

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

/** Seconds the active goal has been the active one (0 until the first tick has seen it). */
export const goalAge = (g: Game) => (g.goalAt && g.goalAt.i === g.goal.i ? Math.max(0, g.time - g.goalAt.t) : 0);

/**
 * The Flow goal. Its bar is RULES.flow.holdShare, held for holdSeconds. The valve: once the goal has been on
 * the card for RULES.flow.valveAfter seconds it also passes with all but one producer flowing, held just as
 * long. (A board with one producer that nobody can get flowing would otherwise stop the chain for good.)
 */
const flowValveOpen = (g: Game) => goalAge(g) >= RULES.flow.valveAfter;
const flowHeld = (g: Game) => (flowValveOpen(g) ? Math.max(g.flowHold, g.flowNear) : g.flowHold);

/** What the Flow goal's card shows beside its count-down. */
export interface FlowGoalView {
  /** Smoothed Flow, 0..1: what the ring shows. */
  pct: number;
  /** Producers flowing right now, and producers counted. */
  running: number;
  of: number;
  /** The share needed right now: the goal's bar, or "all but one" once the valve is open. */
  need: number;
}

function flowGoalView(g: Game): FlowGoalView {
  let of = 0;
  let running = 0;
  for (const n of g.nodes) {
    if (!countsForFlow(g, n)) continue;
    of++;
    if (isFlowing(n)) running++;
  }
  return { pct: g.flow, running, of, need: flowValveOpen(g) ? nearShare(of) : RULES.flow.holdShare };
}

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
    ...buying((g) => price(nodeCost(g, 'well'), THE.well)),
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
    ...buying((g) => (count(g, 'refiner') ? null : price(nodeCost(g, 'refiner'), THE.refiner))),
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
    ...buying((g) => {
      const well = g.nodes.find((n) => n.type === 'well');
      return well ? price(upgradeCost(well, 'speed'), 'the Speed upgrade') : null;
    }),
    reward: { credits: 50 },
  },
  {
    id: 'feed-lab', title: 'Build a Lab and feed it',
    hint: hint(
      'Drag from the Refiner\'s port into empty space and pick Lab: what it studies becomes Data instead of credits.',
      'Tap the Refiner\'s port, tap an empty spot and pick Lab: what it studies becomes Data instead of credits.',
    ),
    done: (g) => g.data.a > 0,
    ...buying((g) => (count(g, 'lab') ? null : price(nodeCost(g, 'lab'), THE.lab))),
    reward: { a: 15 },
    big: true,
  },
  {
    id: 'research-murk', title: 'Research Murk Deposits',
    hint: hint('Open the Tech tree and spend your α Data on Murk Deposits.', 'Tap Tech and spend your α Data on Murk Deposits.'),
    done: (g) => has(g, 'P2'),
    ...buying((g) => (has(g, 'P2') ? null : tech('P2'))),
    reward: { credits: 40 },
  },
  {
    id: 'make-ink', title: 'Refine Murk into Ink',
    hint: hint(
      'Place a Well on the Murk deposit, then drag from its port and pick Refiner.',
      'Place a Well on the Murk deposit, then tap its port, tap an empty spot and pick Refiner.',
    ),
    done: (g) => made(g, 'ink'),
    ...buying((g) => rawLine(g, 'P2', 'murk', 'ink')),
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
    hint: hint('Research Ember Deposits, then put a Well on the Ember deposit, build a Refiner from its port and sell the Spark.'),
    done: (g) => made(g, 'spark'),
    ...buying((g) => rawLine(g, 'P3', 'ember', 'spark')),
    // The first long wait for α, and the Lab studies only half the Shard. Ink is the dearest thing on the board.
    meanwhile: {
      text: hint(
        'Drag from the Ink Refiner\'s Ink port to the Lab too: studied Ink is 3 α each.',
        'Tap the Ink Refiner\'s Ink port, then tap the Lab too: studied Ink is 3 α each.',
      ),
      done: (g) => studyWires(g, 'ink').length > 0,
      when: (g) => count(g, 'lab') > 0 && g.nodes.some((n) => n.recipe === 'ink'),
    },
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
    // Routing, and credits for what the next two cards ask the player to buy with it: a Router and the board's
    // first expansion. (It used to pay Market Lens: price gauges for a rule that does not bite before the Lens.)
    reward: { credits: 200, techs: ['L1'] },
  },
  {
    id: 'route-lab', title: 'Route more to a Lab than to the Market',
    // The Spark Refiner by name: Spark is the one refined material nothing studies yet (Shard has the Lab of
    // goal 7, Ink the "while you wait" line of goal 11), so that is where a Router toward a Lab pays.
    hint: hint(
      'Build a Router from the Spark Refiner\'s port and wire it to a Lab and to a Market, then select the Router and press Favour on the Lab\'s wire.',
      'Build a Router from the Spark Refiner\'s port and wire it to a Lab and to a Market, then tap the Router and tap Favour on the Lab\'s wire.',
    ),
    done: routerFavoursLab,
    ...buying((g) => (count(g, 'router') ? null : price(nodeCost(g, 'router'), THE.router))),
    reward: { a: 30 },
  },
  {
    id: 'expand', title: 'Expand the board',
    hint: hint(
      'Click Expand board at the edge of the map to reveal new deposits.',
      'Tap Expand board at the edge of the map to reveal new deposits.',
    ),
    done: (g) => g.board.expansions >= 1,
    ...buying((g) => price(expansionCost(g), 'the expansion')),
    reward: { credits: 60 },
  },
  {
    id: 'make-glyph', title: 'Assemble your first Glyph',
    hint: hint('Research Assembly, then build an Assembler, wire both Ink and Spark into it and sell its Glyph at the Market.'),
    done: (g) => made(g, 'glyph'),
    ...buying((g) => techThenNode(g, 'P4', 'assembler', 'glyph')),
    // The board has just grown by two deposits. A Well with a Lab of its own is 1 α a second for good: wired
    // into the Lab the player already has it would only push the dearer Shard and Ink (and later Glyph) aside.
    // Both deposits: with one pair this wait was still four and a half minutes for a player who gets no tip.
    meanwhile: {
      text: hint('Give each new deposit a Well and a Lab built from its port: each pair is 1 α a second.'),
      done: (g) => wellLabs(g) >= 2,
      when: (g) => wellLabs(g) >= 2 || wellToPlace(g),
    },
    reward: { credits: 150, unlock: 'flow' },
    big: true,
  },
  {
    id: 'hold-flow', title: 'Hold 95% Flow for 10 seconds',
    hint: hint(
      'Flow is the share of your Wells and machines running flat out: click the Flow ring to jump to the one holding it back.',
      'Flow is the share of your Wells and machines running flat out: tap the Flow ring to jump to the one holding it back.',
    ),
    done: (g) => flowHeld(g) >= RULES.flow.holdSeconds,
    progress: (g) => [Math.min(flowHeld(g), RULES.flow.holdSeconds), RULES.flow.holdSeconds, 's'],
    reward: { credits: 150 },
  },
  {
    id: 'study-glyph', title: 'Study Glyph for β',
    hint: hint(
      'Drag from the Assembler\'s port to a Lab: Tier 2 items become β Data.',
      'Tap the Assembler\'s port, then tap a Lab: Tier 2 items become β Data.',
    ),
    done: (g) => g.data.b >= RULES.goals.studyBeta,
    progress: (g) => [Math.min(g.data.b, RULES.goals.studyBeta), RULES.goals.studyBeta, 'β'],
    reward: { a: 50 },
  },
  {
    id: 'make-mist', title: 'Make your first Mist',
    hint: hint('Research Breeze Deposits, then put a Well on a Breeze deposit, build a Refiner from its port and sell the Mist.'),
    done: (g) => made(g, 'mist'),
    ...buying((g) => rawLine(g, 'P5', 'breeze', 'mist')),
    // The dearest research so far, and the Assembler now takes most of the Ink and Spark the Lab was studying.
    // Both deposits of the first expansion are in use by now; the second expansion costs 500¢ and brings two more.
    meanwhile: {
      text: hint('Expand the board again, then give a new deposit a Well and a Lab of its own.'),
      // Three such pairs (the two of the Glyph card's line and one more), or the very thing the line names.
      done: (g) => wellLabs(g) >= 3 || laterWellLab(g),
      // Not the Breeze deposit this very card is about to ask for: only while Breeze is still locked, or done.
      when: (g) => wellLabs(g) >= 3 || laterWellLab(g) || !has(g, 'P5'),
    },
    reward: { a: 50 },
  },
  {
    id: 'make-prism', title: 'Assemble your first Prism',
    hint: hint('Build another Assembler, feed it two Shard for every Mist and sell its Prism at the Market.'),
    done: (g) => made(g, 'prism'),
    ...buying((g) => techThenNode(g, 'P5', 'assembler', 'prism')),
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
    ...buying((g) => (has(g, 'P7') ? price(nodeCost(g, 'fabricator'), THE.fabricator) : tech('P7', nodeCost(g, 'fabricator'), THE.fabricator))),
    // Goal 17 had the player study Glyph. Fabrication's β is in hand by now (the two goals before pay it), and
    // from here every Glyph in a Lab is 20¢ not earned toward the Fabricator. This is the one place the chain
    // takes a wire back, and it is a card that says so: the adviser never reverses a card (src/advice.ts).
    // It applies while the β is covered and the Fabricator's price is not: a player who already has the
    // credits (one who never spent any on upgrades) gains nothing by it, and is not asked.
    meanwhile: {
      text: hint(
        'You have the β you need: remove the wire from the Glyph Assembler to the Lab.',
        'You have the β you need: remove the wire from the Glyph Assembler to the Lab.',
      ),
      done: (g) => studyWires(g, 'glyph').length === 0,
      when: sellGlyphNow,
      cuts: (g) => (sellGlyphNow(g) ? studyWires(g, 'glyph').map((w) => w.id) : []),
    },
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
    ...buying((g) => techThenNode(g, 'P6', 'refiner', 'clay')),
    reward: { credits: 200 },
  },
  {
    id: 'make-coil', title: 'Wind your first Coil', free: true,
    hint: hint('Feed an Assembler one Spark and two Clay for every Coil.'),
    done: (g) => made(g, 'coil'),
    ...buying((g) => techThenNode(g, 'P6', 'assembler', 'coil')),
    reward: { credits: 600 },
  },
  {
    id: 'make-dynamo', title: 'Spin up a Dynamo', free: true,
    hint: hint('Research Dynamo, then feed a Fabricator two Coil, a Glyph and a Prism.'),
    done: (g) => made(g, 'dynamo'),
    ...buying((g) => techThenNode(g, 'P8', 'fabricator', 'dynamo')),
    reward: { credits: 1800 },
  },
  {
    id: 'make-paradox', title: 'Fold a Paradox', free: true,
    hint: hint('Research Paradox, then feed a Fabricator a Lens, a Dynamo and four raw Breeze.'),
    done: (g) => made(g, 'paradox'),
    ...buying((g) => techThenNode(g, 'P9', 'fabricator', 'paradox')),
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
  /**
   * Only on "Hold 95% Flow": the smoothed share the ring shows, producers flowing and counted, and the share
   * needed right now, so the card can read "Flow 90% · 9 of 10 running" with a mark at the bar.
   */
  flow?: FlowGoalView;
  /**
   * The goal's "while you wait" line, for the input in use, and whether it has been done. Absent when the goal
   * has none, is ready to claim, or the line does not apply to this board right now.
   */
  meanwhile?: { text: string; done: boolean };
}

/** Everything the goal card shows. null when every goal has been claimed. */
export function goalView(g: Game, touch = false): GoalView | null {
  const goal = activeGoal(g);
  if (!goal) return null;
  const free = !!goal.free;
  const line = meanwhileOf(g);
  return {
    ...(goal.id === 'hold-flow' ? { flow: flowGoalView(g) } : {}),
    ...(line ? { meanwhile: { text: touch ? line.text.touch : line.text.mouse, done: line.done(g) } } : {}),
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

/**
 * The active goal's "while you wait" line, if it has one that applies to this board right now (done or not).
 * null once the goal is ready to claim.
 */
export function meanwhileOf(g: Game): Meanwhile | null {
  const line = activeGoal(g)?.meanwhile;
  if (!line || g.goal.ready || (line.when && !line.when(g))) return null;
  return line;
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
  // Since when this goal has been the active one: set here for a save without it, or a goal set by hand.
  if (!g.goalAt || g.goalAt.i !== g.goal.i) g.goalAt = { i: g.goal.i, t: g.time };
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
  g.goalAt = { i: index + 1, t: g.time };
  g.events.push({ kind: 'goal-claimed', goal: goal.id, index, reward: r, big: !!goal.big, text: `${goal.title}: ${rewardText(r)}` });
  applyUnlocks(g, r);
  // A goal the player has already met is ready at once.
  tickGoal(g);
  return true;
}

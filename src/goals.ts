// The goal chain (docs/PITCH_PLAN.md 2.4). DOM-free.
//
// One goal is active at a time: g.goal = { i, ready }. Every tick the active goal's done(g) is checked;
// when it holds the goal becomes ready (event 'goal-ready') and stays ready until claimGoal(g) pays the
// reward (event 'goal-claimed'), moves on, and checks the next goal at once, so a goal the player has
// already met is ready the moment it is reached. Rewards are not undoable.
//
// Reward sizes are in the GOALS table below, tuned with `npm run pacing`. Three techs are goal rewards and
// cannot be bought: Refining, Lab and Bulk Upgrade. (Routing was one, with a card after it that had the player
// build a Router; it is a research of its own now. Market Lens used to come with the first order; it now arrives
// by itself the first time something sells over its demand, see noteSurplus in src/sim.ts.)
// Through "Study Glass in a Lab" the credits paid so far always cover the next purchase the card asks for, the
// steps of the two growth goals' own way included (tests/playthrough.test.ts).
//
// New things come slowly, and each is earned by growing what came before it. Between the chapters stand growth
// goals ("Make 1 Glass a second": growth() below), met by any way that brings the rate up, and the steps of the
// Processing spine (Ore Deposits, Assembly, Quartz Deposits) stay locked in the tech tree until the growth goal
// before them is claimed (Tech.locked, GoalReward.opens). The claim pays the α the research costs, or most of it:
// a lock and then a wait for Data would be two walls.
//
// A card says what to bring about and why (Goal.title, Goal.why): "Turn Sand into Glass. Two Sand sell for 2¢;
// melted into one Glass they sell for 3¢." It does not say where to click. A player who knows why a wire is wanted
// finds where it goes: the port without a wire pulses, the machine says what it lacks, and the recipe is drawn on
// the card with a tick on each input that is wired in. The gesture (Goal.hint, "the how") is behind the card's
// "How?" button, and comes out by itself when the player has not got anywhere for a while (src/ui/hud.ts).
//
// The how is what a newcomer does, to the letter. So every card that has the player make something new also says
// to sell it, in its title or its why and in its how (Plastic, Copper, Circuit, Silicon, Screen): a player who is
// never told leaves their dearest goods unsold and their machines blocked, and cannot pay for the Fabricator.
//
// Some goals also carry a line (Goal.meanwhile): on a goal with a wait, the one move that shortens that wait most
// for a player who does only what the cards say; on a growth goal, one way to its rate, a step at a time. The card
// is the channel every player obeys, so the structural advice lives there and not in the adviser's tips
// (src/advice.ts), which nobody is sure to follow. docs/CONTENT.md has them ("While you wait").
import { MATERIALS, MatId, NODE_DEFS, NodeType, RECIPES, RULES, Recipe, TECHS } from './content';
import {
  cycleTime, demandRate, endDemo, grantTech, has, labRate, maxLevel, nodeCost, nodeCount, nodeUnlocked, pickRecipe, recipeOf, trackAvailable,
  upgradeCost, valueOf, wellRate,
} from './economy';
import { countsForFlow, flowUnsettled, isFlowing, nearShare } from './flow';
import { graph, isMachine, isPass } from './graph';
import { startOrders } from './orders';
import { Bag, Game, GNode, GoalReward, Wire, isLookahead, nodeNoun } from './state';
import { clearHistory, freeDeposits } from './actions';
import { flowLineWords, growLineWords, lineFocus, lineHeld, tuneLineWords, tuneState, waitKind } from './advice';

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
  /** What the player is to bring about, as an outcome in the game's world ("Turn Sand into Glass"): never a gesture. */
  title: string;
  /**
   * Why: what the goal is for and how the world works there, in one or two sentences. This is what the card says
   * under the title. It names no click, drag, tap or key, so it is the same for a mouse and for a finger: a player
   * who understands why a wire is wanted finds where it goes.
   */
  why: string;
  /**
   * How: the gesture, worded for mouse and keyboard, and for touch. The card keeps it behind its "How?" button and
   * brings it out by itself when the player has not got anywhere for a while (src/ui/hud.ts). Other parts of the
   * game read it too, for what it names: the tech to research ("Research Assembly"), the machine to build ("pick
   * Refiner"), the kind of node the card is about.
   */
  hint: { mouse: string; touch: string };
  /**
   * The how as the board stands, where that is another gesture than `hint`: a machine the hint has the player build
   * from a port stands on the board already, placed from the build bar and fed by nothing, and what is left is the
   * wire into it (building from the port again would buy a second one). null: `hint` it is.
   */
  howNow?(g: Game): { mouse: string; touch: string } | null;
  /** The recipe the goal has the player make, if it is about one: the card shows it as "2 Sand → Glass", in pictures. */
  recipe?: string;
  done(g: Game): boolean;
  /** For numeric goals, and for goals where the next step has to be saved up for. null = nothing to show. */
  progress?(g: Game): GoalProgress | null;
  /**
   * The purchase the card is asking for next, when there is one: what `progress` counts toward. null when
   * nothing has to be bought (any more). The adviser (src/advice.ts) reads it to know what a wait is for.
   */
  step?(g: Game): GoalStep | null;
  reward: GoalReward;
  /** One of the big celebrations: six goals carry one (the seventh is the first Flow State, see the 'flow-state' event). */
  big?: boolean;
  /** A free-play goal after the capstone. */
  free?: boolean;
  /**
   * The goal belongs to one way of playing only (Game.tiers): 'chain', the goal chain's chapters that the tiers
   * replace with a contract; 'tiers', a contract. Absent: both. A goal not of the game's way is passed over.
   */
  mode?: 'chain' | 'tiers';
  /** A tier's contract (docs/TIERS.md): what is to be delivered at a Dock. The goal is met when all of it is. */
  contract?: Bag;
  /** The tools a tier hands over, each with what it is for and how to start: the contract panel lists them. */
  tools?: ToolNote[];
  /**
   * The goal's "while you wait" lines: things worth doing meanwhile, shown one at a time in this order (the
   * first one that applies and is not done yet; see meanwhileAt).
   */
  meanwhile?: Meanwhile[];
}

/** A tool a tier hands over, as its contract panel introduces it: open it for a sentence on why and one on how. */
export interface ToolNote {
  name: string;
  why: string;
  how: { mouse: string; touch: string };
}

/**
 * One concrete thing to do while a goal's wait runs. It is true (doing it on the board a card-following player
 * has ends that wait sooner: tests/meanwhile.test.ts tries it the way tips are tried), and it is never
 * something a later card or a tip undoes.
 */
export interface Meanwhile {
  /** Which line this is: lineAdvice in src/advice.ts works out its next step by it. Unique across the chain. */
  id: string;
  /** One sentence, worded for mouse and keyboard and for touch: at most 90 characters each. */
  text: { mouse: string; touch: string };
  /**
   * The sentence as it reads on this board, when it names what is on it (the Flow goal's line names the node its
   * step acts on): goalView shows it in place of `text`. null: `text` it is. At most 90 characters each.
   */
  say?(g: Game): { mouse: string; touch: string } | null;
  /** It has been done: the card ticks the line off. */
  done(g: Game): boolean;
  /** Does the line apply right now? Absent = for as long as the goal is the active one. While it does not, the card leaves it out. */
  when?(g: Game): boolean;
  /**
   * Wires the line asks the player to cut, if it asks for that. The adviser reads it: "cut this wire" is only
   * ever said when a card says the same.
   */
  cuts?(g: Game): number[];
  /**
   * The line is the goal's own requirement, not something to do while waiting: the goal cannot complete without
   * it (goal 22's wires into the Fabricator). goalView passes it on, and the card says "Next step", with no count.
   */
  required?: boolean;
  /**
   * The line of a growth goal ("Make 1 Glass a second"): the material and the rate the goal asks for. Its next step
   * is worked out from the board (growNext in src/advice.ts): one way to get there, a gesture at a time. It is not
   * the only way: whatever brings the rate up counts, and the card labels the line "One way" (`way`).
   */
  grow?: { mat: MatId; rate: number; tune?: boolean };
  way?: boolean;
  /**
   * The line is only worth saying while its steps pay (the Fabricator card's tune-up: tuneState in src/advice.ts):
   * once it does not apply it does not come back. So the card's count ("1 of 2") leaves it out unless it applies now
   * or has been shown; a line without this is counted from the start, because it may still come.
   */
  closes?: boolean;
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
/** A node of this kind stands with nothing wired into it (placed from the build bar, not built from a port). */
const unfed = (g: Game, type: NodeType) => g.nodes.some((n) => n.type === type && inWires(g, n) === 0);

/**
 * Items of a material made a second right now. For each machine that makes it, the lesser of two readings:
 *  - what it turns out flat out, times the share of its time it is at work (its utilisation, smoothed over a few
 *    seconds). This never reads above what the machine can do and does not jump when a wire is added;
 *  - what leaves its port, by the rates of the wires there (measured over whole deliveries: the Flows panel reads
 *    the same). This does not jump when the machine is given a level of Speed.
 * Each alone overshoots for a few seconds after one kind of change: a third Refiner wired to a Drill that cannot
 * feed it made the wires read 1.7 a second on a board that makes 1.1, and a level of Speed on a Refiner whose Drill
 * cannot keep up reads as more Glass until its utilisation has come down. A growth goal is met once and stays met,
 * so it is judged by the reading that is not fooled. Settled, the two agree.
 */
export function making(g: Game, m: MatId): number {
  const c = graph(g);
  let sum = 0;
  for (const n of g.nodes) {
    let port = 0;
    let flat = 0;
    if (n.type === 'well') {
      if (n.material !== m) continue;
      flat = wellRate(n);
    } else {
      const r = isMachine(n) ? recipeOf(n) : null;
      port = r ? r.outputs.findIndex((o) => o[0] === m) : -1;
      if (!r || port < 0) continue;
      flat = r.outputs[port][1] / cycleTime(n, r);
    }
    let leaves = 0;
    for (const w of c.outs.get(n.id)?.[port] ?? []) leaves += w.rate;
    sum += Math.min(flat * n.util, leaves);
  }
  return sum;
}

/**
 * A growth goal is met from this share under its rate. Utilisation creeps up on its value and stops a hair short;
 * and two Glass lines with one level of Speed on each Refiner and each Drill make 1.18 a second, which is what
 * "Make 1.2 Glass a second" is there to teach.
 */
export const GROW_SLACK = 0.03;

/** Is this much of the material being made a second? */
export const makes = (g: Game, m: MatId, rate: number) => making(g, m) >= rate * (1 - GROW_SLACK);

/** A growth goal's count: what is made a second, to two places, and the rate asked for ("0.5 / 1 Glass a second"). */
/**
 * A material as a rate names it: "Glass", "Circuits". What is counted by the piece (parts and products) takes an s,
 * except for exactly one a second; what is poured (raw and refined) never does. The goal's title, its card's count,
 * its celebration and the tech tree all say it the same way.
 */
export const rateNoun = (m: MatId, rate: number) => {
  const x = MATERIALS[m];
  return rate === 1 || x.tier < 2 || x.name.endsWith('s') ? x.name : `${x.name}s`;
};

const makingProgress = (g: Game, m: MatId, rate: number): GoalProgress => {
  const now = making(g, m);
  return [makes(g, m, rate) ? rate : Math.min(rate, Math.floor(now * 100 + 1e-6) / 100), rate, `${rateNoun(m, rate)} a second`];
};

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
/** The active goal's contract is delivered in full (Game.contract; set up for the goal by tickGoal). */
function contractDone(g: Game): boolean {
  const k = g.contract;
  if (!k || k.goal !== activeGoal(g)?.id) return false;
  for (const m in k.need) if ((k.got[m as MatId] ?? 0) < (k.need[m as MatId] ?? 0) - 1e-6) return false;
  return true;
}
/** What the Dock has taken of the whole contract, in items (the card's bar; the contract panel shows each line). */
function contractProgress(g: Game): GoalProgress | null {
  const k = g.contract;
  if (!k) return null;
  let got = 0;
  let need = 0;
  for (const m in k.need) {
    const n = k.need[m as MatId] ?? 0;
    need += n;
    got += Math.min(n, k.got[m as MatId] ?? 0);
  }
  const mats = Object.keys(k.need) as MatId[];
  return [Math.floor(got), need, mats.length === 1 ? MATERIALS[mats[0]].name : 'items'];
}

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

/** A raw material line: research, then a Drill on the deposit, then a Refiner. */
function rawLine(g: Game, id: string, raw: MatId, recipe: string): GoalStep | null {
  const well = g.nodes.some((n) => n.type === 'well' && n.material === raw);
  const refiner = g.nodes.some((n) => n.recipe === recipe);
  if (!has(g, id)) return tech(id, (well ? 0 : nodeCost(g, 'well')) + (refiner ? 0 : nodeCost(g, 'refiner')), well ? THE.refiner : refiner ? THE.well : 'the Drill and the Refiner');
  if (!well) return price(nodeCost(g, 'well'), THE.well);
  if (!refiner) return price(nodeCost(g, 'refiner'), THE.refiner);
  return null;
}

const wellsWired = (g: Game) => g.nodes.filter((n) => n.type === 'well' && outWires(g, n) > 0).length;

/** A Plastic Refiner whose Tar port (the second one) is wired and that is actually running. */
function siltHandled(g: Game): boolean {
  return g.nodes.some((n) => n.recipe === 'ink' && outWires(g, n, 1) > 0 && n.util >= 0.25);
}

const typeOf = (g: Game, id: number) => graph(g).byId.get(id)?.type;

/** Can this material come down this wire: straight from what makes it, or through Routers, Mergers and Silos? */
function carries(g: Game, w: Wire, m: MatId, seen = new Set<number>()): boolean {
  const c = graph(g);
  const n = c.byId.get(w.from);
  if (!n) return false;
  if (n.type === 'well') return n.material === m;
  if (isMachine(n)) return recipeOf(n)?.outputs[w.port]?.[0] === m;
  if (!isPass(n) || seen.has(n.id)) return false;
  seen.add(n.id);
  return (c.ins.get(n.id) ?? []).some((x) => carries(g, x, m, seen));
}

/**
 * Wires into a Lab that this material can come down: the wire straight from the machine that makes it, and
 * the Lab's wire of a Router (or Merger, or Silo) the material passes through. Those are the wires to cut to
 * stop it being studied.
 */
const studyWires = (g: Game, m: MatId) => g.wires.filter((w) => typeOf(g, w.to) === 'lab' && carries(g, w, m));

/** Can what leaves this port reach a Lab: straight, or through Routers, Mergers and Silos? */
function reachesLab(g: Game, from: number, port: number, seen = new Set<number>()): boolean {
  const c = graph(g);
  for (const w of c.outs.get(from)?.[port] ?? []) {
    const to = c.byId.get(w.to);
    if (!to) continue;
    if (to.type === 'lab') return true;
    if (isPass(to) && !seen.has(to.id)) {
      seen.add(to.id);
      if (reachesLab(g, to.id, 0, seen)) return true;
    }
  }
  return false;
}

/** β the goals between here and "Build a Fabricator" still pay (counted toward Fabrication's β). */
const betaToCome = (g: Game) => {
  let b = 0;
  const end = GOALS.findIndex((x) => x.id === 'build-fabricator');
  for (let i = g.goal.i; i < end; i++) b += GOALS[i].reward.b ?? 0;
  return b;
};
/**
 * The Circuit is worth more sold: Fabrication's β is covered (in hand, with what the goals before "Build a
 * Fabricator" still pay), and the Fabricator still has to be saved for.
 */
const sellGlyphNow = (g: Game) => (has(g, 'P7') || g.data.b + betaToCome(g) >= (TECHS.P7.cost.b ?? 0)) && count(g, 'fabricator') === 0 && g.credits < nodeCost(g, 'fabricator');

/** This Router sends more to a Lab than to a Market by how it is set: a bigger ratio weight, or an earlier priority slot. */
function routerFavours(g: Game, n: GNode): boolean {
  const wires = graph(g).outs.get(n.id)?.[0] ?? [];
  let lab = 0, market = 0, firstLab = -1, firstMarket = -1;
  wires.forEach((w, i) => {
    const type = graph(g).byId.get(w.to)?.type;
    if (type === 'lab') {
      lab += Math.max(0, w.weight);
      if (firstLab < 0) firstLab = i;
    } else if (type === 'market') {
      market += Math.max(0, w.weight);
      if (firstMarket < 0) firstMarket = i;
    }
  });
  if (firstLab < 0 || firstMarket < 0) return false;
  return (n.mode === 'ratio' && lab > market) || (n.mode === 'priority' && firstLab < firstMarket);
}

/** A Router in use that sends more to a Lab than to a Market: a bigger ratio weight, or an earlier priority slot. */
export function routerFavoursLab(g: Game): boolean {
  return g.nodes.some((n) => n.type === 'router' && inWires(g, n) > 0 && routerFavours(g, n));
}

/**
 * What the Flow goal's line can put right, looking at the board only: the counted producer furthest from
 * flowing that either sends something nowhere it can be sold (`sell`: wire that port to the Market), or is
 * short of an input whose maker, wired straight to it, runs flat out (`speed`: one more level of Speed on that
 * maker). null when no producer is short in a way this can fix (a machine fed through a Router, say): the
 * line is then not shown, and the valve is there for that board.
 */
export type FlowFix = { n: GNode; mat: MatId } & ({ speed: GNode } | { port: number; market: GNode });
/** Seconds after a level of Speed is bought before the Flow line asks for another on the same kind of node: utilisation takes that long to show it. */
const FLOW_SETTLE = 10;

export function flowFix(g: Game): FlowFix | null {
  const c = graph(g);
  const market = g.nodes.find((x) => x.type === 'market') ?? null;
  const short = g.nodes.filter((n) => countsForFlow(g, n) && !isFlowing(n)).sort((a, b) => a.util - b.util);
  for (const n of short) {
    const made = n.type === 'well' ? (n.material ? [n.material] : []) : (recipeOf(n)?.outputs ?? []).map((o) => o[0]);
    const backed = n.type === 'well' || n.status === 'blocked' || !!n.blockedOn;
    if (backed && market) {
      for (let port = 0; port < made.length; port++) {
        const m = made[port];
        if (n.blockedOn && n.blockedOn !== m && made.length > 1) continue;
        if (MATERIALS[m].value < RULES.orders.junkValue) continue; // Tar goes to the Dump, not to a Market
        if (!(c.outs.get(n.id)?.[port] ?? []).some((w) => c.byId.get(w.to)?.type === 'market')) return { n, mat: m, port, market };
      }
    }
    if (!isMachine(n) || n.status === 'blocked' || n.blockedOn) continue;
    const r = recipeOf(n);
    if (!r) continue;
    const m = n.missing ?? [...r.inputs].sort((a, b) => (n.inb[a[0]] ?? 0) / a[1] - (n.inb[b[0]] ?? 0) / b[1])[0]?.[0];
    if (!m) continue;
    for (const w of c.ins.get(n.id) ?? []) {
      const s = c.byId.get(w.from);
      if (!s || isPass(s)) continue;
      const gives = s.type === 'well' ? s.material : recipeOf(s)?.outputs[w.port]?.[0];
      if (gives !== m || s.util < RULES.flow.flowing || !trackAvailable(g, s, 'speed') || s.lv.speed >= maxLevel(g, 'speed')) continue;
      // One level must be enough: what the maker gives with it, shared among the machines on that port, covers
      // what this one takes. (Two Refiners on one Drill need several levels: no single step fixes that board,
      // and the valve is there for it.)
      const qty = r.inputs.find((i) => i[0] === m)?.[1] ?? 1;
      const takers = (c.outs.get(s.id)?.[w.port] ?? []).filter((x) => { const t = c.byId.get(x.to); return !!t && isMachine(t); }).length || 1;
      const faster = { ...s, lv: { ...s.lv, speed: s.lv.speed + 1 } };
      const sr = recipeOf(s);
      const gives1 = s.type === 'well' ? wellRate(faster) : sr ? (sr.outputs[w.port]?.[1] ?? 1) / cycleTime(faster, sr) : 0;
      if (gives1 / takers < RULES.flow.flowing * (qty / cycleTime(n, r))) continue;
      // A level bought a moment ago has not shown yet: wait for it before asking for another.
      if ((g.edits ?? []).some((e) => e.what === `upgrade:speed:${nodeNoun(s)}` && g.time - e.at < FLOW_SETTLE)) return null;
      return { n, mat: m, speed: s };
    }
  }
  return null;
}

/** Counted producers, and how many of them flow. */
function flowCount(g: Game): { of: number; running: number } {
  let of = 0;
  let running = 0;
  for (const n of g.nodes) {
    if (!countsForFlow(g, n)) continue;
    of++;
    if (isFlowing(n)) running++;
  }
  return { of, running };
}

/** The Fabricator the last goal is about: one set to Phone, or else one with no recipe yet; the better fed first. */
export function lensMaker(g: Game): GNode | null {
  const fabs = g.nodes.filter((n) => n.type === 'fabricator' && (n.recipe === 'lens' || !n.recipe));
  const fed = (n: GNode) => (graph(g).ins.get(n.id) ?? []).length;
  return fabs.sort((a, b) => Number(b.recipe === 'lens') - Number(a.recipe === 'lens') || fed(b) - fed(a))[0] ?? null;
}

/** For each input a Phone takes: is it wired into that Fabricator (straight, or through a Router, Merger or Silo)? null with no Fabricator. */
export function lensFeeds(g: Game): { mat: MatId; name: string; fed: boolean }[] | null {
  const f = lensMaker(g);
  if (!f) return null;
  const ins = graph(g).ins.get(f.id) ?? [];
  return RECIPES.lens.inputs.map(([mat]) => ({ mat, name: MATERIALS[mat].name, fed: ins.some((w) => carries(g, w, mat)) }));
}

/**
 * For a recipe that puts several things together: which of its inputs are wired into the machine that makes it
 * (the one set to it, or else one of its kind with no recipe yet; the better fed first), and whether what it makes
 * goes anywhere. The card draws the recipe with a tick on each input that is in. null while no such machine stands,
 * and for a recipe with one input (there is nothing to tick off: the machine is built from the port that feeds it).
 */
export function recipeFeeds(g: Game, recipe: Recipe): { fed: Partial<Record<MatId, boolean>>; out: boolean } | null {
  if (recipe.inputs.length < 2) return null;
  const c = graph(g);
  const fedCount = (n: GNode) => (c.ins.get(n.id) ?? []).length;
  const maker = g.nodes.filter((n) => n.type === recipe.machine && (n.recipe === recipe.id || !n.recipe))
    .sort((a, b) => Number(b.recipe === recipe.id) - Number(a.recipe === recipe.id) || fedCount(b) - fedCount(a))[0];
  if (!maker) return null;
  const ins = c.ins.get(maker.id) ?? [];
  const fed: Partial<Record<MatId, boolean>> = {};
  for (const [mat] of recipe.inputs) fed[mat] = ins.some((w) => carries(g, w, mat));
  return { fed, out: outWires(g, maker) > 0 };
}
const lensFed = (g: Game, m: MatId) => !!lensFeeds(g)?.find((x) => x.mat === m)?.fed;

/**
 * "Speed up every Drill at once": Upgrade all has raised the Drills since this goal came up (g.bulkAt, kept with
 * the save and set only by a press on Drills; an undo of that press takes it back, and the goal's readiness with it).
 */
const bulkSince = (g: Game) => {
  const since = g.goalAt && g.goalAt.i === g.goal.i ? g.goalAt.t : g.time;
  return g.bulkAt != null && g.bulkAt >= since - 1e-9;
};

/** The cheapest single Speed level on a Drill: what one press of Upgrade all on the Drills costs at the least. */
const cheapestWellSpeed = (g: Game) => {
  let best = Infinity;
  for (const n of g.nodes) if (n.type === 'well' && n.lv.speed < maxLevel(g, 'speed')) best = Math.min(best, upgradeCost(n, 'speed'));
  return best;
};

const hint = (mouse: string, touch: string = mouse) => ({ mouse, touch });

/**
 * "You have the β you need: cut the wire from the Circuit Assembler to the Lab." Goal 17 had the player study
 * Circuit. Fabrication's β is in hand once that and the rewards of goals 19 and 20 are counted, and from then on
 * every Circuit in a Lab is 20¢ not earned toward the Screen Assembler and the Fabricator. This is the one place
 * the chain takes a wire back, and it is a card that says so: the adviser never reverses a card (src/advice.ts).
 * It applies while the β is covered and the Fabricator's price is not: a player who already has the credits
 * gains nothing by it, and is not asked.
 */
const CUT_GLYPH: Meanwhile = {
  id: 'cut-glyph',
  text: hint('You have the β you need: cut the wire from the Circuit Assembler to the Lab.'),
  // No Circuit reaches a Lab any more, by a wire of its own or through a Router.
  done: (g) => studyWires(g, 'glyph').length === 0,
  when: (g) => sellGlyphNow(g),
  cuts: (g) => (sellGlyphNow(g) ? studyWires(g, 'glyph').map((w) => w.id) : []),
};

/**
 * What the Fabricator card's tune-up can put right, looking at the board only: a counted Drill or machine that makes
 * more than everything it is wired to can take, so that it stands blocked part of the time and does not flow (the
 * press of Upgrade all on the Drills that the card before asks for leaves several like that).
 *  - `labs`: it feeds only Labs, they cannot study all of it, and Lab Speed is not researched: with it Labs study
 *    twice as fast.
 *  - `level`: it feeds only machines, and they run flat out: a level of Speed on the one whose next level is the
 *    cheapest (`speed`). `extra` is how much more of the material that level lets it take a second, and `flows`
 *    whether the producer then flows.
 * Of several outrun alike, the one of which the least is taken (by what the machines can take at their levels, not
 * by its utilisation of the moment, which wavers: two Drills equally outrun would take turns on the card), and the
 * older of two. null where nothing is outrun in that way. (A port that also sells, or feeds a Lab with room, is
 * never outrun: what the machines leave goes there. So this never asks for a raw Drill to be wired to the Market,
 * which the Flow goal's own line may.)
 */
export interface TuneLabs { n: GNode; mat: MatId; research: string }
export interface TuneLevel { n: GNode; mat: MatId; speed: GNode; extra: number; flows: boolean }

/**
 * outrun and refineNext look at every node, and the Fabricator card asks for them several times at each look (is
 * the line done, does it apply, what is its step): what they found is kept for the moment it was worked out at,
 * the game's time and the board as it stood. Beside the game, not in it.
 */
const boardReads = new WeakMap<Game, { time: number; rev: number; techs: number; tune?: { labs: TuneLabs | null; level: TuneLevel | null }; refine?: RefineStep | null }>();
function readsAt(g: Game) {
  let m = boardReads.get(g);
  if (!m || m.time !== g.time || m.rev !== g.rev || m.techs !== g.techs.length) boardReads.set(g, (m = { time: g.time, rev: g.rev, techs: g.techs.length }));
  return m;
}

export function outrun(g: Game): { labs: TuneLabs | null; level: TuneLevel | null } {
  const m = readsAt(g);
  return (m.tune ??= findOutrun(g));
}

function findOutrun(g: Game): { labs: TuneLabs | null; level: TuneLevel | null } {
  const c = graph(g);
  const F = RULES.flow.flowing;
  let labs: TuneLabs | null = null;
  let level: TuneLevel | null = null;
  let share = Infinity;
  for (const n of g.nodes) {
    if (!countsForFlow(g, n)) continue;
    const r = n.type === 'well' ? null : recipeOf(n);
    const made: (readonly [MatId, number])[] = n.type === 'well' ? (n.material ? [[n.material, 1]] : []) : r?.outputs ?? [];
    for (let port = 0; port < made.length; port++) {
      const [m, qty] = made[port];
      const gives = n.type === 'well' ? wellRate(n) : r ? qty / cycleTime(n, r) : 0;
      const to = (c.outs.get(n.id)?.[port] ?? []).map((w) => c.byId.get(w.to)).filter((x): x is GNode => !!x);
      if (!to.length || gives <= 0) continue;
      if (to.every((x) => x.type === 'lab')) {
        if (labs || has(g, 'R2') || !has(g, 'R1')) continue;
        if (to.reduce((sum, x) => sum + labRate(g, x), 0) < F * gives) labs = { n, mat: m, research: 'R2' };
        continue;
      }
      if (!to.every((x) => isMachine(x))) continue;
      /** What this machine takes of the material a second, at a Speed level. */
      const takes = (x: GNode, lv = x.lv.speed) => {
        const rx = recipeOf(x);
        const q = rx?.inputs.find((i) => i[0] === m)?.[1] ?? 0;
        return rx && q ? q / cycleTime({ ...x, lv: { ...x.lv, speed: lv } }, rx) : 0;
      };
      const taken = to.reduce((sum, x) => sum + takes(x), 0);
      if (taken >= F * gives || taken / gives >= share - 1e-9) continue;
      const taker = to.filter((x) => takes(x) > 0 && x.util >= F && trackAvailable(g, x, 'speed') && x.lv.speed < maxLevel(g, 'speed'))
        .sort((a, b) => upgradeCost(a, 'speed') - upgradeCost(b, 'speed'))[0];
      if (!taker) continue;
      const extra = Math.min(gives - taken, takes(taker, taker.lv.speed + 1) - takes(taker));
      level = { n, mat: m, speed: taker, extra, flows: taken + extra >= F * gives - 1e-9 };
      share = taken / gives;
    }
  }
  return { labs, level };
}

/** Does this Drill send what it gives to Labs and nowhere else, or to nothing at all (one that has just been placed)? */
const feedsLabsOnly = (g: Game, n: GNode) => {
  const ws = graph(g).outs.get(n.id)?.[0] ?? [];
  return n.type === 'well' && !!n.material && ws.every((w) => typeOf(g, w.to) === 'lab');
};

/**
 * The next gesture of "one more line of something that sells", looking at the board only. First what a Refiner
 * still lacks: its product wired to the Market (`sell`), then a Dump for a by-product (`dump`: the Tar of a Plastic
 * Refiner). Then the next Drill (`well`): one that feeds no machine and sells nothing (it sends what it gives to Labs
 * and nowhere else, or has just been placed), for which a Refiner has a recipe, which gives at least what keeps that
 * Refiner flowing, and whose product the Markets would still buy at full price (so nothing here ever sells over
 * demand). The dearest product first. Then, by the same test, a deposit that stands free (`deposit`): a Drill there,
 * and the Refiner follows as a `well` step. `gives` is the product, in items a second. null when there is nothing
 * (more) to do.
 */
export type RefineStep =
  | { sell: GNode; port: number; mat: MatId; market: GNode }
  | { dump: GNode; port: number; mat: MatId }
  | { well: GNode; recipe: Recipe; out: MatId; gives: number }
  | { deposit: number; raw: MatId; recipe: Recipe; out: MatId; gives: number };

export function refineNext(g: Game): RefineStep | null {
  const m = readsAt(g);
  if (m.refine === undefined) m.refine = findRefine(g);
  return m.refine;
}

function findRefine(g: Game): RefineStep | null {
  const c = graph(g);
  const market = g.nodes.find((x) => x.type === 'market') ?? null;
  if (!market || !nodeUnlocked(g, 'refiner')) return null;
  for (const n of g.nodes) {
    if (n.type !== 'refiner' || !recipeOf(n) || !(c.ins.get(n.id) ?? []).length) continue;
    const outs = recipeOf(n)!.outputs;
    for (let port = 0; port < outs.length; port++) {
      const mat = outs[port][0];
      if ((c.outs.get(n.id)?.[port] ?? []).length) continue;
      if (MATERIALS[mat].value >= RULES.orders.junkValue) return { sell: n, port, mat, market };
      if (nodeUnlocked(g, 'void')) return { dump: n, port, mat };
    }
  }
  /** A Refiner on a Drill of this raw material that brings up `rate` a second: what it would make, if it would flow and its product still sells at full price. */
  const line = (raw: MatId, rate: number): { recipe: Recipe; out: MatId; gives: number } | null => {
    const recipe = pickRecipe(g, 'refiner', [raw]);
    if (!recipe || recipe.inputs.length !== 1) return null;
    const takes = recipe.inputs[0][1] / recipe.time;
    if (rate < RULES.flow.flowing * takes) return null;
    const [out, qty] = recipe.outputs[0];
    const gives = (Math.min(rate, takes) / recipe.inputs[0][1]) * qty;
    return (g.soldRate[out] ?? 0) + gives > demandRate(g, out) ? null : { recipe, out, gives };
  };
  const worth = (x: { out: MatId; gives: number }) => x.gives * valueOf(g, x.out);
  let best: { well: GNode; recipe: Recipe; out: MatId; gives: number } | null = null;
  for (const n of g.nodes) {
    if (!feedsLabsOnly(g, n)) continue;
    const l = line(n.material!, wellRate(n));
    if (l && (!best || worth(l) > worth(best) + 1e-9)) best = { well: n, ...l };
  }
  if (best) return best;
  // A deposit that stands free: a Drill there (as it comes, with no Speed), and its Refiner after it.
  let spot: { deposit: number; raw: MatId; recipe: Recipe; out: MatId; gives: number } | null = null;
  for (const d of freeDeposits(g)) {
    const l = line(d.mat, wellRate({ material: d.mat, lv: { speed: 0 } } as GNode));
    if (l && (!spot || worth(l) > worth(spot) + 1e-9)) spot = { deposit: d.id, raw: d.mat, ...l };
  }
  return spot;
}

/** The Fabricator still has to be saved for: none stands, and its price is not in hand. */
const savingForFabricator = (g: Game) => count(g, 'fabricator') === 0 && g.credits < nodeCost(g, 'fabricator');

/**
 * The tune-up before the Fabricator: one line whose words are its next step's own. The wait for the Fabricator's
 * price is the longest of the demo, and the board has two kinds of slack by then.
 *  - "The Oil Drill outruns its Refiner: buy Speed on the Refiner (32¢)." The card before had every Drill upgraded
 *    at once: a Drill that feeds one machine and nothing else now makes more than that machine takes, stands blocked
 *    a fifth of the time, and Flow (which every sale is paid by) is down. A level of Speed on the machine puts it
 *    right (outrun); where it is Labs that a Drill outruns, and Lab Speed is not researched, that research does.
 *  - "Place a Drill on the free Sand deposit (27¢), then build a Refiner from it." One more line of something that
 *    still sells at full price: the plots the growth goals had the player buy brought deposits nobody has used, and
 *    a Drill and a Refiner there pay for themselves inside this wait. So does a Refiner on a Drill that only feeds a
 *    Lab (Fabrication is the last research of the demo and its α is in hand: machines are fed before Labs, and the
 *    Lab keeps the rest). Nothing raw is sold, and nothing over its demand (refineNext). The product is wired to
 *    the Market, and a Plastic Refiner's Tar gets a Dump.
 * A step that costs credits is only on the card while what it brings in pays its price back before the Fabricator
 * can be bought (tuneState in src/advice.ts): one that would make the Fabricator later is not said. When no step
 * is left that pays, the line is ticked if the player has done some of it, and leaves the card if not; it does not
 * come back. Its own words below are for the line once ticked.
 */
const TUNE_UP: Meanwhile = {
  id: 'tune-up',
  closes: true,
  text: hint('Your line is tuned: nothing else pays for itself before the Fabricator.'),
  say: (g) => tuneLineWords(g),
  done: (g) => tuneState(g) === 'done',
  when: (g) => savingForFabricator(g) && tuneState(g) !== 'none',
};

/** Seconds the active goal has been the active one (0 until the first tick has seen it). */
export const goalAge = (g: Game) => (g.goalAt && g.goalAt.i === g.goal.i ? Math.max(0, g.time - g.goalAt.t) : 0);

/**
 * The Flow goal. Its bar is RULES.flow.holdShare, held for holdSeconds. The valve: once the goal has been on
 * the card for RULES.flow.valveAfter seconds it also passes with all but one producer flowing, held just as
 * long, and from RULES.flow.valveAfter2 seconds with all but two. (A board with one producer that nobody can
 * get flowing would otherwise stop the chain for good; so would one with two, which a player who builds a second
 * Circuit Assembler on arrival has.) After that one more may be short every RULES.flow.valveEvery seconds (all but
 * three at 300 s, all but four at 420 s...), until one producer flowing is enough: every board on which anything
 * flows passes in the end, a save from the public version left to the tips three short among them. The number of
 * producers that may be short at a goal age, before it is held to the board's own count (see flowSlack).
 */
export function valveSlack(age: number): number {
  const F = RULES.flow;
  if (age < F.valveAfter) return 0;
  if (age < F.valveAfter2) return 1;
  return 2 + Math.floor((age - F.valveAfter2) / F.valveEvery);
}
/** How many producers may be short right now and the goal still counts: the valve's slack, at most all but one of them. */
export const flowSlack = (g: Game) => Math.max(0, Math.min(valveSlack(goalAge(g)), flowCount(g).of - 1));
/** The valve's later steps (all but three and on) are open from this goal age. */
const lateValve = () => RULES.flow.valveAfter2 + RULES.flow.valveEvery;
/**
 * Seconds held toward the goal. Under the valve's lower bars they are counted from the moment each opens,
 * however long the board has been there before: the player sees the bar come down and the ten seconds run.
 * (The steps from the third on share one count, g.flowNearLate: see tickValve.)
 */
const flowHeld = (g: Game) => {
  let held = g.flowHold;
  const age = goalAge(g);
  if (age >= RULES.flow.valveAfter) held = Math.max(held, Math.min(g.flowNear, age - RULES.flow.valveAfter));
  if (age >= RULES.flow.valveAfter2) held = Math.max(held, Math.min(g.flowNear2 ?? 0, age - RULES.flow.valveAfter2));
  if (age >= lateValve()) held = Math.max(held, g.flowNearLate ?? 0);
  return held;
};

/**
 * The count for the valve's later steps, once a tick (src/sim.ts, after Flow is updated): seconds the smoothed
 * Flow has stayed at or above "all but (the slack open now)", from the moment the third step opens. It starts
 * from nothing when a step opens on a board that was not at the bar before it, or when the board drops under
 * the bar; when the next step opens on a board already holding the last one's bar it runs on (the bar only came
 * down), as the steps before it do. Nothing to count on any other goal, or while one of the first two steps is
 * all the board can use (three producers or fewer: all but two of three is one).
 */
export function tickValve(g: Game, dt: number) {
  const goal = GOALS[g.goal.i];
  const open = !!goal && goal.id === 'hold-flow' && !g.goal.ready && g.flowOn && goalAge(g) >= lateValve();
  const slack = open ? flowSlack(g) : 0;
  if (slack < 3) {
    if (g.flowNearLate) g.flowNearLate = 0;
    return;
  }
  g.flowNearLate = g.flow >= nearShare(flowCount(g).of, slack) - 0.005 ? (g.flowNearLate ?? 0) + dt : 0;
}

/** What the Flow goal's card shows beside its count-down. */
export interface FlowGoalView {
  /** Smoothed Flow, 0..1: what the ring shows. */
  pct: number;
  /** Producers flowing right now, and producers counted. */
  running: number;
  of: number;
  /** The share needed right now: the goal's bar, or "all but one" once the valve is open. */
  need: number;
  /** The valve is open: the goal has been up for RULES.flow.valveAfter seconds, and its bar comes down from there. */
  valve?: boolean;
  /**
   * How many producers may be short right now and the goal still counts, once the valve is open (absent before):
   * a whole number from 0 to the producers counted less one. 1 from RULES.flow.valveAfter ("all but one
   * running"), 2 from valveAfter2, then one more every valveEvery seconds; never more than all but one of them
   * (so 0 on a board of one producer, whose bar the valve cannot lower). The card words it.
   */
  slack?: number;
}

function flowGoalView(g: Game): FlowGoalView {
  const { of, running } = flowCount(g);
  const slack = flowSlack(g);
  const open = goalAge(g) >= RULES.flow.valveAfter;
  return { pct: g.flow, running, of, need: slack ? nearShare(of, slack) : RULES.flow.holdShare, ...(open ? { valve: true, slack } : {}) };
}

// ---------- the chain ----------

/**
 * A growth goal: "Make `rate` of a material a second". Between two new things the card asks for more of what the
 * player already makes, as a rate, and whatever brings the rate up counts: more Drills, more machines, Speed, more
 * land. Its line is one way there, a gesture at a time, worked out from the board (growNext in src/advice.ts): the
 * card keeps it with the how, for whoever asks or has not got anywhere for a while. `tune`: the way it offers is
 * Speed, not more land (the goal that brings upgrades in).
 */
function growth(id: string, mat: MatId, rate: number, words: string, tune = false): Pick<Goal, 'done' | 'progress' | 'meanwhile'> {
  const line: Meanwhile = {
    id, way: true, grow: { mat, rate, ...(tune ? { tune: true } : {}) },
    text: hint(words),
    say: growLineWords,
    done: (g) => makes(g, mat, rate),
  };
  return { done: (g) => makes(g, mat, rate), progress: (g) => makingProgress(g, mat, rate), meanwhile: [line] };
}

/**
 * Ordered goals: 25 for the demo, then free play. A new thing arrives only after the player has grown what they
 * have: the goals built by growth() stand between the chapters, and the claim of one opens the next step of the
 * Processing spine for research (GoalReward.opens).
 */
export const GOALS: Goal[] = [
  {
    id: 'wire-market', title: 'Sell your Sand',
    why: 'The Drill brings up Sand, but the Sand has nowhere to go. The Market pays for whatever reaches it.',
    hint: hint('Drag from the Drill\'s glowing port to the Market.', 'Tap the Drill\'s glowing port, then tap the Market.'),
    done: (g) => g.wires.some((w) => graph(g).byId.get(w.from)?.type === 'well' && graph(g).byId.get(w.to)?.type === 'market'),
    reward: { credits: 12 },
  },
  {
    id: 'second-well', title: 'Dig up more Sand',
    why: 'More Sand means more to sell. A Drill only works on a deposit, and one Sand deposit is still free.',
    hint: hint('Pick the Drill in the build bar and click the free Sand deposit.', 'Tap Drill in the build bar, then tap the free Sand deposit.'),
    done: (g) => count(g, 'well') >= 2,
    ...buying((g) => price(nodeCost(g, 'well'), THE.well)),
    reward: { credits: 10 },
  },
  {
    id: 'wire-all-wells', title: 'Sell that Sand too',
    why: 'A machine that cannot pass on what it makes fills up and stops. One Market takes any number of wires.',
    hint: hint(
      'Drag from the new Drill\'s port to the same Market.',
      'Tap the new Drill\'s port, then tap the same Market.',
    ),
    done: (g) => g.nodes.every((n) => n.type !== 'well' || outWires(g, n) > 0),
    progress: (g) => [wellsWired(g), count(g, 'well'), 'Drills'],
    reward: { credits: 50, techs: ['P1'] },
  },
  {
    id: 'build-refiner', title: 'Turn Sand into Glass',
    why: `Two Sand sell for ${2 * MATERIALS.glint.value}¢. Melted into one Glass they sell for ${MATERIALS.shard.value}¢. A Refiner does the melting.`,
    recipe: 'shard',
    hint: hint(
      'Drag from a Drill\'s port into empty space, let go, and pick Refiner.',
      'Tap a Drill\'s port, tap an empty spot, and pick Refiner.',
    ),
    howNow: (g) => (unfed(g, 'refiner') ? hint('Drag from a Drill\'s port to the Refiner.', 'Tap a Drill\'s port, then tap the Refiner.') : null),
    done: (g) => g.nodes.some((n) => n.type === 'refiner' && inWires(g, n) > 0),
    ...buying((g) => (count(g, 'refiner') ? null : price(nodeCost(g, 'refiner'), THE.refiner))),
    reward: { credits: 20 },
  },
  {
    id: 'sell-shard', title: 'Sell your first Glass',
    why: 'The Refiner is making Glass, and the Glass is piling up inside it. It needs a way to the Market, as the Sand did.',
    hint: hint(
      'Drag from the Refiner\'s port to the Market so its Glass gets sold.',
      'Tap the Refiner\'s port, then tap the Market so its Glass gets sold.',
    ),
    done: (g) => (g.sold.shard ?? 0) >= 1,
    reward: { credits: 70 },
    big: true,
  },
  {
    // The first growth goal: before anything new arrives, the line the player has is made wider. One Refiner takes
    // one Drill's Sand, and the second Drill still sells its Sand raw: a Refiner on it is the whole of the goal.
    id: 'grow-shard', title: 'Make 1 Glass a second',
    why: 'One Refiner makes a Glass every two seconds, and half your Sand still sells raw. A second Refiner doubles your Glass.',
    hint: hint(
      'Drag from the port of the Drill that only sells into empty space, pick Refiner, and wire the new Refiner to the Market.',
      'Tap the port of the Drill that only sells, tap an empty spot, pick Refiner, and wire the new Refiner to the Market.',
    ),
    ...growth('grow-shard', 'shard', 1, 'More Refiners, each with Sand of its own: any way that gets you there counts.'),
    // (Enough for the four levels of Speed the next card's own way takes: through the Lab, what the goals have paid
    // covers what the cards ask the player to buy, whatever has been sold. tests/playthrough.test.ts.)
    reward: { credits: 125 },
  },
  {
    // Then the same line is made faster: this is where upgrades come in (a card's inspector lists them from here on:
    // src/ui/reveal.ts). It was a card of its own, "Speed up a Drill", straight after the first Glass: the Drill
    // then brought up more than its Refiner took, and nothing the player was looking at moved. Here Speed is the
    // way to a number, and both halves of the lesson are in it: a faster Refiner waits for Sand, a faster Drill for
    // its Refiner. The Lab comes with the claim: the first new thing after the Refiner, and it has been earned.
    id: 'tune-shard', title: 'Make 1.2 Glass a second',
    why: 'Every machine can be made faster. But a faster Refiner needs more Sand, and a faster Drill needs a Refiner that keeps up.',
    hint: hint(
      'Click a Refiner and buy Speed, then buy Speed on the Drill that feeds it. Do the same for the other pair.',
      'Tap a Refiner and buy Speed, then buy Speed on the Drill that feeds it. Do the same for the other pair.',
    ),
    ...growth('tune-shard', 'shard', 1.2, 'Faster Refiners, and faster Drills to feed them: any way that gets you there counts.', true),
    reward: { credits: 100, techs: ['R1'] },
    big: true,
  },
  // ---- The tiers (docs/TIERS.md): the guided start ends with a first contract, which hands over Tier 1's tools.
  // ---- Goals 8–16 of the chain are passed over, and Tier 1's contract stands in their place.
  {
    mode: 'tiers',
    id: 'dock-glass', title: 'Fill your first contract',
    why: 'A buyer wants 30 Glass in one lot. A Dock takes what a contract asks for: the more you send it, the sooner it is done.',
    hint: hint(
      'Drag from a Glass Refiner\'s port into empty space and pick Dock, then wire your other Glass Refiner to it too.',
      'Tap a Glass Refiner\'s port, tap an empty spot and pick Dock, then wire your other Glass Refiner to it too.',
    ),
    howNow: (g) => (unfed(g, 'dock') ? hint('Drag from a Glass Refiner\'s port to the Dock.', 'Tap a Glass Refiner\'s port, then tap the Dock.') : null),
    contract: { shard: 30 },
    done: (g) => contractDone(g),
    progress: (g) => contractProgress(g),
    reward: { credits: 800, techs: ['P2', 'P3', 'L1', 'L2'], unlocks: ['orders', 'flow'] },
    big: true,
  },
  {
    mode: 'chain',
    id: 'feed-lab', title: 'Study Glass in a Lab',
    why: 'A Lab studies what it is given and turns it into Data instead of credits. Data is what new technology is bought with.',
    hint: hint(
      'Drag from a Refiner\'s port into empty space and pick Lab.',
      'Tap a Refiner\'s port, tap an empty spot and pick Lab.',
    ),
    howNow: (g) => (unfed(g, 'lab') ? hint('Drag from a Refiner\'s port to the Lab.', 'Tap a Refiner\'s port, then tap the Lab.') : null),
    done: (g) => g.data.a > 0,
    ...buying((g) => (count(g, 'lab') ? null : price(nodeCost(g, 'lab'), THE.lab))),
    reward: { a: 20 },
    big: true,
  },
  {
    mode: 'chain',
    id: 'research-murk', title: 'Open up the Oil deposit',
    why: 'One of the locked deposits holds Oil. Your Data can open it: a new raw material, and new things to make from it.',
    hint: hint('Research Oil Deposits: open the Tech tree and spend your α Data on it.', 'Research Oil Deposits: tap Tech and spend your α Data on it.'),
    done: (g) => has(g, 'P2'),
    ...buying((g) => (has(g, 'P2') ? null : tech('P2'))),
    reward: { credits: 40 },
  },
  {
    mode: 'chain',
    id: 'make-ink', title: 'Turn Oil into Plastic',
    why: 'Oil is refined as Sand is: two Oil make one Plastic. Refining Oil also leaves Tar behind.',
    recipe: 'ink',
    hint: hint(
      'Place a Drill on the Oil deposit, then drag from its port and pick Refiner.',
      'Place a Drill on the Oil deposit, then tap its port, tap an empty spot and pick Refiner.',
    ),
    done: (g) => made(g, 'ink'),
    ...buying((g) => rawLine(g, 'P2', 'murk', 'ink')),
    reward: { credits: 40 },
  },
  {
    mode: 'chain',
    id: 'silt-exit', title: 'Give the Tar somewhere to go',
    why: 'A machine stops when anything it makes has nowhere to go. Plastic sells; Tar is waste, and a Dump takes it for nothing.',
    // The condition needs the Refiner running, and it also stops when Plastic has nowhere to go: say so.
    hint: hint(
      'Wire the Refiner\'s Plastic port to the Market, then drag from its Tar port into empty space and pick Dump.',
      'Wire the Refiner\'s Plastic port to the Market, then tap its Tar port, tap an empty spot and pick Dump.',
    ),
    done: siltHandled,
    // Orders come with it: two refined things are selling now, and the next card is the first order.
    reward: { a: 20, unlock: 'orders' },
  },
  {
    mode: 'chain',
    id: 'first-order', title: 'Fill your first order',
    why: 'Buyers ask for things you already sell. Deliver what an order asks for and it pays extra, in credits and in Data.',
    hint: hint(
      'An order counts items sold at any Market: send enough of what it asks for there, then click Claim on the order.',
      'An order counts items sold at any Market: send enough of what it asks for there, then tap Claim on the order.',
    ),
    done: (g) => g.stats.ordersFilled >= 1,
    progress: (g) => (g.order ? [Math.floor(g.order.got + 1e-9), g.order.need, MATERIALS[g.order.mat].name] : null),
    // Credits for what the next card asks the player to buy: the board's first expansion. (Routing used to come with
    // it, and a card after it that had the player build a Router: the Router is a research of its own now, for
    // whoever wants one. It used to pay Market Lens before that: price gauges for a rule that does not bite yet.)
    reward: { credits: 200 },
  },
  {
    // Land comes in where it is wanted: the one Oil deposit is in use, and the board's first new plot brings another
    // (and a Sand deposit, for whoever wants a third Glass line). It was a card of its own, "Open up more land",
    // five goals after the Oil: a plot bought because the card said so. The claim opens Ore Deposits for research.
    mode: 'chain',
    id: 'grow-ink', title: 'Make 1 Plastic a second',
    why: 'Your one Oil deposit is in use. A new plot of land brings another, and room for a second line beside the first.',
    hint: hint(
      'Click Expand board at the edge of the map. Put a Drill on the new Oil deposit, build a Refiner from its port, sell the Plastic and dump the Tar.',
      'Tap Expand board at the edge of the map. Put a Drill on the new Oil deposit, build a Refiner from its port, sell the Plastic and dump the Tar.',
    ),
    ...growth('grow-ink', 'ink', 1, 'More Oil, more Refiners or faster ones: any way that gets you there counts.'),
    reward: { a: 120, opens: ['P3'] },
    big: true,
  },
  {
    mode: 'chain',
    id: 'make-spark', title: 'Make and sell Copper',
    why: 'Copper is refined from Ore, the next deposit to open. Plastic and Copper together are what a Circuit is made of.',
    recipe: 'spark',
    hint: hint('Research Ore Deposits, then put a Drill on the Ore deposit, build a Refiner from its port and sell the Copper.'),
    // Done on the first Copper sold, not made: the sale is the last gesture of the hint, and a card that is ready
    // shows Claim and no hint. Made, it completed with the sale still to do, and the first order (which asks for
    // what is selling, the Copper most of all) waited on a Copper nobody sold.
    done: (g) => (g.sold.spark ?? 0) >= 1,
    ...buying((g) => rawLine(g, 'P3', 'ember', 'spark')),
    // The Flow meter comes with it. An Ore Drill brings up less than a Sand Drill does (0.8 a second), so the Copper
    // Refiner built on it runs short from its first second: the one producer on the board that does not run flat
    // out, and what the next card is about.
    reward: { a: 25, unlock: 'flow' },
    big: true,
  },
  {
    mode: 'chain',
    id: 'hold-flow', title: 'Hold 95% Flow for 10 seconds',
    why: 'Flow is the share of your Drills and machines that run flat out. The higher it is, the more every sale pays.',
    hint: hint(
      'Click the Flow ring to jump to the Drill or machine that holds Flow back, and give it what it lacks.',
      'Tap the Flow ring to jump to the Drill or machine that holds Flow back, and give it what it lacks.',
    ),
    done: (g) => flowHeld(g) >= RULES.flow.holdSeconds,
    progress: (g) => [Math.min(flowHeld(g), RULES.flow.holdSeconds), RULES.flow.holdSeconds, 's'],
    // The one change that puts a short producer right, named: a level of Speed on the Drill or machine that feeds
    // it, or its port wired to the Market (flowFix; the line's words name the node the step acts on, which is not
    // always the producer the Flow ring jumps to). Shown only while there is such a change; a board short in a
    // way this cannot see has the valve. Its own words below are for the line once it is done.
    meanwhile: [
      {
        id: 'flow-fix',
        text: hint(
          'Click the Flow ring to find what holds Flow back, and give it what it lacks.',
          'Tap the Flow ring to find what holds Flow back, and give it what it lacks.',
        ),
        say: flowLineWords,
        // (Not while something just built is still to count: the meter comes with the first Copper, a quarter of a
        // minute after its Ore Drill, and the line stood ticked until that Drill counted and was found too slow.)
        done: (g) => { const f = flowCount(g); return f.of > 0 && f.running === f.of && !flowUnsettled(g); },
        when: (g) => { const f = flowCount(g); return (f.of > 0 && f.running === f.of && !flowUnsettled(g)) || !!flowFix(g); },
      },
    ],
    reward: { credits: 150 },
  },
  {
    // The Copper line, doubled: a second plot (it brings an Ore deposit), a second Drill and Refiner. The new Ore
    // Drill is as slow as the first was, and this time no card names the fix: the player has done it once, on the
    // Flow card, and the Refiner says what it is short of. The claim opens Assembly.
    mode: 'chain',
    id: 'grow-spark', title: 'Make 1 Copper a second',
    why: 'A Circuit will take a Copper each, and one Refiner makes one every two seconds. A second Ore line doubles it.',
    hint: hint(
      'Expand the board again for a second Ore deposit, build a Drill and a Refiner there and sell the Copper. An Ore Drill needs Speed to keep a Refiner busy.',
    ),
    ...growth('grow-spark', 'spark', 1, 'More Ore, more Refiners or faster ones: any way that gets you there counts.'),
    reward: { a: 400, opens: ['P4'] },
    big: true,
  },
  {
    mode: 'tiers',
    id: 'tier-refining', title: 'Fill the Refining contract',
    why: 'A factory wants Glass, Plastic and Copper by the crate. More lines, faster machines and more land all fill it sooner.',
    hint: hint('Wire Glass, Plastic and Copper into the Dock. Sell some to pay for more: every line you add makes it sooner.'),
    contract: { shard: 400, ink: 250, spark: 150 },
    done: (g) => contractDone(g),
    progress: (g) => contractProgress(g),
    tools: [
      {
        name: 'Oil and Plastic',
        why: 'Two Oil make a Plastic, and leave a Tar behind. A Refiner stops when its Tar has nowhere to go.',
        how: hint('Place a Drill on the Oil deposit, build a Refiner from its port, and a Dump from its Tar port.', 'Tap the Oil deposit twice for a Drill, build a Refiner from its port, and a Dump from its Tar port.'),
      },
      {
        name: 'Ore and Copper',
        why: 'Two Ore make a Copper. An Ore Drill brings up 0.8 a second, a little less than a Refiner wants.',
        how: hint('Place a Drill on the Ore deposit and build a Refiner from its port.', 'Tap the Ore deposit twice for a Drill, and build a Refiner from its port.'),
      },
      {
        name: 'Land',
        why: 'Every deposit takes one Drill. A new plot brings two or three more, and room for more lines.',
        how: hint('Press Expand at the edge of the plot.'),
      },
      {
        name: 'Router',
        why: 'Splits one stream between several wires, evenly or by ratio: so much to the Dock, so much to sell.',
        how: hint('Build a Router from a port, then wire it to the Dock and to a Market. Its inspector sets the split.', 'Build a Router from a port, then wire it to the Dock and to a Market. Its sheet sets the split.'),
      },
      {
        name: 'Merger',
        why: 'Gathers many wires into one, so that three lines reach the Dock as one tidy stream.',
        how: hint('Build a Merger, wire your lines into it, and wire it on.'),
      },
      {
        name: 'Lab and Data',
        why: 'A Lab turns what it is given into Data. Data buys research: faster Labs, better wires, Drills that move.',
        how: hint('Build a Lab from any port. The Tech tree shows what Data buys.'),
      },
      {
        name: 'Orders and Flow',
        why: 'Orders pay extra for what you sell. Flow pays up to 20% more on every sale while every machine runs flat out.',
        how: hint('An order shows beside the contract. The ring round your credits is your Flow.'),
      },
    ],
    reward: { credits: 1500, techs: ['P4', 'P5', 'L4', 'L6', 'L5', 'S1'] },
    big: true,
  },
  {
    mode: 'chain',
    id: 'make-glyph', title: 'Make your first Circuit',
    why: `A Circuit is Plastic and Copper put together, and sells for ${MATERIALS.glyph.value}¢. That takes an Assembler: a machine with two inputs.`,
    recipe: 'glyph',
    // Where the Assembler is built from is said: dragged out of the Plastic port it arrives wired, set to Circuit.
    // The Market comes before the Copper: the goal completes with the first Circuit, the card then shows Claim
    // and no hint, and a player who had still to "sell its Circuit" never read that again (the Circuit sat
    // unsold until a tip said so, six minutes on).
    hint: hint('Research Assembly, build an Assembler from a Refiner\'s Plastic port, wire it to the Market, then wire Copper into it to make a Circuit.'),
    done: (g) => made(g, 'glyph'),
    ...buying((g) => techThenNode(g, 'P4', 'assembler', 'glyph')),
    reward: { credits: 150 },
    big: true,
  },
  {
    mode: 'chain',
    id: 'study-glyph', title: 'Study Circuits for β',
    why: 'Better things teach more. An assembled part gives β Data, a new kind, and the next technology costs some.',
    hint: hint(
      'Drag from the Assembler\'s port to a Lab.',
      'Tap the Assembler\'s port, then tap a Lab.',
    ),
    done: (g) => g.data.b >= RULES.goals.studyBeta,
    progress: (g) => [Math.min(g.data.b, RULES.goals.studyBeta), RULES.goals.studyBeta, 'β'],
    reward: { a: 50 },
  },
  {
    // The one growth goal with two ways that cost about the same: a second Assembler on the second Plastic line (it
    // is what the two lines of Plastic and of Copper were widened for), or four levels of Speed on the first.
    // The claim opens Quartz Deposits.
    mode: 'chain',
    id: 'grow-glyph', title: 'Make 0.6 Circuits a second',
    why: 'A Phone will take two Circuits. A second Assembler doubles what you make; Speed on the one you have gets there too.',
    hint: hint(
      'Build a second Assembler from the other Refiner\'s Plastic port, wire it to the Market and wire Copper into it. Or buy Speed on the first, four times.',
    ),
    ...growth('grow-glyph', 'glyph', 0.6, 'More Assemblers or faster ones: any way that gets you there counts.'),
    reward: { a: 600, opens: ['P5'] },
    big: true,
  },
  {
    mode: 'chain',
    id: 'make-mist', title: 'Make and sell Silicon',
    why: 'Silicon is refined from Quartz, the last deposit to open. Silicon and Glass together make a Screen.',
    recipe: 'mist',
    hint: hint('Research Quartz Deposits, then put a Drill on a Quartz deposit, build a Refiner from its port and sell the Silicon.'),
    // On the first Silicon sold, for the same reason as "Make and sell Copper".
    done: (g) => (g.sold.mist ?? 0) >= 1,
    ...buying((g) => rawLine(g, 'P5', 'breeze', 'mist')),
    reward: { a: 50 },
  },
  {
    mode: 'chain',
    id: 'make-prism', title: 'Make your first Screen',
    why: `A Screen is two Glass and one Silicon, and sells for ${MATERIALS.prism.value}¢: another Assembler, fed by two of your lines.`,
    recipe: 'prism',
    // The Market before the Glass, for the same reason as on "Make your first Circuit".
    hint: hint('Build another Assembler from the Silicon Refiner\'s port, wire it to the Market, then wire Glass into it to make a Screen.'),
    done: (g) => made(g, 'prism'),
    ...buying((g) => techThenNode(g, 'P5', 'assembler', 'prism')),
    // The Screen Assembler is saved for in credits, and the β for Fabrication is in hand by now (this goal and the
    // next pay what is still missing of it): the Circuit the Lab studies is worth more sold.
    meanwhile: [CUT_GLYPH],
    // Bulk Upgrade comes with it: the next card is about using it.
    reward: { credits: 600, b: 40, techs: ['S1'] },
    big: true,
  },
  {
    // (This used to be "Fill three orders", which the orders filled on the way had always met by the time it came
    // up: it showed Claim and nothing else.) One press, on a board of a dozen Drills, and the lesson of the tool
    // that saves a phone player a hundred presses from here on.
    mode: 'chain',
    id: 'bulk-upgrade', title: 'Speed up every Drill at once',
    why: 'A long line needs more raw material at its start. Upgrade all raises every machine of one kind at once.',
    hint: hint(
      'Select a Drill and press Upgrade all beside Speed.',
      'Tap a Drill and tap Upgrade all beside Speed.',
    ),
    done: bulkSince,
    ...buying((g) => (isFinite(cheapestWellSpeed(g)) ? price(cheapestWellSpeed(g), 'the upgrade') : null)),
    reward: { credits: 1200, b: 60 },
  },
  {
    // The last growth goal, and the Screen line's: a second Screen Assembler, which the Glass has been there for
    // since "Make 1.2 Glass a second" and the Silicon since the press of Upgrade all (a Quartz Drill is as slow as
    // an Ore Drill, and the card before has just put that right). The claim opens Fabrication.
    mode: 'chain',
    id: 'grow-prism', title: 'Make 0.5 Screens a second',
    why: 'One Assembler makes a Screen every four seconds, and your Glass and Silicon would do for two. A Phone will take a Screen.',
    hint: hint(
      'Build a second Assembler from a Glass Refiner\'s port, wire it to the Market and wire Silicon into it. Or buy Speed on the first, and feed it.',
    ),
    ...growth('grow-prism', 'prism', 0.5, 'More Assemblers or faster ones, and the Glass and Silicon to feed them: any way counts.'),
    reward: { a: 400, opens: ['P7'] },
    big: true,
  },
  {
    mode: 'tiers',
    id: 'tier-parts', title: 'Fill the Parts contract',
    why: 'A phone maker wants Circuits and Screens. Your Plastic, Copper and Glass are parts now: an Assembler puts two together.',
    hint: hint('Build Assemblers from your Refiners\' ports and wire what they make into the Dock. Each wants its two inputs in its own ratio.'),
    contract: { glyph: 200, prism: 100 },
    done: (g) => contractDone(g),
    progress: (g) => contractProgress(g),
    tools: [
      {
        name: 'Circuits',
        why: 'An Assembler puts two things together. A Circuit is one Plastic and one Copper, every three seconds.',
        how: hint('Build an Assembler from a Plastic Refiner\'s port, then wire a Copper Refiner into it.', 'Build an Assembler from a Plastic Refiner\'s port, then wire a Copper Refiner into it.'),
      },
      {
        name: 'Quartz and Screens',
        why: 'Two Quartz make a Silicon. A Screen is two Glass and one Silicon, every four seconds: twice as much Glass.',
        how: hint('Place a Drill on the Quartz deposit, build a Refiner from it, then an Assembler from that Refiner\'s port, and wire Glass in.', 'Tap the Quartz deposit twice for a Drill, build a Refiner from it, then an Assembler from its port, and wire Glass in.'),
      },
      {
        name: 'Trunks',
        why: 'Gather every line of one material into a Merger: each Assembler wired from it takes what it needs, and the rest goes on.',
        how: hint('Wire your Glass Refiners into a Merger, then the Merger to each Screen Assembler and to a Market.'),
      },
      {
        name: 'Priority and Filter',
        why: 'A Router can fill one wire before the next, or send each material its own way down a mixed stream.',
        how: hint('Select a Router and pick Priority or Filter in its inspector.', 'Tap a Router and pick Priority or Filter in its sheet.'),
      },
      {
        name: 'Silo',
        why: 'A big store between two machines: it keeps an Assembler fed while its supply comes and goes.',
        how: hint('Place a Silo on a wire, or build one from a port.'),
      },
      {
        name: 'Upgrade all',
        why: 'Raises every machine of one kind by a level of Speed at once.',
        how: hint('Select a machine and press Upgrade all beside Speed.', 'Tap a machine and tap Upgrade all beside Speed.'),
      },
      {
        name: 'Wires',
        why: 'A wire carries 4 a second. A trunk of many lines, or a fast pair, fills it: research Pipes for wires that carry more.',
        how: hint('Research Pipes Mk II in the Tech tree, then select a full wire and upgrade it.', 'Research Pipes Mk II in the Tech tree, then tap a full wire and upgrade it.'),
      },
    ],
    reward: { credits: 500, a: 400, b: 100, opens: ['P7'] },
    big: true,
  },
  {
    id: 'build-fabricator', title: 'Build a Fabricator',
    why: 'A Phone is a Screen and two Circuits. Only a Fabricator puts three things together, and it is the dearest machine yet.',
    hint: hint('Research Fabrication, then save up and build a Fabricator from the Screen Assembler\'s port: orders and a high Flow get you there faster.'),
    done: (g) => count(g, 'fabricator') >= 1,
    ...buying((g) => (has(g, 'P7') ? price(nodeCost(g, 'fabricator'), THE.fabricator) : tech('P7', nodeCost(g, 'fabricator'), THE.fabricator))),
    // Goal 17 had the player study Circuit. Fabrication's β is in hand by now (the two goals before pay it), and
    // from here every Circuit in a Lab is 20¢ not earned toward the Fabricator. This is the one place the chain
    // takes a wire back, and it is a card that says so: the adviser never reverses a card (src/advice.ts).
    // It applies while the β is covered and the Fabricator's price is not: a player who already has the
    // credits (one who never spent any on upgrades) gains nothing by it, and is not asked.
    // (Its second line wired each Drill with a Lab of its own to the Market too: four wires across the whole board at
    // minute 17, and a minute later the game said that what they sold went at a quarter of the price, as every
    // card player first sold over demand there. The Fabricator's price came down instead: docs/CONTENT.md.)
    // Then the tune-up, for the wait itself: the Drills that outrun their machines are put right (a level of Speed
    // each), and the Drills that only feed Labs get a Refiner whose goods are sold. Each step only while it pays for
    // itself before the Fabricator can be bought; nothing is sold raw or over its demand.
    meanwhile: [CUT_GLYPH, TUNE_UP],
    reward: { b: 40 },
  },
  {
    id: 'make-lens', title: 'Make your first Phone',
    why: 'Sand, Oil, Ore and Quartz, all in one thing. The Fabricator needs one Screen and two Circuits for every Phone.',
    recipe: 'lens',
    hint: hint('Wire the Screen Assembler\'s port and the Circuit Assembler\'s port to the Fabricator.'),
    done: (g) => made(g, 'lens'),
    // The inputs the Fabricator has wired in, then the Phone itself.
    progress: (g) => {
      const feeds = lensFeeds(g);
      if (!feeds) return null;
      const fed = feeds.filter((x) => x.fed).length;
      return fed < feeds.length ? [fed, feeds.length, 'inputs wired'] : [0, 1, 'Phone'];
    },
    // A Fabricator built from the Screen Assembler's port, as the card before says, has its Screen and no Circuit:
    // the step left is a wire, and the card names it (one built anywhere else needs the Screen wired too).
    // They are the goal itself, not something to do while waiting (`required`): the card says "Next step".
    meanwhile: [
      {
        id: 'prism-fab',
        text: hint('Wire the Screen Assembler\'s port to the Fabricator: a Phone takes one Screen.'),
        done: (g) => lensFed(g, 'prism'),
        when: (g) => !!lensMaker(g),
        required: true,
      },
      {
        id: 'glyph-fab',
        text: hint('Wire the Circuit Assembler\'s port to the Fabricator: a Phone takes two Circuits.'),
        done: (g) => lensFed(g, 'glyph'),
        when: (g) => !!lensMaker(g),
        required: true,
      },
    ],
    reward: { unlock: 'end' },
    big: true,
  },
  // ---------- free play ----------
  {
    id: 'make-clay', title: 'Reclaim Tar into Rubber', free: true,
    why: 'Tar need not be waste: three Tar make one Rubber.',
    recipe: 'clay',
    hint: hint('Research Reclamation, then send Tar to a Refiner instead of the Dump.'),
    done: (g) => made(g, 'clay'),
    ...buying((g) => techThenNode(g, 'P6', 'refiner', 'clay')),
    reward: { credits: 200 },
  },
  {
    id: 'make-coil', title: 'Make your first Cable', free: true,
    why: 'A Cable is Copper wrapped in Rubber: one Copper and two Rubber.',
    recipe: 'coil',
    hint: hint('Feed an Assembler one Copper and two Rubber for every Cable.'),
    done: (g) => made(g, 'coil'),
    ...buying((g) => techThenNode(g, 'P6', 'assembler', 'coil')),
    reward: { credits: 600 },
  },
  {
    id: 'make-dynamo', title: 'Build your first Laptop', free: true,
    why: 'A Laptop is a Screen, a Circuit and two Cables: three lines that meet in one Fabricator.',
    recipe: 'dynamo',
    hint: hint('Research Laptop, then feed a Fabricator two Cables, a Circuit and a Screen.'),
    done: (g) => made(g, 'dynamo'),
    ...buying((g) => techThenNode(g, 'P8', 'fabricator', 'dynamo')),
    reward: { credits: 1800 },
  },
  {
    id: 'make-paradox', title: 'Build a Robot', free: true,
    why: 'The last thing there is to make: a Phone for a brain, a Laptop for a body and four raw Quartz for eyes.',
    recipe: 'paradox',
    hint: hint('Research Robot, then feed a Fabricator a Phone, a Laptop and four raw Quartz.'),
    done: (g) => made(g, 'paradox'),
    ...buying((g) => techThenNode(g, 'P9', 'fabricator', 'paradox')),
    reward: { credits: 7500 },
  },
];

/**
 * The index of the first free-play goal: the goals before it are the demo's, in both ways of playing (each passes
 * over the goals of the other: `mode`). How many of them a game plays is mainCount(g).
 */
export const MAIN_GOALS = GOALS.filter((x) => !x.free).length;

/** The way a game is played: the goal chain, or the tiers (docs/TIERS.md). */
export const goalMode = (g: Game): 'chain' | 'tiers' => (g.tiers ? 'tiers' : 'chain');
/** The goal is one this game plays (it is not of the other way of playing). */
export const inMode = (g: Game, goal: Goal) => !goal.mode || goal.mode === goalMode(g);
/** The goals of one way of playing, in order. */
export const goalsOf = (mode: 'chain' | 'tiers') => GOALS.filter((x) => !x.mode || x.mode === mode);
/** The first goal at or after index i that this game plays (GOALS.length past the end). */
function nextInMode(g: Game, i: number): number {
  while (i < GOALS.length && !inMode(g, GOALS[i])) i++;
  return i;
}
/** How many goals of the demo this game plays ("Goal 4 / 25"). */
export const mainCount = (g: Game) => goalsOf(goalMode(g)).filter((x) => !x.free).length;
/** The place of the goal at index i among the goals this game plays, counting from 1. */
export function goalNumber(g: Game, i: number): number {
  let n = 0;
  for (let j = 0; j <= i && j < GOALS.length; j++) if (inMode(g, GOALS[j])) n++;
  return n;
}

export const goalById = (id: string) => GOALS.find((x) => x.id === id) ?? null;

/** The active goal, or null when every goal has been claimed. */
export function activeGoal(g: Game): Goal | null {
  if (g.chain !== CHAIN) migrateChain(g);
  return GOALS[g.goal.i] ?? null;
}

export interface GoalView {
  goal: Goal;
  /** 1-based position among the main goals, or among the free-play goals when `free`. */
  number: number;
  total: number;
  free: boolean;
  ready: boolean;
  /** Why: what the card says under the title (Goal.why). */
  why: string;
  /** How: the gesture, for the input in use (Goal.hint). */
  hint: string;
  /** The recipe the goal is about, when it has one (Goal.recipe). */
  recipe?: Recipe;
  /**
   * Which of that recipe's inputs are wired into the machine that makes it, and whether what it makes goes anywhere
   * (recipeFeeds): the card ticks them off on the recipe. Absent while no such machine stands, once the goal is
   * ready, and for a recipe with one input.
   */
  fed?: { fed: Partial<Record<MatId, boolean>>; out: boolean };
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
   *
   * A goal may carry several lines, shown one at a time in order: this is the first one not yet done that
   * applies (or, once every one is done, the last one, with `done: true`). `step` is its 1-based place among
   * the goal's lines and `of` how many the goal has, so the card can read "While you wait · 2 of 3". Both are
   * absent (read as 1 of 1) for a goal with a single line. lineAdvice(g) in src/advice.ts always gives the next
   * step of the line shown here.
   *
   * `required`: the line is the goal's own requirement, not something to do while waiting (goal 22's wires into
   * the Fabricator): the card labels it "Next step", with no count. `held`: the line's next step is being saved
   * for (the credits the card's own next purchase needs are kept back), so it has no Show me yet; the card says
   * what it is saving and about how long ("Saving for this · 1,100¢ · about 40 s"). `eta` is in game seconds.
   */
  meanwhile?: {
    text: string; done: boolean; step?: number; of?: number;
    required?: boolean;
    /** A growth goal's line (Meanwhile.way): one way to its rate, not the only one. The card says "One way", and keeps it with the how. */
    way?: boolean;
    held?: { cost: number; sym: '¢' | 'α' | 'β' | 'γ'; eta: number };
  };
  /**
   * Only on "Make your first Phone", once there is a Fabricator: each input a Phone takes and whether it is wired
   * into that Fabricator, so the card can say "Screen ✓ · Circuit ✗" (the progress counts the same as "1 / 2 inputs wired").
   */
  inputs?: { mat: MatId; name: string; fed: boolean }[];
}

/** Everything the goal card shows. null when every goal has been claimed. */
export function goalView(g: Game, touch = false): GoalView | null {
  const goal = activeGoal(g);
  if (!goal) return null;
  const free = !!goal.free;
  const at = meanwhileAt(g);
  const inputs = goal.id === 'make-lens' && !g.goal.ready ? lensFeeds(g) : null;
  const recipe = goal.recipe ? RECIPES[goal.recipe] : undefined;
  const fed = recipe && !g.goal.ready ? recipeFeeds(g, recipe) : null;
  const how = (g.goal.ready ? null : goal.howNow?.(g)) ?? goal.hint;
  return {
    ...(fed ? { fed } : {}),
    ...(goal.id === 'hold-flow' ? { flow: flowGoalView(g) } : {}),
    ...(at ? { meanwhile: lineView(g, at, touch) } : {}),
    ...(inputs ? { inputs } : {}),
    goal,
    number: free ? g.goal.i - MAIN_GOALS + 1 : goalNumber(g, g.goal.i),
    total: free ? GOALS.length - MAIN_GOALS : mainCount(g),
    free,
    ready: g.goal.ready,
    why: goal.why,
    hint: touch ? how.touch : how.mouse,
    ...(goal.recipe && RECIPES[goal.recipe] ? { recipe: RECIPES[goal.recipe] } : {}),
    progress: g.goal.ready ? null : goal.progress?.(g) ?? null,
    reward: goal.reward,
    big: !!goal.big,
  };
}

/** The card's view of the line meanwhileAt(g) gives (GoalView.meanwhile). */
function lineView(g: Game, at: { line: Meanwhile; step: number; of: number }, touch: boolean): NonNullable<GoalView['meanwhile']> {
  const done = at.line.done(g);
  const held = done ? null : lineHeld(g);
  return {
    text: lineText(g, at.line, touch), done,
    ...(at.of > 1 ? { step: at.step, of: at.of } : {}),
    ...(at.line.required ? { required: true } : {}),
    ...(at.line.way ? { way: true } : {}),
    ...(held ? { held } : {}),
  };
}

/** A line's sentence as the card shows it: its words for this board (Meanwhile.say), else its own. */
function lineText(g: Game, line: Meanwhile, touch: boolean): string {
  const t = line.say?.(g) ?? line.text;
  return touch ? t.touch : t.mouse;
}

/**
 * For each game: the lines of its active goal that have applied to its board since the goal came up (or since this
 * copy of the game was first asked). Kept beside the game, not in it: nothing is saved, and a copy starts afresh.
 */
const linesSeen = new WeakMap<Game, { goal: number; at: number; ids: Set<string> }>();

/** The ids of the active goal's lines that are done on the board as it stands (Game.goalAt.had, when a goal comes up). */
const linesDone = (g: Game): string[] => (GOALS[g.goal.i]?.meanwhile ?? []).filter((l) => l.done(g)).map((l) => l.id);

/**
 * The active goal's "while you wait" line on the card right now, with its place among the goal's lines (1-based
 * `step` of `of`): the first line that applies and is not done yet, in the goal's order; once every line that
 * applies is done, the last of them (done). null when the goal has no line that applies to this board, or is
 * ready to claim.
 *
 * A line that was done already when the goal came up (Game.goalAt.had) is not shown and not counted: the card does
 * not tick off, as if just done, a wire that was cut two goals earlier. (Undone again, it is a line like any other:
 * tickGoal takes it off that list.) And the count is of the lines the card shows, has shown or may still show: a line
 * that only applies while its steps pay (Meanwhile.closes) is left out of `of`, and of the places before `step`,
 * unless it applies now or has applied since the goal came up, so the card reads "1 of 2" only where there is a second.
 */
export function meanwhileAt(g: Game): { line: Meanwhile; step: number; of: number } | null {
  const all = activeGoal(g)?.meanwhile;
  if (!all?.length || g.goal.ready) return null;
  // (Not noted yet, in a save from before it was kept or with a goal set by hand: the lines done now, as the next tick
  // will note them. The page draws the card once before that tick, and the card keeps the count it first read while
  // the same line stays on it: "1 of 2" stood under a line whose second had been done before the save was loaded.)
  const had = (g.goalAt && g.goalAt.i === g.goal.i ? g.goalAt.had : undefined) ?? linesDone(g);
  let seen = linesSeen.get(g);
  if (!seen || seen.goal !== g.goal.i || g.time < seen.at) linesSeen.set(g, (seen = { goal: g.goal.i, at: g.time, ids: new Set() }));
  seen.at = g.time;
  // One pass, asking each line no more than is needed: whether it is done only up to the line the card shows (and
  // of a line that was done when the goal came up), whether it applies only up to there and of a line that closes.
  let found: { line: Meanwhile; step: number; of: number } | null = null;
  let last: { line: Meanwhile; step: number; of: number } | null = null;
  let count = 0;
  for (const line of all) {
    if (had?.includes(line.id) && line.done(g)) continue;
    const ask = !found || !!line.closes;
    const on = ask ? !line.when || line.when(g) : false;
    if (on) seen.ids.add(line.id);
    if (!on && line.closes && !seen.ids.has(line.id)) continue;
    count++;
    if (found || !on) continue;
    const at = { line, step: count, of: 0 };
    if (line.done(g)) last = at;
    else found = at;
  }
  const at = found ?? last;
  if (at) at.of = count;
  return at;
}

/** The line meanwhileAt(g) gives, done or not; null when there is none. lineAdvice(g) gives its next step. */
export function meanwhileOf(g: Game): Meanwhile | null {
  return meanwhileAt(g)?.line ?? null;
}

/**
 * The nodes the active goal's hint or line is about right now, in the order a player meets them: for "Drag
 * from the Refiner's port to an empty spot and pick Lab", the Refiner; for "Wire the Circuit Assembler's port
 * to the Fabricator", the Circuit Assembler and then the Fabricator. While the goal is a wait (or its hint has
 * nothing on the board to point at) and its line is up and not done, the nodes of the line's next step,
 * whether or not it can be paid for yet. The interface brings them into view when a goal comes up and after a
 * sheet closes, if they are not in view already. Empty when the goal is ready to claim, or neither names a
 * node on the board.
 */
export function goalFocus(g: Game): number[] {
  const goal = activeGoal(g);
  if (!goal || g.goal.ready) return [];
  const hint = hintFocus(g, goal.id);
  const line = meanwhileOf(g);
  const ids = line && !line.done(g) && (!hint.length || waitKind(g) != null) ? lineFocus(g) : [];
  const out: number[] = [];
  for (const n of ids.length ? ids : hint) if (n != null && !out.includes(n) && g.nodes.some((x) => x.id === n)) out.push(n);
  return out;
}

/**
 * The free deposit the active goal's hint asks for a Drill on, while that is its next gesture (goalFocus is then
 * empty: a deposit is not a node): the Sand deposit of "Dig up more Sand", and the Oil, Ore or Quartz
 * deposit of a raw line ("Place a Drill on the Oil deposit, then..."), once its research is done. null otherwise.
 */
export function goalDeposit(g: Game): number | null {
  const goal = activeGoal(g);
  if (!goal || g.goal.ready) return null;
  const raw: Partial<Record<string, [MatId, string | null]>> = {
    'second-well': ['glint', null], 'make-ink': ['murk', 'P2'], 'make-spark': ['ember', 'P3'], 'make-mist': ['breeze', 'P5'],
  };
  const want = raw[goal.id];
  if (!want || (want[1] && !has(g, want[1]))) return null;
  // (A Drill already on that material: the hint has moved on to the Refiner, which goalFocus names.)
  if (goal.id !== 'second-well' && g.nodes.some((n) => n.type === 'well' && n.material === want[0])) return null;
  const used = new Set(g.nodes.map((n) => n.depositId));
  return g.deposits.find((d) => d.mat === want[0] && !used.has(d.id))?.id ?? null;
}

/** The nodes the hint's next gesture is about, by goal (see goalFocus). */
function hintFocus(g: Game, id: string): number[] {
  const c = graph(g);
  const maker = (recipe: string) => g.nodes.find((n) => n.recipe === recipe) ?? null;
  const wellOn = (m: MatId) => g.nodes.find((n) => n.type === 'well' && n.material === m) ?? null;
  const market = g.nodes.find((n) => n.type === 'market') ?? null;
  const lab = g.nodes.find((n) => n.type === 'lab') ?? null;
  const wells = g.nodes.filter((n) => n.type === 'well');
  const sells = (n: GNode | null, port = 0) => !!n && (c.outs.get(n.id)?.[port] ?? []).some((w) => c.byId.get(w.to)?.type === 'market');
  const fedWith = (n: GNode, m: MatId) => (c.ins.get(n.id) ?? []).some((w) => carries(g, w, m));
  const ids = (...list: (GNode | null | undefined)[]) => list.filter((n): n is GNode => !!n).map((n) => n.id);
  /** "Put a Drill on the deposit, build a Refiner from its port and sell what it makes." */
  const rawLine = (tech: string, raw: MatId, recipe: string) => {
    if (!has(g, tech)) return [];
    const r = maker(recipe);
    if (r) return sells(r) ? [] : ids(r, market);
    return ids(wellOn(raw));
  };
  /** "Build an Assembler from the A port, wire it to the Market, then wire B into it." */
  const assemble = (tech: string, recipe: string, from: string, then: MatId) => {
    if (!has(g, tech)) return [];
    const a = maker(recipe);
    if (!a) return ids(maker(from));
    if (!sells(a)) return ids(a, market);
    return fedWith(a, then) ? [] : ids(g.nodes.find((n) => recipeOf(n)?.outputs[0]?.[0] === then), a);
  };
  switch (id) {
    case 'wire-market': return ids(wells[0], market);
    case 'wire-all-wells': return ids(wells.find((n) => outWires(g, n) === 0), market);
    case 'build-refiner': case 'bulk-upgrade': return ids(wells[0]);
    case 'sell-shard': return ids(maker('shard'), market);
    case 'feed-lab': return ids(maker('shard'));
    case 'make-ink': return rawLine('P2', 'murk', 'ink');
    case 'silt-exit': {
      const ink = maker('ink');
      return !ink ? [] : sells(ink) ? ids(ink) : ids(ink, market);
    }
    case 'make-spark': return rawLine('P3', 'ember', 'spark');
    case 'first-order': {
      const o = g.order;
      if (!o || o.ready) return [];
      const n = g.nodes.find((x) => recipeOf(x)?.outputs.some((out) => out[0] === o.mat) && !sells(x, recipeOf(x)!.outputs.findIndex((out) => out[0] === o.mat)));
      return n ? ids(n, market) : [];
    }
    case 'make-glyph': return assemble('P4', 'glyph', 'ink', 'spark');
    case 'hold-flow': {
      const f = flowFix(g);
      if (f) return ids(f.n, 'speed' in f ? f.speed : f.market);
      let worst: GNode | null = null;
      for (const n of g.nodes) if (countsForFlow(g, n) && !isFlowing(n) && (!worst || n.util < worst.util)) worst = n;
      return ids(worst);
    }
    case 'study-glyph': {
      const a = maker('glyph');
      return a && !reachesLab(g, a.id, 0) ? ids(a, lab) : ids(a);
    }
    case 'make-mist': return rawLine('P5', 'breeze', 'mist');
    case 'make-prism': return assemble('P5', 'prism', 'mist', 'shard');
    case 'build-fabricator': return has(g, 'P7') ? ids(maker('prism')) : [];
    case 'make-lens': {
      const f = lensMaker(g);
      if (!f) return [];
      const missing = lensFeeds(g)?.find((x) => !x.fed);
      return missing ? ids(g.nodes.find((n) => recipeOf(n)?.outputs[0]?.[0] === missing.mat), f) : ids(f);
    }
    default: return [];
  }
}

/** Short text for a reward, e.g. "Refining + 50¢". */
export function rewardText(r: GoalReward): string {
  const parts: string[] = [];
  for (const id of r.techs ?? []) parts.push(TECHS[id]?.name ?? id);
  const unlocks = [...(r.unlock ? [r.unlock] : []), ...(r.unlocks ?? [])];
  if (unlocks.includes('orders')) parts.push('Orders');
  if (unlocks.includes('flow')) parts.push('Flow meter');
  if (r.unlock === 'end') parts.push('Demo complete');
  for (const id of r.opens ?? []) parts.push(`opens ${TECHS[id]?.name ?? id}`);
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
  for (const id of r.opens ?? []) {
    if (!TECHS[id] || g.opened.includes(id)) continue;
    g.opened.push(id);
    g.rev++;
  }
  for (const u of r.unlocks ?? []) applyUnlocks(g, { unlock: u });
  if (r.unlock === 'orders' && !g.ordersOn) {
    g.ordersOn = true;
    g.events.push({ kind: 'unlock', what: 'orders', text: 'Orders unlocked.' });
    startOrders(g);
  } else if (r.unlock === 'flow' && !g.flowOn) {
    g.flowOn = true;
    g.events.push({ kind: 'unlock', what: 'flow', text: 'Flow meter unlocked: the more of your line runs flat out, the better your prices.' });
  } else if (r.unlock === 'end') endDemo(g);
}

/**
 * The chain a game's goal index counts along (Game.chain). Chain 1 was 22 goals with one Refiner of each kind all
 * the way to the Phone; this one has growth goals between its chapters, and three cards fewer: upgrades are met in
 * "Make 1.2 Glass a second", land in "Make 1 Plastic a second", and the Router is a research and no card.
 */
export const CHAIN = 4;
/**
 * The goals of chain 3, in order: chain 4 adds Tier 2's contract (`tier-parts`) before "Build a Fabricator". A save of
 * chain 3 is moved to the same goal by its id.
 */
const CHAIN_3 = [
  'wire-market', 'second-well', 'wire-all-wells', 'build-refiner', 'sell-shard', 'grow-shard', 'tune-shard', 'dock-glass', 'feed-lab', 'research-murk',
  'make-ink', 'silt-exit', 'first-order', 'grow-ink', 'make-spark', 'hold-flow', 'grow-spark', 'tier-refining', 'make-glyph', 'study-glyph', 'grow-glyph',
  'make-mist', 'make-prism', 'bulk-upgrade', 'grow-prism', 'build-fabricator', 'make-lens', 'make-clay', 'make-coil', 'make-dynamo', 'make-paradox',
];
/**
 * The goals of chain 2, in order: chain 3 is the same with the tiers' two contracts set among them (`mode`), which
 * a game of the chain passes over. A save of chain 2 is moved to the same goal by its id.
 */
const CHAIN_2 = [
  'wire-market', 'second-well', 'wire-all-wells', 'build-refiner', 'sell-shard', 'grow-shard', 'tune-shard', 'feed-lab', 'research-murk',
  'make-ink', 'silt-exit', 'first-order', 'grow-ink', 'make-spark', 'hold-flow', 'grow-spark', 'make-glyph', 'study-glyph', 'grow-glyph',
  'make-mist', 'make-prism', 'bulk-upgrade', 'grow-prism', 'build-fabricator', 'make-lens', 'make-clay', 'make-coil', 'make-dynamo', 'make-paradox',
];
/** The goals of chain 1, in order: what the index of a save without Game.chain counts along. */
const CHAIN_1 = [
  'wire-market', 'second-well', 'wire-all-wells', 'build-refiner', 'sell-shard', 'upgrade-well', 'feed-lab', 'research-murk', 'make-ink', 'silt-exit',
  'make-spark', 'first-order', 'route-lab', 'expand', 'make-glyph', 'hold-flow', 'study-glyph', 'make-mist', 'make-prism', 'bulk-upgrade',
  'build-fabricator', 'make-lens', 'make-clay', 'make-coil', 'make-dynamo', 'make-paradox',
];
/** Where a save standing on a card this chain no longer has is picked up. */
const CHAIN_1_NOW: Record<string, string> = { 'upgrade-well': 'tune-shard', 'route-lab': 'hold-flow', expand: 'hold-flow' };

/**
 * Carry a save from an earlier chain over to this one, once: its goal is found by its id, so the player stands on
 * the card they stood on (one whose card is gone, on the nearest one after it). The growth goals that lie before
 * that card are not asked of them: what those goals unlock comes with the save's place (repairChain). A goal further
 * on that the save has met already is ready the moment it is reached, as always.
 */
export function migrateChain(g: Game) {
  if (g.chain === CHAIN) return;
  if (g.chain == null || g.chain === 1) {
    // (Past the end of that chain: every goal was claimed, and every goal of this one counts as claimed.)
    const old: string | undefined = CHAIN_1[g.goal.i];
    const id = old == null ? null : CHAIN_1_NOW[old] ?? old;
    const at = id == null ? -1 : GOALS.findIndex((x) => x.id === id);
    const t = g.goalAt && g.goalAt.i === g.goal.i ? g.goalAt.t : g.time;
    // A card that was ready stays ready only where it is the same card.
    g.goal = { i: at < 0 ? GOALS.length : at, ready: g.goal.ready && at >= 0 && id === old };
    g.goalAt = { i: g.goal.i, t };
  } else if (g.chain === 2 || g.chain === 3) {
    const id = (g.chain === 2 ? CHAIN_2 : CHAIN_3)[g.goal.i];
    const at = id == null ? GOALS.length : GOALS.findIndex((x) => x.id === id);
    const t = g.goalAt && g.goalAt.i === g.goal.i ? g.goalAt.t : g.time;
    g.goal = { i: at < 0 ? GOALS.length : at, ready: g.goal.ready && at >= 0 };
    g.goalAt = { i: g.goal.i, t };
  }
  g.chain = CHAIN;
}

/**
 * The contract on the card is the active goal's (Game.contract): set up afresh when a goal with one comes up, gone
 * once it is claimed. The first one brings the Dock (Game.dockOn).
 */
function repairContract(g: Game) {
  const goal = GOALS[g.goal.i];
  const want = g.tiers && goal && inMode(g, goal) ? goal.contract : undefined;
  if (!want) {
    if (g.contract) g.contract = null;
    return;
  }
  if (g.contract?.goal !== goal!.id) {
    g.contract = { goal: goal!.id, need: { ...want }, got: {}, rate: {} };
    g.rev++;
  }
  if (!g.dockOn) {
    g.dockOn = true;
    g.rev++;
    if (!isLookahead(g)) g.events.push({ kind: 'unlock', what: 'dock', text: 'The Dock: it takes what a contract asks for.' });
  }
}

/** The game second at which each game's list of lines done when the goal came up (Game.goalAt.had) was last looked through. */
const hadLooked = new WeakMap<Game, number>();

/** How far down the chain each game's unlocks have been checked. */
const unlocksChecked = new WeakMap<Game, number>();

/**
 * Keep the game consistent with its place in the chain: the index stays inside the list, and every goal
 * already claimed has its techs and its feature. In normal play this does nothing; it repairs a save that
 * says "goal 17" without the Flow meter (which goal 16 could then never finish) or without the Router.
 */
function repairChain(g: Game) {
  migrateChain(g);
  if (!Array.isArray(g.opened)) g.opened = [];
  if (g.goal.i > GOALS.length) g.goal = { i: GOALS.length, ready: false };
  // A goal of the other way of playing is passed over (a save, or a goal set by hand).
  if (g.goal.i < GOALS.length && !inMode(g, GOALS[g.goal.i])) g.goal = { i: nextInMode(g, g.goal.i), ready: false };
  repairContract(g);
  // Since when this goal has been the active one: set here for a save without it, or a goal set by hand. With it,
  // which of its lines are done already (in a save from before that was kept, too: what is done when the save is
  // loaded is not ticked off on the card as if it had just been done).
  if (!g.goalAt || g.goalAt.i !== g.goal.i) g.goalAt = { i: g.goal.i, t: g.time };
  if (!g.goalAt.had) g.goalAt.had = linesDone(g);
  // One of those that has been undone since (the player wired the Circuit back into a Lab; a producer stopped flowing)
  // is a line like any other from then on: done again, it is ticked off before the player's eyes. Looked at once a
  // game second, and not in a look-ahead copy, where nobody reads the card.
  else if (g.goalAt.had.length && !isLookahead(g) && Math.floor(g.time) !== hadLooked.get(g)) {
    hadLooked.set(g, Math.floor(g.time));
    const lines = GOALS[g.goal.i]?.meanwhile ?? [];
    const still = g.goalAt.had.filter((id) => lines.find((l) => l.id === id)?.done(g));
    if (still.length !== g.goalAt.had.length) g.goalAt.had = still;
  }
  const from = unlocksChecked.get(g) ?? 0;
  if (from >= g.goal.i) return;
  for (let i = from; i < g.goal.i; i++) if (inMode(g, GOALS[i])) applyUnlocks(g, GOALS[i].reward);
  unlocksChecked.set(g, g.goal.i);
}

/** Games whose ready goal has been checked against the goal as this version words it. */
const readyChecked = new WeakSet<Game>();

/** Check the active goal. Called every tick; cheap. */
export function tickGoal(g: Game) {
  repairChain(g);
  if (g.goal.ready && !readyChecked.has(g)) {
    // A save says the goal is ready: once, check it by this version's rule where the goal at that place in the
    // chain is a new one. (A save from the version whose goal 20 was "Fill three orders" came back ready on
    // "Speed up every Drill at once".) Any other ready goal stays ready, whatever was taken apart since.
    readyChecked.add(g);
    const goal = GOALS[g.goal.i];
    if (goal && goal.id === 'bulk-upgrade' && !goal.done(g)) g.goal.ready = false;
  }
  readyChecked.add(g);
  if (g.goal.ready) return;
  const goal = GOALS[g.goal.i];
  if (!goal || !goal.done(g)) return;
  g.goal.ready = true;
  g.events.push({ kind: 'goal-ready', goal: goal.id, index: g.goal.i, text: `Goal complete: ${goal.title}` });
}

/** Pay out the ready goal and move to the next one. Returns false when there is nothing to claim. */
export function claimGoal(g: Game): boolean {
  if (g.chain !== CHAIN) migrateChain(g);
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
  const next = nextInMode(g, index + 1);
  g.goal = { i: next, ready: false };
  // (Which of the next goal's lines are done already is noted by tickGoal below, once this reward's unlocks are in.)
  g.goalAt = { i: next, t: g.time };
  // Rewards are not undoable, so neither is what earned them: undo stops at the last claim. (Undoing the step
  // a goal was for kept the reward, refunded the step, and could meet the next card for nothing.)
  if (!isLookahead(g)) clearHistory();
  g.events.push({ kind: 'goal-claimed', goal: goal.id, index, reward: r, big: !!goal.big, text: `${goal.title}: ${rewardText(r)}` });
  applyUnlocks(g, r);
  // A goal the player has already met is ready at once.
  tickGoal(g);
  return true;
}

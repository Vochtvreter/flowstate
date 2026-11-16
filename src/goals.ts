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
import { EXPANSION_DEPOSITS, MATERIALS, MatId, NODE_DEFS, NodeType, RECIPES, RULES, Recipe, TECHS } from './content';
import {
  cycleTime, demandRate, endDemo, expansionCost, grantTech, has, labRate, maxLevel, nodeCost, nodeCount, nodeUnlocked, pickRecipe, recipeOf, trackAvailable,
  upgradeCost, valueOf, wellRate,
} from './economy';
import { countsForFlow, isFlowing, nearShare } from './flow';
import { graph, isMachine, isPass } from './graph';
import { startOrders } from './orders';
import { Game, GNode, GoalReward, Wire, isLookahead, nodeNoun } from './state';
import { clearHistory } from './actions';
import { flowLineWords, lineFocus, lineHeld, lineSpot, tuneLineWords, tuneState, waitKind } from './advice';

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
  /** One of the big celebrations: six goals carry one (the seventh is the first Flow State, see the 'flow-state' event). */
  big?: boolean;
  /** A free-play goal after the capstone. */
  free?: boolean;
  /**
   * The goal's "while you wait" lines: things worth doing meanwhile, shown one at a time in this order (the
   * first one that applies and is not done yet; see meanwhileAt).
   */
  meanwhile?: Meanwhile[];
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

/**
 * Wells with a Lab of their own: pairs of a Well and a Lab that studies what Wells give it and nothing else,
 * each Well and each Lab counted once. Such a pair is 1 α a second for good. (A Well wired into a Lab that
 * also studies Shard or Glyph does not count: it takes their place. Nor does one Well wired into two Labs
 * count twice: it has no more to give the second than the first leaves over.) With `on`, only Wells standing
 * on those deposits count.
 */
export function wellLabs(g: Game, on?: Set<number>): number {
  const c = graph(g);
  /** For each Lab fed by Wells alone: those Wells (on the deposits asked about). */
  const labs: number[][] = [];
  for (const n of g.nodes) {
    const fed = n.type === 'lab' ? c.ins.get(n.id) ?? [] : [];
    if (!(fed.length > 0 && fed.every((w) => c.byId.get(w.from)?.type === 'well'))) continue;
    const wells = fed.filter((w) => !on || on.has(c.byId.get(w.from)?.depositId ?? -1)).map((w) => w.from);
    if (wells.length) labs.push(wells);
  }
  if (labs.length < 2) return labs.length;
  // The most Labs that can each be given a Well of their own: a Lab takes a free Well, or one whose Lab can take another.
  const labOf = new Map<number, number>();
  const give = (lab: number, tried: Set<number>): boolean => {
    for (const well of labs[lab]) {
      if (tried.has(well)) continue;
      tried.add(well);
      const other = labOf.get(well);
      if (other == null || give(other, tried)) {
        labOf.set(well, lab);
        return true;
      }
    }
    return false;
  };
  let pairs = 0;
  labs.forEach((_, lab) => {
    if (give(lab, new Set())) pairs++;
  });
  return pairs;
}

/**
 * The deposits that came with the board's expansion number `from` (0-based: 1 is the second expansion) and
 * every later one. Expansions add their deposits at the end of g.deposits, EXPANSION_DEPOSITS[i] for the i-th.
 */
export function depositsFrom(g: Game, from: number): Set<number> {
  let n = 0;
  for (let i = from; i < g.board.expansions; i++) n += EXPANSION_DEPOSITS[i % EXPANSION_DEPOSITS.length].length;
  return new Set(n > 0 ? g.deposits.slice(-n).map((d) => d.id) : []);
}

/** Is there a deposit with no Well on it that the player could put one on, or a Well that has not been wired to anything yet? */
const wellToPlace = (g: Game) => g.deposits.some((d) => has(g, MATERIALS[d.mat].tech) && !g.nodes.some((n) => n.depositId === d.id))
  || g.nodes.some((n) => n.type === 'well' && outWires(g, n) === 0);

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

/** A Glint Well that feeds no machine: one a Refiner could be built from. */
export const rawGlintWell = (g: Game) =>
  g.nodes.find((n) => n.type === 'well' && n.material === 'glint' && !(graph(g).outs.get(n.id)?.[0] ?? []).some((w) => { const t = graph(g).byId.get(w.to); return !!t && isMachine(t); })) ?? null;

/** Does the player hold the Data a tech costs (or the tech itself)? */
const dataFor = (g: Game, id: string, tier: 'a' | 'b' | 'g') => has(g, id) || g.data[tier] >= (TECHS[id].cost[tier] ?? 0);

/** β the goals between here and "Build a Fabricator" still pay (counted toward Fabrication's β). */
const betaToCome = (g: Game) => {
  let b = 0;
  const end = GOALS.findIndex((x) => x.id === 'build-fabricator');
  for (let i = g.goal.i; i < end; i++) b += GOALS[i].reward.b ?? 0;
  return b;
};
/**
 * The Glyph is worth more sold: Fabrication's β is covered (in hand, with what the goals before "Build a
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
 * "Route more to a Lab than to the Market", judged by what the Router really sends: a Router that favours a
 * Lab (routerFavoursLab) whose own wires into Markets do not carry more than its own wires into Labs. A Router
 * set toward a Lab that is full spills to the Market, and then the goal is not met: it used to be, and the card
 * said "more to a Lab" while more went to the Market. (A Router that nothing passes through yet, because the
 * machines on the same port take it all, is judged by how it is set.)
 */
export function routerSendsLab(g: Game): boolean {
  if (!routerFavoursLab(g)) return false;
  const c = graph(g);
  for (const n of g.nodes) {
    if (n.type !== 'router' || !inWires(g, n)) continue;
    const wires = c.outs.get(n.id)?.[0] ?? [];
    const to = (w: Wire) => c.byId.get(w.to)?.type;
    if (!wires.some((w) => to(w) === 'lab') || !wires.some((w) => to(w) === 'market')) continue;
    let lab = 0;
    let market = 0;
    for (const w of wires) {
      if (to(w) === 'lab') lab += w.rate;
      else if (to(w) === 'market') market += w.rate;
    }
    if (market <= lab + 1e-3 && routerFavours(g, n)) return true;
  }
  return false;
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
        if (MATERIALS[m].value < RULES.orders.junkValue) continue; // Silt goes to the Void, not to a Market
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
      // what this one takes. (Two Refiners on one Well need several levels: no single step fixes that board,
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

/** The Fabricator the last goal is about: one set to Lens, or else one with no recipe yet; the better fed first. */
export function lensMaker(g: Game): GNode | null {
  const fabs = g.nodes.filter((n) => n.type === 'fabricator' && (n.recipe === 'lens' || !n.recipe));
  const fed = (n: GNode) => (graph(g).ins.get(n.id) ?? []).length;
  return fabs.sort((a, b) => Number(b.recipe === 'lens') - Number(a.recipe === 'lens') || fed(b) - fed(a))[0] ?? null;
}

/** For each input a Lens takes: is it wired into that Fabricator (straight, or through a Router, Merger or Silo)? null with no Fabricator. */
export function lensFeeds(g: Game): { mat: MatId; name: string; fed: boolean }[] | null {
  const f = lensMaker(g);
  if (!f) return null;
  const ins = graph(g).ins.get(f.id) ?? [];
  return RECIPES.lens.inputs.map(([mat]) => ({ mat, name: MATERIALS[mat].name, fed: ins.some((w) => carries(g, w, mat)) }));
}
const lensFed = (g: Game, m: MatId) => !!lensFeeds(g)?.find((x) => x.mat === m)?.fed;

/**
 * "Upgrade all your Wells at once": Upgrade all has raised the Wells since this goal came up (g.bulkAt, kept with
 * the save and set only by a press on Wells; an undo of that press takes it back, and the goal's readiness with it).
 */
const bulkSince = (g: Game) => {
  const since = g.goalAt && g.goalAt.i === g.goal.i ? g.goalAt.t : g.time;
  return g.bulkAt != null && g.bulkAt >= since - 1e-9;
};

/** The cheapest single Speed level on a Well: what one press of Upgrade all on the Wells costs at the least. */
const cheapestWellSpeed = (g: Game) => {
  let best = Infinity;
  for (const n of g.nodes) if (n.type === 'well' && n.lv.speed < maxLevel(g, 'speed')) best = Math.min(best, upgradeCost(n, 'speed'));
  return best;
};

const hint = (mouse: string, touch: string = mouse) => ({ mouse, touch });

/**
 * The pairs of "a Well and a Lab of its own" in the strict sense: a Lab fed by Wells alone, whose Wells send
 * nothing anywhere else. For each: its Wells, its Lab, what the pair studies a second now and at no Speed at
 * all, and whether a level of Speed has raised it (`sped`). "Buy Speed on each Well with a Lab of its own,
 * and on that Lab when it is full" is done when every pair is sped.
 */
export function ownPairs(g: Game): { lab: GNode; wells: GNode[]; rate: number; base: number; sped: boolean }[] {
  const c = graph(g);
  const out: { lab: GNode; wells: GNode[]; rate: number; base: number; sped: boolean }[] = [];
  for (const lab of g.nodes) {
    const fed = lab.type === 'lab' ? c.ins.get(lab.id) ?? [] : [];
    const wells = fed.map((w) => c.byId.get(w.from)!).filter((n) => n?.type === 'well');
    if (!fed.length || wells.length !== fed.length) continue;
    if (!wells.every((w) => (c.outs.get(w.id) ?? []).flat().every((x) => x.to === lab.id))) continue;
    const give = (lv: number | null) => wells.reduce((s, w) => s + wellRate(lv == null ? w : { ...w, lv: { ...w.lv, speed: lv } }), 0);
    const take = (lv: number | null) => labRate(g, lv == null ? lab : { ...lab, lv: { ...lab.lv, speed: lv } });
    const rate = Math.min(give(null), take(null));
    const base = Math.min(give(0), take(0));
    out.push({ lab, wells, rate, base, sped: rate > base + 1e-6 });
  }
  return out;
}
/**
 * "You have the β you need: cut the wire from the Glyph Assembler to the Lab." Goal 17 had the player study
 * Glyph. Fabrication's β is in hand once that and the rewards of goals 19 and 20 are counted, and from then on
 * every Glyph in a Lab is 20¢ not earned toward the Prism Assembler and the Fabricator. This is the one place
 * the chain takes a wire back, and it is a card that says so: the adviser never reverses a card (src/advice.ts).
 * It applies while the β is covered and the Fabricator's price is not: a player who already has the credits
 * gains nothing by it, and is not asked.
 */
const CUT_GLYPH: Meanwhile = {
  id: 'cut-glyph',
  text: hint('You have the β you need: cut the wire from the Glyph Assembler to the Lab.'),
  // No Glyph reaches a Lab any more, by a wire of its own or through a Router.
  done: (g) => studyWires(g, 'glyph').length === 0,
  when: (g) => sellGlyphNow(g),
  cuts: (g) => (sellGlyphNow(g) ? studyWires(g, 'glyph').map((w) => w.id) : []),
};

const GLINT_LAB: Meanwhile = {
  id: 'glint-lab',
  text: hint('Build a Lab from the port of the Glint Well that only sells: studied Glint is 1 α each.'),
  done: (g) => g.nodes.some((n) => n.type === 'well' && n.material === 'glint' && reachesLab(g, n.id, 0)),
  when: (g) => has(g, 'R1') && (g.nodes.some((n) => n.type === 'well' && n.material === 'glint' && reachesLab(g, n.id, 0)) || !!rawGlintWell(g)),
};

/**
 * "Expand the board again and give both new deposits a Well and a Lab of its own": the second expansion, on
 * "Assemble your first Glyph" once the first one's deposits have theirs, and on "Make your first Mist" for
 * whatever of it is still to do (the credits for the Assembler come first: see lineAdvice). It says "Expand"
 * only while the expansion is its next step: once the board has grown, or wherever a deposit is waiting (a
 * Glyph card that ended between the expansion and its pairs), it reads "Give each free deposit a Well and a Lab of
 * its own." (It used to say "Expand the board again" on the Mist card, where its Show me then pointed at a Lab
 * and a free deposit, and the line was ticked with no expansion made.)
 */
const EXPAND_LABS: Meanwhile = {
  id: 'expand-labs',
  text: hint('Expand the board again and give both new deposits a Well and a Lab of its own.'),
  say: (g) => {
    const spot = lineSpot(g);
    return spot && 'expand' in spot ? null : hint('Give each free deposit a Well and a Lab of its own.');
  },
  // Two such pairs on the second expansion's deposits, or five in all.
  done: (g) => wellLabs(g, depositsFrom(g, 1)) >= 2 || wellLabs(g) >= 5,
  when: (g) => has(g, 'R1'),
};

/**
 * What the Fabricator card's tune-up can put right, looking at the board only: a counted Well or machine that makes
 * more than everything it is wired to can take, so that it stands blocked part of the time and does not flow (the
 * press of Upgrade all on the Wells that the card before asks for leaves several like that).
 *  - `labs`: it feeds only Labs, they cannot study all of it, and Lab Speed is not researched: with it Labs study
 *    twice as fast.
 *  - `level`: it feeds only machines, and they run flat out: a level of Speed on the one whose next level is the
 *    cheapest (`speed`). `extra` is how much more of the material that level lets it take a second, and `flows`
 *    whether the producer then flows.
 * Of several outrun alike, the one of which the least is taken (by what the machines can take at their levels, not
 * by its utilisation of the moment, which wavers: two Wells equally outrun would take turns on the card), and the
 * older of two. null where nothing is outrun in that way. (A port that also sells, or feeds a Lab with room, is
 * never outrun: what the machines leave goes there. So this never asks for a raw Well to be wired to the Market,
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

/** Does this Well send what it gives to Labs and nowhere else? */
const feedsLabsOnly = (g: Game, n: GNode) => {
  const ws = graph(g).outs.get(n.id)?.[0] ?? [];
  return n.type === 'well' && !!n.material && ws.length > 0 && ws.every((w) => typeOf(g, w.to) === 'lab');
};

/** Refiners built on a Well that a Lab studies too: what the Fabricator card's tune-up has the player build. */
export function turnedRefiners(g: Game): GNode[] {
  const c = graph(g);
  return g.nodes.filter((n) => n.type === 'refiner' && !!recipeOf(n) && (c.ins.get(n.id) ?? []).some((w) => {
    const from = c.byId.get(w.from);
    return !!from && from.type === 'well' && (c.outs.get(from.id)?.[0] ?? []).some((x) => typeOf(g, x.to) === 'lab');
  }));
}

/**
 * The next gesture of "build a Refiner from a Well that only feeds a Lab, and sell its goods", looking at the
 * board only. First what a Refiner built that way still lacks: its product wired to the Market (`sell`), then a
 * Void for a by-product (`dump`: the Silt of an Ink Refiner). Then the next Well (`well`): one that sends what it
 * gives to Labs and nowhere else, for which a Refiner has a recipe, which gives at least what keeps that Refiner
 * flowing, and whose product the Markets would still buy at full price (so nothing here ever sells over demand).
 * The dearest product first. `gives` is that product, in items a second. null when there is nothing (more) to do.
 */
export type RefineStep =
  | { sell: GNode; port: number; mat: MatId; market: GNode }
  | { dump: GNode; port: number; mat: MatId }
  | { well: GNode; recipe: Recipe; out: MatId; gives: number };

export function refineNext(g: Game): RefineStep | null {
  const m = readsAt(g);
  if (m.refine === undefined) m.refine = findRefine(g);
  return m.refine;
}

function findRefine(g: Game): RefineStep | null {
  const c = graph(g);
  const market = g.nodes.find((x) => x.type === 'market') ?? null;
  if (!market || !nodeUnlocked(g, 'refiner')) return null;
  for (const n of turnedRefiners(g)) {
    const outs = recipeOf(n)!.outputs;
    for (let port = 0; port < outs.length; port++) {
      const mat = outs[port][0];
      if ((c.outs.get(n.id)?.[port] ?? []).length) continue;
      if (MATERIALS[mat].value >= RULES.orders.junkValue) return { sell: n, port, mat, market };
      if (nodeUnlocked(g, 'void')) return { dump: n, port, mat };
    }
  }
  let best: { well: GNode; recipe: Recipe; out: MatId; gives: number } | null = null;
  for (const n of g.nodes) {
    if (!feedsLabsOnly(g, n)) continue;
    const recipe = pickRecipe(g, 'refiner', [n.material!]);
    if (!recipe || recipe.inputs.length !== 1) continue;
    const takes = recipe.inputs[0][1] / recipe.time;
    const rate = wellRate(n);
    if (rate < RULES.flow.flowing * takes) continue;
    const [out, qty] = recipe.outputs[0];
    const gives = (Math.min(rate, takes) / recipe.inputs[0][1]) * qty;
    if ((g.soldRate[out] ?? 0) + gives > demandRate(g, out)) continue;
    if (!best || gives * valueOf(g, out) > best.gives * valueOf(g, best.out) + 1e-9) best = { well: n, recipe, out, gives };
  }
  return best;
}

/** The Fabricator still has to be saved for: none stands, and its price is not in hand. */
const savingForFabricator = (g: Game) => count(g, 'fabricator') === 0 && g.credits < nodeCost(g, 'fabricator');

/**
 * The tune-up before the Fabricator: one line whose words are its next step's own. The wait for the Fabricator's
 * price is the longest of the demo, and the board has two kinds of slack by then.
 *  - "The Murk Well outruns its Refiner: buy Speed on the Refiner (32¢)." The card before had every Well upgraded
 *    at once: a Well that feeds one machine and nothing else now makes more than that machine takes, stands blocked
 *    a fifth of the time, and Flow (which every sale is paid by) is down. A level of Speed on the machine puts it
 *    right (outrun); where it is Labs that a Well outruns, and Lab Speed is not researched, that research does.
 *  - "You have enough α: build a Refiner from a Well that only feeds a Lab, and sell its goods." Fabrication is the
 *    last research of the demo and its α is in hand: a Well that a Lab studies earns nothing toward the Fabricator.
 *    A Refiner built from its port takes what it needs first (machines are fed before Labs), the Lab keeps the
 *    rest, and the Spark, Ink or Shard is sold: nothing raw, and nothing over its demand (refineNext). Its product
 *    is wired to the Market, and an Ink Refiner's Silt gets a Void.
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
 * Glyph Assembler on arrival has.) After that one more may be short every RULES.flow.valveEvery seconds (all but
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
    hint: hint('Pick the Well in the build bar and click the free Glint deposit.', 'Tap Well in the build bar, then tap the free Glint deposit.'),
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
    // Done on the first Spark sold, not made: the sale is the last gesture of the hint, and a card that is ready
    // shows Claim and no hint. Made, it completed with the sale still to do, and the first order (which asks for
    // what is selling, the Spark most of all) waited on a Spark nobody sold.
    done: (g) => (g.sold.spark ?? 0) >= 1,
    ...buying((g) => rawLine(g, 'P3', 'ember', 'spark')),
    // The first long wait for α, and the Lab studies only half the Shard. Ink is the dearest thing on the board.
    // Then the credits that pile up meanwhile: the second Glint Well sells raw Glint at 1¢, and a Refiner of its
    // own with a Lab of its own turns it into Shard studied for 3 α. (Into the Lab the player has, it would fill
    // that Lab and leave no room for the Spark and the Glyph the next cards send there.)
    meanwhile: [
      {
        id: 'ink-lab',
        text: hint(
          'Drag from the Ink Refiner\'s Ink port to the Lab too: studied Ink is 3 α each.',
          'Tap the Ink Refiner\'s Ink port, then tap the Lab too: studied Ink is 3 α each.',
        ),
        done: (g) => studyWires(g, 'ink').length > 0,
        when: (g) => count(g, 'lab') > 0 && g.nodes.some((n) => n.recipe === 'ink'),
      },
      GLINT_LAB,
    ],
    reward: { a: 25, unlock: 'orders' },
    big: true,
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
    // Judged by what the Router sends, not only by how it is set: a Router turned toward a full Lab spills to the
    // Market, and the card said "more to a Lab" while more went to the Market.
    done: routerSendsLab,
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
    // Where the Assembler is built from is said: dragged out of the Ink port it arrives wired, set to Glyph.
    // The Market comes before the Spark: the goal completes with the first Glyph, the card then shows Claim
    // and no hint, and a player who had still to "sell its Glyph" never read that again (the Glyph sat
    // unsold until a tip said so, six minutes on).
    hint: hint('Research Assembly, build an Assembler from the Ink Refiner\'s Ink port, wire it to the Market, then wire Spark into it to make Glyph.'),
    done: (g) => made(g, 'glyph'),
    ...buying((g) => techThenNode(g, 'P4', 'assembler', 'glyph')),
    // The board has just grown by two deposits. A Well with a Lab of its own is 1 α a second for good: wired
    // into the Lab the player already has it would only push the dearer Shard and Ink (and later Glyph) aside.
    // Both deposits: with one pair this wait was still four and a half minutes for a player who gets no tip.
    // Then the board grows again (the second expansion, 500¢, which the credits saved meanwhile pay for) and
    // its two deposits get the same: two more α a second, where an upgrade would give a quarter.
    meanwhile: [
      {
        id: 'well-labs',
        text: hint('Give each new deposit a Well and a Lab built from its port: each pair is 1 α a second.'),
        // Two such pairs on the first expansion's deposits, or three in all (the Glint Well of the Spark card's line is one).
        done: (g) => wellLabs(g, depositsFrom(g, 0)) >= 2 || wellLabs(g) >= 3,
        when: (g) => wellLabs(g, depositsFrom(g, 0)) >= 2 || wellLabs(g) >= 3 || wellToPlace(g),
      },
      EXPAND_LABS,
    ],
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
    // The one change that puts a short producer right, named: a level of Speed on the Well or machine that feeds
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
        done: (g) => { const f = flowCount(g); return f.of > 0 && f.running === f.of; },
        when: (g) => { const f = flowCount(g); return (f.of > 0 && f.running === f.of) || !!flowFix(g); },
      },
    ],
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
    // On the first Mist sold, for the same reason as "Make your first Spark".
    done: (g) => (g.sold.mist ?? 0) >= 1,
    ...buying((g) => rawLine(g, 'P5', 'breeze', 'mist')),
    // The dearest research so far, and the Assembler now takes most of the Ink and Spark the Lab was studying.
    meanwhile: [
      // What was left of it on "Assemble your first Glyph", where the credits for the Assembler come first.
      // (A third expansion here was tried: its Murk deposit needs a Lab of 400¢ more, the research often came
      // first, and the line's 1,250¢ then bought a plot that nothing stood on.)
      EXPAND_LABS,
      // Then a level of Speed on each Well with a Lab of its own, and on that Lab where the Lab is what holds the
      // pair back: the pair studies a quarter more. By hand, a press each: the card after next hands over the
      // button that does a kind at once.
      {
        id: 'speed-pairs',
        text: hint('Buy Speed on each Well with a Lab of its own, and on that Lab when it is full.'),
        done: (g) => { const p = ownPairs(g); return p.length > 0 && p.every((x) => x.sped); },
        when: (g) => ownPairs(g).length >= 2,
      },
      // Then Lab Speed and Deep Analysis: every Lab gives half as much again, for the rest of this wait and every
      // one after it. The β it costs comes from the Glyph the card before had the player study; the Speed line comes
      // first so that it is in hand by then. (A fast player buys Deep Analysis too, but after Breeze Deposits: this
      // line is what the card-following player has instead of that player's upgrades. It is there for the pacing
      // rule: see the tech prices in src/content.ts.)
      {
        id: 'deep-analysis',
        text: hint('Research Lab Speed, then Deep Analysis: every item studied gives half as much Data again.'),
        done: (g) => has(g, 'R3'),
        when: (g) => has(g, 'R1'),
      },
    ],
    reward: { a: 50 },
  },
  {
    id: 'make-prism', title: 'Assemble your first Prism',
    // The Market before the Shard, for the same reason as on "Assemble your first Glyph".
    hint: hint('Build another Assembler from the Mist Refiner\'s port, wire it to the Market, then wire Shard into it to make Prism (two for every Mist).'),
    done: (g) => made(g, 'prism'),
    ...buying((g) => techThenNode(g, 'P5', 'assembler', 'prism')),
    // The Prism Assembler is saved for in credits, and the β for Fabrication is in hand by now (this goal and the
    // next pay what is still missing of it): the Glyph the Lab studies is worth more sold.
    meanwhile: [CUT_GLYPH],
    // Bulk Upgrade comes with it: the next card is about using it.
    reward: { credits: 600, b: 40, techs: ['S1'] },
    big: true,
  },
  {
    // (This used to be "Fill three orders", which the orders filled on the way had always met by the time it came
    // up: it showed Claim and nothing else.) One press, on a board of a dozen Wells, and the lesson of the tool
    // that saves a phone player a hundred presses from here on.
    id: 'bulk-upgrade', title: 'Upgrade all your Wells at once',
    hint: hint(
      'Select a Well and press Upgrade all beside Speed: every Well gets one level more.',
      'Tap a Well and tap Upgrade all beside Speed: every Well gets one level more.',
    ),
    done: bulkSince,
    ...buying((g) => (isFinite(cheapestWellSpeed(g)) ? price(cheapestWellSpeed(g), 'Upgrade all') : null)),
    reward: { credits: 1200, b: 60 },
  },
  {
    id: 'build-fabricator', title: 'Build a Fabricator',
    hint: hint('Research Fabrication, then save up and build a Fabricator from the Prism Assembler\'s port: orders and a high Flow get you there faster.'),
    done: (g) => count(g, 'fabricator') >= 1,
    ...buying((g) => (has(g, 'P7') ? price(nodeCost(g, 'fabricator'), THE.fabricator) : tech('P7', nodeCost(g, 'fabricator'), THE.fabricator))),
    // Goal 17 had the player study Glyph. Fabrication's β is in hand by now (the two goals before pay it), and
    // from here every Glyph in a Lab is 20¢ not earned toward the Fabricator. This is the one place the chain
    // takes a wire back, and it is a card that says so: the adviser never reverses a card (src/advice.ts).
    // It applies while the β is covered and the Fabricator's price is not: a player who already has the
    // credits (one who never spent any on upgrades) gains nothing by it, and is not asked.
    // (Its second line wired each Well with a Lab of its own to the Market too: four wires across the whole board at
    // minute 17, and a minute later the game said that what they sold went at a quarter of the price, as every
    // card player first sold over demand there. The Fabricator's price came down instead: docs/CONTENT.md.)
    // Then the tune-up, for the wait itself: the Wells that outrun their machines are put right (a level of Speed
    // each), and the Wells that only feed Labs get a Refiner whose goods are sold. Each step only while it pays for
    // itself before the Fabricator can be bought; nothing is sold raw or over its demand.
    meanwhile: [CUT_GLYPH, TUNE_UP],
    reward: { b: 40 },
  },
  {
    id: 'make-lens', title: 'Make your first Lens',
    hint: hint('Feed the Fabricator one Prism and two Glyph for every Lens.'),
    done: (g) => made(g, 'lens'),
    // The inputs the Fabricator has wired in, then the Lens itself.
    progress: (g) => {
      const feeds = lensFeeds(g);
      if (!feeds) return null;
      const fed = feeds.filter((x) => x.fed).length;
      return fed < feeds.length ? [fed, feeds.length, 'inputs wired'] : [0, 1, 'Lens'];
    },
    // A Fabricator built from the Prism Assembler's port, as the card before says, has its Prism and no Glyph:
    // the step left is a wire, and the card names it (one built anywhere else needs the Prism wired too).
    // They are the goal itself, not something to do while waiting (`required`): the card says "Next step".
    meanwhile: [
      {
        id: 'prism-fab',
        text: hint('Wire the Prism Assembler\'s port to the Fabricator: a Lens takes one Prism.'),
        done: (g) => lensFed(g, 'prism'),
        when: (g) => !!lensMaker(g),
        required: true,
      },
      {
        id: 'glyph-fab',
        text: hint('Wire the Glyph Assembler\'s port to the Fabricator: a Lens takes two Glyph.'),
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
    held?: { cost: number; sym: '¢' | 'α' | 'β' | 'γ'; eta: number };
  };
  /**
   * Only on "Make your first Lens", once there is a Fabricator: each input a Lens takes and whether it is wired
   * into that Fabricator, so the card can say "Prism ✓ · Glyph ✗" (the progress counts the same as "1 / 2 inputs wired").
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
  return {
    ...(goal.id === 'hold-flow' ? { flow: flowGoalView(g) } : {}),
    ...(at ? { meanwhile: lineView(g, at, touch) } : {}),
    ...(inputs ? { inputs } : {}),
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

/** The card's view of the line meanwhileAt(g) gives (GoalView.meanwhile). */
function lineView(g: Game, at: { line: Meanwhile; step: number; of: number }, touch: boolean): NonNullable<GoalView['meanwhile']> {
  const done = at.line.done(g);
  const held = done ? null : lineHeld(g);
  return {
    text: lineText(g, at.line, touch), done,
    ...(at.of > 1 ? { step: at.step, of: at.of } : {}),
    ...(at.line.required ? { required: true } : {}),
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
  const had = g.goalAt && g.goalAt.i === g.goal.i ? g.goalAt.had : undefined;
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
 * from the Refiner's port to an empty spot and pick Lab", the Refiner; for "Wire the Glyph Assembler's port
 * to the Fabricator", the Glyph Assembler and then the Fabricator. While the goal is a wait (or its hint has
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
 * The free deposit the active goal's hint asks for a Well on, while that is its next gesture (goalFocus is then
 * empty: a deposit is not a node): the Glint deposit of "Place a second Well", and the Murk, Ember or Breeze
 * deposit of a raw line ("Place a Well on the Murk deposit, then..."), once its research is done. null otherwise.
 */
export function goalDeposit(g: Game): number | null {
  const goal = activeGoal(g);
  if (!goal || g.goal.ready) return null;
  const raw: Partial<Record<string, [MatId, string | null]>> = {
    'second-well': ['glint', null], 'make-ink': ['murk', 'P2'], 'make-spark': ['ember', 'P3'], 'make-mist': ['breeze', 'P5'],
  };
  const want = raw[goal.id];
  if (!want || (want[1] && !has(g, want[1]))) return null;
  // (A Well already on that material: the hint has moved on to the Refiner, which goalFocus names.)
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
  /** "Put a Well on the deposit, build a Refiner from its port and sell what it makes." */
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
    case 'build-refiner': case 'upgrade-well': case 'bulk-upgrade': return ids(wells[0]);
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
    case 'route-lab': {
      const router = g.nodes.find((n) => n.type === 'router');
      return router ? ids(router, lab, market) : ids(maker('spark'));
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
  if (g.goal.i > GOALS.length) g.goal = { i: GOALS.length, ready: false };
  // Since when this goal has been the active one: set here for a save without it, or a goal set by hand. With it,
  // which of its lines are done already (in a save from before that was kept, too: what is done when the save is
  // loaded is not ticked off on the card as if it had just been done).
  if (!g.goalAt || g.goalAt.i !== g.goal.i) g.goalAt = { i: g.goal.i, t: g.time };
  if (!g.goalAt.had) g.goalAt.had = linesDone(g);
  // One of those that has been undone since (the player wired the Glyph back into a Lab; a producer stopped flowing)
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
  for (let i = from; i < g.goal.i; i++) applyUnlocks(g, GOALS[i].reward);
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
    // "Upgrade all your Wells at once".) Any other ready goal stays ready, whatever was taken apart since.
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
  // (Which of the next goal's lines are done already is noted by tickGoal below, once this reward's unlocks are in.)
  g.goalAt = { i: index + 1, t: g.time };
  // Rewards are not undoable, so neither is what earned them: undo stops at the last claim. (Undoing the step
  // a goal was for kept the reward, refunded the step, and could meet the next card for nothing.)
  if (!isLookahead(g)) clearHistory();
  g.events.push({ kind: 'goal-claimed', goal: goal.id, index, reward: r, big: !!goal.big, text: `${goal.title}: ${rewardText(r)}` });
  applyUnlocks(g, r);
  // A goal the player has already met is ready at once.
  tickGoal(g);
  return true;
}

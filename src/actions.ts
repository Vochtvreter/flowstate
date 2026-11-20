// Every change the player can make to the board. Board edits are undoable and refund in full;
// claiming a goal or an order (re-exported below) is not undoable.
import { EXPANSION_DEPOSITS, MATERIALS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, RULES, Recipe, Track } from './content';
import {
  buyBackPrice, cycleTime, expansionCost, has, materialsAt, matUnlocked, maxLevel, maxPipeTier, nodeCost, nodeCount, nodeUnlocked, pickRecipe,
  recipeOf, recipeUnlocked, trackAvailable, upgradeCost, upgradeValue,
} from './economy';
import { graph, isMachine, isPass, isSink, outPortCount } from './sim';
import { Game, GNode, RouterMode, Snapshot, Wire, cleanPins, isLookahead, makeNode, makeWire, nodeNoun, noteEdit, restore, shelve, snap, snapshot } from './state';

export { claimGoal } from './goals';
export { materialsAt, pickRecipe, recipesFor } from './economy';
import { GOALS } from './goals';
export { claimOrder } from './orders';

// ---------- undo ----------

interface UndoEntry { state: Snapshot; spent: number }
const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
let depth = 0;
let batchSpent = 0;

/** Run a mutation as one undo step. `fn` returns credits spent (negative = refund) or false to abort. */
export function act(g: Game, fn: () => number | false): boolean {
  if (depth > 0) {
    const r = fn();
    if (r === false) return false;
    batchSpent += r;
    g.rev++;
    return true;
  }
  const before = snapshot(g);
  depth++;
  batchSpent = 0;
  let r: number | false;
  try {
    r = fn();
  } finally {
    depth--;
  }
  if (r === false) {
    // A nested step may already have changed things: roll back.
    restore(g, before);
    g.credits += batchSpent;
    return false;
  }
  // The history is the live game's: a look-ahead copy (src/forecast.ts) changes, but leaves no step behind.
  if (!isLookahead(g)) {
    undoStack.push({ state: before, spent: r + batchSpent });
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }
  g.rev++;
  return true;
}

/** Same nodes and wires, give or take positions? Used to accept a "node moved" undo step. */
function sameStructure(g: Game, before: Snapshot): boolean {
  if (before.nodes.length !== g.nodes.length || before.wires.length !== g.wires.length) return false;
  if ((before.deposits && before.deposits.length !== g.deposits.length) || (before.board && before.board.expansions !== g.board.expansions)) return false;
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  for (const b of before.nodes) {
    const n = nodes.get(b.id);
    if (!n || n.type !== b.type || n.recipe !== b.recipe || n.lv.speed !== b.lv.speed || n.lv.eff !== b.lv.eff || n.lv.buffer !== b.lv.buffer) return false;
  }
  const wires = new Map(g.wires.map((w) => [w.id, w]));
  for (const b of before.wires) {
    const w = wires.get(b.id);
    if (!w || w.tier !== b.tier) return false;
  }
  return true;
}

/**
 * Record a free undo step for a change made outside act(): moving a node. `before` is the board before the move.
 * Ignored (returns false) if anything else changed since `before` was taken, e.g. the node was deleted mid-drag:
 * restoring that snapshot for free would hand back a node whose refund was already paid.
 */
export function pushUndo(g: Game, before: Snapshot): boolean {
  if (isLookahead(g) || !sameStructure(g, before)) return false;
  undoStack.push({ state: before, spent: 0 });
  redoStack.length = 0;
  return true;
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function undo(g: Game): boolean {
  const e = undoStack[undoStack.length - 1];
  if (!e || isLookahead(g)) return false;
  // Undoing a delete takes its refund back: refuse if that refund has been spent.
  if (g.credits + e.spent < -1e-6) {
    g.events.push({ kind: 'toast', text: 'Not enough credits to undo that' });
    return false;
  }
  undoStack.pop();
  redoStack.push({ state: snapshot(g), spent: e.spent });
  restore(g, e.state);
  g.credits += e.spent;
  noteEdit(g, 'edit');
  unready(g);
  return true;
}

/**
 * A goal waiting for its Claim whose condition an undo has just taken away is not ready any more: the reward
 * is for what is on the board. (Goals counted by events, a Phone made or seconds of Flow held, keep theirs.)
 */
function unready(g: Game) {
  const goal = GOALS[g.goal.i];
  if (g.goal.ready && goal && !goal.done(g)) g.goal.ready = false;
}

export function redo(g: Game): boolean {
  const e = redoStack[redoStack.length - 1];
  if (!e || isLookahead(g)) return false;
  if (e.spent > g.credits + 1e-6) {
    g.events.push({ kind: 'toast', text: 'Not enough credits to redo that' });
    return false;
  }
  redoStack.pop();
  undoStack.push({ state: snapshot(g), spent: e.spent });
  restore(g, e.state);
  g.credits -= e.spent;
  noteEdit(g, 'edit');
  return true;
}

export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
}

// ---------- queries ----------

export const nodeById = (g: Game, id: number) => graph(g).byId.get(id) ?? null;

export function freeDeposits(g: Game) {
  const used = new Set(g.nodes.map((n) => n.depositId).filter((d) => d != null));
  return g.deposits.filter((d) => !used.has(d.id) && matUnlocked(g, d.mat));
}

/** The last Drill can never be deleted: with no Drill and no credits the save would be stuck. */
export function canDelete(g: Game, n: GNode): boolean {
  return n.type !== 'well' || nodeCount(g, 'well') > 1;
}

/**
 * Credits returned for deleting a node: what it would cost to buy it back, plus its upgrades and the
 * upgrades on its wires. Deleting and re-placing always nets to zero. 0 for a node that cannot be deleted.
 * A node from a save of the public version, which charged less, never refunds more than it cost there and
 * since (GNode.legacyPaid): otherwise deleting it paid four to ten times its price.
 */
export function refundOf(g: Game, n: GNode): number {
  if (!canDelete(g, n)) return 0;
  let r = buyBackPrice(g, n.type) + upgradeValue(n);
  if (n.legacyPaid != null) r = Math.min(r, n.legacyPaid);
  for (const w of g.wires) if (w.from === n.id || w.to === n.id) r += w.paid;
  return r;
}

// ---------- node actions ----------

export interface PlaceOpts { recipe?: string | null; depositId?: number }

// What each kind of change is noted as (noteEdit): the adviser builds the same words for what a tip would do,
// and so knows a tip that would only repeat what the player has just done.
export const buildNote = (type: NodeType, material: MatId | null) => `build:${type}${material ? ':' + material : ''}`;
export const upgradeNote = (n: GNode, track: Track) => `upgrade:${track}:${nodeNoun(n)}`;
export const upgradeAllNote = (type: NodeType, track: Track) => `upgrade-all:${track}:${type}`;
export const wireNote = (from: GNode, to: GNode) => `wire:${nodeNoun(from)}>${nodeNoun(to)}`;
export const cutNote = (from: GNode, to: GNode) => `cut:${nodeNoun(from)}>${nodeNoun(to)}`;
export const favourNote = (to: GNode) => `favour:${nodeNoun(to)}`;

export function placeNode(g: Game, type: NodeType, x: number, y: number, opts: PlaceOpts = {}): GNode | null {
  if (!nodeUnlocked(g, type)) return null;
  const cost = nodeCost(g, type);
  if (cost > g.credits + 1e-6) return null;
  let node: GNode | null = null;
  const ok = act(g, () => {
    const n = makeNode(g, type, snap(x), snap(y));
    if (type === 'well') {
      const dep = g.deposits.find((d) => d.id === opts.depositId);
      if (!dep || g.nodes.some((o) => o.depositId === dep.id) || !matUnlocked(g, dep.mat)) return false;
      n.depositId = dep.id;
      n.material = dep.mat;
      n.x = dep.x;
      n.y = dep.y;
    }
    // A recipe that is not researched yet is ignored: the machine is placed without one.
    const r = opts.recipe ? RECIPES[opts.recipe] : null;
    if (r && r.machine === type && recipeUnlocked(g, r)) n.recipe = r.id;
    n.paid = cost;
    g.credits -= cost;
    g.nodes.push(n);
    node = n;
    return cost;
  });
  if (ok) {
    g.stats.nodesBuilt++;
    noteEdit(g, buildNote(type, (node as GNode | null)?.material ?? null));
  }
  return ok ? node : null;
}

export function deleteNode(g: Game, id: number): boolean {
  const n = nodeById(g, id);
  if (!n) return false;
  if (!canDelete(g, n)) {
    g.events.push({ kind: 'toast', text: 'You need at least one Drill' });
    return false;
  }
  const ok = act(g, () => {
    const refund = refundOf(g, n);
    g.wires = g.wires.filter((w) => w.from !== id && w.to !== id);
    g.nodes = g.nodes.filter((o) => o.id !== id);
    shelve(g, n); // an undo brings it back as it was, contents and age included
    g.credits += refund;
    return -refund;
  });
  if (ok) noteEdit(g, 'edit');
  return ok;
}

export function upgrade(g: Game, id: number, track: Track): boolean {
  const n = nodeById(g, id);
  if (!n || !trackAvailable(g, n, track) || n.lv[track] >= maxLevel(g, track)) return false;
  const cost = upgradeCost(n, track);
  if (cost > g.credits + 1e-6) return false;
  const ok = act(g, () => {
    n.lv[track]++;
    n.paid += cost;
    if (n.legacyPaid != null) n.legacyPaid += cost;
    g.credits -= cost;
    return cost;
  });
  if (ok) noteEdit(g, upgradeNote(n, track));
  return ok;
}

/** Upgrade every node of the same type by one level on a track, cheapest first, while credits last. */
export function upgradeAll(g: Game, type: NodeType, track: Track): number {
  let count = 0;
  act(g, () => {
    const nodes = g.nodes.filter((n) => n.type === type).sort((a, b) => a.lv[track] - b.lv[track]);
    for (const n of nodes) if (upgrade(g, n.id, track)) count++;
    return count ? 0 : false;
  });
  if (count) {
    noteEdit(g, upgradeAllNote(type, track));
    // "Speed up every Drill at once" (goal 20) counts a press that raised Drills, and no other kind. The time is
    // part of the undo step (state.ts snapshot), so an undo of the press takes the goal's readiness back with it.
    if (type === 'well') g.bulkAt = g.time;
  }
  return count;
}

export function setRecipe(g: Game, id: number, recipeId: string): boolean {
  const n = nodeById(g, id);
  const r = RECIPES[recipeId];
  if (!n || !r || r.machine !== n.type || !recipeUnlocked(g, r) || n.recipe === recipeId) return false;
  return act(g, () => {
    let refund = 0;
    g.wires = g.wires.filter((w) => {
      if (w.from === id && w.port >= r.outputs.length) {
        refund += w.paid;
        return false;
      }
      return true;
    });
    shelve(g, { ...n, inb: { ...n.inb }, outb: { ...n.outb } }); // so that an undo is exact
    n.recipe = recipeId;
    n.inb = {};
    n.outb = {};
    n.crafting = false;
    n.prog = 0;
    n.grace = 6;
    n.born = g.time; // a re-tooled machine is new again as far as Flow is concerned
    g.credits += refund;
    noteEdit(g, 'edit');
    return -refund;
  });
}

export function setMode(g: Game, id: number, mode: RouterMode): boolean {
  const n = nodeById(g, id);
  if (!n || n.type !== 'router' || n.mode === mode) return false;
  return act(g, () => {
    n.mode = mode;
    noteEdit(g, 'edit');
    return 0;
  });
}

export function setWeight(g: Game, wireId: number, weight: number): boolean {
  const w = g.wires.find((x) => x.id === wireId);
  if (!w) return false;
  return act(g, () => {
    w.weight = Math.max(0, Math.min(99, Math.round(weight)));
    noteEdit(g, 'edit');
    return 0;
  });
}

/**
 * Set the pins a wire runs by (src/ui/wires.ts), or with an empty list take them all off. Only how the wire is
 * drawn: no rule reads a pin. One undo step; false when the wire is not there or nothing would change.
 */
export function setPins(g: Game, wireId: number, pins: { x: number; y: number }[]): boolean {
  const w = g.wires.find((x) => x.id === wireId);
  if (!w) return false;
  const next = cleanPins(pins, g.board);
  const was = w.pins ?? [];
  if (next.length === was.length && next.every((p, i) => p.x === was[i].x && p.y === was[i].y)) return false;
  return act(g, () => {
    if (next.length) w.pins = next;
    else delete w.pins;
    return 0;
  });
}

/** Take every pin off every wire, as part of a step that is already being taken (Tidy: the cards the pins were set round have moved). Returns how many wires had some. */
export function dropPins(g: Game): number {
  let n = 0;
  for (const w of g.wires) {
    if (!w.pins?.length) continue;
    delete w.pins;
    n++;
  }
  return n;
}

export function setFilter(g: Game, wireId: number, filter: MatId | null): boolean {
  const w = g.wires.find((x) => x.id === wireId);
  if (!w) return false;
  return act(g, () => {
    w.filter = filter;
    noteEdit(g, 'edit');
    return 0;
  });
}

/** The wires leaving a Router, in priority order. */
const routerWires = (g: Game, routerId: number): Wire[] => graph(g).outs.get(routerId)?.[0] ?? [];

/**
 * The wire a Router currently favours, or null when it treats its wires alike:
 * in Ratio mode the one wire with the biggest weight, in Priority mode the first wire. Even and Filter favour none.
 */
export function favouredWire(g: Game, routerId: number): number | null {
  const n = nodeById(g, routerId);
  const wires = routerWires(g, routerId);
  if (!n || n.type !== 'router' || wires.length < 2) return null;
  if (n.mode === 'priority') return wires[0].id;
  if (n.mode !== 'ratio') return null;
  let best: Wire | null = null;
  let tied = false;
  for (const w of wires) {
    if (!best || w.weight > best.weight) {
      best = w;
      tied = false;
    } else if (w.weight === best.weight) tied = true;
  }
  return best && !tied && best.weight > 0 ? best.id : null;
}

/** Would favour() change anything? The wire must leave this Router, which needs a second wire to favour it over. */
export function canFavour(g: Game, routerId: number, wireId: number): boolean {
  const n = nodeById(g, routerId);
  const wires = routerWires(g, routerId);
  if (!n || n.type !== 'router' || wires.length < 2 || !wires.some((w) => w.id === wireId)) return false;
  const F = RULES.router;
  return n.mode !== 'ratio' || wires.some((w) => w.weight !== (w.id === wireId ? F.favour : F.rest));
}

/**
 * The one-press Router preset: Ratio mode, weighted 3 : 1 toward this wire (RULES.router; every other wire
 * of the Router gets the 1). One undo step. Returns false when the Router already stands that way.
 */
export function favour(g: Game, routerId: number, wireId: number): boolean {
  if (!canFavour(g, routerId, wireId)) return false;
  const n = nodeById(g, routerId)!;
  const wires = routerWires(g, routerId);
  const to = nodeById(g, wires.find((w) => w.id === wireId)!.to);
  return act(g, () => {
    n.mode = 'ratio';
    for (const w of wires) w.weight = w.id === wireId ? RULES.router.favour : RULES.router.rest;
    noteEdit(g, to ? favourNote(to) : 'edit');
    return 0;
  });
}

/** Move a wire earlier in its router's priority order. */
export function raisePriority(g: Game, wireId: number): boolean {
  const i = g.wires.findIndex((x) => x.id === wireId);
  if (i < 0) return false;
  const w = g.wires[i];
  let j = -1;
  for (let k = i - 1; k >= 0; k--) if (g.wires[k].from === w.from && g.wires[k].port === w.port) { j = k; break; }
  if (j < 0) return false;
  return act(g, () => {
    [g.wires[i], g.wires[j]] = [g.wires[j], g.wires[i]];
    noteEdit(g, 'edit');
    return 0;
  });
}

/** Set a router's weights to what each destination can actually consume. */
export function autoBalance(g: Game, id: number): boolean {
  const n = nodeById(g, id);
  if (!n || n.type !== 'router' || !has(g, 'S3')) return false;
  const wires = g.wires.filter((w) => w.from === id);
  if (!wires.length) return false;
  const mats = materialsAt(g, id);
  return act(g, () => {
    const needs = wires.map((w) => {
      const d = nodeById(g, w.to)!;
      const r = recipeOf(d);
      if (!r) return 1;
      let need = 0;
      for (const [m, q] of r.inputs) if (mats.includes(m)) need += q / cycleTime(d, r);
      return need || 1;
    });
    const min = Math.min(...needs);
    wires.forEach((w, i) => (w.weight = Math.max(1, Math.round(needs[i] / min))));
    n.mode = 'ratio';
    noteEdit(g, 'edit');
    return 0;
  });
}

// ---------- wires ----------

export function canConnect(g: Game, fromId: number, port: number, toId: number): boolean {
  const a = nodeById(g, fromId);
  const b = nodeById(g, toId);
  if (!a || !b || a === b) return false;
  if (isSink(a) || b.type === 'well') return false;
  if (port >= outPortCount(a)) return false;
  if (g.wires.some((w) => w.from === fromId && w.port === port && w.to === toId)) return false;
  return true;
}

export function connect(g: Game, fromId: number, port: number, toId: number): Wire | null {
  if (!canConnect(g, fromId, port, toId)) return null;
  let wire: Wire | null = null;
  act(g, () => {
    const b = nodeById(g, toId)!;
    if (isMachine(b) && !b.recipe) {
      const r = pickRecipe(g, b.type, materialsAt(g, fromId, port));
      if (r) {
        b.recipe = r.id;
        b.born = g.time; // it only becomes a working machine now: Flow gives it the usual head start
      }
    }
    wire = makeWire(g, fromId, port, toId);
    g.wires.push(wire);
    b.grace = Math.max(b.grace, 5);
    const a = nodeById(g, fromId)!;
    a.grace = Math.max(a.grace, 3);
    a.fBlocked = 0;
    noteEdit(g, wireNote(a, b));
    return 0;
  });
  if (wire) g.stats.wiresMade++;
  return wire;
}

export function cutWire(g: Game, id: number): boolean {
  const w = g.wires.find((x) => x.id === id);
  if (!w) return false;
  const from = nodeById(g, w.from);
  const to = nodeById(g, w.to);
  return act(g, () => {
    g.wires = g.wires.filter((x) => x.id !== id);
    g.credits += w.paid;
    noteEdit(g, from && to ? cutNote(from, to) : 'edit');
    return -w.paid;
  });
}

export function cutWires(g: Game, ids: number[]): boolean {
  if (!ids.length) return false;
  return act(g, () => {
    for (const id of ids) cutWire(g, id);
    return 0;
  });
}

export function upgradeWire(g: Game, id: number): boolean {
  const w = g.wires.find((x) => x.id === id);
  if (!w || w.tier >= maxPipeTier(g)) return false;
  const cost = PIPES[w.tier + 1].cost;
  if (cost > g.credits + 1e-6) return false;
  return act(g, () => {
    w.tier++;
    w.paid += cost;
    g.credits -= cost;
    noteEdit(g, 'edit');
    return cost;
  });
}

/** Upgrade every wire running at (or near) capacity by one tier. Returns how many were upgraded. */
export function upgradeSaturatedWires(g: Game): number {
  let count = 0;
  act(g, () => {
    for (const w of g.wires) if (w.rate >= PIPES[w.tier].cap * 0.97 && upgradeWire(g, w.id)) count++;
    return count ? 0 : false;
  });
  return count;
}

/**
 * Drop an existing, unconnected node onto a wire.
 * A Market, Lab or Dump becomes a branch: the wire stays and a new one runs from the same port to the sink.
 * Anything else is inserted into the wire; both halves keep the wire's tier and share what was paid for it.
 */
export function splice(g: Game, wireId: number, nodeId: number): boolean {
  const w = g.wires.find((x) => x.id === wireId);
  const n = nodeById(g, nodeId);
  if (!w || !n || n.type === 'well') return false;
  if (g.wires.some((x) => x.from === nodeId || x.to === nodeId)) return false;
  return act(g, () => {
    const { from, port, to, tier, paid } = w;
    if (isSink(n)) return connect(g, from, port, nodeId) ? 0 : false;
    g.wires = g.wires.filter((x) => x.id !== wireId);
    g.rev++;
    const a = connect(g, from, port, nodeId);
    if (!a) return false;
    g.rev++;
    const b = connect(g, nodeId, 0, to);
    if (!b) return false;
    a.tier = b.tier = tier;
    a.paid = Math.ceil(paid / 2);
    b.paid = paid - a.paid;
    return 0;
  });
}

// ---------- board ----------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Buy the board's next plot and its deposits. One undo step, refunded in full: the plot and its deposits go
 * again, as long as nothing placed since stands in the way (those steps are undone first, being later ones).
 */
export function expandBoard(g: Game): boolean {
  const cost = expansionCost(g);
  if (cost > g.credits + 1e-6) return false;
  return act(g, () => {
    grow(g, cost);
    return cost;
  });
}

function grow(g: Game, cost: number) {
  g.credits -= cost;
  const n = g.board.expansions;
  const mats = EXPANSION_DEPOSITS[n % EXPANSION_DEPOSITS.length];
  const rand = rng(n * 7919 + 13);
  const wide = n % 2 === 0;
  const strip = wide
    ? { x: g.board.w, y: 0, w: 400, h: g.board.h }
    : { x: 0, y: g.board.h, w: g.board.w, h: 320 };
  mats.forEach((mat, i) => {
    // One deposit per slice of the new strip, so they never overlap.
    const fx = wide ? rand() : (i + rand() * 0.6 + 0.2) / mats.length;
    const fy = wide ? (i + rand() * 0.6 + 0.2) / mats.length : rand();
    g.deposits.push({
      id: g.nextId++,
      x: snap(strip.x + 40 + fx * (strip.w - 240)),
      y: snap(strip.y + 40 + fy * (strip.h - 160)),
      mat,
    });
  });
  if (wide) g.board.w += 400;
  else g.board.h += 320;
  g.board.expansions++;
  g.rev++;
  noteEdit(g, 'edit');
}

export const defOf = (n: GNode) => NODE_DEFS[n.type];

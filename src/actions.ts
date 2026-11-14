// Every change the player can make to the board. Board edits are undoable and refund in full;
// claiming a goal or an order (re-exported below) is not undoable.
import { EXPANSION_DEPOSITS, MATERIALS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, Recipe, Track } from './content';
import {
  buyBackPrice, cycleTime, expansionCost, has, matUnlocked, maxLevel, maxPipeTier, nodeCost, nodeCount, nodeUnlocked, recipeOf,
  recipeUnlocked, trackAvailable, upgradeCost, upgradeValue,
} from './economy';
import { graph, isMachine, isPass, isSink, outPortCount } from './sim';
import { Game, GNode, RouterMode, Snapshot, Wire, makeNode, makeWire, restore, shelve, snap, snapshot } from './state';

export { claimGoal } from './goals';
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
  undoStack.push({ state: before, spent: r + batchSpent });
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  g.rev++;
  return true;
}

/** Same nodes and wires, give or take positions? Used to accept a "node moved" undo step. */
function sameStructure(g: Game, before: Snapshot): boolean {
  if (before.nodes.length !== g.nodes.length || before.wires.length !== g.wires.length) return false;
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
  if (!sameStructure(g, before)) return false;
  undoStack.push({ state: before, spent: 0 });
  redoStack.length = 0;
  return true;
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function undo(g: Game): boolean {
  const e = undoStack[undoStack.length - 1];
  if (!e) return false;
  // Undoing a delete takes its refund back: refuse if that refund has been spent.
  if (g.credits + e.spent < -1e-6) {
    g.events.push({ kind: 'toast', text: 'Not enough credits to undo that' });
    return false;
  }
  undoStack.pop();
  redoStack.push({ state: snapshot(g), spent: e.spent });
  restore(g, e.state);
  g.credits += e.spent;
  return true;
}

export function redo(g: Game): boolean {
  const e = redoStack[redoStack.length - 1];
  if (!e) return false;
  if (e.spent > g.credits + 1e-6) {
    g.events.push({ kind: 'toast', text: 'Not enough credits to redo that' });
    return false;
  }
  redoStack.pop();
  undoStack.push({ state: snapshot(g), spent: e.spent });
  restore(g, e.state);
  g.credits -= e.spent;
  return true;
}

export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
}

// ---------- queries ----------

export const nodeById = (g: Game, id: number) => graph(g).byId.get(id) ?? null;

/** Materials that can come out of a node's output port, following pass-through nodes upstream. */
export function materialsAt(g: Game, id: number, port = 0, seen = new Set<number>()): MatId[] {
  const n = nodeById(g, id);
  if (!n || seen.has(id)) return [];
  seen.add(id);
  if (n.type === 'well') return n.material ? [n.material] : [];
  if (isMachine(n)) {
    const m = recipeOf(n)?.outputs[port]?.[0];
    return m ? [m] : [];
  }
  if (isPass(n)) {
    const out = new Set<MatId>();
    for (const w of graph(g).ins.get(id) ?? []) for (const m of materialsAt(g, w.from, w.port, seen)) out.add(m);
    return [...out];
  }
  return [];
}

export function recipesFor(g: Game, type: NodeType): Recipe[] {
  return Object.values(RECIPES).filter((r) => r.machine === type && recipeUnlocked(g, r));
}

/** Best unlocked recipe for a machine type that uses any of the given materials. */
export function pickRecipe(g: Game, type: NodeType, mats: MatId[]): Recipe | null {
  const fits = recipesFor(g, type).filter((r) => r.inputs.some((i) => mats.includes(i[0])));
  fits.sort((a, b) => MATERIALS[b.outputs[0][0]].value - MATERIALS[a.outputs[0][0]].value);
  return fits[0] ?? null;
}

export function freeDeposits(g: Game) {
  const used = new Set(g.nodes.map((n) => n.depositId).filter((d) => d != null));
  return g.deposits.filter((d) => !used.has(d.id) && matUnlocked(g, d.mat));
}

/** The last Well can never be deleted: with no Well and no credits the save would be stuck. */
export function canDelete(g: Game, n: GNode): boolean {
  return n.type !== 'well' || nodeCount(g, 'well') > 1;
}

/**
 * Credits returned for deleting a node: what it would cost to buy it back, plus its upgrades and the
 * upgrades on its wires. Deleting and re-placing always nets to zero. 0 for a node that cannot be deleted.
 */
export function refundOf(g: Game, n: GNode): number {
  if (!canDelete(g, n)) return 0;
  let r = buyBackPrice(g, n.type) + upgradeValue(n);
  for (const w of g.wires) if (w.from === n.id || w.to === n.id) r += w.paid;
  return r;
}

// ---------- node actions ----------

export interface PlaceOpts { recipe?: string | null; depositId?: number }

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
  if (ok) g.stats.nodesBuilt++;
  return ok ? node : null;
}

export function deleteNode(g: Game, id: number): boolean {
  const n = nodeById(g, id);
  if (!n) return false;
  if (!canDelete(g, n)) {
    g.events.push({ kind: 'toast', text: 'You need at least one Well' });
    return false;
  }
  return act(g, () => {
    const refund = refundOf(g, n);
    g.wires = g.wires.filter((w) => w.from !== id && w.to !== id);
    g.nodes = g.nodes.filter((o) => o.id !== id);
    shelve(g, n); // an undo brings it back as it was, contents and age included
    g.credits += refund;
    return -refund;
  });
}

export function upgrade(g: Game, id: number, track: Track): boolean {
  const n = nodeById(g, id);
  if (!n || !trackAvailable(g, n, track) || n.lv[track] >= maxLevel(g, track)) return false;
  const cost = upgradeCost(n, track);
  if (cost > g.credits + 1e-6) return false;
  return act(g, () => {
    n.lv[track]++;
    n.paid += cost;
    g.credits -= cost;
    return cost;
  });
}

/** Upgrade every node of the same type by one level on a track, cheapest first, while credits last. */
export function upgradeAll(g: Game, type: NodeType, track: Track): number {
  let count = 0;
  act(g, () => {
    const nodes = g.nodes.filter((n) => n.type === type).sort((a, b) => a.lv[track] - b.lv[track]);
    for (const n of nodes) if (upgrade(g, n.id, track)) count++;
    return count ? 0 : false;
  });
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
    return -refund;
  });
}

export function setMode(g: Game, id: number, mode: RouterMode): boolean {
  const n = nodeById(g, id);
  if (!n || n.type !== 'router' || n.mode === mode) return false;
  return act(g, () => {
    n.mode = mode;
    return 0;
  });
}

export function setWeight(g: Game, wireId: number, weight: number): boolean {
  const w = g.wires.find((x) => x.id === wireId);
  if (!w) return false;
  return act(g, () => {
    w.weight = Math.max(0, Math.min(99, Math.round(weight)));
    return 0;
  });
}

export function setFilter(g: Game, wireId: number, filter: MatId | null): boolean {
  const w = g.wires.find((x) => x.id === wireId);
  if (!w) return false;
  return act(g, () => {
    w.filter = filter;
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
    return 0;
  });
  if (wire) g.stats.wiresMade++;
  return wire;
}

export function cutWire(g: Game, id: number): boolean {
  const w = g.wires.find((x) => x.id === id);
  if (!w) return false;
  return act(g, () => {
    g.wires = g.wires.filter((x) => x.id !== id);
    g.credits += w.paid;
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
 * A Market, Lab or Void becomes a branch: the wire stays and a new one runs from the same port to the sink.
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

export function expandBoard(g: Game): boolean {
  const cost = expansionCost(g);
  if (cost > g.credits + 1e-6) return false;
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
  return true;
}

export const defOf = (n: GNode) => NODE_DEFS[n.type];

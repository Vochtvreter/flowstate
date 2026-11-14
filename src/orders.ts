// Orders (docs/PITCH_PLAN.md 2.5). DOM-free. Numbers are in RULES.orders (src/content.ts).
//
// Once unlocked (g.ordersOn, a goal reward) there is always exactly one order: "deliver `need` of `mat`",
// counted from items sold at any Market after the order appeared. No timer and no failure. A filled order
// waits for claimOrder(g), which pays it and rolls the next one. An order nobody delivers to for
// RULES.orders.staleSeconds is quietly replaced by one for a different material.
//
// Generation uses only g.orderSeed (saved with the game), never Math.random, so the same play gives the
// same orders.
import { DATA_WORTH, DATA_YIELD, DataTier, MATERIALS, MAT_IDS, MatId, RULES, TECHS } from './content';
import { recipeOf, techAvailable, techHidden, valueOf } from './economy';
import { isMachine } from './graph';
import { Bag, Game, Order, Reward } from './state';

const O = RULES.orders;
const TIERS: DataTier[] = ['a', 'b', 'g'];

/** Next pseudo-random number in [0, 1), advancing the saved seed. */
function rand(g: Game): number {
  g.orderSeed = (Math.imul(g.orderSeed >>> 0, 1664525) + 1013904223) >>> 0;
  return g.orderSeed / 4294967296;
}

/** Items per second of each material coming out of Wells and machines right now. */
export function outputRates(g: Game): Bag {
  const out: Bag = {};
  for (const n of g.nodes) {
    if (n.type === 'well') {
      if (n.material) out[n.material] = (out[n.material] ?? 0) + n.rate;
    } else if (isMachine(n)) {
      const r = recipeOf(n);
      if (!r) continue;
      for (const [m, q] of r.outputs) out[m] = (out[m] ?? 0) + (n.rate * q) / r.outputs[0][1];
    }
  }
  return out;
}

/** Has the player ever made something a Lab turns into this Data tier? Orders never pay a tier the player has not met. */
function tierKnown(g: Game, tier: DataTier): boolean {
  return tier === 'a' || MAT_IDS.some((m) => g.made[m] && DATA_YIELD[MATERIALS[m].tier].tier === tier);
}

/**
 * The Data tier the player is shortest of: the one with the most missing, by worth, across the techs
 * that can be researched now; failing that, across everything not yet owned. null = nothing left to buy.
 */
export function neededTier(g: Game): DataTier | null {
  const pick = (onlyAvailable: boolean): DataTier | null => {
    const missing: Record<DataTier, number> = { a: 0, b: 0, g: 0 };
    for (const t of Object.values(TECHS)) {
      if (g.techs.includes(t.id) || t.auto || techHidden(g, t)) continue;
      if (onlyAvailable && !techAvailable(g, t)) continue;
      for (const k of TIERS) missing[k] += Math.max(0, (t.cost[k] ?? 0) - (onlyAvailable ? g.data[k] : 0)) * DATA_WORTH[k];
    }
    let best: DataTier | null = null;
    for (const k of TIERS) if (tierKnown(g, k) && missing[k] > 0 && (!best || missing[k] > missing[best])) best = k;
    return best;
  };
  return pick(true) ?? pick(false);
}

/** What an order for `need` of `mat` pays: mostly Data of the tier the player needs next, plus some credits. */
export function orderReward(g: Game, mat: MatId, need: number): Required<Reward> {
  const reward = { credits: 0, a: 0, b: 0, g: 0 };
  const worth = need * valueOf(g, mat);
  const tier = neededTier(g);
  if (tier) {
    const y = DATA_YIELD[MATERIALS[mat].tier];
    reward[tier] = Math.max(1, Math.round((need * y.amount * DATA_WORTH[y.tier] * O.dataShare) / DATA_WORTH[tier]));
  }
  reward.credits = Math.max(1, Math.round(worth * (tier ? O.creditShare : O.creditShareNoData)));
  return reward;
}

/** Materials an order may ask for, newest first: what the player makes right now, raw materials and junk last. */
export function orderCandidates(g: Game): MatId[] {
  const rates = outputRates(g);
  const newest = (a: MatId, b: MatId) =>
    (g.madeAt[b] ?? 0) - (g.madeAt[a] ?? 0) || MATERIALS[b].tier - MATERIALS[a].tier || MATERIALS[b].value - MATERIALS[a].value;
  const wanted = (m: MatId) => MATERIALS[m].value >= O.junkValue;
  const producing = MAT_IDS.filter((m) => wanted(m) && (rates[m] ?? 0) >= O.minRate);
  // Prefer refined goods; fall back to raw materials, then to anything ever made.
  const refined = producing.filter((m) => MATERIALS[m].tier >= 1);
  const pool = refined.length ? refined : producing.length ? producing : MAT_IDS.filter((m) => wanted(m) && g.made[m]);
  return (pool.length ? pool : (['glint'] as MatId[])).sort(newest);
}

/** Build the next order. `avoid` is the material of the order being replaced, skipped when there is a choice. */
export function makeOrder(g: Game, avoid: MatId | null = null): Order {
  let pool = orderCandidates(g);
  if (avoid && pool.length > 1) pool = pool.filter((m) => m !== avoid);
  // Weighted pick over the newest few.
  const weights = O.pick.slice(0, pool.length);
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rand(g) * total;
  let mat = pool[0];
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) {
      mat = pool[i];
      break;
    }
  }
  const seconds = O.minSeconds + (O.maxSeconds - O.minSeconds) * rand(g);
  let need = Math.max(O.minNeed, Math.round((outputRates(g)[mat] ?? 0) * seconds));
  if (need > 20) need = Math.round(need / 5) * 5; // a tidy number to read
  return {
    mat, need, base: g.sold[mat] ?? 0, got: 0,
    reward: orderReward(g, mat, need),
    created: g.time, lastProgress: g.time, ready: false,
  };
}

const orderText = (o: Order) => `Deliver ${o.need} ${MATERIALS[o.mat].name}`;

function roll(g: Game, avoid: MatId | null, quiet: boolean) {
  const order = makeOrder(g, avoid);
  g.order = order;
  g.events.push({ kind: 'order-new', order, quiet, text: `New order: ${orderText(order)}` });
}

/** Make sure an order exists. Called when Orders are unlocked. */
export function startOrders(g: Game) {
  if (g.ordersOn && !g.order) roll(g, null, false);
}

/** Count deliveries, mark the order filled, and replace a stale one. Called every tick. */
export function tickOrders(g: Game) {
  if (!g.ordersOn) return;
  const o = g.order;
  if (!o) return roll(g, null, false);
  if (o.ready) return;
  const got = Math.min(o.need, Math.max(0, (g.sold[o.mat] ?? 0) - o.base));
  if (got > o.got + 1e-9) {
    o.got = got;
    o.lastProgress = g.time;
  }
  if (o.got >= o.need - 1e-9) {
    o.got = o.need;
    o.ready = true;
    g.events.push({ kind: 'order-ready', order: o, text: `Order filled: ${orderText(o)}` });
  } else if (g.time - o.lastProgress >= O.staleSeconds) roll(g, o.mat, true);
}

/** Pay out the filled order and roll the next one. Returns false when there is nothing to claim. */
export function claimOrder(g: Game): boolean {
  const o = g.order;
  if (!g.ordersOn || !o || !o.ready) return false;
  const r = o.reward;
  g.credits += r.credits;
  g.lifetime += r.credits;
  g.stats.fromOrders += r.credits;
  g.data.a += r.a;
  g.data.b += r.b;
  g.data.g += r.g;
  g.stats.ordersFilled++;
  g.events.push({ kind: 'order-claimed', order: o, reward: r, text: `Order delivered: ${orderText(o)}` });
  roll(g, null, false);
  return true;
}

/** Progress of the active order, for the order chip. null when there is none. */
export function orderView(g: Game): { order: Order; name: string; got: number; need: number; ready: boolean; reward: Required<Reward> } | null {
  const o = g.order;
  if (!g.ordersOn || !o) return null;
  return { order: o, name: MATERIALS[o.mat].name, got: Math.floor(o.got + 1e-9), need: o.need, ready: o.ready, reward: o.reward };
}

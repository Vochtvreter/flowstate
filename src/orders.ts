// Orders (docs/PITCH_PLAN.md 2.5). DOM-free. Numbers are in RULES.orders (src/content.ts).
//
// Once unlocked (g.ordersOn, a goal reward) there is always exactly one order: "deliver `need` of `mat`",
// counted from items sold at any Market after the order appeared. No timer and no failure. A filled order
// waits for claimOrder(g), which pays it and rolls the next one. An order nobody delivers to for
// RULES.orders.staleSeconds is quietly replaced, and so is one that, at the rate its material sells now,
// would take more than RULES.orders.retire.eta seconds to fill (for `retire.hold` seconds running: a new
// Assembler takes all the Spark an order was counting, and the order read "about 24 min", then "over an
// hour"). The next order never asks for the same material as the one it replaces, as long as the player
// makes something else.
//
// An order is sized from what actually reaches Markets (marketRates), not from what is made: a material
// that machines use up, or that is studied, fills an order only as fast as the rest is sold. Until one has
// been filled, the order asks for something that is already selling and takes about half a minute, so the
// first one starts counting the moment it appears with nothing to reroute. Later orders prefer what is
// selling too, but may ask for something that reaches no Market yet: orderView() says so, and the adviser
// (src/advice.ts) says where to reroute.
//
// Generation uses only g.orderSeed (saved with the game), never Math.random, so the same play gives the
// same orders.
import { DATA_WORTH, DATA_YIELD, DataTier, MATERIALS, MAT_IDS, MatId, RULES, TECHS } from './content';
import { recipeOf, techAvailable, techHidden, valueOf } from './economy';
import { forecast } from './forecast';
import { isMachine } from './graph';
import { Bag, Game, Order, Reward } from './state';

const O = RULES.orders;
const TIERS: DataTier[] = ['a', 'b', 'g'];

/** Games that never roll a new order: the copies that forecasts and the adviser run ahead of the live game. */
const frozen = new WeakSet<Game>();

/**
 * From now on this game never rolls a new order. The one it has still counts sales and can be claimed; after
 * that there is none. For look-ahead copies only (src/forecast.ts): what the next order would ask for is luck,
 * and rolling it would need a forecast of its own.
 */
export function stopNewOrders(g: Game) {
  frozen.add(g);
}

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

/**
 * Items per second of each material that reach Markets as the board stands: measured on a copy of the game
 * run forward for a while (src/forecast.ts), so a line built a moment ago counts for what it will sell.
 */
export function marketRates(g: Game): Bag {
  return forecast(g).sold;
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
    const share = O.dataShare * (y.tier === tier ? 1 : O.convertShare);
    reward[tier] = Math.max(1, Math.round((need * y.amount * DATA_WORTH[y.tier] * share) / DATA_WORTH[tier]));
  }
  reward.credits = Math.max(1, Math.round(worth * (tier ? O.creditShare : O.creditShareNoData)));
  return reward;
}

/**
 * Materials an order may ask for, in the order the picker prefers them: what the player makes right now,
 * refined before raw, never junk; within that, whatever reaches a Market first, and the newest first.
 * `sold` is what reaches Markets per second (the forecast, unless the caller has its own measure).
 */
export function orderCandidates(g: Game, sold: Bag = marketRates(g)): MatId[] {
  const rates = outputRates(g);
  const selling = (m: MatId) => (sold[m] ?? 0) >= O.marketRate;
  const newest = (a: MatId, b: MatId) =>
    Number(selling(b)) - Number(selling(a))
    || (g.madeAt[b] ?? 0) - (g.madeAt[a] ?? 0) || MATERIALS[b].tier - MATERIALS[a].tier || MATERIALS[b].value - MATERIALS[a].value;
  const wanted = (m: MatId) => MATERIALS[m].value >= O.junkValue;
  const producing = MAT_IDS.filter((m) => wanted(m) && (rates[m] ?? 0) >= O.minRate);
  // Prefer refined goods; fall back to raw materials, then to anything ever made.
  const refined = producing.filter((m) => MATERIALS[m].tier >= 1);
  const pool = refined.length ? refined : producing.length ? producing : MAT_IDS.filter((m) => wanted(m) && g.made[m]);
  return (pool.length ? pool : (['glint'] as MatId[])).sort(newest);
}

/**
 * Build the next order. `avoid` is the material of the order being replaced, skipped when there is a choice.
 * Until the player has filled one, it is a "first order": only something already selling fast enough to
 * fill it in about half a minute, refined if possible, raw otherwise.
 */
export function makeOrder(g: Game, avoid: MatId | null = null): Order {
  const sold = marketRates(g);
  let pool = orderCandidates(g);
  let first = false;
  if (g.stats.ordersFilled === 0) {
    const quick = (m: MatId) => MATERIALS[m].value >= O.junkValue && (sold[m] ?? 0) * O.first.seconds[0] >= O.first.minNeed;
    const refined = pool.filter(quick);
    const any = MAT_IDS.filter(quick).sort((a, b) => MATERIALS[b].tier - MATERIALS[a].tier || (sold[b] ?? 0) - (sold[a] ?? 0));
    if (refined.length) pool = refined;
    else if (any.length) pool = any;
    // With nothing selling fast enough it is an order like any other: the player has to send something first.
    first = refined.length + any.length > 0;
  }
  if (avoid && pool.length > 1) pool = pool.filter((m) => m !== avoid);
  // Weighted pick over the first few.
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
  const [lo, hi] = first ? O.first.seconds : [O.minSeconds, O.maxSeconds];
  const seconds = lo + (hi - lo) * rand(g);
  let need = Math.max(first ? O.first.minNeed : O.minNeed, Math.round((sold[mat] ?? 0) * seconds));
  if (need > 20 && !first) need = Math.round(need / 5) * 5; // a tidy number to read
  return {
    mat, need, base: g.sold[mat] ?? 0, got: 0,
    reward: orderReward(g, mat, need),
    created: g.time, lastProgress: g.time, ready: false,
  };
}

const orderText = (o: Order) => `Deliver ${o.need} ${MATERIALS[o.mat].name}`;

function roll(g: Game, avoid: MatId | null, quiet: boolean) {
  if (frozen.has(g)) {
    g.order = null;
    return;
  }
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
  else if (hopeless(g, o)) roll(g, o.mat, true);
}

/**
 * Has this order stood for a while, and been out of reach for `retire.hold` seconds running: at the rate its
 * material sells now it would take more than `retire.eta` seconds to fill? Keeps the time it was first seen so
 * in o.slowSince (saved with the order).
 */
function hopeless(g: Game, o: Order): boolean {
  const R = O.retire;
  const rate = g.soldRate[o.mat] ?? 0;
  const eta = rate > 1e-6 ? (o.need - o.got) / rate : Infinity;
  if (g.time - o.created < R.after || eta <= R.eta) {
    delete o.slowSince;
    return false;
  }
  if (o.slowSince == null || o.slowSince > g.time) o.slowSince = g.time;
  return g.time - o.slowSince >= R.hold;
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
  roll(g, o.mat, false); // never the same material twice in a row when there is a choice
  return true;
}

export interface OrderView {
  order: Order;
  name: string;
  got: number;
  need: number;
  ready: boolean;
  reward: Required<Reward>;
  /**
   * Is any of the ordered material reaching a Market? False means the count cannot move until the player
   * sends some there: the chip should say so ("not reaching a Market") and advice(g) says where to reroute.
   * Always true once the order is filled.
   */
  reachesMarket: boolean;
  /** Items per second of it being sold right now (smoothed), and the seconds left at that rate (Infinity at zero). */
  rate: number;
  eta: number;
}

/**
 * What the orders still to come are worth per second on this board, on average: for the adviser's look-ahead
 * copies (src/advice.ts), in which no new order is rolled. An order asks for 45 to 90 s of what is sold of one
 * of the first three candidates and pays by the item, so a board that sells half as much of a material gets
 * orders for it half the size: a change that takes goods away from the Markets costs that much.
 * `sold` is items per second reaching Markets, `lag` the seconds between an order filling and its claim.
 */
export function ordersWorth(g: Game, sold: Bag, lag: number): Required<Reward> {
  const out = { credits: 0, a: 0, b: 0, g: 0 };
  if (!g.ordersOn) return out;
  const pool = orderCandidates(g, sold).slice(0, O.pick.length);
  const weights = O.pick.slice(0, pool.length);
  const total = weights.reduce((s, w) => s + w, 0);
  const seconds = g.stats.ordersFilled === 0 ? (O.first.seconds[0] + O.first.seconds[1]) / 2 : (O.minSeconds + O.maxSeconds) / 2;
  let time = 0;
  pool.forEach((mat, i) => {
    const p = weights[i] / total;
    const rate = sold[mat] ?? 0;
    const need = Math.max(O.minNeed, rate * seconds);
    // What is not sold fills no order: it sits for staleSeconds and is swapped for another.
    if (rate < O.sellingRate) {
      time += p * O.staleSeconds;
      return;
    }
    const r = orderReward(g, mat, need);
    time += p * (need / rate + lag);
    out.credits += p * r.credits;
    out.a += p * r.a;
    out.b += p * r.b;
    out.g += p * r.g;
  });
  if (time <= 0) return { credits: 0, a: 0, b: 0, g: 0 };
  return { credits: out.credits / time, a: out.a / time, b: out.b / time, g: out.g / time };
}

/** Is the ordered material being sold at all? Goes by recent sales, so it turns true with the first item delivered. */
export function orderReachesMarket(g: Game): boolean {
  const o = g.order;
  if (!o) return false;
  if (o.ready || (g.soldRate[o.mat] ?? 0) >= O.sellingRate) return true;
  return o.got > 0 && g.time - o.lastProgress < O.sellingMemory;
}

/** Progress of the active order, for the order chip. null when there is none. */
export function orderView(g: Game): OrderView | null {
  const o = g.order;
  if (!g.ordersOn || !o) return null;
  const rate = g.soldRate[o.mat] ?? 0;
  return {
    order: o, name: MATERIALS[o.mat].name, got: Math.floor(o.got + 1e-9), need: o.need, ready: o.ready, reward: o.reward,
    reachesMarket: orderReachesMarket(g), rate,
    eta: o.ready ? 0 : rate > 1e-6 ? (o.need - o.got) / rate : Infinity,
  };
}

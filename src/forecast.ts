// Forecasts: what this board will do over the next while if nobody touches it. DOM-free.
//
// A forecast runs a COPY of the game forward with the real rules and measures it; the live game is never
// touched. It answers questions a smoothed reading cannot: what a line built five seconds ago will sell
// once it has filled up, and what one change to the board is worth (src/advice.ts). Orders use it to size
// themselves from what actually reaches Markets (src/orders.ts).
import { DataTier, MatId } from './content';
import { stopNewOrders } from './orders';
import { tick } from './sim';
import { Bag, Game, cloneGame, markLookahead } from './state';

export interface Forecast {
  /** Seconds that were measured. */
  seconds: number;
  /** Credits per second from sales alone: no goal or order pay. */
  credits: number;
  /** Data per second from Labs alone. */
  data: Record<DataTier, number>;
  /** Items per second of each material reaching Markets. */
  sold: Bag;
}

/** How long a forecast looks ahead, and how finely. The simulation gives the same totals at any step up to this size. */
export const FORECAST = { seconds: 40, step: 0.25 };

/** For measuring (tools/bench.ts) and for tests: copies made to look ahead, and ticks run in them, so far. */
export const LOOKS = { copies: 0, ticks: 0 };

/**
 * A copy of the game for looking ahead: nothing in it can reach the live game, and nothing done to it is
 * recorded in the player's undo history. The research queue is emptied and no new order is ever rolled (the
 * one it has keeps counting), so the copy only shows what the board itself does.
 */
export function lookahead(g: Game): Game | null {
  const copy = cloneGame(g);
  if (!copy) return null;
  LOOKS.copies++;
  markLookahead(copy);
  copy.queue = [];
  copy.paused = false;
  stopNewOrders(copy);
  return copy;
}

/** Run a copy for `seconds` and return what it earned and sold per second over that time. Changes the copy. */
export function measure(copy: Game, seconds: number, step = FORECAST.step): Forecast {
  const out: Forecast = { seconds: 0, credits: 0, data: { a: 0, b: 0, g: 0 }, sold: {} };
  const steps = Math.max(1, Math.round(seconds / step));
  for (let i = 0; i < steps; i++) {
    tick(copy, step);
    LOOKS.ticks++;
    const acc = copy.tickAcc;
    out.credits += acc.credits;
    out.data.a += acc.data.a;
    out.data.b += acc.data.b;
    out.data.g += acc.data.g;
    for (const k in acc.sold) out.sold[k as MatId] = (out.sold[k as MatId] ?? 0) + (acc.sold[k as MatId] ?? 0);
  }
  out.seconds = steps * step;
  out.credits /= out.seconds;
  out.data.a /= out.seconds;
  out.data.b /= out.seconds;
  out.data.g /= out.seconds;
  for (const k in out.sold) out.sold[k as MatId]! /= out.seconds;
  return out;
}

const cache = new WeakMap<Game, { rev: number; time: number; f: Forecast }>();

/**
 * What the board earns and sells per second over the next FORECAST.seconds, as it stands right now.
 * Costs a few milliseconds; the answer is kept until the board or the clock moves.
 */
export function forecast(g: Game): Forecast {
  const hit = cache.get(g);
  if (hit && hit.rev === g.rev && hit.time === g.time) return hit.f;
  const copy = lookahead(g);
  const f = copy ? measure(copy, FORECAST.seconds) : { seconds: 0, credits: 0, data: { a: 0, b: 0, g: 0 }, sold: {} };
  cache.set(g, { rev: g.rev, time: g.time, f });
  return f;
}

import { claimOrder, clearHistory } from '../src/actions';
import { waitInfo, waitKind } from '../src/advice';
import { TECHS } from '../src/content';
import { research, techAffordable } from '../src/economy';
import { activeGoal } from '../src/goals';
import { tick } from '../src/sim';
import { Game, GameEvent, newGame } from '../src/state';

export function run(g: Game, seconds: number, dt = 0.05) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) tick(g, dt);
}

/** A fresh game with a clean undo history. */
export function fresh(): Game {
  clearHistory();
  return newGame();
}

/** Plenty of credits and every tech the tests build with. */
export function rich(): Game {
  const g = fresh();
  g.credits = 1e9;
  g.techs = ['P1', 'R1', 'P2', 'P3', 'P4', 'P5', 'P7', 'L1', 'L4', 'L6', 'L2', 'L5', 'L3'];
  return g;
}

export const well = (g: Game) => g.nodes.find((n) => n.type === 'well')!;
export const market = (g: Game) => g.nodes.find((n) => n.type === 'market')!;
export const wire = (g: Game, id: number) => g.wires.find((w) => w.id === id)!;

/** Take the pending events of one kind out of the queue. */
export function take<K extends GameEvent['kind']>(g: Game, kind: K): Extract<GameEvent, { kind: K }>[] {
  const out = g.events.filter((e) => e.kind === kind) as Extract<GameEvent, { kind: K }>[];
  g.events = g.events.filter((e) => e.kind !== kind);
  return out;
}

/** Run for `seconds` and return each wire's average throughput (items/s) over that time. Steadier than wire.rate when a machine takes its inputs in gulps. */
export function throughput(g: Game, seconds: number, wireIds: number[], dt = 0.05): number[] {
  const total = wireIds.map(() => 0);
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    tick(g, dt);
    wireIds.forEach((id, k) => (total[k] += g.wires.find((w) => w.id === id)?.flow ?? 0));
  }
  return total.map((t) => t / (steps * dt));
}

/**
 * The real game: a plain copy (orders keep being rolled, exactly as in play), run at `dt`, with a stand-in
 * player who claims a filled order ten seconds after it fills and does the card's research the moment it is
 * affordable. Returns the seconds until the wait the game was in has ended, or Infinity after `limit`.
 */
export function realWaitEnds(copy: Game, limit: number, dt = 0.1, act?: (g: Game) => number): number {
  const kind = waitKind(copy);
  const goal = copy.goal.i;
  const filled = copy.stats.ordersFilled;
  let readySince: number | null = null;
  const over = () => {
    if (copy.goal.i !== goal || copy.goal.ready) return true;
    if (kind === 'order') return copy.stats.ordersFilled > filled;
    if (kind === 'flow') return false;
    const step = activeGoal(copy)?.step?.(copy) ?? null;
    if (step && 'tech' in step && techAffordable(copy, TECHS[step.tech])) research(copy, step.tech);
    return waitInfo(copy) === null;
  };
  if (over()) return 0;
  // `act`: the player's own gestures meanwhile (a card's line, say), asked once their hands are free again; it
  // returns the seconds the gesture keeps them busy (0: nothing done).
  let freeAt = copy.time;
  for (let t = dt; t <= limit; t += dt) {
    if (act && copy.time >= freeAt) {
      const busy = act(copy);
      freeAt = copy.time + (busy > 0 ? busy : 1);
    }
    tick(copy, dt);
    if (copy.order?.ready) {
      if (readySince == null) readySince = copy.time;
      if (copy.time - readySince >= 10) {
        claimOrder(copy);
        readySince = null;
      }
    } else readySince = null;
    if (over()) return t;
  }
  return Infinity;
}

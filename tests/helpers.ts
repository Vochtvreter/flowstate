import { clearHistory } from '../src/actions';
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

// Flow: the share of Wells and machines running flat out. DOM-free. Numbers are in RULES.flow (src/content.ts).
//
// - Producers are Wells and machines older than RULES.flow.minAge whose output can reach a Market or a Lab
//   along some path of wires, so building never lowers Flow and a line that makes nothing anyone uses
//   (six Wells into a Void) is not a line. Changing a machine's recipe makes it "new" again.
//   Cutting a weak producer off still hides it, at the price of everything it made.
// - A producer is flowing when its utilisation (n.util, not n.status) is at least RULES.flow.flowing.
// - g.flow is the flowing share smoothed over a few seconds. Once g.flowOn is set (a goal reward),
//   sales are multiplied by flowMult(g) from src/economy.ts.
// - Flow State: the raw share at 100% for RULES.flow.stateSeconds with enough producers.
import { RULES } from './content';
import { flowMult } from './economy';
import { isMachine, reachesUse } from './graph';
import { Game, GNode } from './state';

const F = RULES.flow;

export const isProducer = (n: GNode) => n.type === 'well' || isMachine(n);

/** Does this node count toward Flow right now? A Well or machine, old enough, whose output can end up sold or studied. */
export const countsForFlow = (g: Game, n: GNode) => isProducer(n) && g.time - n.born >= F.minAge && reachesUse(g, n);

export const isFlowing = (n: GNode) => n.util >= F.flowing;

/** The Wells and machines that count toward Flow right now. */
export function flowProducers(g: Game): GNode[] {
  return g.nodes.filter((n) => countsForFlow(g, n));
}

/** The counted producer furthest from flowing, or null when all of them flow. For the "jump to worst" button. */
export function worstProducer(g: Game): GNode | null {
  let worst: GNode | null = null;
  for (const n of g.nodes) {
    if (!countsForFlow(g, n) || isFlowing(n)) continue;
    if (!worst || n.util < worst.util) worst = n;
  }
  return worst;
}

/**
 * "All but one producer flowing", as a share: the bar the "hold Flow" goal also accepts once its valve is open
 * (RULES.flow.valveAfter). At least one producer has to flow, and the bar is never above the goal's own.
 */
export const nearShare = (producers: number) => (producers > 0 ? Math.min(F.holdShare, Math.max(1, producers - 1) / producers) : F.holdShare);

/** Flow State is on: the raw share has been 100% for long enough, with enough producers. */
export const inFlowState = (g: Game) => g.flowOn && g.flowStreak >= F.stateSeconds;

export interface FlowInfo {
  /** The Flow meter is unlocked. */
  on: boolean;
  /** Smoothed Flow, 0..1: what the ring shows. */
  flow: number;
  /** Sale price bonus right now, e.g. 0.12 for "+12%". 0 while locked. */
  bonus: number;
  /** Counted producers, and how many of them are flowing. */
  producers: number;
  flowing: number;
  /** Producers needed before Flow State can start. */
  needed: number;
  inState: boolean;
  /** Seconds at 100% in the current streak, and the best ever. */
  streak: number;
  best: number;
}

/** Everything the Flow ring shows. */
export function flowInfo(g: Game): FlowInfo {
  let producers = 0;
  let flowing = 0;
  for (const n of g.nodes) {
    if (!countsForFlow(g, n)) continue;
    producers++;
    if (isFlowing(n)) flowing++;
  }
  return {
    on: g.flowOn, flow: g.flow, bonus: flowMult(g) - 1, producers, flowing, needed: F.stateProducers,
    inState: inFlowState(g), streak: g.flowStreak, best: g.flowBest,
  };
}

/** Advance Flow by one tick. Called at the end of tick(), after utilisation is updated. */
export function updateFlow(g: Game, dt: number) {
  let producers = 0;
  let flowing = 0;
  for (const n of g.nodes) {
    if (!countsForFlow(g, n)) continue;
    producers++;
    if (isFlowing(n)) flowing++;
  }
  const raw = producers ? flowing / producers : 0;
  g.flow += (raw - g.flow) * (1 - Math.exp(-dt / F.smooth));
  // Streaks and the goal timer only run once the player can see the meter.
  if (!g.flowOn) {
    g.flowStreak = 0;
    g.flowHold = 0;
    g.flowNear = 0;
    return;
  }
  // The smoothed value creeps up on its target, so allow half a percent.
  g.flowHold = g.flow >= F.holdShare - 0.005 ? g.flowHold + dt : 0;
  g.flowNear = producers > 0 && g.flow >= nearShare(producers) - 0.005 ? g.flowNear + dt : 0;
  if (producers >= F.stateProducers && flowing === producers) {
    const before = g.flowStreak;
    g.flowStreak += dt;
    if (before < F.stateSeconds && g.flowStreak >= F.stateSeconds) {
      const first = g.stats.flowStates === 0;
      g.stats.flowStates++;
      g.events.push({ kind: 'flow-state', first, text: 'Flow State: every Well and machine is running flat out.' });
    }
    if (g.flowStreak > g.flowBest) g.flowBest = g.flowStreak;
  } else g.flowStreak = 0;
}

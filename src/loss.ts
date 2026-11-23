// Loss: what a Drill or machine could have made and did not, and why. DOM-free; it only reads the game.
//
// Utilization says how much of its time a machine is at work. It does not say what that costs, nor whose fault it is:
// a Refiner at 70% may be waiting for Ore (the limit is behind it) or standing full of Copper nothing takes (the limit
// is ahead of it), and the fix is in opposite directions. Loss is the other side of utilization, in the two terms a
// player can act on:
//
//  - how much: the share of its time it did not work, and the items a second that went unmade for it;
//  - why: how much of that it spent waiting for an input (and which), and how much with its output backed up (and
//    with what).
//
// The simulation already keeps both halves of the why (GNode.fStarved and fBlocked, smoothed over the same three
// seconds as utilization): nothing is measured here that was not measured before, and nothing in the rules reads it.
import { MatId } from './content';
import { cycleTime, recipeOf, wellRate } from './economy';
import { isMachine } from './graph';
import { GNode } from './state';

export interface Loss {
  /** The share of its time it did not work, 0 to 1: what utilization leaves. */
  share: number;
  /** What it makes of its first output flat out, in items a second... */
  capacity: number;
  /** ...and how much of that went unmade. */
  rate: number;
  /** Of `share`, the part spent waiting for an input, and the input it is waiting for. */
  starved: number;
  missing: MatId | null;
  /** Of `share`, the part spent with its output backed up, and the output that has nowhere to go. */
  blocked: number;
  blockedOn: MatId | null;
  /**
   * Just built, wired or re-tooled: it is still filling up, and its numbers are not yet a reading (the simulation
   * holds its own judgement for the same seconds: GNode.grace). The share is given, the causes are not.
   */
  settling: boolean;
}

/** Below this share of its time, what a machine loses is the ripple of its own bursts, not a loss. */
export const LOSS_FLOOR = 0.005;

/**
 * What this Drill or machine is losing. Null for a node that makes nothing (a Market, a Router, a Lab), a machine with
 * no recipe, and one that stands idle with nothing wired into it: that is not a loss but a machine not yet in use.
 */
export function lossOf(n: GNode): Loss | null {
  let capacity = 0;
  if (n.type === 'well') capacity = n.material ? wellRate(n) : 0;
  else if (isMachine(n)) {
    const r = recipeOf(n);
    capacity = r ? r.outputs[0][1] / cycleTime(n, r) : 0;
  }
  if (!(capacity > 0) || n.status === 'idle') return null;
  let share = Math.max(0, Math.min(1, 1 - n.util));
  if (share < LOSS_FLOOR) share = 0;
  const settling = n.grace > 0;
  // The two causes as the simulation has them. They are smoothed apart from utilization, so they are fitted to what
  // utilization leaves: together they are the whole of the loss, in the proportion in which they were seen.
  const s = Math.max(0, n.fStarved), b = Math.max(0, n.fBlocked);
  const seen = s + b;
  let starved = 0, blocked = 0;
  if (!settling && share > 0) {
    if (seen > 1e-4) {
      starved = (share * s) / seen;
      blocked = (share * b) / seen;
    } else if (n.status === 'blocked') blocked = share;
    else if (n.status === 'starved') starved = share;
  }
  // (A cause too small to show beside the other is the other's.)
  if (starved > 0 && starved < LOSS_FLOOR) { blocked += starved; starved = 0; }
  if (blocked > 0 && blocked < LOSS_FLOOR) { starved += blocked; blocked = 0; }
  // (Which input, which output: as the simulation names them while the trouble lasts. A machine it calls working, one
  // that loses a few points of a hundred, has neither named, and then none is given.)
  return {
    share, capacity, rate: share * capacity, settling,
    starved, missing: starved > 0 ? n.missing : null,
    blocked, blockedOn: blocked > 0 ? n.blockedOn ?? (n.type === 'well' ? n.material : null) : null,
  };
}

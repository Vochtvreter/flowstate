// The pacing targets, pinned. `npm run pacing` plays every policy on order seeds 0–3 and prints the tables;
// this runs seed 0 only (the order sequence every real new game starts with) and fails if a single target
// is missed, so that a change to a rule or a number that moves the pacing is noticed by `npm test`.
//
// The players are the pacing tool's own (tools/pacing.ts): two fast ones who know the game, and the newcomer
// who does only what the goal card says and follows the adviser's tips, at 6 and at 10 seconds an action.
// The targets are TARGETS in that file (docs/PITCH_PLAN.md section 1, as amended for the newcomer).
import { describe, expect, it } from 'vitest';
import { POLICIES, TARGETS, playOnce } from '../tools/pacing';

describe('pacing: every target holds on the order sequence a new game starts with', () => {
  for (const policy of ['mainline', 'greedy', 'newcomer', 'newcomer10']) {
    it(`${policy}: ${POLICIES[policy].describe}`, () => {
      const { lens, checks } = playOnce(policy, 0);
      expect(lens, 'the first Lens was made').not.toBeNull();
      const missed = checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.value} (target ${c.target})`);
      expect(missed, missed.join('; ')).toEqual([]);
      expect(checks.length).toBeGreaterThanOrEqual(3);
    });
  }

  it('the targets are the ones in the brief', () => {
    expect(TARGETS.fast).toMatchObject({ firstMachineBy: 45, labBy: 90, glyph: [360, 480], lens: [870, 1140], fabricatorMax: 300, deadBefore10: 60, deadBeforeLens: 120, contentUntil: 1440 });
    expect(TARGETS.newcomer).toEqual({ lens: [1200, 1500], goalMax: 240, fabricatorMax: 240, tiplessMax: 60 });
    expect(TARGETS.newcomer10).toEqual({ lensBy: 1920, goalMax: 300 });
    expect(TARGETS.earnedShare).toBe(0.65);
  });
});

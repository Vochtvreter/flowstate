// The pacing targets, pinned. `npm run pacing` plays every policy on order seeds 0–3 and prints the tables;
// this runs the same twenty games (seed 0 is the order sequence every real new game starts with) and fails
// if a single target is missed, so that a change to a rule or a number that moves the pacing is noticed by
// `npm test`.
//
// The players are the pacing tool's own (tools/pacing.ts): two fast ones who know the game; the newcomer who
// does only what the goal card says (its "while you wait" lines included) and follows the adviser's tips, at 6
// and at 10 seconds an action; and the same newcomer never following a tip. The targets are TARGETS in that
// file (docs/PITCH_PLAN.md section 1, as amended for the newcomer).
import { describe, expect, it } from 'vitest';
import { POLICIES, TARGETS, playOnce } from '../tools/pacing';

describe('pacing: every target holds on order seeds 0 to 3', () => {
  for (const policy of ['mainline', 'greedy', 'newcomer', 'newcomer10', 'cardonly']) {
    it(`${policy}: ${POLICIES[policy].describe}`, () => {
      for (const seed of [0, 1, 2, 3]) {
        const { lens, checks } = playOnce(policy, seed);
        expect(lens, `seed ${seed}: the first Lens was made`).not.toBeNull();
        const missed = checks.filter((c) => !c.ok).map((c) => `seed ${seed}: ${c.label}: ${c.value} (target ${c.target})`);
        expect(missed, missed.join('; ')).toEqual([]);
        expect(checks.length).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('the targets are the ones in the brief', () => {
    expect(TARGETS.fast).toMatchObject({
      firstMachineBy: 45, labBy: 90, firstResearchBy: 150, earlyIdleMax: 10, glyph: [360, 480], lens: [870, 1140], fabricatorMax: 300,
      deadBefore10: 60, deadBeforeLens: 120, contentUntil: 1440,
    });
    // The newcomer: first Lens between 18:30 and 23:00, no goal over 240 s. At 10 s an action: Lens by 30:00, no goal over 300 s.
    expect(TARGETS.newcomer).toEqual({ lens: [1110, 1380], goalMax: 240, fabricatorMax: 240 });
    expect(TARGETS.newcomer10).toEqual({ lensBy: 1800, goalMax: 300 });
    // Never following a tip: Lens by 32:00, no goal over 360 s.
    expect(TARGETS.cardonly).toEqual({ lensBy: 1920, goalMax: 360 });
    expect(TARGETS.earnedShare).toBe(0.65);
    expect(POLICIES.cardonly).toMatchObject({ card: true, tips: false, claimDelay: [8, 16] });
    expect(POLICIES.newcomer).toMatchObject({ card: true, tips: true, tipDelay: 15, claimDelay: [8, 16] });
  });
});

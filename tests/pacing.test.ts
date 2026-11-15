// The pacing targets, pinned. `npm run pacing` plays every policy on order seeds 0–3 and prints the tables;
// this runs the same games (seed 0 is the order sequence every real new game starts with) and fails if a
// single target is missed, so that a change to a rule or a number that moves the pacing is noticed by
// `npm test`.
//
// The players are the pacing tool's own (tools/pacing.ts): two fast ones who know the game; the newcomer who
// does only what the goal card says (its "while you wait" lines included) and follows the adviser's tips, at 6
// and at 10 seconds an action; the same newcomer never following a tip (judged on "nothing to do" too: the
// stretches with free hands, no Claim to press and no step of a line to take); and the newcomer who reads no
// line, only hints and tips. The targets are TARGETS in that file.
import { describe, expect, it } from 'vitest';
import { POLICIES, TARGETS, playOnce } from '../tools/pacing';

describe('pacing: every target holds on order seeds 0 to 3', () => {
  for (const policy of ['mainline', 'greedy', 'newcomer', 'newcomer10', 'cardonly', 'nolines']) {
    it(`${policy}: ${POLICIES[policy].describe}`, () => {
      for (const seed of [0, 1, 2, 3]) {
        const { lens, checks, tips, flowGoal, nothing } = playOnce(policy, seed);
        expect(lens, `seed ${seed}: the first Lens was made`).not.toBeNull();
        // "Never a tip" is meant literally: not on the Flow goal either.
        if (policy === 'cardonly') {
          expect(tips, `seed ${seed}`).toEqual({ offered: 0, followed: 0 });
          // The Flow goal's line names the fix (Speed on the Ember Well): done long before the valve (90 s).
          expect(flowGoal, `seed ${seed}: seconds on the Flow goal`).not.toBeNull();
          expect(flowGoal!, `seed ${seed}: seconds on the Flow goal`).toBeLessThanOrEqual(45);
          expect(nothing.longest, `seed ${seed}: longest stretch with nothing to do`).toBeLessThanOrEqual(90);
          expect(nothing.share, `seed ${seed}: share of nothing to do`).toBeLessThanOrEqual(0.4);
        }
        // The newcomer takes the tips there are; the cards' lines now carry the moves tips used to, so there are
        // few or none (it is offered no more than a handful).
        if (policy === 'newcomer') expect(tips.offered, `seed ${seed}`).toBeLessThanOrEqual(5);
        const missed = checks.filter((c) => !c.ok).map((c) => `seed ${seed}: ${c.label}: ${c.value} (target ${c.target})`);
        expect(missed, missed.join('; ')).toEqual([]);
        expect(checks.length).toBeGreaterThanOrEqual(2);
      }
    });
  }

  it('the targets are the ones in the brief', () => {
    expect(TARGETS.fast).toMatchObject({
      firstMachineBy: 45, labBy: 90, firstResearchBy: 150, earlyIdleMax: 10, glyph: [360, 480], lens: [870, 1080], fabricatorMax: 300,
      deadBefore10: 60, deadBeforeLens: 120, contentUntil: 1440, paradoxBy: 1800,
    });
    // The newcomer: first Lens between 19:00 and 23:00, no goal over 240 s. At 10 s an action: Lens by 30:00, no goal over 300 s.
    expect(TARGETS.newcomer).toEqual({ lens: [1140, 1380], goalMax: 240, fabricatorMax: 240 });
    expect(TARGETS.newcomer10).toEqual({ lensBy: 1800, goalMax: 300 });
    // Never following a tip: Lens between 20:00 and 23:00, no goal over 360 s, never 90 s with nothing to do,
    // and nothing to do for at most 40% of the time to the Lens.
    expect(TARGETS.cardonly).toEqual({ lens: [1200, 1380], goalMax: 360, nothingStretch: 90, nothingShare: 0.4 });
    // Reading no line, following the tips: slower, never stranded.
    expect(TARGETS.nolines).toEqual({ lensBy: 1920 });
    expect(TARGETS.earnedShare).toBe(0.65);
    expect(POLICIES.cardonly).toMatchObject({ card: true, tips: false, claimDelay: [8, 16] });
    expect(POLICIES.newcomer).toMatchObject({ card: true, tips: true, tipDelay: 15, claimDelay: [8, 16] });
    expect(POLICIES.nolines).toMatchObject({ card: true, tips: true, lines: false, claimDelay: [8, 16] });
  });
});

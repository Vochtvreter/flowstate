// The end-of-demo summary's words (hud-screens.ts), and the way out of the ending into free play. These run without a
// browser: they only read the game.
import { describe, expect, it, vi } from 'vitest';
import { MATERIALS } from '../content';
import { GOALS, MAIN_GOALS, goalView } from '../goals';
import { Game, newGame } from '../state';
import { awayLine, awayText, clockTime, nextMaterials, resultText } from './hud-screens';

describe('the ending: from the first Lens to free play', () => {
  /** A fresh copy of the screens module (its state: free play begun or not) and of ui.ts, with a game whose Lens is made. */
  async function lensMade(): Promise<{ g: Game; screens: typeof import('./hud-screens'); ui: typeof import('./ui') }> {
    vi.resetModules();
    const screens = await import('./hud-screens');
    const ui = await import('./ui');
    const g = newGame();
    // "Make your first Lens", met: the Lens has just been made (sim.ts endDemo), and nobody has pressed Claim.
    g.goal = { i: MAIN_GOALS - 1, ready: true };
    g.ended = true;
    ui.ui.g = g;
    return { g, screens, ui };
  }

  it('Keep playing with no Claim before it: the capstone is claimed and free play shows at once', async () => {
    const { g, screens } = await lensMade();
    expect(GOALS[g.goal.i].reward.unlock).toBe('end');
    // From the Lens on, the card shows the ending (no Claim: Keep playing claims), and the board is quiet.
    expect(screens.endingShown(g)).toBe(true);
    expect(screens.freePlay()).toBe(false);
    screens.screensApi.keepPlaying();
    expect(g.goal.i).toBe(MAIN_GOALS);
    expect(screens.freePlay()).toBe(true);
    expect(screens.endingShown(g)).toBe(false);
    // What the card shows next: the first free-play goal.
    const v = goalView(g);
    expect(v?.free).toBe(true);
    expect(v?.number).toBe(1);
  });

  it('Keep playing after a Claim: nothing more is claimed, and free play shows', async () => {
    const { g, screens } = await lensMade();
    const { claimGoal } = await import('../goals');
    expect(claimGoal(g)).toBe(true);
    expect(g.goal.i).toBe(MAIN_GOALS);
    // Claimed, but the summary has not been left: still the ending.
    expect(screens.endingShown(g)).toBe(true);
    screens.screensApi.keepPlaying();
    expect(g.goal.i).toBe(MAIN_GOALS);
    expect(screens.endingShown(g)).toBe(false);
    expect(goalView(g)?.goal.free).toBe(true);
  });

  it('is not shown before the Lens', async () => {
    const { g, screens } = await lensMade();
    g.ended = false;
    expect(screens.endingShown(g)).toBe(false);
    expect(screens.endingShown(null)).toBe(false);
  });
});

describe('summary: the time to the first Lens', () => {
  it('reads as minutes and seconds, with hours only when there are any', () => {
    expect(clockTime(0)).toBe('0:00');
    expect(clockTime(59.9)).toBe('0:59');
    expect(clockTime(1182)).toBe('19:42');
    expect(clockTime(1182.99)).toBe('19:42');
    expect(clockTime(3733)).toBe('1:02:13');
  });
});

describe('summary: what comes next', () => {
  it('is what the free-play goals have the player make, in their order', () => {
    const next = nextMaterials();
    expect(next.map((m) => MATERIALS[m].name)).toEqual(['Clay', 'Coil', 'Dynamo', 'Paradox']);
    // One per free-play goal: a goal added to the chain shows up in the row without a change here.
    expect(next).toHaveLength(GOALS.filter((x) => x.free).length);
  });
});

describe('summary: Copy result', () => {
  it('is two lines of plain text: the time to the Lens, things built, the share of income from sales', () => {
    const g = newGame();
    g.ended = true;
    g.stats.firstLensAt = 1182.4;
    g.stats.nodesBuilt = 31;
    g.stats.fromSales = 830;
    g.stats.fromOrders = 100;
    g.stats.fromGoals = 70;
    const text = resultText(g);
    expect(text.split('\n')).toEqual(['Flowstate: first Lens in 19:42', '31 things built · 83% of income from sales']);
    // No link, nothing about the player, no markup.
    expect(text).not.toMatch(/https?:|www\.|<|@/);
  });

  it('still reads sensibly for a save that has no Lens time', () => {
    const g = newGame();
    expect(resultText(g).split('\n')).toEqual(['Flowstate: demo complete', '0 things built · 0% of income from sales']);
  });
});

describe('time away', () => {
  it('reads a long time in a word or two', () => {
    expect(awayText(45 * 60)).toBe('45 minutes');
    expect(awayText(5 * 3600)).toBe('5 hours');
    expect(awayText(86400)).toBe('1 day');
    expect(awayText(30 * 86400)).toBe('30 days');
  });

  it('says how long the player was gone when the line ran for its whole limit, and how to raise it', () => {
    const g = newGame();
    g.ended = true;
    expect(awayLine(g, 3600, 3600)).toBe('Your supply line kept running for <b>1h 0m</b>.');
    expect(awayLine(g, 7200, 86400)).toBe('You were away for <b>1 day</b>. Your supply line ran for its <b>2-hour</b> limit. Long Absence in the tech tree raises it to 8 hours.');
    g.techs.push('R4');
    expect(awayLine(g, 8 * 3600, 3 * 86400)).toBe('You were away for <b>3 days</b>. Your supply line ran for its <b>8-hour</b> limit.');
  });
});

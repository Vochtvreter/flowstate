// The end-of-demo summary's words (hud-screens.ts). These run without a browser: they only read the game.
import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../content';
import { GOALS } from '../goals';
import { newGame } from '../state';
import { clockTime, nextMaterials, resultText } from './hud-screens';

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

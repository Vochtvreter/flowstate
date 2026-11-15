// The card's words for the Flow goal's valve (hud-words.ts), for any slack the rules may give (FlowGoalView.slack); and
// for the goal's line: its label, and what a held step is saving for. These run without a browser.
import { describe, expect, it } from 'vitest';
import { countWord, heldWords, lineLabel, valveWords } from './hud-words';

describe("the goal's line in words", () => {
  it('is "Next step", with no count, when it is the goal\'s own requirement (goal 22)', () => {
    expect(lineLabel(2, 2, true)).toEqual({ label: 'Next step', count: '' });
    expect(lineLabel(1, 1, true)).toEqual({ label: 'Next step', count: '' });
  });

  it('is "While you wait", counted where the goal has more than one line', () => {
    expect(lineLabel(2, 3, false)).toEqual({ label: 'While you wait', count: ' · 2 of 3' });
    expect(lineLabel(1, 1, false)).toEqual({ label: 'While you wait', count: '' });
  });

  it('says what a held step is saving for, and about how long that takes', () => {
    expect(heldWords('1,100¢', 40).all).toBe('Saving for this · 1,100¢ · about 40 s');
    expect(heldWords('1,100¢', 40)).toMatchObject({ head: 'Saving for this', tail: '1,100¢ · about 40 s' });
    expect(heldWords('600¢', 130).all).toBe('Saving for this · 600¢ · about 2 min');
    expect(heldWords('45α', 3).all).toBe('Saving for this · 45α · a few seconds');
    // Nothing coming in: no time is promised.
    expect(heldWords('600¢', Infinity).all).toBe('Saving for this · 600¢');
  });
});

describe('the Flow valve in words', () => {
  it('counts in words up to five, in figures beyond', () => {
    expect([1, 2, 3, 4, 5].map(countWord)).toEqual(['one', 'two', 'three', 'four', 'five']);
    expect(countWord(6)).toBe('6');
    expect(countWord(12)).toBe('12');
  });

  it('says nothing before the valve opens, or while nothing is short', () => {
    expect(valveWords(0, 3)).toBe('');
    expect(valveWords(2, 0)).toBe('');
  });

  it('words any slack', () => {
    expect(valveWords(1, 1)).toBe('Close enough: all but one is running');
    expect(valveWords(1, 2)).toBe('All but one running is enough now');
    expect(valveWords(2, 2)).toBe('Close enough: all but two are running');
    expect(valveWords(2, 4)).toBe('All but two running is enough now');
    expect(valveWords(3, 2)).toBe('Close enough: all but two are running');
    expect(valveWords(3, 5)).toBe('All but three running is enough now');
    expect(valveWords(4, 6)).toBe('All but four running is enough now');
    expect(valveWords(5, 5)).toBe('Close enough: all but five are running');
    expect(valveWords(7, 9)).toBe('All but 7 running is enough now');
  });
});

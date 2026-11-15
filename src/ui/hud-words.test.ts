// The card's words for the Flow goal's valve (hud-words.ts), for any slack the rules may give (FlowGoalView.slack).
// These run without a browser.
import { describe, expect, it } from 'vitest';
import { countWord, valveWords } from './hud-words';

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

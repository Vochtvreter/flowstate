// Wording that depends on how the player is playing. Part of the HUD.
//
// The phone module records the kind of the last pointer on <html data-input="touch|mouse">.
// Everything the HUD and the panels say reads it here: a finger "taps", and is never told about a key.

/** The player's last press was a finger or a pen. */
export const isTouch = () => document.documentElement.dataset.input === 'touch';

/** "tap" on touch, "click" with a mouse. */
export const pressWord = () => (isTouch() ? 'tap' : 'click');
export const PressWord = () => (isTouch() ? 'Tap' : 'Click');

/** A label with its keyboard shortcut, or without it on touch: "Undo (Ctrl+Z)" / "Undo". */
export const withKey = (label: string, key: string) => (isTouch() ? label : `${label} (${key})`);

/**
 * A length of time in round, human numbers: "a few seconds", "about 40 s", "about 1 min", "about 12 min",
 * "over an hour". For waits and for what a tip saves. Empty when it would never end.
 */
export function aboutTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '';
  if (seconds < 8) return 'a few seconds';
  if (seconds < 55) return `about ${Math.max(10, Math.round(seconds / 10) * 10)} s`;
  if (seconds < 3570) return `about ${Math.max(1, Math.round(seconds / 60))} min`;
  return 'over an hour';
}

/**
 * A length of time that was measured, said a little finer than aboutTime: "about 40 s", "about 1 min 20 s",
 * "about 3 min", "about 12 min". For what a move has bought ("Assembly about 1 min 20 s sooner").
 */
export function aboutSpan(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '';
  if (seconds < 8) return 'a few seconds';
  const s = Math.max(10, Math.round(seconds / 10) * 10);
  if (s < 60) return `about ${s} s`;
  if (s >= 600) return aboutTime(seconds);
  const rest = s % 60;
  return `about ${Math.floor(s / 60)} min${rest ? ` ${rest} s` : ''}`;
}

/** A small count in words, as the card says it: "one", "two" … "five"; from six on, the figure. */
export const countWord = (k: number) => ['zero', 'one', 'two', 'three', 'four', 'five'][k] ?? String(k);

/**
 * What the Flow goal's card says once its valve has opened. `slack`: how many producers may be short and the goal
 * still counts (FlowGoalView.slack, a whole number from 0 up to the producers' count minus one); `short`: how many
 * are short right now. Nothing before the valve opens or while none is short; "Close enough: all but two are
 * running" while no more are short than may be; else "All but three running is enough now".
 */
export function valveWords(slack: number, short: number): string {
  if (slack <= 0 || short <= 0) return '';
  if (short <= slack) return `Close enough: all but ${countWord(short)} ${short === 1 ? 'is' : 'are'} running`;
  return `All but ${countWord(slack)} running is enough now`;
}

/**
 * The goal's line, as its label says it: "Next step" when it is the goal's own requirement (the last goal's wires into
 * the Fabricator: GoalView.meanwhile.required), with no count; "One way" for a growth goal's line (GoalView.meanwhile.way:
 * one way to its rate, and not the only one), with no count either; otherwise "While you wait", with "· 2 of 3" where
 * the goal has more than one line. Plain text (the card sets the count in a span of its own).
 */
export function lineLabel(step: number, of: number, required: boolean, way = false): { label: string; count: string } {
  if (way) return { label: 'One way', count: '' };
  if (required) return { label: 'Next step', count: '' };
  return { label: 'While you wait', count: of > 1 ? ` · ${step} of ${of}` : '' };
}

/**
 * What a line's held step is saving for (GoalView.meanwhile.held), said where its Show me would be: "Saving for this ·
 * 1,100¢ · about 40 s". The time is left out when nothing is coming in. `amount` is the price as the card writes it.
 */
export function heldWords(amount: string, eta: number): { head: string; tail: string; all: string } {
  const when = aboutTime(eta);
  const tail = when ? `${amount} · ${when}` : amount;
  return { head: 'Saving for this', tail, all: `Saving for this · ${tail}` };
}

/** The same string with a capital first letter: names from the rules come as "the Fabricator". */
export const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The player asked for less motion: entrance animations are skipped. */
export const calmMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

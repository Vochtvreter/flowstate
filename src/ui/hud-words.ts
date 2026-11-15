// Wording that depends on how the player is playing. Owned by the HUD track.
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

/** The same string with a capital first letter: names from the rules come as "the Fabricator". */
export const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The player asked for less motion: entrance animations are skipped. */
export const calmMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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

/** A wait in words: "about 40 seconds", "about 2 min". Empty when it would never end. */
export function waitText(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '';
  if (seconds < 8) return 'a few seconds';
  if (seconds < 50) return `about ${Math.max(10, Math.round(seconds / 10) * 10)} seconds`;
  if (seconds < 90) return 'about a minute';
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} min`;
  return 'over an hour';
}

/** The player asked for less motion: entrance animations are skipped. */
export const calmMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

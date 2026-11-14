// What the board and the panels need to know about the device, without importing phone.ts
// (which imports them). phone.ts keeps these up to date; everything else only reads.

export interface Insets {
  top: number; right: number; bottom: number; left: number;
  /**
   * Height of the row of floating controls that sits on top of `bottom` (Fit, Undo, Claim).
   * The camera keeps things out of it when there is room, and uses it when there is not.
   */
  row: number;
}

const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0, row: 0 };

export const env = {
  /** The phone layout is on (`#app` has the class `phone`). */
  phone: false,
  /** The last pointer used was a finger or a pen, so wording says "tap" and nothing relies on hover. */
  touch: false,
  /** The player asked the system for less motion: camera moves jump instead of gliding. */
  calm: false,
  /**
   * How much of each edge of the board is covered by something the player cannot see through
   * (the strip at the top, an open sheet), in pixels. Zero everywhere outside the phone layout.
   */
  cover: (): Insets => NONE,
};

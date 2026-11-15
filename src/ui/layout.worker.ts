// Tidy's Web Worker: the page posts a board (a TidyInput, see layout.ts), this lays it out and posts back
// where each card should go. Started by board.ts (tidyBoard), which runs the same `tidy` on the page
// where a Worker cannot be made. Laying out a big factory takes a few hundred milliseconds on a fast
// machine and more than a second on a slow one: here it never holds up a frame.
import { TidyInput, tidy } from './layout';

// (The project is type-checked against the page's globals, where `self` is a Window.)
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; input: TidyInput }>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (e) => scope.postMessage({ id: e.data.id, moves: [...tidy(e.data.input)] });

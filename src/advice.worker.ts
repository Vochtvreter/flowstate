// The adviser's Web Worker: the page posts a plain copy of the game (an AdviceRequest), this works out what
// the goal card is waiting for and the one tip, and posts the answer back. Started by src/ui/advice-client.ts;
// everything it does is in src/ui/advice-core.ts, so the page can do the same in an idle moment where a
// Worker cannot be made.
import { AdviceRequest, answer } from './ui/advice-core';

// (The project is type-checked against the page's globals, where `self` is a Window.)
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<AdviceRequest>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (e) => scope.postMessage(answer(e.data));

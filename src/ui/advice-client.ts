// The page's side of the adviser: keeps one Web Worker (src/advice.worker.ts), posts it a plain copy of
// the game when a new answer is due, and holds the last answer that came back.
//
// Nothing here ever works a verdict out on the page while the game runs: that takes tens to hundreds of
// milliseconds (see advice-core.ts). The page's own cost is the copy handed to postMessage, a fraction of
// a millisecond, a few times a minute.
//
// When a new answer is due (pollAdviser, called with every HUD refresh):
//  - the board, the goal or the order is no longer what the last answer was about (boardKey);
//  - the answer is older than the adviser says it stands (AdviceAnswer.life: 2 to 15 game seconds);
//  - what the answer says is being saved for has been saved up.
// At most one request is ever out. If the board changes while one is, its answer is thrown away when it
// arrives and the next request is about the board as it is then.
//
// Where a Worker cannot be made, or dies, the same code (advice-core.ts) is loaded into the page and run in
// an idle moment instead: tips still come, at the price of a hitch each time. `?adviser=inline` forces that
// (for tests).
import { activeGoal } from '../goals';
import { Game } from '../state';
import type { AdviceAnswer, AdviceRequest } from './advice-core';
import { isStarted } from './hud-screens';
import { onNewGame } from './ui';

// ---------- what a verdict depends on ----------

let sigGame: Game | null = null;
let sigRev = -1;
let sig = '';
let built = 0;

/** Everything about what is built that the simulation reads: changes when, and only when, that changes. */
function signature(g: Game): string {
  let s = `${g.techs.length}|${g.board.expansions}`;
  for (const n of g.nodes) s += `|${n.id}.${n.type}.${n.recipe ?? ''}.${n.depositId ?? ''}.${n.lv.speed}.${n.lv.eff}.${n.lv.buffer}.${n.mode}`;
  for (const w of g.wires) s += `|${w.id}:${w.from}.${w.port}.${w.to}.${w.tier}.${w.weight}.${w.filter ?? ''}`;
  return s;
}

/**
 * A count of the changes to what is built. Unlike g.rev it does not move when a node is clicked or dragged
 * to another spot (the board bumps g.rev for both): a tip must survive the player selecting the node it is
 * about. Worked out again only when g.rev has moved.
 */
export function builtRev(g: Game): number {
  if (g !== sigGame || g.rev !== sigRev) {
    const s = signature(g);
    if (g !== sigGame || s !== sig) built++;
    sigGame = g;
    sigRev = g.rev;
    sig = s;
  }
  return built;
}

/** What an answer is about, apart from the clock: what is built, the goal, and the order. */
export function boardKey(g: Game): string {
  const o = g.order;
  return `${builtRev(g)}|${g.goal.i}|${g.goal.ready ? 1 : 0}|${o ? `${o.created}${o.ready ? 'r' : ''}` : '-'}`;
}

// ---------- asking ----------

/** After a change, this many milliseconds pass before asking: a gesture often makes several in a row. */
const SETTLE_MS = 120;
/** A request with no answer for this long means the worker is gone. */
const DEAD_MS = 20000;

type Mode = 'worker' | 'inline' | 'off';
let mode: Mode = 'off';
let worker: Worker | null = null;
let inline: ((req: AdviceRequest) => AdviceAnswer) | null = null;
let nextId = 1;
let pending: { id: number; at: number } | null = null;
let last: AdviceAnswer | null = null;
let fresh = true;
let keySeen = '';
let keySince = 0;
const stats = { asked: 0, answered: 0, errors: 0, lastMs: 0, maxMs: 0, why: '' };

/** The last answer that came back, whatever it was about. Compare its `key` with boardKey(g) before showing it. */
export const adviserAnswer = (): AdviceAnswer | null => last;
/** A request is out. */
export const adviserBusy = () => !!pending;

const have = (g: Game, unit: string) => (unit === '¢' ? g.credits : unit === 'α' ? g.data.a : unit === 'β' ? g.data.b : g.data.g);

/** Does the last answer still say what the adviser would say now? */
function current(g: Game, a: AdviceAnswer | null, key: string): boolean {
  if (!a || a.key !== key || g.time < a.time || g.time >= a.time + a.life) return false;
  // What it says is being saved for is in hand: the wait is over, or has moved on to its next part.
  return !(a.info && g.time > a.time + 0.5 && have(g, a.info.unit) >= a.info.need - 1e-6);
}

/** Ask the adviser again if its last answer no longer holds. Cheap; call it with every HUD refresh. */
export function pollAdviser(g: Game) {
  if (mode === 'off' || held || !isStarted()) return;
  const now = performance.now();
  if (pending) {
    if (now - pending.at > DEAD_MS) fail('no answer');
    return;
  }
  // A goal that is ready, or no goal at all: there is nothing to wait for, and nothing is asked.
  if (!activeGoal(g) || g.goal.ready) return;
  const key = boardKey(g);
  if (key !== keySeen) {
    keySeen = key;
    keySince = now;
  }
  if (current(g, last, key)) return;
  if (last?.key !== key && now - keySince < SETTLE_MS) return;
  const req: AdviceRequest = { id: nextId++, key, fresh, game: { ...g, events: [], rev: builtRev(g) } };
  fresh = false;
  pending = { id: req.id, at: now };
  stats.asked++;
  if (mode === 'worker' && worker) {
    try {
      // postMessage copies the game on the spot (a structured clone): what the worker gets is this instant.
      worker.postMessage(req);
    } catch (err) {
      fail(String(err));
    }
  } else void runInline(req);
}

function receive(a: AdviceAnswer) {
  if (!pending || a.id !== pending.id) return;
  pending = null;
  last = a;
  stats.answered++;
  stats.lastMs = a.ms;
  stats.maxMs = Math.max(stats.maxMs, a.ms);
  if (a.error) {
    stats.errors++;
    console.error('adviser:', a.error);
  }
  // Nothing is redrawn for it here: the card picks the answer up at its next refresh, a quarter of a second
  // away at most. (Asking for a redraw at once would also make the board and every panel look themselves
  // over, for an answer that only the goal card shows.)
}

/** The worker cannot be used (any more): from now on the adviser runs on the page, in idle moments. */
function fail(why: string) {
  if (worker) {
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  }
  stats.why = why;
  mode = 'inline';
  pending = null;
  fresh = true;
}

const copy = <T>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T));

async function runInline(req: AdviceRequest) {
  let mine: AdviceRequest;
  try {
    // The copy is taken now: by the time the page is idle the game has moved on.
    mine = copy(req);
    inline ??= (await import('./advice-core')).answer;
  } catch (err) {
    // Not even the code can be had: no tips.
    console.error(err);
    stats.why = String(err);
    mode = 'off';
    pending = null;
    return;
  }
  const run = () => receive(inline!(mine));
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 60);
}

export function initAdviser() {
  const forced = new URLSearchParams(location.search).get('adviser');
  mode = 'inline';
  if (forced !== 'inline' && typeof Worker === 'function') {
    try {
      worker = new Worker(new URL('../advice.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<AdviceAnswer>) => receive(e.data);
      // The script did not load, or something in it threw outside the adviser's own guard.
      worker.onerror = (e) => fail(e.message || 'worker error');
      worker.onmessageerror = () => fail('worker message error');
      mode = 'worker';
    } catch (err) {
      stats.why = String(err);
    }
  } else stats.why = forced === 'inline' ? 'forced' : 'no Worker';
  onNewGame(() => {
    last = null;
    fresh = true;
    keySeen = '';
  });
}

let held = false;
/** For scripts that measure what the adviser costs: while held, nothing is asked. */
export function holdAdviser(on: boolean) {
  held = on;
}

/** For scripts: how the adviser is being run and what it has cost. */
export const adviserStats = () => ({ mode, pending: !!pending, ...stats, last });

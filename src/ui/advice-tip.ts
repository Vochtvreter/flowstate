// The tip row of the goal card, and what the card says about a wait.
//
// The adviser's answers arrive from a Web Worker (advice-client.ts). This file decides what the card does
// with them: when the one tip appears, when it gives way to another, when it has gone stale, and when it
// leaves. All of it is counted in GAME time, so a paused game does not run the clocks down and a script
// that fast-forwards the simulation sees the same card a player would.
//
// The numbers (TIP below), and where they come from. The pacing model's newcomer (tools/pacing.ts, and
// tests/cardPlayer.ts) has a tip on offer from the first moment of a wait and acts on it 15 s later. A
// person first has to notice the row and read it (three or four seconds), then press Show me and do what
// it showed (five or six, the model's own time for one action). So the row appears after 6 s of waiting with
// the board left alone, which lands a person who follows it at about 15 s, where the model has them.
//
// The row never blinks: it appears once, a different tip cross-fades in no sooner than `swap` seconds after
// the last change, and while the adviser is merely being asked again the row keeps what it shows.
//
// Signals (ui.ts): 'tip' with state 'shown' when a tip appears, 'stale' when it has been on offer for
// `stale` seconds with the board unchanged (and again every `stale` seconds), 'gone' when it leaves.
import type { Advice } from '../advice';
import { activeGoal } from '../goals';
import { Game } from '../state';
import { adviserAnswer, boardKey, builtRev } from './advice-client';
import { clearMark, showAdvice } from './advice-show';
import { screenOpen } from './hud-screens';
import { aboutTime, calmMotion, isTouch } from './hud-words';
import { esc } from './icons';
import { signal, ui } from './ui';

export const TIP = {
  /** Game seconds of waiting, with the board left alone, before the tip row appears. */
  delay: 6,
  /** Game seconds a tip is on offer, untouched, before it counts as stale; and between one reminder and the next. */
  stale: 30,
  /** Game seconds between one change of the row (a tip appearing, leaving, or giving way to another) and the next. */
  swap: 4,
  /** While the adviser is being asked again the card keeps what it shows, for at most this many real milliseconds. */
  hold: 3000,
  /** A saving smaller than this many seconds is not mentioned. */
  minSaves: 10,
  /** Milliseconds of cross-fade from one tip to the next. */
  fade: 320,
};

/** The tip on the card, or null. */
let shown: Advice | null = null;
/** What it asks for, as a string: two answers with the same action are the same tip. */
let shownAct = '';
/** g.nextId when it was put there: any node with this id or more was built since. */
let shownMark = 0;
/** The saving the row quotes. Kept until the measured one has moved well away from it, so the number does not flicker. */
let quoted: number | undefined;
/** The sentence that is fading out, during a cross-fade. */
let fading: { text: string; until: number } | null = null;
/** Counts appearances and swaps, and stale reminders: the row's animations restart when these change. */
let turn = 0;
let nag = 0;
/** Since when (game time) the player has been waiting with the board left alone, and what "left alone" was. */
let quietFrom = 0;
let quietKey = '';
/** Game time of the row's last change, and of the next stale reminder. */
let changedAt = -1e9;
let staleAt = Infinity;
/** Real time since which the last answer has not been about the board as it is (0: it is). */
let adrift = 0;
/** A script put this tip here (offerTip): the adviser's answers are not consulted until the board changes. */
let pinned = false;
/** A signal that waits until the row is on screen, so that it can say where the Show me button is. */
let announce: 'shown' | 'stale' | null = null;
let buttonAt = { x: 0, y: 0 };

const actOf = (a: Advice) => JSON.stringify([a.upgrade, a.all, a.wire, a.build, a.node, a.port, a.deposit, a.to, a.favour, a.research, a.cut]);
const sentence = (a: Advice) => (isTouch() ? a.text.touch : a.text.mouse);

function drop(g: Game) {
  fading = null;
  pinned = false;
  if (!shown) return;
  shown = null;
  shownAct = '';
  announce = null;
  changedAt = g.time;
  staleAt = Infinity;
  clearMark();
  signal('tip', { state: 'gone', at: buttonAt });
}

/** Put a tip on the card: the first one of a wait, or (`swap`) another in place of the one on offer. */
function put(g: Game, a: Advice, act: string, swap = false) {
  shown = a;
  shownAct = act;
  shownMark = g.nextId;
  quoted = a.saves;
  turn++;
  changedAt = g.time;
  // A row that changes its mind keeps its age: it goes stale 30 s after a tip was first on offer on this
  // board, whichever tip that was. (The adviser can go back and forth between two near-equal tips for
  // minutes; a clock that started over each time would never run out.)
  if (swap) return;
  nag = 0;
  staleAt = g.time + TIP.stale;
}

/** Forget everything (a new game). */
export function resetTips() {
  pinned = false;
  shown = null;
  shownAct = '';
  fading = null;
  announce = null;
  quietKey = '';
  changedAt = -1e9;
  staleAt = Infinity;
  adrift = 0;
}

/** Bring the row up to date with the game and the adviser's last answer. Call with every refresh of the card, before tipHtml(). */
export function tendTips(g: Game) {
  const now = performance.now();
  if (fading && now >= fading.until) fading = null;
  // The player did something, or the goal moved on: whatever was on offer is about a board that is gone.
  const idle = `${builtRev(g)}|${g.goal.i}`;
  if (idle !== quietKey || g.time < quietFrom) {
    // A tip of two steps ("place a Well on the free deposit and drag from its port to a Lab") whose first
    // step has just been done: the player is in the middle of following it. The adviser's next tip is the
    // second step (it was, in every case tried), and it is shown as soon as it arrives, not after the wait
    // that precedes a tip nobody asked for.
    const midway = !!shown && shown.steps === 2 && !!shown.build && g.nodes.some((n) => n.id >= shownMark && n.type === shown!.build);
    quietKey = idle;
    quietFrom = midway ? g.time - TIP.delay : g.time;
    drop(g);
    if (midway) changedAt = -1e9;
  }
  if (!activeGoal(g) || g.goal.ready) {
    quietFrom = g.time;
    drop(g);
    return;
  }
  // Under the tech tree or a full-screen card nobody is looking at the goal card: nothing new appears there,
  // and the wait before a tip starts over when the board is back.
  const covered = ui.techOpen || screenOpen();
  if (covered && !shown) quietFrom = g.time;
  const a = adviserAnswer();
  if (pinned) {
    // (Only the stale clock below runs.)
  } else if (a && a.key === boardKey(g)) {
    adrift = 0;
    const tip = a.kind ? a.advice : null;
    // Not a wait at all: the card asks for something. The clock starts when the waiting does.
    if (!a.kind) quietFrom = g.time;
    if (!tip) drop(g);
    else {
      const act = actOf(tip);
      if (shown && act === shownAct) {
        // The same suggestion, worked out afresh.
        shown = tip;
        const was = quoted ?? 0, is = tip.saves ?? 0;
        if ((quoted == null) !== (tip.saves == null) || isFinite(was) !== isFinite(is) || Math.abs(is - was) > 0.3 * Math.max(was, TIP.minSaves)) quoted = tip.saves;
      } else if (!covered && g.time - changedAt >= TIP.swap && g.time < a.time + a.life) {
        // (Only an answer the adviser still stands by puts something new on the card: one that is due to be
        // asked again may be about to change, and the row would show a tip only to take it away.)
        if (shown) {
          // The adviser has changed its mind: one sentence fades into the other.
          if (!calmMotion()) fading = { text: sentence(shown), until: now + TIP.fade };
          put(g, tip, act, true);
        } else if (g.time - quietFrom >= TIP.delay) {
          put(g, tip, act);
          announce = 'shown';
        }
      }
    }
  } else {
    // The adviser is being asked again (a new order, say). The row waits for the answer rather than blink.
    if (!adrift) adrift = now;
    else if (shown && now - adrift > TIP.hold) drop(g);
  }
  if (shown && !covered && g.time >= staleAt) {
    staleAt = g.time + TIP.stale;
    nag++;
    announce = 'stale';
  }
}

/** The tip on offer, for scripts and for Show me. */
export const tipShown = (): Advice | null => shown;

/**
 * For scripts: put this tip on the card now, as if the adviser had given it and the wait before a tip were
 * over. It stays, whatever the adviser says, until the board or the goal changes (or the goal is ready).
 */
export function offerTip(g: Game, a: Advice) {
  quietKey = `${builtRev(g)}|${g.goal.i}`;
  quietFrom = g.time - TIP.delay;
  put(g, a, actOf(a));
  pinned = true;
  announce = 'shown';
}

/** The row's HTML, or '' when there is no tip to show. */
export function tipHtml(): string {
  const a = shown;
  if (!a) return '';
  const meta: string[] = [];
  if ((a.cost ?? 0) > 0) meta.push(`<span class="gc-tipcost mono">${Math.round(a.cost!)}¢</span>`);
  if (quoted === Infinity) meta.push('<span>the wait will not end without it</span>');
  else if (quoted != null && quoted >= TIP.minSaves) meta.push(`<span>saves ${aboutTime(quoted)}</span>`);
  // The class names alternate so that the entrance and the reminder play again each time (the row itself is patched in place, never rebuilt).
  return `<div class="gc-tip in${turn % 2}${nag ? ` nag${nag % 2}` : ''}" data-kind="${a.kind}" data-testid="advice-tip">
    <div class="gc-tipbody"><span class="gc-tiptxt"><b>Tip</b>${esc(sentence(a))}</span>${
      fading ? `<span class="gc-tipold" aria-hidden="true"><b>Tip</b>${esc(fading.text)}</span>` : ''}${
      meta.length ? `<span class="gc-tipmeta">${meta.join('<i>·</i>')}</span>` : ''}</div>
    <button class="gc-show" data-act="show" data-testid="advice-show">Show me</button></div>`;
}

/** After the card has been drawn: send the signal that was waiting for the Show me button to be on screen. */
export function announceTips(card: HTMLElement) {
  if (!announce || !shown) return;
  const b = card.querySelector('[data-testid="advice-show"]')?.getBoundingClientRect();
  // Not drawn yet (the card is held while a pointer is down in it): the next refresh tries again.
  if (!b || !b.width) return;
  buttonAt = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  const state = announce;
  announce = null;
  signal('tip', { state, at: buttonAt });
}

/**
 * Show me was pressed: take the player to what the tip is about (advice-show.ts). `render` refreshes the
 * panels at once. A tip that can no longer be done is dropped instead.
 */
export function showTip(g: Game, render: () => void) {
  const a = shown;
  if (!a) return;
  if (showAdvice(g, a, render)) {
    // The player is on it: the reminder starts counting again.
    staleAt = g.time + TIP.stale;
    return;
  }
  drop(g);
  render();
}

// ---------- what the card says about the wait itself ----------

export interface WaitLine {
  unit: '¢' | 'α' | 'β' | 'γ';
  have: number;
  need: number;
  /** Seconds left at the income the adviser measured; Infinity when nothing is coming in. */
  eta: number;
}

const inHand = (g: Game, unit: string) => (unit === '¢' ? g.credits : unit === 'α' ? g.data.a : unit === 'β' ? g.data.b : g.data.g);

/**
 * What the goal is waiting for, by the adviser's last answer (waitInfo in src/advice.ts), counted live: the
 * amounts are the game's own at this moment, and the time left follows from the income the answer measured.
 * `own` is the goal's own count (GoalProgress), which is never out of date.
 * null when there is no such answer for this goal, or when what it names is already in hand: the card then
 * shows the goal's own count.
 */
export function waitLine(g: Game, own: [number, number, string] | null): WaitLine | null {
  const a = adviserAnswer();
  const info = a?.info;
  if (!a || !info || a.goal !== g.goal.i || g.goal.ready) return null;
  if (a.key !== boardKey(g)) {
    // The answer is about the board as it was a moment ago, and the next one is on its way. Where it counts
    // the same thing as the goal does, the goal's own count is shown meanwhile. Where it counts something
    // else (credits for the machine while the card counts Data for the research), it stays for that moment:
    // the line must not jump to the other count and back every time the player touches the board.
    if (!adrift || performance.now() - adrift > TIP.hold) return null;
    if (!own || own[2] === info.unit) return null;
  }
  const have = Math.min(inHand(g, info.unit), info.need);
  if (have >= info.need - 1e-6) return null;
  const rate = isFinite(info.eta) && info.eta > 0 ? (info.need - info.have) / info.eta : 0;
  return { unit: info.unit, have, need: info.need, eta: rate > 1e-9 ? (info.need - have) / rate : Infinity };
}

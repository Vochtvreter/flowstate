// The goal card's two rows of guidance during a wait, and what the card says about the wait itself:
//  - the "while you wait" line: a standing step from the goal itself (Goal.meanwhile in src/goals.ts), with
//    a tick box and, whenever its next gesture can be done right now (lineAdvice in src/advice.ts), a
//    "Show me" button;
//  - the tip: the adviser's one suggestion, which arrives from a Web Worker (advice-client.ts).
//
// This file decides when each row appears, what it reads, when it has gone stale and when it leaves. All of
// it is counted in GAME time, so a paused game does not run the clocks down and a script that fast-forwards
// the simulation sees the same card a player would. (Only the opening and closing of a row, and the
// cross-fade between two tips, run on the real clock: they are animations.)
//
// One voice. While a line is up and not done, a tip that asks for the line's own next step is not shown as
// a tip. Where the card is narrow (a phone, or a desktop stage squeezed by the inspector: `narrow`), at most
// one of the two rows is on the card: the line while it is not done, the tip otherwise. Reminders ('stale')
// come from the line's button while it has one, not from both.
//
// What a move bought. When the player has done what a tip said, its row stays for the length of the
// adviser's quiet (RULES.tips.quiet, the 20 s in which it says nothing new) and reads what that bought:
// "Assembly about 1 min 20 s sooner", from the saving the adviser measured for the tip. A line that has
// just been ticked says the same beside its label, from how much nearer the end of the wait has come
// between the moment before its first gesture and the adviser's first look at the board after its last.
//
// The numbers (TIP below), and where they come from. The pacing model's newcomer (tools/pacing.ts, and
// tests/cardPlayer.ts) has a tip on offer from the first moment of a wait and acts on it 15 s later. A
// person first has to notice the row and read it (three or four seconds), then press Show me and do what
// it showed (five or six, the model's own time for one action). So the row appears after 6 s of waiting with
// the board left alone, which lands a person who follows it at about 15 s, where the model has them.
//
// The tip row never blinks: it appears once, a different tip cross-fades in no sooner than `swap` seconds
// after the last change, and while the adviser is merely being asked again the row keeps what it shows.
//
// Signals (ui.ts): 'tip' with state 'shown' when a tip appears, 'stale' when it has been on offer for
// `stale` seconds with the board unchanged (and again every `stale` seconds), 'gone' when it leaves. The
// same three are sent for the line's Show me button: 'shown' when the button is first on the card, 'stale'
// after `stale` seconds undone with the board untouched and every `stale` seconds after, 'gone' when the
// line is done or leaves (or its step can no longer be done). `at` is the middle of the button.
import { Advice, lineAdvice } from '../advice';
import { RULES } from '../content';
import { GoalView, activeGoal } from '../goals';
import { Game } from '../state';
import { adviserAnswer, boardKey, builtRev } from './advice-client';
import { Offered, carriedOut, clearMark, doable, offeredAt, showAdvice } from './advice-show';
import { screenOpen } from './hud-screens';
import { aboutSpan, aboutTime, calmMotion, capFirst, isTouch } from './hud-words';
import { esc, icon } from './icons';
import { signal, ui } from './ui';

export const TIP = {
  /** Game seconds of waiting, with the board left alone, before the tip row appears. */
  delay: 6,
  /** Game seconds a tip (or the line's step) is on offer, untouched, before it counts as stale; and between one reminder and the next. */
  stale: 30,
  /** Game seconds between one change of the row (a tip appearing, leaving, or giving way to another) and the next. */
  swap: 4,
  /** While the adviser is being asked again the card keeps what it shows, for at most this many real milliseconds. */
  hold: 3000,
  /** A saving smaller than this many seconds is not mentioned. */
  minSaves: 10,
  /** Milliseconds of cross-fade from one tip to the next. */
  fade: 320,
  /** Milliseconds a row takes to open or to close (advice.css): the card grows and shrinks, it does not jump. */
  row: 240,
  /** Game seconds the second half of a two-gesture tip stays on offer once the first half is done. */
  half: 90,
  /** Real milliseconds between two looks at the line's next step while the board is left alone. */
  step: 1000,
};

const actOf = (a: Advice) => JSON.stringify([a.upgrade, a.all, a.wire, a.build, a.node, a.port, a.deposit, a.to, a.favour, a.research, a.cut, a.expand]);
const sentence = (a: Advice) => (isTouch() ? a.text.touch : a.text.mouse);
/** The HTML of a row that is closing or fading: nothing in it answers a press, and no script takes it for the real thing. */
const inert = (html: string) => html.replace(/\s(?:data-testid|data-act|title)="[^"]*"/g, '');

/** Where a row's Show me button was, once the row says what was done: the words keep their place. */
const GONE = '<span class="gc-show gone" aria-hidden="true">Show me</span>';

// ---------- what is seen of the board, from one refresh to the next ----------

/** What "the board left alone" was at the last refresh: what is built, and the goal. */
let seenKey = '';
let seenBuilt = -1;
let seenGoal = -1;
let seenTime = 0;

// ---------- the tip ----------

/** The tip on the card, or null. */
let shown: Advice | null = null;
/** What it asks for, as a string: two answers with the same action are the same tip. */
let shownAct = '';
/** The board when it was put there: to tell whether a change to the board was the tip being carried out. */
let shownMark: Offered = { nextId: 0, level: 0, expansions: 0 };
/**
 * A tip of two gestures ("place a Well on the free deposit, wired to the Lab") whose first has been done:
 * the second (the wire), which Show me now shows. The row keeps its sentence. The adviser is quiet after
 * any change to the board, so it would not say the second half itself for 20 s.
 */
let half: Advice | null = null;
let halfUntil = 0;
/** The saving the row quotes. Kept until the measured one has moved well away from it, so the number does not flicker. */
let quoted: number | undefined;
/** The sentence that is fading out, during a cross-fade. */
let fading: { text: string; until: number } | null = null;
/** Counts appearances and swaps, and stale reminders: the row's animations restart when these change. */
let turn = 0;
let nag = 0;
/** The row opened from nothing (it was not a swap): it grows into place. Real time, for whoever waits for it to be there. */
let opened = false;
let openedAt = 0;
/** Since when (game time) the player has been waiting with the board left alone. */
let quietFrom = 0;
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
/** What a tip that was followed has bought: its row says so until `until` (game time). */
let after: { text: string; lead: string; flow?: number; goal: number; from: number; until: number } | null = null;
/** A row on its way out: what it last showed, until its closing animation is over (real time). */
let tipOut: { html: string; until: number } | null = null;
/** The inside of the tip row as it was last drawn. */
let tipInner = '';

/** The tip leaves the card. With `closing`, its row closes; without, something else takes the row's place at once. */
function drop(g: Game, closing = true) {
  fading = null;
  pinned = false;
  half = null;
  if (!shown) return;
  shown = null;
  shownAct = '';
  announce = null;
  changedAt = g.time;
  staleAt = Infinity;
  clearMark();
  if (closing) closeTip();
  signal('tip', { state: 'gone', at: buttonAt });
}

function closeTip() {
  tipOut = tipInner && !calmMotion() ? { html: inert(tipInner), until: performance.now() + TIP.row } : null;
}

/** Put a tip on the card: the first one of a wait, or (`swap`) another in place of the one on offer. */
function put(g: Game, a: Advice, act: string, swap = false) {
  // It opens as a new row unless it takes the place of one that is there (another tip, or what the last one bought).
  if (!swap) {
    opened = !after;
    openedAt = opened ? performance.now() : 0;
  }
  after = null;
  tipOut = null;
  half = null;
  shown = a;
  shownAct = act;
  shownMark = offeredAt(g, a);
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

/** "Assembly", "The Fabricator", "The order": what the wait is for, as the start of a sentence. */
function subject(): string {
  const a = adviserAnswer();
  if (a?.info?.name) return capFirst(a.info.name);
  return a?.kind === 'order' ? 'The order' : 'This goal';
}

/** What a saving of this many seconds has bought, in words. '' when it is too small to claim. */
function boughtText(saves: number | undefined): string {
  if (saves === Infinity) return `${subject()} is on its way now`;
  if (saves != null && saves >= TIP.minSaves) return `${subject()} ${aboutSpan(saves)} sooner`;
  return '';
}

/** What the tip promises, as the row's first words. */
function leadText(a: Advice): string {
  if (quoted === Infinity) return 'The wait will not end without it';
  if (quoted != null && quoted >= TIP.minSaves) return `${capFirst(aboutTime(quoted))} sooner`;
  return a.kind === 'flow' ? 'Brings Flow up' : 'A little sooner';
}

/**
 * A tip's sentence and its price apart: the adviser writes the price into the sentence ("... buy Speed on
 * the Ember Well (50¢)."), and the row says it once, after the sentence.
 */
function priced(a: Advice): { text: string; price: string } {
  const text = sentence(a);
  const cost = Math.round(a.cost ?? 0);
  if (cost <= 0) return { text, price: '' };
  const inText = ` (${cost}¢)`;
  return { text: text.includes(inText) ? text.replace(inText, '') : text, price: `${cost}¢` };
}

/** Bring the tip row up to date with the game and the adviser's last answer. */
function tendTip(g: Game, now: number, changed: boolean, sameGoal: boolean, narrow: boolean) {
  if (fading && now >= fading.until) fading = null;
  if (tipOut && now >= tipOut.until) tipOut = null;
  if (after && (after.goal !== g.goal.i || g.time < after.from)) after = null;
  else if (after && g.time >= after.until) {
    // It has said what the move bought: the row closes.
    after = null;
    closeTip();
  }
  // The player did something, or the goal moved on: whatever was on offer is about a board that is gone.
  if (changed) {
    let keep = false;
    if (shown && sameGoal) {
      const did = carriedOut(g, half ?? shown, shownMark);
      const to = shown.to;
      if (did?.state === 'half' && did.built != null && to != null && !half) {
        // The first gesture of two is done. The row stays, and Show me now shows the second: the wire.
        half = { kind: shown.kind, text: shown.text, eta: shown.eta, saves: shown.saves, cost: 0, node: did.built, wire: { from: did.built, to, port: 0 }, steps: 1 };
        halfUntil = g.time + TIP.half;
        shownMark = offeredAt(g, half);
        staleAt = g.time + TIP.stale;
        pinned = false;
        clearMark();
        keep = true;
      } else if (did?.state === 'done') {
        // The tip was followed: for the length of the adviser's quiet its row says what that bought.
        const lead = shown.kind === 'flow' && !(quoted != null && quoted >= TIP.minSaves) ? '' : boughtText(quoted);
        after = { text: priced(shown).text, lead, goal: g.goal.i, from: g.time, until: g.time + RULES.tips.quiet, ...(lead ? {} : shown.kind === 'flow' ? { flow: g.flow } : {}) };
      }
    }
    quietFrom = g.time;
    // (With the goal, the whole card changes: no row of the last one closes inside the new one.)
    if (!keep) drop(g, sameGoal && !after);
    if (!sameGoal) tipOut = null;
  }
  if (!activeGoal(g) || g.goal.ready) {
    quietFrom = g.time;
    after = null;
    drop(g, false);
    tipOut = null;
    return;
  }
  // The second half of a tip waits for its wire, not for the adviser: until it is made, cannot be made any more, or has waited long enough.
  if (half && (g.time >= halfUntil || !doable(g, half))) drop(g);
  // Under the tech tree or a full-screen card nobody is looking at the goal card: nothing new appears there,
  // and the wait before a tip starts over when the board is back.
  const covered = ui.techOpen || screenOpen();
  if (covered && !shown) quietFrom = g.time;
  // One voice: the line's own next step is not a tip as well, and a narrow card has room for one row.
  const lineIs = line && !line.done && step ? actOf(step) : '';
  const blocked = narrow && lineHolds(g);
  const a = adviserAnswer();
  // Is the adviser's last answer about the board as it is? If not, it is being asked again (a new order, say).
  const current = !!a && a.key === boardKey(g);
  if (current) adrift = 0;
  else if (!adrift) adrift = now;
  if (blocked) {
    quietFrom = g.time;
    if (after) {
      after = null;
      tipOut = null;
    }
    drop(g);
  } else if (pinned || half) {
    // (Only the stale clock below runs.)
  } else if (a && current) {
    let tip = a.kind ? a.advice : null;
    // Not a wait at all: the card asks for something. The clock starts when the waiting does.
    if (!a.kind) quietFrom = g.time;
    if (tip && lineIs && actOf(tip) === lineIs) tip = null;
    if (!tip) drop(g);
    else {
      const act = actOf(tip);
      if (shown && act === shownAct) {
        // The same suggestion, worked out afresh. The saving the row quotes follows only when the measured
        // one has moved well away from it; and once it is a number it stays a number: near the end of what
        // the adviser can look ahead, the same tip comes back as "five minutes" and as "would never end" by
        // turns, and the row must not say both every fifteen seconds.
        shown = tip;
        const is = tip.saves;
        if (quoted == null || !isFinite(quoted)) quoted = is ?? quoted;
        else if (is != null && isFinite(is) && Math.abs(is - quoted) > 0.3 * Math.max(quoted, TIP.minSaves)) quoted = is;
      } else if (!covered && g.time - changedAt >= TIP.swap && g.time < a.time + a.life) {
        // (Only an answer the adviser still stands by puts something new on the card: one that is due to be
        // asked again may be about to change, and the row would show a tip only to take it away.)
        if (shown) {
          // The adviser has changed its mind: one sentence fades into the other.
          if (!calmMotion()) fading = { text: priced(shown).text, until: now + TIP.fade };
          put(g, tip, act, true);
        } else if (g.time - quietFrom >= TIP.delay) {
          put(g, tip, act);
          announce = 'shown';
        }
      }
    }
  } else if (shown && now - adrift > TIP.hold) {
    // The row waited for the new answer rather than blink, and has waited long enough.
    drop(g);
  }
  if (shown && !covered && g.time >= staleAt) {
    staleAt = g.time + TIP.stale;
    // (While the line has a Show me of its own the reminders are the line's: one voice.)
    if (!lineUp) {
      nag++;
      announce = 'stale';
    }
  }
}

/** The tip on offer, for scripts and for Show me. */
export const tipShown = (): Advice | null => shown;
/** For scripts: what the tip row says a followed tip bought, or null. */
export const tipBought = (): string | null => (after ? after.lead || 'Done' : null);

/**
 * For scripts: put this tip on the card now, as if the adviser had given it and the wait before a tip were
 * over. It stays, whatever the adviser says, until the board or the goal changes (or the goal is ready).
 */
export function offerTip(g: Game, a: Advice) {
  quietFrom = g.time - TIP.delay;
  // With a tip already there it takes its place as a change of mind does: a cross-fade, and no new signal.
  const swap = !!shown;
  if (shown && !calmMotion()) fading = { text: priced(shown).text, until: performance.now() + TIP.fade };
  put(g, a, actOf(a), swap);
  pinned = true;
  if (!swap) announce = 'shown';
}

/** The tip row's HTML, or '' when there is none to show. */
export function tipHtml(g: Game): string {
  const a = shown;
  if (!a) {
    if (after) {
      // What the tip that was followed bought, over its sentence, which has been done.
      let lead = after.lead;
      if (!lead && after.flow != null) {
        const was = Math.round(after.flow * 100), is = Math.round(g.flow * 100);
        lead = is > was ? `Flow up from ${was}% to ${is}%` : 'Done: Flow follows in a few seconds';
      }
      tipInner = `<div class="gc-tipbody"><span class="gc-tiplead"><b class="gc-tipbadge ok">${icon('check', 11)}</b><strong data-testid="tip-bought">${esc(lead || 'Done')}</strong></span><span class="gc-tiptxt">${esc(after.text)}</span></div>${GONE}`;
      return `<div class="gc-tip gc-row done" data-testid="advice-done"><div class="gc-in">${tipInner}</div></div>`;
    }
    return tipOut ? `<div class="gc-tip gc-row out" aria-hidden="true"><div class="gc-in">${tipOut.html}</div></div>` : '';
  }
  const { text, price } = priced(a);
  // The class names alternate so that the entrance and the reminder play again each time (the row itself is patched in place, never rebuilt).
  tipInner = `<div class="gc-tipbody"><span class="gc-tiplead"><b class="gc-tipbadge">${half ? 'Tip · 2 of 2' : 'Tip'}</b><strong data-testid="tip-lead">${esc(leadText(a))}</strong></span><span class="gc-tiptxt">${esc(text)}${
    price ? ` <span class="gc-tipcost mono">${price}</span>` : ''}</span>${
    fading ? `<span class="gc-tipold" aria-hidden="true">${esc(fading.text)}</span>` : ''}</div>
    <button class="gc-show" data-act="show" data-testid="advice-show">Show me</button>`;
  return `<div class="gc-tip gc-row${opened ? ' open' : ''} in${turn % 2}${nag ? ` nag${nag % 2}` : ''}" data-kind="${a.kind}" data-testid="advice-tip"><div class="gc-in">${tipInner}</div></div>`;
}

/**
 * Show me was pressed on the tip: take the player to what it is about (advice-show.ts). `render` refreshes
 * the panels at once. A tip that can no longer be done is dropped instead.
 */
export function showTip(g: Game, render: () => void) {
  const a = half ?? shown;
  if (!a) return;
  if (showAdvice(g, a, render)) {
    // The player is on it: the reminder starts counting again.
    staleAt = g.time + TIP.stale;
    return;
  }
  drop(g);
  render();
}

// ---------- the "while you wait" line ----------

interface Line {
  goal: number;
  text: string;
  done: boolean;
  /** It came up in the middle of a goal (not together with the card): its row opens. Real time. */
  openedAt: number;
  /** Game time it was ticked before the player's eyes (0: it was done already when it came up), and until when it says what that bought. */
  tickedAt: number;
  until: number;
  /** Real time of the tick: the box pops. */
  popAt: number;
}

let line: Line | null = null;
/** The goal the card was last drawn for: a line that comes up for the same goal has come up in the middle of it. */
let cardGoal = -1;
/** The line's row on its way out, as for the tip. */
let lineOut: { html: string; until: number } | null = null;
let lineInner = '';
/** Was the line's row on the card at the last refresh? */
let lineWasOn = false;
/** The line's next gesture (lineAdvice), looked at again when the board changes and once a second. */
let step: Advice | null = null;
let stepMark: Offered = { nextId: 0, level: 0, expansions: 0 };
let stepKey = '';
let stepAsked = 0;
/** The line's Show me button: asked for, announced ('shown' sent), where it is, and its reminders. */
let lineUp = false;
let lineSaid = false;
let lineAnnounce: 'shown' | 'stale' | null = null;
let lineAt = { x: 0, y: 0 };
let lineStaleAt = Infinity;
let lineNag = 0;
/**
 * How much nearer the end of the wait has come through the line's gestures. `open` is the time left as it
 * stood before a gesture whose effect the adviser has not looked at yet; `sum` what the gestures looked at so
 * far have added up to; `ends`: the wait would not have ended and now will; `known` false when a gesture
 * came before the adviser had seen the wait at all.
 */
let gain = { sum: 0, ends: false, open: null as { eta: number; at: number } | null, known: true };
/** The time left on the wait, by the adviser's last answer about the board as it is. */
let etaSeen: { built: number; goal: number; eta: number; at: number } | null = null;

const inHand = (g: Game, unit: string) => (unit === '¢' ? g.credits : unit === 'α' ? g.data.a : unit === 'β' ? g.data.b : g.data.g);

/** Seconds left on the wait right now, when the adviser's last answer is about the board as it is; else null. */
function liveEta(g: Game): number | null {
  const a = adviserAnswer();
  const info = a?.info;
  if (!a || !info || a.key !== boardKey(g) || a.goal !== g.goal.i) return null;
  const have = Math.min(inHand(g, info.unit), info.need);
  if (have >= info.need - 1e-6) return 0;
  const rate = isFinite(info.eta) && info.eta > 0 ? (info.need - info.have) / info.eta : 0;
  return rate > 1e-9 ? (info.need - have) / rate : Infinity;
}

function lineStepNow(g: Game): Advice | null {
  try {
    return lineAdvice(g);
  } catch (err) {
    console.error('line:', err);
    return null;
  }
}

/** Is the line's row on the card? A line that is done stays where there is room for it; on a narrow card only while it says what it bought. */
function lineOn(g: Game, narrow: boolean): boolean {
  if (!line) return false;
  return !line.done || !narrow || (line.tickedAt > 0 && g.time < line.until);
}
/** While this holds, a narrow card shows the line and no tip. */
const lineHolds = (g: Game) => !!line && (!line.done || (line.tickedAt > 0 && g.time < line.until));

function lineGone() {
  if (lineSaid) signal('tip', { state: 'gone', at: lineAt });
  lineUp = lineSaid = false;
  lineAnnounce = null;
  lineStaleAt = Infinity;
  lineNag = 0;
}

function closeLine() {
  lineOut = lineInner && !calmMotion() ? { html: inert(lineInner), until: performance.now() + TIP.row } : null;
}

function tendLine(g: Game, v: GoalView | null, now: number, changed: boolean, sameGoal: boolean, narrow: boolean) {
  if (lineOut && now >= lineOut.until) lineOut = null;
  // The time left on the wait, whenever the adviser has looked at the board as it is: a gesture of the line
  // that was waiting to be measured is measured against it.
  const eta = liveEta(g);
  if (eta != null) {
    const open = gain.open;
    if (open) {
      const before = open.eta - (g.time - open.at);
      if (!isFinite(open.eta)) gain.ends = gain.ends || isFinite(eta);
      else if (isFinite(eta)) gain.sum += before - eta;
      else gain.known = false;
      gain.open = null;
    }
    etaSeen = { built: builtRev(g), goal: g.goal.i, eta, at: g.time };
  }
  const mw = v && !v.ready ? v.meanwhile ?? null : null;
  if (!mw) {
    // No line (any more). In the middle of a goal its row closes; with the goal, the whole card changes anyway.
    if (line) {
      if (lineWasOn && line.goal === g.goal.i && !g.goal.ready) closeLine();
      lineGone();
    }
    line = null;
    step = null;
    stepKey = '';
    lineWasOn = false;
    if (!sameGoal && changed) lineOut = null;
    return;
  }
  if (!line || line.goal !== g.goal.i) {
    lineGone();
    line = { goal: g.goal.i, text: mw.text, done: mw.done, openedAt: cardGoal === g.goal.i ? now : 0, tickedAt: 0, until: 0, popAt: 0 };
    gain = { sum: 0, ends: false, open: null, known: true };
    step = null;
    stepKey = '';
    lineOut = null;
  }
  line.text = mw.text;
  const key = `${builtRev(g)}|${g.goal.i}`;
  if (changed && sameGoal && !line.done) {
    // The board changed while the line stood undone. Was that one of its gestures? It was if the line is now
    // done, if the step it had on offer has been carried out, or if its next step is another one now.
    const was = step;
    const next = mw.done ? null : lineStepNow(g);
    const did = mw.done || (!!was && !!carriedOut(g, was, stepMark)) || (!!was && !!next && actOf(was) !== actOf(next));
    if (did && !gain.open) {
      if (etaSeen && etaSeen.built === seenBuilt && etaSeen.goal === g.goal.i) gain.open = { eta: etaSeen.eta, at: etaSeen.at };
      else gain.known = false;
    }
    step = next;
    stepMark = next ? offeredAt(g, next) : stepMark;
    stepKey = key;
    stepAsked = now;
    // "With the board untouched": the reminder counts from here again.
    if (lineUp) lineStaleAt = g.time + TIP.stale;
    clearMark();
  }
  if (mw.done && !line.done) {
    line.done = true;
    line.tickedAt = g.time;
    line.until = g.time + RULES.tips.quiet;
    line.popAt = now;
  } else if (!mw.done && line.done) {
    // Undone again (the player took it back): the line is an open step once more.
    line.done = false;
    line.tickedAt = 0;
    gain = { sum: 0, ends: false, open: null, known: true };
    stepKey = '';
  }
  if (line.done) step = null;
  else if (key !== stepKey || now - stepAsked >= TIP.step) {
    // lineAdvice only looks at the board (no copy of the game is run): cheap enough for the page, once a second.
    const next = lineStepNow(g);
    if (!next || !step || actOf(next) !== actOf(step)) stepMark = next ? offeredAt(g, next) : stepMark;
    step = next;
    stepKey = key;
    stepAsked = now;
  }
  const on = lineOn(g, narrow);
  // On a narrow card the line that has said what it bought leaves, and its row closes.
  if (lineWasOn && !on) closeLine();
  lineWasOn = on;
  // The Show me button, and the signals about it.
  const covered = ui.techOpen || screenOpen();
  const up = on && !line.done && !!step;
  if (up && !lineUp) {
    lineUp = true;
    lineSaid = false;
    lineAnnounce = 'shown';
    lineNag = 0;
    lineStaleAt = g.time + TIP.stale;
  } else if (!up && lineUp) lineGone();
  if (lineUp && lineSaid && !covered && g.time >= lineStaleAt) {
    lineStaleAt = g.time + TIP.stale;
    lineNag++;
    lineAnnounce = 'stale';
  }
}

/** What the line that has just been ticked bought, in words; '' when that is over or does not apply. */
function lineBought(g: Game): string {
  if (!line || !line.done || !line.tickedAt || g.time >= line.until) return '';
  if (gain.open || !gain.known) return 'Done';
  if (gain.ends) return `${subject()} is on its way now`;
  return boughtText(gain.sum) || 'Done';
}

/** The line's row, or '' when the card has none. `narrow`: the card has room for one row of guidance. */
export function lineHtml(g: Game, narrow: boolean): string {
  if (!line || !lineOn(g, narrow)) {
    return lineOut ? `<div class="gc-line gc-row out" aria-hidden="true"><div class="gc-in">${lineOut.html}</div></div>` : '';
  }
  const now = performance.now();
  const bought = lineBought(g);
  const title = step ? ` title="${esc(sentence(step))}"` : '';
  // The tick, then the label over the sentence (or run in before it, where every line counts: hud.css), then the button.
  lineInner = `<span class="gc-tick" role="img" aria-label="${line.done ? 'Done' : 'Not done yet'}">${icon('check', 12)}</span>
    <div class="gc-linebody"><span class="gc-linehead"><span class="gc-lbl">While you wait</span>${bought ? `<span class="gc-bought" data-testid="line-bought">${esc(bought)}</span>` : ''}</span>
    <span class="gc-linetxt">${esc(line.text)}</span></div>${
    step && !line.done ? `<button class="gc-show" data-act="show-line" data-testid="line-show"${title}>Show me</button>` : line.tickedAt ? GONE : ''}`;
  const cls = `${line.openedAt ? ' open' : ''}${line.done ? ' done' : ''}${bought ? ' said' : ''}${line.done && now - line.popAt < 700 ? ' pop' : ''}${lineNag ? ` nag${lineNag % 2}` : ''}`;
  return `<div class="gc-line gc-row${cls}" data-done="${line.done ? 1 : 0}" data-testid="goal-line"><div class="gc-in">${lineInner}</div></div>`;
}

/** Show me was pressed on the line: take the player to its next gesture, exactly as for a tip. */
export function showLine(g: Game, render: () => void) {
  const a = line && !line.done ? lineStepNow(g) : null;
  if (a && showAdvice(g, a, render)) {
    step = a;
    stepMark = offeredAt(g, a);
    lineStaleAt = g.time + TIP.stale;
    return;
  }
  // It cannot be done any more (the credits were spent a moment ago): the button goes until it can.
  step = null;
  stepKey = `${builtRev(g)}|${g.goal.i}`;
  stepAsked = performance.now();
  render();
}

/** For scripts: the line on the card, its next gesture and what it says it bought. */
export const lineShown = () => (line ? { text: line.text, done: line.done, step, bought: lineBought(ui.g), up: lineUp } : null);

// ---------- both rows ----------

/** Forget everything (a new game). */
export function resetTips() {
  pinned = false;
  shown = null;
  shownAct = '';
  half = null;
  fading = null;
  announce = null;
  after = null;
  tipOut = null;
  seenKey = '';
  seenBuilt = seenGoal = -1;
  changedAt = -1e9;
  staleAt = Infinity;
  adrift = 0;
  line = null;
  lineOut = null;
  lineWasOn = false;
  step = null;
  stepKey = '';
  lineUp = lineSaid = false;
  lineAnnounce = null;
  cardGoal = -1;
  etaSeen = null;
  gain = { sum: 0, ends: false, open: null, known: true };
}

/**
 * Bring both rows up to date with the game, the goal card's view of it and the adviser's last answer. Call
 * with every refresh of the card, before lineHtml() and tipHtml(). `narrow`: the card has room for one row.
 */
export function tendCard(g: Game, v: GoalView | null, narrow: boolean) {
  const now = performance.now();
  const built = builtRev(g);
  const key = `${built}|${g.goal.i}`;
  const back = g.time < seenTime;
  const changed = key !== seenKey || back;
  const sameGoal = changed && !back && seenGoal === g.goal.i;
  tendLine(g, v, now, changed, sameGoal, narrow);
  tendTip(g, now, changed, sameGoal, narrow);
  seenKey = key;
  seenBuilt = built;
  seenGoal = g.goal.i;
  seenTime = g.time;
  cardGoal = v ? g.goal.i : -1;
}

/** After the card has been drawn: send the signals that were waiting for a Show me button to be on screen. */
export function announceTips(card: HTMLElement) {
  const now = performance.now();
  const middle = (testid: string) => {
    const b = card.querySelector(`[data-testid="${testid}"]`)?.getBoundingClientRect();
    // Not drawn yet (the card is held while a pointer is down in it): the next refresh tries again.
    return b && b.width ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
  };
  // (A row that is still opening is not where it will be: whoever points at the button waits for it.)
  if (announce && shown && now - openedAt >= TIP.row) {
    const at = middle('advice-show');
    if (at) {
      buttonAt = at;
      const state = announce;
      announce = null;
      signal('tip', { state, at });
    }
  }
  if (lineAnnounce && lineUp && line && now - line.openedAt >= TIP.row && !(ui.techOpen || screenOpen())) {
    const at = middle('line-show');
    if (at) {
      lineAt = at;
      const state = lineAnnounce;
      lineAnnounce = null;
      lineSaid = true;
      signal('tip', { state, at });
    }
  }
}

// ---------- what the card says about the wait itself ----------

export interface WaitLine {
  unit: '¢' | 'α' | 'β' | 'γ';
  have: number;
  need: number;
  /** Seconds left at the income the adviser measured; Infinity when nothing is coming in. */
  eta: number;
}

/**
 * What the goal is waiting for, by the adviser's last answer (waitInfo in src/advice.ts), counted live: the
 * amounts are the game's own at this moment, and the time left follows from the income the answer measured.
 * null when there is no such answer for this goal, or when what it names is already in hand: the card then
 * shows the goal's own count (GoalProgress), which is never out of date.
 */
export function waitLine(g: Game): WaitLine | null {
  const a = adviserAnswer();
  const info = a?.info;
  if (!a || !info || a.goal !== g.goal.i || g.goal.ready) return null;
  // The answer is about the board as it was a moment ago (the player touched it, or an order came or went),
  // and the next one is on its way. For that moment the line stays as it is, with the amounts of this instant
  // and the income of a moment ago: it must not lose its "about 3 min", or jump to the goal's other count
  // (Data for the research, while this counts credits for the machine) and back, every time that happens.
  if (a.key !== boardKey(g) && (!adrift || performance.now() - adrift > TIP.hold)) return null;
  const have = Math.min(inHand(g, info.unit), info.need);
  if (have >= info.need - 1e-6) return null;
  const rate = isFinite(info.eta) && info.eta > 0 ? (info.need - info.have) / info.eta : 0;
  return { unit: info.unit, have, need: info.need, eta: rate > 1e-9 ? (info.need - have) / rate : Infinity };
}

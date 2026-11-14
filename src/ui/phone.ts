// Phone and touch: the small-screen shell, bottom sheets and the floating buttons.
// The gestures themselves (pinch, wiring by tap) live in board.ts; this file decides when the phone
// layout is on, tells the rest of the interface what kind of pointer is in use, and measures what
// covers the board (the HUD's strip at the top, sheets, the thumb row) so the camera can keep things
// in view.
//
// For the other modules:
//   - `#app.phone` (and `html.phone`) is set here; `html[data-input]` is 'touch' or 'mouse'.
//   - CSS variables on `#app`: --strip-h (how far the strip reaches down the stage; 0 outside the
//     phone layout), --strip-b (the same, on every layout), --lift (height of an open bottom
//     sheet), --shift (width of a sheet docked at the side, on short landscape screens). phone.css
//     adds --top-h and --hot-h (the two bars).
//   - The strip is the HUD's: #goal, #order and #hud-alert inside #hud-strip. It is measured, never
//     moved, here; its phone layout and the place of the Claim button are CSS (hud.css, "phone seating").
//   - `#app.carrying` while a node is being moved, `#app.building` while the build sheet is open,
//     `#app.hint-open` while the goal card shows its hint on a phone held sideways (where it folds).
//   - `#thumb-slot` holds the one-line "tap where…" hint, for touch input on any screen.
//   - `swipeToDismiss()` below works for any sheet.
//   - For scripts: `flowstate.phone.cover()`, `.strip()` and `.corner()` return what the camera is told.
import { MATERIALS, NODE_DEFS } from '../content';
import { canUndo, undo } from '../actions';
import {
  armedPort, cancelArmed, cancelGesture, closeRadial, ensureVisible, fitView, gestureActive, refreshBoard, settleGesture,
} from './board';
import { el, invalidateLayout, setAttr, setClass, setHTML, setHidden, setStyle } from './dom';
import { PressWord } from './hud-words';
import { icon } from './icons';
import { Insets, StripBox, env } from './phone-env';
import { delegate, onBeat, onFrame, onNewGame, select, touch, ui } from './ui';

let app: HTMLElement;
let stage: HTMLElement;
let insp: HTMLElement | null;
let build: HTMLElement | null;
let goalEl: HTMLElement | null;
let orderEl: HTMLElement | null;
let alertEl: HTMLElement | null;
let zoomEl: HTMLElement | null;
let miniEl: HTMLElement | null;
let thumb: HTMLElement;
let hint: HTMLElement;
let hintText: HTMLElement;
let undoBtn: HTMLElement;

/** The phone layout: a narrow screen, or a short one held sideways. */
const wantsPhone = () => window.innerWidth < 700 || (window.innerWidth > window.innerHeight && window.innerHeight < 500);

let lastWidth = 0;
/** Frames until the board is framed again (the panels must draw first: their height decides where the free space is). */
let refit = 0;

function applyLayout(first = false) {
  const phone = wantsPhone();
  const turned = Math.abs(window.innerWidth - lastWidth) > 40;
  lastWidth = window.innerWidth;
  if (phone === env.phone && !first && !(phone && turned)) return;
  env.phone = phone;
  app.classList.toggle('phone', phone);
  document.documentElement.classList.toggle('phone', phone);
  measuredKey = '';
  invalidateLayout();
  refit = 2;
  if (first) return;
  // The stage has a different size and the build menu a different shape: start both afresh.
  refreshBoard();
  touch();
}

function setInput(touchy: boolean) {
  const root = document.documentElement;
  const value = touchy ? 'touch' : 'mouse';
  if (root.dataset.input === value) return;
  root.dataset.input = value;
  env.touch = touchy;
  if (ui.g) touch();
}

// ---------- what covers the board ----------

const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0, row: 0 };
/** Height of the thumb row: the floating buttons alone, and with the Claim button beside them. */
const THUMB_ROW = 44;
const CLAIM_ROW = 54;
let measuredKey = '';
let coverNow: Insets = NONE;
let stripNow: StripBox | null = null;
let cornerNow: { x0: number; y0: number } | null = null;
/** Bumped whenever the strip, a sheet or the stage changed size (see the ResizeObserver in initPhone). */
let sizeRev = 0;
let sizeSeen = 0;
/** Height of the stage, and of the goal card's hint when it was last on show (it folds away: see `sync`). */
let stageH = 0;
let hintH = 0;
/** The share of the stage the strip may take on an upright phone before the card folds its hint. */
const STRIP_SHARE = 0.45;
const shortLandscape = typeof matchMedia === 'function' ? matchMedia('(orientation: landscape) and (max-height: 520px)') : null;

const isOpen = (e: HTMLElement | null): e is HTMLElement => !!e && e.classList.contains('open');
const carrying = () => app.classList.contains('carrying');

/** The height of an open bottom sheet (0 when none), and the width of one docked at the side. */
function sheetSize(): { lift: number; shift: number } {
  let lift = 0, shift = 0;
  if (env.phone) {
    const sw = stage.offsetWidth;
    for (const s of [insp, build]) {
      // (While its node is being carried the inspector waits out of sight: see `carrying` in phone.css.)
      if (!isOpen(s) || (s === insp && carrying())) continue;
      if (s.offsetWidth >= sw * 0.7) lift = Math.max(lift, s.offsetHeight);
      else shift = Math.max(shift, s.offsetWidth + 8);
    }
  }
  return { lift, shift };
}

/**
 * Measure what lies over the board. The strip is the HUD's goal card, order chip and alert chip
 * (toasts come and go; the camera does not move for them). On a phone the strip spans the stage, so
 * it hides the top of it; an open sheet hides the bottom (or the side, on a short landscape screen),
 * and the thumb row (Fit, Undo, and Claim when a goal is ready) floats on top of whatever is at the
 * bottom. Measured from layout boxes, not from where things are drawn, so a sheet that is still
 * sliding in already counts at its full height. Measured again only when something may have changed.
 */
function measure() {
  const g = ui.g;
  const key = env.phone
    ? `p|${ui.uiRev}|${g?.rev}|${sizeRev}|${isOpen(insp) ? 1 : 0}${isOpen(build) ? 1 : 0}${carrying() ? 1 : 0}${g?.goal.ready ? 1 : 0}`
    : `d|${sizeRev}`;
  if (key === measuredKey) return;
  measuredKey = key;
  let x0 = Infinity, x1 = -Infinity, bottom = 0, goalBottom = 0;
  for (const e of [goalEl, orderEl, alertEl]) {
    const h = e ? e.offsetHeight : 0;
    if (!e || !h) continue;
    // (#hud, which these are measured against, fills the stage.)
    const left = e.offsetLeft, foot = e.offsetTop + h;
    x0 = Math.min(x0, left);
    x1 = Math.max(x1, left + e.offsetWidth);
    bottom = Math.max(bottom, foot);
    if (e === goalEl) goalBottom = foot;
  }
  stripNow = bottom > 0 ? { x0, x1, bottom, goalBottom } : null;
  if (!env.phone) {
    coverNow = NONE;
    // The zoom buttons over the minimap, in the stage's bottom right corner.
    let cx = Infinity, cy = Infinity;
    for (const e of [zoomEl, miniEl]) {
      if (!e || !e.offsetHeight) continue;
      cx = Math.min(cx, e.offsetLeft);
      cy = Math.min(cy, e.offsetTop);
    }
    cornerNow = cx < Infinity ? { x0: cx, y0: cy } : null;
    return;
  }
  cornerNow = null;
  stageH = stage.offsetHeight;
  const hintEl = goalEl?.querySelector<HTMLElement>('.gc-hint');
  if (hintEl?.offsetHeight) hintH = hintEl.offsetHeight + 2;
  const { lift, shift } = sheetSize();
  coverNow = { top: bottom, right: shift, bottom: lift, left: 0, row: (g?.goal.ready ? CLAIM_ROW : THUMB_ROW) + 16 };
}

function cover(): Insets {
  if (!env.phone) return NONE;
  measure();
  return coverNow;
}

function strip(): StripBox | null {
  measure();
  return stripNow;
}

function corner(): { x0: number; y0: number } | null {
  measure();
  return cornerNow;
}

// ---------- sheets ----------

/**
 * Let a sheet be swiped down by its grab handle or its header to dismiss it. The sheet follows
 * the finger; past a quarter of its height, or with a quick flick (400 px a second), it goes.
 * Any sheet can use this: give it a `.sheet-grab` child (phone.css draws the handle) and call
 * this once; `dismiss` should take away whatever class shows the sheet.
 */
export function swipeToDismiss(sheet: HTMLElement, dismiss: () => void) {
  let id = -1, x0 = 0, y0 = 0, dy = 0, on = false;
  let settle = 0;
  // Where the finger was about a tenth of a second ago, for its speed at the moment it lifts.
  let py = 0, pt = 0, qy = 0, qt = 0;
  sheet.addEventListener('pointerdown', (e) => {
    if (!env.phone || id !== -1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const t = e.target as HTMLElement;
    if (!t.closest('.sheet-grab, .sec.head, .bhead') || t.closest('button')) return;
    id = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    dy = 0;
    py = qy = y0;
    pt = qt = performance.now();
    on = false;
  });
  sheet.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    dy = e.clientY - y0;
    const now = performance.now();
    if (now - qt > 60) {
      py = qy;
      pt = qt;
      qy = e.clientY;
      qt = now;
    }
    if (!on) {
      if (dy < 8 || Math.abs(e.clientX - x0) > dy) return;
      on = true;
      clearTimeout(settle);
      sheet.setPointerCapture(id);
      sheet.classList.add('swiping');
    }
    sheet.style.transform = `translateY(${Math.max(0, dy - 8)}px)`;
  });
  // Chromium takes a quick drag it was not told about for the start of a fling, and then swallows
  // the next tap anywhere on the page. Claiming the moves of a swipe in progress prevents that.
  sheet.addEventListener('touchmove', (e) => {
    if (on && e.cancelable) e.preventDefault();
  }, { passive: false });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = -1;
    if (!on) return;
    on = false;
    sheet.classList.remove('swiping');
    const speed = (e.clientY - py) / Math.max(16, performance.now() - pt);
    const quick = dy > 24 && speed > 0.4;
    const gone = e.type === 'pointerup' && (quick || dy > Math.max(56, sheet.offsetHeight * 0.25));
    if (gone) {
      // It carries on down from where the finger left it; the class that keeps it hidden follows.
      sheet.style.transform = 'translateY(105%)';
      dismiss();
    } else sheet.style.transform = '';
    settle = window.setTimeout(() => (sheet.style.transform = ''), 320);
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

// ---------- floating buttons, thumb slot, hint ----------

function buildChrome() {
  const fabs = el(`<div id="fabs">
    <button class="fab" data-act="fab-fit" data-testid="fab-fit" aria-label="Show my supply line">${icon('fit', 20)}</button>
    <button class="fab" data-act="fab-undo" data-testid="fab-undo" aria-label="Undo">${icon('undo', 20)}</button>
  </div>`);
  // (The actions have their own names so that `[data-act="undo"]` still means the top bar's button.)
  undoBtn = fabs.querySelector<HTMLElement>('[data-act="fab-undo"]')!;
  delegate(fabs, (a) => {
    if (a === 'fab-undo') {
      // Whatever the fingers were in the middle of is settled first, so the two cannot tangle.
      settleGesture();
      cancelGesture();
      undo(ui.g);
    } else if (a === 'fab-fit') fitView(true);
    sync();
  });

  thumb = el(`<div id="thumb-slot"><div id="tap-hint" hidden><span class="th"></span><button data-act="hint-cancel" aria-label="Cancel">${icon('close', 18)}</button></div></div>`);
  hint = thumb.querySelector<HTMLElement>('#tap-hint')!;
  hintText = hint.querySelector<HTMLElement>('.th')!;
  delegate(thumb, (a) => {
    if (a !== 'hint-cancel') return;
    if (!cancelArmed() && ui.placing) {
      ui.placing = null;
      touch();
    }
    sync();
  });
  stage.append(thumb, fabs);
}

/**
 * What the player is in the middle of, said in one line, with a way out. Shown in the phone layout,
 * and for touch input on any screen: a finger cannot hover, so nothing else says what a tap will do.
 */
function hintLine(): string {
  const verb = PressWord();
  const armed = armedPort();
  if (armed) return armed.mat ? `${verb} where the <b>${MATERIALS[armed.mat].name}</b> should go` : `${verb} where this wire should go`;
  const p = ui.placing;
  if (p) return p.type === 'well' ? `${verb} a deposit to place the <b>Well</b>` : `${verb} the board to place the <b>${NODE_DEFS[p.type].name}</b>`;
  return '';
}

let seenUi = -1;
let seenRev = -1;
/** The goal whose hint was last opened by itself, and whether the hint is open. */
let hintGoal = -1;
let hintOpen = false;
/** The card folds its hint behind a tap (`#app.fold`): see below. */
let fold = false;
let coverSeen = '';

function setHintOpen(on: boolean) {
  hintOpen = on;
  setClass(app, 'hint-open', on);
}

/** Bring the phone chrome in line with the game. Everything is written only when it changed. */
function sync() {
  const g = ui.g;
  if (!g) return;
  seenUi = ui.uiRev;
  seenRev = g.rev;
  sizeSeen = sizeRev;
  setAttr(undoBtn, 'disabled', canUndo() ? null : '');
  const line = env.phone || env.touch ? hintLine() : '';
  setHidden(hint, !line);
  if (line) setHTML(hintText, line);
  // Where the goal card folds its hint away, a new goal starts with the hint open.
  if (g.goal.i !== hintGoal) {
    hintGoal = g.goal.i;
    hintH = 0;
    setHintOpen(true);
  }
  measure();
  const c = coverNow;
  // The card folds its hint behind a tap where the strip would otherwise take too much of the board:
  // always on a phone held sideways, and upright while the strip with the hint in it would pass 45%
  // of the stage. (Judged with the hint counted in, folded or not, so the answer cannot flip-flop.)
  const withHint = c.top + (fold && !hintOpen ? hintH : 0);
  fold = env.phone && (!!shortLandscape?.matches || (stageH > 0 && withHint > stageH * STRIP_SHARE));
  if (setClass(app, 'fold', fold)) sizeRev++;
  // How tall the strip is decides how tall a sheet may be (see phone.css), so that comes first.
  let moved = setStyle(app, '--strip-h', c.top + 'px');
  // (--strip-b is the same on every layout: where the strip ends, for whatever wants to sit under it.)
  setStyle(app, '--strip-b', (stripNow?.bottom ?? 0) + 'px');
  if (setStyle(app, '--lift', c.bottom + 'px')) moved = true;
  if (setStyle(app, '--shift', c.right + 'px')) moved = true;
  // While the build menu is up the player is choosing from it: the floating controls step aside.
  setClass(app, 'building', isOpen(build));
  // The thumb row (and the Claim button in it) has moved: whatever cached its place measures again.
  if (moved) invalidateLayout();
  // Something covers a different part of the board than a moment ago (the card grew a tip, an order
  // arrived, Claim appeared, a sheet opened): the selected node is brought back into view.
  const s = stripNow;
  const now = `${c.top}|${c.right}|${c.bottom}|${c.row}|${s ? `${s.x0},${s.x1},${s.bottom}` : ''}`;
  if (now !== coverSeen) {
    coverSeen = now;
    if (ui.sel?.kind === 'node' && !gestureActive()) ensureVisible(ui.sel.id);
  }
}

// ---------- init ----------

export function initPhone() {
  app = document.getElementById('app')!;
  stage = document.getElementById('stage')!;
  insp = document.getElementById('insp');
  build = document.getElementById('build-sheet');
  goalEl = document.getElementById('goal');
  orderEl = document.getElementById('order');
  alertEl = document.getElementById('hud-alert');
  zoomEl = document.getElementById('zoom');
  miniEl = document.getElementById('mini');

  // Wording follows the pointer in use. Until the first press, a device whose only pointer is a
  // finger is taken to be touch, so the very first hint already says "tap".
  const mq = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  setInput(mq('(pointer: coarse)') && !mq('(any-pointer: fine)'));
  window.addEventListener('pointerdown', (e) => setInput(e.pointerType !== 'mouse'), { capture: true, passive: true });

  const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  env.calm = !!motion?.matches;
  motion?.addEventListener?.('change', () => (env.calm = motion.matches));

  buildChrome();
  env.cover = cover;
  env.strip = strip;
  env.corner = corner;
  applyLayout(true);
  window.addEventListener('resize', () => applyLayout());
  window.addEventListener('orientationchange', () => applyLayout());

  if (insp) swipeToDismiss(insp, () => select(null));
  if (build) swipeToDismiss(build, () => closeRadial());

  // The page itself never zooms, scrolls or pops up a menu: the game is the whole screen.
  // (touch-action in phone.css does most of this; these catch what it does not.)
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', stop);
  document.addEventListener('gesturechange', stop);
  app.addEventListener('contextmenu', (e) => {
    if (env.touch) e.preventDefault();
  });
  window.addEventListener('scroll', () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  }, { passive: true });

  // The goal card folds its hint away on a phone held sideways: a tap on the card (not on a button
  // in it) opens and closes it, and a press on the board closes it, since the board is what is short.
  goalEl?.addEventListener('click', (e) => {
    if (!env.phone || (e.target as HTMLElement).closest('button')) return;
    setHintOpen(!hintOpen);
  });
  document.getElementById('board')?.addEventListener('pointerdown', () => {
    if (hintOpen) setHintOpen(false);
  }, { capture: true, passive: true });

  // Sizes are watched rather than polled: the strip grows and shrinks with the goal, a sheet with its
  // contents. The notice is only recorded here; the next frame measures and writes.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => void sizeRev++);
    for (const e of [stage, goalEl, orderEl, alertEl, insp, build]) if (e) ro.observe(e);
  } else onBeat(() => void sizeRev++);

  onFrame(() => {
    const g = ui.g;
    if (ui.uiRev !== seenUi || g.rev !== seenRev || sizeRev !== sizeSeen) sync();
    // (On every layout: the first framing happens before the goal card has any text in it.)
    if (refit && --refit === 0) {
      fitView();
      // (Framing everything may have put the selected node under a sheet or the strip.)
      if (ui.sel?.kind === 'node') ensureVisible(ui.sel.id);
    }
  });
  onNewGame(() => {
    measuredKey = '';
    hintGoal = -1;
    refit = 2;
    sync();
  });

  // main.ts builds window.flowstate after the modules have started, so this joins it a moment later.
  const attach = () => {
    const hook = (window as unknown as { flowstate?: Record<string, unknown> }).flowstate;
    if (!hook) return false;
    hook.phone ??= { cover, strip, corner, env };
    return true;
  };
  queueMicrotask(() => {
    if (!attach()) setTimeout(attach, 0);
  });
}

// Phone and touch: the small-screen shell, bottom sheets and the floating buttons.
// Owned by the phone track. The gestures themselves (pinch, wiring by tap) live in board.ts;
// this file decides when the phone layout is on, tells the rest of the interface what kind of
// pointer is in use, and measures what covers the board so the camera can keep things in view.
//
// For the other tracks:
//   - `#app.phone` (and `html.phone`) is set here; `html[data-input]` is 'touch' or 'mouse'.
//   - CSS variables on `#app.phone`: --top-h (top bar), --hot-h (bottom hotbar), --strip-h (how far
//     the strip reaches down the stage), --lift (height of an open bottom sheet), --shift (width
//     of a sheet docked at the side, on short landscape screens).
//   - `#thumb-slot` sits just above the hotbar: put a Claim button in it and it is in thumb reach.
//   - Anything in `#stage` with the class `strip-item` joins the strip at the top (see phone.css).
import { MATERIALS, NODE_DEFS } from '../content';
import { canUndo, undo } from '../actions';
import { armedPort, cancelArmed, cancelGesture, closeRadial, fitView, refreshBoard, settleGesture } from './board';
import { el, invalidateLayout, setAttr, setClass, setHTML, setHidden, setStyle } from './dom';
import { icon } from './icons';
import { Insets, env } from './phone-env';
import { delegate, onBeat, onFrame, onNewGame, select, touch, ui } from './ui';

let app: HTMLElement;
let stage: HTMLElement;
let insp: HTMLElement | null;
let build: HTMLElement | null;
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
  coverKey = '';
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
/** Height of the floating buttons in the thumb row. */
const THUMB_ROW = 44;
let coverKey = '';
let coverNow: Insets = NONE;
let beats = 0;

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
 * How much of each edge of the stage is hidden: by the strip at the top, by an open sheet at the
 * bottom (or at the side, on a short landscape screen) and by whatever sits in the thumb slot.
 * Measured from layout boxes, not from where things are drawn, so a sheet that is still sliding
 * in already counts at its full height. Measured again only when something may have changed.
 */
function cover(): Insets {
  if (!env.phone) return NONE;
  const key = `${ui.uiRev}|${ui.g?.rev}|${beats}|${isOpen(insp) ? 1 : 0}${isOpen(build) ? 1 : 0}${carrying() ? 1 : 0}`;
  if (key === coverKey) return coverNow;
  coverKey = key;
  let top = 0;
  for (const c of stage.children) {
    const e = c as HTMLElement;
    // The goal card and the chips under it. (Toasts come and go; the camera does not move for them.)
    if (!(e.id === 'objective' || e.id === 'alert' || e.classList.contains('strip-item'))) continue;
    if (e.offsetHeight) top = Math.max(top, e.offsetTop + e.offsetHeight);
  }
  const { lift, shift } = sheetSize();
  // The thumb row (Fit, Undo, and whatever is in the slot) floats on top of whatever is at the bottom.
  const row = Math.max(THUMB_ROW, thumb.offsetHeight) + 16;
  coverNow = { top, right: shift, bottom: lift, left: 0, row };
  return coverNow;
}

// ---------- sheets ----------

/**
 * Let a sheet be swiped down by its grab handle or its header to dismiss it. The sheet follows
 * the finger; past a quarter of its height, or with a quick flick (400 px a second), it goes.
 */
function swipeToDismiss(sheet: HTMLElement, dismiss: () => void) {
  let id = -1, x0 = 0, y0 = 0, dy = 0, on = false;
  let settle = 0;
  // Where the finger was about a tenth of a second ago, for its speed at the moment it lifts.
  let py = 0, pt = 0, qy = 0, qt = 0;
  sheet.addEventListener('pointerdown', (e) => {
    if (!env.phone || id !== -1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const t = e.target as HTMLElement;
    if (!t.closest('.grab, .sec.head, .bhead') || t.closest('button')) return;
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

/** What the player is in the middle of, said in one line, with a way out. Only shown in the phone layout. */
function hintLine(): string {
  const verb = env.touch ? 'Tap' : 'Click';
  const armed = armedPort();
  if (armed) return armed.mat ? `${verb} where the <b>${MATERIALS[armed.mat].name}</b> should go` : `${verb} where this wire should go`;
  const p = ui.placing;
  if (p) return p.type === 'well' ? `${verb} a deposit to place the <b>Well</b>` : `${verb} the board to place the <b>${NODE_DEFS[p.type].name}</b>`;
  return '';
}

let seenUi = -1;
let seenRev = -1;

/** Bring the phone chrome in line with the game. Everything is written only when it changed. */
function sync() {
  const g = ui.g;
  if (!g) return;
  seenUi = ui.uiRev;
  seenRev = g.rev;
  setAttr(undoBtn, 'disabled', canUndo() ? null : '');
  const line = env.phone ? hintLine() : '';
  setHidden(hint, !line);
  if (line) setHTML(hintText, line);
  // How tall the strip is decides how tall a sheet may be (see phone.css), so that comes first.
  setStyle(app, '--strip-h', (env.phone ? cover().top : 0) + 'px');
  const { lift, shift } = sheetSize();
  setStyle(app, '--lift', lift + 'px');
  setStyle(app, '--shift', shift + 'px');
  // While the build menu is up the player is choosing from it: the floating controls step aside.
  setClass(app, 'building', isOpen(build));
}

// ---------- init ----------

export function initPhone() {
  app = document.getElementById('app')!;
  stage = document.getElementById('stage')!;
  insp = document.getElementById('insp');
  build = document.getElementById('build');

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

  onFrame(() => {
    const g = ui.g;
    if (ui.uiRev !== seenUi || g.rev !== seenRev) sync();
    if (refit && --refit === 0 && env.phone) fitView();
  });
  onBeat(() => {
    beats++;
    sync();
  });
  onNewGame(() => {
    coverKey = '';
    refit = 2;
    sync();
  });
}

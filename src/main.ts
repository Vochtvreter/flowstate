import './style.css';
import './styles/tech.css';
import './styles/hud.css';
import './styles/advice.css';
import './styles/feel.css';
import './styles/phone.css';
import { clearHistory, cutWire, deleteNode, nodeById, redo, refundOf, undo } from './actions';
import { fmt, fmtTime, has, offlineCap } from './economy';
import { offlineGains, tick } from './sim';
import { clearSave, loadGame, newGame, saveGame } from './state';
import {
  cancelGesture, ensureVisible, fitView, frameNodes, initBoard, jumpTo, pickRadial, radialOpen, settleGesture, startPlacing,
  tidyBoard, updateBoard, updateSlow, zoomBy,
} from './ui/board';
import { invalidateLayout } from './ui/dom';
import { fx, initFx } from './ui/fx';
import { hotbarTypes, initPanels, renderPanels, tickPanels } from './ui/panels';
import { closeTech, initTech, openTech, renderTech } from './ui/tech';
import { initFeel } from './ui/feel';
import { adviserStats, boardKey, holdAdviser } from './ui/advice-client';
import { TIP, lineShown, offerTip, tipBought, tipShown } from './ui/advice-tip';
import { focusSeen, markedControl, stillMarks } from './ui/advice-show';
import { alertState, hudAnchors, initHud, setElsewhere, setLineFields } from './ui/hud';
import { backToStart, initScreens, isStarted, screenOpen, screensApi, showStart } from './ui/hud-screens';
import { initPhone } from './ui/phone';
import { emitBeat, emitFrame, emitGame, emitNewGame, initToasts, onSignal, select, toast, touch, ui } from './ui/ui';

const STEP = 0.05;
/** Seconds between refresh beats for on-board numbers and panels (see the frame loop). */
const SLOW_STEP = 0.25;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** When the loaded save was written (ms), until the player presses Continue; null for a new game. */
let resumedFrom: number | null = null;

/** The save's key in localStorage (state.ts). */
const SAVE_KEY = 'flowstate-save-v1';
/**
 * Another tab has written the save since this page loaded: this one no longer saves, so that neither tab can
 * overwrite what the other has done. It says so (hud.ts) and a reload takes the game up where the other left it.
 */
let elsewhere = false;

/** Nothing is saved before the player has pressed Start: a game nobody began is not a save to continue. */
function save() {
  if (isStarted() && !elsewhere) saveGame(ui.g);
}

/** Erase everything and return to the start screen. The one way a game is replaced. */
function resetGame() {
  clearSave();
  // A game begun afresh here is this tab's own, even in a tab that had stepped back for another: it saves again.
  // (The other tab heard the save cleared, and steps back in its turn.)
  elsewhere = false;
  ui.g = newGame();
  resumedFrom = null;
  clearHistory();
  ui.menuOpen = false;
  ui.placing = null;
  select(null);
  if (ui.techOpen) closeTech();
  fitView();
  emitNewGame();
  backToStart();
  renderPanels(true);
}

/** The game starts running. A loaded save is first credited with the time it was away. */
function begin() {
  // This is the tab being played now: it writes the save at once (once the start screen has done its part), so
  // that another tab still open on the same game hears of it and stops saving.
  setTimeout(save, 0);
  const g = ui.g;
  const from = resumedFrom;
  resumedFrom = null;
  if (from == null || g.paused) return null;
  const away = (Date.now() - from) / 1000;
  if (away <= 30) return null;
  const seconds = Math.min(away, offlineCap(g));
  return { seconds, gains: offlineGains(g, seconds) };
}

function boot() {
  const loaded = loadGame();
  ui.g = loaded ?? newGame();
  resumedFrom = loaded ? loaded.savedAt : null;
  initToasts($('toasts'));
  initFx($<HTMLCanvasElement>('fx'));
  initBoard($('board'));
  initTech($('tech'));
  initPanels(
    { top: $('top'), hot: $('hot'), insp: $('insp'), mini: $<HTMLCanvasElement>('mini'), zoom: $('zoom') },
    { openTech, closeTech, reset: resetGame },
  );
  initScreens({ reset: resetGame, begin });
  // Feature modules: each owns its own file and subscribes through the hooks in ui/ui.ts.
  initHud();
  initFeel();
  initPhone();
  fitView();
  // The start screen ("Continue" when there is a save). `?play` in the URL skips it.
  showStart(!!loaded);
  ui.g.events.length = 0;
  renderPanels();
  window.addEventListener('resize', () => {
    invalidateLayout();
    touch();
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', save);
  // Two tabs on one game: when the other writes the save, this one stops saving and says so.
  window.addEventListener('storage', (e) => {
    if (e.key !== SAVE_KEY || elsewhere) return;
    try {
      if (e.storageArea && e.storageArea !== localStorage) return;
    } catch {
      return;
    }
    elsewhere = true;
    setElsewhere();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
  });
  setInterval(save, 10000);
  // Test hooks. `ui` and `tick` are relied on by scripts; the rest are there for convenience.
  (window as unknown as Record<string, unknown>).flowstate = {
    ui, tick, fx, view: { fit: fitView, zoomBy, jumpTo, frame: frameNodes, tidy: tidyBoard }, onSignal,
    // (The HUD: the screens, where effects start from, what the alert slot says, the last look at the goal's nodes, and
    // fields laid over the goal's line, for scripts that show the card's side of `required` and `held`.)
    hud: { ...screensApi, anchors: hudAnchors, alert: alertState, focus: focusSeen, lineFields: setLineFields },
    // The adviser: how it is run and what it cost; the tip on the card and its timing; the control "Show me" ringed,
    // and the still marks it stood on the board under reduced motion; the goal card's "while you wait" line with its
    // next step; what the tip row says a followed tip bought.
    adviser: {
      stats: adviserStats, hold: holdAdviser, key: () => boardKey(ui.g), tip: tipShown, offer: (a: Parameters<typeof offerTip>[1]) => { offerTip(ui.g, a); renderPanels(true); },
      marked: markedControl, stills: stillMarks, TIP, line: lineShown, bought: tipBought,
    },
  };
  requestAnimationFrame(frame);
}

function drainEvents() {
  const g = ui.g;
  if (!g.events.length) return;
  // Toasts, effects and sound all hang on these (the HUD's toasts are in ui/hud-toasts.ts).
  for (const ev of g.events.splice(0)) emitGame(ev);
}

let last = performance.now();
let acc = 0;
let slow = 0;
let beat = false;
let techTimer = 0;
let seenUi = -1;
let seenRev = -1;
let seenSel = '';

function frame(now: number) {
  // Whatever goes wrong in one frame, the next one is always scheduled.
  try {
    step(now);
  } finally {
    requestAnimationFrame(frame);
  }
}

function step(now: number) {
  const g = ui.g;
  const real = (now - last) / 1000;
  last = now;
  // Behind the start screen nothing moves: no ticks, no wire dots, no beats.
  let dt = isStarted() ? real : 0;
  if (dt > 5) {
    // The tab was in the background: credit the time away in one go.
    if (!g.paused) {
      const secs = Math.min(dt, offlineCap(g));
      const gains = offlineGains(g, secs);
      if (gains.credits >= 1) toast(`Back after ${fmtTime(secs)}: <span class="mono" style="color:#FFC857">+${fmt(gains.credits)}¢</span>`, 'good', 5000);
    }
    dt = 0;
  }
  if (!g.paused) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 120) {
      tick(g, STEP);
      acc -= STEP;
      n++;
    }
    if (n >= 120) acc = 0;
  }
  drainEvents();
  if (ui.uiRev !== seenUi || g.rev !== seenRev) {
    // Something structural changed: refresh panels right away rather than on the slow timer.
    const selKey = ui.sel ? `${ui.sel.kind}${ui.sel.id}` : '';
    seenUi = ui.uiRev;
    seenRev = g.rev;
    renderPanels();
    // A node just selected is brought into view, once the frame that opened its inspector has been laid out: the
    // strip and the stage settle around the inspector only then, and a look taken now would see them mid-change
    // (a needless 24 px camera step at 1024x768). Not if the selection has moved on meanwhile.
    if (selKey !== seenSel && ui.sel?.kind === 'node') {
      const id = ui.sel.id;
      requestAnimationFrame(() => {
        if (ui.sel?.kind === 'node' && ui.sel.id === id) ensureVisible(id);
      });
    }
    seenSel = selKey;
  }
  updateBoard(dt);
  tickPanels(dt);
  emitFrame(dt);
  slow += dt;
  techTimer += dt;
  // Refreshing text costs the browser a full rendering pass, so it is done on a slow beat. The
  // board's share is split over alternate beats to keep each of those frames short: node cards on
  // one, wires on the next (twice a second each). Panels are cheap when nothing changed, so they
  // are checked on every beat.
  if (slow >= SLOW_STEP) {
    slow = 0;
    beat = !beat;
    updateSlow(beat ? 'nodes' : 'wires');
    renderPanels();
    emitBeat();
  }
  if (ui.techOpen && techTimer >= 0.5) {
    techTimer = 0;
    renderTech();
  }
}

function onKey(e: KeyboardEvent) {
  const g = ui.g;
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  // The start screen, the summary and the time-away card take the keyboard for themselves.
  if (screenOpen()) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const edit = mod && (k === 'z' || k === 'y' || k === 'd');
  // While the tech tree is open the board behind it is out of reach: undo, redo and duplicate wait until it closes
  // (the top bar's Undo and Redo are disabled meanwhile, panels.ts).
  if (edit && ui.techOpen) {
    e.preventDefault();
    return;
  }
  // Before a key changes the board, a node still being dragged is dropped, so the two cannot tangle.
  if (edit || k === 'delete' || k === 'backspace') settleGesture();
  if (mod && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(g);
    else undo(g);
    return renderPanels();
  }
  if (mod && k === 'y') {
    e.preventDefault();
    redo(g);
    return renderPanels();
  }
  if (mod && k === 'd') {
    e.preventDefault();
    const n = ui.sel?.kind === 'node' ? nodeById(g, ui.sel.id) : null;
    if (n) startPlacing(n.type, n.recipe);
    return;
  }
  if (mod || e.altKey) return;
  if (k === 'escape') {
    // Escape first backs out of whatever the pointer is in the middle of.
    if (cancelGesture()) return renderPanels();
    if (ui.techOpen) closeTech();
    else if (ui.menuOpen) { ui.menuOpen = false; touch(); }
    else if (ui.placing) { ui.placing = null; touch(); }
    else if (ui.sel) select(null);
    return renderPanels();
  }
  if (ui.techOpen) {
    if (k === 'r') closeTech();
    return;
  }
  if (/^[0-9]$/.test(k)) {
    const i = k === '0' ? 9 : Number(k) - 1;
    if (radialOpen()) pickRadial(i);
    else {
      const type = hotbarTypes(g)[i];
      if (type) startPlacing(type);
    }
    return renderPanels();
  }
  if (k === 'delete' || k === 'backspace') {
    e.preventDefault();
    if (ui.sel?.kind === 'node') {
      const n = nodeById(g, ui.sel.id);
      if (n) {
        const refund = refundOf(g, n);
        // A refusal (the last Well) raises its own toast, and the node stays selected.
        if (!deleteNode(g, n.id)) return renderPanels();
        if (refund > 0) toast(`Refunded <b>${fmt(refund)}¢</b>`, 'good');
      }
    } else if (ui.sel?.kind === 'wire') cutWire(g, ui.sel.id);
    select(null);
    return renderPanels();
  }
  if (k === 'r' && has(g, 'R1')) openTech();
  else if (k === 'p') { g.paused = !g.paused; touch(); }
  else if (k === 'f') fitView();
}

boot();

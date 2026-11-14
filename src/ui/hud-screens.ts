// Full-screen cards: the start screen, the end-of-demo summary and the time-away card.
// Owned by the HUD track.
//
// Contracts with the other modules:
//  - #app gets the class `started` the moment the player presses Start or Continue. Until then the
//    simulation does not run (main.ts asks isStarted()) and nothing is saved.
//  - `?play` in the URL skips the start screen, also after a reset. Scripts rely on it.
//  - The summary opens SUMMARY_DELAY seconds after the 'demo-end' event; the celebration plays in
//    between. `?nosummary` keeps it shut (for benchmarks that build a finished factory).
import { MATERIALS, RULES } from '../content';
import { endStats, fmt, fmtInt, fmtTime } from '../economy';
import { activeGoal, claimGoal } from '../goals';
import { AwayGains } from '../sim';
import { matGlyph } from './icons';
import { onFrame, onGame, onNewGame, touch, ui } from './ui';

export const SUMMARY_DELAY = 6.5;

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const SKIP_START = params.has('play');
const NO_SUMMARY = params.has('nosummary');

export interface ScreenHooks {
  /** Erase the save and put a fresh game in ui.g. */
  reset(): void;
  /** The game starts running (Start, Continue, or `?play`). Returns what was earned while away, if anything. */
  begin(): { seconds: number; gains: AwayGains } | null;
}

let hooks: ScreenHooks;
let app: HTMLElement;
let startEl: HTMLElement;
let summaryEl: HTMLElement;
let modalEl: HTMLElement;
let started = false;
let summaryOpen = false;
let modalOpen = false;
/** performance.now() at which the summary opens, or 0. */
let summaryDue = 0;
let pendingAway: { seconds: number; gains: AwayGains } | null = null;

// ---------- what the HUD remembers outside the save ----------
// One flag: the player has seen the summary and chosen to keep playing. It lives next to the save
// (not in it) and is cleared with it.

const FLAG_KEY = 'flowstate-hud-v1';

function summaryDone(): boolean {
  try {
    return !!JSON.parse(localStorage.getItem(FLAG_KEY) ?? '{}').summaryDone;
  } catch {
    return false;
  }
}

function setSummaryDone(done: boolean) {
  try {
    if (done) localStorage.setItem(FLAG_KEY, JSON.stringify({ summaryDone: true }));
    else localStorage.removeItem(FLAG_KEY);
  } catch {
    /* storage unavailable: the summary may show once more after a reload */
  }
}

// ---------- state other modules ask about ----------

/** The player has pressed Start or Continue: the simulation may run and the game may be saved. */
export const isStarted = () => started;
/** A full-screen card is up: keyboard shortcuts for the board are ignored. */
export const screenOpen = () => !started || summaryOpen || modalOpen;

/**
 * While a full-screen card is up, nothing behind it can be reached: the cards already catch every
 * pointer, and `inert` keeps Tab from walking to the pause button or the hotbar underneath, where
 * Enter would press them unseen. Everything in #app except the cards themselves is covered, so
 * whatever another module adds there is covered too.
 */
function coverBehind() {
  const covered = screenOpen();
  for (const e of Array.from(app.children)) {
    if (e !== startEl && e !== summaryEl && e !== modalEl) e.toggleAttribute('inert', covered);
  }
}

export function initScreens(h: ScreenHooks) {
  hooks = h;
  app = document.getElementById('app')!;
  startEl = document.getElementById('start')!;
  summaryEl = document.getElementById('summary')!;
  modalEl = document.getElementById('modal')!;

  startEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-do]');
    if (!b) return;
    if (b.dataset.do === 'start') begin();
    else if (b.dataset.do === 'new' && confirm('Start a new game? Your saved supply line will be erased.')) {
      hooks.reset();
      begin();
    }
  });
  summaryEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-do]');
    if (!b) return;
    if (b.dataset.do === 'keep') keepPlaying();
    else if (b.dataset.do === 'over' && confirm('Start over? This erases your whole supply line and all research.')) hooks.reset();
  });
  window.addEventListener('keydown', (e) => {
    if (summaryOpen && e.key === 'Escape') keepPlaying();
  });

  onGame((ev) => {
    if (ev.kind === 'demo-end' && !NO_SUMMARY) summaryDue = performance.now() + SUMMARY_DELAY * 1000;
  });
  onFrame(() => {
    if (!summaryDue || !started || performance.now() < summaryDue) return;
    summaryDue = 0;
    openSummary();
  });
  onNewGame(() => {
    summaryDue = 0;
    pendingAway = null;
    closeSummary();
    closeModal();
  });
}

// ---------- start screen ----------

const LOGO = `<svg viewBox="0 0 28 28" width="64" height="64" aria-hidden="true"><path d="M10 8c8 0 4 12 8 12" fill="none" stroke="#9DB8FF" stroke-width="1.8" stroke-linecap="round"/><circle cx="6" cy="8" r="4" fill="#FFD84D"/><circle cx="22" cy="20" r="4" fill="#5CE1FF"/></svg>`;

/** Show the start screen: "Continue" when a save was loaded, otherwise "Start". Under `?play` the game begins at once. */
export function showStart(hasSave: boolean) {
  if (SKIP_START) {
    startEl.hidden = true;
    begin();
    return;
  }
  started = false;
  app.classList.remove('started');
  startEl.classList.remove('out');
  startEl.innerHTML = `<div class="start-card">${LOGO}
    <h1>Flowstate</h1>
    <p>Wire up a supply line. Watch it flow.</p>
    <button class="start-go" data-do="start" data-testid="start">${hasSave ? 'Continue' : 'Start'}</button>
    ${hasSave ? `<button class="start-new" data-do="new" data-testid="new-game">New game</button>` : ''}</div>`;
  startEl.hidden = false;
  coverBehind();
  startEl.querySelector<HTMLElement>('.start-go')!.focus({ preventScroll: true });
}

function begin() {
  if (started) return;
  started = true;
  app.classList.add('started');
  if (!startEl.hidden) {
    // Fade out, then take the card out of the page. It stops taking input at once.
    startEl.classList.add('out');
    const gone = startEl;
    setTimeout(() => {
      if (started) gone.hidden = true;
    }, 260);
  }
  if (document.activeElement instanceof HTMLElement && startEl.contains(document.activeElement)) document.activeElement.blur();
  pendingAway = hooks.begin();
  // A save that reached the end but never dismissed the summary shows it now; the time away follows it.
  if (ui.g.ended && !summaryDone() && !NO_SUMMARY) openSummary();
  else flushAway();
  coverBehind();
  touch();
}

// ---------- end-of-demo summary ----------

function stat(key: string, value: string, label: string, big = false): string {
  return `<div class="sum-stat${big ? ' big' : ''}" data-stat="${key}"><b class="mono">${value}</b><span>${label}</span></div>`;
}

export function openSummary() {
  const g = ui.g;
  const s = endStats(g);
  const selling = s.totalEarned > 0 ? Math.round((s.fromSales / s.totalEarned) * 100) : 0;
  const cap = MATERIALS[RULES.capstone];
  summaryEl.innerHTML = `<div class="sum-card">
    <div class="sum-top"><div class="sum-ico">${matGlyph(RULES.capstone, 34)}</div>
      <h2>Demo complete</h2>
      <p>You made your first ${cap.name}. The supply line is yours: keep it flowing.</p></div>
    <div class="sum-grid">
      ${stat('time', fmtTime(s.playTime), 'time played', true)}
      ${stat('credits', `${fmtInt(s.totalEarned)}¢`, 'credits earned', true)}
      ${stat('selling', `${selling}%`, 'of them from selling', true)}
      ${stat('nodes', fmt(s.nodesBuilt), 'nodes built')}
      ${stat('wires', fmt(s.wiresMade), 'wires made')}
      ${stat('orders', fmt(s.ordersFilled), s.ordersFilled === 1 ? 'order filled' : 'orders filled')}
      ${stat('flow', s.bestFlowStreak >= 1 ? fmtTime(Math.floor(s.bestFlowStreak)) : '–', 'longest Flow streak')}
    </div>
    <div class="sum-actions"><button class="sum-go" data-do="keep" data-testid="keep-playing">Keep playing</button>
      <button class="sum-over" data-do="over" data-testid="start-over">Start over</button></div></div>`;
  summaryEl.hidden = false;
  summaryOpen = true;
  coverBehind();
  summaryEl.querySelector<HTMLElement>('.sum-go')!.focus({ preventScroll: true });
}

function closeSummary() {
  if (!summaryOpen) return;
  summaryOpen = false;
  summaryEl.hidden = true;
  summaryEl.innerHTML = '';
  coverBehind();
}

/** Close the summary for good. The capstone goal is claimed on the way out if it is still waiting. */
function keepPlaying() {
  const g = ui.g;
  const goal = activeGoal(g);
  if (goal && g.goal.ready && goal.reward.unlock === 'end') claimGoal(g);
  setSummaryDone(true);
  closeSummary();
  flushAway();
  touch();
}

// ---------- time away ----------

function flushAway() {
  const a = pendingAway;
  pendingAway = null;
  if (a) showAway(a.seconds, a.gains);
}

/** "While you were away". Shown only when something was actually earned. */
export function showAway(seconds: number, gains: AwayGains) {
  if (gains.credits < 1 && gains.a < 1 && gains.b < 1 && gains.g < 1) return;
  const parts: string[] = [];
  if (gains.credits >= 1) parts.push(`<span style="color:#FFC857">+${fmt(gains.credits)}¢</span>`);
  if (gains.a >= 1) parts.push(`<span style="color:#5EEAD4">+${fmt(gains.a)}α</span>`);
  if (gains.b >= 1) parts.push(`<span style="color:#C4A1FF">+${fmt(gains.b)}β</span>`);
  if (gains.g >= 1) parts.push(`<span style="color:#FF8FB1">+${fmt(gains.g)}γ</span>`);
  modalEl.innerHTML = `<div class="card"><h2>While you were away</h2><p>Your supply line kept running for <b>${fmtTime(seconds)}</b>.</p>
    <div class="gains mono">${parts.join('')}</div><button id="collect">Collect</button></div>`;
  modalEl.classList.add('open');
  modalOpen = true;
  coverBehind();
  const btn = modalEl.querySelector<HTMLElement>('#collect')!;
  btn.addEventListener('click', closeModal);
  btn.focus({ preventScroll: true });
}

function closeModal() {
  if (!modalOpen) return;
  modalOpen = false;
  modalEl.classList.remove('open');
  coverBehind();
}

// ---------- reset ----------

/**
 * A reset has put a fresh game in ui.g: forget everything about the old one and go back to the
 * start screen (which `?play` skips).
 */
export function backToStart() {
  setSummaryDone(false);
  summaryDue = 0;
  pendingAway = null;
  closeSummary();
  closeModal();
  started = false;
  showStart(false);
}

/** For scripts (window.flowstate.hud). */
export const screensApi = {
  isStarted,
  screenOpen,
  /** Press Start for the player. */
  start: begin,
  openSummary,
  keepPlaying,
};

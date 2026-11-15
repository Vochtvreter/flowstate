// Full-screen cards: the start screen, the end-of-demo summary and the time-away card.
// Owned by the HUD track.
//
// Contracts with the other modules:
//  - #app gets the class `started` the moment the player presses Start or Continue. Until then the
//    simulation does not run (main.ts asks isStarted()) and nothing is saved. It has the class
//    `summary-open` while the end-of-demo summary is up.
//  - `?play` in the URL skips the start screen, also after a reset. Scripts rely on it.
//  - The summary opens SUMMARY_DELAY seconds after the 'demo-end' event; the celebration plays in
//    between. `?nosummary` keeps it shut (for benchmarks that build a finished factory).
import { MATERIALS, MatId, RULES } from '../content';
import { EndStats, demandShown, endStats, fmt, fmtTime } from '../economy';
import { GOALS, activeGoal, claimGoal } from '../goals';
import { AwayGains } from '../sim';
import { Game } from '../state';
import { initToastDock } from './hud-toasts';
import { esc, icon, matGlyph } from './icons';
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
  const set = (covered: boolean) => {
    for (const e of Array.from(app.children)) {
      if (e !== startEl && e !== summaryEl && e !== modalEl) e.toggleAttribute('inert', covered);
    }
  };
  clearTimeout(uncoverTimer);
  if (screenOpen()) set(true);
  // The game comes back a moment after the card has gone: the second press of a double press on
  // Start or Keep playing must not land on whatever lies under the button.
  else uncoverTimer = window.setTimeout(() => set(false), UNCOVER_DELAY);
}
/** Shorter than the start screen's fade (START_FADE), so the board answers by the time `#start` is hidden. */
const UNCOVER_DELAY = 240;
const START_FADE = 260;
let uncoverTimer = 0;

export function initScreens(h: ScreenHooks) {
  hooks = h;
  // (Toasts are the HUD's too: how many show at once and where they dock is set up with the screens.)
  const toasts = document.getElementById('toasts');
  if (toasts) initToastDock(toasts);
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
    else if (b.dataset.do === 'copy') void copyResult(b);
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

/**
 * The logo mark: two nodes and the wire between them. With `run`, three dots travel along the wire from one
 * node to the other (CSS, hud.css "start screen"; they stand still when the player asked for less motion).
 * The top bar uses the still mark: something that moves all game long there would cost frames for nothing.
 */
export function logoMark(size: number, run = false): string {
  const dots = run ? '<circle class="lg-dot d1" r="1.15"/><circle class="lg-dot d2" r="1.15"/><circle class="lg-dot d3" r="1.15"/>' : '';
  return `<svg class="logo-mark" viewBox="0 0 28 28" width="${size}" height="${size}" aria-hidden="true"><path d="M10 8c8 0 4 12 8 12" fill="none" stroke="#9DB8FF" stroke-width="1.8" stroke-linecap="round"/>${dots}<circle cx="6" cy="8" r="4" fill="#FFD84D"/><circle cx="22" cy="20" r="4" fill="#5CE1FF"/></svg>`;
}

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
  // A newcomer is told how long this takes; someone coming back knows.
  startEl.innerHTML = `<div class="start-card">${logoMark(64, true)}
    <h1>Flowstate</h1>
    <p>Wire up a supply line. Watch it flow.</p>
    <button class="start-go" data-do="start" data-testid="start">${hasSave ? 'Continue' : 'Start'}</button>
    <p class="start-note" data-testid="start-note">${hasSave ? 'Best with sound' : 'About 20 minutes · best with sound'}</p>
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
    }, START_FADE);
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

// The card is small and sits at the foot of the screen (a bottom sheet on a phone, a side sheet on a phone
// held sideways): the closing celebration has framed the whole factory by then, and it stays on show behind.
// What it says: how long the first Lens took, four numbers, what comes next, and three ways on.

function stat(key: string, value: string, label: string): string {
  return `<div class="sum-stat" data-stat="${key}"><b class="mono">${value}</b><span>${label}</span></div>`;
}

/** 1182 s reads "19:42"; an hour or more reads "1:02:13". */
export function clockTime(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** Share of all credits earned that came from sales, in whole percent. */
const sellingShare = (s: EndStats) => (s.totalEarned > 0 ? Math.round((s.fromSales / s.totalEarned) * 100) : 0);

/**
 * What free play is for: the material each goal after the capstone has the player make, in the chain's own
 * order (Clay, Coil, Dynamo, Paradox today). Read from the goal list, so a new free-play goal shows up here.
 */
export function nextMaterials(): MatId[] {
  const out: MatId[] = [];
  for (const goal of GOALS) {
    const m = goal.id.replace(/^make-/, '') as MatId;
    if (goal.free && MATERIALS[m] && !out.includes(m)) out.push(m);
  }
  return out;
}

/** The result as two lines of plain text, for the clipboard: no link and nothing about the player. */
export function resultText(g: Game): string {
  const s = endStats(g);
  const lens = s.firstLensAt != null ? `first Lens in ${clockTime(s.firstLensAt)}` : 'demo complete';
  return `Flowstate: ${lens}\n${s.nodesBuilt} things built · ${sellingShare(s)}% of income from sales`;
}

/** The result as the open card shows it. (The line keeps running behind the card: what is copied is what is on show.) */
let shownResult = '';

export function openSummary() {
  const g = ui.g;
  const s = endStats(g);
  shownResult = resultText(g);
  const cap = MATERIALS[RULES.capstone];
  const headline = s.firstLensAt != null
    ? `First ${esc(cap.name)} in <b class="mono">${clockTime(s.firstLensAt)}</b>`
    : `You made your first ${esc(cap.name)}`;
  // Locked silhouettes with their names; one already made (a save that played on before this card was seen) is ticked.
  const next = nextMaterials().map((m) => {
    const made = !!g.made[m];
    return `<span class="sum-nx${made ? ' made' : ''}" data-mat="${m}">${matGlyph(m, 18)}<i>${esc(MATERIALS[m].name)}</i>${icon(made ? 'check' : 'lock', 11)}</span>`;
  }).join('');
  // Demand is the other thing ahead, for a player it has not caught up with yet.
  const demand = demandShown(g) ? '' : `<p class="sum-more" data-testid="summary-demand">Markets have limits. Sell more than a material's demand and the surplus goes cheap.</p>`;
  summaryEl.innerHTML = `<div class="sum-card">
    <div class="sum-top"><div class="sum-ico">${matGlyph(RULES.capstone, 26)}</div>
      <div class="sum-head"><span class="sum-kicker">Demo complete</span><h2 data-stat="lens">${headline}</h2></div></div>
    <div class="sum-grid">
      ${stat('nodes', fmt(s.nodesBuilt), 'things built')}
      ${stat('selling', `${sellingShare(s)}%`, 'of income from sales')}
      ${stat('orders', fmt(s.ordersFilled), s.ordersFilled === 1 ? 'order filled' : 'orders filled')}
      ${stat('flow', s.bestFlowStreak >= 1 ? fmtTime(Math.floor(s.bestFlowStreak)) : '–', 'longest Flow streak')}
    </div>
    <div class="sum-next" data-testid="summary-next"><span class="sum-lbl">Next</span><div class="sum-nexts">${next}</div>${demand}</div>
    <div class="sum-actions"><button class="sum-go" data-do="keep" data-testid="keep-playing">Keep playing</button>
      <button class="sum-copy" data-do="copy" data-testid="copy-result"><span class="lab">Copy result</span></button>
      <button class="sum-over" data-do="over" data-testid="start-over">Start over</button></div>
    <div class="sum-fallback" data-testid="copy-fallback" hidden><span>Copying is not allowed here. Select the text to copy it:</span><textarea readonly rows="2" spellcheck="false" aria-label="Your result"></textarea></div>
    <span class="sum-said" role="status" aria-live="polite"></span></div>`;
  summaryEl.hidden = false;
  summaryOpen = true;
  app.classList.add('summary-open');
  coverBehind();
  summaryEl.querySelector<HTMLElement>('.sum-go')!.focus({ preventScroll: true });
  // (On a phone the camera frames the factory above the sheet: phone.ts measures this card.)
  touch();
}

/** How long the Copy button reads "Copied". */
const COPIED_MS = 2500;
let copiedTimer = 0;

/** Put text on the clipboard: the asynchronous clipboard where the page may use it, else the old copy command. */
async function toClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* refused (no permission, or the page is not a secure one): try the other way */
  }
  try {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * "Copy result": the two lines go to the clipboard and the button says "Copied" for a moment. When the
 * browser refuses, the lines are shown in a box, selected, for the player to copy themselves.
 */
async function copyResult(btn: HTMLElement) {
  const text = shownResult || resultText(ui.g);
  const ok = await toClipboard(text);
  // The card may have been closed (or rebuilt) while the clipboard was being asked.
  if (!summaryOpen || !btn.isConnected) return;
  const said = summaryEl.querySelector<HTMLElement>('.sum-said');
  const box = summaryEl.querySelector<HTMLElement>('.sum-fallback');
  if (ok) {
    btn.classList.add('done');
    btn.querySelector('.lab')!.innerHTML = `${icon('check', 14)}Copied`;
    if (said) said.textContent = 'Result copied';
    if (box) box.hidden = true;
    clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => {
      if (!btn.isConnected) return;
      btn.classList.remove('done');
      btn.querySelector('.lab')!.textContent = 'Copy result';
    }, COPIED_MS);
    return;
  }
  if (!box) return;
  const area = box.querySelector('textarea')!;
  area.value = text;
  box.hidden = false;
  if (said) said.textContent = 'Copying is not allowed here. The result is shown as text to select.';
  area.focus({ preventScroll: true });
  area.select();
}

function closeSummary() {
  if (!summaryOpen) return;
  summaryOpen = false;
  summaryEl.hidden = true;
  app.classList.remove('summary-open');
  summaryEl.innerHTML = '';
  clearTimeout(copiedTimer);
  coverBehind();
  touch();
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
  /** The two lines "Copy result" puts on the clipboard. */
  resultText: () => resultText(ui.g),
};

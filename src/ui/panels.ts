// Top bar, hotbar, inspector and minimap. (The goal card, order chip and alert chip are in hud.ts,
// which joins every refresh through onPanels().)
//
// How these refresh: the top bar is built once from persistent items that patch their own text
// and attributes (see addTopItem). The other panels still describe themselves as an HTML string;
// makePanel() skips the write when the string is unchanged, patches the existing elements in
// place when it is not, and holds off while the player is pressing or touch-scrolling the panel.
import { DATA_COLORS, DATA_NAMES, DataTier, HOTBAR, MATERIALS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, RULES, TECHS, Tech, Track } from '../content';
import {
  autoBalance, canRedo, canUndo, cutWire, deleteNode, favour, favouredWire, materialsAt, nodeById, raisePriority,
  recipesFor, redo, refundOf, setFilter, setMode, setRecipe, setWeight, undo, upgrade, upgradeAll, upgradeSaturatedWires, upgradeWire,
} from '../actions';
import {
  TRACK_INFO, costText, cycleTime, dataYield, fmt, fmtInt, fmtRate, has, labRate, maxLevel, maxPipeTier,
  nodeCost, nodeUnlocked, readyTechs, recipeOf, techAvailable, trackAvailable, upgradeCost, wellRate,
} from '../economy';
import { graph, isMachine, passCap } from '../sim';
import { Game, GNode, RouterMode, Wire } from '../state';
import { isMuted, setMuted } from './audio';
import { boardRect, jumpTo, startPlacing, fitView, zoomBy } from './board';
import { marked, pressedMark, tendMark } from './advice-show';
import { Panel, cachedRect, el, invalidateLayout, makePanel, setAnchor, setAttr, setClass, setHTML, setHidden, setText } from './dom';
import { nodeSize } from './geom';
import { marketSection } from './hud-market';
import { logoMark } from './hud-screens';
import { isTouch, withKey } from './hud-words';
import { esc, icon, matGlyph, nodeIcon } from './icons';
import { env } from './phone-env';
import { diagnose, matName } from './status';
import { teasedSlot } from './tech';
import { delegate, select, signal, toast, touch, ui } from './ui';

let topEl: HTMLElement;
let hotEl: HTMLElement;
let inspEl: HTMLElement;
let mini: HTMLCanvasElement;
let zoomEl: HTMLElement;
let zoomLabel: HTMLElement;
let hotPanel: Panel;
let inspPanel: Panel;

const extraRenders: ((force: boolean) => void)[] = [];
/**
 * Join every panel refresh: `fn` runs at the end of renderPanels(), with the same `force` flag.
 * This is how HUD parts that live in other files (hud.ts) stay in step with the panels.
 */
export const onPanels = (fn: (force: boolean) => void) => void extraRenders.push(fn);

export function initPanels(refs: {
  top: HTMLElement; hot: HTMLElement; insp: HTMLElement; mini: HTMLCanvasElement; zoom: HTMLElement;
}, hooks: { openTech: (id?: string) => void; closeTech?: () => void; reset: () => void }) {
  topEl = refs.top;
  hotEl = refs.hot;
  inspEl = refs.insp;
  mini = refs.mini;
  zoomEl = refs.zoom;
  hotPanel = makePanel(hotEl);
  // The inspector's own frame: a grab handle (shown when it is a bottom sheet) and the body that
  // is patched. The frame is never rebuilt, so the sheet can be dragged while its contents refresh.
  inspEl.innerHTML = `<div class="sheet-grab" aria-hidden="true"></div><div class="insp-body"></div>`;
  inspPanel = makePanel(inspEl.querySelector<HTMLElement>('.insp-body')!);
  buildTop();
  zoomEl.innerHTML = `<button class="ibtn" data-act="out" aria-label="Zoom out">${icon('minus', 14)}</button><span class="mono zl"></span><button class="ibtn" data-act="in" aria-label="Zoom in">${icon('plus', 14)}</button><button class="ibtn" data-act="fit" aria-label="Fit board (F)" title="Fit board (F)">${icon('fit', 14)}</button>`;
  zoomLabel = zoomEl.querySelector('.zl')!;

  // Every handler ends with a forced refresh: the player has just pressed something here, so the
  // panel must answer at once even though the pointer is still down inside it.
  delegate(topEl, (a, _args, el) => {
    const g = ui.g;
    // Whatever is chosen from the gear menu, the menu closes behind it.
    if (a !== 'menu' && ui.menuOpen && el.closest('.menu')) { ui.menuOpen = false; touch(); }
    if (a === 'undo') undo(g);
    else if (a === 'redo') redo(g);
    else if (a === 'pause') { g.paused = !g.paused; touch(); }
    else if (a === 'sound') setMuted(!isMuted());
    // The Tech button opens the tree, and closes it again: on a desktop the top bar stays in view above it.
    else if (a === 'tech') { if (ui.techOpen && hooks.closeTech) hooks.closeTech(); else hooks.openTech(); }
    else if (a === 'menu') { ui.menuOpen = !ui.menuOpen; touch(); }
    else if (a === 'reset') {
      ui.menuOpen = false;
      if (confirm('Start over? This erases your whole supply line and all research.')) hooks.reset();
    }
    renderPanels(true);
  });
  // A press anywhere else closes the menu.
  window.addEventListener('pointerdown', (e) => {
    if (!ui.menuOpen || (e.target instanceof Element && e.target.closest('.menuwrap'))) return;
    ui.menuOpen = false;
    touch();
  }, true);

  delegate(hotEl, (a, args) => {
    if (a === 'place') startPlacing(args[0] as never);
    else if (a === 'locked') hooks.openTech(args[0]);
    renderPanels(true);
  });

  delegate(zoomEl, (a) => {
    if (a === 'in') zoomBy(1.25);
    else if (a === 'out') zoomBy(0.8);
    else if (a === 'fit') fitView();
    renderZoom();
  });

  delegate(inspEl, (a, args, pressed) => {
    // A control that a tip pointed at ("Show me") loses its ring the moment it is pressed.
    pressedMark(pressed.dataset.testid);
    inspectorAction(a, args, hooks.openTech);
    renderPanels(true);
  });
}

function inspectorAction(a: string, args: string[], openTech: (id?: string) => void) {
  const g = ui.g;
  const sel = ui.sel;
  if (a === 'close') return select(null);
  if (a === 'tech') return openTech(args[0]);
  if (a === 'jump') return jumpTo(Number(args[0]));
  if (a === 'upgsrc') {
    if (!upgrade(g, Number(args[0]), 'speed')) toast('Not enough credits', 'bad');
    return;
  }
  if (!sel) return;
  if (sel.kind === 'node') {
    const n = nodeById(g, sel.id);
    if (!n) return;
    if (a === 'upg') {
      if (!upgrade(g, n.id, args[0] as Track)) toast('Not enough credits', 'bad');
    } else if (a === 'upgall') {
      const c = upgradeAll(g, n.type, args[0] as Track);
      toast(c ? `Upgraded ${c} ${NODE_DEFS[n.type].name}${c > 1 ? 's' : ''}` : 'Not enough credits', c ? 'good' : 'bad');
    } else if (a === 'del') {
      const refund = refundOf(g, n);
      // A refusal (the last Well) raises its own toast and leaves the node selected.
      if (!deleteNode(g, n.id)) return;
      select(null);
      if (refund > 0) toast(`Refunded <b>${fmt(refund)}¢</b>`, 'good');
    } else if (a === 'dup') startPlacing(n.type, n.recipe);
    else if (a === 'recipes') { ui.recipeMenu = !ui.recipeMenu; touch(); }
    else if (a === 'recipe') { setRecipe(g, n.id, args[0]); ui.recipeMenu = false; touch(); }
    else if (a === 'mode') setMode(g, n.id, args[0] as RouterMode);
    else if (a === 'wplus') { const w = g.wires.find((x) => x.id === Number(args[0])); if (w) setWeight(g, w.id, w.weight + 1); }
    else if (a === 'wminus') { const w = g.wires.find((x) => x.id === Number(args[0])); if (w) setWeight(g, w.id, w.weight - 1); }
    else if (a === 'prio') raisePriority(g, Number(args[0]));
    else if (a === 'favour') favour(g, n.id, Number(args[0]));
    else if (a === 'filter') {
      const w = g.wires.find((x) => x.id === Number(args[0]));
      if (w) {
        const mats: (MatId | null)[] = [null, ...materialsAt(g, n.id)];
        setFilter(g, w.id, mats[(mats.indexOf(w.filter) + 1) % mats.length]);
      }
    } else if (a === 'autobal') autoBalance(g, n.id);
  } else {
    const w = g.wires.find((x) => x.id === sel.id);
    if (!w) return;
    if (a === 'wireup') { if (!upgradeWire(g, w.id)) toast('Not enough credits', 'bad'); }
    else if (a === 'wireall') { const c = upgradeSaturatedWires(g); toast(c ? `Upgraded ${c} wire${c > 1 ? 's' : ''}` : 'Nothing to upgrade, or not enough credits', c ? 'good' : 'bad'); }
    else if (a === 'cut') { cutWire(g, w.id); select(null); }
  }
}

// ---------- shared bits ----------

/** A percentage for a style attribute, rounded so tiny changes do not count as new HTML. */
const pct = (frac: number) => Math.round(Math.max(0, Math.min(1, frac)) * 1000) / 10;

const tok = (m: MatId, q?: number) =>
  `<span class="tok">${matGlyph(m, 13)}${q != null ? `<span class="mono">${q}</span> ` : ''}${MATERIALS[m].name}</span>`;

/** A tech's price with each kind of Data in its own colour: "1,180α 100β". Read from TECHS, never written out here. */
const techPrice = (t: Tech) => (['a', 'b', 'g'] as DataTier[]).filter((k) => t.cost[k])
  .map((k) => `<span class="mono" style="color:${DATA_COLORS[k]}">${fmt(t.cost[k]!)}${DATA_NAMES[k]}</span>`).join(' ') || costText(t);

function buyBtn(act: string, cost: number, credits: number, label?: string, testid?: string): string {
  const ok = credits + 1e-6 >= cost;
  return `<button class="buy${ok ? ' ok' : ''}${testid ? marked(testid) : ''}" data-act="${act}" ${testid ? `data-testid="${testid}"` : ''}>${ok ? '' : `<span class="fill" style="width:${pct(credits / Math.max(1, cost))}%"></span>`}<span class="lab">${label ?? ''}${fmt(cost)}¢</span></button>`;
}

// ---------- top bar ----------

/**
 * A persistent piece of the top bar. `el` is created once and stays in the page; `update` runs on
 * every refresh and should write only what changed (the setText/setAttr/setClass helpers in dom.ts
 * do that for you). To add something to the bar, call addTopItem().
 */
export interface TopItem {
  el: HTMLElement;
  update(g: Game): void;
}

const topItems: TopItem[] = [];
const topSlots: Partial<Record<'res' | 'actions', HTMLElement>> = {};

/** Add an element to the resource row (left) or the action buttons (right), optionally before an existing one. */
export function addTopItem(slot: 'res' | 'actions', item: TopItem, before?: Element | null) {
  topItems.push(item);
  topSlots[slot]!.insertBefore(item.el, before ?? null);
  if (ui.g) item.update(ui.g);
}

let creditsNum: HTMLElement;
/** How long the credits number takes to roll to a new value, in seconds. */
const ROLL = 0.3;
let shownCredits = NaN;
let shownInt = NaN;
/** How far the shown number was from the real one when the roll began. */
let rollGap = 0;
let rollT = ROLL;
let lastCredits = NaN;
let sinceWrite = 0;
let rolledGame: Game | null = null;
/** Whether the number on show was written for the phone's narrow bar. */
let shownNarrow = false;

/**
 * A whole number in at most five characters once it reaches `from`: 12.3k, 123k, 1.23M, 12.3M, 123M, 1.23B.
 * Rounded down, so the bar never shows more than the player has. Below `from` it is written out in full.
 */
export function shortNum(n: number, from: number): string {
  const v = Math.floor(n);
  if (v < from) return fmtInt(v);
  for (const [unit, size] of [['B', 1e9], ['M', 1e6], ['k', 1e3]] as const) {
    if (v < size) continue;
    const x = v / size;
    const places = x >= 100 ? 0 : x >= 10 ? 1 : 2;
    const f = 10 ** places;
    return (Math.floor(x * f) / f).toFixed(places) + unit;
  }
  return fmtInt(v);
}

// The phone's top bar is 360 px wide at its narrowest and has to hold the credits, the Flow bonus, three
// kinds of Data, Tech and the menu. Written out, 12,345,678 alone takes a third of that, so there big
// numbers are shortened: credits from 100,000 and Data from 10,000.
const creditsText = (whole: number) => (env.phone ? shortNum(whole, 1e5) : fmtInt(whole));
const dataText = (n: number) => (env.phone ? shortNum(n, 1e4) : fmtInt(n));

function creditsItem(): TopItem {
  const e = el(`<div class="res credits" data-testid="credits"><span class="sym coin">¢</span><div class="nums"><b class="mono">0</b><i class="mono"></i></div></div>`);
  creditsNum = e.querySelector('b')!;
  const rate = e.querySelector('i')!;
  setAnchor('credits', e.querySelector('.sym')!);
  return { el: e, update: (g) => void setText(rate, `+${fmtRate(g.creditRate)}/s`) };
}

/**
 * Roll the credits number to its real value over ROLL seconds (ease-out). Call every frame.
 * A roll starts when the real value jumps (a purchase, a refund, a reward). Income that trickles in
 * is added as it comes, during a roll too, so a roll always takes ROLL seconds and lands exactly,
 * however fast the factory is earning.
 * The text is written at most ~20 times a second during a roll and ~10 times a second while it
 * simply ticks up with income: each write costs the browser a full rendering pass, and the eye
 * cannot tell the difference.
 */
export function tickPanels(dt: number) {
  const g = ui.g;
  const target = g.credits;
  if (g !== rolledGame || !isFinite(shownCredits)) {
    // First frame, or a different game (reset): no roll.
    rolledGame = g;
    shownCredits = lastCredits = target;
    rollT = ROLL;
    sinceWrite = 1;
  }
  const moved = Math.abs(target - lastCredits);
  lastCredits = target;
  // A jump is anything clearly bigger than a moment's income (and never just a credit or two).
  if (moved >= Math.max(2, g.creditRate * 0.25)) {
    rollGap = shownCredits - target;
    rollT = 0;
  }
  const rolling = rollT < ROLL;
  if (rolling) {
    rollT = Math.min(ROLL, rollT + dt);
    const left = 1 - rollT / ROLL;
    shownCredits = target + rollGap * left * left * left;
  } else shownCredits = target;
  const landed = rolling && rollT >= ROLL; // the exact value is always shown the moment a roll ends
  sinceWrite += dt;
  const whole = Math.floor(shownCredits);
  if (whole === shownInt && env.phone === shownNarrow) return;
  if (!landed && sinceWrite < (rolling ? 0.045 : 0.095) && env.phone === shownNarrow) return;
  shownInt = whole;
  shownNarrow = env.phone;
  sinceWrite = 0;
  setText(creditsNum, creditsText(whole));
}

// A Data chip stays out of the bar until the player has had that kind of Data, and then stays in.
const dataSeen = new WeakMap<Game, Partial<Record<DataTier, boolean>>>();

function everHad(g: Game, k: DataTier): boolean {
  let seen = dataSeen.get(g);
  if (!seen) dataSeen.set(g, (seen = {}));
  if (!seen[k] && (g.data[k] > 0 || g.dataRate[k] > 0 || g.techs.some((t) => (TECHS[t]?.cost[k] ?? 0) > 0))) seen[k] = true;
  return !!seen[k];
}

/** A tech the player can research now and whose price is in kinds of Data they have met: worth pointing at. */
function techInSight(g: Game, t: Tech | undefined): boolean {
  return !!t && techAvailable(g, t) && (['a', 'b', 'g'] as DataTier[]).every((k) => !t.cost[k] || everHad(g, k));
}

const DATA_ABOUT: Record<DataTier, string> = {
  a: 'α Data: Labs make it from raw and Tier 1 items. Spend it in the Tech tree.',
  b: 'β Data: Labs make it from Tier 2 items such as Glyph. Spend it in the Tech tree.',
  g: 'γ Data: Labs make it from Tier 3 items such as Lens. Spend it in the Tech tree.',
};

/** The three Data chips share one wrapper, so a narrow bar can stack them as one block (see style.css). */
let dataWrap: HTMLElement;
const dataShown: Record<DataTier, boolean> = { a: false, b: false, g: false };

function dataItem(k: DataTier): TopItem {
  const e = el(`<div class="res data data-${k}" style="--c:${DATA_COLORS[k]}" title="${DATA_ABOUT[k]}" hidden><span class="sym">${DATA_NAMES[k]}</span><div class="nums"><b class="mono"></b><i class="mono"></i></div></div>`);
  const num = e.querySelector('b')!;
  const rate = e.querySelector('i')!;
  // Effects fly Data to the symbol, as coins fly to the credits coin.
  setAnchor(`data-${k}`, e.querySelector('.sym')!);
  return {
    el: e,
    update(g) {
      const seen = everHad(g, k);
      // A chip appearing moves its neighbours: cached positions are measured again.
      if (setHidden(e, !seen)) invalidateLayout();
      setAttr(e, 'data-testid', seen ? `data-${k}` : null);
      dataShown[k] = seen;
      // How many kinds are on show decides how big the stacked block can set them.
      setAttr(dataWrap, 'data-n', String(Number(dataShown.a) + Number(dataShown.b) + Number(dataShown.g)));
      if (!seen) return;
      setText(num, dataText(g.data[k]));
      setText(rate, `+${fmtRate(g.dataRate[k])}/s`);
    },
  };
}

// Every piece of the bar has a class of its own (t-undo, t-redo, t-pause, t-sep, t-tech, t-menu,
// and .res.credits / .res.data-a|b|g on the left), so a narrow layout can hide them one by one.
//
// The phone layout (phone.css) keeps the logo mark, credits with the Flow ring, the Data block, Tech
// and the gear. Undo, redo, pause and sound move into the gear menu there: the `.m-only` entries below,
// which no other layout shows. (#top also carries `roomy` while a phone's bar has room for the word
// "Tech", and `menu-open` while the menu is down.)
function buildTop() {
  topEl.innerHTML = `
    <div class="logo">${logoMark(26)}<span>flowstate</span></div>
    <div class="resrow"></div>
    <div class="grow"></div>
    <div class="acts"></div>`;
  topSlots.res = topEl.querySelector<HTMLElement>('.resrow')!;
  topSlots.actions = topEl.querySelector<HTMLElement>('.acts')!;

  addTopItem('res', creditsItem());
  dataWrap = el(`<div class="datas" data-n="0"></div>`);
  topSlots.res.appendChild(dataWrap);
  for (const k of ['a', 'b', 'g'] as DataTier[]) {
    const item = dataItem(k);
    topItems.push(item);
    dataWrap.appendChild(item.el);
  }

  // Labels name a key only for a mouse-and-keyboard player.
  const label = (b: HTMLElement, text: string, key: string) => {
    const full = withKey(text, key);
    setAttr(b, 'aria-label', full);
    setAttr(b, 'title', full);
  };
  const undoBtn = el(`<button class="ibtn t-undo" data-act="undo">${icon('undo')}</button>`);
  addTopItem('actions', {
    el: undoBtn,
    update() {
      setAttr(undoBtn, 'disabled', canUndo() ? null : '');
      label(undoBtn, 'Undo', 'Ctrl+Z');
    },
  });
  const redoBtn = el(`<button class="ibtn t-redo" data-act="redo">${icon('redo')}</button>`);
  addTopItem('actions', {
    el: redoBtn,
    update() {
      setAttr(redoBtn, 'disabled', canRedo() ? null : '');
      label(redoBtn, 'Redo', 'Ctrl+Shift+Z');
    },
  });
  const pauseBtn = el(`<button class="ibtn t-pause" data-act="pause"></button>`);
  addTopItem('actions', {
    el: pauseBtn,
    update(g) {
      setClass(pauseBtn, 'on', g.paused);
      label(pauseBtn, g.paused ? 'Resume' : 'Pause', 'P');
      setHTML(pauseBtn, icon(g.paused ? 'play' : 'pause'));
    },
  });
  addTopItem('actions', { el: el(`<span class="sep t-sep"></span>`), update() {} });

  const techBtn = el(`<button class="techbtn t-tech" data-act="tech">${icon('tree')}<span class="tlab">Tech<span class="tl2"> tree</span></span><span class="badge" hidden><b class="mono"></b><span class="bw">ready</span></span><span class="kbd">R</span></button>`);
  const badge = techBtn.querySelector('.badge')!;
  const badgeNum = badge.querySelector('b')!;
  addTopItem('actions', {
    el: techBtn,
    update(g) {
      const on = has(g, 'R1');
      if (setHidden(techBtn, !on)) invalidateLayout();
      setAttr(techBtn, 'data-testid', on ? 'open-tech' : null);
      if (!on) return;
      const ready = readyTechs(g).length;
      setClass(techBtn, 'ready', ready > 0);
      setHidden(badge, !ready);
      setAttr(techBtn, 'data-ready', String(ready));
      setText(badgeNum, String(ready));
      setAttr(techBtn, 'aria-label', ready ? `Tech tree, ${ready} ready to research` : 'Tech tree');
      // Early on, a phone's bar has room for the word (the goal card says "Tap Tech"). Once the Flow
      // bonus or a second kind of Data has joined the bar it has not, and by then the button is familiar.
      setClass(topEl, 'roomy', !g.flowOn && !dataShown.b && !dataShown.g);
    },
  });

  // A menu entry: what it does on the left, and for a switch how it stands on the right.
  const mItem = (act: string) =>
    `<button class="m-only" data-act="${act}" data-testid="menu-${act}" role="${act === 'sound' ? 'menuitemcheckbox' : 'menuitem'}"><span class="ml"></span><i class="ms"></i></button>`;
  const menuWrap = el(`<div class="menuwrap t-menu"><button class="ibtn" data-act="menu" data-testid="menu" aria-label="Menu" title="Menu" aria-haspopup="menu">${icon('gear')}</button>`
    + `<div class="menu" role="menu" hidden>${mItem('pause')}${mItem('sound')}${mItem('undo')}${mItem('redo')}`
    + `<button class="danger" data-act="reset" data-testid="menu-reset" role="menuitem">New game…</button></div></div>`);
  const gear = menuWrap.querySelector<HTMLElement>('[data-act="menu"]')!;
  const menu = menuWrap.querySelector<HTMLElement>('.menu')!;
  const [mPause, mSound, mUndo, mRedo] = [...menu.querySelectorAll<HTMLElement>('.m-only')];
  const say = (b: HTMLElement, text: string, state = '') => {
    setText(b.firstElementChild!, text);
    setText(b.lastElementChild!, state);
  };
  say(mUndo, 'Undo');
  say(mRedo, 'Redo');
  addTopItem('actions', {
    el: menuWrap,
    update(g) {
      setHidden(menu, !ui.menuOpen);
      setAttr(gear, 'aria-expanded', ui.menuOpen ? 'true' : 'false');
      // The tech tree lies over the board from just under the bar; while the menu is down the bar is
      // lifted above the tree so the menu is not hidden behind it (see #top.menu-open in style.css).
      setClass(topEl, 'menu-open', ui.menuOpen);
      // On a phone the pause button is in here, so the gear itself shows that the game is paused.
      setClass(gear, 'on', g.paused && env.phone);
      say(mPause, g.paused ? 'Resume' : 'Pause', g.paused ? 'Paused' : '');
      setClass(mPause, 'on', g.paused);
      const muted = isMuted();
      say(mSound, 'Sound', muted ? 'Off' : 'On');
      setAttr(mSound, 'aria-checked', muted ? 'false' : 'true');
      setClass(mSound, 'off', muted);
      setAttr(mUndo, 'disabled', canUndo() ? null : '');
      setAttr(mRedo, 'disabled', canRedo() ? null : '');
    },
  });
}

function renderTop() {
  const g = ui.g;
  for (const item of topItems) item.update(g);
}

// ---------- hotbar ----------

/** How long a hotbar button carries the `afford` class after it becomes affordable. */
const AFFORD_MS = 650;
/** Whether each unlocked item was out of reach the last time the bar was drawn. Nothing is recorded before its first sighting. */
const outOfReach = new Map<NodeType, boolean>();
const affordUntil = new Map<NodeType, number>();
let hotGame: Game | null = null;

/** One hotbar slot's height with the gap under it, and the bar's own padding (style.css): for "is there room for the Delete tip". */
const HOT_SLOT = 68;
const HOT_PAD = 16;
const hotRect = cachedRect(() => hotEl);

function renderHot(force: boolean) {
  const g = ui.g;
  if (g !== hotGame) {
    // A different game (first frame, reset, loaded save): nothing has "become" affordable yet.
    hotGame = g;
    outOfReach.clear();
    affordUntil.clear();
  }
  const now = performance.now();
  const became: NodeType[] = [];
  const touchy = isTouch();
  const tease = teasedSlot(g);
  let key = 0;
  let slots = 0;
  const items = HOTBAR.map((type) => {
    const def = NODE_DEFS[type];
    if (!nodeUnlocked(g, type)) {
      if (tease?.type !== type) return '';
      slots++;
      // A silhouette: the icon and the name dimmed, and under them what unlocks it (never a price: it would
      // be in a kind of Data the player may not have met). With the tree at hand it opens there.
      const t = tease.tech;
      const body = `${nodeIcon(type)}<span class="n">${def.name}</span><span class="p">${esc(t.name)}</span>`;
      if (tease.goal || !has(g, 'R1')) return `<div class="hb locked" data-testid="hot-locked" data-type="${type}" title="${def.name}: comes with this goal" aria-label="${def.name}, locked. It comes with this goal">${body}</div>`;
      return `<button class="hb locked" data-act="locked:${t.id}" data-testid="hot-locked" data-type="${type}" title="${def.name}: research ${esc(t.name)}" aria-label="${def.name}, locked. Research ${esc(t.name)}">${body}</button>`;
    }
    key++;
    slots++;
    const cost = nodeCost(g, type);
    const ok = g.credits + 1e-6 >= cost;
    // The moment an item comes within reach it pulses once, and anyone listening is told.
    if (ok && outOfReach.get(type) === true) {
      affordUntil.set(type, now + AFFORD_MS);
      became.push(type);
    }
    outOfReach.set(type, !ok);
    const pulse = (affordUntil.get(type) ?? 0) > now;
    const k = key <= 9 ? key : 0;
    const price = cost === 0 ? 'free' : fmt(cost) + '¢';
    // A finger is never told about a key: no number in the corner, none in the label.
    const label = `${withKey(def.name, `key ${k}`)}, ${price}${ok ? '' : ', not enough credits yet'}`;
    return `<button class="hb${ok ? '' : ' poor'}${ui.placing?.type === type ? ' on' : ''}${pulse ? ' afford' : ''}" data-act="place:${type}" data-testid="hot-${type}" title="${def.name}: ${def.blurb}" aria-label="${label}">
      ${ok ? '' : `<span class="fill" style="height:${pct(g.credits / Math.max(1, cost))}%"></span>`}${touchy ? '' : `<span class="k mono">${k}</span>`}${nodeIcon(type)}<span class="n">${def.name}</span><span class="p mono">${price}</span></button>`;
  }).join('');
  // The Delete key is for keyboards: with a finger, Delete is a button in the inspector, which shows the refund.
  // (And only where the rail has room for it under the slots: on a short window a full bar takes it all.)
  const room = env.phone || hotRect().height >= slots * HOT_SLOT + HOT_PAD + HOT_SLOT;
  const tip = touchy || !room ? '' : `<div class="grow"></div><div class="hb tip" title="Select a node and press Delete. Everything is refunded in full.">${icon('trash')}<span class="p">Del = refund</span></div>`;
  hotPanel.render(items + tip, force);
  for (const type of became) {
    const btn = hotEl.querySelector<HTMLElement>(`[data-testid="hot-${type}"]`);
    if (!btn) continue;
    const r = btn.getBoundingClientRect();
    signal('afford', { type, at: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
  }
}

/** Hotbar node types in key order (unlocked only). */
export function hotbarTypes(g: Game) {
  return HOTBAR.filter((t) => nodeUnlocked(g, t));
}

// ---------- inspector ----------

function statusBlock(g: Game, n: GNode): string {
  const dx = diagnose(g, n);
  if (!dx.problem) return '';
  const r = recipeOf(n);
  let title = '';
  let body = '';
  let cls = dx.problem;
  let actions = '';
  if (dx.problem === 'idle') {
    title = n.recipe ? 'Idle: nothing connected' : 'Idle: no recipe';
    body = n.recipe ? (isTouch() ? 'Tap a source\'s port, then tap this machine.' : 'Drag a wire from a source into this machine.') : 'Connect an input and the recipe is picked for you, or choose one below.';
  } else if (dx.problem === 'starved' && r) {
    const need = (r.inputs.find((i) => i[0] === dx.mat)?.[1] ?? 0) / cycleTime(n, r);
    let got = 0;
    for (const w of graph(g).ins.get(n.id) ?? []) if (w.mat === dx.mat) got += w.rate;
    title = `Starved: not enough ${matName(dx.mat)}`;
    if (dx.culprit == null) body = `Nothing connected supplies ${matName(dx.mat)}.`;
    else {
      body = `Receiving <span class="mono">${fmtRate(got)}</span> of <span class="mono">${fmtRate(need)}</span> ${matName(dx.mat)}/s.`;
      const src = nodeById(g, dx.culprit);
      if (src && trackAvailable(g, src, 'speed') && src.lv.speed < maxLevel(g, 'speed') && src.status === 'working') {
        actions += buyBtn(`upgsrc:${src.id}`, upgradeCost(src, 'speed'), g.credits, 'Upgrade source · ', 'upg-source');
      }
      actions += `<button class="ghostbtn" data-act="jump:${dx.culprit}">Jump to source</button>`;
    }
  } else if (dx.problem === 'blocked') {
    title = `Blocked: ${matName(dx.mat)} output is full`;
    if (dx.openPort) body = `${matName(dx.mat)} has nowhere to go. ${isTouch() ? 'Tap its port, then tap an empty spot' : 'Drag from its port into empty space'} to send it somewhere.`;
    else {
      body = 'Whatever is downstream cannot keep up.';
      if (dx.culprit != null) actions += `<button class="ghostbtn" data-act="jump:${dx.culprit}">Jump to the cause</button>`;
    }
    if (dx.victim) cls = 'blocked';
  }
  return `<div class="sec"><div class="statusbox ${cls}"><div class="st-title">${icon('warn', 16)}${title}</div><p>${body}</p>${actions ? `<div class="st-actions">${actions}</div>` : ''}</div></div>`;
}

function recipeSection(g: Game, n: GNode): string {
  const r = recipeOf(n);
  const all = recipesFor(g, n.type);
  let chips = '<span class="muted">None yet</span>';
  if (r) {
    chips = `${r.inputs.map(([m, q]) => tok(m, q)).join('<span class="op">+</span>')}<span class="op">→</span>${r.outputs.map(([m, q]) => tok(m, q)).join('<span class="op">+</span>')}`;
  }
  const list = ui.recipeMenu || !r
    ? `<div class="recipelist">${all.map((x) => `<button data-act="recipe:${x.id}" class="${x.id === n.recipe ? 'on' : ''}" data-testid="recipe-${x.id}">${matGlyph(x.outputs[0][0], 14)}<b>${x.name}</b><span>${x.inputs.map(([m, q]) => `${q} ${MATERIALS[m].name}`).join(' + ')}</span></button>`).join('')}</div>`
    : '';
  return `<div class="sec"><div class="row"><span class="lbl">Recipe</span>${r && all.length > 1 ? `<button class="link" data-act="recipes">${ui.recipeMenu ? 'Close' : 'Change'}</button>` : ''}</div>
    <div class="chips">${chips}</div>
    ${r ? `<div class="note"><span class="mono">${cycleTime(n, r).toFixed(2)}s</span> per craft · base ${r.time.toFixed(1)}s</div>` : ''}${list}</div>`;
}

function flowSection(g: Game, n: GNode): string {
  const r = recipeOf(n);
  if (!r) return '';
  const T = cycleTime(n, r);
  const ins = graph(g).ins.get(n.id) ?? [];
  const rows = r.inputs.map(([m, q]) => {
    const need = q / T;
    let got = 0;
    for (const w of ins) if (w.mat === m) got += w.rate;
    const lim = n.status === 'starved' && n.missing === m;
    return `<div><div class="row sm"><span class="${lim ? 'bad' : ''}">In · ${MATERIALS[m].name}${lim ? ' · limiting' : ''}</span><span class="mono muted"><b>${fmtRate(got)}</b> / ${fmtRate(need)} /s</span></div>
      <div class="bar"><span style="width:${pct(got / need)}%;background:${MATERIALS[m].color}"></span></div></div>`;
  }).join('');
  const outs = r.outputs.map(([m, q]) => `<div class="row sm"><span>Out · ${MATERIALS[m].name}</span><span class="mono"><b>${fmtRate((n.util * q) / T)}</b>/s</span></div>`).join('');
  return `<div class="sec flow"><span class="lbl">Flow</span>${rows}${outs}
    <div class="row sm"><span>Utilization</span><span class="mono"><b>${Math.round(n.util * 100)}%</b></span></div>
    <div class="bar"><span style="width:${pct(n.util)}%;background:#7AA2FF"></span></div></div>`;
}

function upgradeSection(g: Game, n: GNode): string {
  const def = NODE_DEFS[n.type];
  if (!def.tracks.length) return '';
  const rows = def.tracks.map((t) => {
    if (!trackAvailable(g, n, t)) {
      // The track is behind a tech (Efficiency: Efficiency Tuning). It is only mentioned once that tech can
      // be researched: before then its price is in a kind of Data the player has not met.
      const tech = TECHS.U1;
      if (t !== 'eff' || !tech || !techAvailable(g, tech)) return '';
      return `<div class="uprow locked"><div><b>${TRACK_INFO[t].name}</b><small>Research ${esc(tech.name)} · ${techPrice(tech)}</small></div><button class="buy dashed" data-act="tech:${tech.id}"><span class="lab">View tech</span></button></div>`;
    }
    const lv = n.lv[t];
    const max = maxLevel(g, t);
    if (lv >= max) return `<div class="uprow"><div><b>${TRACK_INFO[t].name} <span class="mono muted">Lv ${lv}</span></b><small>Maxed${t === 'speed' && TECHS.U2 && !has(g, 'U2') ? ` · ${esc(TECHS.U2.name)} raises the cap` : ''}</small></div></div>`;
    const cost = upgradeCost(n, t);
    const all = `upgall-${t}`;
    const bulk = has(g, 'S1') ? `<button class="link${marked(all)}" data-act="upgall:${t}" data-testid="${all}" title="Upgrade every ${def.name} by one level" aria-label="Upgrade every ${def.name} by one level">Upgrade all</button>` : '';
    return `<div class="uprow"><div><b>${TRACK_INFO[t].name} <span class="mono muted">Lv ${lv} → ${lv + 1}</span></b><small>${TRACK_INFO[t].desc(n)}</small></div>${bulk}${buyBtn(`upg:${t}`, cost, g.credits, '', `upg-${t}`)}</div>`;
  }).join('');
  return rows ? `<div class="sec"><span class="lbl">Upgrades</span>${rows}</div>` : '';
}

function routerSection(g: Game, n: GNode): string {
  const wires = g.wires.filter((w) => w.from === n.id);
  const modes: { id: RouterMode; name: string; tech?: string }[] = [
    { id: 'even', name: 'Even' }, { id: 'ratio', name: 'Ratio' }, { id: 'priority', name: 'Priority', tech: 'L4' }, { id: 'filter', name: 'Filter', tech: 'L6' },
  ];
  // A mode that still has to be researched is offered (locked, leading to the tree) only once that research
  // is in sight: it can be done now, and the player has met the kind of Data it costs. Priority Routing can be
  // researched from the moment the Router arrives, but it costs β, and β does not exist until the first Glyph.
  const seg = modes.filter((m) => has(g, m.tech) || techInSight(g, TECHS[m.tech ?? ''])).map((m) => has(g, m.tech)
    ? `<button data-act="mode:${m.id}" class="${n.mode === m.id ? 'on' : ''}" data-testid="mode-${m.id}">${m.name}</button>`
    : `<button data-act="tech:${m.tech}" class="lockedseg" data-testid="mode-${m.id}-locked">${icon('lock', 11)}${m.name}</button>`).join('');
  const total = wires.reduce((s, w) => s + w.rate, 0) || 1;
  const favoured = favouredWire(g, n.id);
  const rows = wires.map((w, i) => {
    const d = nodeById(g, w.to);
    const name = d ? NODE_DEFS[d.type].name + (d.recipe ? ` (${RECIPES[d.recipe].name})` : '') : '?';
    let ctl = '';
    if (n.mode === 'ratio') ctl = `<button class="step" data-act="wminus:${w.id}" aria-label="Decrease weight">${icon('minus', 12)}</button><span class="mono w">${w.weight}</span><button class="step" data-act="wplus:${w.id}" aria-label="Increase weight" data-testid="wplus">${icon('plus', 12)}</button>`;
    else if (n.mode === 'priority') ctl = `<span class="mono w">#${i + 1}</span>${i > 0 ? `<button class="step" data-act="prio:${w.id}" aria-label="Raise priority">${icon('up', 12)}</button>` : '<span class="step ghost"></span>'}`;
    else if (n.mode === 'filter') ctl = `<button class="filt" data-act="filter:${w.id}">${w.filter ? matGlyph(w.filter, 12) + MATERIALS[w.filter].name : 'any'}</button>`;
    // Favour: one press sends this wire the bigger share (favour() in src/actions.ts: Ratio mode, 3 to 1).
    // The wire that has it says so; a Router with a single wire has nothing to favour it over.
    let fav = '';
    if (wires.length > 1) {
      const id = `favour-${w.id}`;
      fav = favoured === w.id
        ? `<span class="fav on" data-testid="${id}" aria-label="This wire gets the bigger share">${icon('check', 11)}Favoured</span>`
        : `<button class="fav${marked(id)}" data-act="favour:${w.id}" data-testid="${id}" title="Send this wire ${RULES.router.favour} of every ${RULES.router.favour + RULES.router.rest * (wires.length - 1)} items" aria-label="Favour the wire to ${esc(name)}">Favour</button>`;
    }
    return `<div class="rrow${fav ? ' hasfav' : ''}" data-key="w${w.id}"><span class="dest">→ ${esc(name)}</span>${ctl}<div class="bar"><span style="width:${pct(w.rate / total)}%;background:#9DB8FF"></span></div><span class="mono rate">${fmtRate(w.rate)}/s</span>${fav}</div>`;
  }).join('');
  const help: Record<RouterMode, string> = {
    even: 'Splits evenly and skips outputs that are full.',
    ratio: 'Splits by weight. A full output passes its share on.',
    priority: 'Fills #1 first. The rest only get the overflow.',
    filter: 'Each wire carries one material, or anything if set to "any".',
  };
  const s3 = TECHS.S3;
  const bal = !s3 ? '' : has(g, s3.id) ? `<button class="ghostbtn" data-act="autobal">${esc(s3.name)}</button>`
    : has(g, 'L4') ? `<button class="ghostbtn dashed" data-act="tech:${s3.id}">${esc(s3.name)} · ${techPrice(s3)}</button>` : '';
  return `<div class="sec"><span class="lbl">Mode</span><div class="seg">${seg}</div><div class="note">${help[n.mode]}</div>
    ${wires.length ? rows : `<div class="note">${isTouch() ? 'Tap the output port, then tap a node to add a destination.' : 'Drag wires from the output port to add destinations.'}</div>`}${bal ? `<div class="st-actions">${bal}</div>` : ''}</div>`;
}

function labSection(g: Game, n: GNode): string {
  const mats = new Set<MatId>();
  for (const w of graph(g).ins.get(n.id) ?? []) for (const m of materialsAt(g, w.from, w.port)) mats.add(m);
  const rows = [...mats].map((m) => {
    const y = dataYield(g, m);
    return `<div class="row sm"><span>${matGlyph(m, 12)} ${MATERIALS[m].name}</span><span class="mono" style="color:${DATA_COLORS[y.tier]}">${fmt(y.amount)}${DATA_NAMES[y.tier]} each</span></div>`;
  }).join('');
  // What each tier of item gives, as far as the player has got: β and γ are named once Tier 2 and Tier 3
  // items can be made (or that kind of Data has been in hand), not before.
  let kinds = 'Raw and Tier 1 items give α.';
  if (has(g, 'P4') || everHad(g, 'b')) kinds += ' Tier 2 items give β.';
  if (has(g, 'P7') || everHad(g, 'g')) kinds += ' Tier 3 items give γ.';
  return `<div class="sec flow"><span class="lbl">Studying</span>${rows || '<div class="note">Wire any item into the Lab.</div>'}
    <div class="row sm"><span>Throughput</span><span class="mono"><b>${fmtRate(n.rate)}</b> / ${fmtRate(labRate(g, n))} /s</span></div>
    <div class="bar"><span style="width:${pct(n.rate / labRate(g, n))}%;background:#C4A1FF"></span></div>
    <div class="note">${kinds}</div></div>`;
}

function nodeInspector(g: Game, n: GNode): string {
  const def = NODE_DEFS[n.type];
  const title = n.type === 'well' && n.material ? `${MATERIALS[n.material].name} Well` : def.name;
  let body = statusBlock(g, n);
  if (isMachine(n)) body += recipeSection(g, n) + flowSection(g, n);
  else if (n.type === 'well') body += `<div class="sec flow"><span class="lbl">Flow</span><div class="row sm"><span>Extracting</span><span class="mono"><b>${fmtRate(n.rate)}</b> / ${fmtRate(wellRate(n))} /s</span></div><div class="bar"><span style="width:${pct(n.rate / wellRate(n))}%;background:${MATERIALS[n.material!].color}"></span></div></div>`;
  else if (n.type === 'router') body += routerSection(g, n);
  else if (n.type === 'market') body += marketSection(g, n);
  else if (n.type === 'lab') body += labSection(g, n);
  else if (n.type === 'silo') {
    const stored = (Object.keys(n.inb) as MatId[]).filter((m) => (n.inb[m] ?? 0) >= 0.5);
    body += `<div class="sec flow"><span class="lbl">Stored</span>${stored.map((m) => `<div><div class="row sm"><span>${matGlyph(m, 12)} ${MATERIALS[m].name}</span><span class="mono"><b>${Math.round(n.inb[m] ?? 0)}</b> / ${passCap(n)}</span></div><div class="bar"><span style="width:${pct((n.inb[m] ?? 0) / passCap(n))}%;background:${MATERIALS[m].color}"></span></div></div>`).join('') || '<div class="note">Empty.</div>'}
      <div class="note">Holds up to ${passCap(n)} of each material.</div></div>`;
  }
  else body += `<div class="sec"><div class="note">${def.blurb}</div></div>`;
  body += upgradeSection(g, n);
  const refund = refundOf(g, n);
  const fixed = n.type === 'well';
  return `<div class="sec head"><div class="hicon">${n.type === 'well' && n.material ? matGlyph(n.material, 22) : isMachine(n) && n.recipe ? matGlyph(RECIPES[n.recipe].outputs[0][0], 22) : nodeIcon(n.type, 22)}</div>
      <div class="htxt"><h2>${esc(title)}</h2><p>${esc(def.blurb)}</p></div>
      <button class="ibtn bare" data-act="close" aria-label="Close inspector">${icon('close', 16)}</button></div>
    <div class="scroll">${body}</div>
    <div class="foot"><button class="fbtn" data-act="dup" ${fixed ? 'disabled' : ''}>Duplicate <span class="kbd">Ctrl D</span></button>
      <button class="fbtn danger" data-act="del" data-testid="delete">Delete${refund > 0 ? ` · <span class="mono">+${fmt(refund)}¢</span>` : ''}</button></div>`;
}

function wireInspector(g: Game, w: Wire): string {
  const cap = PIPES[w.tier].cap;
  const mats = materialsAt(g, w.from, w.port);
  const next = PIPES[w.tier + 1];
  const canUp = w.tier < maxPipeTier(g);
  const sat = w.rate >= cap * 0.97;
  let up = '';
  if (canUp) up = `<div class="uprow"><div><b>${next.name}</b><small>carries ${next.cap}/s</small></div>${buyBtn('wireup', next.cost, g.credits, '', 'wire-up')}</div><div class="st-actions"><button class="ghostbtn" data-act="wireall">Upgrade every full wire</button></div>`;
  else if (next) up = `<div class="uprow locked"><div><b>${next.name}</b><small>Research ${TECHS[next.tech!].name}</small></div><button class="buy dashed" data-act="tech:${next.tech}"><span class="lab">View tech</span></button></div>`;
  else up = `<div class="note">Top tier.</div>`;
  return `<div class="sec head"><div class="hicon">${mats[0] ? matGlyph(mats[0], 22) : icon('minus', 22)}</div>
      <div class="htxt"><h2>Wire · ${PIPES[w.tier].name}</h2><p>${mats.length ? mats.map((m) => MATERIALS[m].name).join(' + ') : 'Nothing flowing yet'}</p></div>
      <button class="ibtn bare" data-act="close" aria-label="Close inspector">${icon('close', 16)}</button></div>
    <div class="scroll">
      ${sat ? `<div class="sec"><div class="statusbox blocked"><div class="st-title">${icon('warn', 16)}At capacity</div><p>This wire is the bottleneck. Upgrade it or add a second one.</p></div></div>` : ''}
      <div class="sec flow"><span class="lbl">Flow</span><div class="row sm"><span>Carrying</span><span class="mono"><b>${fmtRate(w.rate)}</b> / ${cap} /s</span></div>
      <div class="bar"><span style="width:${pct(w.rate / cap)}%;background:${mats[0] ? MATERIALS[mats[0]].color : '#9DB8FF'}"></span></div></div>
      <div class="sec"><span class="lbl">Pipe</span>${up}</div>
    </div>
    <div class="foot"><button class="fbtn danger${marked('cut-wire')}" data-act="cut" data-testid="cut-wire">Cut wire${w.paid > 0 ? ` · <span class="mono">+${fmt(w.paid)}¢</span>` : ''}</button></div>`;
}

function renderInspector(force: boolean) {
  const g = ui.g;
  const sel = ui.sel;
  // A ring that a tip put on a control ("Show me") goes when something else is selected.
  tendMark();
  let html = '';
  if (sel?.kind === 'node') {
    const n = nodeById(g, sel.id);
    if (n) html = nodeInspector(g, n);
  } else if (sel?.kind === 'wire') {
    const w = g.wires.find((x) => x.id === sel.id);
    if (w) html = wireInspector(g, w);
  }
  if (!html && sel) ui.sel = null;
  // Opening or closing changes the width of the stage, so cached screen positions are thrown away.
  // (As a bottom sheet on a phone it lies over the stage instead, and nothing moves.)
  if (setClass(inspEl, 'open', !!html)) invalidateLayout();
  // (The same as a class on #app, for the stylesheets: far cheaper to match than a has() selector on #app.)
  const appEl = inspEl.parentElement;
  if (appEl) setClass(appEl, 'insp-open', !!html);
  if (html || !env.phone) {
    clearTimeout(inspEmpty);
    inspEmpty = 0;
    inspPanel.render(html, force);
  } else if (!inspEmpty) {
    // The sheet slides away with its contents still in it; they are cleared once it is out of sight.
    inspEmpty = window.setTimeout(() => {
      inspEmpty = 0;
      if (!inspEl.classList.contains('open')) inspPanel.render('', true);
    }, 280);
  }
}

let inspEmpty = 0;

// ---------- minimap + zoom ----------

const ST_COLORS: Record<string, string> = { working: '#4ADE80', blocked: '#FBBF24', starved: '#F87171', idle: '#64748B' };

let miniKey = '';

function renderMini() {
  const g = ui.g;
  // Redrawn only when something it shows has changed.
  const view = boardRect();
  let key = `${g.board.w}x${g.board.h}|${Math.round(ui.view.x)},${Math.round(ui.view.y)},${ui.view.k.toFixed(3)}|${Math.round(view.width)}x${Math.round(view.height)}`;
  for (const n of g.nodes) key += `|${n.x},${n.y},${n.status[0]}`;
  if (key === miniKey) return;
  miniKey = key;
  const ctx = mini.getContext('2d');
  if (!ctx) return;
  const W = mini.width, H = mini.height;
  ctx.clearRect(0, 0, W, H);
  const s = Math.min((W - 12) / g.board.w, (H - 12) / g.board.h);
  const ox = (W - g.board.w * s) / 2, oy = (H - g.board.h * s) / 2;
  ctx.strokeStyle = '#2A3550';
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(ox, oy, g.board.w * s, g.board.h * s);
  ctx.setLineDash([]);
  for (const n of g.nodes) {
    const { w, h } = nodeSize(n);
    ctx.fillStyle = n.type === 'market' ? '#FFC857' : n.type === 'lab' ? '#C4A1FF' : ST_COLORS[n.status];
    ctx.fillRect(ox + n.x * s, oy + n.y * s, Math.max(3, w * s), Math.max(2, h * s));
  }
  const r = view;
  ctx.strokeStyle = '#7AA2FF';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox + (-ui.view.x / ui.view.k) * s, oy + (-ui.view.y / ui.view.k) * s, (r.width / ui.view.k) * s, (r.height / ui.view.k) * s);
}

let fitBtn: HTMLElement | null | undefined;

function renderZoom() {
  setText(zoomLabel, `${Math.round(ui.view.k * 100)}%`);
  // The Fit button names its key only to someone with a keyboard.
  fitBtn ??= zoomEl.querySelector<HTMLElement>('[data-act="fit"]');
  if (fitBtn) {
    const label = withKey('Fit board', 'F');
    setAttr(fitBtn, 'aria-label', label);
    setAttr(fitBtn, 'title', label);
  }
}

/**
 * Refresh every panel. Cheap to call often: each part writes only what changed.
 * `force` is for calls made straight from a press inside a panel, which must show at once.
 */
export function renderPanels(force = false) {
  renderTop();
  renderHot(force);
  renderInspector(force);
  renderMini();
  renderZoom();
  for (const fn of extraRenders) fn(force);
}

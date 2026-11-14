// Top bar, hotbar, inspector and minimap. (The goal card, order chip and alert chip are in hud.ts,
// which joins every refresh through onPanels().)
//
// How these refresh: the top bar is built once from persistent items that patch their own text
// and attributes (see addTopItem). The other panels still describe themselves as an HTML string;
// makePanel() skips the write when the string is unchanged, patches the existing elements in
// place when it is not, and holds off while the player is pressing or touch-scrolling the panel.
import { DATA_COLORS, DATA_NAMES, DataTier, HOTBAR, MATERIALS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, TECHS, Track } from '../content';
import {
  autoBalance, canRedo, canUndo, cutWire, deleteNode, materialsAt, nodeById, raisePriority, recipesFor, redo, refundOf,
  setFilter, setMode, setRecipe, setWeight, undo, upgrade, upgradeAll, upgradeSaturatedWires, upgradeWire,
} from '../actions';
import {
  TRACK_INFO, costText, cycleTime, dataYield, fmt, fmtInt, fmtRate, has, labRate, maxLevel, maxPipeTier,
  nodeCost, nodeUnlocked, readyTechs, recipeOf, trackAvailable, upgradeCost, wellRate,
} from '../economy';
import { graph, isMachine, passCap } from '../sim';
import { Game, GNode, RouterMode, Wire } from '../state';
import { boardRect, jumpTo, startPlacing, fitView, zoomBy } from './board';
import { Panel, el, invalidateLayout, makePanel, setAnchor, setAttr, setClass, setHTML, setHidden, setText } from './dom';
import { nodeSize } from './geom';
import { marketSection } from './hud-market';
import { isTouch, withKey } from './hud-words';
import { esc, icon, matGlyph, nodeIcon } from './icons';
import { env } from './phone-env';
import { diagnose, matName } from './status';
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
}, hooks: { openTech: (id?: string) => void; reset: () => void }) {
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
  delegate(topEl, (a) => {
    const g = ui.g;
    if (a === 'undo') undo(g);
    else if (a === 'redo') redo(g);
    else if (a === 'pause') { g.paused = !g.paused; touch(); }
    else if (a === 'tech') hooks.openTech();
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

  delegate(inspEl, (a, args) => {
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

function buyBtn(act: string, cost: number, credits: number, label?: string, testid?: string): string {
  const ok = credits + 1e-6 >= cost;
  return `<button class="buy${ok ? ' ok' : ''}" data-act="${act}" ${testid ? `data-testid="${testid}"` : ''}>${ok ? '' : `<span class="fill" style="width:${pct(credits / Math.max(1, cost))}%"></span>`}<span class="lab">${label ?? ''}${fmt(cost)}¢</span></button>`;
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
  if (whole === shownInt) return;
  if (!landed && sinceWrite < (rolling ? 0.045 : 0.095)) return;
  shownInt = whole;
  sinceWrite = 0;
  creditsNum.textContent = fmtInt(whole);
}

// A Data chip stays out of the bar until the player has had that kind of Data, and then stays in.
const dataSeen = new WeakMap<Game, Partial<Record<DataTier, boolean>>>();

function everHad(g: Game, k: DataTier): boolean {
  let seen = dataSeen.get(g);
  if (!seen) dataSeen.set(g, (seen = {}));
  if (!seen[k] && (g.data[k] > 0 || g.dataRate[k] > 0 || g.techs.some((t) => (TECHS[t]?.cost[k] ?? 0) > 0))) seen[k] = true;
  return !!seen[k];
}

const DATA_ABOUT: Record<DataTier, string> = {
  a: 'α Data: Labs make it from raw and Tier 1 items. Spend it in the Tech tree.',
  b: 'β Data: Labs make it from Tier 2 items such as Glyph. Spend it in the Tech tree.',
  g: 'γ Data: Labs make it from Tier 3 items such as Lens. Spend it in the Tech tree.',
};

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
      if (!seen) return;
      setText(num, fmtInt(g.data[k]));
      setText(rate, `+${fmtRate(g.dataRate[k])}/s`);
    },
  };
}

// Every piece of the bar has a class of its own (t-undo, t-redo, t-pause, t-sep, t-tech, t-menu,
// and .res.credits / .res.data-a|b|g on the left), so a narrow layout can hide them one by one.
function buildTop() {
  topEl.innerHTML = `
    <div class="logo"><svg viewBox="0 0 28 28" width="26" height="26" aria-hidden="true"><circle cx="6" cy="8" r="4" fill="#FFD84D"/><circle cx="22" cy="20" r="4" fill="#5CE1FF"/><path d="M10 8c8 0 4 12 8 12" class="ic" style="color:#9DB8FF"/></svg><span>flowstate</span></div>
    <div class="resrow"></div>
    <div class="grow"></div>
    <div class="acts"></div>`;
  topSlots.res = topEl.querySelector<HTMLElement>('.resrow')!;
  topSlots.actions = topEl.querySelector<HTMLElement>('.acts')!;

  addTopItem('res', creditsItem());
  for (const k of ['a', 'b', 'g'] as DataTier[]) addTopItem('res', dataItem(k));

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

  const techBtn = el(`<button class="techbtn t-tech" data-act="tech">${icon('tree')}<span class="tlab">Tech tree</span><span class="badge" hidden><b class="mono"></b><span class="bw">ready</span></span><span class="kbd">R</span></button>`);
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
    },
  });

  const menuWrap = el(`<div class="menuwrap t-menu"><button class="ibtn" data-act="menu" aria-label="Menu" title="Menu">${icon('gear')}</button><div class="menu" hidden><button data-act="reset">New game…</button></div></div>`);
  const menu = menuWrap.querySelector('.menu')!;
  addTopItem('actions', { el: menuWrap, update: () => void setHidden(menu, !ui.menuOpen) });
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
  let key = 0;
  let shownLocked = 0;
  const items = HOTBAR.map((type) => {
    const def = NODE_DEFS[type];
    if (!nodeUnlocked(g, type)) {
      // Tease only the next couple of locked nodes, to keep the bar calm.
      if (!has(g, 'R1') || shownLocked >= 2) return '';
      shownLocked++;
      const t = TECHS[def.tech!];
      if (!t) return '';
      return `<button class="hb locked" data-act="locked:${t.id}" title="${def.name}: research ${t.name}" aria-label="${def.name}, locked. Research ${t.name}">${nodeIcon(type)}<span class="n">${def.name}</span><span class="p">${costText(t) || 'locked'}</span></button>`;
    }
    key++;
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
    const label = env.touch ? `${def.name}, ${price}${ok ? '' : ', not enough credits yet'}` : `${def.name}, key ${k}, ${cost} credits`;
    return `<button class="hb${ok ? '' : ' poor'}${ui.placing?.type === type ? ' on' : ''}${pulse ? ' afford' : ''}" data-act="place:${type}" data-testid="hot-${type}" title="${def.name}: ${def.blurb}" aria-label="${label}">
      ${ok ? '' : `<span class="fill" style="height:${pct(g.credits / Math.max(1, cost))}%"></span>`}<span class="k mono">${k}</span>${nodeIcon(type)}<span class="n">${def.name}</span><span class="p mono">${price}</span></button>`;
  }).join('');
  // The key hint is for keyboards: with a finger, Delete is a button in the inspector.
  const tip = env.touch ? '' : `<div class="grow"></div><div class="hb tip" title="Select a node and press Delete. Everything is refunded in full.">${icon('trash')}<span class="p">Del = refund</span></div>`;
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
      return `<div class="uprow locked"><div><b>${TRACK_INFO[t].name}</b><small>Research Efficiency Tuning · <span style="color:#5EEAD4">80α</span></small></div><button class="buy dashed" data-act="tech:U1"><span class="lab">View tech</span></button></div>`;
    }
    const lv = n.lv[t];
    const max = maxLevel(g, t);
    if (lv >= max) return `<div class="uprow"><div><b>${TRACK_INFO[t].name} <span class="mono muted">Lv ${lv}</span></b><small>Maxed${t === 'speed' && !has(g, 'U2') ? ' · Overclock raises the cap' : ''}</small></div></div>`;
    const cost = upgradeCost(n, t);
    const bulk = has(g, 'S1') ? `<button class="link" data-act="upgall:${t}" title="Upgrade every ${def.name} by one level" aria-label="Upgrade every ${def.name} by one level">all</button>` : '';
    return `<div class="uprow"><div><b>${TRACK_INFO[t].name} <span class="mono muted">Lv ${lv} → ${lv + 1}</span></b><small>${TRACK_INFO[t].desc(n)}</small></div>${bulk}${buyBtn(`upg:${t}`, cost, g.credits, '', `upg-${t}`)}</div>`;
  }).join('');
  return `<div class="sec"><span class="lbl">Upgrades</span>${rows}</div>`;
}

function routerSection(g: Game, n: GNode): string {
  const wires = g.wires.filter((w) => w.from === n.id);
  const modes: { id: RouterMode; name: string; tech?: string }[] = [
    { id: 'even', name: 'Even' }, { id: 'ratio', name: 'Ratio' }, { id: 'priority', name: 'Priority', tech: 'L4' }, { id: 'filter', name: 'Filter', tech: 'L6' },
  ];
  const seg = modes.map((m) => has(g, m.tech)
    ? `<button data-act="mode:${m.id}" class="${n.mode === m.id ? 'on' : ''}" data-testid="mode-${m.id}">${m.name}</button>`
    : `<button data-act="tech:${m.tech}" class="lockedseg">${icon('lock', 11)}${m.name}</button>`).join('');
  const total = wires.reduce((s, w) => s + w.rate, 0) || 1;
  const rows = wires.map((w, i) => {
    const d = nodeById(g, w.to);
    const name = d ? NODE_DEFS[d.type].name + (d.recipe ? ` (${RECIPES[d.recipe].name})` : '') : '?';
    let ctl = '';
    if (n.mode === 'ratio') ctl = `<button class="step" data-act="wminus:${w.id}" aria-label="Decrease weight">${icon('minus', 12)}</button><span class="mono w">${w.weight}</span><button class="step" data-act="wplus:${w.id}" aria-label="Increase weight" data-testid="wplus">${icon('plus', 12)}</button>`;
    else if (n.mode === 'priority') ctl = `<span class="mono w">#${i + 1}</span>${i > 0 ? `<button class="step" data-act="prio:${w.id}" aria-label="Raise priority">${icon('up', 12)}</button>` : '<span class="step ghost"></span>'}`;
    else if (n.mode === 'filter') ctl = `<button class="filt" data-act="filter:${w.id}">${w.filter ? matGlyph(w.filter, 12) + MATERIALS[w.filter].name : 'any'}</button>`;
    return `<div class="rrow"><span class="dest">→ ${esc(name)}</span>${ctl}<div class="bar"><span style="width:${pct(w.rate / total)}%;background:#9DB8FF"></span></div><span class="mono rate">${fmtRate(w.rate)}/s</span></div>`;
  }).join('');
  const help: Record<RouterMode, string> = {
    even: 'Splits evenly and skips outputs that are full.',
    ratio: 'Splits by weight. A full output passes its share on.',
    priority: 'Fills #1 first. The rest only get the overflow.',
    filter: 'Each wire carries one material, or anything if set to "any".',
  };
  const bal = has(g, 'S3') ? `<button class="ghostbtn" data-act="autobal">Auto-balance</button>` : has(g, 'L4') ? `<button class="ghostbtn dashed" data-act="tech:S3">Auto-balance · 150β</button>` : '';
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
  return `<div class="sec flow"><span class="lbl">Studying</span>${rows || '<div class="note">Wire any item into the Lab.</div>'}
    <div class="row sm"><span>Throughput</span><span class="mono"><b>${fmtRate(n.rate)}</b> / ${fmtRate(labRate(g, n))} /s</span></div>
    <div class="bar"><span style="width:${pct(n.rate / labRate(g, n))}%;background:#C4A1FF"></span></div>
    <div class="note">Raw and T1 items give α. T2 gives β. T3 gives γ.</div></div>`;
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
  if (canUp) up = `<div class="uprow"><div><b>${next.name}</b><small>carries ${next.cap}/s</small></div>${buyBtn('wireup', next.cost, g.credits, '', 'wire-up')}</div><div class="st-actions"><button class="ghostbtn" data-act="wireall">Upgrade all saturated wires</button></div>`;
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
    <div class="foot"><button class="fbtn danger" data-act="cut">Cut wire${w.paid > 0 ? ` · <span class="mono">+${fmt(w.paid)}¢</span>` : ''}</button></div>`;
}

function renderInspector(force: boolean) {
  const g = ui.g;
  const sel = ui.sel;
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

function renderZoom() {
  setText(zoomLabel, `${Math.round(ui.view.k * 100)}%`);
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

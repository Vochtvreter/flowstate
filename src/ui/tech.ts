// The tech tree overlay.
//
// It shows less than the whole tree (docs/PITCH_PLAN.md section 3): what the player owns, what can be
// researched now, and exactly one step beyond that as locked silhouettes. Anything further is not drawn,
// and a branch with nothing to show is left out together with its heading.
//
// One set of markup serves two layouts (src/styles/tech.css). On a phone (#app.phone) it is a full-screen
// sheet: a tab per branch, 56px rows, and the detail as a bottom sheet with the Research button pinned to
// its foot. Elsewhere the branches are rows of tiles beside a detail column.
//
// Refresh: main.ts calls renderTech() twice a second while the tree is open, and a press inside the tree
// refreshes it at once. The HTML is patched in place by makePanel(), which also holds off while a finger
// is down or a list is still scrolling.
import { BRANCHES, Branch, DATA_COLORS, DATA_NAMES, DataTier, TECHS, Tech } from '../content';
import { fmtInt, fmtRate, research, techAffordable, techAvailable, techEta, techHidden, techProgress } from '../economy';
import { GOALS } from '../goals';
import { Game } from '../state';
import { Panel, makePanel, setClass } from './dom';
import { isTouch } from './hud-words';
import { esc, icon } from './icons';
import { delegate, onNewGame, onSignal, toast, touch, ui } from './ui';

// ---------- what is shown ----------

export type TileState =
  /** Researched. */
  | 'own'
  /** Can be researched this moment. */
  | 'rdy'
  /** Requirements met, Data still short. */
  | 'sav'
  /** Handed out by a goal, never bought. */
  | 'goal'
  /** Something else has to be researched first. */
  | 'lck';

export interface Tile {
  t: Tech;
  state: TileState;
  /** A silhouette: the name shows, the cost and the effect do not. */
  veiled: boolean;
  /** Requirements the player does not own yet. */
  needs: Tech[];
  /** Set to be researched by itself as soon as it can be. */
  queued: boolean;
}

/**
 * The techs the tree shows right now, in content order:
 *  - in full: owned, researchable now (affordable or not), or queued;
 *  - one step beyond those: a tech whose every requirement is shown in full. It is a silhouette, except
 *    that a goal reward whose requirements are all owned says which goal it comes from.
 * Everything else, and whatever techHidden() hides, is left out.
 */
export function techTiles(g: Game): Tile[] {
  const all = Object.values(TECHS).filter((t) => !techHidden(g, t));
  const owned = (id: string) => g.techs.includes(id);
  const full = new Set<string>();
  for (const t of all) {
    if (owned(t.id) || techAvailable(g, t) || (!t.auto && g.queue.includes(t.id))) full.add(t.id);
  }
  const out: Tile[] = [];
  for (const t of all) {
    let state: TileState;
    let veiled = false;
    if (owned(t.id)) state = 'own';
    else if (techAvailable(g, t)) state = techAffordable(g, t) ? 'rdy' : 'sav';
    else if (full.has(t.id)) state = 'lck'; // queued ahead of its requirements: still shown in full
    else if (!t.requires.every((r) => full.has(r))) continue; // two or more steps away
    else if (t.auto && t.requires.every(owned)) state = 'goal';
    else {
      state = 'lck';
      veiled = true;
    }
    const needs = t.requires.filter((r) => !owned(r) && TECHS[r]).map((r) => TECHS[r]);
    out.push({ t, state, veiled, needs, queued: state !== 'own' && g.queue.includes(t.id) });
  }
  return out;
}

/**
 * The tech the active goal asks the player to research, if it names one ("Research Assembly, then...").
 * Goals do not carry this as data, so it is read from their wording; no match simply means no badge.
 */
export function goalTech(g: Game): string | null {
  const goal = GOALS[g.goal.i];
  if (!goal || g.goal.ready) return null;
  const text = `${goal.title}. ${goal.hint.mouse}`;
  // The longest name wins, so "Pipes Mk III" is never taken for "Pipes Mk II".
  let best: Tech | null = null;
  for (const t of Object.values(TECHS)) {
    if (t.auto || !text.includes(`Research ${t.name}`)) continue;
    if (!best || t.name.length > best.name.length) best = t;
  }
  return best && !g.techs.includes(best.id) ? best.id : null;
}

const ORDER: Record<TileState, number> = { rdy: 0, sav: 1, goal: 3, lck: 4, own: 5 };

/** Ready first, then saving, then what is still closed, with owned techs last. Inside a group: the goal's tech, then tree order. */
function sortTiles(tiles: Tile[], want: string | null): Tile[] {
  const rank = (x: Tile) => (x.state === 'lck' && !x.veiled ? 2 : ORDER[x.state]) - (x.t.id === want ? 0.5 : 0);
  return tiles.slice().sort((a, b) => rank(a) - rank(b) || a.t.col - b.t.col || a.t.row - b.t.row);
}

/** Visible tiles per branch, sorted, in branch order. Branches with nothing visible are left out. */
function groupTiles(tiles: Tile[], want: string | null): { branch: (typeof BRANCHES)[number]; list: Tile[] }[] {
  const out: { branch: (typeof BRANCHES)[number]; list: Tile[] }[] = [];
  for (const branch of BRANCHES) {
    const list = sortTiles(tiles.filter((x) => x.t.branch === branch.id), want);
    if (list.length) out.push({ branch, list });
  }
  return out;
}

// ---------- wording ----------

const TIERS: DataTier[] = ['a', 'b', 'g'];

/** How to start earning a kind of Data, for a tech that waits on one nothing is making yet. */
const HOW: Record<DataTier, string> = {
  a: 'Wire any item into a Lab to make α.',
  b: 'Labs make β from Tier 2 items such as Glyph.',
  g: 'Labs make γ from Tier 3 items such as Lens.',
};

const dataHtml = (k: DataTier, n: number) => `<b class="mono" style="color:${DATA_COLORS[k]}">${fmtInt(n)}${DATA_NAMES[k]}</b>`;
const costHtml = (t: Tech) => TIERS.filter((k) => t.cost[k]).map((k) => dataHtml(k, t.cost[k]!)).join(' ');

/** "A", "A and B", "A, B and C". */
const listText = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** "Research Murk Deposits first". A requirement that is a goal reward is earned, not researched. */
function needsText(x: Tile): string {
  if (!x.needs.length) return 'Not available yet';
  return `${x.needs.every((n) => !n.auto) ? 'Research' : 'Earn'} ${listText(x.needs.map((n) => n.name))} first`;
}

/** A tech's description as written says "one click"; a finger taps. */
const forInput = (text: string) => (isTouch() ? text.replace(/\b([Oo])ne click\b/g, '$1ne tap') : text);

/** A wait in round, calm numbers: "about 40 s", "about 3 min". */
function aboutText(seconds: number): string {
  if (seconds <= 5) return 'a few seconds';
  if (seconds < 90) return `about ${Math.ceil(seconds / 5) * 5} s`;
  if (seconds < 3600) return `about ${Math.ceil(seconds / 60)} min`;
  return 'over an hour';
}

/** The kind of Data this tech is short of that nothing is making, if any. */
function dryTier(g: Game, t: Tech): DataTier | null {
  for (const k of TIERS) if ((t.cost[k] ?? 0) > g.data[k] && g.dataRate[k] <= 1e-6) return k;
  return null;
}

/** The kind of Data the player is furthest from affording: its colour is the colour of the progress bar. */
function slowTier(g: Game, t: Tech): DataTier {
  let worst: DataTier = 'a';
  let share = Infinity;
  for (const k of TIERS) {
    const c = t.cost[k] ?? 0;
    if (c > 0 && g.data[k] / c < share) {
      share = g.data[k] / c;
      worst = k;
    }
  }
  return worst;
}

/** The title of the goal that hands out this tech. */
function goalTitle(t: Tech): string {
  const goal = GOALS.find((x) => x.reward.techs?.includes(t.id));
  if (goal) return goal.title;
  return /[“"](.+?)[”"]/.exec(t.auto ?? '')?.[1] ?? t.auto ?? '';
}

/** A share for a style attribute, rounded so tiny changes do not count as new HTML. */
const frac = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;

const glyph = (body: string, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
const FLAG = '<path d="M6 21V4h11l-2.5 4 2.5 4H6" class="ic"/>';
const STATE_ICON: Record<TileState, string> = {
  own: icon('check', 16),
  rdy: glyph('<path d="M12 2.5l2.4 7.1 7.1 2.4-7.1 2.4-2.4 7.1-2.4-7.1L2.5 12l7.1-2.4z" fill="currentColor"/>'),
  sav: glyph('<circle cx="12" cy="12" r="8.5" class="ic"/><path d="M12 7.5V12l3 2" class="ic"/>'),
  goal: glyph(FLAG),
  lck: icon('lock', 16),
};

// ---------- state of the overlay ----------

let host: HTMLElement;
let panel: Panel;
let appEl: HTMLElement | null = null;
/** The branch whose list is showing on a phone. */
let tab: Branch | null = null;
/** Phone, upright: the detail sheet is up. */
let sheet = false;
/** The state each tech was last drawn in, to notice the moment one becomes ready, owned or visible. */
const seen = new Map<string, TileState>();
/** Techs whose state has just changed: which one-off animation they get and when it is over (0 = not drawn yet). */
const fresh = new Map<string, { kind: 'wake' | 'won' | 'new'; until: number }>();
const FRESH_MS = 1200;
/**
 * The tech whose Research button a tip has pointed at ("Show me" sends the 'showme' signal with press
 * 'research' once the tree is open on it). The button carries the ring (class `hl`) until it is pressed,
 * another tech is chosen, or the tree is closed.
 */
let ringed: string | null = null;
/** What to do with the scroll position after the next refresh. */
let scrollTo: 'top' | 'show' | null = null;
/** When the tree last refreshed by itself. Refreshes nobody pressed for keep at least this far apart: twice a second at most. */
let idleAt = -1e9;
const MIN_GAP_MS = 450;

/** The phone layout is in use (the phone module sets the class). */
const isPhone = () => !!(appEl ??= document.getElementById('app'))?.classList.contains('phone');

export function initTech(el: HTMLElement) {
  host = el;
  panel = makePanel(host);
  delegate(host, (a, args) => {
    const g = ui.g;
    if (a === 'close') closeTech();
    else if (a === 'sel') selectTech(args[0]);
    else if (a === 'tab') {
      tab = args[0] as Branch;
      ringed = null;
      // The detail always belongs to a row of the list on show.
      const first = sortTiles(techTiles(g).filter((x) => x.t.branch === tab), goalTech(g))[0];
      if (first) ui.techSel = first.t.id;
      scrollTo = 'top';
    } else if (a === 'hide') sheet = false;
    else if (a === 'research') doResearch(args[0]);
    else if (a === 'queue') {
      const id = args[0];
      if (g.queue.includes(id)) g.queue = g.queue.filter((q) => q !== id);
      else if (TECHS[id]) g.queue.push(id);
    }
    renderTech(true); // answer the press at once, even though the pointer is still down in here
  });
  // Enter researches the selected tech, so a player with Data to spend can keep going from the keyboard.
  window.addEventListener('keydown', (e) => {
    if (!ui.techOpen || e.key !== 'Enter' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    // A focused control answers Enter itself, except the selected tile: Enter there means "research this".
    const control = (e.target as HTMLElement | null)?.closest?.('button, a, input, textarea, select');
    if (control && !(control.classList.contains('tt') && control.getAttribute('data-key') === ui.techSel)) return;
    if (document.getElementById('modal')?.classList.contains('open')) return;
    if (!ui.techSel) return;
    e.preventDefault();
    doResearch(ui.techSel);
    renderTech(true);
  });
  // "Show me" on a tip about research: the tree is already open on the tech; its Research button gets the ring.
  onSignal('showme', (d) => {
    if (d.press !== 'research' || !ui.techOpen || !ui.techSel) return;
    ringed = ui.techSel;
    renderTech(true);
  });
  onNewGame(() => {
    // A different game: nothing remembered about the old one applies.
    if (ui.techOpen) closeTech();
    ringed = null;
    ui.techSel = null;
    tab = null;
    sheet = false;
    seen.clear();
    fresh.clear();
  });
}

function selectTech(id: string) {
  const t = TECHS[id];
  if (!t) return;
  if (id !== ringed) ringed = null;
  ui.techSel = id;
  tab = t.branch;
  sheet = true;
  scrollTo = 'show';
}

/** Research, then move on to the next tech in the same branch that can be researched right away. */
function doResearch(id: string) {
  const g = ui.g;
  const t = TECHS[id];
  if (id === ringed) ringed = null; // pressed: the ring has done its work
  if (!t || !research(g, id)) return; // (the tree itself shows what was researched; no toast while it is open)
  const next = sortTiles(techTiles(g).filter((x) => x.t.branch === t.branch), goalTech(g)).find((x) => x.state === 'rdy');
  if (!next) return; // nothing more to buy here: stay on what was just researched
  ui.techSel = next.t.id;
  scrollTo = 'show';
}

/**
 * The tile to show when the tree is asked for a tech: the tech itself when the player can read it, else the
 * nearest step toward it that can be acted on (a silhouette, or a tech too far ahead to be drawn, cannot).
 */
function stepToward(tiles: Tile[], id: string): Tile | null {
  const byId = new Map(tiles.map((x) => [x.t.id, x]));
  const exact = byId.get(id);
  if (exact && !exact.veiled) return exact;
  let veiledHit: Tile | null = null;
  const visited = new Set<string>();
  let level = [id];
  while (level.length) {
    const next: string[] = [];
    for (const cur of level) {
      if (visited.has(cur)) continue;
      visited.add(cur);
      const x = byId.get(cur);
      if (x && x.state !== 'own') {
        if (!x.veiled) return x;
        veiledHit ??= x;
      }
      for (const r of TECHS[cur]?.requires ?? []) next.push(r);
    }
    level = next;
  }
  return veiledHit;
}

/** With nothing ready: what the goal asks for, else what the player last looked at, else whatever will be affordable soonest. */
function bestWaiting(g: Game, tiles: Tile[], want: string | null): Tile | null {
  const wanted = tiles.find((x) => x.t.id === want);
  if (wanted) return wanted;
  const kept = tiles.find((x) => x.t.id === ui.techSel && x.state !== 'own');
  if (kept) return kept;
  let best: Tile | null = null;
  let bestEta = Infinity;
  for (const x of tiles) {
    if (x.state !== 'sav') continue;
    const eta = techEta(g, x.t);
    if (!best || eta < bestEta) {
      best = x;
      bestEta = eta;
    }
  }
  return best ?? tiles.find((x) => x.state !== 'own') ?? tiles[0] ?? null;
}

const firstReady = (groups: { list: Tile[] }[]) => {
  for (const grp of groups) {
    const x = grp.list.find((y) => y.state === 'rdy');
    if (x) return x;
  }
  return null;
};

/**
 * Open the tree. With an id (a locked hotbar slot, "View tech" in the inspector) it opens on that tech,
 * or on the nearest step toward it when it is too far ahead to be shown. Without one it opens on the
 * first tech that can be researched now, so the next step is one press away.
 */
export function openTech(id?: string) {
  const g = ui.g;
  // Asked to open while already open (the top-bar button again): leave the player's place alone.
  if (ui.techOpen && !id) return;
  ui.techOpen = true;
  const tiles = techTiles(g);
  const want = goalTech(g);
  const groups = groupTiles(tiles, want);
  const asked = id && TECHS[id] ? stepToward(tiles, id) : null;
  if (asked && id && asked.t.id !== id) {
    toast(`<span><b>${esc(TECHS[id].name)}</b> comes later. Next step: <b>${esc(asked.t.name)}</b>.</span>`, 'info', 4500);
  }
  const pick = asked ?? firstReady(groups) ?? bestWaiting(g, tiles, want);
  ui.techSel = pick?.t.id ?? null;
  tab = pick?.t.branch ?? null;
  sheet = !!asked || pick?.state === 'rdy';
  // Nothing "wakes up" merely because the tree was opened.
  seen.clear();
  fresh.clear();
  scrollTo = 'top';
  setClass(host, 'open', true);
  renderTech(true);
  touch();
}

export function closeTech() {
  ui.techOpen = false;
  ringed = null;
  setClass(host, 'open', false);
  touch();
}

/** For a button that both opens and closes the tree. */
export function toggleTech() {
  if (ui.techOpen) closeTech();
  else openTech();
}

// ---------- markup ----------

function subline(g: Game, x: Tile): string {
  const t = x.t;
  if (x.state === 'own') return 'Owned';
  if (x.state === 'goal') return `From a goal: ${esc(goalTitle(t))}`;
  if (x.veiled) return esc(needsText(x));
  if (x.state === 'rdy') return `${costHtml(t)}<span class="st"> · Ready</span>`;
  if (x.state === 'lck') return `${costHtml(t)}<span class="st"> · ${esc(needsText(x))}</span>`;
  const dry = dryTier(g, t);
  const wait = dry ? (g.data[dry] > 0 ? `no ${DATA_NAMES[dry]} coming in` : `no ${DATA_NAMES[dry]} yet`) : aboutText(techEta(g, t));
  return `${costHtml(t)}<span class="st"> · ${wait}${x.queued ? ' · auto' : ''}</span>`;
}

function tileHtml(g: Game, x: Tile, want: string | null): string {
  const t = x.t;
  const sel = t.id === ui.techSel;
  let cls = `tt ${x.state}`;
  if (x.veiled) cls += ' veil';
  if (sel) cls += ' sel';
  if (x.queued) cls += ' queued';
  if (t.id === want) cls += ' want';
  const f = fresh.get(t.id);
  if (f) cls += ` ${f.kind}`;
  const bar = x.state === 'sav'
    ? `<span class="pb"><i style="transform:scaleX(${frac(techProgress(g, t))});background:${DATA_COLORS[slowTier(g, t)]}"></i></span>`
    : '';
  return `<button class="${cls}" data-key="${t.id}" data-act="sel:${t.id}" data-testid="tech-${t.id}"${sel ? ' aria-current="true"' : ''}>`
    + `<span class="ti">${STATE_ICON[x.state]}</span>`
    + `<span class="tx"><span class="n">${esc(t.name)}${t.id === want ? '<i class="gl">Goal</i>' : ''}</span><span class="c">${subline(g, x)}</span></span>`
    + `${bar}</button>`;
}

/** The price, one line per kind of Data: what it costs, how far along the player is, what they have. */
function costRows(g: Game, t: Tech): string {
  return TIERS.filter((k) => t.cost[k]).map((k) => {
    const c = t.cost[k]!;
    const have = Math.min(g.data[k], 1e12);
    const ok = have >= c;
    return `<div class="cost${ok ? ' ok' : ''}">${dataHtml(k, c)}<span class="cbar"><i style="transform:scaleX(${frac(have / c)});background:${DATA_COLORS[k]}"></i></span>`
      + `<span class="have">You have <b class="mono">${fmtInt(have)}${DATA_NAMES[k]}</b>${ok ? icon('check', 13) : ''}</span></div>`;
  }).join('');
}

function detailHtml(g: Game, x: Tile | undefined, want: string | null): string {
  if (!x) return `<div class="dbody"><p class="desc">Nothing to research yet.</p></div>`;
  const t = x.t;
  const branch = BRANCHES.find((b) => b.id === t.branch);
  const head = `<div class="dtop"><span class="tag">${esc(branch?.name ?? '')}</span>${t.id === want ? '<span class="tag goal">Your goal</span>' : ''}<span class="grow"></span>`
    + `<button class="dhide" data-act="hide" aria-label="Close details">${icon('close', 18)}</button></div><h2>${esc(t.name)}</h2>`;

  if (x.veiled) {
    // A silhouette keeps its secret; the way forward is its requirement.
    const first = x.needs[0];
    return `<div class="dbody" data-key="${t.id}">${head}<p class="desc">${esc(needsText(x))} to see what this does.</p>`
      + `${first ? `<button class="dgo" data-act="sel:${first.id}">Show ${esc(first.name)}</button>` : ''}</div>`;
  }

  let body = `${head}<p class="desc">${esc(forInput(t.desc))}</p><span class="lbl">Unlocks</span><ul class="unl">${t.unlocks.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>`;
  let foot = '';
  if (x.state === 'own') foot = `<div class="owned">${icon('check', 16)}Researched</div>`;
  else if (x.state === 'goal') {
    const mine = GOALS[g.goal.i]?.reward.techs?.includes(t.id);
    body += `<div class="gnote">${glyph(FLAG, 18)}<div><b>From a goal: ${esc(goalTitle(t))}</b>`
      + `<span>${mine ? 'This is your goal right now. ' : ''}You get it when you claim that goal. It cannot be bought.</span></div></div>`;
  } else {
    // The price sits with the button, pinned to the foot: what it costs, what you have, Research.
    const dry = x.state === 'sav' ? dryTier(g, t) : null;
    if (x.state !== 'rdy') {
      body += `<button class="qbox${x.queued ? ' on' : ''}" data-act="queue:${t.id}" role="switch" aria-checked="${x.queued}"><span class="sw"></span>Research it for me when ready</button>`;
    }
    foot = `<div class="costs">${costRows(g, t)}</div>${dry ? `<p class="hint">${HOW[dry]}</p>` : ''}`;
    if (x.state === 'rdy') {
      foot += `<button class="rbtn ok${fresh.has(t.id) ? ' wake' : ''}${t.id === ringed ? ' hl' : ''}" data-act="research:${t.id}" data-testid="research"><span class="lab">Research</span><span class="kbd">Enter</span></button>`;
    } else {
      const label = x.state === 'lck' ? needsText(x) : dry ? `Not enough ${DATA_NAMES[dry]} yet` : `Ready in ${aboutText(techEta(g, t))}`;
      foot += `<button class="rbtn${t.id === ringed ? ' hl' : ''}" data-act="research:${t.id}" data-testid="research" disabled>`
        + `<span class="fill" style="transform:scaleX(${frac(techProgress(g, t))})"></span><span class="lab">${esc(label)}</span></button>`;
    }
  }
  return `<div class="dbody" data-key="${t.id}">${body}</div>${foot ? `<div class="dfoot">${foot}</div>` : ''}`;
}

function headHtml(g: Game, tiles: Tile[]): string {
  // α always; β and γ once the player has some, or can see a price in them.
  const shown = TIERS.filter((k) => k === 'a' || g.data[k] > 0 || g.dataRate[k] > 1e-6 || tiles.some((x) => !x.veiled && x.state !== 'own' && x.t.cost[k]));
  const chips = shown.map((k) => `<span class="dc" style="--c:${DATA_COLORS[k]}"><b class="mono">${fmtInt(g.data[k])}</b>${DATA_NAMES[k]}<i class="mono">+${fmtRate(g.dataRate[k])}/s</i></span>`).join('');
  return `<div class="thead"><div class="ttl"><h1>Tech tree</h1><p>Spend the Data your Labs make. Your line keeps running.</p></div>`
    + `<div class="tdata" aria-label="Your Data">${chips}</div>`
    + `<button class="tclose" data-act="close" data-testid="close-tech" aria-label="Back to the board">${icon('close', 18)}<span class="lab">Back to board</span><span class="kbd">Esc</span></button></div>`;
}

/**
 * Draw the overlay. The HTML is patched into the existing elements (so lists keep their scroll position
 * and a finger can keep scrolling them); `force` is for the refresh right after a press.
 */
export function renderTech(force = false) {
  if (!ui.techOpen) return;
  const g = ui.g;
  const now = performance.now();
  if (!force) {
    if (now - idleAt < MIN_GAP_MS) return;
    idleAt = now;
  }
  const phone = isPhone();
  const tiles = techTiles(g);
  const want = goalTech(g);
  const groups = groupTiles(tiles, want);

  // The selection and the tab always point at something on show.
  let sel = tiles.find((x) => x.t.id === ui.techSel);
  if (!sel) {
    sel = firstReady(groups) ?? bestWaiting(g, tiles, want) ?? undefined;
    ui.techSel = sel?.t.id ?? null;
    if (sel) tab = sel.t.branch;
  }
  if (!groups.some((grp) => grp.branch.id === tab)) tab = sel?.t.branch ?? groups[0]?.branch.id ?? null;
  if (phone && sel && sel.t.branch !== tab) {
    sel = groups.find((grp) => grp.branch.id === tab)?.list[0] ?? sel;
    ui.techSel = sel.t.id;
  }

  // Notice what has just become ready, owned or visible, for a one-off animation.
  for (const [id, f] of fresh) if (f.until && now > f.until) fresh.delete(id);
  const opening = seen.size === 0;
  let raise = false;
  for (const x of tiles) {
    const was = seen.get(x.t.id);
    if (was !== x.state && !opening) {
      if (x.state === 'rdy') {
        fresh.set(x.t.id, { kind: 'wake', until: 0 });
        // The tech the tree is open on has just become affordable: on a phone, bring its sheet up with the
        // Research button, unless a finger is on the screen.
        if (x.t.id === ui.techSel && !sheet && !panel.busy()) raise = sheet = true;
      } else if (x.state === 'own') fresh.set(x.t.id, { kind: 'won', until: 0 });
      else if (!was) fresh.set(x.t.id, { kind: 'new', until: 0 });
    }
    seen.set(x.t.id, x.state);
  }

  const tabs = phone
    ? groups.map(({ branch, list }) => `<button class="ttab${branch.id === tab ? ' on' : ''}" data-key="${branch.id}" data-act="tab:${branch.id}" data-testid="tab-${branch.id}" role="tab" aria-selected="${branch.id === tab}">`
      + `${esc(branch.name)}${list.some((x) => x.state === 'rdy') ? '<i class="dot" title="Something is ready here"></i>' : ''}</button>`).join('')
    : '';
  // Inside a branch, what can still be done comes first; what is already owned follows as a quieter group.
  const sections = groups.filter(({ branch }) => !phone || branch.id === tab).map(({ branch, list }) => {
    const todo = list.filter((x) => x.state !== 'own').map((x) => tileHtml(g, x, want)).join('');
    const done = list.filter((x) => x.state === 'own').map((x) => tileHtml(g, x, want)).join('');
    return `<section class="tbranch" data-key="${branch.id}" aria-label="${esc(branch.name)}"><div class="bh"><h2>${esc(branch.name)}</h2><p>${esc(branch.sub)}</p></div>`
      + `<div class="tlist">${todo}</div><div class="towned">${done}</div></section>`;
  }).join('');
  // Whatever is further ahead is not drawn at all; one quiet line says the tree will grow.
  const hiddenLeft = tiles.length < Object.values(TECHS).filter((t) => !techHidden(g, t)).length;
  // A goal that is waiting to be claimed sits on the board, behind this screen. On a phone this bar says so and
  // leads back to Claim. Elsewhere the HUD lifts its own slim Claim bar above the tree, and this element is
  // only the empty seat that bar lands on (tech.css): one way to claim on either layout, never two.
  const waiting = g.goal.ready ? GOALS[g.goal.i] : null;
  const claim = `<button class="tgoal" data-act="close"${waiting ? '' : ' hidden'}>`
    + `${waiting ? `${glyph(FLAG, 18)}<span class="gt"><b>Goal complete</b><span>${esc(waiting.title)}</span></span><span class="go">Claim on the board</span>` : ''}</button>`;
  const html = `${headHtml(g, tiles)}${claim}<div class="ttabs" role="tablist"${phone ? '' : ' hidden'}>${tabs}</div>`
    + `<div class="tree">${sections}${hiddenLeft ? '<p class="more">More shows up as you research.</p>' : ''}</div>`
    + `<aside class="tdetail" aria-label="Selected tech">${detailHtml(g, sel, want)}</aside>`;

  setClass(host, 'sheet', sheet);
  if (panel.render(html, force)) {
    for (const f of fresh.values()) if (!f.until) f.until = now + FRESH_MS;
  }
  if (force && scrollTo) {
    settleScroll(scrollTo === 'top');
    scrollTo = null;
  } else if (raise && phone) settleScroll(false);
}

/** After a press moved the selection: bring the selected tile (and, on a phone, the active tab) into view. */
function settleScroll(toTop: boolean) {
  const tree = host.querySelector<HTMLElement>('.tree');
  if (!tree) return;
  if (toTop) tree.scrollTop = 0;
  const tile = tree.querySelector<HTMLElement>('.tt.sel');
  if (tile) {
    const box = tree.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    if (r.top < box.top + 8) tree.scrollTop -= box.top + 8 - r.top;
    else if (r.bottom > box.bottom - 8) tree.scrollTop += r.bottom - (box.bottom - 8);
  }
  const strip = host.querySelector<HTMLElement>('.ttabs');
  const on = strip?.querySelector<HTMLElement>('.ttab.on');
  if (strip && on) {
    const box = strip.getBoundingClientRect();
    const r = on.getBoundingClientRect();
    if (r.left < box.left + 8) strip.scrollLeft -= box.left + 8 - r.left;
    else if (r.right > box.right - 8) strip.scrollLeft += r.right - (box.right - 8);
  }
}

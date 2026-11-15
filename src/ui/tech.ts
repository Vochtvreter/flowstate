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
//
// The keyboard: opening the tree moves the focus into it (to the selected tile) and closing it gives the
// focus back. While it is open, what lies behind it is `inert` (coverFor in hud-screens.ts): Tab, Enter and
// a pointer cannot reach the board, the build bar or the inspector, only the tree, the top bar above it on a
// wide screen, and the HUD's Claim bar when it lies over the tree. Enter and Space research the selected tech.
//
// While the goal on the card is saving up for a tech, the tree opens on that tech, says how long it takes in
// the card's own words and numbers (waitLine, from the adviser), warns on any other tech that would spend the
// same Data, and the top bar's "N ready" leaves those out (readyCount).
import { BRANCHES, Branch, DATA_COLORS, DATA_NAMES, DataTier, NODE_DEFS, NodeType, TECHS, Tech } from '../content';
import { fmtInt, fmtRate, readyTechs, research, techAffordable, techAvailable, techEta, techHidden, techProgress } from '../economy';
import { GOALS, activeGoal, claimGoal } from '../goals';
import { Game } from '../state';
import { Panel, makePanel, setClass } from './dom';
import { UNCOVER_DELAY, coverFor } from './hud-screens';
import { aboutTime, isTouch } from './hud-words';
import { esc, icon } from './icons';
import { delegate, onGame, onNewGame, onSignal, toast, touch, ui } from './ui';

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
  /** Researching it would spend Data the goal on the card is saving up (goalDelay). */
  slows: boolean;
}

const TIERS: DataTier[] = ['a', 'b', 'g'];

/** For each game, the kinds of Data the player has met. Once met, a kind stays met. */
const metSeen = new WeakMap<Game, Partial<Record<DataTier, boolean>>>();

/**
 * Has the player met this kind of Data: had some, made some, or owned a tech priced in it? Before β exists
 * (the first Glyph studied), a price in β means nothing, so nothing priced in it is shown (see techTiles).
 */
export function metData(g: Game, k: DataTier): boolean {
  let seen = metSeen.get(g);
  if (!seen) metSeen.set(g, (seen = {}));
  if (!seen[k] && (g.data[k] > 0 || g.dataRate[k] > 0 || g.techs.some((t) => (TECHS[t]?.cost[k] ?? 0) > 0))) seen[k] = true;
  return !!seen[k];
}

/**
 * Every kind of Data in this tech's price has been met. (α counts as met from the start: it is the first Data,
 * the tree opens before any is made, and the tree's own hint says how to make it.)
 */
export const pricedInMet = (g: Game, t: Tech) => TIERS.every((k) => k === 'a' || !t.cost[k] || metData(g, k));

/**
 * The techs the tree shows right now, in content order:
 *  - in full: owned, researchable now (affordable or not), or queued;
 *  - one step beyond those: a tech whose every requirement is shown in full. It is a silhouette, except
 *    that a goal reward whose requirements are all owned says which goal it comes from.
 * Everything else, and whatever techHidden() hides, is left out; so is a tech priced in a kind of Data the
 * player has not met yet (Priority Routing's β at goal 13), unless the goal on the card names it.
 */
export function techTiles(g: Game): Tile[] {
  const want = goalTech(g);
  const all = Object.values(TECHS).filter((t) => !techHidden(g, t) && (g.techs.includes(t.id) || t.id === want || pricedInMet(g, t)));
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
    const slows = (state === 'rdy' || state === 'sav') && !!goalDelay(g, t);
    out.push({ t, state, veiled, needs, queued: state !== 'own' && g.queue.includes(t.id), slows });
  }
  return out;
}

/**
 * The tech the active goal asks the player to research, if it names one ("Research Assembly, then..."): the
 * tech its next step is saving up for (Goal.step), or else one its wording names; no match means no badge.
 */
export function goalTech(g: Game): string | null {
  const goal = GOALS[g.goal.i];
  if (!goal || g.goal.ready) return null;
  const saving = goalSaving(g);
  if (saving?.tech) return saving.tech.id;
  const text = `${goal.title}. ${goal.hint.mouse}`;
  // The longest name wins, so "Pipes Mk III" is never taken for "Pipes Mk II".
  let best: Tech | null = null;
  for (const t of Object.values(TECHS)) {
    if (t.auto || !text.includes(`Research ${t.name}`)) continue;
    if (!best || t.name.length > best.name.length) best = t;
  }
  return best && !g.techs.includes(best.id) ? best.id : null;
}

// ---------- the goal's wait ----------

const TIER_OF: Record<string, DataTier> = { α: 'a', β: 'b', γ: 'g' };

/** What the goal card's progress line counts during a wait, and how long it says that takes (advice-tip.ts). */
export interface CardWait { unit: string; have: number; need: number; eta: number }

/**
 * The goal card's wait, as the card itself works it out: waitLine() in advice-tip.ts, handed in by panels.ts.
 * (Not imported here: that module brings the board with it, and the rules of this file are tested without a
 * page.) Until it is handed in, there is no card wait and the tree counts with the game's own rates.
 */
let cardWait: (g: Game) => CardWait | null = () => null;
export function setCardWait(fn: (g: Game) => CardWait | null) {
  cardWait = fn;
}

/** What the goal on the card is saving Data for, and how much of each kind it needs. */
export interface GoalSaving {
  /** The tech its next step names; null for a goal that counts Data itself ("Study Glyph for β"). */
  tech: Tech | null;
  need: Partial<Record<DataTier, number>>;
  /** Credits the same step needs straight after the research (the machine it asks for next); 0 or absent: none. */
  then?: number;
}

/**
 * The Data the active goal is saving up, if any: the price of the tech its next step names (not yet owned), or
 * for a goal that counts a kind of Data itself, that count. null while the goal is ready, or saves credits.
 */
export function goalSaving(g: Game): GoalSaving | null {
  const goal = activeGoal(g);
  if (!goal || g.goal.ready) return null;
  const step = goal.step?.(g) ?? null;
  if (step) {
    if (!('tech' in step)) return null;
    const t = TECHS[step.tech];
    return t && !g.techs.includes(t.id) ? { tech: t, need: { ...t.cost }, then: step.then ?? 0 } : null;
  }
  const p = goal.progress?.(g) ?? null;
  const k = p ? TIER_OF[p[2]] : undefined;
  return p && k && p[0] < p[1] ? { tech: null, need: { [k]: p[1] } } : null;
}

/**
 * How fast each kind of Data is coming in, as the goal card counts it: the income the adviser measured for
 * the goal's wait when its answer is about that kind of Data (waitLine), else the game's own rate.
 */
function dataRate(g: Game, k: DataTier): number {
  const w = cardWait(g);
  if (w && TIER_OF[w.unit] === k && isFinite(w.eta) && w.eta > 0 && w.need > w.have) return (w.need - w.have) / w.eta;
  return g.dataRate[k];
}

/**
 * Seconds until this tech can be researched. For the tech the goal is saving for, the card's own number when
 * the card shows one (waitLine counts the same Data at the same income), so the two never disagree.
 */
export function etaOf(g: Game, t: Tech): number {
  const w = cardWait(g);
  const k = w ? TIER_OF[w.unit] : undefined;
  if (w && k && goalSaving(g)?.tech?.id === t.id && t.cost[k] === w.need) return w.eta;
  return techEta(g, t);
}

/** Seconds until the goal's Data is in hand, having spent `spend` first (Infinity when some of it is not coming in). */
function savedIn(g: Game, s: GoalSaving, spend: Partial<Record<DataTier, number>>): number {
  let eta = 0;
  for (const k of TIERS) {
    const short = (s.need[k] ?? 0) - (g.data[k] - (spend[k] ?? 0));
    if (short <= 1e-9) continue;
    const r = dataRate(g, k);
    eta = Math.max(eta, r > 1e-9 ? short / r : Infinity);
  }
  return eta;
}

/**
 * Seconds until the credits the goal's step needs after its research (`then`) are in hand: 0 when there are
 * none or they are in hand already, Infinity when nothing is bringing credits in. Counted at the income the goal
 * card counts with when its wait is about credits (waitLine), else at the game's own rate.
 */
function creditsIn(g: Game, s: GoalSaving): number {
  const short = (s.then ?? 0) - g.credits;
  if (short <= 1e-9) return 0;
  const w = cardWait(g);
  const rate = w && w.unit === '¢' && isFinite(w.eta) && w.eta > 0 && w.need > w.have ? (w.need - w.have) / w.eta : g.creditRate;
  return rate > 1e-9 ? short / rate : Infinity;
}

/**
 * How much researching `t` now would put off the goal: the kinds of Data it takes from what the goal is saving,
 * and by how many seconds (Infinity when nothing is bringing that Data in). null when it takes nothing the goal
 * needs, is the goal's tech itself, or puts nothing off because the goal waits longer for the credits its step
 * needs after the research (goal 21: Fabrication's α is in hand well before the Fabricator's 7,100¢).
 */
export function goalDelay(g: Game, t: Tech): { tiers: DataTier[]; seconds: number; saving: GoalSaving } | null {
  const s = goalSaving(g);
  if (!s || s.tech?.id === t.id) return null;
  const tiers = TIERS.filter((k) => (t.cost[k] ?? 0) > 0 && (s.need[k] ?? 0) > 0 && g.data[k] - (t.cost[k] ?? 0) < (s.need[k] ?? 0) - 1e-9);
  if (!tiers.length) return null;
  const before = savedIn(g, s, {});
  const after = savedIn(g, s, t.cost);
  // The step is done when both its Data and its credits are in. (Credits that are not coming in at all say
  // nothing about when: the Data alone is counted then, as for a step with no credits.)
  const credits = creditsIn(g, s);
  const c = isFinite(credits) ? credits : 0;
  // (When `before` never ends, neither does `after`: the price is short of a kind nothing is bringing in.)
  const seconds = after === Infinity ? Infinity : Math.max(0, Math.max(after, c) - Math.max(before, c));
  return seconds > 0.5 || seconds === Infinity ? { tiers, seconds, saving: s } : null;
}

/** "Spends α you are saving for Ember Deposits: about 1 min later." */
export function delayText(d: NonNullable<ReturnType<typeof goalDelay>>): string {
  const what = listText(d.tiers.map((k) => DATA_NAMES[k]));
  const target = d.saving.tech ? `you are saving for ${d.saving.tech.name}` : 'your goal is counting';
  const later = d.seconds === Infinity ? '' : `: ${aboutTime(d.seconds)} later`;
  return `Spends ${what} ${target}${later}.`;
}

/**
 * How many techs the top bar's badge counts as ready: those that can be researched now and take nothing from
 * what the goal is saving for. (A tech that would put the goal off is not an invitation; its detail says so.)
 */
export function readyCount(g: Game): number {
  return readyTechs(g).filter((t) => pricedInMet(g, t) && !goalDelay(g, t)).length;
}

/** The machines of the goal chain's spine, in the order it unlocks them. */
const SPINE: NodeType[] = ['refiner', 'assembler', 'fabricator'];

/**
 * The one locked slot the build bar shows, as a dim silhouette with what unlocks it: the next machine of the
 * spine that is still locked, once what unlocks it is in sight. That is when its research can be done now (the
 * tree shows it in full), or when the goal on the card asks for that research or pays it out as its reward
 * (the card names it). Everything else that is locked stays out of the bar until the player has it.
 * `goal` = it comes with a goal and cannot be researched: there is nothing to open in the tree for it.
 */
export function teasedSlot(g: Game): { type: NodeType; tech: Tech; goal: boolean } | null {
  const type = SPINE.find((t) => !g.techs.includes(NODE_DEFS[t].tech ?? ''));
  const tech = type ? TECHS[NODE_DEFS[type].tech ?? ''] : null;
  if (!type || !tech) return null;
  const reward = !!GOALS[g.goal.i]?.reward.techs?.includes(tech.id);
  if (reward || techAvailable(g, tech) || goalTech(g) === tech.id) return { type, tech, goal: !!tech.auto };
  return null;
}

const ORDER: Record<TileState, number> = { rdy: 0, sav: 1, goal: 3, lck: 4, own: 5 };

/**
 * Ready first, then saving, then what is still closed, with owned techs last. Inside a group: the goal's tech,
 * then tree order, with what would put the goal off at the end of its group.
 */
function sortTiles(tiles: Tile[], want: string | null): Tile[] {
  const rank = (x: Tile) => (x.state === 'lck' && !x.veiled ? 2 : ORDER[x.state]) - (x.t.id === want ? 0.5 : 0) + (x.slows ? 0.25 : 0);
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

/** A wait in round, calm numbers ("about 40 s", "about 3 min"), worded as the goal card words its own. */
const aboutText = (seconds: number) => aboutTime(seconds) || 'over an hour';

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

const app = () => (appEl ??= document.getElementById('app'));
/** The phone layout is in use (the phone module sets the class). */
const isPhone = () => !!app()?.classList.contains('phone');
/**
 * What the stylesheets need to know about the tree, as classes on #app: `tech-open` while it is open, and
 * `tech-seat` while it is open with a goal ready (outside the phone layout the HUD's slim Claim bar then
 * lies over the top of the tree, and the tree's own bar is the seat for it: see tech.css). It also keeps
 * what lies behind the open tree out of reach (coverBehindTree).
 */
function markApp(open: boolean, goalReady: boolean) {
  const el = app();
  if (!el) return;
  setClass(el, 'tech-open', open);
  setClass(el, 'tech-seat', open && goalReady);
  if (open) coverBehindTree(goalReady);
}

/** What the tree last made inert ('' = nothing). */
let coveredKey = '';
let uncoverTimer = 0;

/**
 * While the tree is open nothing behind it can be reached by Tab, Enter or a pointer: the build bar, the
 * board with everything on it, the inspector, the card. What stays in reach is the tree itself, the toasts,
 * the top bar where it is in sight above the tree (not on a phone, where the tree covers it), and the
 * HUD's Claim bar where it lies over the tree (a ready goal, outside the phone layout).
 */
function coverBehindTree(goalReady: boolean) {
  const root = app();
  if (!root) return;
  const phone = isPhone();
  const key = `${phone ? 1 : 0}${goalReady ? 1 : 0}`;
  clearTimeout(uncoverTimer);
  if (key === coveredKey) return;
  coveredKey = key;
  const out: Element[] = [];
  const keep = new Set(['tech', 'start', 'summary', 'modal']);
  for (const e of Array.from(root.children)) {
    if (keep.has(e.id) || (e.id === 'top' && !phone)) continue;
    if (e.id !== 'stage') {
      out.push(e);
      continue;
    }
    for (const s of Array.from(e.children)) {
      if (s.id !== 'hud') {
        out.push(s);
        continue;
      }
      for (const h of Array.from(s.children)) if (h.id !== 'hud-strip' && h.id !== 'toasts') out.push(h);
    }
  }
  for (const id of ['order', 'hud-alert']) {
    const e = document.getElementById(id);
    if (e) out.push(e);
  }
  const goal = document.getElementById('goal');
  if (goal && (phone || !goalReady)) out.push(goal);
  coverFor('tech', out);
}

/** The tree has closed: what it covered can be reached again, at once or (after a press) a moment later. */
function uncoverBehindTree(later: boolean, then: () => void) {
  clearTimeout(uncoverTimer);
  coveredKey = '';
  const done = () => {
    coverFor('tech', null);
    then();
  };
  // A press that closed the tree (Back, Claim) is often pressed twice: the second press must not land on
  // whatever was under the button.
  if (later) uncoverTimer = window.setTimeout(done, UNCOVER_DELAY);
  else done();
}

/**
 * Where the focus was when the tree opened: it goes back there when the tree closes. Panels are patched in
 * place, so the element may have come to stand for something else meanwhile (research added a slot to the
 * build bar before it): its test id says what it was.
 */
let returnFocus: { el: HTMLElement; id: string | null } | null = null;
let focusTimer = 0;

/** Put the focus on the selected tile (or, with none, the way back to the board). */
function focusTree() {
  if (!ui.techOpen) return;
  const target = host.querySelector<HTMLElement>('.tt.sel') ?? host.querySelector<HTMLElement>('[data-testid="close-tech"]');
  target?.focus({ preventScroll: true });
}

/** A key press that means "research the selected tech": Enter or Space, unless a control of its own takes it. */
function researchKey(e: KeyboardEvent): boolean {
  if (e.key !== 'Enter' && e.key !== ' ') return false;
  const control = (e.target as HTMLElement | null)?.closest?.('button, a, input, textarea, select, [role="button"]');
  // A focused control answers Enter and Space itself (Research, Back, a tab, another tile: that one is
  // selected by it), except the selected tile: there the key means "research this".
  return !control || (control.classList.contains('tt') && control.getAttribute('data-key') === ui.techSel);
}

export function initTech(el: HTMLElement) {
  host = el;
  panel = makePanel(host);
  delegate(host, (a, args, _el, ev) => {
    const g = ui.g;
    const pressed = ev.type !== 'click' || (ev as MouseEvent).detail > 0;
    if (a === 'close') return closeTech(pressed);
    if (a === 'claim') return claimFromTree(pressed);
    if (a === 'sel') selectTech(args[0]);
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
  // Enter and Space research the selected tech, so a player with Data to spend can keep going from the
  // keyboard. (Opening the tree put the focus on that tech's tile, wherever it was before.)
  window.addEventListener('keydown', (e) => {
    if (!ui.techOpen || e.ctrlKey || e.metaKey || e.altKey || !researchKey(e)) return;
    if (document.getElementById('modal')?.classList.contains('open') || document.getElementById('summary')?.hidden === false) return;
    // The key is the tree's either way: it must not scroll the list, nor press anything else as well.
    e.preventDefault();
    if (e.repeat || !ui.techSel) return;
    doResearch(ui.techSel);
    renderTech(true);
    // The focus follows the selection, which may have moved on to the next tech that is ready.
    focusTree();
  });
  // "Show me" on a tip about research: the tree is already open on the tech; its Research button gets the ring.
  onSignal('showme', (d) => {
    if (d.press !== 'research' || !ui.techOpen || !ui.techSel) return;
    ringed = ui.techSel;
    renderTech(true);
  });
  // A goal turning ready or being claimed changes the top of the tree (its bar, or the seat for the HUD's):
  // drawn at once, in step with the HUD, not at the next half-second refresh.
  onGame((ev) => {
    if (ui.techOpen && (ev.kind === 'goal-ready' || ev.kind === 'goal-claimed')) renderTech(true);
    // The first Lens ends the demo: its celebration and the summary play on the board, not behind the tree.
    if (ev.kind === 'demo-end' && ui.techOpen) closeTech();
  });
  onNewGame(() => {
    // A different game: nothing remembered about the old one applies.
    if (ui.techOpen) closeTech();
    returnFocus = null;
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

/**
 * Research, then move on: to the goal's tech when that can be researched now, else to the next tech in the same
 * branch that can be researched right away without putting the goal off.
 */
function doResearch(id: string) {
  const g = ui.g;
  const t = TECHS[id];
  if (id === ringed) ringed = null; // pressed: the ring has done its work
  if (!t || !research(g, id)) return; // (the tree itself shows what was researched; no toast while it is open)
  const tiles = techTiles(g);
  const want = goalTech(g);
  const next = tiles.find((x) => x.t.id === want && x.state === 'rdy')
    ?? sortTiles(tiles.filter((x) => x.t.branch === t.branch), want).find((x) => x.state === 'rdy' && !x.slows);
  if (!next) return; // nothing more to buy here: stay on what was just researched
  ui.techSel = next.t.id;
  scrollTo = 'show';
}

/**
 * The tree's own "Goal complete" bar, on a phone: one press claims the goal and goes back to the board, where
 * the claim is celebrated. (Elsewhere the HUD's slim Claim bar lies over the tree and is the way to claim.)
 */
function claimFromTree(pressed: boolean) {
  const g = ui.g;
  if (!g.goal.ready) return closeTech(pressed);
  closeTech(pressed);
  claimGoal(g);
  touch();
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
    const eta = etaOf(g, x.t);
    if (!best || eta < bestEta) {
      best = x;
      bestEta = eta;
    }
  }
  return best ?? tiles.find((x) => x.state !== 'own') ?? tiles[0] ?? null;
}

/** The first tech that can be researched now without putting the goal off. */
const firstReady = (groups: { list: Tile[] }[]) => {
  for (const grp of groups) {
    const x = grp.list.find((y) => y.state === 'rdy' && !y.slows);
    if (x) return x;
  }
  return null;
};

/**
 * Open the tree. With an id (a locked hotbar slot, "View tech" in the inspector) it opens on that tech,
 * or on the nearest step toward it when it is too far ahead to be shown. Without one it opens on the tech
 * the goal on the card is saving for (or the nearest step toward it), else on the first tech that can be
 * researched now, so the next step is one press away.
 */
export function openTech(id?: string) {
  const g = ui.g;
  // Asked to open while already open (the top-bar button again): leave the player's place alone.
  if (ui.techOpen && !id) return;
  const wasOpen = ui.techOpen;
  ui.techOpen = true;
  const tiles = techTiles(g);
  const want = goalTech(g);
  const groups = groupTiles(tiles, want);
  const asked = id && TECHS[id] ? stepToward(tiles, id) : null;
  if (asked && id && asked.t.id !== id) {
    toast(`<span><b>${esc(TECHS[id].name)}</b> comes later. Next step: <b>${esc(asked.t.name)}</b>.</span>`, 'info', 4500);
  }
  const forGoal = !id && want ? stepToward(tiles, want) : null;
  const pick = asked ?? forGoal ?? firstReady(groups) ?? bestWaiting(g, tiles, want);
  ui.techSel = pick?.t.id ?? null;
  tab = pick?.t.branch ?? null;
  sheet = !!asked || !!forGoal || pick?.state === 'rdy';
  // Nothing "wakes up" merely because the tree was opened.
  seen.clear();
  fresh.clear();
  scrollTo = 'top';
  // The focus goes into the tree and comes back to where it was when the tree closes. (A press on the top
  // bar's button gives that button the focus after this has run, so the move waits a moment.)
  if (!wasOpen) {
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement && active !== document.body && !host.contains(active) ? { el: active, id: active.getAttribute('data-testid') } : null;
    clearTimeout(focusTimer);
    focusTimer = window.setTimeout(focusTree, 0);
  }
  setClass(host, 'open', true);
  markApp(true, g.goal.ready);
  renderTech(true);
  touch();
}

/**
 * Close the tree. `pressed`: it was closed by a press (of Back, or of the goal's bar), which may well be pressed
 * twice: what lay behind the tree is then given back a moment later. The focus goes back where it was.
 */
export function closeTech(pressed = false) {
  ui.techOpen = false;
  ringed = null;
  clearTimeout(focusTimer);
  const back = returnFocus;
  returnFocus = null;
  const inTree = host.contains(document.activeElement);
  setClass(host, 'open', false);
  markApp(false, false);
  uncoverBehindTree(pressed, () => {
    if (ui.techOpen) return;
    let to = back?.el ?? null;
    if (back?.id && to?.getAttribute('data-testid') !== back.id) to = document.querySelector<HTMLElement>(`[data-testid="${back.id}"]`);
    if (to?.isConnected && !to.closest('[inert]')) to.focus({ preventScroll: true });
    else if (inTree && document.activeElement instanceof HTMLElement && host.contains(document.activeElement)) document.activeElement.blur();
  });
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
  // (What would put the goal off says so in the list too; its detail says by how much.)
  const slow = x.slows ? '<span class="slow"> · slows your goal</span>' : '';
  if (x.state === 'rdy') return `${costHtml(t)}<span class="st"> · Ready</span>${slow}`;
  if (x.state === 'lck') return `${costHtml(t)}<span class="st"> · ${esc(needsText(x))}</span>`;
  const dry = dryTier(g, t);
  const wait = dry ? (g.data[dry] > 0 ? `no ${DATA_NAMES[dry]} coming in` : `no ${DATA_NAMES[dry]} yet`) : aboutText(etaOf(g, t));
  return `${costHtml(t)}<span class="st"> · ${wait}${x.queued ? ' · auto' : ''}</span>${slow}`;
}

function tileHtml(g: Game, x: Tile, want: string | null): string {
  const t = x.t;
  const sel = t.id === ui.techSel;
  let cls = `tt ${x.state}`;
  if (x.veiled) cls += ' veil';
  if (sel) cls += ' sel';
  if (x.queued) cls += ' queued';
  if (x.slows) cls += ' slows';
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
    // Spending the Data the goal on the card is saving up: said where the player decides, with what it costs in time.
    const delay = x.slows ? goalDelay(g, t) : null;
    if (delay) body += `<p class="slows" data-testid="tech-slows">${icon('warn', 15)}<span>${esc(delayText(delay))}</span></p>`;
    foot = `<div class="costs">${costRows(g, t)}</div>${dry ? `<p class="hint">${HOW[dry]}</p>` : ''}`;
    if (x.state === 'rdy') {
      foot += `<button class="rbtn ok${fresh.has(t.id) ? ' wake' : ''}${t.id === ringed ? ' hl' : ''}" data-act="research:${t.id}" data-testid="research"><span class="lab">Research</span><span class="kbd">Enter</span></button>`;
    } else {
      const label = x.state === 'lck' ? needsText(x) : dry ? `Not enough ${DATA_NAMES[dry]} yet` : `Ready in ${aboutText(etaOf(g, t))}`;
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

  // (A tab's dot invites like the top bar's badge: a tech that would put the goal off does not light it.)
  const tabs = phone
    ? groups.map(({ branch, list }) => `<button class="ttab${branch.id === tab ? ' on' : ''}" data-key="${branch.id}" data-act="tab:${branch.id}" data-testid="tab-${branch.id}" role="tab" aria-selected="${branch.id === tab}">`
      + `${esc(branch.name)}${list.some((x) => x.state === 'rdy' && !x.slows) ? '<i class="dot" title="Something is ready here"></i>' : ''}</button>`).join('')
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
  // A goal that is waiting to be claimed. On a phone this bar says so, and one press on it claims the goal and
  // goes back to the board. Elsewhere the HUD lifts its own slim Claim bar above the tree, and this element is
  // only the empty seat that bar lands on (tech.css): one way to claim on either layout, never two.
  const waiting = g.goal.ready ? GOALS[g.goal.i] : null;
  const claim = phone
    ? `<button class="tgoal" data-act="claim" data-testid="tree-claim"${waiting ? '' : ' hidden'}>`
      + `${waiting ? `${glyph(FLAG, 18)}<span class="gt"><b>Goal complete</b><span>${esc(waiting.title)}</span></span><span class="go">Claim</span>` : ''}</button>`
    : `<div class="tgoal" aria-hidden="true"${waiting ? '' : ' hidden'}></div>`;
  const html = `${headHtml(g, tiles)}${claim}<div class="ttabs" role="tablist"${phone ? '' : ' hidden'}>${tabs}</div>`
    + `<div class="tree">${sections}${hiddenLeft ? '<p class="more">More shows up as you research.</p>' : ''}</div>`
    + `<aside class="tdetail" aria-label="Selected tech">${detailHtml(g, sel, want)}</aside>`;

  setClass(host, 'sheet', sheet);
  markApp(true, !!waiting);
  // A refresh can replace the element that has the focus (a tile that moved): the focus stays in the tree.
  const focused = host.contains(document.activeElement);
  if (panel.render(html, force)) {
    for (const f of fresh.values()) if (!f.until) f.until = now + FRESH_MS;
    if (focused && !host.contains(document.activeElement)) focusTree();
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

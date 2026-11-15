// The big moments: first Shard, the Lab, first Spark, first Glyph, the first Flow State, first Prism
// and the first Lens: one every three to four minutes of a first game.
// Each gets a colour wash, a card in the middle of the screen, particles and a fanfare. Shard, Lab,
// Glyph and Lens are each bigger than the one before; Spark and Prism are the Shard's size, each with
// a motif of its own in its material's shape and colour. The Lens is also the end of the demo: the
// moment it is made the factory takes a bow (a pulse runs along the wires from the Wells to the Lens,
// lighting each card it passes) and then its card comes up.
//
// A press anywhere sends a celebration on its way (the reward flies at once and the card leaves).
// A press on the card itself goes no further: it is what a newcomer does to put the card away, and
// on a phone the board under the card would otherwise take it as a tap on a node or a wire and open
// the inspector over half the screen. Everywhere else (the wash, the space around the card) ignores
// the pointer, so a press there lands on the game underneath as well. Everything added to the page
// is taken out again when it ends. The four that follow a claim are over in about 2.5 s; the Lens,
// bow and all, stays until the summary screen opens 6.5 s after the Lens is made, and leaves with it.
import { DATA_COLORS, MATERIALS, MatId, NODE_DEFS, NodeType, RULES, TECHS } from '../content';
import { recipeOf } from '../economy';
import { GOALS } from '../goals';
import { graph, isMachine } from '../sim';
import { GNode, GoalReward } from '../state';
import { boardRect, fitView, frameNodes, toClient } from './board';
import { anchorPt } from './dom';
import { SUMMARY_DELAY } from './hud-screens';
import { Overlay, addOverlay, burst, fly, holdFlows, ring } from './fx';
import { Pt, bezierAt, nodeSize, wireEnds } from './geom';
import { esc, icon, matGlyph, nodeIcon } from './icons';
import { env } from './phone-env';
import { Fanfare, buzz, cueBowNote, cueFanfare, cueResearch, cueWhoosh } from './audio';
import { ui } from './ui';

export type BigKind = Fanfare;
/** The big cards, and the small one ('note') for the end of a research wait or the first β. */
type CardKind = BigKind | 'note';

interface Spec {
  kind: CardKind;
  /** A word or two above the title (the small card: "Researched"). */
  kicker?: string;
  title: string;
  line: string;
  /** What the log calls it (big:<kind> unless given). */
  logAs?: string;
  /** The sound it opens with (the kind's fanfare unless given). */
  cue?: () => void;
  /** HTML of the large glyph. */
  glyph: string;
  color: string;
  /** How long the card stays, in ms, before it leaves by itself. */
  life: number;
  /** Runs once the card is on screen, with the centre of its glyph. Particles go here. */
  show?: (at: Pt, spec: Spec) => void;
  /** What the goal paid. It flies from the glyph to the counters `payAt` ms in, or at once if the card is sent away sooner. */
  reward?: GoalReward;
  payAt?: number;
  /** Runs when the card starts to leave (its time is up, or a press sent it away). */
  leaving?: () => void;
  /** Runs when it ends, however it ends. */
  done?: () => void;
  /**
   * The Lens at the end of the demo: no press or key sends it away (a press on the card itself still
   * goes no further), and it leaves when the summary screen opens, as the summary fades in over it.
   */
  holds?: boolean;
}

/**
 * A card is never sent away sooner than this after it came up, in ms: the second press of a double
 * press on Claim would otherwise take it down before it had been seen. (That press still reaches
 * the game, and the card leaves as soon as this is up.)
 */
const MIN_SHOWN_MS = 400;
/** How far the middle of the glyph is above the middle of the card, in px, for each size of card. */
const GLYPH_RISE: Record<CardKind, number> = { shard: 36, lab: 37, spark: 36, glyph: 41, flow: 36, prism: 36, lens: 47, note: 38 };
const OUT_MS = 320;
/** How long the dots hold still under the Lens card, which stays until the summary (see start). */
const LENS_HOLD_MS = 1500;

let app: HTMLElement;
let record: (kind: 'celebrate', name: string, detail?: string | number) => void = () => {};
let payout: (from: Pt, r: GoalReward) => void = () => {};
const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!reducedQuery?.matches;

interface Card { spec: Spec; wash: HTMLElement | null; wrap: HTMLElement; timers: number[]; raf: number; leaving: boolean; shownAt: number; at: Pt; paid: boolean }
let current: Card | null = null;
const queue: Spec[] = [];

export function initCelebrate(hooks: { record: typeof record; payout: typeof payout }) {
  app = document.getElementById('app') ?? document.body;
  record = hooks.record;
  payout = hooks.payout;
  addOverlay(bowOverlay);
  // A press or a key anywhere sends the celebration on its way. The press itself is not touched: it
  // reaches whatever is under the pointer.
  const dismiss = () => {
    if (bow && !bow.revealed) return void revealLens();
    const c = current;
    if (!c || c.leaving || c.spec.holds) return;
    const wait = MIN_SHOWN_MS - (performance.now() - c.shownAt);
    if (wait <= 0) leave();
    else c.timers.push(window.setTimeout(() => current === c && leave(), wait));
  };
  window.addEventListener('pointerdown', dismiss, { capture: true, passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') dismiss();
  }, true);
  // The summary screen is never shared with a celebration for long. The Lens card is waiting for it: it
  // leaves as the summary fades in over it (the two take about the same 0.3 s). Anything else still up
  // when the summary opens (a page that was held up: a background tab, a long frame) is taken down on
  // the spot.
  if (typeof MutationObserver !== 'undefined') {
    const watch = new MutationObserver(() => {
      const summary = document.getElementById('summary');
      if (!summary || summary.hasAttribute('hidden') || !celebrating()) return;
      if (current?.spec.holds && !queue.length) {
        record('celebrate', 'leave', 'summary');
        endBow();
        leave();
        return;
      }
      record('celebrate', 'cut', 'summary');
      cancelCelebrations();
    });
    const summary = document.getElementById('summary');
    if (summary) watch.observe(summary, { attributes: true, attributeFilter: ['hidden'] });
  }
}

/** True while a card is up or the factory is taking its bow. */
export const celebrating = () => !!current || !!bow;

/** Take everything down at once (the game was reset). */
export function cancelCelebrations() {
  queue.length = 0;
  endBow();
  if (current) remove();
  for (const e of leads.splice(0)) e.remove();
}

// ---------- the card ----------

function start(spec: Spec) {
  if (current) {
    if (queue.length < 2) queue.push(spec);
    return;
  }
  const calm = reduced();
  const small = spec.kind === 'note';
  record('celebrate', spec.logAs ?? 'big:' + spec.kind, spec.title);
  let wash: HTMLElement | null = null;
  // (The small card has no wash: it is a note, not a scene.)
  if (!calm && !small) {
    wash = document.createElement('div');
    wash.className = `cel-wash k-${spec.kind}`;
    wash.style.setProperty('--c', spec.color);
    wash.style.setProperty('--life', washLife(spec) + 'ms');
  }
  const wrap = document.createElement('div');
  wrap.className = `cel k-${spec.kind}${calm ? ' calm' : ''}`;
  wrap.setAttribute('data-testid', 'celebration');
  wrap.style.setProperty('--c', spec.color);
  const kicker = spec.kicker ? `<div class="cel-kicker">${esc(spec.kicker)}</div>` : '';
  wrap.innerHTML = `<div class="cel-card" role="status"><div class="cel-glyph">${spec.glyph}</div><div class="cel-words">${kicker}<div class="cel-title">${esc(spec.title)}</div><div class="cel-line">${esc(spec.line)}</div></div></div>`;
  // A press on the card is for the card: it sends it away (the window's listener, in initCelebrate, has
  // already seen to that) and goes no further, and nor does the click that follows it. (Nor does a right
  // press bring up the browser's menu, which the board under the card keeps away too.)
  const card = wrap.firstElementChild as HTMLElement;
  card.addEventListener('pointerdown', swallow);
  card.addEventListener('click', swallow);
  card.addEventListener('contextmenu', swallow);
  app.appendChild(wrap);
  const timers: number[] = [];
  // The glyph sits a little above the middle of the card, which is in the middle of the window; on a
  // screen too short for that the card lies flat and the glyph is at its left end (feel.css).
  // (Worked out rather than measured: measuring here would make the browser lay the page out on the spot.)
  const flat = window.innerHeight < FLAT.below;
  const at = flat
    ? { x: window.innerWidth / 2 - Math.min(FLAT.width, window.innerWidth - 32) / 2 + FLAT.glyphX, y: window.innerHeight / 2 + FLAT.down }
    : { x: window.innerWidth / 2, y: window.innerHeight / 2 - GLYPH_RISE[spec.kind] };
  const c: Card = (current = { spec, wash, wrap, timers, raf: 0, leaving: false, shownAt: performance.now(), at, paid: false });
  // A big card covers the middle of the board: the dots there hold still until it has gone, which saves
  // redrawing the whole board layer while the card, its wash and its sparks are on screen. Not under the
  // Flow State card, whose news is that everything is running flat out (it has no sparks and costs
  // little). The Lens card stays for five seconds or more, until the summary: there they hold for its
  // opening only, as a factory standing still that long at its finest moment reads as one that has stopped.
  if (!small && spec.kind !== 'flow') {
    holdFlows(true);
    if (spec.holds) timers.push(window.setTimeout(() => current === c && holdFlows(false), LENS_HOLD_MS));
  }
  timers.push(window.setTimeout(leave, spec.life));
  if (spec.reward) timers.push(window.setTimeout(() => pay(c), spec.payAt ?? 700));
  // The rest of the opening is spread over the next three frames, one piece each, so that no single
  // frame has to lay out the card, paint the wash, build the fanfare's notes and launch the sparks:
  // on a slow phone that one frame was long enough to see.
  const steps = [
    () => {
      if (!wash) return;
      app.appendChild(wash);
      // Taken out as soon as it has faded: see washLife.
      timers.push(window.setTimeout(() => {
        wash.remove();
        if (current === c) c.wash = null;
      }, washLife(spec) + 60));
    },
    () => {
      if (spec.cue) spec.cue();
      else if (!small) cueFanfare(spec.kind as BigKind);
      if (small) buzz('note', [10, 30, 15]);
      else buzz('big', spec.kind === 'lens' ? [30, 60, 30, 60, 60] : spec.kind === 'glyph' ? [20, 50, 30] : spec.kind === 'spark' ? [10, 30, 30] : [20, 40, 20]);
    },
    () => !calm && spec.show?.(at, spec),
  ];
  const next = () => {
    if (current !== c) return;
    steps.shift()!();
    c.raf = steps.length ? requestAnimationFrame(next) : 0;
  };
  c.raf = requestAnimationFrame(next);
}

/** A press or click on a card: it stops there. (The press has already sent the card on its way.) */
function swallow(e: Event) {
  e.preventDefault();
  e.stopPropagation();
  if (e.type === 'pointerdown') record('celebrate', 'press', 'card');
}

/**
 * How long the colour wash lasts, in ms: as long as the card for the short ones, but never more than
 * WASH_MAX. A wash is a large see-through layer whose opacity changes on every frame, and the browser
 * has to blend it over the board for as long as it does; the Lens card stays up for three seconds and
 * more, and a wash that lasted with it cost a fifth of the frame rate under the CPU throttle. A flash
 * that fades in a second and a half says the same. (The Flow State wash breathes for the whole of its card:
 * that slow swell is the point of it, and its card is short.)
 */
const WASH_MAX = 1400;
const washLife = (spec: Spec) => (spec.kind === 'flow' ? spec.life + OUT_MS : Math.min(spec.life + OUT_MS, WASH_MAX));

/**
 * The flat card of a short screen (a phone on its side), as feel.css draws it: used below this
 * window height, this wide, with the middle of its glyph this far from its left edge, and the whole
 * card this far below the middle of the window.
 */
const FLAT = { below: 480, width: 400, glyphX: 42, down: 8 };

/** The reward leaves the glyph for the counters. Once only, however the card ends. */
function pay(c: Card) {
  if (c.paid || current !== c) return;
  c.paid = true;
  if (c.spec.reward) payout(c.at, c.spec.reward);
}

/** Start the card's exit; it is taken out of the page when the exit has played. */
function leave() {
  const c = current;
  if (!c || c.leaving) return;
  c.leaving = true;
  // Sent away before the reward had flown: it flies now.
  pay(c);
  c.spec.leaving?.();
  c.wrap.classList.add('out');
  // The wash fades from wherever its own animation has got to. (Done in script: a class that swapped
  // the animation for a transition would snap it to nothing instead.)
  if (c.wash?.animate) c.wash.animate([{ opacity: getComputedStyle(c.wash).opacity }, { opacity: 0 }], { duration: OUT_MS - 20, fill: 'forwards' });
  c.timers.push(window.setTimeout(remove, OUT_MS));
}

function remove() {
  const c = current;
  if (!c) return;
  for (const t of c.timers) clearTimeout(t);
  if (c.raf) cancelAnimationFrame(c.raf);
  c.wrap.remove();
  c.wash?.remove();
  current = null;
  holdFlows(false);
  c.spec.done?.();
  const next = queue.shift();
  if (next) start(next);
}

// ---------- what each one says and does ----------

const list = (names: string[]) => (names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);

/** One line on what a reward opened up, e.g. "Lab unlocked · +70¢". */
export function openedText(r: GoalReward): string {
  const parts: string[] = [];
  const techs = (r.techs ?? []).map((id) => TECHS[id]?.name).filter((n): n is string => !!n);
  if (techs.length) parts.push(`${list(techs)} unlocked`);
  if (r.unlock === 'orders') parts.push('Orders unlocked');
  if (r.unlock === 'flow') parts.push('Flow meter unlocked');
  if (r.unlock === 'end') parts.push('Demo complete');
  const pay: string[] = [];
  if (r.credits) pay.push(`+${r.credits}¢`);
  if (r.a) pay.push(`+${r.a}α`);
  if (r.b) pay.push(`+${r.b}β`);
  if (r.g) pay.push(`+${r.g}γ`);
  if (pay.length) parts.push(pay.join(' '));
  // Data on its own means nothing yet to someone who has just met it: say where it goes.
  if (!techs.length && !r.unlock && !r.credits && (r.a || r.b || r.g)) parts.push('spend it in the Tech tree');
  return parts.join(' · ');
}

/** Sparks around the glyph. (The reward flies off a beat later: see `reward` and `payAt` in Spec.) */
function sparks(count: number, power: number, shape: 'hexagon' | 'diamond' | 'star') {
  return (at: Pt, spec: Spec) => {
    burst(at, spec.color, count, { top: true, power, shape });
    burst(at, '#ffffff', Math.round(count / 3), { top: true, power: power * 0.7 });
    // Two rings leave the glyph, one after the other.
    ring(at, spec.color, { top: true, size: 96, life: 0.7 });
    later(300, () => ring(at, spec.color, { top: true, size: 120, life: 0.8 }));
  };
}

function later(ms: number, fn: () => void) {
  const c = current;
  if (!c) return;
  c.timers.push(window.setTimeout(() => {
    if (current === c) fn();
  }, ms));
}

/**
 * A big goal was claimed. (The Lens is usually celebrated before its goal is claimed, by celebrateEnd()
 * at the moment it is made; feel.ts only sends the Lens goal here when that did not happen this session.)
 */
export function celebrateGoal(goalId: string, reward: GoalReward) {
  const line = openedText(reward);
  switch (goalId) {
    case 'sell-shard':
      return start({
        kind: 'shard', title: 'First Shard', line, glyph: matGlyph('shard', 64), color: MATERIALS.shard.color,
        life: 1600, show: sparks(22, 1.5, 'hexagon'), reward, payAt: 640,
      });
    case 'feed-lab':
      return start({
        kind: 'lab', title: 'First Data', line, glyph: nodeIcon('lab', 60), color: DATA_COLORS.a,
        life: 1900, show: sparks(30, 1.7, 'diamond'), reward, payAt: 700,
      });
    case 'make-spark':
      // (This goal also switches Orders on, and no toast says so: the line under the title does.)
      return start({
        kind: 'spark', title: 'First Spark', line, glyph: matGlyph('spark', 64), color: MATERIALS.spark.color,
        life: 1750, show: ignite, reward, payAt: 760,
        // The order chip has just appeared beside the goal card: one ring closes on it as the card goes.
        leaving: reward.unlock === 'orders' ? () => leadTo('order', '#order', MATERIALS.spark.color) : undefined,
      });
    case 'make-prism':
      return start({
        kind: 'prism', title: 'First Prism', line, glyph: matGlyph('prism', 64), color: MATERIALS.prism.color,
        life: 1950, show: refract, reward, payAt: 980,
      });
    case 'make-glyph':
      return start({
        kind: 'glyph', title: 'First Glyph', line, glyph: matGlyph('glyph', 72), color: MATERIALS.glyph.color,
        life: 2200, show: converge, reward, payAt: 1150,
      });
    case 'make-lens':
      // (A Lens made in an earlier session: no summary is on its way, so the card keeps its own time.)
      return lensCard(reduced() ? 4500 : 2600, false);
    default: {
      // A big goal this file has not met: celebrate it at the smallest size, with the goal's own words
      // (the Shard's fanfare and sparks, in gold, under a star).
      const goal = GOALS.find((x) => x.id === goalId);
      return start({
        kind: 'shard', title: goal?.title ?? 'Goal complete', line, glyph: '<span class="cel-star">★</span>', color: '#FFC857',
        life: 1600, show: sparks(22, 1.5, 'star'), reward, payAt: 640,
      });
    }
  }
}

/** First Spark: it crackles twice beside the glyph, and then it strikes. Four-pointed sparks, in the Spark's red. */
function ignite(at: Pt, spec: Spec) {
  [0, 70].forEach((ms, i) => later(ms, () => {
    const a = Math.random() * Math.PI * 2, d = 36 + Math.random() * 20;
    burst({ x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d * 0.8 }, i ? '#ffffff' : spec.color, 5, { top: true, power: 0.7, shape: 'star' });
  }));
  later(150, () => {
    burst(at, spec.color, 24, { top: true, power: 1.8, shape: 'star' });
    burst(at, '#FFD9A0', 8, { top: true, power: 1.2, shape: 'star' });
    ring(at, spec.color, { top: true, size: 110, life: 0.6 });
    ring(at, '#ffffff', { top: true, size: 64, life: 0.4 });
  });
}

/** The colours a Prism splits light into, red to violet, each from a material of that colour. */
const SPECTRUM = ['spark', 'ember', 'glint', 'shard', 'breeze', 'ink', 'murk'] as const;

/**
 * First Prism: a ray of white comes in from the left, and leaves on the right as a fan of seven colours. Diamonds, as Prism is on the wires.
 * (On the flat card of a short screen the words are to the right of the glyph: there the fan opens upward and downward instead, clear of them.)
 */
function refract(at: Pt, spec: Spec) {
  const flat = window.innerHeight < FLAT.below;
  const reach = Math.min(window.innerWidth * 0.42, flat ? 150 : 200);
  // (Seen through the window around the card wherever they end: a ray that ends over the top bar would otherwise start out under the card.)
  const ray = { top: true, topAtStart: true, jitter: 0, bend: 0, shape: 'diamond' as const };
  fly({ x: at.x - reach, y: at.y }, at, '#ffffff', 8, () => {
    SPECTRUM.forEach((m, i) => {
      const u = (i - (SPECTRUM.length - 1) / 2) / ((SPECTRUM.length - 1) / 2);
      const a = flat ? (u <= 0 ? -1 : 1) * (0.7 + 0.8 * Math.abs(u)) : u * 0.65;
      fly(at, { x: at.x + Math.cos(a) * reach, y: at.y + Math.sin(a) * reach }, MATERIALS[m].color, 4, undefined, { ...ray, ttl: 0.5, stagger: 0.045, spread: 0, size: 5 });
    });
    burst(at, '#ffffff', 10, { top: true, power: 1.1, shape: 'diamond' });
    ring(at, spec.color, { top: true, size: 100, life: 0.6 });
  }, { ...ray, ttl: 0.3, stagger: 0.022, spread: 3, size: 4 });
}

// A ring that closes on something in the HUD as a card leaves, to lead the eye there: an outline of
// the thing's own box, a little larger at first. It is an element of its own (above the panels, and
// it never takes input); with less motion asked for it does not move, it only fades in and out.
const leads: HTMLElement[] = [];
const LEAD_MS = 900;

function leadTo(anchor: string, selector: string, color: string) {
  // (The anchor says whether the thing is on screen at all; its box is measured once, here.)
  if (!anchorPt(anchor)) return;
  const r = document.querySelector(selector)?.getBoundingClientRect();
  if (!r || r.width < 8 || r.height < 8) return;
  const a = app.getBoundingClientRect();
  const e = document.createElement('div');
  e.className = `cel-lead${reduced() ? ' calm' : ''}`;
  e.setAttribute('aria-hidden', 'true');
  e.style.cssText = `left:${Math.round(r.left - a.left) - 3}px;top:${Math.round(r.top - a.top) - 3}px;width:${Math.round(r.width) + 6}px;height:${Math.round(r.height) + 6}px;--c:${color}`;
  app.appendChild(e);
  leads.push(e);
  record('celebrate', 'lead', `${anchor} ${Math.round(r.left + r.width / 2)},${Math.round(r.top + r.height / 2)}`);
  window.setTimeout(() => {
    e.remove();
    const i = leads.indexOf(e);
    if (i >= 0) leads.splice(i, 1);
  }, LEAD_MS + 60);
}

/** First Glyph: two streams, Ink from the left and Spark from the right, run into the glyph and set it off. */
function converge(at: Pt, spec: Spec) {
  const reach = Math.min(window.innerWidth * 0.46, 520);
  const left = { x: at.x - reach, y: at.y + 30 }, right = { x: at.x + reach, y: at.y - 30 };
  const opts = { ttl: 0.5, stagger: 0.024, spread: 54, size: 6, top: true };
  fly(left, at, MATERIALS.ink.color, 22, () => {
    burst(at, spec.color, 44, { top: true, power: 2.1, shape: 'star' });
    burst(at, '#ffffff', 14, { top: true, power: 1.4 });
    ring(at, spec.color, { top: true, size: 150, life: 0.7 });
    ring(at, '#ffffff', { top: true, size: 80, life: 0.5 });
  }, { ...opts, shape: 'square' });
  fly(right, at, MATERIALS.spark.color, 22, undefined, { ...opts, shape: 'star' });
}

// ---------- the small card ----------
// The end of a long wait for Data: the tech the goal card was saving for has been researched. Not a
// fanfare (the goal is not done yet, and the next step is waiting on the card): a small card with the
// tech's name and what it opens up, one spray and one ring, a short rising cue, and no reward.
// The first β gets the same card, and a ring then closes on its counter.

/** How the small card for a tech looks: the raw material it reveals, else the machine it unlocks, else the tree. */
function techLook(id: string): { glyph: string; color: string } {
  for (const m of Object.keys(MATERIALS) as MatId[]) {
    if (MATERIALS[m].tier === 0 && MATERIALS[m].tech === id) return { glyph: matGlyph(m, 52), color: MATERIALS[m].color };
  }
  for (const t of Object.keys(NODE_DEFS) as NodeType[]) {
    if (NODE_DEFS[t].tech === id) return { glyph: nodeIcon(t, 50), color: '#9DB8FF' };
  }
  return { glyph: icon('tree', 46), color: DATA_COLORS.a };
}

/** What a tech opens up, in a line: "Murk Wells and Void unlocked", or its first new recipe when that is all it brings. */
export function researchLine(id: string): string {
  const t = TECHS[id];
  if (!t) return '';
  const things = t.unlocks.filter((u) => !u.startsWith('Recipe:')).map((u) => u.replace(/ node$/, ''));
  if (things.length) return `${list(things)} unlocked`;
  const recipe = t.unlocks.find((u) => u.startsWith('Recipe:'));
  return recipe ? `New recipe: ${recipe.slice(7).trim()}` : 'Researched';
}

/** Sparks for the small card: one spray and one ring. */
const note = (at: Pt, spec: Spec) => {
  burst(at, spec.color, 14, { top: true, power: 1.1, shape: 'diamond' });
  burst(at, '#ffffff', 4, { top: true, power: 0.8 });
  ring(at, spec.color, { top: true, size: 84, life: 0.6 });
};

/** The tech the goal card was saving for has just been researched. */
export function celebrateResearch(id: string) {
  const t = TECHS[id];
  if (!t) return;
  const { glyph, color } = techLook(id);
  start({ kind: 'note', kicker: 'Researched', title: t.name, line: researchLine(id), glyph, color, life: 1700, show: note, logAs: 'research:' + id, cue: () => cueResearch('tech') });
}

/** The first β has reached its counter: the same small card, and a ring closes on the counter as it leaves. */
export function celebrateFirstData() {
  const color = DATA_COLORS.b;
  start({
    kind: 'note', kicker: 'New Data', title: 'First β', line: 'Tier 2 Data · spend it in the Tech tree',
    glyph: `<span class="cel-sym">β</span>`, color, life: 1700, show: note, logAs: 'first-beta', cue: () => cueResearch('data'),
    leaving: () => leadTo('data-b', '[data-testid="data-b"]', color),
  });
}

/** The first Flow State: no sparks, only slow rings widening from the middle, like breath on glass. */
export function celebrateFlow() {
  const bonus = Math.round(RULES.flow.bonus * 100);
  start({
    kind: 'flow', title: 'Flow State', line: `Everything is running flat out · sales pay +${bonus}%`,
    glyph: `<svg viewBox="0 0 40 40" width="68" height="68" aria-hidden="true"><circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" stroke-width="3"/><path d="M8 22c4-6 8-6 12 0s8 6 12 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
    color: '#5CE1FF', life: 2200,
    show: (at, spec) => {
      const from = anchorPt('flow') ?? at;
      for (let i = 0; i < 3; i++) later(i * 420, () => ring(at, spec.color, { top: true, size: 240 + i * 60, life: 1.3 }));
      ring(from, '#ffffff', { top: true, size: 44, life: 0.7 });
    },
  });
}

const RAINBOW = ['shard', 'ink', 'spark', 'mist', 'glyph', 'prism'] as const;

/**
 * The Lens card made at the end of the demo stays until the summary screen opens (SUMMARY_DELAY after
 * the Lens is made) and leaves with it. Its own time runs out SUMMARY_GRACE later: the summary opening
 * is what normally sends it, and the timer is for a page where no summary comes (`?nosummary`).
 */
const SUMMARY_GRACE = 400;
/** When the Lens was made (performance.now()), for the time left until the summary. */
let endAt = 0;
const untilSummary = () => Math.max(900, endAt + SUMMARY_DELAY * 1000 + SUMMARY_GRACE - performance.now());

function lensCard(life: number, holds = true) {
  start({
    kind: 'lens', title: 'First Lens', line: 'Demo complete · free play is open', glyph: matGlyph('lens', 80), color: MATERIALS.lens.color,
    life, holds,
    show: (at) => {
      // Three waves, each in the colours of what the factory makes on the way to a Lens.
      for (let wave = 0; wave < 3; wave++) {
        later(wave * 380, () => {
          RAINBOW.forEach((m, i) => {
            const a = (i / RAINBOW.length) * Math.PI * 2 + wave;
            burst({ x: at.x + Math.cos(a) * 60 * wave, y: at.y + Math.sin(a) * 40 * wave }, MATERIALS[m].color, 10, { top: true, power: 2.4 - wave * 0.3, shape: wave === 1 ? 'star' : 'diamond' });
          });
          ring(at, '#ffffff', { top: true, size: 170 + wave * 90, life: 0.9 });
        });
      }
      burst(at, '#ffffff', 24, { top: true, power: 2.6 });
    },
    // Whatever is left of the bow goes with the card. (It has usually faded long before: BOW_HOLD.)
    done: endBow,
  });
}

// ---------- the bow ----------
// On the board layer, in world space (so it stays on the wires if the view moves): every wire that
// leads to the Lens lights from its source to its target, one row of the factory after another,
// and each card gets an outline as the light reaches it.

interface BowWire { pts: Float32Array; from: number; to: number; color: string }
interface BowNode { x: number; y: number; w: number; h: number; at: number; color: string }

let bow: { t0: number; step: number; rows: number; wires: BowWire[]; nodes: BowNode[]; lens: BowNode | null; revealAt: number; revealed: boolean; fadeFrom: number; timers: number[] } | null = null;

const BOW_SEGS = 18;
/** The light may take this long (s) to run from the Wells to the Lens, however deep the factory is. */
const BOW_MAX = 2.6;
/** After the light has reached the Lens the factory stays lit this long (ms), then fades over BOW_FADE. */
const BOW_HOLD = 700;
const BOW_FADE = 500;

function nodeColor(n: GNode): string {
  if (n.type === 'well' && n.material) return MATERIALS[n.material].color;
  const r = isMachine(n) ? recipeOf(n) : null;
  return r ? MATERIALS[r.outputs[0][0]].color : '#9DB8FF';
}

function startBow() {
  endBow();
  const g = ui.g;
  const gr = graph(g);
  const lens = g.nodes.find((n) => n.recipe === RULES.capstone && n.cycles > 0) ?? g.nodes.find((n) => n.recipe === RULES.capstone);
  if (!lens) return lensCard(untilSummary());
  // Everything upstream of the Lens, with its row: the longest way there from a node that nothing feeds.
  const depth = new Map<number, number>();
  const visiting = new Set<number>();
  const rowOf = (id: number): number => {
    const known = depth.get(id);
    if (known != null) return known;
    if (visiting.has(id)) return 0; // a loop: break it here
    visiting.add(id);
    let d = 0;
    for (const w of gr.ins.get(id) ?? []) d = Math.max(d, rowOf(w.from) + 1);
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  const rows = rowOf(lens.id) + 1;
  // A shallow factory takes its time (0.6 s a row); a deep one is squeezed into BOW_MAX.
  const step = Math.min(0.6, BOW_MAX / Math.max(1, rows - 1));
  const wires: BowWire[] = [];
  const nodes: BowNode[] = [];
  let lensBox: BowNode | null = null;
  for (const [id, d] of depth) {
    const n = gr.byId.get(id);
    if (!n) continue;
    const { w, h } = nodeSize(n);
    const box = { x: n.x, y: n.y, w, h, at: d * step, color: nodeColor(n) };
    // The Lens card itself stays dark until the light has arrived (see revealLens).
    if (id === lens.id) lensBox = { ...box, at: Infinity };
    else nodes.push(box);
    for (const wire of gr.ins.get(id) ?? []) {
      const ends = wireEnds(g, wire);
      if (!ends || !depth.has(wire.from)) continue;
      const pts = new Float32Array((BOW_SEGS + 1) * 2);
      for (let i = 0; i <= BOW_SEGS; i++) {
        const p = bezierAt(ends.a, ends.b, i / BOW_SEGS);
        pts[i * 2] = p.x;
        pts[i * 2 + 1] = p.y;
      }
      wires.push({ pts, from: depth.get(wire.from)! * step, to: d * step, color: ends.mat ? MATERIALS[ends.mat].color : '#9DB8FF' });
    }
  }
  // Bring the line into view if part of it is off screen. On a phone, Fit: its overview (every card an
  // icon) is how a phone shows the whole factory, and the Lens moment uses it. Elsewhere, as little camera
  // movement as it takes, among the cards (the board's frameNodes, the Wells first and the Lens last, so
  // that the Lens is the one shown when they cannot all be): Fit drops a large factory into the overview
  // there too, and turning every card into an icon at once was the longest frame of the whole moment.
  const r = boardRect();
  const off = [...nodes, ...(lensBox ? [lensBox] : [])].some((b) => {
    const p = toClient({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    return p.x < r.left + 20 || p.x > r.right - 20 || p.y < r.top + 20 || p.y > r.bottom - 20;
  });
  if (off && env.phone) fitView();
  else if (off) frameNodes([...depth.keys()].sort((a, b) => depth.get(a)! - depth.get(b)!));
  const t0 = performance.now();
  const timers: number[] = [];
  bow = { t0, step, rows, wires, nodes, lens: lensBox, revealAt: (rows - 1) * step + 0.3, revealed: false, fadeFrom: Infinity, timers };
  record('celebrate', 'capstone', rows);
  cueWhoosh();
  for (let i = 0; i < rows - 1; i++) timers.push(window.setTimeout(() => cueBowNote(i, rows), i * step * 1000));
  timers.push(window.setTimeout(revealLens, bow.revealAt * 1000));
}

/** The light has reached the Lens (or the player pressed to skip ahead): flash its card and bring up the centre card. */
function revealLens() {
  const b = bow;
  if (!b || b.revealed) return;
  b.revealed = true;
  for (const t of b.timers) clearTimeout(t);
  b.timers.length = 0;
  // Whatever had not lit yet lights now.
  const now = (performance.now() - b.t0) / 1000;
  for (const n of b.nodes) n.at = Math.min(n.at, now);
  for (const w of b.wires) {
    w.to = Math.min(w.to, now);
    w.from = Math.min(w.from, w.to);
  }
  if (b.lens) {
    b.lens.at = now;
    const at = toClient({ x: b.lens.x + b.lens.w / 2, y: b.lens.y + b.lens.h / 2 });
    burst(at, '#ffffff', 26, { power: 1.8 });
    ring(at, '#ffffff', { size: 120, life: 0.7 });
    ring(at, MATERIALS.lens.color, { size: 70, life: 0.5 });
  }
  // The card arrives a moment after the flash and stays until the summary screen opens.
  b.timers.push(window.setTimeout(() => lensCard(untilSummary()), 350));
  // The lit wires and outlines have done their work once the card is up: they fade soon after, so
  // that for most of the card's stay nothing extra is being drawn on the board.
  b.timers.push(window.setTimeout(() => bow === b && endBow(), BOW_HOLD));
}

function endBow() {
  const b = bow;
  if (!b) return;
  // Fade the lit wires and outlines out rather than cutting them off. (A second call ends it at once.)
  if (b.fadeFrom === Infinity && b.revealed) {
    b.fadeFrom = performance.now();
    b.timers.push(window.setTimeout(() => {
      if (bow === b) bow = null;
    }, BOW_FADE));
    return;
  }
  for (const t of b.timers) clearTimeout(t);
  bow = null;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

const bowOverlay: Overlay = {
  active: () => !!bow,
  draw(c) {
    const b = bow;
    if (!b) return;
    const now = performance.now();
    const t = (now - b.t0) / 1000;
    const fade = b.fadeFrom === Infinity ? 1 : Math.max(0, 1 - (now - b.fadeFrom) / BOW_FADE);
    const k = ui.view.k;
    const o = toClient({ x: 0, y: 0 });
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const w of b.wires) {
      if (t <= w.from) continue;
      const span = Math.max(0.05, w.to - w.from);
      const p = Math.min(1, (t - w.from) / span);
      const upto = p * BOW_SEGS;
      const whole = Math.floor(upto);
      const frac = upto - whole;
      c.beginPath();
      c.moveTo(w.pts[0] * k + o.x, w.pts[1] * k + o.y);
      for (let i = 1; i <= whole; i++) c.lineTo(w.pts[i * 2] * k + o.x, w.pts[i * 2 + 1] * k + o.y);
      let hx = w.pts[whole * 2], hy = w.pts[whole * 2 + 1];
      if (whole < BOW_SEGS) {
        hx += (w.pts[whole * 2 + 2] - hx) * frac;
        hy += (w.pts[whole * 2 + 3] - hy) * frac;
        c.lineTo(hx * k + o.x, hy * k + o.y);
      }
      // Bright while the light is travelling, then it settles to a glow.
      const settle = p < 1 ? 1 : Math.max(0.45, 1 - (t - w.to) * 1.2);
      c.globalAlpha = 0.85 * settle * fade;
      c.strokeStyle = w.color;
      c.lineWidth = Math.max(2, 4 * k);
      c.stroke();
      if (p < 1) {
        c.globalAlpha = fade;
        c.fillStyle = '#fff';
        c.beginPath();
        c.arc(hx * k + o.x, hy * k + o.y, Math.max(2.5, 5 * k), 0, Math.PI * 2);
        c.fill();
      }
    }
    const outline = (n: BowNode, strong: boolean) => {
      if (t < n.at) return;
      const age = t - n.at;
      const flash = Math.max(0, 1 - age / 0.35);
      const pad = (3 + 5 * flash) * k;
      roundRect(c, n.x * k + o.x - pad, n.y * k + o.y - pad, n.w * k + pad * 2, n.h * k + pad * 2, 14 * k + pad);
      c.globalAlpha = (0.55 + 0.45 * flash) * fade;
      c.strokeStyle = flash > 0.5 ? '#fff' : n.color;
      c.lineWidth = Math.max(1.5, (strong ? 3.5 : 2.5) * k) * (1 + flash);
      c.stroke();
      if (strong) {
        c.globalAlpha = 0.18 * fade;
        c.lineWidth = Math.max(4, 12 * k);
        c.stroke();
      }
    };
    for (const n of b.nodes) outline(n, false);
    if (b.lens) outline(b.lens, true);
    c.globalAlpha = 1;
  },
};

/**
 * The first Lens has just been made and the demo is complete: the factory takes its bow, then the
 * Lens card, which stays until the summary screen opens 6.5 s after this (SUMMARY_DELAY) and leaves
 * as it fades in. Call in the frame the 'demo-end' event arrives: the summary counts from the same one.
 */
export function celebrateEnd() {
  endAt = performance.now();
  if (reduced()) return lensCard(untilSummary());
  startBow();
}

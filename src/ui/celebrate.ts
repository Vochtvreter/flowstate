// The big moments: first Shard, the Lab, first Glyph, the first Flow State and the first Lens.
// Each gets a colour wash, a card in the middle of the screen, particles and a fanfare, and each is
// bigger than the one before. The Lens is also the end of the demo: the moment it is made the factory
// takes a bow (a pulse runs along the wires from the Wells to the Lens, lighting each card it passes)
// and then its card comes up.
//
// Nothing here ever takes input: every layer ignores the pointer, so a press during a celebration
// lands on the game underneath, and it also sends the celebration on its way (the reward flies at
// once and the card leaves). Everything added to the page is taken out again when it ends. The four
// that follow a claim are over in about 2.5 s; the Lens, bow and all, in about 6.3 s, because the
// summary screen opens 6.5 s after the Lens is made.
import { DATA_COLORS, MATERIALS, RULES, TECHS } from '../content';
import { recipeOf } from '../economy';
import { GOALS } from '../goals';
import { graph, isMachine } from '../sim';
import { GNode, GoalReward } from '../state';
import { boardRect, fitView, toClient } from './board';
import { anchorPt } from './dom';
import { Overlay, addOverlay, burst, fly, ring } from './fx';
import { Pt, bezierAt, nodeSize, wireEnds } from './geom';
import { esc, matGlyph, nodeIcon } from './icons';
import { Fanfare, buzz, cueBowNote, cueFanfare, cueWhoosh } from './audio';
import { ui } from './ui';

export type BigKind = Fanfare;

interface Spec {
  kind: BigKind;
  title: string;
  line: string;
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
  /** Runs when the card starts to leave (by itself, or sent away by a press). */
  leaving?: () => void;
  /** Runs when it ends, however it ends. */
  done?: () => void;
}

/**
 * A card is never sent away sooner than this after it came up, in ms: the second press of a double
 * press on Claim would otherwise take it down before it had been seen. (That press still reaches
 * the game, and the card leaves as soon as this is up.)
 */
const MIN_SHOWN_MS = 400;
/** How far the middle of the glyph is above the middle of the card, in px, for each size of card. */
const GLYPH_RISE: Record<BigKind, number> = { shard: 36, lab: 37, glyph: 41, flow: 36, lens: 47 };
const OUT_MS = 320;

let app: HTMLElement;
let record: (kind: 'celebrate', name: string, detail?: string | number) => void = () => {};
let payout: (from: Pt, r: GoalReward) => void = () => {};
const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!reducedQuery?.matches;

interface Card { spec: Spec; wash: HTMLElement | null; wrap: HTMLElement; timers: number[]; leaving: boolean; shownAt: number; at: Pt; paid: boolean }
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
    if (!c || c.leaving) return;
    const wait = MIN_SHOWN_MS - (performance.now() - c.shownAt);
    if (wait <= 0) leave();
    else c.timers.push(window.setTimeout(() => current === c && leave(), wait));
  };
  window.addEventListener('pointerdown', dismiss, { capture: true, passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') dismiss();
  }, true);
  // The summary screen (and the start screen) are never shared with a celebration: whatever is still
  // up when one of them opens is taken down on the spot. The Lens is timed to be gone by then; this
  // is for a page that was held up (a background tab, a long frame).
  if (typeof MutationObserver !== 'undefined') {
    const watch = new MutationObserver(() => {
      const summary = document.getElementById('summary');
      if (summary && !summary.hasAttribute('hidden') && celebrating()) {
        record('celebrate', 'cut', 'summary');
        cancelCelebrations();
      }
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
}

// ---------- the card ----------

function start(spec: Spec) {
  if (current) {
    if (queue.length < 2) queue.push(spec);
    return;
  }
  const calm = reduced();
  record('celebrate', 'big:' + spec.kind, spec.title);
  let wash: HTMLElement | null = null;
  if (!calm) {
    wash = document.createElement('div');
    wash.className = `cel-wash k-${spec.kind}`;
    wash.style.setProperty('--c', spec.color);
    wash.style.setProperty('--life', spec.life + OUT_MS + 'ms');
    app.appendChild(wash);
  }
  const wrap = document.createElement('div');
  wrap.className = `cel k-${spec.kind}${calm ? ' calm' : ''}`;
  wrap.setAttribute('data-testid', 'celebration');
  wrap.style.setProperty('--c', spec.color);
  wrap.innerHTML = `<div class="cel-card" role="status"><div class="cel-glyph">${spec.glyph}</div><div class="cel-words"><div class="cel-title">${esc(spec.title)}</div><div class="cel-line">${esc(spec.line)}</div></div></div>`;
  app.appendChild(wrap);
  const timers: number[] = [];
  // The glyph sits a little above the middle of the card, which is in the middle of the window; on a
  // screen too short for that the card lies flat and the glyph is at its left end (feel.css).
  // (Worked out rather than measured: measuring here would make the browser lay the page out on the spot.)
  const flat = window.innerHeight < FLAT.below;
  const at = flat
    ? { x: window.innerWidth / 2 - Math.min(FLAT.width, window.innerWidth - 32) / 2 + FLAT.glyphX, y: window.innerHeight / 2 + FLAT.down }
    : { x: window.innerWidth / 2, y: window.innerHeight / 2 - GLYPH_RISE[spec.kind] };
  const c: Card = (current = { spec, wash, wrap, timers, leaving: false, shownAt: performance.now(), at, paid: false });
  timers.push(window.setTimeout(leave, spec.life));
  if (spec.reward) timers.push(window.setTimeout(() => pay(c), spec.payAt ?? 700));
  cueFanfare(spec.kind);
  buzz('big', spec.kind === 'lens' ? [30, 60, 30, 60, 60] : spec.kind === 'glyph' ? [20, 50, 30] : [20, 40, 20]);
  if (!calm && spec.show) spec.show(at, spec);
}

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
  c.wrap.remove();
  c.wash?.remove();
  current = null;
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
    case 'make-glyph':
      return start({
        kind: 'glyph', title: 'First Glyph', line, glyph: matGlyph('glyph', 72), color: MATERIALS.glyph.color,
        life: 2200, show: converge, reward, payAt: 1150,
      });
    case 'make-lens':
      return lensCard(reduced() ? 4500 : 2600);
    default: {
      // A big goal this file has not met: celebrate it at the smallest size, with the goal's own words.
      const goal = GOALS.find((x) => x.id === goalId);
      return start({
        kind: 'shard', title: goal?.title ?? 'Goal complete', line, glyph: '<span class="cel-star">★</span>', color: '#FFC857',
        life: 1600, show: sparks(22, 1.5, 'star'), reward, payAt: 640,
      });
    }
  }
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

function lensCard(life: number) {
  start({
    kind: 'lens', title: 'First Lens', line: 'Demo complete · free play is open', glyph: matGlyph('lens', 80), color: MATERIALS.lens.color,
    life,
    show: (at) => {
      // Three waves, each in the colours of what the factory makes on the way to a Lens.
      for (let wave = 0; wave < 3; wave++) {
        later(wave * 380, () => {
          RAINBOW.forEach((m, i) => {
            const a = (i / RAINBOW.length) * Math.PI * 2 + wave;
            burst({ x: at.x + Math.cos(a) * 60 * wave, y: at.y + Math.sin(a) * 40 * wave }, MATERIALS[m].color, 14, { top: true, power: 2.4 - wave * 0.3, shape: wave === 1 ? 'star' : 'diamond' });
          });
          ring(at, '#ffffff', { top: true, size: 170 + wave * 90, life: 0.9 });
        });
      }
      burst(at, '#ffffff', 30, { top: true, power: 2.6 });
    },
    // The lit wires and outlines of the bow fade with the card, and are gone when it is.
    leaving: endBow,
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
/**
 * The Lens card starts to leave this long (ms) after the Lens was made, whatever happened before:
 * 5.9 s, plus its exit, is 6.2 s, and the summary screen opens at 6.5 (SUMMARY_DELAY in hud-screens.ts).
 */
const END_BY = 5900;
/** The bow's light fades out over this long (ms): the same as the card's exit, so both are gone together. */
const BOW_FADE = OUT_MS;

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
  if (!lens) return lensCard(2600);
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
  // Bring the whole line into view if part of it is off screen.
  const r = boardRect();
  const off = [...nodes, ...(lensBox ? [lensBox] : [])].some((b) => {
    const p = toClient({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    return p.x < r.left + 20 || p.x > r.right - 20 || p.y < r.top + 20 || p.y > r.bottom - 20;
  });
  if (off) fitView();
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
  // The card arrives a moment after the flash and stays until just before the summary screen.
  b.timers.push(window.setTimeout(() => lensCard(Math.max(900, END_BY - (performance.now() - b.t0))), 350));
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
 * Lens card. All of it is over within 6.3 seconds, because the summary screen opens at 6.5.
 */
export function celebrateEnd() {
  if (reduced()) return lensCard(4500);
  startBow();
}

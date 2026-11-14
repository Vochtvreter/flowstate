// The big moments: first Shard, the Lab, first Glyph, the first Flow State and the first Lens.
// Each gets a colour wash, a card in the middle of the screen, particles and a fanfare, and each is
// bigger than the one before. The Lens is also the end of the demo: the moment it is made the factory
// takes a bow (a pulse runs along the wires from the Wells to the Lens, lighting each card it passes)
// and then its card comes up.
//
// Nothing here stops play for more than 0.4 s: the card ignores the pointer after that, and a press
// anywhere sends it away. Everything added to the page is taken out again when it ends.
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
  /** The celebration answers a press (Claim): it swallows presses for the first 0.4 s so a double tap cannot land on something else. */
  block: boolean;
  /** Runs once the card is on screen, with the centre of its glyph. Particles go here. */
  show?: (at: Pt, spec: Spec) => void;
  /** Runs when it ends, however it ends. */
  done?: () => void;
}

const BLOCK_MS = 400;
/** How far the middle of the glyph is above the middle of the card, in px, for each size of card. */
const GLYPH_RISE: Record<BigKind, number> = { shard: 36, lab: 37, glyph: 41, flow: 36, lens: 47 };
const OUT_MS = 320;

let app: HTMLElement;
let record: (kind: 'celebrate', name: string, detail?: string | number) => void = () => {};
let payout: (from: Pt, r: GoalReward) => void = () => {};
const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!reducedQuery?.matches;

let current: { spec: Spec; wash: HTMLElement | null; wrap: HTMLElement; timers: number[]; leaving: boolean; shownAt: number } | null = null;
const queue: Spec[] = [];

export function initCelebrate(hooks: { record: typeof record; payout: typeof payout }) {
  app = document.getElementById('app') ?? document.body;
  record = hooks.record;
  payout = hooks.payout;
  addOverlay(bowOverlay);
  // A press or a key anywhere sends the card away (once it has stopped swallowing presses).
  const dismiss = () => {
    if (bow && !bow.revealed) return void revealLens();
    if (current && !current.leaving && performance.now() - current.shownAt >= BLOCK_MS) leave();
  };
  window.addEventListener('pointerdown', dismiss, { capture: true, passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') dismiss();
  }, true);
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
  wrap.className = `cel k-${spec.kind}${spec.block ? ' block' : ''}${calm ? ' calm' : ''}`;
  wrap.setAttribute('data-testid', 'celebration');
  wrap.style.setProperty('--c', spec.color);
  wrap.innerHTML = `<div class="cel-card" role="status"><div class="cel-glyph">${spec.glyph}</div><div class="cel-title">${esc(spec.title)}</div><div class="cel-line">${esc(spec.line)}</div></div>`;
  app.appendChild(wrap);
  const timers: number[] = [];
  current = { spec, wash, wrap, timers, leaving: false, shownAt: performance.now() };
  if (spec.block) timers.push(window.setTimeout(() => wrap.classList.remove('block'), BLOCK_MS));
  timers.push(window.setTimeout(leave, spec.life));
  cueFanfare(spec.kind);
  buzz('big', spec.kind === 'lens' ? [30, 60, 30, 60, 60] : spec.kind === 'glyph' ? [20, 50, 30] : [20, 40, 20]);
  // The glyph sits a little above the middle of the card, which is in the middle of the window.
  // (Worked out rather than measured: measuring here would make the browser lay the page out on the spot.)
  if (!calm && spec.show) spec.show({ x: window.innerWidth / 2, y: window.innerHeight / 2 - GLYPH_RISE[spec.kind] }, spec);
}

/** Start the card's exit; it is taken out of the page when the exit has played. */
function leave() {
  const c = current;
  if (!c || c.leaving) return;
  c.leaving = true;
  c.wrap.classList.remove('block');
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

/** Sparks around the glyph, then (a beat later) the reward flying off to where it lives. */
function sparksThenPay(count: number, power: number, shape: 'hexagon' | 'diamond' | 'star', r: GoalReward) {
  return (at: Pt, spec: Spec) => {
    burst(at, spec.color, count, { top: true, power, shape });
    burst(at, '#ffffff', Math.round(count / 3), { top: true, power: power * 0.7 });
    // Two rings leave the glyph, one after the other.
    ring(at, spec.color, { top: true, size: 96, life: 0.7 });
    later(300, () => ring(at, spec.color, { top: true, size: 120, life: 0.8 }));
    later(Math.min(700, spec.life * 0.4), () => payout(at, r));
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
        life: 1600, block: true, show: sparksThenPay(22, 1.5, 'hexagon', reward),
      });
    case 'feed-lab':
      return start({
        kind: 'lab', title: 'First Data', line, glyph: nodeIcon('lab', 60), color: DATA_COLORS.a,
        life: 2000, block: true, show: sparksThenPay(30, 1.7, 'diamond', reward),
      });
    case 'make-glyph':
      return start({
        kind: 'glyph', title: 'First Glyph', line, glyph: matGlyph('glyph', 72), color: MATERIALS.glyph.color,
        life: 2800, block: true, show: (at, spec) => converge(at, spec, reward),
      });
    case 'make-lens':
      return lensCard(reduced() ? 4500 : 3000);
    default: {
      // A big goal this file has not met: celebrate it at the smallest size, with the goal's own words.
      const goal = GOALS.find((x) => x.id === goalId);
      return start({
        kind: 'shard', title: goal?.title ?? 'Goal complete', line, glyph: '<span class="cel-star">★</span>', color: '#FFC857',
        life: 1600, block: true, show: sparksThenPay(22, 1.5, 'star', reward),
      });
    }
  }
}

/** First Glyph: two streams, Ink from the left and Spark from the right, run into the glyph and set it off. */
function converge(at: Pt, spec: Spec, reward: GoalReward) {
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
  later(1300, () => payout(at, reward));
}

/** The first Flow State: no sparks, only slow rings widening from the middle, like breath on glass. */
export function celebrateFlow() {
  const bonus = Math.round(RULES.flow.bonus * 100);
  start({
    kind: 'flow', title: 'Flow State', line: `Everything is running flat out · sales pay +${bonus}%`,
    glyph: `<svg viewBox="0 0 40 40" width="68" height="68" aria-hidden="true"><circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" stroke-width="3"/><path d="M8 22c4-6 8-6 12 0s8 6 12 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
    color: '#5CE1FF', life: 3000, block: false,
    show: (at, spec) => {
      const from = anchorPt('flow') ?? at;
      for (let i = 0; i < 3; i++) later(i * 520, () => ring(at, spec.color, { top: true, size: 240 + i * 60, life: 1.5 }));
      ring(from, '#ffffff', { top: true, size: 44, life: 0.7 });
    },
  });
}

const RAINBOW = ['shard', 'ink', 'spark', 'mist', 'glyph', 'prism'] as const;

function lensCard(life: number) {
  start({
    kind: 'lens', title: 'First Lens', line: 'Demo complete · free play is open', glyph: matGlyph('lens', 80), color: MATERIALS.lens.color,
    life, block: false,
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
/** The bow may take this long before the Lens card, however deep the factory is. */
const BOW_MAX = 2.9;

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
  if (!lens) return lensCard(3000);
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
  const step = Math.max(0.22, Math.min(0.6, BOW_MAX / rows));
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
  // The card arrives a moment after the flash and stays until just before the summary screen (6.5 s after the event).
  const elapsed = performance.now() - b.t0;
  b.timers.push(window.setTimeout(() => lensCard(Math.max(1800, 6000 - elapsed - 350)), 350));
}

function endBow() {
  const b = bow;
  if (!b) return;
  // Fade the lit wires and outlines out rather than cutting them off.
  if (b.fadeFrom === Infinity && b.revealed) {
    b.fadeFrom = performance.now();
    b.timers.push(window.setTimeout(() => {
      if (bow === b) bow = null;
    }, 600));
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
    const fade = b.fadeFrom === Infinity ? 1 : Math.max(0, 1 - (now - b.fadeFrom) / 600);
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
 * Lens card. All of it is over within six seconds, because the summary screen opens at 6.5.
 */
export function celebrateEnd() {
  if (reduced()) return lensCard(4500);
  startBow();
}

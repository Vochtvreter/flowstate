// The guiding hand: a small pointer, drawn over the board, that acts out the gesture the current
// goal needs. It shows two things and no more: wiring (press the Well's port, drag to the Market,
// let go) and building from a port (drag from the port to an empty spot). With a finger it shows
// two taps instead of a drag.
//
// It only appears when the player has done nothing for a few seconds, vanishes the moment they
// press anything, stays away while anything is open over the board, and never comes back for a
// gesture the player has done once.
//
// It is drawn on the effects canvas (board layer, under the HUD) and never takes input.
import { goalView } from '../goals';
import { graph } from '../sim';
import { Game } from '../state';
import { boardRect, radialOpen, toClient } from './board';
import { Overlay, addOverlay } from './fx';
import { Pt, bezierAt, inPorts, matColor, nodeSize, outPorts } from './geom';
import { onBeat, onNewGame, ui } from './ui';

/** Without input for this long (ms) before the hand shows. */
const IDLE_MS = 5000;
/** Height of the hand on screen, in px. */
const HAND_PX = 38;

type Kind = 'wire' | 'build';
interface Plan {
  kind: Kind;
  /** The port the gesture starts on, and where the fingertip ends up (world space). */
  from: Pt;
  to: Pt;
  /** Where the wire would attach: the target's input port (wire), or the same as `to` (build). */
  end: Pt;
  /** The card to light up as a target (wire only). */
  card: { x: number; y: number; w: number; h: number } | null;
  color: string;
}

let record: (kind: 'hand', name: string, detail?: string | number) => void = () => {};
let isBusy: () => boolean = () => false;
let app: HTMLElement | null = null;
let plan: Plan | null = null;
let visible = false;
let clock = 0;
let lastInput = 0;
let pointersDown = 0;
/** The build menu has been opened from a port during this game: that gesture is learnt. */
let builtOnce = false;
const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

const usesTouch = () => document.documentElement.dataset.input === 'touch';

// ---------- when ----------

const wireDone = (g: Game) => g.goal.i > 0 || g.goal.ready || g.wires.length > 0 || g.stats.wiresMade > 0;
const buildDone = (g: Game) => builtOnce || g.goal.i > 3 || g.nodes.some((n) => n.type === 'refiner');

/** Something is open over the board, or the player is in the middle of something. */
function blocked(): boolean {
  if (pointersDown > 0 || document.hidden || ui.g.paused) return true;
  if (ui.techOpen || ui.menuOpen || ui.placing || radialOpen() || isBusy()) return true;
  if (!app) return false;
  // The start screen (made by the HUD) is up until #app is marked as started.
  if (!app.classList.contains('started') && document.getElementById('start')) return true;
  // On a phone the inspector is a sheet over the board.
  if (ui.sel && app.classList.contains('phone')) return true;
  return !!app.querySelector('#modal.open, #summary:not([hidden]), .sheet.open, [data-sheet-open]');
}

function wirePlan(g: Game): Plan | null {
  const outs = graph(g).outs;
  const wells = g.nodes.filter((n) => n.type === 'well');
  const well = wells.find((n) => !(outs.get(n.id)?.[0]?.length)) ?? wells[0];
  const market = g.nodes.find((n) => n.type === 'market');
  if (!well || !market) return null;
  const port = outPorts(g, well)[0];
  const inPort = inPorts(market)[0];
  if (!port || !inPort) return null;
  const { w, h } = nodeSize(market);
  return {
    kind: 'wire', from: { x: port.x, y: port.y }, to: { x: market.x + 34, y: market.y + h / 2 + 6 }, end: { x: inPort.x, y: inPort.y },
    card: { x: market.x, y: market.y, w, h }, color: matColor(port.mat),
  };
}

/** Offsets from the port (world px) to try for "an empty spot", nearest and most natural first. */
const SPOTS: [number, number][] = [[210, 40], [210, 130], [210, -80], [280, 0], [160, 180], [160, -140], [340, 90]];

function buildPlan(g: Game): Plan | null {
  const well = g.nodes.find((n) => n.type === 'well');
  const port = well && outPorts(g, well)[0];
  if (!well || !port) return null;
  const used = new Set(g.nodes.map((n) => n.depositId));
  const boxes = g.nodes.map((n) => ({ x: n.x, y: n.y, ...nodeSize(n) }));
  for (const d of g.deposits) if (!used.has(d.id)) boxes.push({ x: d.x, y: d.y, w: 172, h: 72 });
  const r = boardRect();
  for (const [dx, dy] of SPOTS) {
    const p = { x: port.x + dx, y: port.y + dy };
    // Room for the card that would be built here, with some air around it.
    const x0 = p.x - 30, y0 = p.y - 56, x1 = p.x + 190, y1 = p.y + 56;
    if (x0 < 10 || y0 < 10 || x1 > g.board.w - 10 || y1 > g.board.h - 10) continue;
    if (boxes.some((b) => x0 < b.x + b.w && x1 > b.x && y0 < b.y + b.h && y1 > b.y)) continue;
    const c = toClient(p);
    if (c.x < r.left + 40 || c.x > r.right - 60 || c.y < r.top + 40 || c.y > r.bottom - 60) continue;
    return { kind: 'build', from: { x: port.x, y: port.y }, to: p, end: p, card: null, color: matColor(port.mat) };
  }
  return null;
}

/** The gesture the active goal needs, if it is one the hand teaches and the player has not done it yet. */
function wanted(g: Game): Plan | null {
  const view = goalView(g);
  if (!view || view.ready) return null;
  if (view.goal.id === 'wire-market' && !wireDone(g)) return wirePlan(g);
  if (view.goal.id === 'build-refiner') {
    if (radialOpen()) builtOnce = true;
    if (!buildDone(g)) return buildPlan(g);
  }
  return null;
}

function onScreen(p: Plan): boolean {
  const r = boardRect();
  for (const w of [p.from, p.to]) {
    const c = toClient(w);
    if (c.x < r.left + 8 || c.x > r.right - 8 || c.y < r.top + 8 || c.y > r.bottom - 8) return false;
  }
  return true;
}

function hide(why: string) {
  if (!visible) return;
  visible = false;
  record('hand', 'hide', why);
}

function evaluate() {
  const want = wanted(ui.g);
  const show = !!want && performance.now() - lastInput >= IDLE_MS && !blocked() && onScreen(want);
  if (!show) return hide(want ? 'busy' : 'done');
  plan = want;
  if (visible) return;
  visible = true;
  clock = 0;
  record('hand', 'show', want!.kind);
}

function input() {
  lastInput = performance.now();
  hide('input');
}

export function initHand(hooks: { record: typeof record; busy: () => boolean }) {
  record = hooks.record;
  isBusy = hooks.busy;
  app = document.getElementById('app');
  lastInput = performance.now();
  const opts = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', () => {
    pointersDown++;
    input();
  }, opts);
  const up = () => {
    pointersDown = Math.max(0, pointersDown - 1);
    lastInput = performance.now();
  };
  window.addEventListener('pointerup', up, opts);
  window.addEventListener('pointercancel', up, opts);
  window.addEventListener('blur', () => (pointersDown = 0));
  window.addEventListener('keydown', input, opts);
  window.addEventListener('wheel', input, opts);
  window.addEventListener('touchstart', input, opts);
  addOverlay(overlay);
  onBeat(evaluate);
  onNewGame(() => {
    builtOnce = false;
    lastInput = performance.now();
    hide('new game');
  });
}

/** For tests. */
export const handState = () => ({ visible, kind: visible ? plan?.kind ?? null : null, idleMs: Math.round(performance.now() - lastInput), touch: usesTouch() });

// ---------- drawing ----------

// A pointing hand in a 24-unit box; the fingertip is at TIP.
const HAND_D = 'M8.6 12.2V4.3a1.9 1.9 0 0 1 3.8 0V10l5 .9a2.3 2.3 0 0 1 1.9 2.6l-.75 5.1a3.1 3.1 0 0 1-3.07 2.65H10.9a3.1 3.1 0 0 1-2.5-1.27L4.3 14.4a1.65 1.65 0 0 1 2.45-2.2L8.6 13.9z';
const TIP = { x: 10.5, y: 2.6 };
let handPath: Path2D | null = null;

const seg = (u: number, a: number, b: number) => Math.max(0, Math.min(1, (u - a) / (b - a)));
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - ((2 - 2 * u) * (2 - 2 * u)) / 2);
const mix = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function drawHand(c: CanvasRenderingContext2D, at: Pt, alpha: number, press: number, lift = 0) {
  if (alpha <= 0) return;
  handPath ??= new Path2D(HAND_D);
  const s = (HAND_PX / 20) * (1 - 0.12 * press + 0.06 * lift);
  c.save();
  c.translate(at.x, at.y - lift * 7);
  c.rotate(-0.28);
  c.scale(s, s);
  c.translate(-TIP.x, -TIP.y);
  c.globalAlpha = alpha;
  c.lineJoin = 'round';
  c.lineWidth = 2.6;
  c.strokeStyle = 'rgba(11, 15, 23, 0.9)';
  c.stroke(handPath);
  c.fillStyle = '#fff';
  c.fill(handPath);
  c.restore();
}

function drawRing(c: CanvasRenderingContext2D, at: Pt, u: number, color: string, alpha: number) {
  if (u <= 0 || u >= 1 || alpha <= 0) return;
  c.globalAlpha = (1 - u) * 0.9 * alpha;
  c.strokeStyle = color;
  c.lineWidth = 3 * (1 - u) + 1;
  c.beginPath();
  c.arc(at.x, at.y, 7 + 22 * (1 - (1 - u) * (1 - u)), 0, Math.PI * 2);
  c.stroke();
}

/** The wire the gesture would make, from the port to `end` (world), as far as `upto` of the way. */
function drawWire(c: CanvasRenderingContext2D, from: Pt, end: Pt, color: string, alpha: number, dashed: boolean) {
  if (alpha <= 0) return;
  const k = ui.view.k;
  c.beginPath();
  for (let i = 0; i <= 20; i++) {
    const p = toClient(bezierAt(from, end, i / 20));
    if (i) c.lineTo(p.x, p.y);
    else c.moveTo(p.x, p.y);
  }
  c.globalAlpha = alpha;
  c.strokeStyle = color;
  c.lineWidth = Math.max(2, 3.5 * k);
  c.lineCap = 'round';
  c.setLineDash(dashed ? [2 * k + 1, 8 * k + 2] : []);
  c.stroke();
  c.setLineDash([]);
}

function drawCard(c: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, alpha: number, dashed: boolean, color: string) {
  if (alpha <= 0) return;
  const k = ui.view.k;
  const o = toClient({ x: box.x, y: box.y });
  const pad = 4 * k, r = 14 * k + pad;
  const x = o.x - pad, y = o.y - pad, w = box.w * k + pad * 2, h = box.h * k + pad * 2;
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
  c.globalAlpha = alpha;
  c.strokeStyle = color;
  c.lineWidth = 2;
  c.setLineDash(dashed ? [6, 5] : []);
  c.stroke();
  c.setLineDash([]);
  if (!dashed) {
    c.globalAlpha = alpha * 0.2;
    c.lineWidth = 9;
    c.stroke();
  }
}

/** The card that building here would make: a dashed outline with a plus in it. */
function drawGhostCard(c: CanvasRenderingContext2D, at: Pt, alpha: number) {
  if (alpha <= 0) return;
  const k = ui.view.k;
  drawCard(c, { x: at.x, y: at.y - 36, w: 172, h: 72 }, alpha, true, '#9DB8FF');
  const m = toClient({ x: at.x + 86, y: at.y });
  c.globalAlpha = alpha;
  c.strokeStyle = '#9DB8FF';
  c.lineWidth = Math.max(2, 3 * k);
  c.lineCap = 'round';
  c.beginPath();
  const a = 9 * k;
  c.moveTo(m.x - a, m.y);
  c.lineTo(m.x + a, m.y);
  c.moveTo(m.x, m.y - a);
  c.lineTo(m.x, m.y + a);
  c.stroke();
}

const overlay: Overlay = {
  active: () => visible && !!plan,
  draw(c, dt) {
    const p = plan;
    if (!p) return;
    const a = toClient(p.from), b = toClient(p.to);
    if (reducedQuery?.matches) {
      // No motion: the whole gesture as one still picture.
      drawWire(c, p.from, p.end, p.color, 0.75, true);
      if (p.card) drawCard(c, p.card, 0.8, false, '#fff');
      else drawGhostCard(c, p.to, 0.8);
      drawHand(c, b, 0.95, 0);
      c.globalAlpha = 1;
      return;
    }
    clock += dt;
    if (usesTouch()) {
      // Tap the port, then tap the target.
      const u = clock % 3.1;
      const fade = seg(u, 0, 0.3) * (1 - seg(u, 2.3, 2.65));
      const tap1 = seg(u, 0.4, 0.68), tap2 = seg(u, 1.55, 1.83);
      const go = ease(seg(u, 0.72, 1.5));
      const pos = mix(a, b, go);
      const lift = Math.sin(Math.PI * seg(u, 0.72, 1.5));
      // After the first tap the port stays lit, as it does in the game, and a dotted wire reaches for the target.
      drawRing(c, a, tap1, '#fff', fade);
      if (u > 0.55) {
        c.globalAlpha = 0.9 * fade;
        c.strokeStyle = '#fff';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(a.x, a.y, 11, 0, Math.PI * 2);
        c.stroke();
      }
      drawWire(c, p.from, p.end, p.color, (u > 1.7 ? 0.95 : 0.4 * seg(u, 0.6, 0.9)) * fade, u <= 1.7);
      if (p.card) drawCard(c, p.card, seg(u, 0.6, 0.9) * fade * (u > 1.7 ? 1 : 0.5), false, '#fff');
      else drawGhostCard(c, p.to, seg(u, 1.6, 1.8) * fade);
      drawRing(c, b, tap2, '#fff', fade);
      const press = Math.sin(Math.PI * tap1) + Math.sin(Math.PI * tap2);
      drawHand(c, pos, fade, Math.min(1, press), lift);
    } else {
      // Press on the port, drag to the target, let go.
      const u = clock % 2.9;
      const fade = seg(u, 0, 0.3) * (1 - seg(u, 2.15, 2.5));
      const approach = ease(seg(u, 0, 0.4));
      const press = seg(u, 0.4, 0.58) * (1 - seg(u, 1.62, 1.8));
      const go = ease(seg(u, 0.62, 1.6));
      const start = mix({ x: a.x + 22, y: a.y + 26 }, a, approach);
      const pos = mix(start, b, go);
      drawRing(c, a, seg(u, 0.42, 0.8), '#fff', fade);
      const released = u >= 1.66;
      if (u > 0.6) {
        // While dragging the wire follows the finger; let go and it snaps onto the target.
        const endWorld = released ? p.end : mix(p.from, p.to, go);
        drawWire(c, p.from, endWorld, p.color, 0.95 * fade, !released && go < 0.82);
      }
      if (p.card) drawCard(c, p.card, seg(go, 0.75, 0.9) * fade, false, '#fff');
      else drawGhostCard(c, p.to, seg(u, 1.66, 1.8) * fade);
      drawRing(c, released && p.card ? toClient(p.end) : b, seg(u, 1.66, 2.05), released ? p.color : '#fff', fade);
      drawHand(c, pos, fade, press);
    }
    c.globalAlpha = 1;
  },
};

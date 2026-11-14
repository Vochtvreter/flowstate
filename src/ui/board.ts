// The board: world rendering (DOM nodes + SVG wires, patched by id) and every pointer gesture.
// Anything that moves every frame (wire dots, floating gains) is drawn by fx.ts on one canvas.
import { MATERIALS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, Recipe, TECHS } from '../content';
import {
  act, canConnect, connect, cutWires, expandBoard, freeDeposits, materialsAt, nodeById, placeNode, pushUndo, splice,
} from '../actions';
import {
  expansionCost, fmt, fmtRate, labRate, matUnlocked, nodeCost, nodeUnlocked, recipeOf, recipeUnlocked,
} from '../economy';
import { bagTotal, graph, isMachine, isSink, outPortCount } from '../sim';
import { GRID, Game, GNode, Wire, snap, snapshot } from '../state';
import { anchorPt, cachedRect, el, invalidateLayout, pulseAnchor, setClass, setHTML, setStyle, setText, svgEl } from './dom';
import {
  Beacon, Flow, floater, flowPoint, fly, frameFx, invalidateFx, makeFlow, setBeacons, setFlowPath, setFlows,
} from './fx';
import { Port, Pt, bezierAt, inPorts, matColor, nodeSize, outPorts, pathD, segmentsCross, wireEnds } from './geom';
import { esc, icon, matGlyph, matShape, nodeIcon } from './icons';
import { diagnose } from './status';
import { delegate, onPress, select, signal, toast, touch, ui } from './ui';

let boardEl: HTMLElement;
let worldEl: HTMLElement;
let plotEl: HTMLElement;
let plotLabel: HTMLElement;
let depositsEl: HTMLElement;
let wiresSvg: SVGSVGElement;
let nodesEl: HTMLElement;
let chipsEl: HTMLElement;
let ghostEl: HTMLElement;
let expandEl: HTMLButtonElement;
let radialEl: HTMLElement;
let tempPath: SVGPathElement;
let tempEnd: SVGCircleElement;
let knifeLine: SVGLineElement;

interface NodeRefs {
  el: HTMLElement; ring: SVGCircleElement | null; rate: HTMLElement; sub: HTMLElement; pill: HTMLElement;
  outs: HTMLElement[]; open: boolean[];
  /** Everything the element's structure depends on; a different signature means rebuild. */
  sig: string;
  x: number; y: number;
  // last values written, so the slow update only touches what changed
  cRate: string; cSub: string; cRing: number; cSt: string; cPill: string;
  // rate and utilisation: smoothed for display, and as last shown (see `settle`)
  sRate: number; vRate: number; sUtil: number; vUtil: number;
}
interface WireRefs {
  g: SVGGElement; hit: SVGPathElement; glow: SVGPathElement; base: SVGPathElement; chip: HTMLElement; chipText: HTMLElement;
  a: Pt; b: Pt; flow: Flow;
  chipX: number; chipY: number; chipHw: number; chipOff: boolean;
  cColor: string; cWidth: number; cFlowing: boolean | null; cSat: boolean | null; cChip: string;
  sRate: number; vRate: number;
}
const nodeEls = new Map<number, NodeRefs>();
const wireEls = new Map<number, WireRefs>();

let renderedGame: Game | null = null;
let renderedRev = -1;
let renderedUi = -1;
let depositsHtml = '';
let selNodeId: number | null = null;
let selWireId: number | null = null;
let targetId: number | null = null;
let far = false;
/** Zoomed out so far that the small print on cards cannot be read; it is then not kept up to date. */
let tiny = false;
let mouse: Pt = { x: 0, y: 0 };
/** Nodes whose border should flash once the next structure sync has run. */
const flashQueue: number[] = [];

/** How close (screen px) a dragged wire has to come to a node before it snaps on. */
const SNAP_PX = 40;

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'node'; id: number; ox: number; oy: number; x0: number; y0: number; moved: boolean; sx: number; sy: number }
  | { kind: 'wire'; from: number; port: number; mats: MatId[]; a: Pt; p: Pt; target: number | null; tp: Pt; blend: number; armed: boolean; sx: number; sy: number }
  | { kind: 'wireIn'; to: number; mat: MatId | null; b: Pt; p: Pt; target: number | null; tp: Pt; blend: number; armed: boolean; sx: number; sy: number }
  | { kind: 'wirePress'; wireId: number; sx: number; sy: number }
  | { kind: 'knife'; a: Pt; b: Pt };
let drag: Drag | null = null;

interface RadialOpt { type: NodeType; recipe?: string; label: string; sub: string; cost: number; locked?: string; glyph: string }
interface RadialState { at: Pt; opts: RadialOpt[]; dir: 'consume' | 'produce'; from: number; port: number; to: number; mat: MatId | null; a: Pt }
let radial: RadialState | null = null;

// ---------- coordinates ----------

const rectOf = cachedRect(() => boardEl);
/** The board's client rect. Cached: call invalidateLayout() (dom.ts) after anything that moves or resizes the stage. */
export const boardRect = () => rectOf();

export function toWorld(cx: number, cy: number): Pt {
  const r = rectOf();
  return { x: (cx - r.left - ui.view.x) / ui.view.k, y: (cy - r.top - ui.view.y) / ui.view.k };
}

/** World point to board-local pixels. */
export function toScreen(p: Pt): Pt {
  return { x: p.x * ui.view.k + ui.view.x, y: p.y * ui.view.k + ui.view.y };
}

/** World point to client pixels (what fx and getBoundingClientRect use). */
export function toClient(p: Pt): Pt {
  const r = rectOf();
  return { x: p.x * ui.view.k + ui.view.x + r.left, y: p.y * ui.view.k + ui.view.y + r.top };
}

function applyView() {
  const { x, y, k } = ui.view;
  worldEl.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  boardEl.style.backgroundSize = `${24 * k}px ${24 * k}px`;
  boardEl.style.backgroundPosition = `${x}px ${y}px`;
  const wasFar = far, wasTiny = tiny;
  far = k < 0.6;
  tiny = k < 0.5;
  if (far !== wasFar) boardEl.classList.toggle('far', far);
  if (!renderedGame) return;
  // Text that was left alone while too small to read (or hidden) is brought up to date on the way back in.
  if ((wasFar && !far) || (wasTiny && !tiny)) updateSlow();
  // Chips appeared or disappeared, which changes what the dots must avoid.
  if (far !== wasFar) layoutWires();
}

export function fitView() {
  const r = rectOf();
  const g = ui.g;
  const pad = 60;
  const k = Math.max(0.3, Math.min(1.2, Math.min((r.width - pad * 2) / g.board.w, (r.height - pad * 2 - 40) / g.board.h)));
  ui.view.k = k;
  ui.view.x = (r.width - g.board.w * k) / 2;
  ui.view.y = (r.height - g.board.h * k) / 2 + 10;
  applyView();
}

export function jumpTo(id: number) {
  const n = nodeById(ui.g, id);
  if (!n) return;
  const r = rectOf();
  const { w, h } = nodeSize(n);
  ui.view.x = r.width / 2 - (n.x + w / 2) * ui.view.k;
  ui.view.y = r.height / 2 - (n.y + h / 2) * ui.view.k;
  applyView();
  select({ kind: 'node', id });
}

/** Pan just enough that a node is fully on screen (e.g. after the inspector opens over it). */
export function ensureVisible(id: number) {
  const n = nodeById(ui.g, id);
  if (!n) return;
  const r = rectOf();
  const { w, h } = nodeSize(n);
  const k = ui.view.k;
  const left = n.x * k + ui.view.x, top = n.y * k + ui.view.y;
  const pad = 40;
  if (left + w * k > r.width - pad) ui.view.x -= left + w * k - (r.width - pad);
  else if (left < pad) ui.view.x += pad - left;
  if (top + h * k > r.height - pad) ui.view.y -= top + h * k - (r.height - pad);
  else if (top < pad + 50) ui.view.y += pad + 50 - top;
  applyView();
}

export function zoomBy(factor: number, cx?: number, cy?: number) {
  const r = rectOf();
  const px = (cx ?? r.left + r.width / 2) - r.left;
  const py = (cy ?? r.top + r.height / 2) - r.top;
  const k = Math.max(0.3, Math.min(2, ui.view.k * factor));
  const f = k / ui.view.k;
  ui.view.x = px - (px - ui.view.x) * f;
  ui.view.y = py - (py - ui.view.y) * f;
  ui.view.k = k;
  applyView();
}

// ---------- init ----------

export function initBoard(root: HTMLElement) {
  boardEl = root;
  boardEl.innerHTML = `
    <div id="world">
      <div id="plot"><span id="plot-label"></span></div>
      <div id="deposits"></div>
      <svg id="wires" width="1" height="1"></svg>
      <div id="nodes"></div>
      <div id="chips"></div>
      <svg id="overlay" width="1" height="1"><path id="temp-wire"></path><circle id="temp-end" r="5"></circle><line id="knife"></line></svg>
      <div id="ghost"></div>
      <button id="expand" data-testid="expand"></button>
    </div>
    <div id="radial"></div>`;
  worldEl = boardEl.querySelector('#world')!;
  plotEl = boardEl.querySelector('#plot')!;
  plotLabel = boardEl.querySelector('#plot-label')!;
  depositsEl = boardEl.querySelector('#deposits')!;
  wiresSvg = boardEl.querySelector('#wires')!;
  nodesEl = boardEl.querySelector('#nodes')!;
  chipsEl = boardEl.querySelector('#chips')!;
  ghostEl = boardEl.querySelector('#ghost')!;
  expandEl = boardEl.querySelector('#expand')!;
  radialEl = boardEl.querySelector('#radial')!;
  tempPath = boardEl.querySelector('#temp-wire')!;
  tempEnd = boardEl.querySelector('#temp-end')!;
  knifeLine = boardEl.querySelector('#knife')!;

  boardEl.addEventListener('pointerdown', onDown);
  boardEl.addEventListener('pointermove', onMove);
  boardEl.addEventListener('pointerup', onUp);
  boardEl.addEventListener('pointercancel', abortDrag);
  boardEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (radial) closeRadial();
    zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });
  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
  onPress(expandEl, () => {
    if (!expandBoard(ui.g)) toast(`Expanding costs <b>${fmt(expansionCost(ui.g))}¢</b>`, 'bad');
    else toast('Board expanded. New deposits revealed.', 'good');
  });
  delegate(radialEl, (a, args) => {
    if (a === 'pick') pickRadial(Number(args[0]));
  });
  // The cached board rect (and the minimap's viewport box) follow the stage's size.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      invalidateLayout();
      touch();
    }).observe(boardEl);
  }
  applyView();
}

// ---------- structure: nodes ----------

function recipeText(r: Recipe): string {
  const side = (xs: [MatId, number][]) => xs.map(([m, q]) => `${q > 1 ? q + ' ' : ''}${MATERIALS[m].name}`).join(' + ');
  return `${side(r.inputs)} → ${side(r.outputs)}`;
}

function nodeTitle(n: GNode): string {
  if (n.type === 'well' && n.material) return `${MATERIALS[n.material].name} Well`;
  return NODE_DEFS[n.type].name;
}

/** Longest second line that fits a full-width card. Cut here rather than with CSS: see `.ns` in the stylesheet. */
const SUB_CHARS = 19;

function nodeSub(n: GNode): string {
  switch (n.type) {
    case 'well': return `Lv ${n.lv.speed} · deposit`;
    case 'refiner': case 'assembler': case 'fabricator': {
      const r = recipeOf(n);
      const text = r ? recipeText(r) : 'no recipe';
      return text.length > SUB_CHARS ? text.slice(0, SUB_CHARS - 1).trimEnd() + '…' : text;
    }
    case 'router': return `${n.mode} split`;
    case 'merger': return 'junction';
    case 'silo': return 'buffer';
    case 'market': return 'sells anything';
    case 'lab': return 'items → Data';
    case 'void': return 'destroys items';
  }
}

function nodeGlyph(n: GNode): string {
  if (n.type === 'well' && n.material) return matGlyph(n.material, 17);
  if (isMachine(n)) {
    const r = recipeOf(n);
    return r ? matGlyph(r.outputs[0][0], 17) : nodeIcon(n.type, 18);
  }
  if (n.type === 'market') return `<span class="coin">¢</span>`;
  return nodeIcon(n.type, 18);
}

function nodeSig(n: GNode, w: number, h: number, ins: Port[], outs: Port[]): string {
  let s = `${n.type}|${n.recipe}|${n.material}|${w}x${h}`;
  for (const p of ins) s += `|i${p.mat}:${p.y - n.y}`;
  for (const p of outs) s += `|o${p.mat}:${p.y - n.y}`;
  return s;
}

function buildNode(n: GNode, w: number, h: number, ins: Port[], outs: Port[], sig: string): NodeRefs {
  const hasRing = n.type === 'well' || isMachine(n);
  const compact = w < 160;
  const sub = nodeSub(n);
  const e = el(`
    <div class="node t-${n.type}${compact ? ' compact' : ''}" data-id="${n.id}" data-testid="node-${n.type}"
         style="left:${n.x}px;top:${n.y}px;width:${w}px;height:${h}px">
      <div class="ring${hasRing ? '' : ' flat'}">
        ${hasRing ? `<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="17" class="trk"/><circle cx="20" cy="20" r="17" class="val" pathLength="100"/></svg>` : ''}
        <div class="glyph">${nodeGlyph(n)}</div>
      </div>
      <div class="txt"><div class="nt">${esc(nodeTitle(n))}</div><div class="ns">${esc(sub)}</div><div class="nr mono"></div></div>
      <span class="pill"></span>
    </div>`);
  for (const p of ins) {
    const c = n.type === 'market' ? '#FFC857' : n.type === 'lab' ? '#C4A1FF' : matColor(p.mat);
    e.appendChild(el(`<span class="port in" data-in="${p.index}" ${p.mat ? `data-mat="${p.mat}"` : ''} style="top:${p.y - n.y}px;background:${c}"></span>`));
  }
  const outEls: HTMLElement[] = [];
  for (const p of outs) {
    const port = el(`<span class="port out" data-out="${p.index}" data-testid="port-out" style="top:${p.y - n.y}px;background:${matColor(p.mat)}"></span>`);
    outEls.push(port);
    e.appendChild(port);
    if (outs.length > 1 && p.mat) e.appendChild(el(`<span class="port-label" style="top:${p.y - n.y}px">${MATERIALS[p.mat].name}</span>`));
  }
  return {
    el: e,
    ring: e.querySelector<SVGCircleElement>('.val'),
    rate: e.querySelector('.nr')!,
    sub: e.querySelector('.ns')!,
    pill: e.querySelector('.pill')!,
    outs: outEls, open: outEls.map(() => false),
    sig, x: n.x, y: n.y,
    cRate: '', cSub: sub, cRing: -1, cSt: '', cPill: '',
    sRate: -1, vRate: -1, sUtil: -1, vUtil: -1,
  };
}

/** Add a class that plays a CSS animation once, then take it off again so it can never replay. */
function oneShot(e: Element, cls: string, ms: number) {
  e.classList.add(cls);
  setTimeout(() => e.classList.remove(cls), ms);
}

function syncNodes(g: Game, fresh: boolean) {
  const gr = graph(g);
  for (const n of g.nodes) {
    const { w, h } = nodeSize(n);
    const ins = inPorts(n), outs = outPorts(g, n);
    const sig = nodeSig(n, w, h, ins, outs);
    let refs = nodeEls.get(n.id);
    if (!refs) {
      refs = buildNode(n, w, h, ins, outs, sig);
      nodesEl.appendChild(refs.el);
      nodeEls.set(n.id, refs);
      if (!fresh) oneShot(refs.el, 'pop', 320);
    } else if (refs.sig !== sig) {
      // Same node, different shape (recipe or ports changed): swap the element where it stands.
      const next = buildNode(n, w, h, ins, outs, sig);
      for (const cls of ['sel', 'target', 'dragging']) if (refs.el.classList.contains(cls)) next.el.classList.add(cls);
      refs.el.replaceWith(next.el);
      nodeEls.set(n.id, (refs = next));
    } else if (refs.x !== n.x || refs.y !== n.y) {
      refs.el.style.left = n.x + 'px';
      refs.el.style.top = n.y + 'px';
      refs.x = n.x;
      refs.y = n.y;
    }
    // A port with nothing attached pulses to invite a wire.
    const ow = gr.outs.get(n.id);
    for (let i = 0; i < refs.outs.length; i++) {
      const open = !ow?.[i]?.length;
      if (refs.open[i] !== open) {
        refs.open[i] = open;
        refs.outs[i].classList.toggle('open', open);
      }
    }
  }
  if (nodeEls.size !== g.nodes.length) {
    for (const [id, refs] of nodeEls) {
      if (gr.byId.has(id)) continue;
      refs.el.remove();
      nodeEls.delete(id);
    }
  }
}

// ---------- structure: wires ----------

function setWirePath(refs: WireRefs, a: Pt, b: Pt) {
  const d = pathD(a, b);
  refs.hit.setAttribute('d', d);
  refs.glow.setAttribute('d', d);
  refs.base.setAttribute('d', d);
  refs.a = { x: a.x, y: a.y };
  refs.b = { x: b.x, y: b.y };
  setFlowPath(refs.flow, (t) => bezierAt(a, b, t));
}

function buildWire(w: Wire, a: Pt, b: Pt, fresh: boolean): WireRefs {
  const grp = svgEl('g', { class: 'wire stalled', 'data-id': String(w.id) });
  const hit = svgEl('path', { class: 'hit' });
  const glow = svgEl('path', { class: 'glow' });
  const base = svgEl('path', { class: 'base' });
  grp.append(hit, glow, base);
  // A zero-size anchor with the pill centred on it: no percentage transform, so a text change
  // never alters the compositor's property trees.
  const chip = el(`<span class="chip stalled"><i class="mono"></i></span>`);
  const refs: WireRefs = {
    g: grp, hit, glow, base, chip, chipText: chip.firstElementChild as HTMLElement, a, b,
    // A wire that is there when the board loads starts full of dots; one the player just made starts empty.
    flow: makeFlow(fresh),
    chipX: NaN, chipY: NaN, chipHw: 24, chipOff: false,
    cColor: '', cWidth: -9, cFlowing: false, cSat: false, cChip: '',
    sRate: -1, vRate: -1,
  };
  setWirePath(refs, a, b);
  return refs;
}

function syncWires(g: Game, fresh: boolean) {
  let changed = fresh;
  const seen = new Set<number>();
  for (const w of g.wires) {
    const ends = wireEnds(g, w);
    if (!ends) continue;
    seen.add(w.id);
    const refs = wireEls.get(w.id);
    if (!refs) {
      const made = buildWire(w, ends.a, ends.b, fresh);
      wiresSvg.appendChild(made.g);
      chipsEl.appendChild(made.chip);
      wireEls.set(w.id, made);
      if (!fresh) oneShot(made.g, 'new', 260);
      changed = true;
    } else if (refs.a.x !== ends.a.x || refs.a.y !== ends.a.y || refs.b.x !== ends.b.x || refs.b.y !== ends.b.y) {
      setWirePath(refs, ends.a, ends.b);
    }
  }
  if (wireEls.size !== seen.size) {
    for (const [id, refs] of wireEls) {
      if (seen.has(id)) continue;
      refs.g.remove();
      refs.chip.remove();
      wireEls.delete(id);
      changed = true;
    }
  }
  if (changed) pushFlows();
}

function pushFlows() {
  const list: Flow[] = [];
  for (const refs of wireEls.values()) list.push(refs.flow);
  setFlows(list);
}

interface Box { x0: number; y0: number; x1: number; y1: number }

function nodeBoxes(skip?: number): Box[] {
  const out: Box[] = [];
  for (const n of ui.g.nodes) {
    if (n.id === skip) continue;
    const { w, h } = nodeSize(n);
    out.push({ x0: n.x, y0: n.y, x1: n.x + w, y1: n.y + h });
  }
  return out;
}

/** Deposits with no Well on them, as boxes. */
function depositBoxes(): Box[] {
  const g = ui.g;
  const used = new Set(g.nodes.map((n) => n.depositId));
  const out: Box[] = [];
  for (const d of g.deposits) if (!used.has(d.id)) out.push({ x0: d.x, y0: d.y, x1: d.x + 172, y1: d.y + 72 });
  return out;
}

const CHIP_SPOTS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78];

/**
 * Put each rate chip on its wire where it does not cover a node card (trying the middle first),
 * and tell the dot layer which cards each wire passes behind.
 */
function layoutWires() {
  const boxes = nodeBoxes();
  // Chips also keep off empty deposits, whose labels they would otherwise cover.
  const avoid = boxes.concat(depositBoxes());
  for (const refs of wireEls.values()) {
    const f = refs.flow;
    const hw = Math.max(24, refs.cChip.length * 3.3 + 9), hh = 11;
    let spot: Pt | null = null;
    for (const t of CHIP_SPOTS) {
      const p = flowPoint(f, f.len * t);
      let clear = true;
      for (const b of avoid) {
        if (p.x + hw > b.x0 && p.x - hw < b.x1 && p.y + hh > b.y0 && p.y - hh < b.y1) {
          clear = false;
          break;
        }
      }
      if (clear) {
        spot = p;
        break;
      }
    }
    if (!spot) {
      // No clear place on this wire: better no chip than one covering a card.
      if (!refs.chipOff) {
        refs.chipOff = true;
        refs.chip.style.display = 'none';
      }
    } else {
      if (refs.chipOff) {
        refs.chipOff = false;
        refs.chip.style.display = '';
      }
      if (spot.x !== refs.chipX || spot.y !== refs.chipY) {
        refs.chipX = spot.x;
        refs.chipY = spot.y;
        refs.chip.style.left = spot.x.toFixed(1) + 'px';
        refs.chip.style.top = spot.y.toFixed(1) + 'px';
      }
    }
    refs.chipHw = hw;
  }
  // Dots are drawn above everything in the world, so each wire is told what it must not draw over:
  // node cards, and (while they are showing) rate chips.
  for (const refs of wireEls.values()) {
    const f = refs.flow;
    const occ = f.occ;
    occ.length = 0;
    for (const b of boxes) {
      if (b.x1 < f.x0 || b.x0 > f.x1 || b.y1 < f.y0 || b.y0 > f.y1) continue;
      // Exactly the card's sides (ports sit on them and must keep their dots), a little extra above and below.
      occ.push(b.x0, b.y0 - 2, b.x1, b.y1 + 2);
    }
    if (far) continue;
    for (const c of wireEls.values()) {
      if (c.chipOff) continue;
      const hw = c.chipHw + 3;
      if (c.chipX + hw < f.x0 || c.chipX - hw > f.x1 || c.chipY + 12 < f.y0 || c.chipY - 12 > f.y1) continue;
      occ.push(c.chipX - hw, c.chipY - 12, c.chipX + hw, c.chipY + 12);
    }
  }
  // Output ports with nothing attached pulse; the pulse is drawn on the effects canvas.
  const open: Beacon[] = [];
  for (const n of ui.g.nodes) {
    const refs = nodeEls.get(n.id);
    if (!refs || refs.open.indexOf(true) < 0) continue;
    const ports = outPorts(ui.g, n);
    for (let i = 0; i < ports.length; i++) if (refs.open[i]) open.push({ x: ports[i].x, y: ports[i].y, r: 7 });
  }
  setBeacons(open);
  invalidateFx();
}

/** After a node moved: redo the wires attached to it, then chips and occlusion for all. */
function relayoutNode(n: GNode) {
  const g = ui.g;
  const gr = graph(g);
  const fix = (w: Wire) => {
    const refs = wireEls.get(w.id);
    const ends = wireEnds(g, w);
    if (refs && ends) setWirePath(refs, ends.a, ends.b);
  };
  for (const w of gr.ins.get(n.id) ?? []) fix(w);
  for (const port of gr.outs.get(n.id) ?? []) if (port) for (const w of port) fix(w);
  layoutWires();
}

// ---------- structure: the rest ----------

function syncDeposits(g: Game) {
  const used = new Set(g.nodes.map((n) => n.depositId));
  const html = g.deposits
    .filter((d) => !used.has(d.id))
    .map((d) => {
      const ok = matUnlocked(g, d.mat);
      return `<div class="deposit${ok ? '' : ' locked'}" data-dep="${d.id}" style="left:${d.x}px;top:${d.y}px;${ok ? `--c:${MATERIALS[d.mat].color}` : ''}">
        ${ok ? matGlyph(d.mat, 18) : icon('lock', 16)}
        <div><div class="dn">${ok ? MATERIALS[d.mat].name + ' deposit' : 'Unknown deposit'}</div><div class="ds">${ok ? 'empty · place a Well' : 'needs research'}</div></div>
      </div>`;
    })
    .join('');
  if (html !== depositsHtml) {
    depositsHtml = html;
    depositsEl.innerHTML = html;
  }
}

/** Bring the DOM in line with the game: create, patch or remove by id. Nothing is rebuilt that did not change. */
function syncStructure() {
  const g = ui.g;
  const fresh = g !== renderedGame;
  if (fresh) {
    // A different game object (first frame, or a reset): start clean, with no entrance animations.
    renderedGame = g;
    nodesEl.textContent = '';
    wiresSvg.textContent = '';
    chipsEl.textContent = '';
    nodeEls.clear();
    wireEls.clear();
    selNodeId = selWireId = targetId = null;
    flashQueue.length = 0;
  }
  setStyle(plotEl, 'width', g.board.w + 'px');
  setStyle(plotEl, 'height', g.board.h + 'px');
  setText(plotLabel, `Board · ${g.board.expansions + 1} plot${g.board.expansions ? 's' : ''}`);
  setStyle(expandEl, 'left', g.board.w / 2 - 130 + 'px');
  setStyle(expandEl, 'top', g.board.h + 18 + 'px');
  syncDeposits(g);
  syncNodes(g, fresh);
  syncWires(g, fresh);
  layoutWires();
  for (const id of flashQueue.splice(0)) {
    const refs = nodeEls.get(id);
    if (refs) oneShot(refs.el, 'flash', 260);
  }
  livelyUntil = performance.now() + LIVELY_FOR;
  updateSlow();
}

/** Selection, wire target and placing mode are classes on elements that already exist. */
function syncUi() {
  const sel = ui.sel;
  const node = sel?.kind === 'node' ? sel.id : null;
  const wire = sel?.kind === 'wire' ? sel.id : null;
  if (node !== selNodeId || (node != null && !nodeEls.get(node)?.el.classList.contains('sel'))) {
    if (selNodeId != null) nodeEls.get(selNodeId)?.el.classList.remove('sel');
    if (node != null) nodeEls.get(node)?.el.classList.add('sel');
    selNodeId = node;
  }
  if (wire !== selWireId || (wire != null && !wireEls.get(wire)?.g.classList.contains('sel'))) {
    if (selWireId != null) wireEls.get(selWireId)?.g.classList.remove('sel');
    if (wire != null) wireEls.get(wire)?.g.classList.add('sel');
    selWireId = wire;
  }
  setClass(boardEl, 'placing', !!ui.placing);
  updateGhost();
}

// ---------- per-frame + slow updates ----------

function rateLine(g: Game, n: GNode, rate: number, util: number): string {
  switch (n.type) {
    case 'well': return `${fmtRate(rate)}/s`;
    case 'refiner': case 'assembler': case 'fabricator':
      return n.recipe ? `${fmtRate(rate)}/s · ${Math.round(util * 100)}%` : 'pick a recipe';
    case 'silo': return `${Math.round(bagTotal(n.inb))} stored`;
    case 'market': return `${fmtRate(rate)}/s sold`;
    case 'lab': return `${fmtRate(rate)} / ${fmtRate(labRate(g, n))} /s`;
    default: return `${fmtRate(rate)}/s`;
  }
}

// Readings on the board never quite sit still: items move in bursts, so a wire carrying 0.5/s
// reads 0.46, 0.53, 0.49… from one moment to the next. Showing that raw makes every number on
// screen flicker, and every flicker is a repaint. So each reading is eased a little more for
// display, and the shown value is only replaced once the eased one has clearly moved away from it
// or has come to rest somewhere else.

/** Weight of a new sample in the display average (about two seconds of smoothing at two samples a second). */
const EASE = 0.25;
/** For this long after the player changes the board, readings are shown as they are, so the change is felt at once. */
const LIVELY_FOR = 3000;
let livelyUntil = 0;
let lively = true;

/** Ease `avg` toward `now`; a first sample or a big jump is taken at once, and so is everything while `lively`. */
function ease(avg: number, now: number, jump: number): number {
  return lively || avg < 0 || Math.abs(now - avg) > jump ? now : avg + (now - avg) * EASE;
}

/**
 * The value to keep showing. `shown` stays while the eased reading is within `tol` of it; it is
 * replaced when the reading moves further away, or when the reading has stopped moving and sits
 * most of a display step (`step` is one unit of the last digit shown) from it, so that a steady
 * 1.00 never goes on reading 0.99.
 */
function settle(shown: number, before: number, avg: number, tol: number, step: number): number {
  const off = Math.abs(avg - shown);
  return off >= tol || (off >= step * 0.75 && Math.abs(avg - before) < step * 0.05) ? avg : shown;
}

let expandCost = -1;

function updateNodes(g: Game) {
  for (const n of g.nodes) {
    const refs = nodeEls.get(n.id);
    if (!refs) continue;
    let was = refs.sRate;
    refs.sRate = ease(was, n.rate, Math.max(0.15, was * 0.4));
    refs.vRate = settle(refs.vRate, was, refs.sRate, Math.max(0.012, refs.sRate * 0.025), 0.01);
    was = refs.sUtil;
    refs.sUtil = ease(was, n.util, 0.25);
    refs.vUtil = settle(refs.vUtil, was, refs.sUtil, 0.02, 0.01);
    // Zoomed far out the small print cannot be read, so it is left alone (and caught up on the way back in).
    if (!tiny || refs.cRate === '') {
      const rate = rateLine(g, n, refs.vRate, refs.vUtil);
      if (rate !== refs.cRate) {
        refs.cRate = rate;
        refs.rate.textContent = rate;
      }
      const sub = nodeSub(n);
      if (sub !== refs.cSub) {
        refs.cSub = sub;
        refs.sub.textContent = sub;
      }
    }
    if (refs.ring) {
      const v = Math.round(refs.vUtil * 100);
      if (v !== refs.cRing) {
        refs.cRing = v;
        refs.ring.style.strokeDasharray = `${v} ${100 - v}`;
      }
    }
    const dx = diagnose(g, n);
    let st: string = n.status;
    let pill = '';
    // Wells never get a pill: their ring colour says enough.
    if (n.type !== 'well') {
      if (dx.problem === 'blocked') pill = dx.victim ? '' : 'BLOCKED';
      else if (dx.problem === 'starved') pill = dx.victim ? '' : 'STARVED';
      else if (dx.problem === 'idle') pill = 'IDLE';
    }
    if (dx.problem && dx.victim) st = 'victim';
    if (st !== refs.cSt) {
      refs.cSt = st;
      refs.el.dataset.st = st;
    }
    if (pill !== refs.cPill) {
      refs.cPill = pill;
      refs.pill.textContent = pill;
      refs.pill.dataset.kind = pill.toLowerCase();
    }
  }
}

function updateWires(g: Game) {
  let recolored = false;
  for (const w of g.wires) {
    const refs = wireEls.get(w.id);
    if (!refs) continue;
    const cap = PIPES[w.tier].cap;
    const flowing = w.rate > 0.015;
    const sat = w.rate >= cap * 0.97;
    const mat = w.mat ?? materialsAt(g, w.from, w.port)[0] ?? null;
    const color = matColor(mat);
    if (color !== refs.cColor) {
      refs.cColor = color;
      refs.g.style.color = color;
      refs.flow.color = color;
      refs.flow.shape = matShape(mat);
      recolored = true;
    }
    const was = refs.sRate;
    refs.sRate = flowing === refs.cFlowing ? ease(was, w.rate, Math.max(0.15, was * 0.4)) : w.rate;
    refs.vRate = settle(refs.vRate, was, refs.sRate, Math.max(0.012, refs.sRate * 0.025), 0.01);
    const width = 2 + Math.min(5, refs.vRate * 1.1);
    if (Math.abs(width - refs.cWidth) > 0.3) {
      refs.cWidth = width;
      refs.base.style.strokeWidth = width.toFixed(1) + 'px';
      refs.glow.style.strokeWidth = (width + 9).toFixed(1) + 'px';
    }
    if (flowing !== refs.cFlowing) {
      refs.cFlowing = flowing;
      refs.g.classList.toggle('stalled', !flowing);
      refs.chip.classList.toggle('stalled', !flowing);
    }
    if (sat !== refs.cSat) {
      refs.cSat = sat;
      refs.g.classList.toggle('sat', sat);
      refs.chip.classList.toggle('sat', sat);
    }
    // Chips are hidden when zoomed far out, so their text can wait.
    if (!far && !refs.chipOff) {
      const src = nodeById(g, w.from);
      const weight = src?.type === 'router' && src.mode === 'ratio' ? `×${w.weight} · ` : '';
      // A saturated wire shows its capacity exactly; otherwise the settled reading.
      const text = flowing ? `${weight}${fmtRate(sat ? w.rate : refs.vRate)}/s${sat ? ' MAX' : ''}` : `${weight}0/s`;
      if (text !== refs.cChip) {
        refs.cChip = text;
        refs.chipText.textContent = text;
      }
    }
  }
  if (recolored) pushFlows();
}

/**
 * Text, rings, pills, wire widths: things that only need refreshing a few times a second.
 * Everything is compared with what was last written, so a steady factory costs almost nothing.
 * The frame loop alternates between the two halves ('nodes', 'wires') so that neither refresh is
 * a long frame; called with no argument it does both.
 */
export function updateSlow(part?: 'nodes' | 'wires') {
  const g = ui.g;
  lively = performance.now() < livelyUntil;
  if (part !== 'wires') updateNodes(g);
  if (part !== 'nodes') updateWires(g);
  const cost = expansionCost(g);
  if (cost !== expandCost) {
    expandCost = cost;
    expandEl.innerHTML = `${icon('plus', 20)}<span><b>Expand board <i class="mono">${fmt(cost)}¢</i></b><small>New plot · reveals deposits</small></span>`;
  }
  setClass(expandEl, 'ok', g.credits >= cost);
  if (ui.placing) updateGhost();
}

let gainTimer = 0;

/** Once a second: show what each Market and Lab earned, and send a few coins to the credits counter. */
function showGains() {
  const g = ui.g;
  const r = rectOf();
  const size = Math.max(11, Math.min(15, 9 + 5 * ui.view.k));
  const counter = anchorPt('credits');
  let coins = 6;
  let landed = false;
  const land = () => {
    // One pulse per second at most, however many Markets paid out.
    if (!landed) pulseAnchor('credits');
    landed = true;
  };
  const visible = (p: Pt) => p.x > r.left - 30 && p.x < r.right + 30 && p.y > r.top - 30 && p.y < r.bottom + 30;
  for (const n of g.nodes) {
    if (n.type === 'market' && n.gain >= 0.05) {
      const { w, h } = nodeSize(n);
      const top = toClient({ x: n.x + w / 2 + (Math.random() * 30 - 15), y: n.y - 4 });
      signal('sale', { id: n.id, amount: n.gain, at: top });
      if (visible(top) && !ui.techOpen) {
        floater(top, `+${fmt(n.gain)}¢`, '#FFC857', size);
        if (counter && coins > 0) {
          const count = Math.min(coins, n.gain >= 20 ? 3 : n.gain >= 2 ? 2 : 1);
          coins -= count;
          fly(toClient({ x: n.x + 29, y: n.y + h / 2 }), counter, '#FFC857', count, land);
        }
      }
    }
    n.gain = 0;
    if (n.type === 'lab') {
      const parts: string[] = [];
      if ((n.gainB.a ?? 0) >= 0.05) parts.push(`+${fmt(n.gainB.a!)}α`);
      if ((n.gainB.b ?? 0) >= 0.05) parts.push(`+${fmt(n.gainB.b!)}β`);
      if ((n.gainB.g ?? 0) >= 0.05) parts.push(`+${fmt(n.gainB.g!)}γ`);
      if (parts.length && !ui.techOpen) {
        const { w } = nodeSize(n);
        const top = toClient({ x: n.x + w / 2 + (Math.random() * 30 - 15), y: n.y - 4 });
        if (visible(top)) floater(top, parts.join(' '), '#C4A1FF', size);
      }
      n.gainB = {};
    }
  }
}

export function updateBoard(dt: number) {
  const g = ui.g;
  if (g !== renderedGame || g.rev !== renderedRev) {
    renderedRev = g.rev;
    renderedUi = ui.uiRev;
    syncStructure();
    syncUi();
  } else if (ui.uiRev !== renderedUi) {
    renderedUi = ui.uiRev;
    syncUi();
  }
  for (const w of g.wires) {
    const refs = wireEls.get(w.id);
    if (refs) refs.flow.rate = w.rate;
  }
  if (drag && (drag.kind === 'wire' || drag.kind === 'wireIn')) drawTemp(drag, dt);
  if (!g.paused) {
    gainTimer += dt;
    if (gainTimer >= 1) {
      gainTimer = 0;
      showGains();
    }
  }
  // The tech tree covers the whole board, so wire dots are not drawn behind it.
  frameFx(dt, ui.view, g.paused, ui.techOpen);
}

// ---------- placement ----------

/** Clear space kept around a card when it is nudged into place: room for ports at the sides and a status pill on top. */
const GAP_X = 20, GAP_Y = 20;
let ringOffsets: Int16Array | null = null;

/** Grid offsets ordered by distance, for "nearest free spot" searches. */
function offsets(): Int16Array {
  if (ringOffsets) return ringOffsets;
  const R = 36;
  const list: [number, number][] = [];
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) if (i || j) list.push([i, j]);
  // Sideways moves count a little less than vertical ones: cards are wider than they are tall.
  list.sort((a, b) => a[0] * a[0] * 0.8 + a[1] * a[1] - (b[0] * b[0] * 0.8 + b[1] * b[1]));
  ringOffsets = new Int16Array(list.length * 2);
  list.forEach(([i, j], n) => {
    ringOffsets![n * 2] = i * GRID;
    ringOffsets![n * 2 + 1] = j * GRID;
  });
  return ringOffsets;
}

function clampToBoard(x: number, y: number, w: number, h: number): Pt {
  const b = ui.g.board;
  return { x: snap(Math.max(20, Math.min(b.w - w - 20, x))), y: snap(Math.max(20, Math.min(b.h - h - 20, y))) };
}

/**
 * The grid position nearest to (x, y) where a w×h card overlaps no other node and no empty deposit.
 * `skip` is the node being moved, if any.
 */
function freeSpot(x: number, y: number, w: number, h: number, skip?: number): Pt {
  const boxes = nodeBoxes(skip).concat(depositBoxes());
  const fits = (px: number, py: number) => {
    for (const b of boxes) {
      if (px < b.x1 + GAP_X && px + w + GAP_X > b.x0 && py < b.y1 + GAP_Y && py + h + GAP_Y > b.y0) return false;
    }
    return true;
  };
  const base = clampToBoard(x, y, w, h);
  if (fits(base.x, base.y)) return base;
  const off = offsets();
  for (let i = 0; i < off.length; i += 2) {
    const p = clampToBoard(base.x + off[i], base.y + off[i + 1], w, h);
    if (fits(p.x, p.y)) return p;
  }
  return base;
}

/** Size a node of this type and recipe will have once placed. */
const sizeFor = (type: NodeType, recipe?: string | null) => nodeSize({ type, recipe: recipe ?? null } as GNode);

function nearestDeposit(p: Pt) {
  let best: { d: ReturnType<typeof freeDeposits>[number]; dist: number } | null = null;
  for (const d of freeDeposits(ui.g)) {
    const dist = Math.hypot(d.x + 86 - p.x, d.y + 36 - p.y);
    if (!best || dist < best.dist) best = { d, dist };
  }
  return best?.d ?? null;
}

function updateGhost() {
  const p = ui.placing;
  if (!p) {
    setStyle(ghostEl, 'display', 'none');
    return;
  }
  const g = ui.g;
  const { w, h } = sizeFor(p.type, p.recipe);
  const cost = nodeCost(g, p.type);
  let ok = cost <= g.credits + 1e-6;
  let label = NODE_DEFS[p.type].name;
  let pos: Pt;
  let onDeposit = false;
  let why = 'not enough credits';
  if (p.type === 'well') {
    const d = nearestDeposit(mouse);
    if (d) {
      pos = { x: d.x, y: d.y };
      label = `${MATERIALS[d.mat].name} Well`;
      onDeposit = true;
    } else {
      pos = clampToBoard(mouse.x - w / 2, mouse.y - h / 2, w, h);
      ok = false;
      label = 'No free deposit';
      why = 'expand the board';
    }
  } else pos = freeSpot(mouse.x - w / 2, mouse.y - h / 2, w, h);
  setStyle(ghostEl, 'display', 'flex');
  setStyle(ghostEl, 'left', pos.x + 'px');
  setStyle(ghostEl, 'top', pos.y + 'px');
  setStyle(ghostEl, 'width', w + 'px');
  setStyle(ghostEl, 'height', h + 'px');
  setClass(ghostEl, 'bad', !ok);
  // On a deposit the ghost is only an outline with its caption underneath, so the deposit's own label stays readable.
  setClass(ghostEl, 'outline', onDeposit);
  const hint = ok ? `${fmt(cost)}¢ · click to place` : why;
  setHTML(ghostEl, onDeposit
    ? `<span class="cap">${nodeIcon(p.type, 15)}${label} · <span class="mono">${hint}</span></span>`
    : `${nodeIcon(p.type, 20)}<span>${label}<small class="mono">${hint}</small></span>`);
}

export function startPlacing(type: NodeType, recipe?: string | null) {
  const g = ui.g;
  if (!nodeUnlocked(g, type)) return;
  if (ui.placing?.type === type) {
    ui.placing = null;
    touch();
    return;
  }
  if (type === 'well' && !freeDeposits(g).length) {
    toast('No free deposit. <b>Expand the board</b> to find more.', 'bad');
    return;
  }
  if (nodeCost(g, type) > g.credits + 1e-6) {
    toast(`${NODE_DEFS[type].name} costs <b>${fmt(nodeCost(g, type))}¢</b>`, 'bad');
    return;
  }
  closeRadial();
  ui.placing = { type, recipe };
  touch();
}

/** Distance from a point to a wire's path. */
function distToFlow(p: Pt, f: Flow, max: number): number {
  if (p.x < f.x0 - max || p.x > f.x1 + max || p.y < f.y0 - max || p.y > f.y1 + max) return Infinity;
  const pts = f.pts;
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1];
    const dx = pts[i + 2] - ax, dy = pts[i + 3] - ay;
    const len = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len));
    const d = Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

function wireNear(p: Pt, maxDist: number): Wire | null {
  let best: Wire | null = null;
  let bestD = maxDist;
  for (const w of ui.g.wires) {
    const refs = wireEls.get(w.id);
    if (!refs) continue;
    const d = distToFlow(p, refs.flow, maxDist);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

function placeAt(p: Pt, keep: boolean) {
  const g = ui.g;
  const pl = ui.placing!;
  let node: GNode | null = null;
  if (pl.type === 'well') {
    const d = nearestDeposit(p);
    if (!d) return toast('No free deposit. <b>Expand the board</b> to find more.', 'bad');
    node = placeNode(g, 'well', d.x, d.y, { depositId: d.id });
  } else {
    const { w, h } = sizeFor(pl.type, pl.recipe);
    const pos = freeSpot(p.x - w / 2, p.y - h / 2, w, h);
    const over = wireNear(p, 16);
    act(g, () => {
      node = placeNode(g, pl.type, pos.x, pos.y, { recipe: pl.recipe });
      if (!node) return false;
      if (over) splice(g, over.id, node.id);
      return 0;
    });
  }
  if (!node) return toast(`Not enough credits for a ${NODE_DEFS[pl.type].name}`, 'bad');
  if (!keep || nodeCost(g, pl.type) > g.credits) ui.placing = null;
  select({ kind: 'node', id: (node as GNode).id });
  signal('place', { id: (node as GNode).id, type: pl.type });
}

// ---------- pointer gestures ----------

/** The node whose card contains a world point (topmost first). */
function nodeAt(p: Pt): GNode | null {
  const nodes = ui.g.nodes;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const { w, h } = nodeSize(n);
    if (p.x >= n.x && p.x <= n.x + w && p.y >= n.y && p.y <= n.y + h) return n;
  }
  return null;
}

/**
 * Where a dragged wire should attach: the node under the pointer if it is a valid end,
 * otherwise the nearest valid node within SNAP_PX on screen.
 */
function snapTarget(p: Pt, ok: (n: GNode) => boolean): GNode | null {
  const nodes = ui.g.nodes;
  let best: GNode | null = null;
  let bestD = SNAP_PX / ui.view.k;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const { w, h } = nodeSize(n);
    const dx = Math.max(n.x - p.x, 0, p.x - (n.x + w));
    const dy = Math.max(n.y - p.y, 0, p.y - (n.y + h));
    if (dx === 0 && dy === 0) return ok(n) ? n : null;
    const d = Math.hypot(dx, dy);
    if (d < bestD && ok(n)) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

let tempD = '';

function hideTemp() {
  tempPath.classList.remove('on', 'snap');
  tempEnd.classList.remove('on');
  tempD = '';
}

/** The wire being dragged: a curve from the port to the pointer that eases onto a target's port when it snaps. */
function drawTemp(d: Extract<Drag, { kind: 'wire' | 'wireIn' }>, dt: number) {
  const goal = d.target != null ? 1 : 0;
  d.blend += (goal - d.blend) * (1 - Math.exp(-dt / 0.045));
  if (Math.abs(goal - d.blend) < 0.01) d.blend = goal;
  const free = { x: d.p.x + (d.tp.x - d.p.x) * d.blend, y: d.p.y + (d.tp.y - d.p.y) * d.blend };
  const from = d.kind === 'wire' ? d.a : free;
  const to = d.kind === 'wire' ? free : d.b;
  const path = pathD(from, to);
  const key = path + goal;
  if (key === tempD) return;
  tempD = key;
  const color = matColor(d.kind === 'wire' ? d.mats[0] ?? null : d.mat);
  tempPath.setAttribute('d', path);
  tempPath.style.stroke = color;
  tempPath.classList.add('on');
  tempPath.classList.toggle('snap', d.target != null);
  tempEnd.setAttribute('cx', String(free.x));
  tempEnd.setAttribute('cy', String(free.y));
  tempEnd.style.fill = color;
  tempEnd.classList.add('on');
}

function highlightTarget(id: number | null) {
  if (id === targetId) return;
  if (targetId != null) nodeEls.get(targetId)?.el.classList.remove('target');
  if (id != null) nodeEls.get(id)?.el.classList.add('target');
  targetId = id;
}

function startWire(from: number, port: number, e: PointerEvent, p: Pt): boolean {
  const g = ui.g;
  const n = nodeById(g, from);
  const a = n && outPorts(g, n)[port];
  if (!a) return false;
  drag = { kind: 'wire', from, port, mats: materialsAt(g, from, port), a, p, target: null, tp: p, blend: 0, armed: false, sx: e.clientX, sy: e.clientY };
  boardEl.classList.add('wiring');
  return true;
}

function onDown(e: PointerEvent) {
  if (e.button === 1 || e.button === 2) {
    if (ui.placing) {
      ui.placing = null;
      touch();
    }
    if (radial) closeRadial();
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: ui.view.x, vy: ui.view.y, moved: true };
    boardEl.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (t.closest('#radial') || t.closest('#expand')) return;
  if (radial) {
    closeRadial();
    return;
  }
  const p = toWorld(e.clientX, e.clientY);
  mouse = p;
  const g = ui.g;
  boardEl.setPointerCapture(e.pointerId);

  if (ui.placing) {
    placeAt(p, e.shiftKey);
    return;
  }
  if (e.shiftKey) {
    drag = { kind: 'knife', a: p, b: p };
    return;
  }
  const portOut = t.closest<HTMLElement>('.port.out');
  const portIn = t.closest<HTMLElement>('.port.in');
  const nodeEl = t.closest<HTMLElement>('.node');
  if (portOut && nodeEl) {
    startWire(Number(nodeEl.dataset.id), Number(portOut.dataset.out), e, p);
    return;
  }
  if (portIn && nodeEl) {
    const id = Number(nodeEl.dataset.id);
    const n = nodeById(g, id);
    const b = n && inPorts(n)[Number(portIn.dataset.in)];
    if (!b) return;
    drag = { kind: 'wireIn', to: id, mat: (portIn.dataset.mat as MatId) ?? null, b, p, target: null, tp: p, blend: 0, armed: false, sx: e.clientX, sy: e.clientY };
    boardEl.classList.add('wiring');
    return;
  }
  if (nodeEl) {
    const id = Number(nodeEl.dataset.id);
    const n = nodeById(g, id);
    if (!n) return;
    // Only the old position is remembered here; the undo step is built when the node is dropped.
    drag = { kind: 'node', id, ox: p.x - n.x, oy: p.y - n.y, x0: n.x, y0: n.y, moved: false, sx: e.clientX, sy: e.clientY };
    return;
  }
  const wireEl = (t as Element).closest?.('g.wire') as SVGGElement | null;
  if (wireEl) {
    drag = { kind: 'wirePress', wireId: Number(wireEl.dataset.id), sx: e.clientX, sy: e.clientY };
    return;
  }
  drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: ui.view.x, vy: ui.view.y, moved: false };
}

function onMove(e: PointerEvent) {
  const p = toWorld(e.clientX, e.clientY);
  mouse = p;
  const g = ui.g;
  if (ui.placing) updateGhost();
  if (!drag) return;
  switch (drag.kind) {
    case 'pan': {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      ui.view.x = drag.vx + dx;
      ui.view.y = drag.vy + dy;
      applyView();
      break;
    }
    case 'node': {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) break;
      const n = nodeById(g, drag.id);
      if (!n || n.type === 'well') break;
      drag.moved = true;
      const { w, h } = nodeSize(n);
      const pos = clampToBoard(p.x - drag.ox, p.y - drag.oy, w, h);
      if (pos.x !== n.x || pos.y !== n.y) {
        n.x = pos.x;
        n.y = pos.y;
        const refs = nodeEls.get(n.id);
        if (refs) {
          refs.el.style.left = n.x + 'px';
          refs.el.style.top = n.y + 'px';
          refs.x = n.x;
          refs.y = n.y;
          refs.el.classList.add('dragging');
        }
        relayoutNode(n);
      }
      break;
    }
    case 'wirePress': {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) break;
      const w = g.wires.find((x) => x.id === (drag as { wireId: number }).wireId);
      // Dragging off the middle of a wire branches a new one from the same port.
      if (!w || !startWire(w.from, w.port, e, p)) drag = null;
      break;
    }
    case 'wire': {
      const d = drag;
      d.p = p;
      if (!d.armed && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) d.armed = true;
      const tn = d.armed ? snapTarget(p, (n) => canConnect(g, d.from, d.port, n.id)) : null;
      d.target = tn?.id ?? null;
      if (tn) {
        const ins = inPorts(tn);
        d.tp = ins.find((ip) => ip.mat && d.mats.includes(ip.mat)) ?? ins[0] ?? p;
      }
      highlightTarget(d.target);
      break;
    }
    case 'wireIn': {
      const d = drag;
      d.p = p;
      if (!d.armed && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) d.armed = true;
      const sn = d.armed ? snapTarget(p, (n) => !isSink(n) && n.id !== d.to) : null;
      d.target = sn?.id ?? null;
      if (sn) d.tp = outPorts(g, sn)[0] ?? p;
      highlightTarget(d.target);
      break;
    }
    case 'knife': {
      drag.b = p;
      knifeLine.classList.add('on');
      knifeLine.setAttribute('x1', String(drag.a.x));
      knifeLine.setAttribute('y1', String(drag.a.y));
      knifeLine.setAttribute('x2', String(p.x));
      knifeLine.setAttribute('y2', String(p.y));
      break;
    }
  }
}

function endDrag() {
  if (drag?.kind === 'node') nodeEls.get(drag.id)?.el.classList.remove('dragging');
  drag = null;
  boardEl.classList.remove('wiring');
  highlightTarget(null);
  hideTemp();
  knifeLine.classList.remove('on');
}

/** Give up on the gesture in progress. A node that was being moved goes back to where it started. */
function abortDrag() {
  if (drag?.kind === 'node' && drag.moved) {
    const n = nodeById(ui.g, drag.id);
    const refs = nodeEls.get(drag.id);
    if (n && refs) {
      n.x = refs.x = drag.x0;
      n.y = refs.y = drag.y0;
      refs.el.style.left = n.x + 'px';
      refs.el.style.top = n.y + 'px';
      relayoutNode(n);
    }
  }
  endDrag();
}

/** Finish moving a node: settle it on a free spot and record one undo step for the move. */
function dropNode(d: Extract<Drag, { kind: 'node' }>) {
  const g = ui.g;
  const n = nodeById(g, d.id);
  nodeEls.get(d.id)?.el.classList.remove('dragging');
  if (!n) return; // deleted while it was being dragged: nothing to record
  if (d.moved) {
    const { w, h } = nodeSize(n);
    // Dropping a loose node on a wire splices it in.
    const loose = !g.wires.some((x) => x.from === n.id || x.to === n.id);
    const over = loose ? wireNear({ x: n.x + w / 2, y: n.y + h / 2 }, 18) : null;
    const spot = freeSpot(n.x, n.y, w, h, n.id);
    n.x = spot.x;
    n.y = spot.y;
    if (n.x !== d.x0 || n.y !== d.y0 || over) {
      // The "before" picture is taken now, with only this node put back where it started.
      // Taking it at press time would also roll back anything else done during the drag.
      const before = snapshot(g);
      const sn = before.nodes.find((s) => s.id === n.id);
      if (sn) {
        sn.x = d.x0;
        sn.y = d.y0;
      }
      pushUndo(g, before);
      if (over) splice(g, over.id, n.id);
    }
    g.rev++;
  }
  select({ kind: 'node', id: d.id });
}

function onUp(e: PointerEvent) {
  const g = ui.g;
  const d = drag;
  if (!d) return;
  const p = toWorld(e.clientX, e.clientY);
  switch (d.kind) {
    case 'pan':
      if (!d.moved && ui.sel) select(null);
      break;
    case 'node':
      dropNode(d);
      break;
    case 'wirePress':
      select({ kind: 'wire', id: d.wireId });
      break;
    case 'wire': {
      if (d.target != null) {
        const tn = nodeById(g, d.target)!;
        const w = connect(g, d.from, d.port, d.target);
        if (w) {
          flashQueue.push(d.target);
          signal('connect', { from: d.from, to: d.target, at: toClient(d.tp) });
        }
        const r = recipeOf(tn);
        if (w && isMachine(tn) && r && d.mats.length && !r.inputs.some((i) => d.mats.includes(i[0]))) {
          toast(`This ${NODE_DEFS[tn.type].name} makes ${r.name} and does not use ${MATERIALS[d.mats[0]].name}`, 'bad');
        }
      } else if (Math.hypot(p.x - d.a.x, p.y - d.a.y) > 36 && !nodeAt(p)) {
        drag = null;
        boardEl.classList.remove('wiring');
        openRadial({ at: p, dir: 'consume', from: d.from, port: d.port, to: 0, mat: d.mats[0] ?? null, a: d.a, opts: consumeOptions(g, d.mats) });
        return;
      }
      break;
    }
    case 'wireIn': {
      if (d.target != null) {
        const src = nodeById(g, d.target)!;
        let port = 0;
        const r = recipeOf(src);
        if (isMachine(src) && r && d.mat) port = Math.max(0, r.outputs.findIndex((o) => o[0] === d.mat));
        if (port < outPortCount(src) && connect(g, d.target, port, d.to)) {
          flashQueue.push(d.to);
          signal('connect', { from: d.target, to: d.to, at: toClient(d.b) });
        }
      } else if (Math.hypot(p.x - d.b.x, p.y - d.b.y) > 36 && !nodeAt(p)) {
        const opts = d.mat ? produceOptions(g, d.mat) : [];
        if (!opts.length) toast(d.mat ? `Nothing you have unlocked makes ${MATERIALS[d.mat].name}. Wire a Well to it.` : 'Drag from an output port instead', 'bad');
        else {
          drag = null;
          boardEl.classList.remove('wiring');
          openRadial({ at: p, dir: 'produce', from: 0, port: 0, to: d.to, mat: d.mat, a: d.b, opts });
          return;
        }
      }
      break;
    }
    case 'knife': {
      const cut: number[] = [];
      for (const w of g.wires) {
        const refs = wireEls.get(w.id);
        if (!refs) continue;
        const pts = refs.flow.pts;
        for (let i = 0; i + 3 < pts.length; i += 2) {
          if (segmentsCross(d.a, d.b, { x: pts[i], y: pts[i + 1] }, { x: pts[i + 2], y: pts[i + 3] })) {
            cut.push(w.id);
            break;
          }
        }
      }
      if (cut.length) {
        cutWires(g, cut);
        if (ui.sel?.kind === 'wire' && cut.includes(ui.sel.id)) select(null);
      }
      break;
    }
  }
  endDrag();
}

// ---------- radial build menu ----------

function consumeOptions(g: Game, mats: MatId[]): RadialOpt[] {
  const opts: RadialOpt[] = [];
  const uses = (r: Recipe) => r.inputs.some((i) => mats.includes(i[0]));
  const recipes = Object.values(RECIPES).filter(uses);
  const open = recipes.filter((r) => recipeUnlocked(g, r)).sort((a, b) => MATERIALS[b.outputs[0][0]].value - MATERIALS[a.outputs[0][0]].value);
  for (const r of open.slice(0, 3)) {
    opts.push({ type: r.machine, recipe: r.id, label: `${NODE_DEFS[r.machine].name} → ${r.name}`, sub: NODE_DEFS[r.machine].verb, cost: nodeCost(g, r.machine), glyph: matGlyph(r.outputs[0][0], 26) });
  }
  const sink = (type: NodeType, sub: string) => {
    if (nodeUnlocked(g, type)) opts.push({ type, label: NODE_DEFS[type].name, sub, cost: nodeCost(g, type), glyph: type === 'market' ? '<span class="coin big">¢</span>' : nodeIcon(type, 26) });
  };
  const junk = mats.length > 0 && mats.every((m) => MATERIALS[m].value < 1);
  if (junk) {
    sink('void', 'destroy');
    sink('market', 'sell');
  } else {
    sink('market', 'sell');
    sink('lab', 'study');
    sink('void', 'destroy');
  }
  sink('router', 'split');
  sink('silo', 'store');
  const locked = recipes.find((r) => !recipeUnlocked(g, r));
  if (locked && opts.length < 8) {
    opts.push({ type: locked.machine, recipe: locked.id, label: `${NODE_DEFS[locked.machine].name} → ${locked.name}`, sub: '', cost: 0, locked: locked.tech, glyph: matGlyph(locked.outputs[0][0], 24) });
  }
  return opts.slice(0, 8);
}

function produceOptions(g: Game, m: MatId): RadialOpt[] {
  return Object.values(RECIPES)
    .filter((r) => r.outputs.some((o) => o[0] === m) && recipeUnlocked(g, r))
    .map((r) => ({ type: r.machine, recipe: r.id, label: `${NODE_DEFS[r.machine].name} → ${r.name}`, sub: 'make', cost: nodeCost(g, r.machine), glyph: matGlyph(r.outputs[0][0], 26) }));
}

/**
 * Angle of each slot, as a multiple of the step, measured from straight ahead (away from the wire).
 * Odd counts put the best option dead ahead and fan the rest out alternately; even counts straddle
 * the axis (±½, ±1½, …). Either way the fan is a mirror image about the drag direction and its two
 * ends are the slots furthest from the incoming wire's side.
 */
export function radialOffset(i: number, n: number): number {
  if (n % 2 === 1) return Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1);
  return (Math.floor(i / 2) + 0.5) * (i % 2 === 0 ? -1 : 1);
}

/** Angle between neighbouring slots. The whole fan never spans more than 300°, which keeps 60° clear around the wire. */
export const radialStep = (n: number) => (n <= 1 ? 0 : Math.min(Math.PI / 3, (Math.PI * 5) / 3 / (n - 1)));

function openRadial(state: RadialState) {
  radial = state;
  const g = ui.g;
  const n = state.opts.length;
  const R = n >= 6 ? 142 : 122;
  // Keep the whole menu on screen; the node is built wherever the menu ends up.
  const rect = rectOf();
  const raw = toScreen(state.at);
  const m = R + 58;
  const c = {
    x: Math.max(Math.min(m, rect.width / 2), Math.min(rect.width - Math.min(m, rect.width / 2), raw.x)),
    y: Math.max(Math.min(m, rect.height / 2), Math.min(rect.height - Math.min(m, rect.height / 2), raw.y)),
  };
  state.at = { x: (c.x - ui.view.x) / ui.view.k, y: (c.y - ui.view.y) / ui.view.k };
  const a = toScreen(state.a);
  hideTemp();
  const back = Math.atan2(a.y - c.y, a.x - c.x); // direction the wire comes from
  const fwd = back + Math.PI;
  const step = radialStep(n);
  const slots = state.opts
    .map((o, i) => {
      const ang = fwd + step * radialOffset(i, n);
      const x = Math.cos(ang) * R, y = Math.sin(ang) * R;
      const afford = !o.locked && o.cost <= g.credits + 1e-6;
      const cls = o.locked ? 'locked' : afford ? '' : 'poor';
      const price = o.locked ? `needs ${esc(TECHS[o.locked]?.name ?? o.locked)}` : o.cost === 0 ? 'free' : `${fmt(o.cost)}¢`;
      return `<button class="slot ${cls}${i === 0 && afford ? ' best' : ''}" data-act="pick:${i}" data-i="${i}" data-testid="radial-${o.type}${o.recipe ? '-' + o.recipe : ''}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px" ${o.locked ? 'disabled' : ''}>
        <span class="key mono">${i + 1}</span>${o.locked ? icon('lock', 14) : ''}${o.glyph}
        <span class="sn">${esc(o.label)}</span><span class="ss">${o.sub ? o.sub + ' · ' : ''}<span class="mono">${price}</span></span>
      </button>`;
    })
    .join('');
  const hub = state.mat
    ? `${matGlyph(state.mat, 20)}<span>${MATERIALS[state.mat].name}</span>`
    : `<span>Build</span>`;
  radialEl.innerHTML = `<div class="disc" style="width:${R * 2 + 130}px;height:${R * 2 + 130}px"></div>
    <svg class="lead" width="1" height="1"><line x1="0" y1="0" x2="${a.x - c.x}" y2="${a.y - c.y}" style="stroke:${matColor(state.mat)}"/></svg>
    <div class="hub">${hub}</div>${slots}`;
  radialEl.style.left = c.x + 'px';
  radialEl.style.top = c.y + 'px';
  radialEl.style.display = 'block';
}

export function closeRadial() {
  if (!radial) return;
  radial = null;
  radialEl.style.display = 'none';
  hideTemp();
}

export const radialOpen = () => !!radial;

export function pickRadial(i: number) {
  const r = radial;
  if (!r) return;
  const o = r.opts[i];
  if (!o || o.locked) return;
  const g = ui.g;
  if (o.cost > g.credits + 1e-6) {
    toast(`${NODE_DEFS[o.type].name} costs <b>${fmt(o.cost)}¢</b>`, 'bad');
    return;
  }
  let made: GNode | null = null;
  act(g, () => {
    const n = placeNode(g, o.type, 0, 0, { recipe: o.recipe });
    if (!n) return false;
    const { w, h } = nodeSize(n);
    const pos = freeSpot(r.dir === 'consume' ? r.at.x : r.at.x - w, r.at.y - h / 2, w, h, n.id);
    n.x = pos.x;
    n.y = pos.y;
    if (r.dir === 'consume') connect(g, r.from, r.port, n.id);
    else {
      const rec = recipeOf(n);
      const port = rec && r.mat ? Math.max(0, rec.outputs.findIndex((x) => x[0] === r.mat)) : 0;
      connect(g, n.id, port, r.to);
    }
    made = n;
    return 0;
  });
  closeRadial();
  if (made) {
    select({ kind: 'node', id: (made as GNode).id });
    signal('place', { id: (made as GNode).id, type: o.type });
  }
}

/** Close the build menu and abandon any drag in progress, leaving the board as it was before it started. */
export function cancelGesture() {
  if (radial) closeRadial();
  if (drag) abortDrag();
}

/**
 * Call before something other than the pointer changes the board (a keyboard shortcut, say):
 * a node that is still being dragged is dropped where it is, so its move becomes its own undo step
 * and cannot get mixed up with what happens next.
 */
export function settleGesture() {
  if (drag?.kind !== 'node') return;
  dropNode(drag);
  endDrag();
}

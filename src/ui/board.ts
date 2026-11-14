// The board: world rendering (DOM nodes + SVG wires) and every pointer gesture.
import { MATERIALS, MatId, NODE_DEFS, NodeType, PIPES, RECIPES, Recipe, TECHS } from '../content';
import {
  act, canConnect, connect, cutWires, expandBoard, freeDeposits, materialsAt, nodeById, placeNode, pushUndo, splice,
} from '../actions';
import {
  expansionCost, fmt, fmtRate, labRate, matUnlocked, nodeCost, nodeUnlocked, recipeOf, recipeUnlocked,
} from '../economy';
import { bagTotal, graph, isMachine, isSink, outPortCount, passCap } from '../sim';
import { Game, GNode, Snapshot, Wire, snap, snapshot } from '../state';
import {
  Pt, bezierAt, distToPolyline, inPorts, matColor, nodeSize, outPorts, pathD, samples, segmentsCross, wireEnds,
} from './geom';
import { esc, icon, matGlyph, nodeIcon } from './icons';
import { diagnose } from './status';
import { select, toast, touch, ui } from './ui';

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

let boardEl: HTMLElement;
let worldEl: HTMLElement;
let plotEl: HTMLElement;
let depositsEl: HTMLElement;
let wiresSvg: SVGSVGElement;
let nodesEl: HTMLElement;
let chipsEl: HTMLElement;
let overlaySvg: SVGSVGElement;
let floatEl: HTMLElement;
let ghostEl: HTMLElement;
let expandEl: HTMLButtonElement;
let radialEl: HTMLElement;
let tempPath: SVGPathElement;
let knifeLine: SVGLineElement;

interface NodeRefs { el: HTMLElement; ring: SVGCircleElement | null; rate: HTMLElement; sub: HTMLElement; pill: HTMLElement }
interface WireRefs { g: SVGGElement; base: SVGPathElement; dots: SVGPathElement; glow: SVGPathElement; chip: HTMLElement; phase: number; a: Pt; b: Pt }
const nodeEls = new Map<number, NodeRefs>();
const wireEls = new Map<number, WireRefs>();

let renderedRev = -1;
let renderedUi = -1;
let mouse: Pt = { x: 0, y: 0 };

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'node'; id: number; ox: number; oy: number; before: Snapshot; moved: boolean; sx: number; sy: number }
  | { kind: 'wire'; from: number; port: number; mats: MatId[]; a: Pt; target: number | null }
  | { kind: 'wireIn'; to: number; mat: MatId | null; b: Pt; target: number | null }
  | { kind: 'wirePress'; wireId: number; sx: number; sy: number }
  | { kind: 'knife'; a: Pt; b: Pt };
let drag: Drag | null = null;

interface RadialOpt { type: NodeType; recipe?: string; label: string; sub: string; cost: number; locked?: string; glyph: string }
interface RadialState { at: Pt; opts: RadialOpt[]; dir: 'consume' | 'produce'; from: number; port: number; to: number; mat: MatId | null; a: Pt }
let radial: RadialState | null = null;

// ---------- coordinates ----------

export function toWorld(cx: number, cy: number): Pt {
  const r = boardEl.getBoundingClientRect();
  return { x: (cx - r.left - ui.view.x) / ui.view.k, y: (cy - r.top - ui.view.y) / ui.view.k };
}

export function toScreen(p: Pt): Pt {
  return { x: p.x * ui.view.k + ui.view.x, y: p.y * ui.view.k + ui.view.y };
}

function applyView() {
  const { x, y, k } = ui.view;
  worldEl.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  boardEl.style.backgroundSize = `${24 * k}px ${24 * k}px`;
  boardEl.style.backgroundPosition = `${x}px ${y}px`;
  boardEl.classList.toggle('far', k < 0.6);
}

export function fitView() {
  const r = boardEl.getBoundingClientRect();
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
  const r = boardEl.getBoundingClientRect();
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
  const r = boardEl.getBoundingClientRect();
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
  const r = boardEl.getBoundingClientRect();
  const px = (cx ?? r.left + r.width / 2) - r.left;
  const py = (cy ?? r.top + r.height / 2) - r.top;
  const k = Math.max(0.3, Math.min(2, ui.view.k * factor));
  const f = k / ui.view.k;
  ui.view.x = px - (px - ui.view.x) * f;
  ui.view.y = py - (py - ui.view.y) * f;
  ui.view.k = k;
  applyView();
}

export const boardRect = () => boardEl.getBoundingClientRect();

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
      <svg id="overlay" width="1" height="1"><path id="temp-wire"></path><line id="knife"></line></svg>
      <div id="ghost"></div>
      <div id="floaters"></div>
      <button id="expand" data-testid="expand"></button>
    </div>
    <div id="radial"></div>`;
  worldEl = boardEl.querySelector('#world')!;
  plotEl = boardEl.querySelector('#plot')!;
  depositsEl = boardEl.querySelector('#deposits')!;
  wiresSvg = boardEl.querySelector('#wires')!;
  nodesEl = boardEl.querySelector('#nodes')!;
  chipsEl = boardEl.querySelector('#chips')!;
  overlaySvg = boardEl.querySelector('#overlay')!;
  floatEl = boardEl.querySelector('#floaters')!;
  ghostEl = boardEl.querySelector('#ghost')!;
  expandEl = boardEl.querySelector('#expand')!;
  radialEl = boardEl.querySelector('#radial')!;
  tempPath = boardEl.querySelector('#temp-wire')!;
  knifeLine = boardEl.querySelector('#knife')!;

  boardEl.addEventListener('pointerdown', onDown);
  boardEl.addEventListener('pointermove', onMove);
  boardEl.addEventListener('pointerup', onUp);
  boardEl.addEventListener('pointercancel', () => endDrag());
  boardEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (radial) closeRadial();
    zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });
  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
  expandEl.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (!expandBoard(ui.g)) toast(`Expanding costs <b>${fmt(expansionCost(ui.g))}¢</b>`, 'bad');
    else toast('Board expanded. New deposits revealed.', 'good');
  });
  applyView();
}

// ---------- structure render ----------

function recipeText(r: Recipe): string {
  const side = (xs: [MatId, number][]) => xs.map(([m, q]) => `${q > 1 ? q + ' ' : ''}${MATERIALS[m].name}`).join(' + ');
  return `${side(r.inputs)} → ${side(r.outputs)}`;
}

function nodeTitle(n: GNode): string {
  if (n.type === 'well' && n.material) return `${MATERIALS[n.material].name} Well`;
  return NODE_DEFS[n.type].name;
}

function nodeSub(g: Game, n: GNode): string {
  switch (n.type) {
    case 'well': return `Lv ${n.lv.speed} · deposit`;
    case 'refiner': case 'assembler': case 'fabricator': {
      const r = recipeOf(n);
      return r ? recipeText(r) : 'no recipe';
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

function buildNode(g: Game, n: GNode): NodeRefs {
  const { w, h } = nodeSize(n);
  const hasRing = n.type === 'well' || isMachine(n);
  const compact = w < 160;
  const e = el(`
    <div class="node t-${n.type}${compact ? ' compact' : ''}" data-id="${n.id}" data-testid="node-${n.type}"
         style="left:${n.x}px;top:${n.y}px;width:${w}px;height:${h}px">
      <div class="ring${hasRing ? '' : ' flat'}">
        ${hasRing ? `<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="17" class="trk"/><circle cx="20" cy="20" r="17" class="val" pathLength="100" transform="rotate(-90 20 20)"/></svg>` : ''}
        <div class="glyph">${nodeGlyph(n)}</div>
      </div>
      <div class="txt"><div class="nt">${esc(nodeTitle(n))}</div><div class="ns">${esc(nodeSub(g, n))}</div><div class="nr mono"></div></div>
      <span class="pill"></span>
    </div>`);
  const sel = ui.sel?.kind === 'node' && ui.sel.id === n.id;
  if (sel) e.classList.add('sel');
  for (const p of inPorts(n)) {
    const c = n.type === 'market' ? '#FFC857' : n.type === 'lab' ? '#C4A1FF' : matColor(p.mat);
    e.appendChild(el(`<span class="port in" data-in="${p.index}" ${p.mat ? `data-mat="${p.mat}"` : ''} style="top:${p.y - n.y}px;background:${c}"></span>`));
  }
  const outs = outPorts(g, n);
  const outWires = graph(g).outs.get(n.id) ?? [];
  for (const p of outs) {
    const open = !(outWires[p.index]?.length);
    e.appendChild(el(`<span class="port out${open ? ' open' : ''}" data-out="${p.index}" data-testid="port-out" style="top:${p.y - n.y}px;background:${matColor(p.mat)}"></span>`));
    if (outs.length > 1 && p.mat) e.appendChild(el(`<span class="port-label" style="top:${p.y - n.y}px">${MATERIALS[p.mat].name}</span>`));
  }
  return {
    el: e,
    ring: e.querySelector<SVGCircleElement>('.val'),
    rate: e.querySelector('.nr')!,
    sub: e.querySelector('.ns')!,
    pill: e.querySelector('.pill')!,
  };
}

function buildWire(g: Game, w: Wire): WireRefs | null {
  const ends = wireEnds(g, w);
  if (!ends) return null;
  const d = pathD(ends.a, ends.b);
  const grp = svgEl('g', { class: 'wire', 'data-id': String(w.id) });
  if (ui.sel?.kind === 'wire' && ui.sel.id === w.id) grp.classList.add('sel');
  const hit = svgEl('path', { d, class: 'hit' });
  const glow = svgEl('path', { d, class: 'glow' });
  const base = svgEl('path', { d, class: 'base' });
  const dots = svgEl('path', { d, class: 'dots' });
  grp.append(hit, glow, base, dots);
  const mid = bezierAt(ends.a, ends.b, 0.5);
  const chip = el(`<span class="chip mono" style="left:${mid.x}px;top:${mid.y}px"></span>`);
  return { g: grp, base, dots, glow, chip, phase: wireEls.get(w.id)?.phase ?? 0, a: ends.a, b: ends.b };
}

function renderStructure() {
  const g = ui.g;
  plotEl.style.width = g.board.w + 'px';
  plotEl.style.height = g.board.h + 'px';
  plotEl.querySelector('#plot-label')!.textContent = `Board · ${g.board.expansions + 1} plot${g.board.expansions ? 's' : ''}`;

  const used = new Set(g.nodes.map((n) => n.depositId));
  depositsEl.innerHTML = g.deposits
    .filter((d) => !used.has(d.id))
    .map((d) => {
      const ok = matUnlocked(g, d.mat);
      return `<div class="deposit${ok ? '' : ' locked'}" data-dep="${d.id}" style="left:${d.x}px;top:${d.y}px;${ok ? `--c:${MATERIALS[d.mat].color}` : ''}">
        ${ok ? matGlyph(d.mat, 18) : icon('lock', 16)}
        <div><div class="dn">${ok ? MATERIALS[d.mat].name + ' deposit' : 'Unknown deposit'}</div><div class="ds">${ok ? 'empty · place a Well' : 'needs research'}</div></div>
      </div>`;
    })
    .join('');

  nodesEl.textContent = '';
  nodeEls.clear();
  for (const n of g.nodes) {
    const refs = buildNode(g, n);
    nodeEls.set(n.id, refs);
    nodesEl.appendChild(refs.el);
  }

  wiresSvg.textContent = '';
  chipsEl.textContent = '';
  const old = new Map(wireEls);
  wireEls.clear();
  for (const w of g.wires) {
    const refs = buildWire(g, w);
    if (!refs) continue;
    refs.phase = old.get(w.id)?.phase ?? 0;
    wireEls.set(w.id, refs);
    wiresSvg.appendChild(refs.g);
    chipsEl.appendChild(refs.chip);
  }

  expandEl.style.left = g.board.w / 2 - 130 + 'px';
  expandEl.style.top = g.board.h + 18 + 'px';
  updateSlow();
}

function relayoutWires() {
  const g = ui.g;
  for (const w of g.wires) {
    const refs = wireEls.get(w.id);
    const ends = wireEnds(g, w);
    if (!refs || !ends) continue;
    const d = pathD(ends.a, ends.b);
    for (const p of refs.g.children) p.setAttribute('d', d);
    const mid = bezierAt(ends.a, ends.b, 0.5);
    refs.chip.style.left = mid.x + 'px';
    refs.chip.style.top = mid.y + 'px';
    refs.a = ends.a;
    refs.b = ends.b;
  }
}

// ---------- per-frame + slow updates ----------

function rateLine(g: Game, n: GNode): string {
  switch (n.type) {
    case 'well': return `${fmtRate(n.rate)}/s`;
    case 'refiner': case 'assembler': case 'fabricator':
      return n.recipe ? `${fmtRate(n.rate)}/s · ${Math.round(n.util * 100)}%` : 'pick a recipe';
    case 'silo': return `${Math.round(bagTotal(n.inb))} stored`;
    case 'market': return `${fmtRate(n.rate)}/s sold`;
    case 'lab': return `${fmtRate(n.rate)} / ${fmtRate(labRate(g, n))} /s`;
    default: return `${fmtRate(n.rate)}/s`;
  }
}

/** Text, rings, pills, wire widths: things that only need refreshing a few times a second. */
export function updateSlow() {
  const g = ui.g;
  for (const n of g.nodes) {
    const refs = nodeEls.get(n.id);
    if (!refs) continue;
    refs.rate.textContent = rateLine(g, n);
    if (refs.ring) refs.ring.style.strokeDasharray = `${Math.round(n.util * 100)} 100`;
    const dx = diagnose(g, n);
    let st: string = n.status;
    let pill = '';
    if (dx.problem === 'blocked') pill = dx.victim ? '' : 'BLOCKED';
    else if (dx.problem === 'starved') pill = dx.victim ? '' : 'STARVED';
    else if (dx.problem === 'idle') pill = 'IDLE';
    if (dx.problem && dx.victim) st = 'victim';
    if (refs.el.dataset.st !== st) refs.el.dataset.st = st;
    if (refs.pill.textContent !== pill) refs.pill.textContent = pill;
    refs.pill.dataset.kind = pill.toLowerCase();
  }
  for (const w of g.wires) {
    const refs = wireEls.get(w.id);
    if (!refs) continue;
    const cap = PIPES[w.tier].cap;
    const flowing = w.rate > 0.015;
    const sat = w.rate >= cap * 0.97;
    const color = matColor(w.mat ?? materialsAt(g, w.from, w.port)[0] ?? null);
    const width = 2 + Math.min(5, w.rate * 1.1);
    refs.g.style.color = color;
    refs.base.style.strokeWidth = width + 'px';
    refs.dots.style.strokeWidth = width + 3 + 'px';
    refs.glow.style.strokeWidth = width + 10 + 'px';
    refs.g.classList.toggle('stalled', !flowing);
    refs.g.classList.toggle('sat', sat);
    const src = nodeById(g, w.from);
    const weight = src?.type === 'router' && src.mode === 'ratio' ? `×${w.weight} · ` : '';
    refs.chip.textContent = flowing ? `${weight}${fmtRate(w.rate)}/s${sat ? ' MAX' : ''}` : `${weight}0/s`;
    refs.chip.classList.toggle('sat', sat);
    refs.chip.classList.toggle('stalled', !flowing);
  }
  const cost = expansionCost(g);
  expandEl.innerHTML = `${icon('plus', 20)}<span><b>Expand board <i class="mono">${fmt(cost)}¢</i></b><small>New plot · reveals deposits</small></span>`;
  expandEl.classList.toggle('ok', g.credits >= cost);
}

let floatTimer = 0;

export function updateBoard(dt: number) {
  const g = ui.g;
  if (g.rev !== renderedRev || ui.uiRev !== renderedUi) {
    renderedRev = g.rev;
    renderedUi = ui.uiRev;
    renderStructure();
    boardEl.classList.toggle('placing', !!ui.placing);
    updateGhost();
  }
  if (!g.paused) {
    for (const w of g.wires) {
      const refs = wireEls.get(w.id);
      if (!refs || w.rate <= 0.015) continue;
      refs.phase = (refs.phase + Math.min(170, 26 + 44 * w.rate) * dt) % 1400;
      refs.dots.style.strokeDashoffset = String(-refs.phase);
    }
    floatTimer += dt;
    if (floatTimer >= 1) {
      floatTimer = 0;
      for (const n of g.nodes) {
        if (n.type === 'market' && n.gain >= 0.05) floater(n, `+${fmt(n.gain)}¢`, '#FFC857');
        n.gain = 0;
        if (n.type === 'lab') {
          const parts: string[] = [];
          if ((n.gainB.a ?? 0) >= 0.05) parts.push(`+${fmt(n.gainB.a!)}α`);
          if ((n.gainB.b ?? 0) >= 0.05) parts.push(`+${fmt(n.gainB.b!)}β`);
          if ((n.gainB.g ?? 0) >= 0.05) parts.push(`+${fmt(n.gainB.g!)}γ`);
          if (parts.length) floater(n, parts.join(' '), '#C4A1FF');
          n.gainB = {};
        }
      }
    }
  }
}

function floater(n: GNode, text: string, color: string) {
  if (floatEl.children.length > 40) return;
  const { w } = nodeSize(n);
  const f = el(`<span class="floater mono" style="left:${n.x + w / 2 + (Math.random() * 40 - 20)}px;top:${n.y - 6}px;color:${color}">${text}</span>`);
  floatEl.appendChild(f);
  setTimeout(() => f.remove(), 900);
}

// ---------- placement ----------

function nearestDeposit(p: Pt) {
  let best: { d: ReturnType<typeof freeDeposits>[number]; dist: number } | null = null;
  for (const d of freeDeposits(ui.g)) {
    const dist = Math.hypot(d.x + 86 - p.x, d.y + 36 - p.y);
    if (!best || dist < best.dist) best = { d, dist };
  }
  return best?.d ?? null;
}

function clampToBoard(x: number, y: number, w: number, h: number): Pt {
  const b = ui.g.board;
  return { x: snap(Math.max(20, Math.min(b.w - w - 20, x))), y: snap(Math.max(20, Math.min(b.h - h - 20, y))) };
}

function updateGhost() {
  const p = ui.placing;
  if (!p) {
    ghostEl.style.display = 'none';
    return;
  }
  const g = ui.g;
  const w = p.type === 'router' || p.type === 'merger' || p.type === 'void' ? 136 : 172;
  const h = p.type === 'router' || p.type === 'merger' || p.type === 'void' ? 60 : 72;
  let pos = clampToBoard(mouse.x - w / 2, mouse.y - h / 2, w, h);
  let ok = nodeCost(g, p.type) <= g.credits + 1e-6;
  let label = NODE_DEFS[p.type].name;
  if (p.type === 'well') {
    const d = nearestDeposit(mouse);
    if (d) {
      pos = { x: d.x, y: d.y };
      label = `${MATERIALS[d.mat].name} Well`;
    } else {
      ok = false;
      label = 'No free deposit';
    }
  }
  ghostEl.style.display = 'flex';
  ghostEl.style.left = pos.x + 'px';
  ghostEl.style.top = pos.y + 'px';
  ghostEl.style.width = w + 'px';
  ghostEl.style.height = h + 'px';
  ghostEl.classList.toggle('bad', !ok);
  ghostEl.innerHTML = `${nodeIcon(p.type, 20)}<span>${label}<small class="mono">${ok ? fmt(nodeCost(g, p.type)) + '¢ · click to place' : p.type === 'well' && !nearestDeposit(mouse) ? 'expand the board' : 'not enough credits'}</small></span>`;
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

function wireNear(p: Pt, maxDist: number): Wire | null {
  let best: Wire | null = null;
  let bestD = maxDist;
  for (const w of ui.g.wires) {
    const refs = wireEls.get(w.id);
    if (!refs) continue;
    const d = distToPolyline(p, samples(refs.a, refs.b, 20));
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
    const w = pl.type === 'router' || pl.type === 'merger' || pl.type === 'void' ? 136 : 172;
    const pos = clampToBoard(p.x - w / 2, p.y - 36, w, 72);
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
}

// ---------- pointer gestures ----------

function nodeAtPoint(cx: number, cy: number): number | null {
  const hit = document.elementFromPoint(cx, cy)?.closest<HTMLElement>('.node');
  return hit ? Number(hit.dataset.id) : null;
}

function setTemp(a: Pt | null, b?: Pt, color?: string) {
  if (!a || !b) {
    tempPath.style.display = 'none';
    return;
  }
  tempPath.style.display = '';
  tempPath.setAttribute('d', pathD(a, b));
  tempPath.style.stroke = color ?? '#9DB8FF';
}

function highlightTarget(id: number | null) {
  for (const [nid, refs] of nodeEls) refs.el.classList.toggle('target', nid === id);
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
  if (t.closest('#radial')) return;
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
    const id = Number(nodeEl.dataset.id);
    const port = Number(portOut.dataset.out);
    const n = nodeById(g, id)!;
    const a = outPorts(g, n)[port];
    drag = { kind: 'wire', from: id, port, mats: materialsAt(g, id, port), a, target: null };
    boardEl.classList.add('wiring');
    return;
  }
  if (portIn && nodeEl) {
    const id = Number(nodeEl.dataset.id);
    const n = nodeById(g, id)!;
    const b = inPorts(n)[Number(portIn.dataset.in)];
    drag = { kind: 'wireIn', to: id, mat: (portIn.dataset.mat as MatId) ?? null, b, target: null };
    boardEl.classList.add('wiring');
    return;
  }
  if (nodeEl) {
    const id = Number(nodeEl.dataset.id);
    const n = nodeById(g, id)!;
    drag = { kind: 'node', id, ox: p.x - n.x, oy: p.y - n.y, before: snapshot(g), moved: false, sx: e.clientX, sy: e.clientY };
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
      if (!n || n.type === 'well') {
        drag.moved = drag.moved || false;
        break;
      }
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
          refs.el.classList.add('dragging');
        }
        relayoutWires();
      }
      break;
    }
    case 'wirePress': {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) break;
      const w = g.wires.find((x) => x.id === (drag as { wireId: number }).wireId);
      const src = w && nodeById(g, w.from);
      if (!w || !src) {
        drag = null;
        break;
      }
      // Dragging off the middle of a wire branches a new one from the same port.
      drag = { kind: 'wire', from: w.from, port: w.port, mats: materialsAt(g, w.from, w.port), a: outPorts(g, src)[w.port], target: null };
      boardEl.classList.add('wiring');
      break;
    }
    case 'wire': {
      const over = nodeAtPoint(e.clientX, e.clientY);
      drag.target = over != null && canConnect(g, drag.from, drag.port, over) ? over : null;
      let end = p;
      if (drag.target != null) {
        const tn = nodeById(g, drag.target)!;
        const ins = inPorts(tn);
        end = ins.find((ip) => ip.mat && (drag as { mats: MatId[] }).mats.includes(ip.mat)) ?? ins[0] ?? p;
      }
      highlightTarget(drag.target);
      setTemp(drag.a, end, matColor(drag.mats[0] ?? null));
      break;
    }
    case 'wireIn': {
      const over = nodeAtPoint(e.clientX, e.clientY);
      const on = over != null ? nodeById(g, over) : null;
      drag.target = on && !isSink(on) && on.id !== drag.to ? over : null;
      let start = p;
      if (drag.target != null) start = outPorts(g, on!)[0] ?? p;
      highlightTarget(drag.target);
      setTemp(start, drag.b, matColor(drag.mat));
      break;
    }
    case 'knife': {
      drag.b = p;
      knifeLine.style.display = '';
      knifeLine.setAttribute('x1', String(drag.a.x));
      knifeLine.setAttribute('y1', String(drag.a.y));
      knifeLine.setAttribute('x2', String(p.x));
      knifeLine.setAttribute('y2', String(p.y));
      break;
    }
  }
}

function endDrag() {
  drag = null;
  boardEl.classList.remove('wiring');
  highlightTarget(null);
  if (!radial) setTemp(null);
  knifeLine.style.display = 'none';
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
    case 'node': {
      const n = nodeById(g, d.id);
      nodeEls.get(d.id)?.el.classList.remove('dragging');
      if (d.moved && n) {
        pushUndo(g, d.before);
        // Dropping a loose node on a wire splices it in.
        if (!g.wires.some((w) => w.from === n.id || w.to === n.id)) {
          const { w, h } = nodeSize(n);
          const over = wireNear({ x: n.x + w / 2, y: n.y + h / 2 }, 18);
          if (over) splice(g, over.id, n.id);
        }
        g.rev++;
      }
      select({ kind: 'node', id: d.id });
      break;
    }
    case 'wirePress':
      select({ kind: 'wire', id: d.wireId });
      break;
    case 'wire': {
      if (d.target != null) {
        const tn = nodeById(g, d.target)!;
        const w = connect(g, d.from, d.port, d.target);
        const r = recipeOf(tn);
        if (w && isMachine(tn) && r && d.mats.length && !r.inputs.some((i) => d.mats.includes(i[0]))) {
          toast(`This ${NODE_DEFS[tn.type].name} makes ${r.name} and does not use ${MATERIALS[d.mats[0]].name}`, 'bad');
        }
      } else if (Math.hypot(p.x - d.a.x, p.y - d.a.y) > 36 && nodeAtPoint(e.clientX, e.clientY) == null) {
        openRadial({ at: p, dir: 'consume', from: d.from, port: d.port, to: 0, mat: d.mats[0] ?? null, a: d.a, opts: consumeOptions(g, d.mats) });
        drag = null;
        boardEl.classList.remove('wiring');
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
        if (port < outPortCount(src)) connect(g, d.target, port, d.to);
      } else if (Math.hypot(p.x - d.b.x, p.y - d.b.y) > 36 && nodeAtPoint(e.clientX, e.clientY) == null) {
        const opts = d.mat ? produceOptions(g, d.mat) : [];
        if (!opts.length) toast(d.mat ? `Nothing you have unlocked makes ${MATERIALS[d.mat].name}. Wire a Well to it.` : 'Drag from an output port instead', 'bad');
        else {
          openRadial({ at: p, dir: 'produce', from: 0, port: 0, to: d.to, mat: d.mat, a: d.b, opts });
          drag = null;
          boardEl.classList.remove('wiring');
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
        const pts = samples(refs.a, refs.b, 20);
        for (let i = 0; i < pts.length - 1; i++) {
          if (segmentsCross(d.a, d.b, pts[i], pts[i + 1])) {
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

function openRadial(state: RadialState) {
  radial = state;
  const g = ui.g;
  const n = state.opts.length;
  const R = n >= 6 ? 142 : 122;
  // Keep the whole menu on screen; the node is built wherever the menu ends up.
  const rect = boardEl.getBoundingClientRect();
  const raw = toScreen(state.at);
  const m = R + 58;
  const c = {
    x: Math.max(Math.min(m, rect.width / 2), Math.min(rect.width - Math.min(m, rect.width / 2), raw.x)),
    y: Math.max(Math.min(m, rect.height / 2), Math.min(rect.height - Math.min(m, rect.height / 2), raw.y)),
  };
  state.at = { x: (c.x - ui.view.x) / ui.view.k, y: (c.y - ui.view.y) / ui.view.k };
  const a = toScreen(state.a);
  setTemp(null);
  const back = Math.atan2(a.y - c.y, a.x - c.x); // direction the wire comes from
  const fwd = back + Math.PI;
  const step = n <= 5 ? Math.PI / 3 : (Math.PI * 5) / 3 / (n - 1);
  // Best option straight ahead, the rest fanning out alternately to either side.
  const offset = (i: number) => {
    const side = i % 2 === 1 ? 1 : -1;
    const k = Math.ceil(i / 2) * side;
    return n % 2 === 0 ? k + 0.5 : k;
  };
  const slots = state.opts
    .map((o, i) => {
      const ang = fwd + step * offset(i);
      const x = Math.cos(ang) * R, y = Math.sin(ang) * R;
      const afford = !o.locked && o.cost <= g.credits + 1e-6;
      const cls = o.locked ? 'locked' : afford ? '' : 'poor';
      const price = o.locked ? `needs ${esc(TECHS[o.locked]?.name ?? o.locked)}` : o.cost === 0 ? 'free' : `${fmt(o.cost)}¢`;
      return `<button class="slot ${cls}${i === 0 && afford ? ' best' : ''}" data-i="${i}" data-testid="radial-${o.type}${o.recipe ? '-' + o.recipe : ''}" style="left:${x}px;top:${y}px" ${o.locked ? 'disabled' : ''}>
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
  radialEl.querySelectorAll<HTMLButtonElement>('.slot').forEach((b) =>
    b.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      pickRadial(Number(b.dataset.i));
    }),
  );
}

export function closeRadial() {
  if (!radial) return;
  radial = null;
  radialEl.style.display = 'none';
  setTemp(null);
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
    const pos = clampToBoard(r.dir === 'consume' ? r.at.x : r.at.x - w, r.at.y - h / 2, w, h);
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
  if (made) select({ kind: 'node', id: (made as GNode).id });
}

export function cancelGesture() {
  if (radial) closeRadial();
  if (drag) endDrag();
}

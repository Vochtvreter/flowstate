import { MATERIALS, MatId } from '../content';
import { materialsAt, nodeById } from '../actions';
import { recipeOf } from '../economy';
import { isMachine, isSink } from '../sim';
import { Game, GNode, Wire } from '../state';

export const NODE_W = 172;

export function nodeSize(n: GNode): { w: number; h: number } {
  if (isMachine(n)) {
    const r = recipeOf(n);
    const ports = r ? Math.max(r.inputs.length, r.outputs.length) : 1;
    return { w: NODE_W, h: ports >= 3 ? 112 : ports === 2 ? 92 : 72 };
  }
  if (n.type === 'router' || n.type === 'merger' || n.type === 'void') return { w: 136, h: 60 };
  return { w: NODE_W, h: 72 };
}

export interface Port { x: number; y: number; mat: MatId | null; index: number }

const spread = (h: number, count: number, i: number) => (h * (i + 1)) / (count + 1);

export function inPorts(n: GNode): Port[] {
  if (n.type === 'well') return [];
  const { h } = nodeSize(n);
  const r = isMachine(n) ? recipeOf(n) : null;
  if (r) return r.inputs.map(([m], i) => ({ x: n.x, y: n.y + spread(h, r.inputs.length, i), mat: m, index: i }));
  return [{ x: n.x, y: n.y + h / 2, mat: null, index: 0 }];
}

export function outPorts(g: Game, n: GNode): Port[] {
  if (isSink(n)) return [];
  const { w, h } = nodeSize(n);
  const r = isMachine(n) ? recipeOf(n) : null;
  if (r) return r.outputs.map(([m], i) => ({ x: n.x + w, y: n.y + spread(h, r.outputs.length, i), mat: m, index: i }));
  const mats = materialsAt(g, n.id, 0);
  return [{ x: n.x + w, y: n.y + h / 2, mat: mats[0] ?? null, index: 0 }];
}

export interface Pt { x: number; y: number }

export function wireEnds(g: Game, w: Wire): { a: Pt; b: Pt; mat: MatId | null } | null {
  const from = nodeById(g, w.from);
  const to = nodeById(g, w.to);
  if (!from || !to) return null;
  const outs = outPorts(g, from);
  const a = outs[Math.min(w.port, outs.length - 1)];
  if (!a) return null;
  const mats = materialsAt(g, w.from, w.port);
  const ins = inPorts(to);
  let b = ins[0];
  const match = ins.find((p) => p.mat && mats.includes(p.mat));
  if (match) b = match;
  if (!b) return null;
  return { a, b, mat: w.mat ?? mats[0] ?? null };
}

export function curve(a: Pt, b: Pt): [Pt, Pt, Pt, Pt] {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return [a, { x: a.x + dx, y: a.y }, { x: b.x - dx, y: b.y }, b];
}

export function pathD(a: Pt, b: Pt): string {
  const [p0, p1, p2, p3] = curve(a, b);
  return `M${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
}

export function bezierAt(a: Pt, b: Pt, t: number): Pt {
  const [p0, p1, p2, p3] = curve(a, b);
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

export function samples(a: Pt, b: Pt, n = 16): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push(bezierAt(a, b, i / n));
  return out;
}

export function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

export const matColor = (m: MatId | null) => (m ? MATERIALS[m].color : '#8C97AD');

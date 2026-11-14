import { MATERIALS, MatId } from '../content';
import { materialsAt } from '../actions';
import { recipeOf } from '../economy';
import { graph, isMachine, isPass } from '../sim';
import { Game, GNode } from '../state';

export type Problem = 'starved' | 'blocked' | 'idle' | null;

export interface Diagnosis {
  problem: Problem;
  /** True when the real cause is somewhere else in the line. */
  victim: boolean;
  mat: MatId | null;
  /** Node to jump to for the fix, when there is one. */
  culprit: number | null;
  /** The blocked output has no wire at all. */
  openPort: boolean;
}

function troubledDownstream(g: Game, id: number, port: number, depth = 0): number | null {
  if (depth > 6) return null;
  for (const w of graph(g).outs.get(id)?.[port] ?? []) {
    const d = graph(g).byId.get(w.to);
    if (!d) continue;
    if (isMachine(d) && (d.status === 'blocked' || d.status === 'idle' && !d.recipe)) return d.id;
    if (isPass(d)) {
      const deeper = troubledDownstream(g, d.id, 0, depth + 1);
      if (deeper != null) return deeper;
    }
  }
  return null;
}

function supplier(g: Game, id: number, m: MatId, depth = 0): GNode | null {
  if (depth > 6) return null;
  for (const w of graph(g).ins.get(id) ?? []) {
    if (!materialsAt(g, w.from, w.port).includes(m)) continue;
    const s = graph(g).byId.get(w.from);
    if (!s) continue;
    if (isPass(s)) {
      const deeper = supplier(g, s.id, m, depth + 1);
      if (deeper) return deeper;
    } else return s;
  }
  return null;
}

export function diagnose(g: Game, n: GNode): Diagnosis {
  const none: Diagnosis = { problem: null, victim: false, mat: null, culprit: null, openPort: false };
  if (n.status === 'working') return none;
  if (n.type === 'well') {
    if (n.status !== 'blocked') return none;
    const wired = (graph(g).outs.get(n.id)?.[0]?.length ?? 0) > 0;
    return { problem: 'blocked', victim: wired, mat: n.material, culprit: wired ? troubledDownstream(g, n.id, 0) : null, openPort: !wired };
  }
  if (!isMachine(n)) return none;
  const r = recipeOf(n);
  if (n.status === 'idle') return { ...none, problem: 'idle' };
  if (n.status === 'blocked' && r) {
    const mat = n.blockedOn ?? r.outputs[0][0];
    const port = Math.max(0, r.outputs.findIndex((o) => o[0] === mat));
    const wired = (graph(g).outs.get(n.id)?.[port]?.length ?? 0) > 0;
    const culprit = wired ? troubledDownstream(g, n.id, port) : null;
    return { problem: 'blocked', victim: culprit != null, mat, culprit, openPort: !wired };
  }
  if (n.status === 'starved' && r) {
    const mat = n.missing ?? r.inputs[0][0];
    const s = supplier(g, n.id, mat);
    const victim = !!s && isMachine(s) && s.status !== 'working';
    return { problem: 'starved', victim, mat, culprit: s?.id ?? null, openPort: false };
  }
  return none;
}

export const matName = (m: MatId | null) => (m ? MATERIALS[m].name : 'input');

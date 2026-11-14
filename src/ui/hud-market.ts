// The Market inspector: one demand gauge per material. Owned by the HUD track.
//
// A gauge is a single bar. Its fill is what is being sold per second; a tick marks how much the
// buyers take at full price. Whatever is past the tick sells cheap and is drawn striped. Under it,
// the same thing in words, and the income on the right.
import { MATERIALS, MAT_IDS, MatId } from '../content';
import { materialsAt } from '../actions';
import { demandInfo, fmt, fmtRate, has } from '../economy';
import { graph } from '../sim';
import { Game, GNode } from '../state';
import { matGlyph } from './icons';

/** A fraction for a style attribute, rounded so tiny changes do not count as new HTML. */
const frac = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;

function gauge(g: Game, m: MatId): string {
  const d = demandInfo(g, m);
  // The tick sits at five eighths of the bar until the surplus needs more room than that leaves.
  const max = Math.max(d.demand * 1.6, d.rate * 1.05, 1e-6);
  const line = frac(d.demand / max);
  const over = d.surplusRate > 0.02;
  const words = over
    ? `<b class="mono">${fmtRate(d.rate)}/s</b> sold · <span class="dg-warn"><span class="mono">${fmtRate(d.surplusRate)}/s</span> over</span>`
    : `<b class="mono">${fmtRate(d.rate)}/s</b> sold · all at full price`;
  return `<div class="dg${over ? ' over' : ''}" data-key="${m}" data-testid="demand-${m}">
    <div class="row sm"><span>${matGlyph(m, 12)} ${MATERIALS[m].name}</span><span class="mono dg-inc">+${fmtRate(d.income)}¢/s</span></div>
    <div class="dg-bar" style="--c:${MATERIALS[m].color}"><span class="dg-full" style="transform:scaleX(${frac(d.fullRate / max)})"></span><span class="dg-over" style="left:${line * 100}%;transform:scaleX(${frac(d.surplusRate / max)})"></span><i class="dg-line" style="left:${line * 100}%"></i></div>
    <div class="dg-cap">${words}</div>
    <div class="dg-cap">full price <span class="mono">${fmt(d.unitPrice)}¢</span> up to <span class="mono">${d.demand.toFixed(1)}/s</span>, then <span class="mono">${fmt(d.surplusPrice)}¢</span></div>
  </div>`;
}

/**
 * Gauges for what arrives at this Market. With Market Lens, every other material sold at any
 * Market is listed below them as well.
 */
export function marketSection(g: Game, n: GNode): string {
  const here = new Set<MatId>();
  for (const w of graph(g).ins.get(n.id) ?? []) for (const m of materialsAt(g, w.from, w.port)) here.add(m);
  const mine = MAT_IDS.filter((m) => here.has(m));
  const others = has(g, 'C1') ? MAT_IDS.filter((m) => !here.has(m) && (g.soldRate[m] ?? 0) > 0.005) : [];
  const bonus = demandInfo(g, 'glint').mult - 1;
  const flow = bonus > 0.005 ? `<span class="dg-flow mono">Flow +${Math.round(bonus * 100)}%</span>` : '';
  let html = `<div class="sec"><div class="row"><span class="lbl">Selling here</span>${flow}</div>
    ${mine.map((m) => gauge(g, m)).join('') || '<div class="note">Nothing arrives here yet. Wire something in to sell it.</div>'}
    <div class="note">Buyers pay full price up to the mark on each bar. Anything past it sells cheap, so a mix of materials earns more than a flood of one.</div></div>`;
  if (others.length) {
    html += `<div class="sec"><div class="row"><span class="lbl">At your other Markets</span><span class="dg-flow">Market Lens</span></div>${others.map((m) => gauge(g, m)).join('')}</div>`;
  }
  return html;
}

// The Market inspector: what sells here, and (once demand has ever mattered) one demand gauge per
// material. Part of the HUD.
//
// A gauge is a single bar. Its fill is what is being sold per second; a tick marks how much the
// buyers take at full price. Whatever is past the tick sells cheap and is drawn striped. Under it,
// the same thing in words, and the income on the right.
import { MATERIALS, MAT_IDS, MatId, TECHS } from '../content';
import { materialsAt } from '../actions';
import { demandInfo, demandShown, fmt, fmtRate, has } from '../economy';
import { graph } from '../sim';
import { Game, GNode } from '../state';
import { matGlyph } from './icons';

/** A fraction for a style attribute, rounded so tiny changes do not count as new HTML. */
const frac = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;

/**
 * What this Market itself sells: for each material, the items a second arriving on its own wires (a Market
 * sells whatever arrives). null when one of its wires carries a mix (a Router or Merger passing several
 * materials on): the wire's rate cannot be told apart by material then.
 */
function soldHere(g: Game, n: GNode): Map<MatId, number> | null {
  const out = new Map<MatId, number>();
  for (const w of graph(g).ins.get(n.id) ?? []) {
    const mats = materialsAt(g, w.from, w.port);
    if (mats.length > 1) return null;
    if (mats.length === 1) out.set(mats[0], (out.get(mats[0]) ?? 0) + w.rate);
  }
  return out;
}

/** `here`: this Market's own share of the sales, when the board has several Markets and it can be told. */
function gauge(g: Game, m: MatId, here?: number): string {
  const d = demandInfo(g, m);
  // The tick sits at five eighths of the bar until the surplus needs more room than that leaves.
  const max = Math.max(d.demand * 1.6, d.rate * 1.05, 1e-6);
  const line = frac(d.demand / max);
  const over = d.surplusRate > 0.02;
  const words = over
    ? `<b class="mono">${fmtRate(d.rate)}/s</b> sold · <span class="dg-warn"><span class="mono">${fmtRate(d.surplusRate)}/s</span> over</span>`
    : `<b class="mono">${fmtRate(d.rate)}/s</b> sold · all at full price`;
  // (A wire's rate and the sales figure are smoothed apart; "here" is never shown as more than was sold.)
  const mine = here != null ? ` · <span class="mono" data-testid="here-${m}">${fmtRate(Math.min(here, d.rate))}/s</span> of it here` : '';
  return `<div class="dg${over ? ' over' : ''}" data-key="${m}" data-testid="demand-${m}">
    <div class="row sm"><span>${matGlyph(m, 12)} ${MATERIALS[m].name}</span><span class="mono dg-inc">+${fmtRate(d.income)}¢/s</span></div>
    <div class="dg-bar" style="--c:${MATERIALS[m].color}"><span class="dg-full" style="transform:scaleX(${frac(d.fullRate / max)})"></span><span class="dg-over" style="left:${line * 100}%;transform:scaleX(${frac(d.surplusRate / max)})"></span><i class="dg-line" style="left:${line * 100}%"></i></div>
    <div class="dg-cap">${words}${mine}</div>
    <div class="dg-cap">full price <span class="mono">${fmt(d.unitPrice)}¢</span> up to <span class="mono">${d.demand.toFixed(1)}/s</span>, then <span class="mono">${fmt(d.surplusPrice)}¢</span></div>
  </div>`;
}

/**
 * One plain line: the material, how much of it sells and for what, and what that earns. With `here` the line
 * is this Market's own sales; without, what all Markets sell of it.
 */
function plain(g: Game, m: MatId, here?: number): string {
  const d = demandInfo(g, m);
  const rate = here ?? d.rate;
  // (Before demand has shown itself everything sells at full price, give or take a burst: the plain sum.)
  const income = here != null ? here * d.unitPrice * d.mult : d.income;
  return `<div class="mrow" data-key="${m}" data-testid="sell-${m}"><span class="mr-name">${matGlyph(m, 12)} ${MATERIALS[m].name}</span><span class="mono mr-rate">${fmtRate(rate)}/s · ${fmt(d.unitPrice)}¢ each</span><span class="mono dg-inc">+${fmtRate(income)}¢/s</span></div>`;
}

/**
 * What a Market sells. With one Market on the board that is simply what is sold. With several, the plain
 * rows are this Market's own sales, read from its wires (or, when a wire carries a mix that cannot be told
 * apart, every Market's sales together, and the heading says so).
 *
 * Demand (full price up to a rate, a quarter beyond it) is only shown once it has shown itself: until
 * something has sold over its demand for the first time (demandShown, raised with the 'surplus' event) a
 * material is one plain line, with no gauge and no word about limits. From then on each material is a
 * gauge. Buyers are shared by all Markets, so a gauge always counts every Market's sales (its heading says
 * so when there is more than one Market, and each gauge adds how much of it is sold here). With Market Lens,
 * every other material sold at any Market is listed below as well.
 */
export function marketSection(g: Game, n: GNode): string {
  const here = new Set<MatId>();
  for (const w of graph(g).ins.get(n.id) ?? []) for (const m of materialsAt(g, w.from, w.port)) here.add(m);
  const mine = MAT_IDS.filter((m) => here.has(m));
  const shown = demandShown(g);
  const several = g.nodes.reduce((c, x) => c + (x.type === 'market' ? 1 : 0), 0) > 1;
  const own = several ? soldHere(g, n) : null;
  // What the numbers count: this Market alone, or all of them.
  const all = several && (shown || !own);
  const others = has(g, 'C1') ? MAT_IDS.filter((m) => !here.has(m) && (g.soldRate[m] ?? 0) > 0.005) : [];
  const bonus = demandInfo(g, 'glint').mult - 1;
  const flow = bonus > 0.005 ? `<span class="dg-flow mono">Flow +${Math.round(bonus * 100)}%</span>` : '';
  const row = (m: MatId) => (shown ? gauge(g, m, own?.get(m)) : plain(g, m, own?.get(m)));
  const note = !shown ? '' : `<div class="note">${several ? 'All your Markets share the same buyers: a bar counts what they sell together. ' : ''}Buyers pay full price up to the mark on each bar. Anything past it sells cheap, so a mix of materials earns more than a flood of one.</div>`;
  let html = `<div class="sec" data-testid="${shown ? 'market-gauges' : 'market-plain'}" data-scope="${all ? 'all' : 'here'}"><div class="row"><span class="lbl">${all ? 'Sold at all Markets' : 'Selling here'}</span>${flow}</div>
    ${mine.map(row).join('') || '<div class="note">Nothing arrives here yet. Wire something in to sell it.</div>'}
    ${note}</div>`;
  if (others.length) {
    html += `<div class="sec"><div class="row"><span class="lbl">At your other Markets</span><span class="dg-flow">${TECHS.C1?.name ?? ''}</span></div>${others.map((m) => (shown ? gauge(g, m) : plain(g, m))).join('')}</div>`;
  }
  return html;
}

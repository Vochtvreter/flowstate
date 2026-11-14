// Full-screen tech tree overlay.
import { BRANCHES, DATA_COLORS, DATA_NAMES, DataTier, TECHS, Tech } from '../content';
import { costText, fmtInt, fmtRate, fmtTime, research, techAffordable, techAvailable, techEta, techProgress } from '../economy';
import { Panel, makePanel } from './dom';
import { esc, icon } from './icons';
import { delegate, touch, ui } from './ui';

let host: HTMLElement;
let panel: Panel;
const COL0 = 150, COLW = 136, TILE_W = 124, TILE_H = 54, ROW_H = 66, LANE_GAP = 26, TOP = 96;

function laneTops(): Record<string, number> {
  const tops: Record<string, number> = {};
  let y = TOP;
  for (const b of BRANCHES) {
    tops[b.id] = y;
    y += b.rows * ROW_H + LANE_GAP;
  }
  tops._end = y;
  return tops;
}

const pos = (t: Tech, tops: Record<string, number>) => ({ x: COL0 + t.col * COLW, y: tops[t.branch] + t.row * ROW_H });

type TState = 'own' | 'rdy' | 'sav' | 'lck';

/** A percentage for a style attribute, rounded so tiny changes do not count as new HTML. */
const pct = (frac: number) => Math.round(Math.max(0, Math.min(1, frac)) * 1000) / 10;

function stateOf(t: Tech): TState {
  const g = ui.g;
  if (g.techs.includes(t.id)) return 'own';
  if (!techAvailable(g, t)) return 'lck';
  return techAffordable(g, t) ? 'rdy' : 'sav';
}

export function initTech(el: HTMLElement) {
  host = el;
  panel = makePanel(host);
  delegate(host, (a, args) => {
    const g = ui.g;
    if (a === 'close') closeTech();
    else if (a === 'sel') {
      ui.techSel = args[0];
    } else if (a === 'research') doResearch(args[0]);
    else if (a === 'queue') {
      const id = args[0];
      if (g.queue.includes(id)) g.queue = g.queue.filter((q) => q !== id);
      else g.queue.push(id);
    }
    renderTech(true); // answer the press at once, even though the pointer is still down in here
  });
}

function doResearch(id: string) {
  research(ui.g, id); // the unlock toast comes from the game event
}

export function openTech(id?: string) {
  ui.techOpen = true;
  if (id && TECHS[id]) ui.techSel = id;
  if (!ui.techSel) ui.techSel = Object.values(TECHS).find((t) => stateOf(t) === 'rdy' || stateOf(t) === 'sav')?.id ?? 'P1';
  host.classList.add('open');
  renderTech(true);
  touch();
}

export function closeTech() {
  ui.techOpen = false;
  host.classList.remove('open');
  touch();
}

function tile(t: Tech, tops: Record<string, number>): string {
  const g = ui.g;
  const st = stateOf(t);
  const p = pos(t, tops);
  let sub = '';
  if (st === 'own') sub = `${icon('check', 11)}Owned`;
  else if (t.auto) sub = `${icon('lock', 11)}${esc(t.auto)}`;
  else if (st === 'rdy') sub = `<span class="mono">${costText(t)} · ready</span>`;
  else if (st === 'sav') {
    const eta = techEta(g, t);
    sub = `<span class="mono">${costText(t)}${isFinite(eta) ? ' · ' + fmtTime(eta) : ''}</span>`;
  } else sub = `${icon('lock', 11)}<span class="mono">${costText(t)}</span>`;
  const queued = g.queue.includes(t.id) ? ' queued' : '';
  return `<button class="tt ${st}${ui.techSel === t.id ? ' sel' : ''}${queued}" data-act="sel:${t.id}" data-testid="tech-${t.id}" style="left:${p.x}px;top:${p.y}px">
    <span class="n">${esc(t.name)}${t.auto ? ' ★' : ''}</span><span class="c">${sub}</span>
    ${st === 'sav' ? `<span class="pb" style="width:${pct(techProgress(g, t))}%"></span>` : ''}</button>`;
}

function edges(tops: Record<string, number>): string {
  const g = ui.g;
  let out = '';
  for (const t of Object.values(TECHS)) {
    for (const rid of t.requires) {
      const r = TECHS[rid];
      if (!r || r.branch !== t.branch) continue;
      const a = pos(r, tops), b = pos(t, tops);
      const x1 = a.x + TILE_W, y1 = a.y + TILE_H / 2, x2 = b.x, y2 = b.y + TILE_H / 2;
      const mx = (x1 + x2) / 2;
      const cls = g.techs.includes(t.id) ? 'eo' : g.techs.includes(rid) ? 'er' : 'el';
      out += `<path d="M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" class="e ${cls}"/>`;
    }
  }
  return out;
}

function detail(t: Tech): string {
  const g = ui.g;
  const st = stateOf(t);
  const costs = (Object.keys(t.cost) as DataTier[]).map((k) => {
    const c = t.cost[k]!;
    const have = g.data[k];
    const ok = have >= c;
    const eta = ok ? '✓' : g.dataRate[k] > 1e-6 ? fmtTime((c - have) / g.dataRate[k]) : 'no income';
    return `<div><div class="row sm"><b style="color:${DATA_COLORS[k]}">${c}${DATA_NAMES[k]}</b><span class="mono muted">${fmtInt(Math.min(have, 1e9))} / ${c} · ${eta}</span></div>
      <div class="bar"><span style="width:${pct(have / c)}%;background:${DATA_COLORS[k]}"></span></div></div>`;
  }).join('');
  const reqs = t.requires.map((r) => {
    const own = g.techs.includes(r);
    return `<button class="req${own ? ' own' : ''}" data-act="sel:${r}">${icon(own ? 'check' : 'lock', 12)}${esc(TECHS[r].name)}</button>`;
  }).join('');
  let action = '';
  if (st === 'own') action = `<div class="owned">${icon('check', 16)}Researched</div>`;
  else if (t.auto) action = `<div class="note">Unlocks by itself: <b>${esc(t.auto)}</b>.</div>`;
  else {
    const queued = g.queue.includes(t.id);
    const eta = techEta(g, t);
    const label = st === 'rdy' ? 'Research' : st === 'sav' ? (isFinite(eta) ? `Ready in ${fmtTime(eta)}` : 'Not enough Data') : 'Locked: research the requirements first';
    action = `<label class="qbox" data-act="queue:${t.id}"><span class="cb${queued ? ' on' : ''}">${queued ? icon('check', 12) : ''}</span>Research automatically when affordable</label>
      <button class="rbtn${st === 'rdy' ? ' ok' : ''}" data-act="research:${t.id}" data-testid="research" ${st === 'rdy' ? '' : 'disabled'}>
        ${st === 'sav' ? `<span class="fill" style="width:${pct(techProgress(g, t))}%"></span>` : ''}<span class="lab">${label}</span></button>`;
  }
  const branch = BRANCHES.find((b) => b.id === t.branch)!;
  return `<div class="dsec"><span class="tag">${branch.name}</span><h2>${esc(t.name)}</h2><p>${esc(t.desc)}</p></div>
    <div class="dsec"><span class="lbl">Unlocks</span><ul>${t.unlocks.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div>
    ${reqs ? `<div class="dsec"><span class="lbl">Requires</span><div class="reqs">${reqs}</div></div>` : ''}
    ${costs ? `<div class="dsec costs"><span class="lbl">Cost</span>${costs}</div>` : ''}
    <div class="grow"></div><div class="dsec last">${action}</div>`;
}

/**
 * Draw the overlay. The HTML is patched into the existing elements (so the tree keeps its scroll
 * position and a finger can keep scrolling it); `force` is for the refresh right after a press.
 */
export function renderTech(force = false) {
  if (!ui.techOpen) return;
  const g = ui.g;
  const tops = laneTops();
  const sel = TECHS[ui.techSel ?? 'P1'] ?? TECHS.P1;
  const lanes = BRANCHES.map((b) => {
    const all = Object.values(TECHS).filter((t) => t.branch === b.id);
    const own = all.filter((t) => g.techs.includes(t.id)).length;
    return `<div class="lane" style="top:${tops[b.id]}px"><div class="h">${b.name}</div><div class="s">${own} / ${all.length} owned</div><div class="s dim">${b.sub}</div></div>
      <div class="lsep" style="top:${tops[b.id] - LANE_GAP / 2}px"></div>`;
  }).join('');
  const width = COL0 + 6 * COLW + TILE_W + 20;
  panel.render(`
    <div class="tree"><div class="treein" style="width:${width}px;height:${tops._end + 30}px">
      <div class="thead"><div><h1>Tech Tree</h1><p>Spend Data from your Labs. The board keeps running behind this screen.</p></div>
        <div class="legend"><span><i class="own"></i>Owned</span><span><i class="rdy"></i>Ready</span><span><i class="sav"></i>Saving up</span><span><i class="lck"></i>Locked</span></div></div>
      ${lanes}
      <svg class="edges" width="${width}" height="${tops._end}">${edges(tops)}</svg>
      ${Object.values(TECHS).map((t) => tile(t, tops)).join('')}
    </div></div>
    <aside class="tdetail">
      <div class="tbar"><div class="tdata">${(['a', 'b', 'g'] as DataTier[]).map((k) => `<span style="color:${DATA_COLORS[k]}"><b class="mono">${fmtInt(g.data[k])}</b>${DATA_NAMES[k]} <i class="mono">+${fmtRate(g.dataRate[k])}/s</i></span>`).join('')}</div>
        <button class="closebtn" data-act="close" data-testid="close-tech">Back to board <span class="kbd">Esc</span></button></div>
      ${detail(sel)}
    </aside>`, force);
}

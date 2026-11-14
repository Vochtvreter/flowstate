// Top bar, hotbar, inspector, objective line, bottleneck alert and minimap.
import { DATA_COLORS, DATA_NAMES, DataTier, HOTBAR, MATERIALS, MatId, NODE_DEFS, PIPES, RECIPES, TECHS, Track } from '../content';
import {
  autoBalance, canRedo, canUndo, cutWire, deleteNode, materialsAt, nodeById, raisePriority, recipesFor, redo, refundOf,
  setFilter, setMode, setRecipe, setWeight, undo, upgrade, upgradeAll, upgradeSaturatedWires, upgradeWire,
} from '../actions';
import {
  TRACK_INFO, costText, cycleTime, dataYield, fmt, fmtInt, fmtRate, fmtTime, has, labRate, maxLevel, maxPipeTier,
  nodeCost, nodeUnlocked, price, readyTechs, recipeOf, saturation, trackAvailable, upgradeCost, valueOf, wellRate,
} from '../economy';
import { bagTotal, graph, isMachine, passCap } from '../sim';
import { Game, GNode, RouterMode, Wire, clearSave } from '../state';
import { jumpTo, startPlacing, fitView, zoomBy } from './board';
import { nodeSize } from './geom';
import { esc, icon, matGlyph, nodeIcon } from './icons';
import { diagnose, matName } from './status';
import { delegate, select, toast, touch, ui } from './ui';

let topEl: HTMLElement;
let hotEl: HTMLElement;
let inspEl: HTMLElement;
let objEl: HTMLElement;
let alertEl: HTMLElement;
let mini: HTMLCanvasElement;
let zoomEl: HTMLElement;

export function initPanels(refs: {
  top: HTMLElement; hot: HTMLElement; insp: HTMLElement; obj: HTMLElement; alert: HTMLElement; mini: HTMLCanvasElement; zoom: HTMLElement;
}, hooks: { openTech: (id?: string) => void; reset: () => void }) {
  topEl = refs.top;
  hotEl = refs.hot;
  inspEl = refs.insp;
  objEl = refs.obj;
  alertEl = refs.alert;
  mini = refs.mini;
  zoomEl = refs.zoom;

  delegate(topEl, (a) => {
    const g = ui.g;
    if (a === 'undo') undo(g);
    else if (a === 'redo') redo(g);
    else if (a === 'pause') { g.paused = !g.paused; touch(); }
    else if (a === 'tech') hooks.openTech();
    else if (a === 'menu') { ui.menuOpen = !ui.menuOpen; touch(); }
    else if (a === 'reset') {
      if (confirm('Start over? This erases your whole supply line and all research.')) hooks.reset();
    }
    renderPanels();
  });

  delegate(hotEl, (a, args) => {
    if (a === 'place') startPlacing(args[0] as never);
    else if (a === 'locked') hooks.openTech(args[0]);
  });

  delegate(alertEl, (a, args) => {
    if (a === 'jump') jumpTo(Number(args[0]));
  });

  delegate(zoomEl, (a) => {
    if (a === 'in') zoomBy(1.25);
    else if (a === 'out') zoomBy(0.8);
    else if (a === 'fit') fitView();
    renderZoom();
  });

  delegate(inspEl, (a, args) => {
    const g = ui.g;
    const sel = ui.sel;
    if (a === 'close') return select(null);
    if (a === 'tech') return hooks.openTech(args[0]);
    if (a === 'jump') return jumpTo(Number(args[0]));
    if (a === 'upgsrc') {
      if (!upgrade(g, Number(args[0]), 'speed')) toast('Not enough credits', 'bad');
      return renderPanels();
    }
    if (!sel) return;
    if (sel.kind === 'node') {
      const n = nodeById(g, sel.id);
      if (!n) return;
      if (a === 'upg') {
        if (!upgrade(g, n.id, args[0] as Track)) toast('Not enough credits', 'bad');
      } else if (a === 'upgall') {
        const c = upgradeAll(g, n.type, args[0] as Track);
        toast(c ? `Upgraded ${c} ${NODE_DEFS[n.type].name}${c > 1 ? 's' : ''}` : 'Not enough credits', c ? 'good' : 'bad');
      } else if (a === 'del') {
        const refund = refundOf(g, n);
        deleteNode(g, n.id);
        select(null);
        if (refund > 0) toast(`Refunded <b>${fmt(refund)}¢</b>`, 'good');
      } else if (a === 'dup') startPlacing(n.type, n.recipe);
      else if (a === 'recipes') { ui.recipeMenu = !ui.recipeMenu; touch(); }
      else if (a === 'recipe') { setRecipe(g, n.id, args[0]); ui.recipeMenu = false; touch(); }
      else if (a === 'mode') setMode(g, n.id, args[0] as RouterMode);
      else if (a === 'wplus') { const w = g.wires.find((x) => x.id === Number(args[0])); if (w) setWeight(g, w.id, w.weight + 1); }
      else if (a === 'wminus') { const w = g.wires.find((x) => x.id === Number(args[0])); if (w) setWeight(g, w.id, w.weight - 1); }
      else if (a === 'prio') raisePriority(g, Number(args[0]));
      else if (a === 'filter') {
        const w = g.wires.find((x) => x.id === Number(args[0]));
        if (w) {
          const mats: (MatId | null)[] = [null, ...materialsAt(g, n.id)];
          setFilter(g, w.id, mats[(mats.indexOf(w.filter) + 1) % mats.length]);
        }
      } else if (a === 'autobal') autoBalance(g, n.id);
    } else {
      const w = g.wires.find((x) => x.id === sel.id);
      if (!w) return;
      if (a === 'wireup') { if (!upgradeWire(g, w.id)) toast('Not enough credits', 'bad'); }
      else if (a === 'wireall') { const c = upgradeSaturatedWires(g); toast(c ? `Upgraded ${c} wire${c > 1 ? 's' : ''}` : 'Nothing to upgrade, or not enough credits', c ? 'good' : 'bad'); }
      else if (a === 'cut') { cutWire(g, w.id); select(null); }
    }
    renderPanels();
  });
}

// ---------- shared bits ----------

const tok = (m: MatId, q?: number) =>
  `<span class="tok">${matGlyph(m, 13)}${q != null ? `<span class="mono">${q}</span> ` : ''}${MATERIALS[m].name}</span>`;

function buyBtn(act: string, cost: number, credits: number, label?: string, testid?: string): string {
  const ok = credits + 1e-6 >= cost;
  const pct = Math.max(0, Math.min(100, (credits / Math.max(1, cost)) * 100));
  return `<button class="buy${ok ? ' ok' : ''}" data-act="${act}" ${testid ? `data-testid="${testid}"` : ''}>${ok ? '' : `<span class="fill" style="width:${pct}%"></span>`}<span class="lab">${label ?? ''}${fmt(cost)}¢</span></button>`;
}

// ---------- top bar ----------

function dataPill(g: Game, k: DataTier): string {
  const seen = g.data[k] > 0 || g.dataRate[k] > 0 || g.techs.some((t) => (TECHS[t].cost[k] ?? 0) > 0);
  const hint = k === 'a' ? 'Build a Lab' : k === 'b' ? 'Study a T2 item' : 'Study a T3 item';
  if (!seen) return `<div class="res ghost"><span class="sym">${DATA_NAMES[k]}</span><span class="hint">${hint}</span></div>`;
  return `<div class="res" style="--c:${DATA_COLORS[k]}" data-testid="data-${k}"><span class="sym">${DATA_NAMES[k]}</span><div class="nums"><b class="mono">${fmtInt(g.data[k])}</b><i class="mono">+${fmtRate(g.dataRate[k])}/s</i></div></div>`;
}

function renderTop() {
  const g = ui.g;
  const ready = readyTechs(g).length;
  const techOn = has(g, 'R1');
  topEl.innerHTML = `
    <div class="logo"><svg viewBox="0 0 28 28" width="26" height="26" aria-hidden="true"><circle cx="6" cy="8" r="4" fill="#FFD84D"/><circle cx="22" cy="20" r="4" fill="#5CE1FF"/><path d="M10 8c8 0 4 12 8 12" class="ic" style="color:#9DB8FF"/></svg><span>flowstate</span></div>
    <div class="resrow">
      <div class="res credits" data-testid="credits"><span class="sym coin">¢</span><div class="nums"><b class="mono">${fmtInt(g.credits)}</b><i class="mono">+${fmtRate(g.creditRate)}/s</i></div></div>
      ${techOn ? dataPill(g, 'a') + dataPill(g, 'b') + dataPill(g, 'g') : ''}
    </div>
    <div class="grow"></div>
    <button class="ibtn" data-act="undo" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" ${canUndo() ? '' : 'disabled'}>${icon('undo')}</button>
    <button class="ibtn" data-act="redo" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)" ${canRedo() ? '' : 'disabled'}>${icon('redo')}</button>
    <button class="ibtn${g.paused ? ' on' : ''}" data-act="pause" aria-label="${g.paused ? 'Resume' : 'Pause'} (P)" title="${g.paused ? 'Resume' : 'Pause'} (P)">${icon(g.paused ? 'play' : 'pause')}</button>
    <span class="sep"></span>
    ${techOn ? `<button class="techbtn${ready ? ' ready' : ''}" data-act="tech" data-testid="open-tech">${icon('tree')}Tech tree${ready ? `<span class="badge">${ready} ready</span>` : ''}<span class="kbd">R</span></button>` : ''}
    <div class="menuwrap"><button class="ibtn" data-act="menu" aria-label="Menu" title="Menu">${icon('gear')}</button>
      ${ui.menuOpen ? `<div class="menu"><button data-act="reset">Reset game…</button></div>` : ''}</div>`;
}

// ---------- hotbar ----------

function renderHot() {
  const g = ui.g;
  let key = 0;
  let shownLocked = 0;
  const items = HOTBAR.map((type) => {
    const def = NODE_DEFS[type];
    if (!nodeUnlocked(g, type)) {
      // Tease only the next couple of locked nodes, to keep the bar calm.
      if (!has(g, 'R1') || shownLocked >= 2) return '';
      shownLocked++;
      const t = TECHS[def.tech!];
      return `<button class="hb locked" data-act="locked:${t.id}" title="${def.name}: research ${t.name}" aria-label="${def.name}, locked">${nodeIcon(type)}<span class="p">${costText(t) || 'locked'}</span></button>`;
    }
    key++;
    const cost = nodeCost(g, type);
    const ok = g.credits + 1e-6 >= cost;
    const pct = Math.max(0, Math.min(100, (g.credits / Math.max(1, cost)) * 100));
    const k = key <= 9 ? key : 0;
    return `<button class="hb${ok ? '' : ' poor'}${ui.placing?.type === type ? ' on' : ''}" data-act="place:${type}" data-testid="hot-${type}" title="${def.name}: ${def.blurb}" aria-label="${def.name}, key ${k}, ${cost} credits">
      ${ok ? '' : `<span class="fill" style="height:${pct}%"></span>`}<span class="k mono">${k}</span>${nodeIcon(type)}<span class="p mono">${cost === 0 ? 'free' : fmt(cost) + '¢'}</span></button>`;
  }).join('');
  hotEl.innerHTML = `${items}<div class="grow"></div><div class="hb tip" title="Select a node and press Delete. Everything is refunded in full.">${icon('trash')}<span class="p">Del = refund</span></div>`;
}

/** Hotbar node types in key order (unlocked only). */
export function hotbarTypes(g: Game) {
  return HOTBAR.filter((t) => nodeUnlocked(g, t));
}

// ---------- inspector ----------

function statusBlock(g: Game, n: GNode): string {
  const dx = diagnose(g, n);
  if (!dx.problem) return '';
  const r = recipeOf(n);
  let title = '';
  let body = '';
  let cls = dx.problem;
  let actions = '';
  if (dx.problem === 'idle') {
    title = n.recipe ? 'Idle: nothing connected' : 'Idle: no recipe';
    body = n.recipe ? 'Drag a wire from a source into this machine.' : 'Connect an input and the recipe is picked for you, or choose one below.';
  } else if (dx.problem === 'starved' && r) {
    const need = (r.inputs.find((i) => i[0] === dx.mat)?.[1] ?? 0) / cycleTime(n, r);
    let got = 0;
    for (const w of graph(g).ins.get(n.id) ?? []) if (w.mat === dx.mat) got += w.rate;
    title = `Starved: not enough ${matName(dx.mat)}`;
    if (dx.culprit == null) body = `Nothing connected supplies ${matName(dx.mat)}.`;
    else {
      body = `Receiving <span class="mono">${fmtRate(got)}</span> of <span class="mono">${fmtRate(need)}</span> ${matName(dx.mat)}/s.`;
      const src = nodeById(g, dx.culprit);
      if (src && trackAvailable(g, src, 'speed') && src.lv.speed < maxLevel(g, 'speed') && src.status === 'working') {
        actions += buyBtn(`upgsrc:${src.id}`, upgradeCost(src, 'speed'), g.credits, 'Upgrade source · ', 'upg-source');
      }
      actions += `<button class="ghostbtn" data-act="jump:${dx.culprit}">Jump to source</button>`;
    }
  } else if (dx.problem === 'blocked') {
    title = `Blocked: ${matName(dx.mat)} output is full`;
    if (dx.openPort) body = `${matName(dx.mat)} has nowhere to go. Drag from its port into empty space to send it somewhere.`;
    else {
      body = 'Whatever is downstream cannot keep up.';
      if (dx.culprit != null) actions += `<button class="ghostbtn" data-act="jump:${dx.culprit}">Jump to the cause</button>`;
    }
    if (dx.victim) cls = 'blocked';
  }
  return `<div class="sec"><div class="statusbox ${cls}"><div class="st-title">${icon('warn', 16)}${title}</div><p>${body}</p>${actions ? `<div class="st-actions">${actions}</div>` : ''}</div></div>`;
}

function recipeSection(g: Game, n: GNode): string {
  const r = recipeOf(n);
  const all = recipesFor(g, n.type);
  let chips = '<span class="muted">None yet</span>';
  if (r) {
    chips = `${r.inputs.map(([m, q]) => tok(m, q)).join('<span class="op">+</span>')}<span class="op">→</span>${r.outputs.map(([m, q]) => tok(m, q)).join('<span class="op">+</span>')}`;
  }
  const list = ui.recipeMenu || !r
    ? `<div class="recipelist">${all.map((x) => `<button data-act="recipe:${x.id}" class="${x.id === n.recipe ? 'on' : ''}" data-testid="recipe-${x.id}">${matGlyph(x.outputs[0][0], 14)}<b>${x.name}</b><span>${x.inputs.map(([m, q]) => `${q} ${MATERIALS[m].name}`).join(' + ')}</span></button>`).join('')}</div>`
    : '';
  return `<div class="sec"><div class="row"><span class="lbl">Recipe</span>${r && all.length > 1 ? `<button class="link" data-act="recipes">${ui.recipeMenu ? 'Close' : 'Change'}</button>` : ''}</div>
    <div class="chips">${chips}</div>
    ${r ? `<div class="note"><span class="mono">${cycleTime(n, r).toFixed(2)}s</span> per craft · base ${r.time.toFixed(1)}s</div>` : ''}${list}</div>`;
}

function flowSection(g: Game, n: GNode): string {
  const r = recipeOf(n);
  if (!r) return '';
  const T = cycleTime(n, r);
  const ins = graph(g).ins.get(n.id) ?? [];
  const rows = r.inputs.map(([m, q]) => {
    const need = q / T;
    let got = 0;
    for (const w of ins) if (w.mat === m) got += w.rate;
    const lim = n.status === 'starved' && n.missing === m;
    return `<div><div class="row sm"><span class="${lim ? 'bad' : ''}">In · ${MATERIALS[m].name}${lim ? ' · limiting' : ''}</span><span class="mono muted"><b>${fmtRate(got)}</b> / ${fmtRate(need)} /s</span></div>
      <div class="bar"><span style="width:${Math.min(100, (got / need) * 100)}%;background:${MATERIALS[m].color}"></span></div></div>`;
  }).join('');
  const outs = r.outputs.map(([m, q]) => `<div class="row sm"><span>Out · ${MATERIALS[m].name}</span><span class="mono"><b>${fmtRate((n.util * q) / T)}</b>/s</span></div>`).join('');
  return `<div class="sec flow"><span class="lbl">Flow</span>${rows}${outs}
    <div class="row sm"><span>Utilization</span><span class="mono"><b>${Math.round(n.util * 100)}%</b></span></div>
    <div class="bar"><span style="width:${n.util * 100}%;background:#7AA2FF"></span></div></div>`;
}

function upgradeSection(g: Game, n: GNode): string {
  const def = NODE_DEFS[n.type];
  if (!def.tracks.length) return '';
  const rows = def.tracks.map((t) => {
    if (!trackAvailable(g, n, t)) {
      return `<div class="uprow locked"><div><b>${TRACK_INFO[t].name}</b><small>Research Efficiency Tuning · <span style="color:#5EEAD4">80α</span></small></div><button class="buy dashed" data-act="tech:U1"><span class="lab">View tech</span></button></div>`;
    }
    const lv = n.lv[t];
    const max = maxLevel(g, t);
    if (lv >= max) return `<div class="uprow"><div><b>${TRACK_INFO[t].name} <span class="mono muted">Lv ${lv}</span></b><small>Maxed${t === 'speed' && !has(g, 'U2') ? ' · Overclock raises the cap' : ''}</small></div></div>`;
    const cost = upgradeCost(n, t);
    const bulk = has(g, 'S1') ? `<button class="link" data-act="upgall:${t}" title="Upgrade every ${def.name} by one level">all</button>` : '';
    return `<div class="uprow"><div><b>${TRACK_INFO[t].name} <span class="mono muted">Lv ${lv} → ${lv + 1}</span></b><small>${TRACK_INFO[t].desc(n)}</small></div>${bulk}${buyBtn(`upg:${t}`, cost, g.credits, '', `upg-${t}`)}</div>`;
  }).join('');
  return `<div class="sec"><span class="lbl">Upgrades</span>${rows}</div>`;
}

function routerSection(g: Game, n: GNode): string {
  const wires = g.wires.filter((w) => w.from === n.id);
  const modes: { id: RouterMode; name: string; tech?: string }[] = [
    { id: 'even', name: 'Even' }, { id: 'ratio', name: 'Ratio' }, { id: 'priority', name: 'Priority', tech: 'L4' }, { id: 'filter', name: 'Filter', tech: 'L6' },
  ];
  const seg = modes.map((m) => has(g, m.tech)
    ? `<button data-act="mode:${m.id}" class="${n.mode === m.id ? 'on' : ''}" data-testid="mode-${m.id}">${m.name}</button>`
    : `<button data-act="tech:${m.tech}" class="lockedseg">${icon('lock', 11)}${m.name}</button>`).join('');
  const total = wires.reduce((s, w) => s + w.rate, 0) || 1;
  const rows = wires.map((w, i) => {
    const d = nodeById(g, w.to);
    const name = d ? NODE_DEFS[d.type].name + (d.recipe ? ` (${RECIPES[d.recipe].name})` : '') : '?';
    let ctl = '';
    if (n.mode === 'ratio') ctl = `<button class="step" data-act="wminus:${w.id}" aria-label="Decrease weight">${icon('minus', 12)}</button><span class="mono w">${w.weight}</span><button class="step" data-act="wplus:${w.id}" aria-label="Increase weight" data-testid="wplus">${icon('plus', 12)}</button>`;
    else if (n.mode === 'priority') ctl = `<span class="mono w">#${i + 1}</span>${i > 0 ? `<button class="step" data-act="prio:${w.id}" aria-label="Raise priority">${icon('up', 12)}</button>` : '<span class="step ghost"></span>'}`;
    else if (n.mode === 'filter') ctl = `<button class="filt" data-act="filter:${w.id}">${w.filter ? matGlyph(w.filter, 12) + MATERIALS[w.filter].name : 'any'}</button>`;
    return `<div class="rrow"><span class="dest">→ ${esc(name)}</span>${ctl}<div class="bar"><span style="width:${(w.rate / total) * 100}%;background:#9DB8FF"></span></div><span class="mono rate">${fmtRate(w.rate)}/s</span></div>`;
  }).join('');
  const help: Record<RouterMode, string> = {
    even: 'Splits evenly and skips outputs that are full.',
    ratio: 'Splits by weight. A full output passes its share on.',
    priority: 'Fills #1 first. The rest only get the overflow.',
    filter: 'Each wire carries one material, or anything if set to "any".',
  };
  const bal = has(g, 'S3') ? `<button class="ghostbtn" data-act="autobal">Auto-balance</button>` : has(g, 'L4') ? `<button class="ghostbtn dashed" data-act="tech:S3">Auto-balance · 150β</button>` : '';
  return `<div class="sec"><span class="lbl">Mode</span><div class="seg">${seg}</div><div class="note">${help[n.mode]}</div>
    ${wires.length ? rows : '<div class="note">Drag wires from the output port to add destinations.</div>'}${bal ? `<div class="st-actions">${bal}</div>` : ''}</div>`;
}

function marketSection(g: Game, n: GNode): string {
  const sold = (Object.keys(g.soldRate) as MatId[]).filter((m) => (g.soldRate[m] ?? 0) > 0.005);
  const lens = has(g, 'C1');
  const rows = sold.map((m) => {
    const sat = saturation(g, m);
    return `<div class="mrow">${matGlyph(m, 12)}<span class="mn">${MATERIALS[m].name}</span><div class="bar"><span style="width:${sat * 100}%;background:${MATERIALS[m].color}"></span></div><span class="mono rate">${lens ? fmt(price(g, m)) + '¢' : Math.round(sat * 100) + '%'}</span></div>`;
  }).join('');
  return `<div class="sec"><span class="lbl">Selling · all markets</span>${rows || '<div class="note">Nothing arriving yet.</div>'}
    <div class="note">Bars show how much of the full price you still get. Flooding a material lowers its price, so sell a mix.${lens ? '' : ' Market Lens shows exact prices.'}</div></div>`;
}

function labSection(g: Game, n: GNode): string {
  const mats = new Set<MatId>();
  for (const w of graph(g).ins.get(n.id) ?? []) for (const m of materialsAt(g, w.from, w.port)) mats.add(m);
  const rows = [...mats].map((m) => {
    const y = dataYield(g, m);
    return `<div class="row sm"><span>${matGlyph(m, 12)} ${MATERIALS[m].name}</span><span class="mono" style="color:${DATA_COLORS[y.tier]}">${fmt(y.amount)}${DATA_NAMES[y.tier]} each</span></div>`;
  }).join('');
  return `<div class="sec flow"><span class="lbl">Studying</span>${rows || '<div class="note">Wire any item into the Lab.</div>'}
    <div class="row sm"><span>Throughput</span><span class="mono"><b>${fmtRate(n.rate)}</b> / ${fmtRate(labRate(g, n))} /s</span></div>
    <div class="bar"><span style="width:${Math.min(100, (n.rate / labRate(g, n)) * 100)}%;background:#C4A1FF"></span></div>
    <div class="note">Raw and T1 items give α. T2 gives β. T3 gives γ.</div></div>`;
}

function nodeInspector(g: Game, n: GNode): string {
  const def = NODE_DEFS[n.type];
  const title = n.type === 'well' && n.material ? `${MATERIALS[n.material].name} Well` : def.name;
  let body = statusBlock(g, n);
  if (isMachine(n)) body += recipeSection(g, n) + flowSection(g, n);
  else if (n.type === 'well') body += `<div class="sec flow"><span class="lbl">Flow</span><div class="row sm"><span>Extracting</span><span class="mono"><b>${fmtRate(n.rate)}</b> / ${fmtRate(wellRate(n))} /s</span></div><div class="bar"><span style="width:${Math.min(100, (n.rate / wellRate(n)) * 100)}%;background:${MATERIALS[n.material!].color}"></span></div></div>`;
  else if (n.type === 'router') body += routerSection(g, n);
  else if (n.type === 'market') body += marketSection(g, n);
  else if (n.type === 'lab') body += labSection(g, n);
  else if (n.type === 'silo') {
    const stored = (Object.keys(n.inb) as MatId[]).filter((m) => (n.inb[m] ?? 0) >= 0.5);
    body += `<div class="sec flow"><span class="lbl">Stored</span>${stored.map((m) => `<div><div class="row sm"><span>${matGlyph(m, 12)} ${MATERIALS[m].name}</span><span class="mono"><b>${Math.round(n.inb[m] ?? 0)}</b> / ${passCap(n)}</span></div><div class="bar"><span style="width:${((n.inb[m] ?? 0) / passCap(n)) * 100}%;background:${MATERIALS[m].color}"></span></div></div>`).join('') || '<div class="note">Empty.</div>'}
      <div class="note">Holds up to ${passCap(n)} of each material.</div></div>`;
  }
  else body += `<div class="sec"><div class="note">${def.blurb}</div></div>`;
  body += upgradeSection(g, n);
  const refund = refundOf(g, n);
  const fixed = n.type === 'well';
  return `<div class="sec head"><div class="hicon">${n.type === 'well' && n.material ? matGlyph(n.material, 22) : isMachine(n) && n.recipe ? matGlyph(RECIPES[n.recipe].outputs[0][0], 22) : nodeIcon(n.type, 22)}</div>
      <div class="htxt"><h2>${esc(title)}</h2><p>${esc(def.blurb)}</p></div>
      <button class="ibtn bare" data-act="close" aria-label="Close inspector">${icon('close', 16)}</button></div>
    <div class="scroll">${body}</div>
    <div class="foot"><button class="fbtn" data-act="dup" ${fixed ? 'disabled' : ''}>Duplicate <span class="kbd">Ctrl D</span></button>
      <button class="fbtn danger" data-act="del" data-testid="delete">Delete${refund > 0 ? ` · <span class="mono">+${fmt(refund)}¢</span>` : ''}</button></div>`;
}

function wireInspector(g: Game, w: Wire): string {
  const cap = PIPES[w.tier].cap;
  const mats = materialsAt(g, w.from, w.port);
  const next = PIPES[w.tier + 1];
  const canUp = w.tier < maxPipeTier(g);
  const sat = w.rate >= cap * 0.97;
  let up = '';
  if (canUp) up = `<div class="uprow"><div><b>${next.name}</b><small>carries ${next.cap}/s</small></div>${buyBtn('wireup', next.cost, g.credits, '', 'wire-up')}</div><div class="st-actions"><button class="ghostbtn" data-act="wireall">Upgrade all saturated wires</button></div>`;
  else if (next) up = `<div class="uprow locked"><div><b>${next.name}</b><small>Research ${TECHS[next.tech!].name}</small></div><button class="buy dashed" data-act="tech:${next.tech}"><span class="lab">View tech</span></button></div>`;
  else up = `<div class="note">Top tier.</div>`;
  return `<div class="sec head"><div class="hicon">${mats[0] ? matGlyph(mats[0], 22) : icon('minus', 22)}</div>
      <div class="htxt"><h2>Wire · ${PIPES[w.tier].name}</h2><p>${mats.length ? mats.map((m) => MATERIALS[m].name).join(' + ') : 'Nothing flowing yet'}</p></div>
      <button class="ibtn bare" data-act="close" aria-label="Close inspector">${icon('close', 16)}</button></div>
    <div class="scroll">
      ${sat ? `<div class="sec"><div class="statusbox blocked"><div class="st-title">${icon('warn', 16)}At capacity</div><p>This wire is the bottleneck. Upgrade it or add a second one.</p></div></div>` : ''}
      <div class="sec flow"><span class="lbl">Flow</span><div class="row sm"><span>Carrying</span><span class="mono"><b>${fmtRate(w.rate)}</b> / ${cap} /s</span></div>
      <div class="bar"><span style="width:${Math.min(100, (w.rate / cap) * 100)}%;background:${mats[0] ? MATERIALS[mats[0]].color : '#9DB8FF'}"></span></div></div>
      <div class="sec"><span class="lbl">Pipe</span>${up}</div>
    </div>
    <div class="foot"><button class="fbtn danger" data-act="cut">Cut wire${w.paid > 0 ? ` · <span class="mono">+${fmt(w.paid)}¢</span>` : ''}</button></div>`;
}

function renderInspector() {
  const g = ui.g;
  const sel = ui.sel;
  let html = '';
  if (sel?.kind === 'node') {
    const n = nodeById(g, sel.id);
    if (n) html = nodeInspector(g, n);
  } else if (sel?.kind === 'wire') {
    const w = g.wires.find((x) => x.id === sel.id);
    if (w) html = wireInspector(g, w);
  }
  if (!html && sel) ui.sel = null;
  const open = !!html;
  if (inspEl.classList.contains('open') !== open) inspEl.classList.toggle('open', open);
  const scroll = inspEl.querySelector('.scroll')?.scrollTop ?? 0;
  inspEl.innerHTML = html;
  const s = inspEl.querySelector('.scroll');
  if (s) s.scrollTop = scroll;
}

// ---------- objective + alert ----------

function objective(g: Game): string | null {
  const count = (t: string) => g.nodes.filter((n) => n.type === t).length;
  if (!g.wires.length && g.lifetime < 5) return 'Drag from the <b>Well\'s glowing port</b> to the <b>Market</b> to start selling.';
  if (count('well') < 2 && !has(g, 'P1')) return `Press <span class="kbd">1</span> and place a second <b>Well</b> on the empty deposit, then wire it to the Market.`;
  if (!has(g, 'P1')) return `Earn <b>50¢</b> to unlock your first machine. <span class="mono">${Math.floor(g.lifetime)} / 50</span>`;
  if (!count('refiner')) return 'Drag from a Well\'s port into <b>empty space</b> and pick <b>Refiner</b>.';
  if (!has(g, 'R1')) return 'Wire the Refiner\'s output to the <b>Market</b>. Shard sells for more than Glint.';
  if (!count('lab')) return 'Drag from the Refiner\'s port into empty space and pick <b>Lab</b> to start earning Data.';
  if (!g.techs.some((t) => !TECHS[t].auto)) return 'Open the <b>Tech tree</b> <span class="kbd">R</span> and research something with your Data.';
  return null;
}

let alertNode: number | null = null;

function renderObjective() {
  const g = ui.g;
  const o = objective(g);
  objEl.style.display = o ? '' : 'none';
  if (o && objEl.innerHTML !== o) objEl.innerHTML = o;

  // The single worst root-cause problem on the board.
  let worst: { n: GNode; text: string } | null = null;
  for (const n of g.nodes) {
    const dx = diagnose(g, n);
    if (!dx.problem || dx.victim || dx.problem === 'idle') continue;
    if (n.type === 'well' && !dx.openPort) continue;
    if (worst && worst.n.util <= n.util) continue;
    const name = n.type === 'well' ? `${matName(n.material)} Well` : `${NODE_DEFS[n.type].name}${n.recipe ? ` (${RECIPES[n.recipe].name})` : ''}`;
    worst = { n, text: dx.problem === 'starved' ? `<b>${name}</b> is starved of ${matName(dx.mat)}` : dx.openPort ? `<b>${name}</b>: ${matName(dx.mat)} has nowhere to go` : `<b>${name}</b> is blocked` };
  }
  if (!worst || o) {
    alertEl.style.display = 'none';
    alertNode = null;
    return;
  }
  alertEl.style.display = '';
  const html = `<span class="dot ${worst.n.status}"></span><span>${worst.text}</span><button data-act="jump:${worst.n.id}">Jump</button>`;
  if (alertNode !== worst.n.id || alertEl.dataset.h !== worst.text) {
    alertEl.innerHTML = html;
    alertEl.dataset.h = worst.text;
    alertNode = worst.n.id;
  }
}

// ---------- minimap + zoom ----------

const ST_COLORS: Record<string, string> = { working: '#4ADE80', blocked: '#FBBF24', starved: '#F87171', idle: '#64748B' };

function renderMini() {
  const g = ui.g;
  const ctx = mini.getContext('2d');
  if (!ctx) return;
  const W = mini.width, H = mini.height;
  ctx.clearRect(0, 0, W, H);
  const s = Math.min((W - 12) / g.board.w, (H - 12) / g.board.h);
  const ox = (W - g.board.w * s) / 2, oy = (H - g.board.h * s) / 2;
  ctx.strokeStyle = '#2A3550';
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(ox, oy, g.board.w * s, g.board.h * s);
  ctx.setLineDash([]);
  for (const n of g.nodes) {
    const { w, h } = nodeSize(n);
    ctx.fillStyle = n.type === 'market' ? '#FFC857' : n.type === 'lab' ? '#C4A1FF' : ST_COLORS[n.status];
    ctx.fillRect(ox + n.x * s, oy + n.y * s, Math.max(3, w * s), Math.max(2, h * s));
  }
  const r = (document.getElementById('board') as HTMLElement).getBoundingClientRect();
  ctx.strokeStyle = '#7AA2FF';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox + (-ui.view.x / ui.view.k) * s, oy + (-ui.view.y / ui.view.k) * s, (r.width / ui.view.k) * s, (r.height / ui.view.k) * s);
}

function renderZoom() {
  zoomEl.innerHTML = `<button class="ibtn" data-act="out" aria-label="Zoom out">${icon('minus', 14)}</button><span class="mono zl">${Math.round(ui.view.k * 100)}%</span><button class="ibtn" data-act="in" aria-label="Zoom in">${icon('plus', 14)}</button><button class="ibtn" data-act="fit" aria-label="Fit board (F)" title="Fit board (F)">${icon('fit', 14)}</button>`;
}

export function renderPanels() {
  renderTop();
  renderHot();
  renderInspector();
  renderObjective();
  renderMini();
  renderZoom();
}

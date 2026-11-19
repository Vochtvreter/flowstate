// The Flows panel: the ledger (src/flows.ts) as a list, one row a material, from Sand down to the Phone.
//
// It stands where the inspector stands (a panel beside the board; a bottom sheet on a phone) and is opened from the
// top bar (the menu on a phone). A row says how much of the material is made and draws where it goes: to machines,
// sold, studied, dumped, and what machines wanted and did not get. A row that is short or has no exit says so in a
// word and has a button that goes to the Drill or machine to look at. A press on a row traces that material on the
// board: what makes it, what uses it and the wires that carry it stay lit, the rest stands back (board.ts).
//
// The panel is a selection like a card's or a wire's (ui.sel.kind 'flows'), so everything that closes the inspector
// closes it too; the trace lasts as long as the panel is open.
import { MATERIALS, MatId } from '../content';
import { fmtRate } from '../economy';
import { FlowState, MatFlow, flows } from '../flows';
import { Game } from '../state';
import { esc, icon, matGlyph } from './icons';
import { select, ui } from './ui';

/**
 * The tints of where a material goes, the same wherever the panel draws them: one grey-blue from light (kept in the
 * line) to dark (thrown away). They were blue, gold and violet, which on the board are Plastic, Sand and Oil.
 */
const TO = { machines: '#E4EAF6', sold: '#A3B3D2', studied: '#6E81AB', dumped: '#465372' };

const TAG: Record<FlowState, string> = { ok: '', short: 'Short', stuck: 'No exit', spare: 'To spare' };

/** How many rows are in trouble: short of something, or with no exit. The top bar's button counts them. */
export function flowTroubles(g: Game): number {
  let n = 0;
  for (const r of flows(g)) if (r.state === 'short' || r.state === 'stuck') n++;
  return n;
}

/** Is the panel open? */
export const flowsOpen = () => ui.sel?.kind === 'flows';

/** Open the panel, or close it when it is open. */
export function toggleFlows() {
  select(flowsOpen() ? null : { kind: 'flows', id: 0 });
}

const share = (v: number, total: number) => `${Math.max(0, Math.min(100, (v / total) * 100)).toFixed(1)}%`;

/** One row's bar: where what is made goes, and after it, hatched, what machines wanted and did not get. */
function barHtml(r: MatFlow): string {
  const missing = Math.max(0, r.wanted - r.used);
  const total = Math.max(r.made, r.used + r.sold + r.studied + r.dumped + missing, 1e-6);
  const seg = (v: number, color: string, cls = '') => (v > 0.004 ? `<i class="${cls}" style="width:${share(v, total)};background:${color}"></i>` : '');
  return `<span class="fl-bar" aria-hidden="true">${seg(r.used, TO.machines)}${seg(r.sold, TO.sold)}${seg(r.studied, TO.studied)}${seg(r.dumped, TO.dumped)}${
    r.state === 'short' && missing > 0.004 ? `<i class="miss" style="width:${share(missing, total)}"></i>` : ''}</span>`;
}

/** One row's words under the bar: where it goes, largest first; for a row in trouble, what the trouble is. */
function noteHtml(r: MatFlow): string {
  const name = MATERIALS[r.mat].name;
  if (r.state === 'short') {
    return r.makers.length
      ? `Machines want <b class="mono">${fmtRate(r.wanted)}</b>/s and get <b class="mono">${fmtRate(r.used)}</b>.`
      : `Machines want <b class="mono">${fmtRate(r.wanted)}</b>/s and nothing makes ${esc(name)}.`;
  }
  if (r.state === 'stuck') return `Nothing takes it: what makes it is full and has stopped.`;
  const parts: [number, string][] = [[r.used, 'to machines'], [r.sold, 'sold'], [r.studied, 'studied'], [r.dumped, 'dumped']];
  const said = parts.filter((p) => p[0] > 0.004).sort((a, b) => b[0] - a[0]).map(([v, what]) => `<span class="fl-part" data-to="${what.split(' ').pop()}"><b class="mono">${fmtRate(v)}</b> ${what}</span>`);
  const spare = r.state === 'spare' ? `<span class="fl-part">could make <b class="mono">${fmtRate(r.can)}</b></span>` : '';
  return said.join('<i>·</i>') + (spare ? (said.length ? '<i>·</i>' : '') + spare : '') || 'Nothing made yet.';
}

function rowHtml(r: MatFlow): string {
  const m = MATERIALS[r.mat];
  const on = ui.trace === r.mat;
  const tag = TAG[r.state];
  const go = r.at != null ? `<button class="fl-go" data-act="flow-at:${r.at}" data-testid="flow-at-${r.mat}" aria-label="Show where ${esc(m.name)} ${r.state === 'short' ? 'falls short' : 'is stuck'}">Show</button>` : '';
  return `<div class="flrow ${r.state}${on ? ' on' : ''}" data-key="${r.mat}" data-state="${r.state}" style="--c:${m.color}">
    <button class="fl-main" data-act="flow:${r.mat}" data-testid="flow-${r.mat}" aria-pressed="${on}" title="${on ? 'Stop tracing' : `Trace ${esc(m.name)} on the board`}">
      <span class="fl-ico">${matGlyph(r.mat, 18)}</span>
      <span class="fl-body">
        <span class="fl-top"><b class="fl-name">${esc(m.name)}</b>${tag ? `<span class="fl-tag ${r.state}">${tag}</span>` : ''}<span class="fl-rate mono">${fmtRate(r.made)}<small>/s</small></span></span>
        ${barHtml(r)}
        <span class="fl-note">${noteHtml(r)}</span>
      </span>
    </button>${go}</div>`;
}

/** The panel, in the inspector's frame: a head, the rows, and what the colours mean. */
export function flowsHtml(g: Game): string {
  const rows = flows(g);
  const traced = ui.trace ? MATERIALS[ui.trace as MatId]?.name : '';
  const key = (color: string, text: string) => `<span><i style="background:${color}"></i>${text}</span>`;
  return `<div class="sec head"><div class="hicon">${icon('flows', 22)}</div>
      <div class="htxt"><h2>Flows</h2><p>${traced ? `Tracing ${esc(traced)}. Press it again to stop.` : 'What is made, and where it goes. Press a row to trace it on the board.'}</p></div>
      <button class="ibtn bare" data-act="close" data-testid="flows-close" aria-label="Close Flows">${icon('close', 16)}</button></div>
    <div class="scroll"><div class="fl-rows" data-testid="flows-rows">${rows.map(rowHtml).join('')}</div>
      <div class="fl-key">${key(TO.machines, 'to machines')}${key(TO.sold, 'sold')}${key(TO.studied, 'studied')}${key(TO.dumped, 'dumped')}<span><i class="miss"></i>wanted, not there</span></div></div>`;
}

/** A press inside the panel. `go` takes the camera to a node and selects it. True when the press was the panel's. */
export function flowsAction(a: string, args: string[], go: (id: number) => void, frame: (ids: number[]) => void): boolean {
  if (a === 'flow') {
    const m = args[0] as MatId;
    ui.trace = ui.trace === m ? null : m;
    ui.uiRev++;
    if (ui.trace) {
      const row = flows(ui.g).find((r) => r.mat === m);
      if (row) frame([...row.makers, ...row.users]);
    }
    return true;
  }
  if (a === 'flow-at') {
    const id = Number(args[0]);
    go(id);
    select({ kind: 'node', id });
    return true;
  }
  return false;
}

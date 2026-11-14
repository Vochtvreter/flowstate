// The HUD: goal card and Claim, order chip, bottleneck chip, Flow ring, and the toasts that follow
// the simulation. The start screen and the end-of-demo summary are in hud-screens.ts.
// Owned by the HUD track. Subscribes through the hooks in ui.ts and panels.ts.
//
// What other modules can rely on:
//  - Anchors (dom.ts): 'goal' is the Claim button while there is one, otherwise the card; 'order' is
//    the order chip (null while hidden); 'flow' is the Flow ring (null until it is unlocked).
//  - #goal carries data-goal="<id>" and data-ready="0|1"; the buttons are data-testid="claim",
//    "advice-show" and "order-claim".
//  - The whole strip is patched in place (makePanel), so a press never lands on a rebuilt element
//    and the pulse on the Claim button runs on across several claims in a row.
import { Advice, advice } from '../advice';
import { nodeById } from '../actions';
import { DATA_COLORS, DATA_NAMES, DataTier, MATERIALS, NODE_DEFS, NodeType, RECIPES, TECHS } from '../content';
import { fmt } from '../economy';
import { GoalProgress, GoalView, claimGoal, goalView } from '../goals';
import { claimOrder, orderView } from '../orders';
import { Game, GNode, GoalReward, Reward } from '../state';
import { jumpTo } from './board';
import { Panel, anchorPt, makePanel, setAnchor, setAttr, setClass, setHidden } from './dom';
import { ring } from './fx';
import { initFlowRing, updateFlowRing } from './hud-flow';
import { toastFor } from './hud-toasts';
import { calmMotion, isTouch, waitText } from './hud-words';
import { esc, icon, matGlyph } from './icons';
import { onPanels, renderPanels } from './panels';
import { diagnose, matName } from './status';
import { delegate, onGame, onNewGame, ui } from './ui';

let stripEl: HTMLElement;
let goalEl: HTMLElement;
let orderEl: HTMLElement;
let alertEl: HTMLElement;
let goalPanel: Panel;
let orderPanel: Panel;
let alertPanel: Panel;

export function initHud() {
  stripEl = document.getElementById('hud-strip')!;
  goalEl = document.getElementById('goal')!;
  orderEl = document.getElementById('order')!;
  alertEl = document.getElementById('hud-alert')!;
  goalPanel = makePanel(goalEl);
  orderPanel = makePanel(orderEl);
  alertPanel = makePanel(alertEl);
  initFlowRing();

  // Every handler ends with a forced refresh: the press must be answered at once, although the
  // pointer is still down inside the strip.
  delegate(stripEl, (a, args) => {
    const g = ui.g;
    if (a === 'claim') claimGoal(g);
    else if (a === 'claim-order') claimOrder(g);
    else if (a === 'show') showAdvice();
    else if (a === 'jump') jumpTo(Number(args[0]));
    renderPanels(true);
  });

  onPanels(renderHud);
  onGame(toastFor);
  onGame((ev) => {
    // A new order slides in (one that quietly replaced a stale order does not).
    if (ev.kind === 'order-new' && !ev.quiet && !calmMotion() && orderEl.animate) {
      orderEl.animate([{ transform: 'translateY(-12px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
    }
  });
  onNewGame(() => {
    tipKey = '';
    tip = null;
    anchorKey = '';
  });
}

// ---------- shared bits ----------

/** A fraction for a style attribute, rounded so tiny changes do not count as new HTML. */
const frac = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 200) / 200;

const bar = (v: number, color: string) => `<div class="pbar" style="--c:${color}"><span style="transform:scaleX(${frac(v)})"></span></div>`;

const DATA_OF: Record<string, DataTier> = { α: 'a', β: 'b', γ: 'g' };

/** What a goal or an order pays, as chips: new things by name, credits in gold, Data in its tier's colour. */
function rewardChips(r: GoalReward | Reward): string {
  const out: string[] = [];
  const gr = r as GoalReward;
  for (const id of gr.techs ?? []) out.push(`<span class="rw new">${icon('tree', 11)}${esc(TECHS[id]?.name ?? id)}</span>`);
  if (gr.unlock === 'orders') out.push(`<span class="rw new">Orders</span>`);
  if (gr.unlock === 'flow') out.push(`<span class="rw new">Flow meter</span>`);
  if (gr.unlock === 'end') out.push(`<span class="rw new">Demo complete</span>`);
  if (r.credits) out.push(`<span class="rw mono" style="--c:#FFC857">${fmt(r.credits)}¢</span>`);
  for (const k of ['a', 'b', 'g'] as DataTier[]) {
    if (r[k]) out.push(`<span class="rw mono" style="--c:${DATA_COLORS[k]}">${fmt(r[k]!)}${DATA_NAMES[k]}</span>`);
  }
  return out.join('');
}

// ---------- goal card ----------

/** The progress line: a bar and what it counts, in words. */
function progressHtml(p: GoalProgress): string {
  const [cur, target, unit] = p;
  const share = target > 0 ? cur / target : 0;
  if (unit === '¢') {
    return `${bar(share, '#FFC857')}<span class="gc-num">Saving <b class="mono">${fmt(Math.floor(cur))} / ${fmt(target)}¢</b></span>`;
  }
  const tier = DATA_OF[unit];
  if (tier) {
    return `${bar(share, DATA_COLORS[tier])}<span class="gc-num">Saving <b class="mono" style="color:${DATA_COLORS[tier]}">${fmt(Math.floor(cur))} / ${fmt(target)}${unit}</b></span>`;
  }
  if (unit === 's') {
    // Seconds count down.
    const left = Math.max(0, Math.ceil(target - cur - 1e-6));
    const text = cur <= 0 ? `Hold it for <b class="mono">${target}s</b>` : `<b class="mono">${left}s</b> to go`;
    return `${bar(share, '#7AA2FF')}<span class="gc-num">${text}</span>`;
  }
  return `${bar(share, '#7AA2FF')}<span class="gc-num"><b class="mono">${fmt(Math.floor(cur))} / ${fmt(target)}</b> ${esc(unit)}</span>`;
}

function tipHtml(a: Advice): string {
  const wait = waitText(a.eta);
  const canShow = a.node != null || !!a.build;
  return `<div class="gc-tip" data-kind="${a.kind}"><span class="gc-tiptxt"><b>Tip</b>${esc(isTouch() ? a.text.touch : a.text.mouse)}${wait ? `<i>${wait} at this rate</i>` : ''}</span>${
    canShow ? `<button class="gc-show" data-act="show" data-testid="advice-show">Show me</button>` : ''}</div>`;
}

function goalHtml(v: GoalView, a: Advice | null): string {
  const step = `${v.free ? 'Free play' : 'Goal'} ${v.number} / ${v.total}`;
  if (v.ready) {
    return `<div class="gc-main"><div class="gc-head"><span class="gc-step">${step}</span><span class="gc-done">${icon('check', 12)}Done</span></div>
      <h3 class="gc-title">${esc(v.goal.title)}</h3>
      <div class="gc-rewards"><span class="gc-lbl">Reward</span>${rewardChips(v.reward)}</div></div>
      <button class="claim" data-act="claim" data-testid="claim">Claim</button>`;
  }
  return `<div class="gc-main"><div class="gc-head"><span class="gc-step">${step}</span><span class="gc-rewards">${rewardChips(v.reward)}</span></div>
      <h3 class="gc-title">${esc(v.goal.title)}</h3>
      <p class="gc-hint">${esc(v.hint)}</p>
      ${v.progress ? `<div class="gc-prog">${progressHtml(v.progress)}</div>` : ''}
      ${a ? tipHtml(a) : ''}</div>`;
}

// The adviser is asked once a second at most, and at once when the goal changes: a tip that
// flickered between two answers four times a second would be unreadable.
let tip: Advice | null = null;
let tipKey = '';
let tipAt = 0;

function currentTip(g: Game, key: string): Advice | null {
  const now = performance.now();
  if (key === tipKey && now - tipAt < 1000) return tip;
  tipKey = key;
  tipAt = now;
  try {
    tip = advice(g);
  } catch (err) {
    console.error(err);
    tip = null;
  }
  return tip;
}

function showAdvice() {
  const a = tip;
  if (!a) return;
  if (a.node != null && nodeById(ui.g, a.node)) {
    jumpTo(a.node);
    return;
  }
  if (a.build) pulseHotbar(a.build as NodeType);
}

/** Draw the eye to a hotbar button: it swells three times and a ring opens around it. */
function pulseHotbar(type: NodeType) {
  const b = document.querySelector<HTMLElement>(`[data-testid="hot-${type}"]`);
  if (!b) return;
  const r = b.getBoundingClientRect();
  if (!r.width) return;
  ring({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, '#7AA2FF');
  if (!calmMotion() && b.animate) {
    b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }], { duration: 420, iterations: 3, easing: 'ease-in-out' });
  }
}

function renderGoal(g: Game, force: boolean) {
  const v = goalView(g, isTouch());
  setAttr(goalEl, 'data-goal', v ? v.goal.id : 'none');
  setAttr(goalEl, 'data-ready', v?.ready ? '1' : '0');
  setClass(goalEl, 'done', !v);
  if (!v) {
    tip = null;
    goalPanel.render(`<div class="gc-free">${icon('check', 13)}<span><b>Free play</b> · every goal is done. The line is yours.</span></div>`, force);
    return;
  }
  if (v.ready) tip = null;
  const a = v.ready ? null : currentTip(g, v.goal.id);
  goalPanel.render(goalHtml(v, a), force);
}

// ---------- order chip ----------

function renderOrder(g: Game, force: boolean) {
  const o = orderView(g);
  setHidden(orderEl, !o);
  if (!o) return;
  setAttr(orderEl, 'data-ready', o.ready ? '1' : '0');
  setAttr(orderEl, 'data-mat', o.order.mat);
  const color = MATERIALS[o.order.mat].color;
  orderPanel.render(`<div class="oc-ico">${matGlyph(o.order.mat, 20)}</div>
    <div class="oc-main"><span class="oc-lbl">Order</span><div class="oc-line">Deliver <b class="mono">${o.got} / ${o.need}</b> ${esc(o.name)}</div>
      ${bar(o.need > 0 ? o.got / o.need : 0, color)}
      <div class="oc-pay"><span class="gc-lbl">${o.ready ? 'Filled' : 'Pays'}</span>${rewardChips(o.reward)}</div></div>
    ${o.ready ? `<button class="claim sm" data-act="claim-order" data-testid="order-claim">Claim</button>` : ''}`, force);
}

// ---------- bottleneck chip ----------

function nodeName(n: GNode): string {
  if (n.type === 'well') return `${matName(n.material)} Well`;
  return `${NODE_DEFS[n.type].name}${n.recipe && RECIPES[n.recipe] ? ` (${RECIPES[n.recipe].name})` : ''}`;
}

/** The single worst root-cause problem on the board, or null. Nothing is flagged before the first wire. */
function worstProblem(g: Game): { n: GNode; text: string } | null {
  if (!g.wires.length && g.stats.wiresMade === 0) return null;
  let worst: { n: GNode; text: string } | null = null;
  for (const n of g.nodes) {
    const dx = diagnose(g, n);
    if (!dx.problem || dx.victim || dx.problem === 'idle') continue;
    if (n.type === 'well' && !dx.openPort) continue;
    if (worst && worst.n.util <= n.util) continue;
    const name = `<b>${esc(nodeName(n))}</b>`;
    const text = dx.problem === 'starved' ? `${name} needs more ${matName(dx.mat)}`
      : dx.openPort ? `${name}: give its ${matName(dx.mat)} somewhere to go`
        : `${name} is backed up`;
    worst = { n, text };
  }
  return worst;
}

function renderAlert(g: Game, force: boolean) {
  const worst = worstProblem(g);
  setHidden(alertEl, !worst);
  if (!worst) return;
  alertPanel.render(`<button class="alertchip" data-act="jump:${worst.n.id}" data-testid="alert-chip"><span class="dot ${worst.n.status}"></span><span class="al-txt">${worst.text}</span><span class="al-go">Show</span></button>`, force);
}

// ---------- everything together ----------

let anchorKey = '';

function renderHud(force: boolean) {
  const g = ui.g;
  renderGoal(g, force);
  renderOrder(g, force);
  renderAlert(g, force);
  updateFlowRing(g);
  // While the tech tree covers the board, a goal that is ready lifts above it as a slim bar, so Claim is never hidden.
  setClass(stripEl, 'over-tech', ui.techOpen && g.goal.ready);
  // The anchors are pointed at what is on screen whenever the layout of the strip may have changed.
  const claim = goalEl.querySelector('[data-testid="claim"]');
  const key = `${g.goal.i}|${claim ? 1 : 0}|${g.order ? 1 : 0}${g.order?.ready ? 1 : 0}|${alertEl.hasAttribute('hidden') ? 0 : 1}|${ui.techOpen ? 1 : 0}|${tip ? 1 : 0}`;
  if (key !== anchorKey) {
    anchorKey = key;
    setAnchor('goal', claim ?? goalEl);
    setAnchor('order', orderEl);
  }
}

/** For scripts: where an effect would start from. */
export const hudAnchors = () => ({ goal: anchorPt('goal'), order: anchorPt('order'), flow: anchorPt('flow') });

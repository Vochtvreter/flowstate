// The HUD: goal card and Claim, order chip, bottleneck chip, Flow ring, and the toasts that follow
// the simulation. The start screen and the end-of-demo summary are in hud-screens.ts.
// Owned by the HUD track. Subscribes through the hooks in ui.ts and panels.ts.
//
// What other modules can rely on:
//  - Anchors (dom.ts): 'goal' is the Claim button while there is one, otherwise the card (for half
//    a second after a claim it is still the place where Claim was pressed); 'order' is the order
//    chip (null while hidden); 'flow' is the Flow ring (null until it is unlocked).
//  - #goal carries data-goal="<id>" and data-ready="0|1"; the buttons are data-testid="claim",
//    "advice-show" and "order-claim". The tip row is data-testid="advice-tip".
//  - The adviser never runs here: its answers come from a Web Worker (advice-client.ts), and what the
//    card does with them is in advice-tip.ts.
//  - The whole strip is patched in place (makePanel), so a press never lands on a rebuilt element
//    and the pulse on the Claim button runs on across several claims in a row.
import { materialsAt, nodeById } from '../actions';
import { DATA_COLORS, DATA_NAMES, DataTier, MATERIALS, MatId, NODE_DEFS, RECIPES, TECHS } from '../content';
import { fmt } from '../economy';
import { GoalProgress, GoalView, claimGoal, goalView } from '../goals';
import { claimOrder, orderView } from '../orders';
import { graph } from '../sim';
import { Game, GNode, GoalReward, Reward } from '../state';
import { initAdviser, pollAdviser } from './advice-client';
import { WaitLine, announceTips, resetTips, showTip, tendTips, tipHtml, tipShown, waitLine } from './advice-tip';
import { jumpTo } from './board';
import { Panel, anchorPt, makePanel, setAnchor, setAttr, setClass, setHidden } from './dom';
import { initFlowRing, updateFlowRing } from './hud-flow';
import { toastFor } from './hud-toasts';
import { aboutTime, calmMotion, isTouch } from './hud-words';
import { esc, icon, matGlyph } from './icons';
import { onPanels, renderPanels } from './panels';
import { diagnose, matName } from './status';
import { delegate, onGame, onNewGame, ui } from './ui';

let stripEl: HTMLElement;
let goalEl: HTMLElement;
let orderEl: HTMLElement;
let alertEl: HTMLElement;
let toastsEl: HTMLElement;
let goalPanel: Panel;
let orderPanel: Panel;
let alertPanel: Panel;

export function initHud() {
  stripEl = document.getElementById('hud-strip')!;
  goalEl = document.getElementById('goal')!;
  orderEl = document.getElementById('order')!;
  alertEl = document.getElementById('hud-alert')!;
  toastsEl = document.getElementById('toasts')!;
  goalPanel = makePanel(goalEl);
  orderPanel = makePanel(orderEl);
  alertPanel = makePanel(alertEl);
  initFlowRing();
  initAdviser();

  // Every handler ends with a forced refresh: the press must be answered at once, although the
  // pointer is still down inside the strip.
  delegate(stripEl, (a, args, _el, ev) => {
    const g = ui.g;
    // While the tech tree is open the keyboard belongs to it (Enter researches): a Claim button that
    // happens to hold the focus must not answer Enter or Space as well. A pointer still claims.
    const byKey = ev.type === 'click' && (ev as MouseEvent).detail === 0;
    if (ui.techOpen && byKey && (a === 'claim' || a === 'claim-order')) return;
    if (a === 'claim') {
      const pressed = goalEl.querySelector('[data-testid="claim"]')?.getBoundingClientRect();
      if (claimGoal(g) && pressed) holdGoalAnchor(pressed);
    } else if (a === 'claim-order') claimOrder(g);
    else if (a === 'show') return showTip(g, () => renderPanels(true));
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
    resetTips();
    anchorKey = '';
    standUntil = 0;
    alertNode = -1;
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
  // Saving up, in credits or in Data: "Saving 7 / 12¢", then "Saved 12 / 12¢" once there is enough.
  const saving = cur + 1e-6 >= target ? 'Saved' : 'Saving';
  if (unit === '¢') {
    return `${bar(share, '#FFC857')}<span class="gc-num">${saving} <b class="mono">${fmt(Math.floor(cur))} / ${fmt(target)}¢</b></span>`;
  }
  const tier = DATA_OF[unit];
  if (tier) {
    return `${bar(share, DATA_COLORS[tier])}<span class="gc-num">${saving} <b class="mono" style="color:${DATA_COLORS[tier]}">${fmt(Math.floor(cur))} / ${fmt(target)}${unit}</b></span>`;
  }
  if (unit === 's') {
    // Seconds count down.
    const left = Math.max(0, Math.ceil(target - cur - 1e-6));
    const text = cur <= 0 ? `Hold it for <b class="mono">${target}s</b>` : `<b class="mono">${left}s</b> to go`;
    return `${bar(share, '#7AA2FF')}<span class="gc-num">${text}</span>`;
  }
  return `${bar(share, '#7AA2FF')}<span class="gc-num"><b class="mono">${fmt(Math.floor(cur))} / ${fmt(target)}</b> ${esc(unit)}</span>`;
}

/**
 * The progress line during a wait, as the adviser sees the wait: what is really being saved for (which can
 * be the credits for a machine while the goal's own count is still the Data for its research) and how long
 * that takes at the current income: "Saving 320 / 1,140α · about 2 min". When nothing is coming in it
 * says so, instead of a time that would never come.
 */
function waitHtml(w: WaitLine): string {
  const tier = DATA_OF[w.unit];
  const color = tier ? DATA_COLORS[tier] : '#FFC857';
  const left = isFinite(w.eta) ? aboutTime(w.eta) : tier ? `nothing is bringing in ${w.unit} yet` : 'nothing is being sold yet';
  return `${bar(w.need > 0 ? w.have / w.need : 0, color)}<span class="gc-num">Saving <b class="mono"${tier ? ` style="color:${color}"` : ''}>${fmt(Math.floor(w.have))} / ${fmt(w.need)}${w.unit}</b></span><span class="gc-eta${isFinite(w.eta) ? '' : ' never'}" data-testid="goal-eta">${left}</span>`;
}

function goalHtml(g: Game, v: GoalView): string {
  const step = `${v.free ? 'Free play' : 'Goal'} ${v.number} / ${v.total}`;
  if (v.ready) {
    return `<div class="gc-main"><div class="gc-head"><span class="gc-step">${step}</span><span class="gc-done">${icon('check', 12)}Done</span></div>
      <h3 class="gc-title">${esc(v.goal.title)}</h3>
      <div class="gc-rewards"><span class="gc-lbl">Reward</span>${rewardChips(v.reward)}</div></div>
      <button class="claim" data-act="claim" data-testid="claim">Claim</button>`;
  }
  const wait = waitLine(g, v.progress);
  return `<div class="gc-main"><div class="gc-head"><span class="gc-step">${step}</span><span class="gc-rewards">${rewardChips(v.reward)}</span></div>
      <h3 class="gc-title">${esc(v.goal.title)}</h3>
      <p class="gc-hint">${esc(v.hint)}</p>
      ${wait ? `<div class="gc-prog">${waitHtml(wait)}</div>` : v.progress ? `<div class="gc-prog">${progressHtml(v.progress)}</div>` : ''}
      ${tipHtml()}</div>`;
}

function renderGoal(g: Game, force: boolean) {
  const v = goalView(g, isTouch());
  setAttr(goalEl, 'data-goal', v ? v.goal.id : 'none');
  setAttr(goalEl, 'data-ready', v?.ready ? '1' : '0');
  setClass(goalEl, 'done', !v);
  // The adviser is asked (in its worker) whenever its last answer no longer holds, and the tip row follows.
  pollAdviser(g);
  tendTips(g);
  if (!v) {
    goalPanel.render(`<div class="gc-free">${icon('check', 13)}<span><b>Free play</b> · every goal is done. The line is yours.</span></div>`, force);
    return;
  }
  goalPanel.render(goalHtml(g, v), force);
  announceTips(goalEl);
}

// ---------- order chip ----------

/** Is any port that gives this material wired, directly or through Routers and the like, into a Market? */
function wiredToMarket(g: Game, mat: MatId): boolean {
  const c = graph(g);
  for (const n of g.nodes) {
    if (n.type !== 'market') continue;
    for (const w of c.ins.get(n.id) ?? []) if (materialsAt(g, w.from, w.port).includes(mat)) return true;
  }
  return false;
}

function renderOrder(g: Game, force: boolean) {
  const o = orderView(g);
  setHidden(orderEl, !o);
  if (!o) return;
  // An order only counts what is sold. When none of it is, a bar that never moves would be a lie by
  // omission: the chip says so, and what to do about it.
  const stuck = !o.ready && !o.reachesMarket;
  setAttr(orderEl, 'data-ready', o.ready ? '1' : '0');
  setAttr(orderEl, 'data-mat', o.order.mat);
  setAttr(orderEl, 'data-stuck', stuck ? '1' : '0');
  const color = MATERIALS[o.order.mat].color;
  const name = esc(o.name);
  const left = !o.ready && !stuck && isFinite(o.eta) ? `<span class="oc-eta" data-testid="order-eta">${aboutTime(o.eta)}</span>` : '';
  const state = stuck
    ? `<div class="oc-warn" data-testid="order-stuck">${wiredToMarket(g, o.order.mat)
      ? `No ${name} is getting to a Market yet. Make more of it.`
      : `No Market is getting ${name} yet. Wire some to a Market.`}</div>`
    : bar(o.need > 0 ? o.got / o.need : 0, color);
  orderPanel.render(`<div class="oc-ico">${matGlyph(o.order.mat, 20)}</div>
    <div class="oc-main"><div class="oc-top"><span class="oc-lbl">Order</span>${left}</div><div class="oc-line">Deliver <b class="mono">${o.got} / ${o.need}</b> ${name}</div>
      ${state}
      <div class="oc-pay"><span class="gc-lbl">${o.ready ? 'Filled' : 'Pays'}</span>${rewardChips(o.reward)}</div></div>
    ${o.ready ? `<button class="claim sm" data-act="claim-order" data-testid="order-claim">Claim</button>` : ''}`, force);
}

// ---------- bottleneck chip ----------

function nodeName(n: GNode): string {
  if (n.type === 'well') return `${matName(n.material)} Well`;
  return `${NODE_DEFS[n.type].name}${n.recipe && RECIPES[n.recipe] ? ` (${RECIPES[n.recipe].name})` : ''}`;
}

/** What is wrong with a node, in words that say what to do. null when it is fine, or only suffering from a problem elsewhere. */
function problemText(g: Game, n: GNode): string | null {
  const dx = diagnose(g, n);
  if (!dx.problem || dx.victim || dx.problem === 'idle') return null;
  if (n.type === 'well' && !dx.openPort) return null;
  const name = `<b>${esc(nodeName(n))}</b>`;
  if (dx.problem === 'starved') return `${name} needs more ${matName(dx.mat)}`;
  return dx.openPort ? `${name}: give its ${matName(dx.mat)} somewhere to go` : `${name} is backed up`;
}

/** The node the chip is about. It keeps pointing at the same node until that one is fixed. */
let alertNode = -1;

/** The single worst root-cause problem on the board, or null. Nothing is flagged before the first wire. */
function worstProblem(g: Game): { n: GNode; text: string } | null {
  if (!g.wires.length && g.stats.wiresMade === 0) return null;
  // Two machines that are about as badly off would otherwise swap places four times a second.
  const held = alertNode >= 0 ? nodeById(g, alertNode) : null;
  const heldText = held ? problemText(g, held) : null;
  if (held && heldText) return { n: held, text: heldText };
  let worst: { n: GNode; text: string } | null = null;
  for (const n of g.nodes) {
    if (worst && worst.n.util <= n.util) continue;
    const text = problemText(g, n);
    if (text) worst = { n, text };
  }
  alertNode = worst ? worst.n.id : -1;
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

// The effects that answer a claim run a frame after the press, when the Claim button may already
// be gone. For a moment after a claim the 'goal' anchor therefore stays where the button was (an
// invisible stand-in keeps its place), so coins leave from under the pointer or the thumb and not
// from the middle of the card, which on a phone is at the other end of the screen.
const HOLD_ANCHOR_MS = 500;
let stand: HTMLElement | null = null;
let standUntil = 0;

function holdGoalAnchor(r: DOMRect) {
  if (!stand) {
    stand = document.createElement('i');
    stand.setAttribute('aria-hidden', 'true');
    stand.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none';
    document.body.appendChild(stand);
  }
  stand.style.left = `${r.left}px`;
  stand.style.top = `${r.top}px`;
  stand.style.width = `${r.width}px`;
  stand.style.height = `${r.height}px`;
  standUntil = performance.now() + HOLD_ANCHOR_MS;
  anchorKey = '';
}

function renderHud(force: boolean) {
  const g = ui.g;
  renderGoal(g, force);
  renderOrder(g, force);
  renderAlert(g, force);
  updateFlowRing(g);
  // While the tech tree covers the board, a goal that is ready lifts above it as a slim bar, so Claim is never hidden.
  setClass(stripEl, 'over-tech', ui.techOpen && g.goal.ready);
  // Toasts raised while it is open keep clear of its Research button (hud.css).
  setClass(toastsEl, 'over-tech', ui.techOpen);
  // The keyboard belongs to the tree while it is open (Enter researches there, unless a button holds the
  // focus): nothing in the strip keeps the focus under it.
  if (ui.techOpen && stripEl.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  // The anchors are pointed at what is on screen whenever the layout of the strip may have changed.
  const claim = goalEl.querySelector('[data-testid="claim"]');
  const held = !claim && !!stand && performance.now() < standUntil;
  const key = `${g.goal.i}|${claim ? 1 : 0}|${g.order ? 1 : 0}${g.order?.ready ? 1 : 0}|${alertEl.hasAttribute('hidden') ? 0 : 1}|${ui.techOpen ? 1 : 0}|${tipShown() ? 1 : 0}|${held ? 1 : 0}`;
  if (key !== anchorKey) {
    anchorKey = key;
    setAnchor('goal', claim ?? (held ? stand! : goalEl));
    setAnchor('order', orderEl);
  }
}

/** For scripts: where an effect would start from. */
export const hudAnchors = () => ({ goal: anchorPt('goal'), order: anchorPt('order'), flow: anchorPt('flow') });

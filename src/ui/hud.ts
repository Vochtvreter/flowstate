// The HUD: goal card and Claim, order chip, bottleneck chip, Flow ring, and the toasts that follow
// the simulation. The start screen and the end-of-demo summary are in hud-screens.ts.
// Owned by the HUD track. Subscribes through the hooks in ui.ts and panels.ts.
//
// What other modules can rely on:
//  - Anchors (dom.ts): 'goal' is the Claim button while there is one, otherwise the card (for half
//    a second after a claim it is still the place where Claim was pressed); 'order' is the order
//    chip (null while hidden); 'flow' is the Flow ring (null until it is unlocked).
//  - #goal carries data-goal="<id>" and data-ready="0|1"; the buttons are data-testid="claim",
//    "advice-show", "line-show" and "order-claim". The tip row is data-testid="advice-tip", the goal's
//    "while you wait" line "goal-line" (data-done="0|1"), the strip of pips "goal-pips".
//  - Inside #goal: .gc-main holds the pips and .gc-body (head, title, hint, progress, line, tip); the
//    Claim button stands beside .gc-main. When a goal is claimed, .gc-body is what moves (the old one
//    lifts away as a ghost, the new one rises): #goal itself never moves, the phone's Claim seat and the
//    anchors depend on that.
//  - #hud-strip carries the class `tight` where the stage is too narrow for the card and the order side
//    by side (a desktop with the inspector open): the order and the alert then share one row under the card.
//  - The adviser never runs here: its answers come from a Web Worker (advice-client.ts), and what the
//    card does with them is in advice-tip.ts.
//  - The whole strip is patched in place (makePanel), so a press never lands on a rebuilt element
//    and the pulse on the Claim button runs on across several claims in a row.
//  - A second press of a Claim button within CLAIM_GAP of the first is ignored (a double click, two quick
//    taps, a key held down): one press claims one goal, even when the next goal is met already.
//  - Outside the phone layout the strip is laid out in the same box whether the inspector is open or not
//    (hud.css, "the strip and the inspector"): the card and its Claim do not move when it opens or closes.
//  - The alert slot (#hud-alert) says, in this order: that the game is open in another tab (setElsewhere),
//    that the game is paused (a pill that resumes it), or the board's worst problem. The problem is left out
//    while the card's hint, line or tip is about the same node, and a press on it puts it away until the
//    problem is another one.
//  - #hud-strip carries `has-order`, `has-alert`, `stuck` (an order none of which is sold) and `aiming` (a
//    port armed, a wire being drawn, a node being placed): classes for the stylesheet, which would otherwise
//    need has() selectors.
import { materialsAt, nodeById } from '../actions';
import type { Advice } from '../advice';
import { DATA_COLORS, DATA_NAMES, DataTier, MATERIALS, MatId, NODE_DEFS, RECIPES, TECHS } from '../content';
import { fmt } from '../economy';
import { FlowGoalView, GOALS, GoalProgress, GoalView, MAIN_GOALS, claimGoal, goalFocus, goalView } from '../goals';
import { claimOrder, orderView } from '../orders';
import { graph } from '../sim';
import { Game, GNode, GoalReward, Reward } from '../state';
import { initAdviser, pollAdviser } from './advice-client';
import { WaitLine, announceTips, lineHtml, lineShown, resetTips, showLine, showTip, tendCard, tipHtml, tipShown, waitLine } from './advice-tip';
import { tendFocus, tendMark } from './advice-show';
import { jumpTo } from './board';
import { Panel, anchorPt, makePanel, setAnchor, setAttr, setClass, setHidden, setStyle } from './dom';
import { initFlowRing, updateFlowRing } from './hud-flow';
import { isStarted } from './hud-screens';
import { toastFor } from './hud-toasts';
import { aboutTime, calmMotion, isTouch } from './hud-words';
import { esc, icon, matGlyph } from './icons';
import { onPanels, renderPanels } from './panels';
import { diagnose, matName } from './status';
import { env } from './phone-env';
import { delegate, onFrame, onGame, onNewGame, touch, ui } from './ui';

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
  // The card can hold the focus (not in the Tab order): a claim made from the keyboard leaves it on the new card.
  goalEl.tabIndex = -1;
  initFlowRing();
  initAdviser();

  // Every handler ends with a forced refresh: the press must be answered at once, although the
  // pointer is still down inside the strip.
  delegate(stripEl, (a, args, el, ev) => {
    const g = ui.g;
    const byKey = ev.type === 'click' && (ev as MouseEvent).detail === 0;
    // While the tech tree is open the keyboard belongs to it (Enter researches): a key press reaches a Claim
    // button only when the player has put the focus on that button (the slim bar over the tree).
    if (ui.techOpen && byKey && (a === 'claim' || a === 'claim-order') && document.activeElement !== el) return;
    if (a === 'claim') {
      // One press, one goal: a double click, two quick taps or a key held down would otherwise claim the next
      // goal as well when it is met already, and its card would never be seen.
      const now = performance.now();
      if (now - lastClaim < CLAIM_GAP) return;
      const pressed = goalEl.querySelector('[data-testid="claim"]')?.getBoundingClientRect();
      const body = goalEl.querySelector<HTMLElement>('.gc-body:not(.gc-ghost)');
      const old = body ? { html: body.innerHTML, top: body.offsetTop, width: body.offsetWidth } : null;
      const index = g.goal.i;
      if (claimGoal(g)) {
        lastClaim = now;
        if (pressed) holdGoalAnchor(pressed);
        claimed(index, old, pressed ?? null);
        if (byKey) focusAfter = true;
      }
    } else if (a === 'claim-order') {
      const now = performance.now();
      if (now - lastOrderClaim < CLAIM_GAP) return;
      const pressed = orderEl.querySelector('[data-testid="order-claim"]')?.getBoundingClientRect();
      if (claimOrder(g)) {
        lastOrderClaim = now;
        if (pressed) pressClaim(pressed, true);
      }
    } else if (a === 'show' || a === 'show-line') {
      // The player is being taken to the board: on a phone the card gives it room first.
      foldHint();
      return a === 'show' ? showTip(g, () => renderPanels(true)) : showLine(g, () => renderPanels(true));
    } else if (a === 'jump') {
      // The alert: the camera goes to the node, and that problem is put away until it is another one.
      alertPut = alertKey;
      putGone = -1;
      jumpTo(Number(args[0]));
    } else if (a === 'resume') {
      g.paused = false;
      touch();
    } else if (a === 'reload') {
      location.reload();
      return;
    }
    renderPanels(true);
  });
  // A Claim button gives under the finger for as long as it is down (class `down`, hud.css). A browser shows
  // :active for a finger late or not at all, and a mouse never gets that far: it claims on the way down, and
  // sees the button give on its ghost (pressClaim).
  stripEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') (e.target as HTMLElement).closest?.('.claim')?.classList.add('down');
  }, { passive: true });
  const release = () => stripEl.querySelectorAll('.claim.down').forEach((b) => b.classList.remove('down'));
  window.addEventListener('pointerup', release, { passive: true });
  window.addEventListener('pointercancel', release, { passive: true });
  // The stage decides whether the card and the order fit side by side (see `tight`). Outside the phone layout
  // the strip is laid out in the stage as it is with the inspector open, whether it is or not: what is
  // measured here is that box.
  const hud = document.getElementById('hud');
  const app = document.getElementById('app');
  const insp = document.getElementById('insp');
  if (hud && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      const open = !!app?.classList.contains('insp-open');
      if (open && insp?.offsetWidth) inspW = insp.offsetWidth;
      setStyle(stripEl, '--insp-w', `${inspW}px`);
      const w = hud.clientWidth - (open || env.phone ? 0 : inspW);
      if (w !== hudWidth) {
        hudWidth = w;
        renderPanels();
      }
    }).observe(hud);
  }
  // The board's state that decides where Claim may stand on a phone (hud.css, "phone seating"): a port armed,
  // a wire being drawn, a node being placed. Read off the board's own classes as they change.
  const boardEl = document.getElementById('board');
  if (boardEl && typeof MutationObserver !== 'undefined') {
    const aim = () => setClass(stripEl, 'aiming', ['arming', 'wiring', 'placing'].some((c) => boardEl.classList.contains(c)));
    new MutationObserver(aim).observe(boardEl, { attributes: true, attributeFilter: ['class'] });
    aim();
  }

  onPanels(renderHud);
  onGame(toastFor);
  onGame((ev) => {
    // A new order slides in (one that quietly replaced a stale order does not).
    if (ev.kind === 'order-new' && !ev.quiet && !calmMotion() && orderEl.animate) {
      orderEl.animate([{ transform: 'translateY(-12px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
    }
    // The first Lens: from here until the player leaves the summary, the card shows no free-play goal.
    if (ev.kind === 'demo-end') endingFrom = performance.now();
  });
  // The nodes the goal is about are brought into view when it comes up, and when a sheet or the tree closes.
  onFrame(() => tendFocus(ui.g));
  onNewGame(() => {
    resetTips();
    anchorKey = '';
    standUntil = 0;
    alertNode = -1;
    alertPut = '';
    alertKey = '';
    putGone = -1;
    ghost = null;
    pressGhost = null;
    justClaimed = -1;
    lastClaim = lastOrderClaim = -1e9;
    focusAfter = false;
    endingFrom = 0;
    summarySeen = false;
    // (A new game is this tab's own: main.ts saves it again, and the slot no longer says another tab has it.)
    elsewhere = false;
  });
}

/** Milliseconds after a claim during which another press of a Claim button is ignored. */
export const CLAIM_GAP = 500;
let lastClaim = -1e9;
let lastOrderClaim = -1e9;
/** A claim was made from the keyboard: the focus goes to the new card once it is drawn. */
let focusAfter = false;
/** The inspector's width beside the stage, outside the phone layout (style.css: #insp.open). */
let inspW = 320;

/**
 * On a phone, where the card folds its hint behind a tap (phone.ts: #app.fold, #app.hint-open; and during a
 * wait, #goal.wait here), an open hint is folded away, as it is at a press on the board. The board's shell does
 * it where it folds the hint itself (env.foldHint); where only the card folds it (a wait on an upright phone), a
 * tap on the card that is not on a button does it: phone.ts turns the hint over at such a tap (the event does
 * not bubble, so nothing else hears it).
 */
function foldHint() {
  const app = document.getElementById('app');
  if (!env.phone || !app) return;
  (env as { foldHint?: () => void }).foldHint?.();
  const folds = app.classList.contains('fold') || goalEl.classList.contains('wait');
  if (folds && app.classList.contains('hint-open')) goalEl.dispatchEvent(new MouseEvent('click'));
}

// ---------- how much room the strip has ----------

/** Width of the stage, as last reported (0 until then). */
let hudWidth = 0;
/** The card at its full width, the gap and the order chip, with the strip's margins: less than this and they do not fit in one row. */
const ROW_NEEDS = 500 + 10 + 256 + 28;

/** Outside the phone layout: the stage is too narrow for the card and the order side by side. */
const isTight = () => !env.phone && hudWidth > 0 && hudWidth < ROW_NEEDS;
/** Squeezed further: under this, the order and the alert do not share a row under the card either (hud.css, `stack`). */
const STACK_BELOW = 520;
const isStacked = () => isTight() && hudWidth < STACK_BELOW;
/** The card has room for one row of guidance (the line, or the tip), not both. */
const isNarrow = () => env.phone || isTight();

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
function waitHtml(w: WaitLine, paused: boolean): string {
  const tier = DATA_OF[w.unit];
  const color = tier ? DATA_COLORS[tier] : '#FFC857';
  // (Paused, nothing comes in: the time left would be a promise the board is not keeping.)
  const left = paused ? 'paused' : isFinite(w.eta) ? aboutTime(w.eta) : tier ? `nothing is bringing in ${w.unit} yet` : 'nothing is being sold yet';
  const cls = paused ? ' paused' : isFinite(w.eta) ? '' : ' never';
  return `${bar(w.need > 0 ? w.have / w.need : 0, color)}<span class="gc-num">Saving <b class="mono"${tier ? ` style="color:${color}"` : ''}>${fmt(Math.floor(w.have))} / ${fmt(w.need)}${w.unit}</b></span><span class="gc-eta${cls}" data-testid="goal-eta">${left}</span>`;
}

/**
 * The Flow goal's progress: the number the goal is about ("Flow 90% · 9 of 10 running"), on a bar with a
 * mark at the share that has to be held, and the seconds still to hold once it is being held. When the goal
 * has stood for a while its bar comes down to "all but one running" (the valve): the mark moves there and
 * the card says so.
 */
function flowHtml(f: FlowGoalView, p: GoalProgress | null): string {
  const pct = Math.round(Math.max(0, Math.min(1, f.pct)) * 100);
  const need = Math.round(Math.max(0, Math.min(1, f.need)) * 1000) / 10;
  const count = f.of > 0 ? `${f.running} of ${f.of} running` : 'nothing wired up counts yet';
  const holding = !!p && p[2] === 's' && p[0] > 0;
  const left = p ? Math.max(0, Math.ceil(p[1] - p[0] - 1e-6)) : 0;
  // How many may be short and the goal still counts: 1 once the valve has opened, 2 once it has opened further.
  const slack = Math.max(0, Math.min(f.of - 1, f.slack ?? (f.valve ? 1 : 0)));
  const short = f.of - f.running;
  const word = (k: number) => (k === 1 ? 'one' : k === 2 ? 'two' : String(k));
  let valve = '';
  if (slack > 0 && short > 0) {
    valve = short <= slack ? `Close enough: all but ${word(short)} ${short === 1 ? 'is' : 'are'} running` : `All but ${word(slack)} running is enough now`;
  }
  return `<div class="fl-bar${slack > 0 ? ' valve' : ''}" data-slack="${slack}">${bar(f.pct, '#5ce1ff')}<i class="fl-mark" style="left:${need}%"></i></div>
    <span class="gc-num" data-testid="goal-flow">Flow <b class="mono">${pct}%</b><span class="fl-count"> · ${count}</span></span>${
    holding ? `<span class="gc-eta gc-hold" data-testid="goal-hold"><b class="mono">${left}s</b> to go</span>` : ''}${
    valve ? `<span class="gc-valve" data-testid="goal-valve">${valve}</span>` : ''}`;
}

// ---------- the chain, as pips ----------

/** The goal that was claimed a moment ago: its pip pops. Real time. */
let justClaimed = -1;
let justUntil = 0;

/**
 * Where the player is in the chain: one pip for each of the demo's goals, the big ones (Goal.big) larger,
 * claimed ones filled, the current one lit. In free play the 22 are all filled and four more follow, one
 * for each free-play goal, so the strip goes on saying how much is left.
 */
function pipsHtml(g: Game, ending = false): string {
  const now = performance.now();
  // (The ending's card shows the demo's goals all done, and no more.)
  const at = ending ? MAIN_GOALS : g.goal.i;
  const upTo = !ending && at >= MAIN_GOALS ? GOALS.length : MAIN_GOALS;
  let out = '';
  for (let i = 0; i < upTo; i++) {
    const state = i < at ? ' done' : i === at ? ' now' : '';
    out += `${i === MAIN_GOALS ? '<i class="pip-gap"></i>' : ''}<i class="pip${GOALS[i].big ? ' big' : ''}${GOALS[i].free ? ' free' : ''}${state}${i === justClaimed && now < justUntil ? ' just' : ''}"></i>`;
  }
  return `<div class="gc-pips" data-testid="goal-pips" data-at="${at}" aria-hidden="true">${out}</div>`;
}

// ---------- claiming ----------

/** Milliseconds the old card takes to lift away, and the new one to rise after it (hud.css). */
const LIFT_MS = 120;
const RISE_MS = 180;
/** Milliseconds a pressed Claim button gives (to 0.96 of its size) before it fades where it stood. */
const PRESS_MS = 80;
/** The card that was claimed, lifting away over the new one. */
let ghost: { html: string; top: number; width: number; until: number } | null = null;
/**
 * The Claim button that was pressed (the goal's, or the order's), giving and fading where it stood (client
 * pixels). A mouse claims on the way down, so the button itself is gone before it could be seen pressed:
 * this is its press state.
 */
let pressGhost: { left: number; top: number; width: number; height: number; small: boolean; until: number } | null = null;
/** Counts claims: the new card's rise plays again each time. */
let rises = 0;

function pressClaim(r: DOMRect, small: boolean) {
  pressGhost = { left: r.left, top: r.top, width: r.width, height: r.height, small, until: performance.now() + PRESS_MS + LIFT_MS + 60 };
  // The ghosts are taken out of the card once they have faded (they are invisible by then).
  setTimeout(() => renderPanels(), PRESS_MS + LIFT_MS + RISE_MS);
}

/** A goal has just been claimed: the old card lifts and fades, the new one rises, the claimed goal's pip pops. */
function claimed(index: number, old: { html: string; top: number; width: number } | null, pressed: DOMRect | null) {
  const now = performance.now();
  // Nothing in the ghost answers a press, and no script takes it for the card.
  if (old) ghost = { html: old.html.replace(/\s(?:data-testid|data-act|title)="[^"]*"/g, ''), top: old.top, width: old.width, until: now + LIFT_MS + RISE_MS };
  if (pressed) pressClaim(pressed, false);
  rises++;
  justClaimed = index;
  justUntil = now + 900;
}

function ghostsHtml(now: number): { card: string; press: string } {
  if (ghost && now >= ghost.until) ghost = null;
  if (pressGhost && now >= pressGhost.until) pressGhost = null;
  const p = pressGhost;
  return {
    card: ghost ? `<div class="gc-body gc-ghost" data-key="ghost" aria-hidden="true" style="top:${ghost.top}px;width:${ghost.width}px">${ghost.html}</div>` : '',
    press: p ? `<i class="claim-ghost${p.small ? ' sm' : ''}" aria-hidden="true" style="left:${p.left.toFixed(1)}px;top:${p.top.toFixed(1)}px;width:${p.width.toFixed(1)}px;height:${p.height.toFixed(1)}px">Claim</i>` : '',
  };
}

/** A count still being saved up (credits or Data), not yet in hand. */
const saving = (p: GoalProgress | null) => !!p && (p[2] === '¢' || !!DATA_OF[p[2]]) && p[0] + 1e-6 < p[1];

/** "Make your first Lens": each input the Fabricator takes and whether it is wired in (from the rules, when they give it). */
type Inputs = { mat: MatId; name: string; fed: boolean }[];

/** The Fabricator's inputs, wired or not: "Prism ✓ · Glyph ✗", on a bar of how many are wired. */
function inputsHtml(inputs: Inputs): string {
  const fed = inputs.filter((x) => x.fed).length;
  const parts = inputs.map((x) => `<span class="gi ${x.fed ? 'ok' : 'no'}" data-mat="${x.mat}">${matGlyph(x.mat, 13)}${esc(x.name)}${icon(x.fed ? 'check' : 'close', 12)}</span>`);
  return `${bar(inputs.length ? fed / inputs.length : 0, '#7AA2FF')}<span class="gc-num gc-inputs" data-testid="goal-inputs" aria-label="${esc(inputs.map((x) => `${x.name} ${x.fed ? 'wired' : 'not wired'}`).join(', '))}">${parts.join('<i class="gi-sep">·</i>')}</span>`;
}

function goalHtml(g: Game, v: GoalView, rows: string, prog: string): string {
  const step = `${v.free ? 'Free play' : 'Goal'} ${v.number} / ${v.total}`;
  const gh = ghostsHtml(performance.now());
  // (The ghost comes after the body it lies over, and the two never pass for one another: the card is patched
  // in place by position, and a body rebuilt when the ghost comes or goes would rise a second time.)
  const body = `<div class="gc-body${v.flow && !v.ready ? ' flow' : ''}${rises ? ` rise${rises % 2}` : ''}" data-key="body">`;
  if (v.ready) {
    return `<div class="gc-main">${pipsHtml(g)}${body}<div class="gc-head"><span class="gc-step">${step}</span><span class="gc-done">${icon('check', 12)}Done</span></div>
      <h3 class="gc-title">${esc(v.goal.title)}</h3>
      <div class="gc-rewards"><span class="gc-lbl">Reward</span>${rewardChips(v.reward)}</div></div>${gh.card}</div>
      <button class="claim" data-act="claim" data-testid="claim">Claim</button>${gh.press}`;
  }
  return `<div class="gc-main">${pipsHtml(g)}${body}<div class="gc-head"><span class="gc-step">${step}</span><span class="gc-rewards">${rewardChips(v.reward)}</span></div>
      <h3 class="gc-title">${esc(v.goal.title)}</h3>
      <p class="gc-hint">${esc(v.hint)}</p>
      ${prog}
      ${rows}</div>${gh.card}</div>${gh.press}`;
}

/**
 * The demo's last goal, done: what the card shows from the first Lens until the player has left the summary
 * (Keep playing). Free play does not start behind the summary.
 */
function endedHtml(g: Game): string {
  const goal = GOALS[MAIN_GOALS - 1];
  const gh = ghostsHtml(performance.now());
  return `<div class="gc-main">${pipsHtml(g, true)}<div class="gc-body${rises ? ` rise${rises % 2}` : ''}" data-key="body"><div class="gc-head"><span class="gc-step">Goal ${MAIN_GOALS} / ${MAIN_GOALS}</span><span class="gc-done">${icon('check', 12)}Done</span></div>
      <h3 class="gc-title">${esc(goal.title)}</h3>
      <div class="gc-rewards"><span class="rw new">Demo complete</span></div></div>${gh.card}</div>${gh.press}`;
}

// ---------- the ending ----------

/** Real time of the first Lens in this session (0: not seen). */
let endingFrom = 0;
/** The summary has been seen open: once it has gone again, the player has gone on (Keep playing). */
let summarySeen = false;
const NO_SUMMARY = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nosummary');

/**
 * The demo has ended and the player has not gone on into free play yet: from the first Lens until the summary
 * has been left (and behind the start screen of a save that has ended). Under `?nosummary` there is no summary
 * to leave, and free play shows as soon as the capstone is claimed.
 */
function endingHeld(g: Game): boolean {
  if (!g.ended || g.goal.i < MAIN_GOALS || NO_SUMMARY) return false;
  if (document.getElementById('app')?.classList.contains('summary-open')) {
    summarySeen = true;
    return true;
  }
  if (summarySeen) {
    summarySeen = false;
    endingFrom = 0;
  }
  return !isStarted() || endingFrom > 0;
}

function renderGoal(g: Game, force: boolean) {
  const held = endingHeld(g);
  const v = held ? null : goalView(g, isTouch());
  const narrow = isNarrow();
  setAttr(goalEl, 'data-goal', held ? GOALS[MAIN_GOALS - 1].id : v ? v.goal.id : 'none');
  setAttr(goalEl, 'data-ready', v?.ready ? '1' : '0');
  setAttr(goalEl, 'data-ending', held ? '1' : null);
  setClass(goalEl, 'done', !v && !held);
  // The adviser is asked (in its worker) whenever its last answer no longer holds, and the two rows of
  // guidance (the goal's own line, the adviser's tip) follow.
  pollAdviser(g);
  tendCard(g, v, narrow);
  // (The ring Show me puts on the Expand button goes once the board has been expanded.)
  tendMark();
  if (held) {
    setClass(goalEl, 'wait', false);
    goalPanel.render(endedHtml(g), force);
    return;
  }
  if (!v) {
    setClass(goalEl, 'wait', false);
    goalPanel.render(`<div class="gc-free">${icon('check', 13)}<span><b>Free play</b> · every goal is done. The line is yours.</span></div>`, force);
    return;
  }
  let rows = '', prog = '';
  if (!v.ready) {
    const wait = waitLine(g);
    const inputs = (v as GoalView & { inputs?: Inputs }).inputs;
    const flowView = !!v.flow;
    const lensInputs = !!inputs?.length && !!v.progress && v.progress[0] < v.progress[1] && inputs.some((x) => !x.fed);
    const body = flowView ? flowHtml(v.flow!, v.progress) : lensInputs ? inputsHtml(inputs!) : wait ? waitHtml(wait, g.paused) : v.progress ? progressHtml(v.progress) : '';
    prog = body ? `<div class="gc-prog${flowView ? ' flow' : ''}${body.includes('gc-eta') ? ' eta' : ''}">${body}</div>` : '';
    rows = lineHtml(g, narrow) + tipHtml(g);
    // A wait (what the goal asks for next has to be saved up for, or Flow has to be held): what there is to do
    // meanwhile is the line or the tip, and on a phone the hint folds behind a tap once the player has pressed the
    // board (hud.css, "phone seating"). Once it can be bought, the hint is what to do, and it is shown again.
    setClass(goalEl, 'wait', !!wait || saving(v.progress) || flowView);
  } else setClass(goalEl, 'wait', false);
  goalPanel.render(goalHtml(g, v, rows, prog), force);
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
  // (Paused, nothing sells: no time left is promised.)
  const left = !o.ready && !stuck && (g.paused || isFinite(o.eta)) ? `<span class="oc-eta${g.paused ? ' paused' : ''}" data-testid="order-eta">${g.paused ? 'paused' : aboutTime(o.eta)}</span>` : '';
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

/** A problem as the chip would name it: node, kind of problem, material. */
const problemKey = (g: Game, n: GNode) => {
  const dx = diagnose(g, n);
  return `${n.id}|${dx.problem}|${dx.mat}`;
};

/**
 * The single worst root-cause problem on the board, or null. Nothing is flagged before the first wire. `skip`: a
 * problem the player has put away (problemKey), which is passed over for the others.
 */
function worstProblem(g: Game, skip = ''): { n: GNode; text: string } | null {
  if (!g.wires.length && g.stats.wiresMade === 0) return null;
  // Two machines that are about as badly off would otherwise swap places four times a second.
  const held = alertNode >= 0 ? nodeById(g, alertNode) : null;
  const heldText = held ? problemText(g, held) : null;
  if (held && heldText && (!skip || problemKey(g, held) !== skip)) return { n: held, text: heldText };
  let worst: { n: GNode; text: string } | null = null;
  for (const n of g.nodes) {
    if (worst && worst.n.util <= n.util) continue;
    const text = problemText(g, n);
    if (text && (!skip || problemKey(g, n) !== skip)) worst = { n, text };
  }
  alertNode = worst ? worst.n.id : -1;
  return worst;
}

// ---------- the alert slot ----------
// One chip under the card, saying one thing: that the game is open in another tab, that it is paused, or the
// board's worst problem, in that order.

/** Another tab has written the save: this one no longer saves (main.ts), and the slot says so for good. */
let elsewhere = false;

/** main.ts: another tab has written the save. */
export function setElsewhere() {
  if (elsewhere) return;
  elsewhere = true;
  renderPanels(true);
}

/**
 * What the problem chip names (problemKey), and the problem the player put away by pressing the chip: it is passed
 * over (other problems are still named) until it changes, or has been gone for ALERT_CALM seconds.
 */
let alertKey = '';
let alertPut = '';
/** Game time since which the put-away problem has been gone (-1: it is still there). */
let putGone = -1;
/** What the slot showed last, for scripts: 'elsewhere', 'paused', 'problem', or '' (and why a problem was left out). */
let alertSaid: { kind: string; key?: string; left?: 'card' | 'put' } = { kind: '' };

/** The nodes a step of the line or a tip is about. */
function adviceNodes(g: Game, a: Advice | null | undefined): number[] {
  if (!a) return [];
  const out: number[] = [];
  for (const id of [a.node, a.to, a.culprit, a.wire?.from, a.wire?.to, a.favour?.router, a.cut?.from, a.cut?.to]) if (id != null) out.push(id);
  return out;
}

/**
 * Is the card already about this problem? It is when its hint or line names the node (goalFocus), or the tip on
 * offer or the line's next step is about the node or about where its trouble comes from (a starved machine's
 * supplier: "buy Speed on the Ember Well" says what "Refiner (Spark) needs more Ember" says).
 */
function cardSays(g: Game, n: GNode): boolean {
  const about = new Set<number>([n.id]);
  const culprit = diagnose(g, n).culprit;
  if (culprit != null) about.add(culprit);
  const named = [...goalFocus(g), ...adviceNodes(g, tipShown()), ...adviceNodes(g, lineShown()?.step)];
  return named.some((id) => about.has(id));
}

function renderAlert(g: Game, force: boolean) {
  let html = '';
  let kind = '';
  if (elsewhere) {
    kind = 'elsewhere';
    html = `<button class="alertchip notice" data-act="reload" data-testid="other-tab"><span class="dot"></span><span class="al-txt">This game is open in another tab. Reload to continue here.</span><span class="al-go">Reload</span></button>`;
    alertSaid = { kind };
  } else if (g.paused) {
    // Paused (the P key, the pause button, or a save that was paused): said where it cannot be missed, and one press goes on.
    kind = 'paused';
    html = `<button class="alertchip paused" data-act="resume" data-testid="paused-pill" aria-label="Paused. Resume the game"><span class="pz-ico">${icon('pause', 14)}</span><span class="al-txt"><b>Paused</b></span><span class="al-go">${icon('play', 12)}Resume</span></button>`;
    alertSaid = { kind };
  } else {
    // A problem the player put away stays away while it is the same problem on the same node: once that node has
    // another problem, it is news; once it has had none for a while, it may be named again if it comes back.
    if (alertPut) {
      const put = nodeById(g, Number(alertPut.split('|')[0]));
      const now = put && problemText(g, put) ? problemKey(g, put) : '';
      if (now === alertPut) putGone = -1;
      else if (now) alertPut = '';
      else if (putGone < 0) putGone = g.time;
      else if (g.time - putGone > ALERT_CALM) alertPut = '';
    }
    const worst = worstProblem(g, alertPut);
    const key = worst ? problemKey(g, worst.n) : '';
    alertKey = key;
    const left = !worst ? undefined : cardSays(g, worst.n) ? 'card' : undefined;
    alertSaid = { kind: worst && !left ? 'problem' : '', key, left };
    if (worst && !left) {
      kind = 'problem';
      html = `<button class="alertchip" data-act="jump:${worst.n.id}" data-testid="alert-chip"><span class="dot ${worst.n.status}"></span><span class="al-txt">${worst.text}</span><span class="al-go">Show</span></button>`;
    }
  }
  setHidden(alertEl, !html);
  setAttr(alertEl, 'data-kind', kind || null);
  if (html) alertPanel.render(html, force);
}

/** Game seconds without a problem after which one the player put away is shown again if it comes back. */
const ALERT_CALM = 10;

/** For scripts: what the alert slot says, why a problem was left out ('card': the card says it), and the problem put away. */
export const alertState = () => ({ ...alertSaid, put: alertPut || null });

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
  const overTech = ui.techOpen && g.goal.ready;
  setClass(stripEl, 'over-tech', overTech);
  setClass(stripEl, 'tight', isTight());
  setClass(stripEl, 'stack', isStacked());
  // What the strip holds, for the stylesheet (classes here are far cheaper to match than has() selectors).
  const order = !orderEl.hasAttribute('hidden'), alert = !alertEl.hasAttribute('hidden');
  setClass(stripEl, 'has-order', order);
  setClass(stripEl, 'has-alert', alert);
  setClass(stripEl, 'stuck', order && orderEl.dataset.stuck === '1');
  // The keyboard belongs to the tree while it is open (Enter researches there): nothing in the strip keeps the
  // focus under it. The slim bar over the tree is not under it: its Claim may hold the focus and answer a key.
  const focused = document.activeElement as HTMLElement | null;
  if (ui.techOpen && focused && stripEl.contains(focused) && !(overTech && goalEl.contains(focused))) focused.blur();
  // A claim made from the keyboard: the focus goes to the new card, or back into the tree while it covers the card.
  if (focusAfter) {
    focusAfter = false;
    const into = ui.techOpen && !overTech
      ? document.querySelector<HTMLElement>(`#tech [data-key="${ui.techSel ?? ''}"]`) ?? document.querySelector<HTMLElement>('#tech [data-testid="close-tech"]')
      : goalEl;
    into?.focus({ preventScroll: true });
  }
  // The anchors are pointed at what is on screen whenever the layout of the strip may have changed.
  const claim = goalEl.querySelector('[data-testid="claim"]');
  const held = !claim && !!stand && performance.now() < standUntil;
  const key = `${g.goal.i}|${claim ? 1 : 0}|${g.order ? 1 : 0}${g.order?.ready ? 1 : 0}|${alert ? 1 : 0}|${ui.techOpen ? 1 : 0}|${tipShown() ? 1 : 0}${lineShown() ? 1 : 0}|${held ? 1 : 0}|${hudWidth}`;
  if (key !== anchorKey) {
    anchorKey = key;
    setAnchor('goal', claim ?? (held ? stand! : goalEl));
    setAnchor('order', orderEl);
  }
}

/** For scripts: where an effect would start from. */
export const hudAnchors = () => ({ goal: anchorPt('goal'), order: anchorPt('order'), flow: anchorPt('flow') });

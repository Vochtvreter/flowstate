// The Flow ring: a ring around the credits coin with the price bonus beside it. Owned by the HUD track.
//
// Hidden until the Flow meter is unlocked. The arc is stepped with the panels (four times a second)
// and only written when its whole-percent value changes: no transition, nothing per frame.
// #app carries the class `flow-state` while Flow State is on; the feel module styles the rest.
import { NODE_DEFS, RECIPES, MATERIALS } from '../content';
import { flowInfo, inFlowState, worstProducer } from '../flow';
import { Game } from '../state';
import { jumpTo } from './board';
import { el, invalidateLayout, setAnchor, setAttr, setClass, setHidden, setStyle, setText } from './dom';
import { isTouch } from './hud-words';
import { onPress, toast, ui } from './ui';

let app: HTMLElement;
let btn: HTMLElement;
let ringEl: SVGElement;
let arc: SVGElement;
let pct: HTMLElement;

/** Wrap the coin of the credits chip in the ring button and add the bonus label after the numbers. */
export function initFlowRing() {
  app = document.getElementById('app')!;
  const chip = document.querySelector<HTMLElement>('#top .res.credits');
  const coin = chip?.querySelector<HTMLElement>('.sym');
  if (!chip || !coin) return;
  btn = el(`<button class="flowbtn" type="button" tabindex="-1" aria-label="Flow">
    <svg class="flowring" viewBox="0 0 36 36" width="36" height="36" aria-hidden="true" hidden><circle class="fr-trk" cx="18" cy="18" r="16"/><circle class="fr-val" cx="18" cy="18" r="16" pathLength="100"/></svg></button>`);
  chip.insertBefore(btn, coin);
  btn.appendChild(coin);
  ringEl = btn.querySelector<SVGElement>('.flowring')!;
  arc = btn.querySelector<SVGElement>('.fr-val')!;
  pct = el(`<span class="flowpct mono" hidden></span>`);
  chip.appendChild(pct);
  setAnchor('flow', ringEl);
  onPress(btn, () => {
    const g = ui.g;
    if (!g.flowOn) return;
    const worst = worstProducer(g);
    if (worst) jumpTo(worst.id);
    else toast('Everything is flowing', 'good');
  });
}

const producerName = (g: Game, id: number) => {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) return '';
  if (n.type === 'well') return `${n.material ? MATERIALS[n.material].name + ' ' : ''}Well`;
  return `${NODE_DEFS[n.type].name}${n.recipe && RECIPES[n.recipe] ? ` (${RECIPES[n.recipe].name})` : ''}`;
};

/** Called with every panel refresh. */
export function updateFlowRing(g: Game) {
  if (!btn) return;
  const f = flowInfo(g);
  setClass(app, 'flow-state', inFlowState(g));
  if (setHidden(ringEl, !f.on)) {
    // The ring has appeared or gone: effects that fly to it must measure it afresh.
    setAnchor('flow', ringEl);
    invalidateLayout();
  }
  setHidden(pct, !f.on);
  setClass(btn, 'on', f.on);
  setAttr(btn, 'data-testid', f.on ? 'flow-ring' : null);
  setAttr(btn, 'tabindex', f.on ? '0' : '-1');
  if (!f.on) {
    setAttr(btn, 'title', null);
    return;
  }
  const v = Math.round(Math.max(0, Math.min(1, f.flow)) * 100);
  setStyle(arc, 'stroke-dasharray', `${v} 100`);
  setAttr(btn, 'data-flow', String(v));
  const bonus = Math.round(f.bonus * 100);
  setText(pct, `+${bonus}%`);
  const worst = f.flowing < f.producers ? worstProducer(g) : null;
  const jump = worst ? ` ${isTouch() ? 'Tap' : 'Click'} to jump to the ${producerName(g, worst.id)} holding it back.` : '';
  const label = `Flow ${v}%: ${f.flowing} of ${f.producers} Wells and machines are running flat out, so every sale pays +${bonus}%.${jump}`;
  setAttr(btn, 'title', label);
  setAttr(btn, 'aria-label', label);
}

// Simulation events to toasts, and where toasts sit. Owned by the HUD track.
//
// A toast is for what nothing else on screen says at that moment. So there is none for:
//  - a goal turning ready or being claimed (the goal card; the celebration);
//  - a material made for the first time while its own goal is on the card (the card turns to "Done", and the
//    big ones get a celebration card when claimed): Shard, Ink, Spark, Glyph, Mist, Prism, Lens and the rest;
//  - a tech that came with a goal (the reward chip named it, the celebration says "… unlocked");
//  - Orders and the Flow meter switching on (the celebration card and the next goal card say so, and the
//    order chip and the ring appear);
//  - the first Flow State (its own card);
//  - an order arriving, filling or being paid while its chip is on show (the chip says all three).
// What is left: refusals, the answer to a press that has no other (a refund, "Upgraded 3 Refiners"), a
// tech the queue researched while the tree was shut, a first material that is not what the card is about,
// an order that filled behind the open tech tree, and the one-off introduction of demand.
import { DATA_COLORS, DATA_NAMES, DataTier, MATERIALS, MatId, RULES, TECHS } from '../content';
import { fmt } from '../economy';
import { GOALS } from '../goals';
import { GameEvent, Order, Reward } from '../state';
import { pressWord } from './hud-words';
import { esc, icon, matGlyph } from './icons';
import { env } from './phone-env';
import { onBeat, toast, ui } from './ui';

/** "+45¢ +30α", each part in its own colour. */
export function payHtml(r: Reward): string {
  const parts: string[] = [];
  if (r.credits) parts.push(`<span class="mono" style="color:#FFC857">+${fmt(r.credits)}¢</span>`);
  for (const k of ['a', 'b', 'g'] as DataTier[]) {
    if (r[k]) parts.push(`<span class="mono" style="color:${DATA_COLORS[k]}">+${fmt(r[k]!)}${DATA_NAMES[k]}</span>`);
  }
  return parts.join(' ');
}

/** The goal whose card is about making (or first selling) this material: "Make your first Spark" for Spark. -1 when there is none. */
const goalAbout = (m: MatId) => GOALS.findIndex((x) => x.id === (m === 'shard' ? 'sell-shard' : `make-${m}`));

/**
 * Is the goal card saying this right now? The material's own goal is the one on the card (it has just turned
 * to "Done"), or, for Shard, the card is still on its way there: "Build a Refiner", then "Sell your first Shard".
 */
function cardSays(m: MatId): boolean {
  const i = goalAbout(m);
  if (i < 0) return false;
  return m === 'shard' ? ui.g.goal.i <= i : ui.g.goal.i === i;
}

const orderWords = (o: Order) => `${o.need} ${MATERIALS[o.mat].name}`;

export function toastFor(ev: GameEvent) {
  switch (ev.kind) {
    case 'milestone':
      // A by-product nobody wants (Silt) is not an achievement: no toast for junk.
      if (MATERIALS[ev.mat].value < RULES.orders.junkValue) break;
      // The goal card is about exactly this and has just turned to "Done": it needs no echo.
      if (cardSays(ev.mat)) break;
      toast(`${matGlyph(ev.mat, 18)}<span><b>First ${MATERIALS[ev.mat].name}!</b></span>`, 'good', 3500);
      break;
    case 'tech': {
      const t = TECHS[ev.id];
      // It came with a goal (the reward chip named it), or with the first surplus (that toast names it).
      if (!t || t.auto) break;
      // Researched in the open tech tree: the tree shows it there and then, and a toast would only be in its way.
      if (ui.techOpen) break;
      // What is left is a tech the queue researched while the player was on the board.
      toast(`${icon('tree', 16)}<span><b>${esc(t.name)}</b> researched: ${esc(t.unlocks.join(', '))}</span>`, 'good', 5000);
      break;
    }
    case 'toast':
      toast(esc(ev.text), 'bad');
      break;
    case 'unlock':
      // Orders and the Flow meter arrive with a claim: the celebration names them, the next goal card explains
      // them, and the order chip or the ring appears. Anything this file has not met still gets its line.
      if (ev.what !== 'orders' && ev.what !== 'flow') toast(esc((ev as { text: string }).text), 'good', 5000);
      break;
    case 'order-ready':
      // The chip turns green and grows a Claim button. Only behind the open tech tree, where the chip cannot
      // be seen, is the player told.
      if (ui.techOpen) toast(`${matGlyph(ev.order.mat, 18)}<span><b>Order filled:</b> ${orderWords(ev.order)}. Claim it on the board.</span>`, 'good', 4500);
      break;
    case 'surplus':
      // The first time anything sells over its demand: the rule in one sentence, and what the player has just
      // been given for it. From here on the Market inspector shows its gauges (hud-market.ts).
      toast(`${matGlyph(ev.mat, 18)}<span>${esc(ev.text)} <b>${esc(TECHS.C1?.name ?? 'Market Lens')}</b> is now yours: ${pressWord()} a Market to see how much of each thing it wants.</span>`, 'info', 10000);
      break;
    default:
      // 'order-new' and 'order-claimed' are the order chip's to show; goals and Flow State have their cards.
      break;
  }
}

// ---------- where toasts sit ----------
// The layout is CSS (hud.css, "toasts"): under the strip on a phone, docked at the bottom left of the stage
// elsewhere. Two things CSS cannot do are done here: no more than three toasts at once (two on a phone), the
// oldest making way, and stepping up when the board's Expand button happens to lie where the toasts are.

/** At most this many toasts at once. */
const maxToasts = () => (env.phone ? 2 : 3);

export function initToastDock(host: HTMLElement) {
  if (typeof MutationObserver === 'undefined') return;
  let up = 0;
  const clearExpand = () => {
    let want = 0;
    const expand = host.childElementCount && !env.phone ? document.getElementById('expand') : null;
    const e = expand?.getBoundingClientRect();
    if (e && e.width > 0) {
      // Where the toasts would be without the step up (so the answer cannot flip-flop), from layout boxes:
      // a toast that is still sliding in counts where it will come to rest.
      const h = host.getBoundingClientRect();
      let x0 = Infinity, x1 = -Infinity;
      for (const t of Array.from(host.children) as HTMLElement[]) {
        if (!t.offsetWidth) continue;
        x0 = Math.min(x0, h.left + t.offsetLeft);
        x1 = Math.max(x1, h.left + t.offsetLeft + t.offsetWidth);
      }
      const y0 = h.top + up, y1 = h.bottom + up;
      if (x0 < e.right && x1 > e.left && y0 < e.bottom + 8 && y1 > e.top - 8) want = Math.max(0, Math.round(y1 - e.top + 10));
    }
    if (want === up) return;
    up = want;
    host.style.setProperty('--toast-up', `${up}px`);
  };
  new MutationObserver(() => {
    while (host.childElementCount > maxToasts()) host.firstElementChild!.remove();
    clearExpand();
  }).observe(host, { childList: true });
  // The camera may move while a toast is up.
  onBeat(() => {
    if (host.childElementCount || up) clearExpand();
  });
}

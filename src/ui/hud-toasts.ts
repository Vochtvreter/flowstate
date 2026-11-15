// Simulation events to toasts: at most one toast per event. Owned by the HUD track.
//
// Goals are deliberately silent here: the goal card shows 'goal-ready', and the celebration covers
// 'goal-claimed', 'flow-state' and 'demo-end'.
import { DATA_COLORS, DATA_NAMES, DataTier, MATERIALS, RULES, TECHS } from '../content';
import { fmt } from '../economy';
import { GameEvent, Order, Reward } from '../state';
import { PressWord } from './hud-words';
import { esc, icon, matGlyph } from './icons';
import { toast, ui } from './ui';

/** "+45¢ +30α", each part in its own colour. */
export function payHtml(r: Reward): string {
  const parts: string[] = [];
  if (r.credits) parts.push(`<span class="mono" style="color:#FFC857">+${fmt(r.credits)}¢</span>`);
  for (const k of ['a', 'b', 'g'] as DataTier[]) {
    if (r[k]) parts.push(`<span class="mono" style="color:${DATA_COLORS[k]}">+${fmt(r[k]!)}${DATA_NAMES[k]}</span>`);
  }
  return parts.join(' ');
}

const orderWords = (o: Order) => `deliver <b>${o.need} ${MATERIALS[o.mat].name}</b>`;

/** An order that was already announced together with what caused it (an unlock, or the claim before it). */
let announced: Order | null = null;

export function toastFor(ev: GameEvent) {
  switch (ev.kind) {
    case 'milestone':
      // A by-product nobody wants (Silt) is not an achievement: no toast for junk.
      if (MATERIALS[ev.mat].value < RULES.orders.junkValue) break;
      toast(`${matGlyph(ev.mat, 18)}<span><b>First ${MATERIALS[ev.mat].name}!</b></span>`, 'good', 3500);
      break;
    case 'tech': {
      const t = TECHS[ev.id];
      // Researched in the open tech tree: the tree shows it there and then, and a toast would only be in its way.
      if (ui.techOpen) break;
      if (t) toast(`${icon('tree', 16)}<span><b>${esc(t.name)}</b> unlocked: ${esc(t.unlocks.join(', '))}</span>`, 'good', 5000);
      break;
    }
    case 'toast':
      toast(esc(ev.text), 'bad');
      break;
    case 'unlock': {
      if (ev.what === 'orders') {
        // The first order arrives with the unlock: say both in one breath.
        const o = ui.g.order;
        announced = o;
        toast(`<span><b>Orders unlocked.</b> Sell what an order asks for and it pays in Data.${o ? ` First one: ${orderWords(o)}.` : ''}</span>`, 'good', 6000);
      } else if (ev.what === 'flow') {
        toast(`<span><b>Flow meter unlocked.</b> The more of your line runs flat out, the more every sale pays.</span>`, 'good', 6000);
      } else toast(esc((ev as { text: string }).text), 'good', 5000);
      break;
    }
    case 'order-new':
      if (ev.quiet || ev.order === announced) break;
      toast(`${matGlyph(ev.order.mat, 18)}<span><b>New order:</b> ${orderWords(ev.order)}</span>`, 'info', 4000);
      break;
    case 'order-ready':
      toast(`${matGlyph(ev.order.mat, 18)}<span><b>Order filled.</b> ${PressWord()} Claim on the order to get paid.</span>`, 'good', 4500);
      break;
    case 'order-claimed': {
      // Claiming rolls the next order at once: one toast covers both.
      const next = ui.g.order;
      announced = next && next !== ev.order ? next : null;
      toast(`<span><b>Order delivered:</b> ${payHtml(ev.reward)}${announced ? `<span class="muted"> · next: ${orderWords(announced)}</span>` : ''}</span>`, 'good', 4500);
      break;
    }
    case 'surplus':
      // The first time anything sells over its demand. From here on the Market inspector shows its gauges.
      toast(`${matGlyph(ev.mat, 18)}<span>${esc(ev.text)} Select a Market to see how much it wants.</span>`, 'info', 8000);
      break;
    default:
      break;
  }
}

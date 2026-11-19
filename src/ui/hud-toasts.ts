// Simulation events to toasts, and where toasts sit. Part of the HUD.
//
// A toast is for what nothing else on screen says at that moment. So there is none for:
//  - a goal turning ready or being claimed (the goal card; the celebration);
//  - a material made for the first time while its own goal is on the card (the card turns to "Done", and the
//    big ones get a celebration card when claimed): Glass, Plastic, Copper, Circuit, Silicon, Screen, Phone and the rest;
//  - a tech that came with a goal (the reward chip named it, the celebration says "… unlocked");
//  - Orders and the Flow meter switching on (the celebration card and the next goal card say so, and the
//    order chip and the ring appear);
//  - the first Flow State (its own card);
//  - an order arriving, filling or being paid while its chip is on show (the chip says all three).
// What is left: refusals, the answer to a press that has no other (a refund, "Upgraded 3 Refiners"), a
// tech the queue researched while the tree was shut, a first material that is not what the card is about,
// an order that filled behind the open tech tree, and the one-off introduction of demand.
import { MATERIALS, MatId, RULES, TECHS } from '../content';
import { GOALS } from '../goals';
import { GameEvent, Order } from '../state';
import { pressWord } from './hud-words';
import { esc, icon, matGlyph } from './icons';
import { env } from './phone-env';
import { onBeat, toast, ui } from './ui';

/** The goal whose card is about making (or first selling) this material: "Make your first Copper" for Copper. -1 when there is none. */
const goalAbout = (m: MatId) => GOALS.findIndex((x) => x.id === (m === 'shard' ? 'sell-shard' : `make-${m}`));

/**
 * Is the goal card saying this right now? The material's own goal is the one on the card (it has just turned
 * to "Done"), or, for Glass, the card is still on its way there: "Build a Refiner", then "Sell your first Glass".
 */
function cardSays(m: MatId): boolean {
  const i = goalAbout(m);
  if (i < 0) return false;
  return m === 'shard' ? ui.g.goal.i <= i : ui.g.goal.i === i;
}

const orderWords = (o: Order) => `${o.need} ${MATERIALS[o.mat].name}`;

/** The tech whose research gets a card of its own (the one the goal card was saving for), or null. */
let researchCard: () => string | null = () => null;

/**
 * feel.ts says which research its card covers (researchCardTech), so that no toast says it as well. (Handed in, not
 * imported: feel.ts brings the board with it, and this file is loaded by modules that are tested without a page.)
 */
export function setResearchCard(fn: () => string | null) {
  researchCard = fn;
}

export function toastFor(ev: GameEvent) {
  switch (ev.kind) {
    case 'milestone':
      // A by-product nobody wants (Tar) is not an achievement: no toast for junk.
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
      // The goal card was saving for it: the research card (feel.ts) says so. (Toasts run before feel's frame
      // hook, so this reads the tech as of the end of the last frame, which is the one the card will name.)
      if (ev.id === researchCard()) break;
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
// elsewhere. What CSS cannot do is done here, looked at again whenever the toasts change and on the beat while any is
// up (the camera, a sheet or the tree may move what lies around them):
//  - no more than three toasts at once (two on a phone), the oldest making way;
//  - outside the phone layout, the room kept at the bottom right is what the zoom buttons and the minimap really take
//    there (--toast-r: the cluster grows a Tidy button, and a finger's buttons are bigger), and the toasts step up
//    when the board's Expand button happens to lie where they are (--toast-up);
//  - on a phone, they keep clear of what lies over the board under the strip: the docked Expand button, the floating
//    buttons, the "tap where" line, Claim in the thumb row, an open sheet, the tree's detail sheet. They start below
//    what stands right under the strip (--toast-top), keep to the side of the stage that is free beside the rest
//    (--toast-x0 and --toast-x1, from the stage's edges), and the oldest waits out of sight (class `crowd`) while
//    there is not room for both.

/** At most this many toasts at once. */
const maxToasts = () => (env.phone ? 2 : 3);

interface Box { left: number; top: number; right: number; bottom: number }

/** An element's box when it is on show (null when it is not laid out, hidden, or see-through). */
function shownBox(e: Element | null): Box | null {
  if (!e || (e as HTMLElement).hidden) return null;
  const r = e.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  for (let x: Element | null = e; x && x !== document.body; x = x.parentElement) {
    const cs = getComputedStyle(x);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null;
  }
  return r;
}

/**
 * On a phone: what toasts must not lie over, in client pixels, and how far down they may reach (`floor`). Under the
 * open tech tree the board and its controls are covered: there it is the tree's detail sheet.
 */
function phoneObstacles(): { boxes: Box[]; floor: number } {
  const boxes: Box[] = [];
  const add = (e: Element | null) => {
    const b = shownBox(e);
    if (b) boxes.push(b);
  };
  if (!ui.techOpen) {
    add(document.getElementById('expand'));
    document.querySelectorAll('#fabs .fab').forEach(add);
    add(document.getElementById('tap-hint'));
    if (document.getElementById('goal')?.getAttribute('data-ready') === '1') add(document.querySelector('#goal .claim'));
  }
  // A sheet across the foot of the stage ends the room toasts have; one at the side is in the way like the rest.
  const stage = document.getElementById('stage')?.getBoundingClientRect();
  let floor = (stage?.bottom ?? innerHeight) - 8;
  const sheets = ui.techOpen ? ['#tech .tdetail'] : ['#insp.open', '#build-sheet.open'];
  for (const sel of sheets) {
    const b = shownBox(document.querySelector(sel));
    if (!b) continue;
    if (stage && b.right - b.left >= (stage.right - stage.left) * 0.7) floor = Math.min(floor, b.top - 8);
    else boxes.push(b);
  }
  return { boxes, floor };
}

/** Space kept between a toast and what it keeps clear of, and the narrowest a toast is made to keep clear (px). */
const TOAST_GAP = 8;
const TOAST_MIN_W = 200;

export function initToastDock(host: HTMLElement) {
  if (typeof MutationObserver === 'undefined') return;
  let up = 0, right = 0;
  let phoneKey = '';
  const set = (name: string, px: number | null) => {
    if (px == null) host.style.removeProperty(name);
    else host.style.setProperty(name, `${Math.round(px)}px`);
  };
  /** Outside the phone layout: the zoom buttons' (and the minimap's) real room, and Expand where the toasts are. */
  const dockWide = () => {
    let wantR = 0;
    const stage = document.getElementById('stage')?.getBoundingClientRect();
    if (host.childElementCount && stage) {
      let left = Infinity;
      for (const id of ['zoom', 'mini']) {
        const b = shownBox(document.getElementById(id));
        if (b && b.bottom > stage.bottom - 260) left = Math.min(left, b.left);
      }
      if (left < Infinity) wantR = stage.right - left + 16;
    }
    if (wantR !== right) {
      right = wantR;
      set('--toast-r', right || null);
    }
    let want = 0;
    const expand = host.childElementCount ? document.getElementById('expand') : null;
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
    set('--toast-up', up);
  };
  /**
   * The room kept for toasts at the foot of the phone tree's list of tiles (px; 0: none). The tree reads it as
   * --toast-room (tech.css): its list ends that much higher while toasts are up, so they lie in a gap of their own.
   */
  let treeRoom = 0;
  const setTreeRoom = (px: number) => {
    if (px === treeRoom) return;
    treeRoom = px;
    const tech = document.getElementById('tech');
    if (!tech) return;
    if (px) tech.style.setProperty('--toast-room', `${Math.round(px)}px`);
    else tech.style.removeProperty('--toast-room');
  };
  /**
   * On a phone with the tech tree open (it covers the whole screen): toasts lay over its tiles.
   * They go in a room of their own at the foot of the list of tiles instead, which ends that much higher for as long as
   * they are up: above the detail sheet, or the foot of the screen; on a phone held sideways, at the foot of the list's
   * column, beside the detail. Never over a tile, the tabs, the detail or its Research button. The newest that fit in
   * half the list's height show; older ones wait out of sight. (hud.css: the column is fixed to the screen here, since
   * the tree reaches past the stage that holds the toasts.) False when the tree has no list to make room in.
   */
  const dockTree = (toasts: HTMLElement[]): boolean => {
    const list = shownBox(document.querySelector('#tech .tree'));
    if (!list) return false;
    // (Where the list would end with no room kept for toasts.)
    const bottom = list.bottom + treeRoom;
    const x0 = list.left + 8, x1 = list.right - 8;
    const key = `tree|${toasts.map((t) => toastIds.get(t) ?? (toastIds.set(t, ++toastSeq), toastSeq)).join(',')}|${Math.round(x0)},${Math.round(x1)},${Math.round(list.top)},${Math.round(bottom)}`;
    if (key === phoneKey) return true;
    phoneKey = key;
    for (const t of toasts) setClassOn(t, 'crowd', false);
    set('--toast-x0', x0);
    set('--toast-x1', innerWidth - x1);
    set('--toast-top', bottom);
    const hs = toasts.map((t) => t.offsetHeight);
    const stack = (n: number) => hs.slice(hs.length - n).reduce((a, h) => a + h, 0) + TOAST_GAP * (n - 1);
    let n = toasts.length;
    while (n > 1 && stack(n) > Math.max(60, (bottom - list.top) * 0.5)) n--;
    const height = stack(n);
    set('--toast-top', bottom - TOAST_GAP - height);
    setTreeRoom(height + TOAST_GAP * 2);
    toasts.forEach((t, i) => setClassOn(t, 'crowd', i < toasts.length - n));
    return true;
  };
  /**
   * On a phone: under the strip, clear of what lies over the board there. The toasts' column (hud.css: absolute in
   * the stage, from --toast-top down, between --toast-x0 and --toast-x1) goes in the first place, from the strip down,
   * where it lies over none of it: at its natural place right under the strip, or just below something that stands in
   * the way, in the widest free stretch across (never narrower than TOAST_MIN_W). Where all of them do not fit, the
   * oldest waits out of sight (`crowd`). Where not even the newest fits anywhere, it stands at its natural place. With
   * the tech tree open, in the room dockTree keeps at the foot of its list.
   */
  const dockPhone = () => {
    const toasts = (Array.from(host.children) as HTMLElement[]).filter((t) => !t.classList.contains('out'));
    const stage = document.getElementById('stage')?.getBoundingClientRect();
    if (!toasts.length || !stage) {
      // (The last ones are fading out where they stand: their place, and the room kept for them, stay until they have gone.)
      if (host.childElementCount && stage) return;
      setTreeRoom(0);
      if (phoneKey) {
        phoneKey = '';
        for (const n of ['--toast-top', '--toast-x0', '--toast-x1']) set(n, null);
      }
      return;
    }
    if (ui.techOpen && dockTree(toasts)) return;
    setTreeRoom(0);
    const stripEl = document.getElementById('hud-strip');
    const strip = stripEl?.getBoundingClientRect();
    const { boxes, floor } = phoneObstacles();
    const natural = (strip && strip.height > 0 ? strip.bottom : stage.top + 8) + 6;
    // How high they may go: no higher than their natural place, except over the open tree, whose strip is hidden
    // behind it (unless a ready goal's bar rides over it): there, as high as the tree's own header, tabs and goal.
    let ceiling = natural;
    if (ui.techOpen && !stripEl?.classList.contains('over-tech')) {
      ceiling = stage.top + 8;
      for (const sel of ['#tech .thead', '#tech .ttabs', '#tech .tgoal']) {
        const b = shownBox(document.querySelector(sel));
        if (b) ceiling = Math.max(ceiling, b.bottom + 6);
      }
    }
    // (Nothing to do when nothing has moved since the last look, and the toasts are the same ones.)
    const ids = toasts.map((t) => {
      let id = toastIds.get(t);
      if (id == null) toastIds.set(t, (id = ++toastSeq));
      return id;
    });
    const key = `${ids.join(',')}|${Math.round(natural)}|${Math.round(ceiling)}|${Math.round(floor)}|${boxes.map((b) => `${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}`).join(';')}`;
    if (key === phoneKey) return;
    phoneKey = key;
    const L = stage.left + 8, R = stage.right - 8;
    const minW = Math.min(TOAST_MIN_W, R - L);
    const place = (y: number, x0: number, x1: number) => {
      set('--toast-top', y - stage.top);
      set('--toast-x0', x0 - stage.left);
      set('--toast-x1', stage.right - x1);
    };
    const heights = (y: number, x0: number, x1: number) => {
      place(y, x0, x1);
      return toasts.map((t) => t.offsetHeight);
    };
    /** The stack of the newest n toasts. */
    const stack = (hs: number[], n: number) => hs.slice(hs.length - n).reduce((a, h) => a + h, 0) + TOAST_GAP * (n - 1);
    /** The widest stretch across [L, R] that nothing lies over between y0 and y1 (with the gap kept). */
    const stretch = (y0: number, y1: number): { x0: number; x1: number } | null => {
      const cuts = boxes.filter((b) => b.top - TOAST_GAP < y1 && b.bottom + TOAST_GAP > y0)
        .map((b) => [b.left - TOAST_GAP, b.right + TOAST_GAP]).sort((a, c) => a[0] - c[0]);
      let best: { x0: number; x1: number } | null = null, x = L;
      for (const [a, b] of [...cuts, [R, R]]) {
        const seg = { x0: x, x1: Math.min(a, R) };
        if (seg.x1 - seg.x0 >= minW && (!best || seg.x1 - seg.x0 > best.x1 - best.x0)) best = seg;
        x = Math.max(x, b);
      }
      return best;
    };
    for (const t of toasts) setClassOn(t, 'crowd', false);
    // Where the column may start: right under the strip, or just below anything that lies in the way further down.
    const starts = [natural, ...boxes.filter((b) => b.bottom + TOAST_GAP > natural && b.top < floor).map((b) => b.bottom + TOAST_GAP)]
      .sort((a, c) => a - c).filter((y, i, a) => i === 0 || y - a[i - 1] > 1);
    let best: { y: number; x0: number; x1: number; n: number } | null = null;
    for (const start of starts) {
      for (let n = toasts.length; n >= 1 && !best; n--) {
        let y = start, x0 = L, x1 = R;
        let hs = heights(y, x0, x1);
        // (Narrower, a toast may grow taller and meet something more: looked at again.)
        for (let pass = 0; pass < 3; pass++) {
          // Past the floor, they come up to end on it, where they may.
          if (y + stack(hs, n) > floor) y = Math.max(ceiling, Math.min(y, floor - stack(hs, n)));
          const seg = stretch(y, y + stack(hs, n));
          if (!seg) break;
          if (seg.x0 === x0 && seg.x1 === x1) {
            if (y + stack(hs, n) <= floor) best = { y, x0, x1, n };
            break;
          }
          x0 = seg.x0;
          x1 = seg.x1;
          hs = heights(y, x0, x1);
        }
      }
      if (best) break;
    }
    best ??= { y: natural, x0: L, x1: R, n: 1 };
    place(best.y, best.x0, best.x1);
    const { n } = best;
    toasts.forEach((t, i) => setClassOn(t, 'crowd', i < toasts.length - n));
  };
  const dock = () => {
    if (env.phone) return dockPhone();
    setTreeRoom(0);
    dockWide();
  };
  new MutationObserver(() => {
    while (host.childElementCount > maxToasts()) host.firstElementChild!.remove();
    dock();
  }).observe(host, { childList: true });
  // The tech tree opening or closing moves the toasts between the board and the tree's room (on a phone the column is
  // placed on the screen while the tree is open, on the stage otherwise): they are placed again at once, not a beat later.
  const appEl = document.getElementById('app');
  let treeWas = !!appEl?.classList.contains('tech-open');
  if (appEl) {
    new MutationObserver(() => {
      const tree = appEl.classList.contains('tech-open');
      if (tree === treeWas) return;
      treeWas = tree;
      phoneKey = '';
      if (host.childElementCount || treeRoom) dock();
    }).observe(appEl, { attributes: true, attributeFilter: ['class'] });
  }
  // The camera may move while a toast is up, and so may what lies around them.
  onBeat(() => {
    if (host.childElementCount || up || right || phoneKey) dock();
  });
}

/** Each toast's number, for telling whether the toasts on show are still the same ones. */
const toastIds = new WeakMap<Element, number>();
let toastSeq = 0;

/** classList.toggle that says whether it changed anything. */
function setClassOn(e: Element, cls: string, on: boolean) {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

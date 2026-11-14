// Small DOM helpers shared by the board and the panels: write-if-changed setters,
// an in-place HTML patcher, a panel wrapper that never rebuilds under a finger,
// and cached screen positions of HUD elements.

const SVGNS = 'http://www.w3.org/2000/svg';

export const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

export const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

// ---------- write only when the value changed ----------
// The last written value is remembered on the element, so nothing is ever read back from the DOM.

type Cache = Record<string, string | boolean | null>;
const cacheOf = (e: Element): Cache => ((e as unknown as { _fc?: Cache })._fc ??= {});

export function setText(e: Element, text: string): boolean {
  const c = cacheOf(e);
  if (c.t === text) return false;
  c.t = text;
  e.textContent = text;
  return true;
}

/** innerHTML, skipped when the string is the one already written. */
export function setHTML(e: Element, html: string): boolean {
  const c = cacheOf(e);
  if (c.h === html) return false;
  c.h = html;
  e.innerHTML = html;
  return true;
}

export function setAttr(e: Element, name: string, value: string | null): boolean {
  const c = cacheOf(e);
  const key = 'a:' + name;
  if (c[key] === value) return false;
  c[key] = value;
  if (value == null) e.removeAttribute(name);
  else e.setAttribute(name, value);
  return true;
}

export function setClass(e: Element, name: string, on: boolean): boolean {
  const c = cacheOf(e);
  const key = 'c:' + name;
  if (c[key] === on) return false;
  c[key] = on;
  e.classList.toggle(name, on);
  return true;
}

export function setStyle(e: HTMLElement | SVGElement, prop: string, value: string): boolean {
  const c = cacheOf(e);
  const key = 's:' + prop;
  if (c[key] === value) return false;
  c[key] = value;
  e.style.setProperty(prop, value);
  return true;
}

/** Show or hide with the `hidden` attribute (the stylesheet makes it win over display rules). */
export const setHidden = (e: Element, hidden: boolean) => setAttr(e, 'hidden', hidden ? '' : null);

// ---------- patch HTML in place ----------

function sameKind(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  return a.nodeName === b.nodeName && (a as Element).getAttribute('data-key') === (b as Element).getAttribute('data-key');
}

function patchAttrs(a: Element, b: Element) {
  const next = b.attributes;
  for (let i = 0; i < next.length; i++) {
    const at = next[i];
    if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
  }
  const cur = a.attributes;
  if (cur.length !== next.length) {
    for (let i = cur.length - 1; i >= 0; i--) if (!b.hasAttribute(cur[i].name)) a.removeAttribute(cur[i].name);
  }
}

function patchChildren(parent: Node, from: Node) {
  let a = parent.firstChild;
  let b = from.firstChild;
  while (b) {
    const nextB = b.nextSibling;
    if (!a) parent.appendChild(b);
    else if (sameKind(a, b)) {
      if (a.nodeType === 1) {
        patchAttrs(a as Element, b as Element);
        patchChildren(a, b);
      } else if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
      a = a.nextSibling;
    } else {
      // Different kind of node here: swap it in. The old one, if still needed, is rebuilt further on.
      parent.replaceChild(b, a);
      a = b.nextSibling;
    }
    b = nextB;
  }
  while (a) {
    const next = a.nextSibling;
    parent.removeChild(a);
    a = next;
  }
}

/**
 * Make `root` look like `html` while keeping every element that is still there:
 * text and attributes are patched, only genuinely new parts are created.
 * Scroll positions, hover, focus and CSS transitions therefore survive a refresh.
 * Give siblings that can reorder a `data-key`.
 */
export function patchHTML(root: Element, html: string) {
  const t = document.createElement('template');
  t.innerHTML = html;
  patchChildren(root, t.content);
}

// ---------- panels ----------

export interface Panel {
  /**
   * Show this HTML. Nothing happens when it is the HTML already shown, or (unless `force`)
   * while the player has a pointer down in the panel or is touch-scrolling it; the next call after
   * that catches up. Returns true when the DOM was touched.
   */
  render(html: string, force?: boolean): boolean;
  /** True while the panel must be left alone. */
  busy(): boolean;
}

const HOLD_AFTER_SCROLL = 300;

export function makePanel(root: HTMLElement): Panel {
  let shown = '';
  const down = new Set<number>();
  let fingers = 0;
  let touchSession = false;
  let lastScroll = -1e9;

  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') down.add(e.pointerId);
  }, true);
  const release = (e: PointerEvent) => down.delete(e.pointerId);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  window.addEventListener('blur', () => down.clear());

  // The browser cancels the pointer stream when it starts a touch scroll, so fingers are counted
  // with touch events, which keep coming until the finger lifts.
  const touches = (e: TouchEvent) => {
    fingers = e.targetTouches.length;
    touchSession = true;
  };
  root.addEventListener('touchstart', touches, { passive: true, capture: true });
  root.addEventListener('touchend', touches, { passive: true, capture: true });
  root.addEventListener('touchcancel', touches, { passive: true, capture: true });
  // Scroll events do not bubble; capture catches the inner scrollers. Momentum after the finger
  // lifts keeps sending them, which keeps the hold alive until the panel has come to rest.
  root.addEventListener('scroll', () => {
    if (touchSession) lastScroll = performance.now();
  }, { passive: true, capture: true });

  const busy = () => {
    if (down.size > 0 || fingers > 0) return true;
    if (!touchSession) return false;
    if (performance.now() - lastScroll < HOLD_AFTER_SCROLL) return true;
    touchSession = false;
    return false;
  };

  return {
    busy,
    render(html, force = false) {
      if (html === shown) return false;
      if (!force && busy()) return false;
      shown = html;
      patchHTML(root, html);
      return true;
    },
  };
}

// ---------- cached layout ----------
// Reading a rect forces layout, so rects are measured once and reused until something that can
// move them happens (window or stage resize, a side panel opening).

let layoutEpoch = 1;

export function invalidateLayout() {
  layoutEpoch++;
}

export interface CachedRect { (): DOMRect }

export function cachedRect(target: () => Element | null): CachedRect {
  let epoch = 0;
  let rect = new DOMRect();
  return () => {
    if (epoch !== layoutEpoch) {
      epoch = layoutEpoch;
      const e = target();
      rect = e ? e.getBoundingClientRect() : new DOMRect();
    }
    return rect;
  };
}

const anchors = new Map<string, { el: Element; rect: CachedRect }>();

/** Name a HUD element so effects can fly things to it without knowing about the panels. */
export function setAnchor(name: string, e: Element) {
  anchors.set(name, { el: e, rect: cachedRect(() => e) });
}

/** Centre of a named HUD element in client pixels, or null when it is missing or hidden. */
export function anchorPt(name: string): { x: number; y: number } | null {
  const a = anchors.get(name);
  if (!a) return null;
  const r = a.rect();
  if (!r.width && !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** A quick scale pulse on a named HUD element (used when something lands on it). */
export function pulseAnchor(name: string, scale = 1.22, ms = 220) {
  const a = anchors.get(name);
  if (!a || !(a.el as HTMLElement).animate) return;
  (a.el as HTMLElement).animate([{ transform: `scale(${scale})` }, { transform: 'scale(1)' }], { duration: ms, easing: 'ease-out' });
}

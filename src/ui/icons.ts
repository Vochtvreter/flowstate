import { MATERIALS, MatId, NodeType } from '../content';

const svg = (size: number, vb: number, body: string, color?: string) =>
  `<svg viewBox="0 0 ${vb} ${vb}" width="${size}" height="${size}" aria-hidden="true"${color ? ` style="color:${color}"` : ''}>${body}</svg>`;

/** A dark line over a filled shape: a facet, a seam, a grid. */
const cut = (d: string) => `<path d="${d}" fill="none" stroke="#0B0F17" stroke-opacity=".45" stroke-width="1.2" stroke-linecap="round"/>`;

/**
 * Each material as the thing it is, at 13 to 20 px: a heap of sand, a drop of oil, a lump of ore, a crystal; a pane
 * of glass, a plastic bottle, a puddle of tar, a copper bar, a silicon wafer on its side, a rubber ring; a screen, a chip with
 * its legs, a cable; a phone, a laptop, a robot. (The ids are older than the names: see src/content.ts.)
 */
const SHAPES: Record<MatId, (c: string) => string> = {
  glint: (c) => `<path d="M1.5 16.5c3.2-6.5 5.4-9 8.5-9s5.3 2.5 8.5 9z" fill="${c}"/><circle cx="6" cy="5.5" r="1.2" fill="${c}"/><circle cx="13.6" cy="4.6" r="1.2" fill="${c}"/>`,
  murk: (c) => `<path d="M10 1.8c3.6 4.6 5.6 7.3 5.6 10.4a5.6 5.6 0 0 1-11.2 0c0-3.1 2-5.8 5.6-10.4z" fill="${c}"/>`,
  ember: (c) => `<polygon points="2.5,12.5 6,5 12.5,2.5 17.5,8 16,15.5 7.5,17.5" fill="${c}"/>${cut('M6 5l4 5.5 7.5-2.5M10 10.5l-2.5 7')}`,
  breeze: (c) => `<polygon points="10,1.5 15,6.5 15,13.5 10,18.5 5,13.5 5,6.5" fill="${c}"/>${cut('M10 1.5v17M5 6.5l5 3 5-3')}`,
  shard: (c) => `<rect x="3" y="3" width="14" height="14" rx="2.2" fill="${c}" fill-opacity=".3" stroke="${c}" stroke-width="1.7"/><path d="M6.5 11l4.5-4.5M9 14l5-5" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`,
  ink: (c) => `<path d="M8 1.8h4v3l2.2 3.2v8.7a1.6 1.6 0 0 1-1.6 1.6H7.4a1.6 1.6 0 0 1-1.6-1.6V8l2.2-3.2z" fill="${c}"/>${cut('M5.8 11.5h8.4')}`,
  silt: (c) => `<ellipse cx="10" cy="13.8" rx="8" ry="3.7" fill="${c}"/><circle cx="6.5" cy="7.2" r="2.2" fill="${c}"/><circle cx="12.8" cy="4.6" r="1.5" fill="${c}"/>`,
  spark: (c) => `<polygon points="5.5,5.5 14.5,5.5 18,14.5 2,14.5" fill="${c}"/>${cut('M7.2 8.5h5.6')}`,
  // (A wafer seen from above its edge: a disc with a rim and a few dies marked on it. Face on, with a grid, it read as a globe.)
  mist: (c) => `<path d="M1.5 9v3.2c0 2.6 3.8 4.6 8.5 4.6s8.5-2 8.5-4.6V9z" fill="${c}" fill-opacity=".55"/><ellipse cx="10" cy="9" rx="8.5" ry="4.8" fill="${c}"/>${cut('M6.2 7.2h7.6M5.4 10.6h9.2M8.2 5.2l-1 7.6M12 5l.9 8')}`,
  clay: (c) => `<circle cx="10" cy="10" r="5.7" fill="none" stroke="${c}" stroke-width="4.2"/>`,
  prism: (c) => `<rect x="2" y="3.5" width="16" height="11" rx="1.8" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.7"/><path d="M6.5 17.5h7M10 14.5v3" class="ic"/>`,
  glyph: (c) => `<path d="M7.5 2v3.5M12.5 2v3.5M7.5 14.5V18M12.5 14.5V18M2 7.5h3.5M2 12.5h3.5M14.5 7.5H18M14.5 12.5H18" class="ic"/><rect x="5" y="5" width="10" height="10" rx="1.8" fill="${c}"/>`,
  coil: (c) => `<path d="M3.5 14c4 0 2.5-8 6.5-8s2.5 8 6.5 8" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/><rect x="1" y="12" width="3.4" height="4" rx=".8" fill="${c}"/><rect x="15.6" y="12" width="3.4" height="4" rx=".8" fill="${c}"/>`,
  lens: (c) => `<rect x="5" y="1.5" width="10" height="17" rx="2.2" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width="1.7"/><path d="M8.8 15.3h2.4" class="ic"/>`,
  dynamo: (c) => `<rect x="4" y="4" width="12" height="8.5" rx="1.2" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width="1.7"/><path d="M1.5 16h17" class="ic"/>`,
  paradox: (c) => `<path d="M10 5.5V2.8" class="ic"/><circle cx="10" cy="2.3" r="1.2" fill="${c}"/><rect x="3.5" y="5.5" width="13" height="11" rx="2.5" fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width="1.7"/><circle cx="7.3" cy="10" r="1.4" fill="${c}"/><circle cx="12.7" cy="10" r="1.4" fill="${c}"/><path d="M7.8 13.6h4.4" class="ic"/>`,
};

/** The simple outline used for a material's dots on wires. Anything not listed is a circle. */
export type MatShape = 'circle' | 'diamond' | 'triangle' | 'hexagon' | 'square' | 'star';
const DOT_SHAPES: Partial<Record<MatId, MatShape>> = {
  glint: 'diamond', ember: 'triangle', shard: 'hexagon', ink: 'square', clay: 'square',
  spark: 'star', glyph: 'star', prism: 'diamond',
};
export const matShape = (m: MatId | null): MatShape => (m && DOT_SHAPES[m]) || 'circle';

export function matGlyph(m: MatId, size = 16): string {
  const c = MATERIALS[m].color;
  return svg(size, 20, SHAPES[m](c), c);
}

const NODE_PATHS: Record<NodeType, string> = {
  well: `<path d="M7 3.5h10M12 3.5v7M8.5 10.5h7L12 20.5zM4 20.5h3.5M16.5 20.5H20" class="ic"/>`,
  refiner: `<path d="M4 5h16l-6 7v6l-4 2v-8z" class="ic"/>`,
  assembler: `<path d="M3 6h5l4 6M3 18h5l4-6M12 12h9M17 8l4 4-4 4" class="ic"/>`,
  fabricator: `<path d="M3 5h4l5 7M3 12h9M3 19h4l5-7M12 12h9M17 8l4 4-4 4" class="ic"/>`,
  router: `<path d="M3 12h7M10 12l5-6h6M10 12l5 6h6M10 12h11" class="ic"/>`,
  merger: `<path d="M3 6h6l5 6M3 18h6l5-6M3 12h18" class="ic"/>`,
  silo: `<path d="M6 6c0-2.5 12-2.5 12 0v12c0 2.5-12 2.5-12 0zM6 6c0 2.5 12 2.5 12 0" class="ic"/>`,
  market: `<circle cx="12" cy="12" r="8.5" class="ic"/><path d="M14.5 9.5a3 3 0 1 0 0 5M12 7.5v9" class="ic"/>`,
  lab: `<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 15h9" class="ic"/>`,
  void: `<path d="M4 7.5h16l-2 12.5H6zM9.5 11v5.5M14.5 11v5.5M8 7.5l1.5-3.5h5l1.5 3.5" class="ic"/>`,
};

export const nodeIcon = (t: NodeType, size = 22) => svg(size, 24, NODE_PATHS[t]);

const ICONS = {
  undo: `<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" class="ic"/>`,
  redo: `<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" class="ic"/>`,
  pause: `<path d="M9 5v14M15 5v14" class="ic"/>`,
  play: `<path d="M7 5l12 7-12 7z" class="ic"/>`,
  gear: `<circle cx="12" cy="12" r="3" class="ic"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" class="ic"/>`,
  tree: `<circle cx="5" cy="12" r="2.5" class="ic"/><circle cx="19" cy="5" r="2.5" class="ic"/><circle cx="19" cy="19" r="2.5" class="ic"/><path d="M7.5 12h4l5-6M11.5 12l5 6" class="ic"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18" class="ic"/>`,
  check: `<path d="M5 12l5 5L20 7" class="ic"/>`,
  lock: `<rect x="5" y="11" width="14" height="9" rx="2" class="ic"/><path d="M8 11V8a4 4 0 0 1 8 0v3" class="ic"/>`,
  plus: `<path d="M12 5v14M5 12h14" class="ic"/>`,
  minus: `<path d="M5 12h14" class="ic"/>`,
  clip: `<path d="M2.5 12h5.5M16 12h5.5" class="ic"/><circle cx="12" cy="12" r="4" class="ic"/>`,
  fit: `<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" class="ic"/>`,
  trash: `<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" class="ic"/>`,
  warn: `<path d="M12 3l10 18H2zM12 10v5M12 18v.5" class="ic"/>`,
  up: `<path d="M12 19V5M6 11l6-6 6 6" class="ic"/>`,
  // Flows: three streams of different strength running the same way.
  flows: `<path d="M3 6h11M3 12h18M3 18h7" class="ic"/><path d="M17 3l3.5 3-3.5 3M13 15l3.5 3-3.5 3" class="ic"/>`,
};

export const icon = (name: keyof typeof ICONS, size = 18) => svg(size, 24, ICONS[name]);

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

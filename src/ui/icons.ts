import { MATERIALS, MatId, NodeType } from '../content';

const svg = (size: number, vb: number, body: string, color?: string) =>
  `<svg viewBox="0 0 ${vb} ${vb}" width="${size}" height="${size}" aria-hidden="true"${color ? ` style="color:${color}"` : ''}>${body}</svg>`;

const SHAPES: Record<MatId, (c: string) => string> = {
  glint: (c) => `<polygon points="10,2 18,10 10,18 2,10" fill="${c}"/>`,
  murk: (c) => `<circle cx="10" cy="10" r="7" fill="${c}"/>`,
  ember: (c) => `<polygon points="10,3 18,17 2,17" fill="${c}"/>`,
  breeze: () => `<path d="M2 8q4-4 8 0t8 0M2 13q4-4 8 0t8 0" class="ic"/>`,
  shard: (c) => `<polygon points="10,2 17,6 17,14 10,18 3,14 3,6" fill="${c}"/>`,
  ink: (c) => `<rect x="4" y="4" width="12" height="12" rx="2" fill="${c}"/>`,
  silt: (c) => `<circle cx="5" cy="13" r="2.4" fill="${c}"/><circle cx="11" cy="8" r="2.4" fill="${c}"/><circle cx="15" cy="14" r="2.4" fill="${c}"/>`,
  spark: (c) => `<polygon points="10,2 12,8 18,10 12,12 10,18 8,12 2,10 8,8" fill="${c}"/>`,
  mist: (c) => `<path d="M5 15h10a3 3 0 0 0 0-6a4 4 0 0 0-7.6-1.2A3.6 3.6 0 0 0 5 15z" fill="${c}"/>`,
  clay: (c) => `<rect x="2" y="6" width="16" height="8" rx="2" fill="${c}"/>`,
  prism: () => `<polygon points="10,2 18,10 10,18 2,10" class="ic"/><path d="M2 10h16M10 2l-3 8 3 8" class="ic"/>`,
  glyph: () => `<polygon points="10,2 12,8 18,10 12,12 10,18 8,12 2,10 8,8" class="ic"/>`,
  coil: () => `<circle cx="10" cy="10" r="7" class="ic"/><circle cx="10" cy="10" r="3.5" class="ic"/>`,
  lens: (c) => `<circle cx="10" cy="10" r="7.5" class="ic"/><circle cx="10" cy="10" r="3" fill="${c}"/>`,
  dynamo: () => `<circle cx="10" cy="10" r="4" class="ic"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3M4.3 4.3l2.1 2.1M13.6 13.6l2.1 2.1M4.3 15.7l2.1-2.1M13.6 6.4l2.1-2.1" class="ic"/>`,
  paradox: () => `<path d="M10 10c-2-3-6-3-6 0s4 3 6 0 6-3 6 0-4 3-6 0z" class="ic"/>`,
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
  well: `<path d="M12 15V4M8 8l4-4 4 4M4 20h16M7 17h10" class="ic"/>`,
  refiner: `<path d="M4 5h16l-6 7v6l-4 2v-8z" class="ic"/>`,
  assembler: `<path d="M3 6h5l4 6M3 18h5l4-6M12 12h9M17 8l4 4-4 4" class="ic"/>`,
  fabricator: `<path d="M3 5h4l5 7M3 12h9M3 19h4l5-7M12 12h9M17 8l4 4-4 4" class="ic"/>`,
  router: `<path d="M3 12h7M10 12l5-6h6M10 12l5 6h6M10 12h11" class="ic"/>`,
  merger: `<path d="M3 6h6l5 6M3 18h6l5-6M3 12h18" class="ic"/>`,
  silo: `<path d="M6 6c0-2.5 12-2.5 12 0v12c0 2.5-12 2.5-12 0zM6 6c0 2.5 12 2.5 12 0" class="ic"/>`,
  market: `<circle cx="12" cy="12" r="8.5" class="ic"/><path d="M14.5 9.5a3 3 0 1 0 0 5M12 7.5v9" class="ic"/>`,
  lab: `<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 15h9" class="ic"/>`,
  void: `<circle cx="12" cy="12" r="8.5" class="ic"/><path d="M6 6l12 12" class="ic"/>`,
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
  fit: `<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" class="ic"/>`,
  trash: `<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" class="ic"/>`,
  warn: `<path d="M12 3l10 18H2zM12 10v5M12 18v.5" class="ic"/>`,
  up: `<path d="M12 19V5M6 11l6-6 6 6" class="ic"/>`,
};

export const icon = (name: keyof typeof ICONS, size = 18) => svg(size, 24, ICONS[name]);

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

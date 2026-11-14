import { describe, expect, it } from 'vitest';
import { pinchView } from './geom';

const free = (k: number) => k;
const phone = (k: number) => Math.max(0.74, Math.min(1.5, k));
/** The board point under a screen point. */
const under = (v: { x: number; y: number; k: number }, p: { x: number; y: number }) => ({ x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k });

describe('pinchView', () => {
  const v0 = { x: -54, y: 131, k: 0.74 };
  const m0 = { x: 180, y: 300 };

  it('does nothing while the fingers have not moved (no jump when the second finger lands)', () => {
    const v = pinchView(v0, m0, 80, m0, 80, phone);
    expect(v.k).toBe(v0.k);
    expect(v.x).toBeCloseTo(v0.x, 9);
    expect(v.y).toBeCloseTo(v0.y, 9);
  });

  it('pans when two fingers move together', () => {
    const v = pinchView(v0, m0, 80, { x: 220, y: 268 }, 80, phone);
    expect(v.k).toBe(v0.k);
    expect(v.x - v0.x).toBeCloseTo(40, 9);
    expect(v.y - v0.y).toBeCloseTo(-32, 9);
  });

  it('zooms by the ratio of the spread, about the midpoint', () => {
    const v = pinchView(v0, m0, 80, m0, 120, phone);
    expect(v.k).toBeCloseTo(0.74 * 1.5, 9);
    const a = under(v0, m0), b = under(v, m0);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  });

  it('zooms and pans at once: the board point under the fingers follows them', () => {
    const m1 = { x: 150, y: 340 };
    const v = pinchView(v0, m0, 80, m1, 100, free);
    const a = under(v0, m0), b = under(v, m1);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  });

  it('stops at the zoom limits and stays anchored there', () => {
    const wide = pinchView(v0, m0, 80, m0, 800, phone);
    expect(wide.k).toBe(1.5);
    const tight = pinchView({ ...v0, k: 1 }, m0, 200, m0, 20, phone);
    expect(tight.k).toBe(0.74);
    for (const v of [wide, tight]) {
      const from = v === wide ? v0 : { ...v0, k: 1 };
      expect(under(v, m0).x).toBeCloseTo(under(from, m0).x, 9);
      expect(under(v, m0).y).toBeCloseTo(under(from, m0).y, 9);
    }
  });
});

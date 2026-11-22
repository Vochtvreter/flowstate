// Loss (src/loss.ts): what a Drill or machine could have made and did not, and why. Read from the game alone.
import { describe, expect, it } from 'vitest';
import { connect, placeNode, upgrade } from '../src/actions';
import { lossOf } from '../src/loss';
import { lossCauses } from '../src/ui/status';
import { market, rich, run, well } from './helpers';

describe('loss: what utilization leaves, and why', () => {
  it('a machine that gets all it asks for loses nothing', () => {
    const g = rich();
    const r = placeNode(g, 'refiner', 300, 100)!;
    connect(g, well(g).id, 0, r.id);
    connect(g, r.id, 0, market(g).id);
    run(g, 60);
    const l = lossOf(r)!;
    expect(l.share).toBe(0);
    expect(l.rate).toBe(0);
    expect(l.capacity).toBeCloseTo(0.5, 5);
    expect(l.starved + l.blocked).toBe(0);
    expect(lossCauses(g, r, l)).toEqual([]);
  });

  it('a machine faster than its source loses the difference, waiting for the input by name, and names the source', () => {
    const g = rich();
    const r = placeNode(g, 'refiner', 300, 100)!;
    connect(g, well(g).id, 0, r.id);
    connect(g, r.id, 0, market(g).id);
    for (let i = 0; i < 3; i++) upgrade(g, r.id, 'speed');
    run(g, 60);
    const l = lossOf(r)!;
    // Three Speed levels: a craft every 2 × 0.85³ s, so it asks for 1.63 Sand a second and gets 1: 39% lost on
    // average (the reading ripples about that, as utilization does: a machine works in bursts).
    expect(l.share).toBeGreaterThan(0.25);
    expect(l.share).toBeLessThan(0.5);
    expect(l.share).toBeCloseTo(1 - r.util, 10);
    expect(l.rate).toBeCloseTo(l.share * l.capacity, 10);
    expect(l.starved).toBeCloseTo(l.share, 5);
    expect(l.blocked).toBe(0);
    expect(l.missing).toBe('glint');
    expect(lossCauses(g, r, l)).toEqual([{ kind: 'wait', share: l.starved, text: 'Waiting for Sand', node: well(g).id }]);
    // What it makes and what it loses are its capacity between them.
    expect(r.rate + l.rate).toBeCloseTo(l.capacity, 5);
  });

  it('a Drill ahead of what it feeds loses to a backed-up output, and the cause names what is full downstream', () => {
    const g = rich();
    const w = well(g);
    for (let i = 0; i < 4; i++) upgrade(g, w.id, 'speed');
    const r = placeNode(g, 'refiner', 300, 100)!;
    connect(g, w.id, 0, r.id);
    connect(g, r.id, 0, market(g).id);
    run(g, 60);
    const l = lossOf(w)!;
    // 1.25⁴ = 2.44 Sand a second dug, 1 taken.
    expect(l.share).toBeGreaterThan(0.5);
    expect(l.blocked).toBeCloseTo(l.share, 5);
    expect(l.starved).toBe(0);
    expect(l.blockedOn).toBe('glint');
    const [cause] = lossCauses(g, w, l);
    expect(cause.kind).toBe('back');
    expect(cause.text).toBe('Sand backed up');
    expect(cause.node).toBe(r.id);
  });

  it('an output with no wire says so: it has no exit, and there is no node to show for it', () => {
    const g = rich();
    const w = placeNode(g, 'well', 0, 0, { depositId: 3 })!; // Oil
    const r = placeNode(g, 'refiner', 300, 400)!;
    connect(g, w.id, 0, r.id);
    connect(g, r.id, 0, market(g).id); // Plastic only: Tar's port is left open
    run(g, 60);
    const l = lossOf(r)!;
    expect(l.share).toBeGreaterThan(0.9);
    expect(l.blockedOn).toBe('silt');
    expect(lossCauses(g, r, l)[0]).toMatchObject({ kind: 'back', text: 'Tar has no exit', node: null });
  });

  it('a machine short of an input and backed up at once has both causes, the larger first, and they are the whole of its loss', () => {
    const g = rich();
    const r = placeNode(g, 'refiner', 300, 100)!;
    connect(g, well(g).id, 0, r.id);
    connect(g, r.id, 0, market(g).id);
    run(g, 30);
    // As the simulation would leave it: 60% at work, a quarter of the rest backed up.
    r.util = 0.6;
    r.fStarved = 0.3;
    r.fBlocked = 0.1;
    r.status = 'starved';
    r.missing = 'glint';
    r.blockedOn = 'shard';
    const l = lossOf(r)!;
    expect(l.share).toBeCloseTo(0.4, 10);
    expect(l.starved).toBeCloseTo(0.3, 10);
    expect(l.blocked).toBeCloseTo(0.1, 10);
    expect(lossCauses(g, r, l).map((c) => c.kind)).toEqual(['wait', 'back']);
    r.fStarved = 0.05;
    r.fBlocked = 0.35;
    expect(lossCauses(g, r, lossOf(r)!).map((c) => c.kind)).toEqual(['back', 'wait']);
  });

  it('is not given for what makes nothing, for a machine with no recipe or nothing wired in, and gives no cause while a machine settles', () => {
    const g = rich();
    expect(lossOf(market(g))).toBeNull();
    const r = placeNode(g, 'refiner', 300, 100)!;
    run(g, 5);
    expect(lossOf(r)).toBeNull(); // no recipe yet
    connect(g, well(g).id, 0, r.id);
    expect(r.grace).toBeGreaterThan(0);
    run(g, 1);
    const l = lossOf(r)!;
    expect(l.settling).toBe(true);
    expect(l.starved + l.blocked).toBe(0);
    const lab = placeNode(g, 'lab', 600, 300)!;
    expect(lossOf(lab)).toBeNull();
  });
});

// Clips (Game.clips, Wire.clips): points on the board that wires are run through. How wires are drawn and nothing
// else: saved, undoable, shared between wires, and no rule reads them.
import { describe, expect, it } from 'vitest';
import {
  addClip, clipAt, clipById, clipWireAt, connect, connectThrough, cutWire, dropClips, emptyClips, moveClip, placeNode, redo, removeClip, removeEmptyClips,
  setWireClips, splice, unclipWire, undo, wiresThrough,
} from '../src/actions';
import { CLIP_GRID, MAX_BOARD_CLIPS, MAX_CLIPS, cleanClipIds, cleanPoints, clipPoints, deserialize, serialize } from '../src/state';
import { fresh, market, rich, run, well, wire } from './helpers';

describe('clips: points on the board that wires are run through', () => {
  it('stand on the clip grid inside the plot, one to a point, and setting one up is an undo step', () => {
    const g = rich();
    expect(g.clips).toEqual([]);
    const c = addClip(g, 303.4, 198)!;
    expect(CLIP_GRID).toBe(10);
    expect({ x: c.x, y: c.y }).toEqual({ x: 300, y: 200 });
    // On the same point again: the clip that stands there, and no new step.
    expect(addClip(g, 301, 202)).toBe(c);
    expect(g.clips.length).toBe(1);
    const far = addClip(g, -50, 1e6)!;
    expect({ x: far.x, y: far.y }).toEqual({ x: 0, y: g.board.h });
    expect(clipAt(g, 0, g.board.h)).toBe(far);
    undo(g);
    expect(g.clips.map((k) => k.id)).toEqual([c.id]);
    undo(g);
    expect(g.clips).toEqual([]);
    redo(g);
    expect(g.clips.length).toBe(1);
    expect(g.credits).toBe(1e9);
  });

  it('a wire runs through its clips in order: each once, eight at most, and with none it has no list at all', () => {
    const g = rich();
    const w = connect(g, well(g).id, 0, market(g).id)!;
    expect(w.clips).toBeUndefined();
    const ids = Array.from({ length: 10 }, (_, i) => addClip(g, 100 + 20 * i, 400)!.id);
    expect(setWireClips(g, w.id, [ids[0], ids[1], ids[0], 99999, ids[2]])).toBe(true);
    expect(wire(g, w.id).clips).toEqual([ids[0], ids[1], ids[2]]);
    expect(clipPoints(g, wire(g, w.id))).toEqual([{ x: 100, y: 400 }, { x: 120, y: 400 }, { x: 140, y: 400 }]);
    // The same again is no change, and no undo step.
    expect(setWireClips(g, w.id, [ids[0], ids[1], ids[2]])).toBe(false);
    expect(setWireClips(g, w.id, ids)).toBe(true);
    expect(wire(g, w.id).clips!.length).toBe(MAX_CLIPS);
    expect(setWireClips(g, w.id, [])).toBe(true);
    expect('clips' in wire(g, w.id)).toBe(false);
    // Out of the wire, the clips still stand.
    expect(g.clips.length).toBe(10);
    expect(setWireClips(g, 99999, [ids[0]])).toBe(false);
  });

  it('a wire is clipped at a point: through the clip that stands there, or a new one, at its place among the wire\'s others', () => {
    const g = rich();
    const w = connect(g, well(g).id, 0, market(g).id)!;
    const a = clipWireAt(g, w.id, 300, 200, 0)!;
    const b = clipWireAt(g, w.id, 500, 260, 1)!;
    const mid = clipWireAt(g, w.id, 400, 220, 1)!;
    expect(wire(g, w.id).clips).toEqual([a.id, mid.id, b.id]);
    // Through a clip it runs through already: nothing.
    expect(clipWireAt(g, w.id, 300, 200, 3)).toBeNull();
    // A second wire at the same point shares the clip.
    const r = placeNode(g, 'refiner', 600, 400)!;
    const w2 = connect(g, well(g).id, 0, r.id)!;
    expect(clipWireAt(g, w2.id, 301, 199, 0)).toBe(a);
    expect(g.clips.length).toBe(3);
    expect(wiresThrough(g, a.id).map((x) => x.id).sort()).toEqual([w.id, w2.id].sort());
    undo(g);
    expect(wiresThrough(g, a.id).map((x) => x.id)).toEqual([w.id]);
  });

  it('moving a clip moves every wire through it, and let go on another clip the two become one', () => {
    const g = rich();
    const r = placeNode(g, 'refiner', 600, 400)!;
    const w1 = connect(g, well(g).id, 0, market(g).id)!;
    const w2 = connect(g, well(g).id, 0, r.id)!;
    const a = clipWireAt(g, w1.id, 300, 200, 0)!;
    clipWireAt(g, w2.id, 300, 200, 0);
    const b = clipWireAt(g, w2.id, 400, 300, 1)!;
    expect(moveClip(g, a.id, 322, 241)).toBe(true);
    expect(clipPoints(g, wire(g, w1.id))).toEqual([{ x: 320, y: 240 }]);
    expect(clipPoints(g, wire(g, w2.id))[0]).toEqual({ x: 320, y: 240 });
    expect(moveClip(g, a.id, 320, 240)).toBe(false);
    undo(g);
    expect(clipById(g, a.id)).toMatchObject({ x: 300, y: 200 });
    // Onto b: a is gone, w1 runs through b, and w2, which ran through both, runs through b once.
    expect(moveClip(g, a.id, 400, 300)).toBe(true);
    expect(clipById(g, a.id)).toBeNull();
    expect(wire(g, w1.id).clips).toEqual([b.id]);
    expect(wire(g, w2.id).clips).toEqual([b.id]);
    expect(g.clips.length).toBe(1);
    undo(g);
    expect(g.clips.length).toBe(2);
    expect(wire(g, w2.id).clips).toEqual([a.id, b.id]);
  });

  it('a clip taken off leaves its wires without it; a wire unclipped takes the clips that were its alone', () => {
    const g = rich();
    const r = placeNode(g, 'refiner', 600, 400)!;
    const w1 = connect(g, well(g).id, 0, market(g).id)!;
    const w2 = connect(g, well(g).id, 0, r.id)!;
    const shared = clipWireAt(g, w1.id, 300, 200, 0)!;
    clipWireAt(g, w2.id, 300, 200, 0);
    const own = clipWireAt(g, w1.id, 400, 300, 1)!;
    expect(unclipWire(g, w1.id)).toBe(true);
    expect('clips' in wire(g, w1.id)).toBe(false);
    expect(clipById(g, own.id)).toBeNull();
    expect(clipById(g, shared.id)).not.toBeNull();
    expect(wire(g, w2.id).clips).toEqual([shared.id]);
    expect(unclipWire(g, w1.id)).toBe(false);
    undo(g);
    expect(wire(g, w1.id).clips).toEqual([shared.id, own.id]);
    expect(removeClip(g, shared.id)).toBe(true);
    expect(wire(g, w1.id).clips).toEqual([own.id]);
    expect('clips' in wire(g, w2.id)).toBe(false);
    expect(removeClip(g, shared.id)).toBe(false);
  });

  it('stay on the board when their wire is cut or has a machine spliced into it, and the empty ones come off at a press', () => {
    const g = rich();
    const w = connect(g, well(g).id, 0, market(g).id)!;
    const c = clipWireAt(g, w.id, 300, 200, 0)!;
    const refiner = placeNode(g, 'refiner', 300, 300)!;
    expect(splice(g, w.id, refiner.id)).toBe(true);
    expect(g.wires.every((x) => !x.clips)).toBe(true);
    expect(emptyClips(g).map((k) => k.id)).toEqual([c.id]);
    undo(g);
    expect(wire(g, w.id).clips).toEqual([c.id]);
    cutWire(g, w.id);
    expect(g.clips.length).toBe(1);
    addClip(g, 700, 500);
    expect(removeEmptyClips(g)).toBe(2);
    expect(g.clips).toEqual([]);
    expect(removeEmptyClips(g)).toBe(0);
    undo(g);
    expect(g.clips.length).toBe(2);
    expect(dropClips(g)).toBe(2);
    expect(dropClips(g)).toBe(0);
  });

  it('a wire is made by way of clips in one step', () => {
    const g = rich();
    const a = addClip(g, 300, 200)!, b = addClip(g, 400, 300)!;
    const w = connectThrough(g, well(g).id, 0, market(g).id, [a.id, b.id, 4242])!;
    expect(w.clips).toEqual([a.id, b.id]);
    undo(g);
    expect(g.wires.length).toBe(0);
    expect(g.clips.length).toBe(2);
    redo(g);
    expect(wire(g, w.id).clips).toEqual([a.id, b.id]);
    // What cannot be wired is not, clips or none.
    expect(connectThrough(g, well(g).id, 0, market(g).id, [a.id])).toBeNull();
    expect(connectThrough(g, market(g).id, 0, well(g).id, [])).toBeNull();
  });

  it('the board holds no more than it can', () => {
    const g = rich();
    for (let i = 0; i < MAX_BOARD_CLIPS; i++) expect(addClip(g, (i % 60) * 20, 100 + Math.floor(i / 60) * 20)).not.toBeNull();
    expect(g.clips.length).toBe(MAX_BOARD_CLIPS);
    expect(addClip(g, 10, 10)).toBeNull();
    const w = connect(g, well(g).id, 0, market(g).id)!;
    expect(clipWireAt(g, w.id, 10, 10, 0)).toBeNull();
    expect(clipWireAt(g, w.id, 0, 100, 0)).not.toBeNull();
  });

  it('are saved with the game, and a save with nonsense for clips loads without it', () => {
    const g = rich();
    const w = connect(g, well(g).id, 0, market(g).id)!;
    const a = clipWireAt(g, w.id, 300, 200, 0)!;
    const b = clipWireAt(g, w.id, 420, 320, 1)!;
    const spare = addClip(g, 700, 500)!;
    const loaded = deserialize(serialize(g))!;
    expect(loaded.clips).toEqual([{ id: a.id, x: 300, y: 200 }, { id: b.id, x: 420, y: 320 }, { id: spare.id, x: 700, y: 500 }]);
    expect(wire(loaded, w.id).clips).toEqual([a.id, b.id]);
    // A new clip never takes an id that is in use.
    expect(addClip(loaded, 40, 40)!.id).toBeGreaterThan(Math.max(spare.id, w.id));
    const raw = JSON.parse(serialize(g));
    raw.clips = [{ id: a.id, x: 'left', y: 3 }, 7, null, { id: b.id, x: 1e9, y: -4 }, { id: w.id, x: 50, y: 50 }, { id: 5000, x: 1e9, y: -3 }];
    raw.wires[0].clips = [a.id, 'b', b.id, b.id, 777];
    const odd = deserialize(JSON.stringify(raw))!;
    // What is not a clip is dropped; one whose id a wire has is dropped; a second on one point is dropped.
    expect(odd.clips).toEqual([{ id: b.id, x: g.board.w, y: 0 }]);
    expect(wire(odd, w.id).clips).toEqual([b.id]);
    raw.clips = 'none';
    raw.wires[0].clips = 'none';
    const bare = deserialize(JSON.stringify(raw))!;
    expect(bare.clips).toEqual([]);
    expect('clips' in wire(bare, w.id)).toBe(false);
  });

  it('a save from before clips, with pins on its wires, loads with a clip for each pin and the wires running as they did', () => {
    const g = rich();
    const r = placeNode(g, 'refiner', 600, 400)!;
    const w1 = connect(g, well(g).id, 0, market(g).id)!;
    const w2 = connect(g, well(g).id, 0, r.id)!;
    const raw = JSON.parse(serialize(g));
    delete raw.clips;
    raw.wires[0].pins = [{ x: 303, y: 198 }, { x: 420, y: 320 }];
    raw.wires[1].pins = [{ x: 300, y: 200 }, { x: 'x', y: 1 }, 5];
    const old = deserialize(JSON.stringify(raw))!;
    // Two wires had a pin on one point: one clip, shared.
    expect(old.clips.map((c) => ({ x: c.x, y: c.y }))).toEqual([{ x: 300, y: 200 }, { x: 420, y: 320 }]);
    expect(clipPoints(old, wire(old, w1.id))).toEqual([{ x: 300, y: 200 }, { x: 420, y: 320 }]);
    expect(clipPoints(old, wire(old, w2.id))).toEqual([{ x: 300, y: 200 }]);
    expect(wire(old, w1.id).clips![0]).toBe(wire(old, w2.id).clips![0]);
    expect('pins' in wire(old, w1.id)).toBe(false);
    const ids = [...old.nodes, ...old.wires, ...old.deposits, ...old.clips].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Saved again and loaded again, it is the same.
    const again = deserialize(serialize(old))!;
    expect(again.clips).toEqual(old.clips);
    expect(wire(again, w1.id).clips).toEqual(wire(old, w1.id).clips);
  });

  it('what is not a point or an id is dropped', () => {
    const board = { w: 1240, h: 760 };
    expect(cleanPoints([{ x: 100, y: 100 }, null, 'pin', { x: NaN, y: 3 }, { x: 101, y: 99 }, { x: 200, y: 100 }], board)).toEqual([{ x: 100, y: 100 }, { x: 200, y: 100 }]);
    expect(cleanPoints(undefined, board)).toEqual([]);
    expect(cleanPoints({ x: 1, y: 2 }, board)).toEqual([]);
    expect(cleanClipIds([1, '2', 3, 1, 9], (id) => id < 5)).toEqual([1, 3]);
    expect(cleanClipIds(null, () => true)).toEqual([]);
  });

  it('change nothing the rules read: the same board earns the same with clips as without', () => {
    const build = (clipped: boolean) => {
      const g = fresh();
      g.techs = ['P1'];
      g.credits = 1000;
      const refiner = placeNode(g, 'refiner', 400, 120)!;
      const a = connect(g, well(g).id, 0, refiner.id)!;
      const b = connect(g, refiner.id, 0, market(g).id)!;
      if (clipped) {
        clipWireAt(g, a.id, 300, 40, 0);
        clipWireAt(g, a.id, 360, 300, 1);
        clipWireAt(g, b.id, 800, 500, 0);
        clipWireAt(g, b.id, 360, 300, 0);
        addClip(g, 60, 60);
      }
      run(g, 120);
      return g;
    };
    const plain = build(false), clipped = build(true);
    expect(clipped.credits).toBe(plain.credits);
    expect(clipped.sold).toEqual(plain.sold);
    expect(clipped.wires.map((w) => w.rate)).toEqual(plain.wires.map((w) => w.rate));
  });
});

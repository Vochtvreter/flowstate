// Pins on wires (Wire.pins): how a wire is drawn and nothing else. Saved, undoable, and no rule reads them.
import { describe, expect, it } from 'vitest';
import { connect, cutWire, dropPins, placeNode, redo, setPins, splice, undo } from '../src/actions';
import { MAX_PINS, PIN_GRID, cleanPins, deserialize, serialize } from '../src/state';
import { fresh, market, rich, run, well, wire } from './helpers';

describe('pins: the points a wire is set to run by', () => {
  it('are kept on the pin grid, inside the plot, four at most, and with none the wire has no list at all', () => {
    const g = rich();
    const w = connect(g, well(g).id, 0, market(g).id)!;
    expect(w.pins).toBeUndefined();
    expect(setPins(g, w.id, [{ x: 303.4, y: 198 }, { x: -50, y: 1e6 }])).toBe(true);
    expect(wire(g, w.id).pins).toEqual([{ x: 300, y: 200 }, { x: 0, y: g.board.h }]);
    expect(PIN_GRID).toBe(10);
    // The same pins again is no change, and no undo step.
    expect(setPins(g, w.id, [{ x: 300, y: 200 }, { x: 0, y: g.board.h }])).toBe(false);
    expect(setPins(g, w.id, Array.from({ length: 9 }, (_, i) => ({ x: 100 + 20 * i, y: 100 })))).toBe(true);
    expect(wire(g, w.id).pins!.length).toBe(MAX_PINS);
    expect(setPins(g, w.id, [])).toBe(true);
    expect('pins' in wire(g, w.id)).toBe(false);
    expect(setPins(g, 99999, [{ x: 1, y: 1 }])).toBe(false);
  });

  it('what is not a point is dropped, and so is the same point twice in a row', () => {
    const board = { w: 1240, h: 760 };
    expect(cleanPins([{ x: 100, y: 100 }, null, 'pin', { x: NaN, y: 3 }, { x: 101, y: 99 }, { x: 200, y: 100 }], board)).toEqual([{ x: 100, y: 100 }, { x: 200, y: 100 }]);
    expect(cleanPins(undefined, board)).toEqual([]);
    expect(cleanPins({ x: 1, y: 2 }, board)).toEqual([]);
  });

  it('each change is one undo step, and redo brings it back', () => {
    const g = rich();
    const w = connect(g, well(g).id, 0, market(g).id)!;
    setPins(g, w.id, [{ x: 300, y: 200 }]);
    setPins(g, w.id, [{ x: 300, y: 200 }, { x: 400, y: 260 }]);
    undo(g);
    expect(wire(g, w.id).pins).toEqual([{ x: 300, y: 200 }]);
    undo(g);
    expect(wire(g, w.id).pins).toBeUndefined();
    redo(g);
    redo(g);
    expect(wire(g, w.id).pins).toEqual([{ x: 300, y: 200 }, { x: 400, y: 260 }]);
    // Credits are untouched by any of it.
    expect(g.credits).toBe(1e9);
  });

  it('are saved with the game, and a save with nonsense for pins loads without them', () => {
    const g = rich();
    const w = connect(g, well(g).id, 0, market(g).id)!;
    setPins(g, w.id, [{ x: 300, y: 200 }, { x: 420, y: 320 }]);
    const loaded = deserialize(serialize(g))!;
    expect(wire(loaded, w.id).pins).toEqual([{ x: 300, y: 200 }, { x: 420, y: 320 }]);
    const raw = JSON.parse(serialize(g));
    raw.wires[0].pins = [{ x: 'left', y: 3 }, 7, { x: 1e9, y: -4 }];
    const odd = deserialize(JSON.stringify(raw))!;
    expect(wire(odd, w.id).pins).toEqual([{ x: g.board.w, y: 0 }]);
    raw.wires[0].pins = 'none';
    expect('pins' in wire(deserialize(JSON.stringify(raw))!, w.id)).toBe(false);
  });

  it('go with their wire: a wire that is cut, or has a machine spliced into it, leaves none behind', () => {
    const g = rich();
    const w = connect(g, well(g).id, 0, market(g).id)!;
    setPins(g, w.id, [{ x: 300, y: 200 }]);
    const refiner = placeNode(g, 'refiner', 300, 200)!;
    expect(splice(g, w.id, refiner.id)).toBe(true);
    expect(g.wires.every((x) => !x.pins)).toBe(true);
    undo(g);
    expect(wire(g, w.id).pins).toEqual([{ x: 300, y: 200 }]);
    cutWire(g, w.id);
    expect(g.wires.length).toBe(0);
    undo(g);
    expect(wire(g, w.id).pins).toEqual([{ x: 300, y: 200 }]);
    expect(dropPins(g)).toBe(1);
    expect(g.wires.every((x) => !x.pins)).toBe(true);
    expect(dropPins(g)).toBe(0);
  });

  it('change nothing the rules read: the same board earns the same with pins as without', () => {
    const build = (pinned: boolean) => {
      const g = fresh();
      g.techs = ['P1'];
      g.credits = 1000;
      const refiner = placeNode(g, 'refiner', 400, 120)!;
      const a = connect(g, well(g).id, 0, refiner.id)!;
      const b = connect(g, refiner.id, 0, market(g).id)!;
      if (pinned) {
        setPins(g, a.id, [{ x: 300, y: 40 }, { x: 360, y: 300 }]);
        setPins(g, b.id, [{ x: 800, y: 500 }]);
      }
      run(g, 120);
      return g;
    };
    const plain = build(false), pinned = build(true);
    expect(pinned.credits).toBe(plain.credits);
    expect(pinned.sold).toEqual(plain.sold);
    expect(pinned.wires.map((w) => w.rate)).toEqual(plain.wires.map((w) => w.rate));
  });
});

// Mobile Drills (content.ts S2): a Drill may be moved, and its deposit goes with it.
import { describe, expect, it } from 'vitest';
import { act, canMove, deleteNode, drillsMove, freeDeposits, placeNode, redo, seatDeposit, undo } from '../src/actions';
import { TECHS } from '../src/content';
import { research, techAvailable } from '../src/economy';
import { deserialize, serialize } from '../src/state';
import { fresh, market, rich, well } from './helpers';

describe('Mobile Drills: research that lets a Drill be moved', () => {
  it('is a side tech behind Routing, priced in α, bought and not handed out', () => {
    const t = TECHS.S2;
    expect(t.name).toBe('Mobile Drills');
    expect(t.requires).toEqual(['L1']);
    expect(t.cost).toEqual({ a: 80 });
    expect(t.auto).toBeUndefined();
    const g = fresh();
    g.data.a = 1000;
    expect(techAvailable(g, t)).toBe(false);
    expect(research(g, 'S2')).toBe(false);
    g.techs.push('L1');
    expect(techAvailable(g, t)).toBe(true);
    expect(research(g, 'S2')).toBe(true);
    expect(g.data.a).toBe(920);
    expect(drillsMove(g)).toBe(true);
  });

  it('until it is researched a Drill stays, and every other card moves as it always did', () => {
    const g = rich();
    expect(drillsMove(g)).toBe(false);
    expect(canMove(g, well(g))).toBe(false);
    expect(canMove(g, market(g))).toBe(true);
    g.techs.push('S2');
    expect(canMove(g, well(g))).toBe(true);
  });

  it('a Drill that is moved takes its deposit with it, as one undo step', () => {
    const g = rich();
    g.techs.push('S2');
    const w = well(g);
    const dep = () => g.deposits.find((d) => d.id === w.depositId)!;
    const was = { x: w.x, y: w.y };
    expect(dep()).toMatchObject(was);
    act(g, () => {
      const n = well(g);
      n.x = 500;
      n.y = 420;
      seatDeposit(g, n);
      return 0;
    });
    expect(g.deposits.find((d) => d.id === well(g).depositId)).toMatchObject({ x: 500, y: 420 });
    undo(g);
    expect(well(g)).toMatchObject(was);
    expect(g.deposits.find((d) => d.id === well(g).depositId)).toMatchObject(was);
    redo(g);
    expect(well(g)).toMatchObject({ x: 500, y: 420 });
    expect(g.deposits.find((d) => d.id === well(g).depositId)).toMatchObject({ x: 500, y: 420 });
    // Saved and loaded, both are where they were left.
    const loaded = deserialize(serialize(g))!;
    expect(well(loaded)).toMatchObject({ x: 500, y: 420 });
    expect(loaded.deposits.find((d) => d.id === well(loaded).depositId)).toMatchObject({ x: 500, y: 420 });
  });

  it('a moved Drill that is deleted leaves its deposit free where it last stood, and a new Drill is built there', () => {
    const g = rich();
    g.techs.push('S2');
    const other = freeDeposits(g).find((d) => d.mat === 'glint')!;
    const second = placeNode(g, 'well', 0, 0, { depositId: other.id })!;
    act(g, () => {
      second.x = 640;
      second.y = 500;
      seatDeposit(g, second);
      return 0;
    });
    expect(deleteNode(g, second.id)).toBe(true);
    const free = freeDeposits(g).find((d) => d.id === other.id)!;
    expect(free).toMatchObject({ x: 640, y: 500 });
    const again = placeNode(g, 'well', 0, 0, { depositId: other.id })!;
    expect(again).toMatchObject({ x: 640, y: 500, material: 'glint' });
  });

  it('seating changes nothing for a card that is not a Drill', () => {
    const g = rich();
    const before = JSON.stringify(g.deposits);
    seatDeposit(g, market(g));
    expect(JSON.stringify(g.deposits)).toBe(before);
  });
});

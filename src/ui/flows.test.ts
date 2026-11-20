// The Flows panel's words and presses (flows.ts beside this file; the ledger itself is tested in tests/flows.test.ts).
// These run without a browser: the panel is a string, and a press changes ui.sel and ui.trace.
import { beforeEach, describe, expect, it } from 'vitest';
import { clearHistory, connect, placeNode } from '../actions';
import { tick } from '../sim';
import { Game, newGame } from '../state';
import { flowTroubles, flowsAction, flowsHtml, flowsOpen, toggleFlows } from './flows';
import { select, ui } from './ui';

const run = (g: Game, seconds: number) => {
  for (let i = 0; i < seconds * 20; i++) tick(g, 0.05);
};

/** Two Refiners on one Drill, their Glass sold: Sand is short, Glass is fine. */
function board(): { g: Game; drill: number } {
  clearHistory();
  const g = newGame();
  g.credits = 1e9;
  g.techs = ['P1', 'R1'];
  const drill = g.nodes.find((n) => n.type === 'well')!;
  const market = g.nodes.find((n) => n.type === 'market')!;
  for (const y of [100, 240]) {
    const r = placeNode(g, 'refiner', 400, y)!;
    connect(g, drill.id, 0, r.id);
    connect(g, r.id, 0, market.id);
  }
  run(g, 60);
  return { g, drill: drill.id };
}

beforeEach(() => {
  select(null);
});

describe('the Flows panel', () => {
  it('has a row for each material, in order, and says in a word which is in trouble', () => {
    const { g, drill } = board();
    ui.g = g;
    const html = flowsHtml(g);
    expect([...html.matchAll(/data-testid="flow-(\w+)"/g)].map((m) => m[1])).toEqual(['glint', 'shard']);
    expect(html).toMatch(/data-key="glint" data-state="short"/);
    expect(html).toMatch(/data-key="shard" data-state="ok"/);
    expect(html).toContain('<span class="fl-tag short">Short</span>');
    expect(html).toContain('Machines want <b class="mono">2.00</b>/s and get <b class="mono">1.00</b>.');
    // The row in trouble goes to the Drill that cannot keep up; the one that is fine has nowhere to send anyone.
    expect(html).toContain(`data-act="flow-at:${drill}"`);
    expect([...html.matchAll(/data-act="flow-at:/g)].length).toBe(1);
    expect(flowTroubles(g)).toBe(1);
    // No word of the simulation's in it.
    expect(html).not.toMatch(/starved|blocked|idle/i);
  });

  it('opens and closes as a selection does, and a press on a row traces that material until it is pressed again', () => {
    const { g } = board();
    ui.g = g;
    expect(flowsOpen()).toBe(false);
    toggleFlows();
    expect(flowsOpen()).toBe(true);
    const framed: number[][] = [];
    expect(flowsAction('flow', ['shard'], () => {}, (ids) => framed.push(ids))).toBe(true);
    expect(ui.trace).toBe('shard');
    expect(framed.length).toBe(1);
    expect(flowsHtml(g)).toContain('Tracing Glass.');
    expect(flowsAction('flow', ['glint'], () => {}, () => {})).toBe(true);
    expect(ui.trace).toBe('glint');
    expect(flowsAction('flow', ['glint'], () => {}, () => {})).toBe(true);
    expect(ui.trace).toBeNull();
    // A press that is not the panel's is left for the inspector.
    expect(flowsAction('upg', ['speed'], () => {}, () => {})).toBe(false);
  });

  it('"Show" goes to the machine and opens it; the trace ends with the panel, however it is closed', () => {
    const { g, drill } = board();
    ui.g = g;
    toggleFlows();
    flowsAction('flow', ['glint'], () => {}, () => {});
    const went: number[] = [];
    flowsAction('flow-at', [String(drill)], (id) => went.push(id), () => {});
    expect(went).toEqual([drill]);
    expect(ui.sel).toEqual({ kind: 'node', id: drill });
    expect(ui.trace).toBeNull();
    toggleFlows();
    flowsAction('flow', ['glint'], () => {}, () => {});
    select(null);
    expect(ui.trace).toBeNull();
    expect(flowsOpen()).toBe(false);
  });
});

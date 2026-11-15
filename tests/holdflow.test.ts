// "Hold 95% Flow" when the player has built ahead: a second Glyph Assembler, which the credits in hand pay for
// when the goal comes up, leaves two producers short that no single change puts right. The rules review's F1
// (its rev-holdflow test): the chain stopped there for good. The valve's second step (all but two, at 180 s)
// lets it through, and the card's own line names what it can fix on the way.
import { describe, expect, it } from 'vitest';
import { claimOrder, clearHistory, connect, placeNode } from '../src/actions';
import { advice, applyAdvice, lineAdvice } from '../src/advice';
import { RULES } from '../src/content';
import { nodeCost } from '../src/economy';
import { countsForFlow, isFlowing } from '../src/flow';
import { activeGoal, goalAge, goalView } from '../src/goals';
import { tick } from '../src/sim';
import { Game, cloneGame } from '../src/state';
import { playByTheCard } from './cardPlayer';

/** The scripted card player's board the moment "Hold 95% Flow" comes up, with a second Glyph Assembler built as the Glyph card taught. */
function builtAhead(): { g: Game; second: number } {
  let snap: Game | null = null;
  playByTheCard({ tendOrders: 'asked', onIdle: (x) => { if (!snap && activeGoal(x)!.id === 'hold-flow') snap = cloneGame(x); } });
  clearHistory();
  const g = snap!;
  g.credits = Math.max(g.credits, nodeCost(g, 'assembler'));
  const by = (f: (n: Game['nodes'][number]) => boolean) => g.nodes.find(f)!;
  const ink = by((n) => n.recipe === 'ink');
  const spark = by((n) => n.recipe === 'spark');
  const a = placeNode(g, 'assembler', ink.x + 300, ink.y + 200)!;
  connect(g, ink.id, 0, a.id);
  connect(g, spark.id, 0, a.id);
  connect(g, a.id, 0, by((n) => n.type === 'market').id);
  return { g, second: a.id };
}
const short = (g: Game) => g.nodes.filter((n) => countsForFlow(g, n) && !isFlowing(n)).length;

describe('Hold 95% Flow with a second Glyph Assembler built ahead', () => {
  it('the player who does what the card says: its line\'s step, then the valve\'s second step, and the goal is met', () => {
    const { g } = builtAhead();
    const t0 = g.time;
    const did: string[] = [];
    let busy = 0;
    let slack2 = false;
    for (let s = 0; s < 400 && !g.goal.ready; s++) {
      for (let i = 0; i < 20; i++) tick(g, 0.05);
      if (g.order?.ready) claimOrder(g);
      const v = goalView(g)!.flow!;
      if (v.slack === 2) slack2 = true;
      if (g.time < busy) continue;
      const step = lineAdvice(g);
      if (step && applyAdvice(g, step)) {
        did.push(`${Math.round(g.time - t0)} s line: ${step.text.mouse}`);
        busy = g.time + 6;
        continue;
      }
      const tip = advice(g);
      if (tip && applyAdvice(g, tip)) {
        did.push(`${Math.round(g.time - t0)} s tip: ${tip.text.mouse}`);
        busy = g.time + 6;
      }
    }
    console.info(`Hold Flow with a second Glyph Assembler: ready after ${Math.round(g.time - t0)} s\n  ${did.join('\n  ')}`);
    expect(g.goal.ready, did.join('\n')).toBe(true);
    // Within the valve's second step and its ten seconds (and the moment it takes the smoothed Flow to settle).
    expect(g.time - t0).toBeLessThanOrEqual(RULES.flow.valveAfter2 + RULES.flow.holdSeconds + 15);
    // The card's line named the one fix there is (the Spark Refiner short of Ember).
    expect(did.some((x) => /line: The Spark Refiner needs more Ember/.test(x))).toBe(true);
    expect(slack2 || g.time - t0 < RULES.flow.valveAfter2).toBe(true);
  }, 120_000);

  it('the goal view says how many may be short: none, then one at 90 s, then two at 180 s', () => {
    const { g } = builtAhead();
    const seen: Record<number, number> = {};
    for (let s = 0; s < 200 && !g.goal.ready; s++) {
      for (let i = 0; i < 20; i++) tick(g, 0.05);
      const v = goalView(g)!.flow!;
      seen[v.slack ?? 0] ??= Math.round(goalAge(g));
      if (goalAge(g) < RULES.flow.valveAfter) expect(v.slack ?? 0).toBe(0);
      else if (goalAge(g) < RULES.flow.valveAfter2) expect(v).toMatchObject({ valve: true, slack: 1 });
      else expect(v).toMatchObject({ valve: true, slack: 2 });
    }
    expect(Object.keys(seen).map(Number).sort()).toEqual([0, 1, 2]);
    // Left alone (no fix at all), three are short, and even all but two does not pass: the player has to act.
    expect(short(g)).toBe(3);
    expect(g.goal.ready).toBe(false);
  }, 120_000);

  it('deleting the extra Assembler again lets the goal complete, as before', () => {
    const { g, second } = builtAhead();
    for (let i = 0; i < 20 * 120; i++) tick(g, 0.05);
    const doIt = lineAdvice(g);
    if (doIt) applyAdvice(g, doIt);
    const t0 = g.time;
    g.nodes = g.nodes.filter((n) => n.id !== second);
    g.wires = g.wires.filter((w) => w.from !== second && w.to !== second);
    g.rev++;
    for (let s = 0; s < 120 && !g.goal.ready; s++) for (let i = 0; i < 20; i++) tick(g, 0.05);
    expect(g.goal.ready).toBe(true);
    expect(g.time - t0).toBeLessThan(60);
  }, 120_000);
});

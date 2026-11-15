// "Hold 95% Flow" when the player has built ahead: a second Glyph Assembler, which the credits in hand pay for
// when the goal comes up, leaves two producers short that no single change puts right. The rules review's F1
// (its rev-holdflow test): the chain stopped there for good. The valve's second step (all but two, at 180 s)
// lets it through, and the card's own line names what it can fix on the way. Left alone, the board is three
// short: the third step (all but three, at 300 s) passes it. So it does a save from the public version played
// on by the tips alone (the rules verifier's v10), which stopped there for good with two steps.
import { describe, expect, it } from 'vitest';
import { claimGoal, claimOrder, clearHistory, connect, expandBoard, favour, placeNode } from '../src/actions';
import { advice, adviceTrials, applyAdvice, lineAdvice } from '../src/advice';
import { RULES } from '../src/content';
import { nodeCost } from '../src/economy';
import { countsForFlow, isFlowing, worstProducer } from '../src/flow';
import { activeGoal, goalAge, goalView } from '../src/goals';
import { tick } from '../src/sim';
import { Game, GNode, cloneGame, deserialize, nodeNoun } from '../src/state';
import { playByTheCard } from './cardPlayer';
import { PUBLIC_BOARD } from './fixtures/public-version';

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

  it('the player who reads no line and follows the tips (the review\'s own script): the adviser names the fix the line names, then the valve\'s second step', () => {
    const { g } = builtAhead();
    const t0 = g.time;
    const tips: string[] = [];
    // As tests/rev-holdflow did: a look at the tips every 16 s, nothing else.
    for (let k = 0; k < 450 && !g.goal.ready; k++) {
      for (let i = 0; i < 40; i++) tick(g, 0.05);
      if (g.order?.ready) claimOrder(g);
      if (k % 8 === 0) {
        const t = advice(g);
        if (t && applyAdvice(g, t)) tips.push(`${Math.round(g.time - t0)} s: ${t.text.mouse}`);
      }
    }
    console.info(`Hold Flow by the tips alone: ready after ${Math.round(g.time - t0)} s\n  ${tips.join('\n  ')}`);
    expect(g.goal.ready, tips.join('\n')).toBe(true);
    expect(g.time - t0).toBeLessThanOrEqual(RULES.flow.valveAfter2 + RULES.flow.holdSeconds + 30);
    expect(tips.some((x) => /The Spark Refiner needs more Ember/.test(x))).toBe(true);
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
    // Left alone (no fix at all), three are short, and even all but two does not pass...
    expect(short(g)).toBe(3);
    expect(g.goal.ready).toBe(false);
    // ...until the valve's third step: all but three, at 300 s, held for ten seconds from there.
    while (!g.goal.ready && goalAge(g) < 400) for (let i = 0; i < 10; i++) tick(g, 0.05);
    expect(g.goal.ready).toBe(true);
    expect(goalAge(g)).toBeGreaterThanOrEqual(RULES.flow.valveAfter2 + RULES.flow.valveEvery + RULES.flow.holdSeconds - 0.01);
    expect(goalAge(g)).toBeLessThan(RULES.flow.valveAfter2 + RULES.flow.valveEvery + RULES.flow.holdSeconds + 5);
    expect(goalView(g)!.flow).toMatchObject({ valve: true, slack: 3 });
  }, 120_000);

  it('the line names the node its step acts on, which is not the producer the Flow ring jumps to (the rules review\'s board)', () => {
    const { g } = builtAhead();
    // A moment for the second Assembler to count and for the rates to settle.
    for (let i = 0; i < 20 * 30; i++) tick(g, 0.05);
    const step = lineAdvice(g)!;
    expect(step.upgrade).toBe('speed');
    const acts = g.nodes.find((n) => n.id === step.node)!;
    const ring = worstProducer(g)!;
    // The ring jumps to a Glyph Assembler; the step is Speed on the Ember Well (for the Spark Refiner).
    expect(nodeNoun(ring)).toBe('Glyph Assembler');
    expect(nodeNoun(acts)).toBe('Ember Well');
    for (const touch of [false, true]) {
      const text = goalView(g, touch)!.meanwhile!.text;
      // (Two Ember Wells stand on this board, one with a Lab of its own: the line says which, "its".)
      expect(text).toBe('The Spark Refiner needs more Ember: buy Speed on its Ember Well.');
      expect(text).not.toContain('Glyph Assembler');
    }
    // Its Show me is the same step, in the same words with the price: it selects that Ember Well and points at its
    // Speed button (src/ui/advice-show.ts).
    expect(step.text.mouse).toMatch(/^The Spark Refiner needs more Ember: buy Speed on its Ember Well \(\d+¢\)\.$/);
    // The adviser's own Flow tip names that Well the same way: "its Ember Well" (it said "an Ember Well", which sent
    // the player to either of the two).
    const tips = adviceTrials(g)!.trials.map((x) => x.text).filter((x) => /needs more Ember: buy Speed on/.test(x));
    expect(tips.length).toBeGreaterThan(0);
    for (const t of tips) expect(t).toMatch(/needs more Ember: buy Speed on its Ember Well \(\d+¢\)\.$/);
    // Once everything flows, the line is done and reads its own words.
    applyAdvice(g, step);
    clearHistory();
  }, 120_000);

  it('a save from the public version, played on by the tips alone, passes the Flow goal at the valve\'s third step', () => {
    clearHistory();
    const g = deserialize(PUBLIC_BOARD)!;
    const by = (f: (n: GNode) => boolean) => g.nodes.find(f);
    // Up to "Hold 95% Flow" as the rules verifier's v10 played it: the cards, a Router that favours the Lab, the expansion.
    for (let k = 0; k < 2000 && activeGoal(g)!.id !== 'hold-flow'; k++) {
      for (let i = 0; i < 40; i++) tick(g, 0.05);
      if (g.order?.ready) claimOrder(g);
      if (g.goal.ready) {
        claimGoal(g);
        continue;
      }
      const id = activeGoal(g)!.id;
      const mk = by((n) => n.type === 'market')!;
      const lab = by((n) => n.type === 'lab');
      if (id === 'route-lab') {
        const spark = by((n) => n.recipe === 'spark')!;
        let r = by((n) => n.type === 'router');
        if (!r && g.credits >= nodeCost(g, 'router')) {
          r = placeNode(g, 'router', spark.x + 120, spark.y + 60)!;
          connect(g, spark.id, 0, r.id);
          connect(g, r.id, 0, lab!.id);
          connect(g, r.id, 0, mk.id);
        }
        if (r) favour(g, r.id, g.wires.find((x) => x.from === r!.id && x.to === lab!.id)!.id);
      } else if (id === 'expand') expandBoard(g);
    }
    expect(activeGoal(g)!.id).toBe('hold-flow');
    const t0 = g.time;
    const tips: string[] = [];
    for (let s = 0; s < 400 && !g.goal.ready; s += 2) {
      for (let i = 0; i < 40; i++) tick(g, 0.05);
      if (g.order?.ready) claimOrder(g);
      const tip = advice(g);
      if (tip && applyAdvice(g, tip)) tips.push(`${Math.round(g.time - t0)} s: ${tip.text.mouse}`);
    }
    console.info(`The public version's save, tips alone: ready after ${Math.round(g.time - t0)} s, ${short(g)} short\n  ${tips.join('\n  ')}`);
    // (Before the third step it stopped here for good, three short, with every tip taken.)
    expect(g.goal.ready, tips.join('\n')).toBe(true);
    expect(g.time - t0).toBeLessThanOrEqual(RULES.flow.valveAfter2 + RULES.flow.valveEvery + RULES.flow.holdSeconds + 15);
    clearHistory();
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

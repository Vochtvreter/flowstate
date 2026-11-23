// "Hold 95% Flow" when the player has built ahead. The goal comes with the first Copper, whose Ore Drill is too slow
// for its Refiner: one level of Speed on that Drill, which the card's line names, puts it right. A player who has
// gone on to build a second Copper Refiner on the same Ore Drill (the goal after next is "Make 1 Copper a second")
// has two Refiners short that no single change gets flowing: the line has no step for that board and the adviser no
// tip, and the chain used to stop on such a board for good. The valve lets it through: all but one at 90 s, all but
// two at 180 s, then one more every 120 s. So it does a save from the public version, played on by the tips alone.
import { describe, expect, it } from 'vitest';
import { claimGoal, claimOrder, clearHistory, connect, deleteNode, placeNode } from '../src/actions';
import { advice, applyAdvice, lineAdvice } from '../src/advice';
import { RULES } from '../src/content';
import { countsForFlow, isFlowing, worstProducer } from '../src/flow';
import { activeGoal, goalAge, goalView } from '../src/goals';
import { tick } from '../src/sim';
import { Game, cloneGame, deserialize, nodeNoun } from '../src/state';
import { playByTheCard } from './cardPlayer';
import { PUBLIC_BOARD } from './fixtures/public-version';

/** The scripted card player's board the moment "Hold 95% Flow" comes up. */
function atFlowGoal(): Game {
  let snap: Game | null = null;
  playByTheCard({ tendOrders: 'asked', onIdle: (x) => { if (!snap && activeGoal(x)!.id === 'hold-flow') snap = cloneGame(x); } });
  clearHistory();
  return snap!;
}

/** ...with `extra` more Copper Refiners built on its one Ore Drill, each selling what it makes. */
function builtAhead(extra = 1): { g: Game; added: number[] } {
  const g = atFlowGoal();
  g.credits = Math.max(g.credits, 2000);
  const by = (f: (n: Game['nodes'][number]) => boolean) => g.nodes.find(f)!;
  const ember = by((n) => n.material === 'ember');
  const added: number[] = [];
  for (let i = 0; i < extra; i++) {
    const r = placeNode(g, 'refiner', ember.x + 300, ember.y + 200 + 120 * i, { recipe: 'spark' })!;
    connect(g, ember.id, 0, r.id);
    connect(g, r.id, 0, by((n) => n.type === 'market').id);
    added.push(r.id);
  }
  return { g, added };
}
const short = (g: Game) => g.nodes.filter((n) => countsForFlow(g, n) && !isFlowing(n)).length;

describe('Hold 95% Flow on a board built ahead: a second Copper Refiner on the one Ore Drill', () => {
  it('the board as the cards leave it: the line names the Ore Drill, which is not the producer the Flow ring jumps to', () => {
    const g = atFlowGoal();
    // A moment for the Copper line to count (a Drill or machine counts from 20 s old) and for the rates to settle.
    for (let i = 0; i < 20 * 30; i++) tick(g, 0.05);
    const step = lineAdvice(g)!;
    expect(step.upgrade).toBe('speed');
    const acts = g.nodes.find((n) => n.id === step.node)!;
    const ring = worstProducer(g)!;
    // The ring jumps to the Copper Refiner; the step is Speed on the Ore Drill that feeds it.
    expect(nodeNoun(ring)).toBe('Copper Refiner');
    expect(nodeNoun(acts)).toBe('Ore Drill');
    for (const touch of [false, true]) expect(goalView(g, touch)!.meanwhile!.text).toBe('The Copper Refiner needs more Ore: buy Speed on the Ore Drill.');
    // Its Show me is the same step, in the same words with the price: it selects that Ore Drill and points at its
    // Speed button (src/ui/advice-show.ts).
    expect(step.text.mouse).toMatch(/^The Copper Refiner needs more Ore: buy Speed on the Ore Drill \(\d+¢\)\.$/);
    // Done, everything flows and the goal is met within half a minute.
    expect(applyAdvice(g, step)).toBe(true);
    const t0 = g.time;
    for (let s = 0; s < 60 && !g.goal.ready; s++) for (let i = 0; i < 20; i++) tick(g, 0.05);
    expect(g.goal.ready).toBe(true);
    expect(g.time - t0).toBeLessThan(35);
    clearHistory();
  }, 120_000);

  it('built ahead, nobody can name one change that helps: no step, no tip, and the valve\'s second step lets the board through', () => {
    for (const reads of ['the line and the tips', 'nothing'] as const) {
      const { g } = builtAhead();
      const t0 = g.time;
      const did: string[] = [];
      let busy = 0;
      let slack2 = false;
      for (let s = 0; s < 400 && !g.goal.ready; s++) {
        for (let i = 0; i < 20; i++) tick(g, 0.05);
        if (g.order?.ready) claimOrder(g);
        if (goalView(g)!.flow!.slack === 2) slack2 = true;
        if (g.time < busy || reads === 'nothing') continue;
        const step = lineAdvice(g) ?? advice(g);
        if (step && applyAdvice(g, step)) {
          did.push(`${Math.round(g.time - t0)} s: ${step.text.mouse}`);
          busy = g.time + 6;
        }
      }
      console.info(`Hold Flow with a second Copper Refiner on the one Ore Drill, reading ${reads}: ready after ${Math.round(g.time - t0)} s\n  ${did.join('\n  ')}`);
      expect(g.goal.ready, did.join('\n')).toBe(true);
      // Within the valve's second step and its ten seconds (and the moment it takes the smoothed Flow to settle).
      expect(g.time - t0).toBeLessThanOrEqual(RULES.flow.valveAfter2 + RULES.flow.holdSeconds + 15);
      // Two Refiners on one Ore Drill take two and a half times what it brings up: one level of Speed gets neither
      // of them flowing, so the line does not ask for it, and no tip claims it would.
      expect(did.filter((x) => /needs more Ore/.test(x))).toEqual([]);
      expect(slack2 || g.time - t0 < RULES.flow.valveAfter2).toBe(true);
    }
  }, 120_000);

  it('the goal view says how many may be short: none, then one at 90 s, then two at 180 s, then three at 300 s', () => {
    // Three Copper Refiners on the one Ore Drill: three short, with nothing done about it.
    const { g } = builtAhead(2);
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

  it('a save from the public version, played on by the growth goals\' own way and the tips, passes the Flow goal', () => {
    clearHistory();
    const g = deserialize(PUBLIC_BOARD)!;
    // Played up to "Hold 95% Flow": what it has met is claimed as it comes, and the growth goals before it (it has one
    // Refiner of each kind) are done by their card's own way.
    for (let k = 0; k < 2000 && activeGoal(g)!.id !== 'hold-flow'; k++) {
      for (let i = 0; i < 40; i++) tick(g, 0.05);
      if (g.order?.ready) claimOrder(g);
      if (g.goal.ready) {
        claimGoal(g);
        continue;
      }
      const step = lineAdvice(g);
      if (step) applyAdvice(g, step);
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
    // (Before the valve's third step it stopped here for good, three short, with every tip taken.)
    expect(g.goal.ready, tips.join('\n')).toBe(true);
    expect(g.time - t0).toBeLessThanOrEqual(RULES.flow.valveAfter2 + RULES.flow.valveEvery + RULES.flow.holdSeconds + 15);
    clearHistory();
  }, 120_000);

  it('deleting the extra Refiner again lets the goal complete, with the line\'s step', () => {
    const { g, added } = builtAhead();
    for (let i = 0; i < 20 * 60; i++) tick(g, 0.05);
    expect(g.goal.ready).toBe(false);
    for (const id of added) expect(deleteNode(g, id)).toBe(true);
    for (let i = 0; i < 20 * 15; i++) tick(g, 0.05);
    const step = lineAdvice(g)!;
    expect(step.text.mouse).toMatch(/^The Copper Refiner needs more Ore: buy Speed on the Ore Drill/);
    expect(applyAdvice(g, step)).toBe(true);
    const t0 = g.time;
    for (let s = 0; s < 120 && !g.goal.ready; s++) for (let i = 0; i < 20; i++) tick(g, 0.05);
    expect(g.goal.ready).toBe(true);
    expect(g.time - t0).toBeLessThan(60);
    clearHistory();
  }, 120_000);
});

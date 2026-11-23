/**
 * Bench: what the parts of the game that can hold up a frame cost, on boards a simulated player built.
 *
 *   npm run bench                        the tables: ticks, copies, forecasts, adviser verdicts, wire routing
 *   npm run bench -- --json=<file>       the same numbers as JSON (tools/baseline/ keeps one to compare against)
 *   npm run bench -- --digest            no timing: a fingerprint of each board after a fixed run of ticks, and of
 *                                        every wire's line at rest. A change that is only meant to make the game
 *                                        faster must leave the state fingerprints as they were
 *   npm run bench -- --save=<file>       write the large board as a save, for tools/perf.mjs to load in a browser
 *                                        (--board=medium or small for one of the others)
 *   npm run bench -- --noVerdicts        skip the adviser (the slowest part to measure)
 *
 * DOM-free, like tools/pacing.ts, whose players build the boards: the newcomer's finished demo (small), and the
 * fast player's board at 20 and at 30 minutes (medium and large). The times are this machine's, unthrottled: the
 * page's budget is a 4x slower processor (docs/PITCH_PLAN.md), so read them times four.
 *
 * What is measured is what the page does, without the page: `routing` is routeAll with the ends and the card
 * boxes board.ts would hand it (routeWires), a drag is the card with the most wires carried round a square in
 * grid steps, and a glide is every frame of a card coming to rest (stepSettle), for one card and for a Tidy.
 */
import { writeFileSync } from 'node:fs';
import { clipById } from '../src/actions';
import { advice } from '../src/advice';
import { FORECAST, LOOKS, lookahead, measure } from '../src/forecast';
import { offlineGains, tick } from '../src/sim';
import { GRID, Game, cloneGame, deserialize, serialize } from '../src/state';
import { FLOW_SEGS } from '../src/ui/fx';
import { nodeSize, wireEnds } from '../src/ui/geom';
import { tidy, tidyInput } from '../src/ui/layout';
import { COUNT, CardBox, WireIn, WireStyle, forgetWays, routeAll } from '../src/ui/wires';
import { Bot, CFG, POLICIES } from './pacing';

declare const process: { argv: string[]; version: string };

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

// ---------- numbers ----------

const now = () => performance.now();
const sorted = (v: number[]) => [...v].sort((a, b) => a - b);
const at = (v: number[], q: number) => {
  const s = sorted(v);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};
interface Spread { med: number; p90: number; max: number; n: number }
const spread = (v: number[]): Spread => ({ med: at(v, 0.5), p90: at(v, 0.9), max: v.length ? Math.max(...v) : 0, n: v.length });
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const round = (s: Spread): Spread => ({ med: r3(s.med), p90: r3(s.p90), max: r3(s.max), n: s.n });

/** Milliseconds one call of `f` takes: the median of `reps` calls after a few to warm up. */
function time(f: () => void, reps: number, warm = 3): number {
  for (let i = 0; i < warm; i++) f();
  const v: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = now();
    f();
    v.push(now() - t0);
  }
  return at(v, 0.5);
}

/** A short fingerprint of a text: two 32-bit hashes run side by side (nothing here needs more than "the same or not"). */
function sha(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

// ---------- boards ----------

interface Verdict { ms: number; copies: number; ticks: number }

/** A player whose game is looked at as it goes: a copy of the board at given moments, and what a verdict costs every so often. */
class Watched extends Bot {
  shots = new Map<number, Game>();
  wanted: number[] = [];
  verdicts: Verdict[] = [];
  every = 0;
  private next = 60;

  trackStatus() {
    super.trackStatus();
    const g = this.g;
    while (this.wanted.length && g.time >= this.wanted[0] - 1e-9) {
      const copy = cloneGame(g);
      if (copy) this.shots.set(this.wanted[0], copy);
      this.wanted.shift();
    }
    if (this.every > 0 && g.time >= this.next) {
      this.next += this.every;
      this.verdict();
    }
  }

  /**
   * One verdict as the adviser's worker gives it: on a copy made the way a message to the worker is (a structured
   * clone), with the quiet after the player's last change over. Only the ones that had something to weigh count.
   */
  verdict() {
    const copy = structuredClone({ ...this.g, events: [] }) as Game;
    copy.edits = [];
    const c0 = LOOKS.copies, k0 = LOOKS.ticks;
    const t0 = now();
    advice(copy);
    const ms = now() - t0;
    if (LOOKS.copies > c0) this.verdicts.push({ ms, copies: LOOKS.copies - c0, ticks: LOOKS.ticks - k0 });
  }
}

interface Board { name: string; g: Game; verdicts: Verdict[] }

function boards(verdicts: boolean): Board[] {
  const card = new Watched(POLICIES.newcomer, 0, CFG.minutesCard);
  card.every = verdicts ? 10 : 0;
  card.run();
  const fast = new Watched(POLICIES.mainline, 0, 30);
  fast.every = verdicts ? 10 : 0;
  fast.wanted = [20 * 60];
  fast.run();
  const small = cloneGame(card.g), medium = fast.shots.get(20 * 60), large = cloneGame(fast.g);
  if (!small || !medium || !large) throw new Error('a board could not be copied');
  return [
    { name: 'small', g: small, verdicts: card.verdicts },
    { name: 'medium', g: medium, verdicts: [] },
    { name: 'large', g: large, verdicts: fast.verdicts },
  ];
}

// ---------- routing ----------

type Offsets = Map<number, { ox: number; oy: number }>;

/** What board.ts hands routeAll (routeWires): every wire with its ends, every card's box; a gliding card `off` from its place. */
function routeInput(g: Game, off?: Offsets): { wires: WireIn[]; cards: CardBox[] } {
  const wires: WireIn[] = [];
  for (const w of g.wires) {
    const e = wireEnds(g, w);
    if (!e) continue;
    const a = off?.get(w.from), b = off?.get(w.to);
    wires.push({
      id: w.id, from: w.from, to: w.to,
      a: a ? { ...e.a, x: e.a.x + a.ox, y: e.a.y + a.oy } : e.a,
      b: b ? { ...e.b, x: e.b.x + b.ox, y: e.b.y + b.oy } : e.b,
      // (The points a wire is set to run through are its clips: board.ts hands the router their places, clipPts.)
      pins: w.clips?.length ? w.clips.map((id) => clipById(g, id)).filter((c) => !!c).map((c) => ({ x: c!.x, y: c!.y })) : undefined,
    });
  }
  const cards: CardBox[] = g.nodes.map((n) => {
    const { w, h } = nodeSize(n);
    const m = off?.get(n.id);
    const x = n.x + (m?.ox ?? 0), y = n.y + (m?.oy ?? 0);
    return { id: n.id, x0: x, y0: y, x1: x + w, y1: y + h };
  });
  return { wires, cards };
}

const route = (g: Game, style: WireStyle = 'squared', off?: Offsets) => {
  const inp = routeInput(g, off);
  return routeAll(inp.wires, inp.cards, style, FLOW_SEGS);
};

/** How many wires are drawn differently in `b` than in `a`. */
function differ(a: Map<number, { d: string }>, b: Map<number, { d: string }>): number {
  let n = 0;
  for (const [id, x] of a) if (b.get(id)?.d !== x.d) n++;
  return n;
}

/** Every frame of cards gliding home from `from` over `ms`, as stepSettle draws them (60 a second); the last one is at rest. */
function glide(g: Game, from: Offsets, ms: number): { frames: number[]; searches: number[] } {
  const frames: number[] = [], searches: number[] = [];
  const dur = ms / 1000;
  for (let t = 1 / 60; ; t += 1 / 60) {
    const u = Math.min(1, t / dur);
    const e = 1 - (1 - u) * (1 - u) * (1 - u);
    const off: Offsets = new Map();
    if (u < 1) for (const [id, m] of from) off.set(id, { ox: m.ox * (1 - e), oy: m.oy * (1 - e) });
    const s0 = COUNT.searches;
    const t0 = now();
    route(g, 'squared', off);
    frames.push(now() - t0);
    searches.push(COUNT.searches - s0);
    if (u >= 1) break;
  }
  return { frames, searches };
}

interface Routing {
  cold: number; rest: number; curved: number;
  drag: Spread; dragSearches: Spread;
  drop: Spread; tidyMoved: number; tidy: Spread; tidySearches: Spread;
  /** Wires that rest on another line after the glide than a board that has just loaded draws. */
  dropOff: number; tidyOff: number;
}

function routing(src: Game): Routing {
  const g = cloneGame(src)!;
  forgetWays();
  let t0 = now();
  route(g);
  const cold = now() - t0;
  const rest = time(() => route(g), 30);
  const curved = time(() => route(g, 'curved'), 30);

  // A drag: the card with the most wires that is not a Drill, round a square of 15 grid steps a side.
  const degree = new Map<number, number>();
  for (const w of g.wires) {
    degree.set(w.from, (degree.get(w.from) ?? 0) + 1);
    degree.set(w.to, (degree.get(w.to) ?? 0) + 1);
  }
  const card = g.nodes.filter((n) => n.type !== 'well').sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id - b.id)[0];
  const drag: number[] = [], dragSearches: number[] = [];
  const { w, h } = nodeSize(card);
  const x0 = card.x, y0 = card.y;
  const path: [number, number][] = [];
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) for (let i = 0; i < 15; i++) path.push([dx * GRID, dy * GRID]);
  for (const [dx, dy] of path) {
    const x = Math.max(GRID, Math.min(g.board.w - w - GRID, card.x + dx)), y = Math.max(GRID, Math.min(g.board.h - h - GRID, card.y + dy));
    if (x === card.x && y === card.y) continue;
    card.x = x;
    card.y = y;
    const s0 = COUNT.searches;
    t0 = now();
    route(g);
    drag.push(now() - t0);
    dragSearches.push(COUNT.searches - s0);
  }
  // Let go a little off the grid: the card glides the rest of the way (180 ms, as a dropped card does).
  card.x = x0;
  card.y = y0;
  const drop = glide(g, new Map([[card.id, { ox: -14, oy: 9 }]]), 180);
  const afterDrop = route(g);
  forgetWays();
  const dropOff = differ(route(g), afterDrop);

  // Tidy: every card it moves glides to its new place at once (400 ms).
  const moves = tidy(tidyInput(g, GRID));
  const from: Offsets = new Map();
  for (const n of g.nodes) {
    const to = moves.get(n.id);
    if (!to || (to.x === n.x && to.y === n.y)) continue;
    from.set(n.id, { ox: n.x - to.x, oy: n.y - to.y });
    n.x = to.x;
    n.y = to.y;
  }
  forgetWays();
  route(g, 'squared', from);
  const fly = glide(g, from, 400);
  const afterTidy = route(g);
  forgetWays();
  const tidyOff = differ(route(g), afterTidy);

  return {
    cold: r3(cold), rest: r3(rest), curved: r3(curved),
    drag: round(spread(drag)), dragSearches: round(spread(dragSearches)),
    drop: round(spread(drop.frames)), tidyMoved: from.size, tidy: round(spread(fly.frames)), tidySearches: round(spread(fly.searches)),
    dropOff, tidyOff,
  };
}

// ---------- the game's own work ----------

interface Core {
  tick: number; tickBig: number;
  clone: number; stringify: number; parse: number; normalise: number; saveBytes: number;
  forecast: number; away: number;
}

function core(src: Game): Core {
  // A tick at the game's own step and at the adviser's, in microseconds.
  const perTick = (dt: number) => {
    const g = cloneGame(src)!;
    for (let i = 0; i < 200; i++) tick(g, dt);
    const v: number[] = [];
    for (let b = 0; b < 30; b++) {
      const t0 = now();
      for (let i = 0; i < 100; i++) tick(g, dt);
      v.push(((now() - t0) / 100) * 1000);
    }
    return at(v, 0.5);
  };
  const json = serialize(src);
  const stringify = time(() => serialize(src), 200);
  const parse = time(() => JSON.parse(json), 200);
  const load = time(() => deserialize(json), 200);
  const clone = time(() => cloneGame(src), 200);
  const forecast = time(() => {
    const copy = lookahead(src);
    if (copy) measure(copy, FORECAST.seconds);
  }, 20);
  // Time away is only paid once the demo has ended.
  const away = time(() => {
    const g = cloneGame(src)!;
    g.ended = true;
    offlineGains(g, 3600);
  }, 5, 1);
  return {
    tick: r3(perTick(CFG.dt)), tickBig: r3(perTick(0.5)),
    clone: r3(clone), stringify: r3(stringify), parse: r3(parse), normalise: r3(Math.max(0, load - parse)), saveBytes: json.length,
    forecast: r3(forecast), away: r3(away),
  };
}

// ---------- fingerprints ----------

/** The board after 12,000 ticks of mixed steps, and every wire's line at rest, each as a short hash. */
function digest(src: Game): { state: string; wires: string } {
  const g = cloneGame(src)!;
  for (let i = 0; i < 12000; i++) tick(g, i % 7 === 3 ? 0.25 : i % 11 === 5 ? 0.5 : i % 5 === 2 ? 0.1 : CFG.dt);
  const { rev, events, tickAcc, savedAt, ...rest } = g;
  forgetWays();
  const lines = [...route(cloneGame(src)!)].map(([id, x]) => `${id}:${x.d}`).join('\n');
  return { state: sha(JSON.stringify(rest)), wires: sha(lines) };
}

// ---------- the report ----------

const pad = (s: string | number, n: number) => String(s).padStart(n);
const ms = (v: number) => (v >= 10 ? v.toFixed(1) : v.toFixed(2));
const three = (s: Spread) => `${ms(s.med)} / ${ms(s.p90)} / ${ms(s.max)}`;

function main() {
  const t0 = now();
  const list = boards(!flag('digest') && !flag('noVerdicts'));
  const save = opt('save');
  if (save) {
    const board = list.find((b) => b.name === (opt('board') ?? 'large')) ?? list[2];
    writeFileSync(save, serialize(board.g));
    console.log(`The ${board.name} board is in ${save}.`);
  }
  if (flag('digest')) {
    for (const b of list) {
      const d = digest(b.g);
      console.log(`${b.name.padEnd(7)} ${pad(b.g.nodes.length, 3)} cards ${pad(b.g.wires.length, 3)} wires   state ${d.state}   wires ${d.wires}`);
    }
    return;
  }
  const out = list.map((b) => {
    const v = b.verdicts;
    return {
      name: b.name, cards: b.g.nodes.length, wires: b.g.wires.length,
      core: core(b.g), routing: routing(b.g),
      verdicts: v.length
        ? { ms: round(spread(v.map((x) => x.ms))), copies: round(spread(v.map((x) => x.copies))), ticks: round(spread(v.map((x) => x.ticks))) }
        : null,
      digest: digest(b.g),
    };
  });

  console.log('\nTHE GAME ITSELF (ms; a tick in microseconds)');
  console.log('board    cards wires   tick  tick@0.5   copy (a save: write + read + check)   save kB   forecast   time away');
  for (const b of out) {
    const c = b.core;
    console.log(`${b.name.padEnd(8)} ${pad(b.cards, 5)} ${pad(b.wires, 5)} ${pad(c.tick.toFixed(1), 6)} ${pad(c.tickBig.toFixed(1), 9)}   ${pad(ms(c.clone), 5)} (${ms(c.stringify)} + ${ms(c.parse)} + ${ms(c.normalise)})`.padEnd(71)
      + `${pad((c.saveBytes / 1024).toFixed(0), 7)} ${pad(ms(c.forecast), 10)} ${pad(ms(c.away), 11)}`);
  }
  console.log('\nADVISER VERDICTS over the whole game (median / 9 in 10 / worst)');
  console.log('player       verdicts   ms                    copies          ticks');
  for (const b of out) {
    if (!b.verdicts) continue;
    const v = b.verdicts;
    console.log(`${(b.name === 'small' ? 'newcomer' : 'mainline').padEnd(12)} ${pad(v.ms.n, 8)}   ${three(v.ms).padEnd(21)} ${`${v.copies.med} / ${v.copies.p90} / ${v.copies.max}`.padEnd(15)} ${v.ticks.med} / ${v.ticks.p90} / ${v.ticks.max}`);
  }
  console.log('\nSQUARED WIRES (ms; median / 9 in 10 / worst of the steps or frames)');
  console.log('board    first   at rest  curved   a drag step          searches   a drop glide frame   a Tidy glide frame (cards)   searches');
  for (const b of out) {
    const r = b.routing;
    console.log(`${b.name.padEnd(8)} ${pad(ms(r.cold), 5)} ${pad(ms(r.rest), 9)} ${pad(ms(r.curved), 7)}   ${three(r.drag).padEnd(20)} ${`${r.dragSearches.med} / ${r.dragSearches.max}`.padEnd(10)} ${three(r.drop).padEnd(20)} ${`${three(r.tidy)} (${r.tidyMoved})`.padEnd(28)} ${r.tidySearches.med} / ${r.tidySearches.max}`);
  }
  console.log('\nWIRES AT REST after a glide that a board just loaded draws on another line');
  for (const b of out) console.log(`${b.name.padEnd(8)} after a drop: ${b.routing.dropOff} of ${b.wires}   after Tidy: ${b.routing.tidyOff} of ${b.wires}`);
  console.log('\nFINGERPRINTS (npm run bench -- --digest)');
  for (const b of out) console.log(`${b.name.padEnd(8)} state ${b.digest.state}   wires ${b.digest.wires}`);
  console.log(`\n${((now() - t0) / 1000).toFixed(0)} s`);

  const json = opt('json');
  if (json) {
    writeFileSync(json, JSON.stringify({ node: process.version, boards: out }, null, 2) + '\n');
    console.log(`Written to ${json}.`);
  }
}

main();

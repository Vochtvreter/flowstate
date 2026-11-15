// Feel: sound, haptics, celebrations and the guiding hand.
// Owned by the feel track. Nothing here is called by the board or the panels: it listens to the
// hooks in ui.ts (simulation events, interface signals, the frame and the beat) and answers with
// sound (audio.ts), particles (fx.ts), the big celebrations (celebrate.ts) and the hand (hand.ts).
import { DATA_COLORS, DataTier, NODE_DEFS, NodeType } from '../content';
import { materialsAt, nodeById } from '../actions';
import { fmt } from '../economy';
import { inFlowState } from '../flow';
import { Game, GameEvent, GoalReward } from '../state';
import {
  audioState, buzz, cueAfford, cueClaim, cueConnect, cueError, cueFlowIn, cuePayout, cuePlace, cueReady, cueSales, cueTip, initAudio,
  isMuted, onMuteChange, renderPeak, resetAudio, setDrone, setMuted,
} from './audio';
import { boardRect, toClient } from './board';
import { celebrateEnd, celebrateFlow, celebrateGoal, cancelCelebrations, celebrating, initCelebrate } from './celebrate';
import { anchorPt, el, pulseAnchor, setAttr, setClass, setHTML } from './dom';
import { FlyOpts, Overlay, addOverlay, burst, clearParticles, floater, fly, pop, ring, setMood } from './fx';
import { Pt, bezierAt, matColor, nodeSize, outPorts, wireEnds } from './geom';
import { actOut, handState, initHand, pointAt } from './hand';
import { addTopItem } from './panels';
import { onBeat, onFrame, onGame, onNewGame, onPress, onSignal, signal, ui } from './ui';

const GOLD = '#FFC857';
const UNLOCK = '#9DB8FF';

// ---------- recorder (for test scripts) ----------

interface LogEntry { t: number; kind: 'cue' | 'haptic' | 'celebrate' | 'hand' | 'pay'; name: string; detail?: string | number }
/**
 * The last 200 things that sounded, buzzed, celebrated, pointed or paid out, oldest first.
 * A payout is two entries for each counter it goes to: 'send' when the coins leave ("credits 12 from 720,116 to 202,28")
 * and 'land' when the first of them arrives ("credits 12").
 */
const log: LogEntry[] = [];

function record(kind: LogEntry['kind'], name: string, detail?: string | number) {
  log.push(detail === undefined ? { t: Math.round(performance.now()), kind, name } : { t: Math.round(performance.now()), kind, name, detail });
  if (log.length > 200) log.shift();
}

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!reducedQuery?.matches;

// ---------- where things are ----------

let app: HTMLElement;

/** The middle of the screen: where a reward starts from when the HUD has not said where its button is. */
const centre = (): Pt => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

const centreOf = (selector: string): Pt | null => {
  const e = app.querySelector(selector);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return r.width || r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
};

const creditsPt = (): Pt => anchorPt('credits') ?? centreOf('[data-testid="credits"]') ?? { x: 60, y: 28 };
/** The top bar is what shows at this point: nothing (the tech tree on a phone, a full-screen card) lies over it. Reads layout: used once per payout. */
const inTopBar = (p: Pt): boolean => !!document.elementFromPoint(p.x, p.y)?.closest('#top');
/** A Data counter: the HUD's anchor if it has one, else the chip itself, else the credits counter. */
const dataPt = (k: DataTier): Pt => anchorPt(`data-${k}`) ?? centreOf(`[data-testid="data-${k}"] .sym`) ?? creditsPt();

// ---------- payouts ----------

/** How many coins to send for a sum: a few for a few, more for more, never a swarm. */
const coinCount = (amount: number) => Math.max(3, Math.min(9, 2 + Math.round(Math.log10(Math.max(1, amount)) * 2.2)));

/**
 * Send a reward from where it was earned to where it is counted: coins to the credits counter,
 * Data to its chip, and a spark to each hotbar button a new tech has just added. Each lands with a
 * pulse on the counter, the amount written over it, and a short rising run of ticks.
 * (With less motion asked for nothing flies: fx.fly() delivers at once, so the amount and the ticks
 * come straight away, and the counter does not pulse.)
 *
 * The coins are ordinary ones (fx.fly without `top`): over the stage they are drawn on the board
 * layer, so they come out from under the goal card rather than over it, and the big top layer stays
 * idle. That is deliberate: see the note on cost at the top of fx.ts.
 */
function payout(from: Pt, r: GoalReward) {
  let ticked = false;
  const at = (p: Pt) => `${Math.round(p.x)},${Math.round(p.y)}`;
  // Each flight is noted when it leaves and when it lands, and lands with a pulse, a label and ticks.
  // A counter that cannot be seen (on a phone the open tech tree lies over the top bar) gets the
  // ticks only: coins and a "+40¢" arriving on top of the tree would point at nothing.
  const send = (anchor: string, amount: number, to: Pt, text: string, color: string, n: number, opts: FlyOpts) => {
    record('pay', 'send', `${anchor} ${amount} from ${at(from)} to ${at(to)}`);
    const seen = inTopBar(to);
    const land = () => {
      record('pay', 'land', `${anchor} ${amount}`);
      if (seen && !reduced()) pulseAnchor(anchor);
      // The amount pops up just under the counter it has been added to.
      if (seen) floater({ x: to.x + 12, y: to.y + 60 }, text, color, 13, { top: true, life: 0.95, rise: 18 });
      if (!ticked) cuePayout(Math.min(6, n));
      ticked = true;
    };
    if (seen) fly(from, to, color, n, land, opts);
    else land();
  };
  const quick = { ttl: 0.3, stagger: 0.035 };
  if (r.credits) {
    const n = coinCount(r.credits);
    send('credits', r.credits, creditsPt(), `+${fmt(r.credits)}¢`, GOLD, n, quick);
  }
  for (const k of ['a', 'b', 'g'] as DataTier[]) {
    const amount = r[k];
    if (!amount) continue;
    const n = coinCount(amount);
    send(`data-${k}`, amount, dataPt(k), `+${fmt(amount)}${k === 'a' ? 'α' : k === 'b' ? 'β' : 'γ'}`, DATA_COLORS[k], n, { ...quick, shape: 'diamond', size: 4.6 });
  }
  // A new machine in the hotbar: stars fly to where it has appeared. (They are drawn as far as the edge
  // of the stage, which the hotbar sits against.)
  for (const id of r.techs ?? []) {
    for (const type of Object.keys(NODE_DEFS) as NodeType[]) {
      if (NODE_DEFS[type].tech !== id) continue;
      const to = centreOf(`[data-testid="hot-${type}"]`);
      if (to) fly(from, to, UNLOCK, 5, undefined, { ttl: 0.42, stagger: 0.04, shape: 'star', size: 5 });
    }
  }
}

/** The quick celebration: a reward flies off, a chime, a light buzz. About a third of a second, and nothing is blocked. */
function smallCelebration(name: string, from: Pt, r: GoalReward, color = GOLD, onTop = false) {
  record('celebrate', 'small:' + name);
  cueClaim();
  buzz('claim', 15);
  // On the board layer: sparks that clear the card they came from are seen, the rest are not missed.
  // (With less motion asked for, fx draws neither sparks nor ring, and the reward arrives at once.)
  burst(from, color, 10, { top: onTop, power: 1.2 });
  ring(from, color, { top: onTop, size: 44 });
  payout(from, r);
}

// ---------- simulation events ----------

const batch: GameEvent[] = [];
let lastPress: Pt | null = null;

/** Everything the simulation raised this frame, together: a claim brings its unlocks with it, and they are one moment, not three. */
function handleEvents(events: GameEvent[]) {
  // The Lens being made is a big moment in its own right: the goal turning ready beside it needs no sound of its own.
  const ended = events.some((e) => e.kind === 'demo-end');
  let claimed: 'big' | 'small' | null = ended ? 'big' : null;
  for (const ev of events) {
    switch (ev.kind) {
      case 'goal-claimed':
        if (ev.big && ev.goal === 'make-lens') {
          // The Lens is celebrated at the moment it is made ('demo-end'), which always comes before its goal
          // can be claimed: in this batch, earlier in this session, or in a session before this save was
          // loaded. Claiming the goal afterwards (the summary's "Keep playing" does it for the player) is
          // a small celebration, or nothing while the big one is still up. It is never a second Lens card.
          claimed = 'big';
          if (!ended && !celebrating()) smallCelebration('goal', anchorPt('goal') ?? centre(), ev.reward);
        } else if (ev.big) {
          claimed = 'big';
          celebrateGoal(ev.goal, ev.reward);
        } else {
          claimed = claimed ?? 'small';
          // (Claimed from the slim bar over the open tech tree: the sparks go above the tree too.)
          smallCelebration('goal', anchorPt('goal') ?? centre(), ev.reward, GOLD, ui.techOpen);
        }
        break;
      case 'order-claimed':
        claimed = claimed ?? 'small';
        smallCelebration('order', anchorPt('order') ?? centre(), ev.reward);
        break;
      case 'tech':
        // Granted by the goal just claimed: part of that celebration. Researched: its own small one, where the player pressed.
        // (That one is above the panels: the tech tree covers the board.)
        if (!claimed) smallCelebration('tech', lastPress ?? centre(), {}, DATA_COLORS.a, true);
        break;
      case 'unlock':
        if (!claimed) smallCelebration('unlock', anchorPt(ev.what === 'flow' ? 'flow' : 'order') ?? centre(), {}, UNLOCK);
        break;
      case 'goal-ready':
      case 'order-ready': {
        // The Claim button lighting up is the HUD's to show; this is only its sound. Straight after a claim
        // the chime is still ringing: a big one says enough, a small one gets its "ready" a beat later.
        if (claimed === 'big') break;
        if (claimed) setTimeout(cueReady, 450);
        else cueReady();
        break;
      }
      case 'flow-state':
        record('celebrate', ev.first ? 'flow:first' : 'flow');
        if (ev.first) celebrateFlow();
        else {
          // Every time after the first: a soft rising tone, a ring on the Flow meter, and a shimmer
          // that runs once around the board's edge. Two seconds, and nothing in the way.
          cueFlowIn();
          const at = anchorPt('flow');
          if (!reduced()) {
            if (at) ring(at, '#5CE1FF', { top: true, size: 48, life: 0.8 });
            shimmer = 0;
          }
        }
        break;
      case 'demo-end':
        celebrateEnd();
        break;
      case 'toast':
        cueError();
        break;
      default:
        break;
    }
  }
}

// ---------- interface signals ----------

/** Credits each Market earned in the second just gone; played as one soft run of ticks. */
const sales: number[] = [];
/**
 * Each Market's takings, smoothed. Items arrive in bursts, so one second's takings jump about even
 * when the line is steady; the tick's pitch follows the smoothed figure and stays put.
 */
const takings = new Map<number, number>();

function onSale(d: { id: number; amount: number }) {
  const before = takings.get(d.id);
  const smooth = before == null ? d.amount : before + (d.amount - before) * 0.3;
  takings.set(d.id, smooth);
  sales.push(smooth);
  if (reduced() || ui.techOpen) return;
  // The Market's coin pops. (The floating "+N¢" and the coins to the counter are the board's.)
  const n = nodeById(ui.g, d.id);
  if (!n) return;
  const p = toClient({ x: n.x + 29, y: n.y + nodeSize(n).h / 2 });
  const r = boardRect();
  if (p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom) pop(p, GOLD, 13 * ui.view.k);
}

// A streak of light that runs along a wire the moment it is connected, from the source to the
// target, and ends in a burst there. Drawn in world space so it stays on the wire.
interface Racer { a: Pt; b: Pt; color: string; t: number }
const racers: Racer[] = [];
const RACE = 0.26;

const racerOverlay: Overlay = {
  active: () => racers.length > 0,
  draw(c, dt) {
    const k = ui.view.k;
    c.lineCap = 'round';
    for (let i = racers.length - 1; i >= 0; i--) {
      const r = racers[i];
      r.t += dt;
      const u = r.t / RACE;
      if (u >= 1) {
        racers.splice(i, 1);
        burst(toClient(r.b), r.color, 9);
        ring(toClient(r.b), '#ffffff');
        continue;
      }
      const head = u * u * (3 - 2 * u);
      const tail = Math.max(0, head - 0.3);
      c.beginPath();
      for (let s = 0; s <= 8; s++) {
        const p = toClient(bezierAt(r.a, r.b, tail + ((head - tail) * s) / 8));
        if (s) c.lineTo(p.x, p.y);
        else c.moveTo(p.x, p.y);
      }
      c.globalAlpha = 0.35;
      c.strokeStyle = r.color;
      c.lineWidth = Math.max(5, 11 * k);
      c.stroke();
      c.globalAlpha = 0.9;
      c.strokeStyle = '#ffffff';
      c.lineWidth = Math.max(2.5, 5 * k);
      c.stroke();
    }
    c.globalAlpha = 1;
  },
};

function onConnect(d: { from: number; to: number; at: Pt }) {
  cueConnect();
  buzz('connect', 8);
  if (reduced()) return;
  const g = ui.g;
  let wire = null;
  for (let i = g.wires.length - 1; i >= 0 && !wire; i--) if (g.wires[i].from === d.from && g.wires[i].to === d.to) wire = g.wires[i];
  const ends = wire && wireEnds(g, wire);
  const color = matColor(wire ? materialsAt(g, wire.from, wire.port)[0] ?? null : null);
  if (ends) racers.push({ a: ends.a, b: ends.b, color, t: 0 });
  else {
    burst(d.at, color, 9);
    ring(d.at, '#ffffff');
  }
}

function onPlace(d: { id: number }) {
  cuePlace();
  if (reduced()) return;
  // The card drops in and squashes (feel.css); a puff of dust leaves its feet as it lands.
  setTimeout(() => {
    const n = nodeById(ui.g, d.id);
    if (!n) return;
    const { w, h } = nodeSize(n);
    const k = ui.view.k;
    const foot = toClient({ x: n.x + w / 2, y: n.y + h });
    burst({ x: foot.x - w * k * 0.32, y: foot.y }, '#8C97AD', 4, { power: 0.55 });
    burst({ x: foot.x + w * k * 0.32, y: foot.y }, '#8C97AD', 4, { power: 0.55 });
  }, 120);
}

// ---------- Flow State ----------

let inFlow = false;
let edge: HTMLElement | null = null;
/** The glow around the board is wanted (Flow State is on), and how far its bright line has faded in, 0..1. */
let edgeOn = false;
let edgeLevel = 0;
let edgeClock = 0;
/** Seconds for one breath of the glow. */
const BREATH = 4.4;
/** Seconds the shimmer takes to run around the board's edge when Flow State comes back; `shimmer` is how far into it we are. */
const SHIMMER = 2;
let shimmer = SHIMMER;

// The bright line along the board's edge, which swells and sinks while the soft glow behind it
// (four still strips, feel.css) stays put. Drawn here because this canvas is redrawn every frame anyway.
const edgeOverlay: Overlay = {
  active: () => edgeOn || edgeLevel > 0.01 || shimmer < SHIMMER,
  draw(c, dt) {
    edgeLevel += ((edgeOn ? 1 : 0) - edgeLevel) * (1 - Math.exp(-dt / (edgeOn ? 0.5 : 0.9)));
    edgeClock += dt;
    const breath = reduced() ? 0.5 : 0.5 - 0.5 * Math.cos((edgeClock / BREATH) * Math.PI * 2);
    const r = boardRect();
    c.strokeStyle = '#5CE1FF';
    c.globalAlpha = edgeLevel * (0.1 + 0.12 * breath);
    c.lineWidth = 10;
    c.strokeRect(r.left + 5, r.top + 5, r.width - 10, r.height - 10);
    c.globalAlpha = edgeLevel * (0.3 + 0.4 * breath);
    c.lineWidth = 2;
    c.strokeRect(r.left + 1, r.top + 1, r.width - 2, r.height - 2);
    if (shimmer < SHIMMER) {
      // Two streaks of light, opposite each other, run once around the edge and fade as they go.
      shimmer += dt;
      const u = Math.min(1, shimmer / SHIMMER);
      const around = 2 * (r.width + r.height) - 12;
      const streak = around * 0.16;
      c.setLineDash([streak, around / 2 - streak]);
      c.lineDashOffset = -around * (u * u * (3 - 2 * u)) * 0.5;
      c.lineCap = 'round';
      const glow = Math.sin(Math.PI * u);
      c.strokeStyle = '#5CE1FF';
      c.globalAlpha = 0.35 * glow;
      c.lineWidth = 9;
      c.strokeRect(r.left + 3, r.top + 3, r.width - 6, r.height - 6);
      c.strokeStyle = '#ffffff';
      c.globalAlpha = 0.85 * glow;
      c.lineWidth = 2.5;
      c.strokeRect(r.left + 3, r.top + 3, r.width - 6, r.height - 6);
      c.setLineDash([]);
      c.lineDashOffset = 0;
      c.lineCap = 'butt';
    }
    c.globalAlpha = 1;
  },
};

function tickFlow() {
  const g = ui.g;
  const state = inFlowState(g);
  // The glow around the board: the strips fade in and out by themselves (feel.css), the line follows (above).
  if (state !== edgeOn) {
    edgeOn = state;
    if (state) edgeClock = 0;
    if (edge) setClass(edge, 'on', state);
  }
  // The hum and the quicker dots stop while the game is paused: a paused factory is not humming.
  const on = state && !g.paused;
  if (on !== inFlow) {
    inFlow = on;
    setMood(on ? 1 : 0);
  }
  // Asked for on every beat: it starts as soon as there is sound to start it with, and a second call is free.
  setDrone(on, on ? 0.7 : 0.9);
}

// ---------- mute button ----------

const SPEAKER = '<path d="M4 9.5h3l4-3.5v12l-4-3.5H4z" class="ic"/>';
const ICON_ON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${SPEAKER}<path d="M14.5 9.2a4 4 0 0 1 0 5.6M17 6.8a7.4 7.4 0 0 1 0 10.4" class="ic"/></svg>`;
const ICON_OFF = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${SPEAKER}<path d="M15 9.5l5 5M20 9.5l-5 5" class="ic"/></svg>`;

function addMuteButton() {
  const btn = el<HTMLButtonElement>(`<button class="ibtn" data-testid="mute" type="button"></button>`);
  const paint = () => {
    const off = isMuted();
    const label = off ? 'Sound is off' : 'Sound is on';
    setClass(btn, 'off', off);
    setAttr(btn, 'aria-pressed', off ? 'true' : 'false');
    setAttr(btn, 'aria-label', label);
    setAttr(btn, 'title', label);
    setHTML(btn, off ? ICON_OFF : ICON_ON);
  };
  onPress(btn, () => setMuted(!isMuted()));
  // Painted whenever sound is switched, by this button or by anything else (the phone's gear menu
  // calls setMuted too), and again with every refresh of the top bar.
  onMuteChange(paint);
  addTopItem('actions', { el: btn, update: paint }, document.querySelector('#top .menuwrap'));
}

// ---------- init ----------

let creditsGame: Game | null = null;
let lastCredits = 0;

export function initFeel() {
  app = document.getElementById('app') ?? document.body;
  initAudio(record);
  initCelebrate({ record, payout });
  initHand({ record, busy: celebrating });
  addOverlay(racerOverlay);
  addOverlay(edgeOverlay);
  addMuteButton();

  // The glow around the board's edge in Flow State: four strips, one along each edge of the stage,
  // just above the board and under the HUD.
  const stage = document.getElementById('stage');
  if (stage) stage.appendChild((edge = el(`<div id="feel-edge" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`)));

  window.addEventListener('pointerdown', (e) => (lastPress = { x: e.clientX, y: e.clientY }), { capture: true, passive: true });

  onGame((ev) => void batch.push(ev));
  onSignal('sale', onSale);
  onSignal('connect', onConnect);
  onSignal('place', onPlace);
  // (The hotbar button's own pulse is the phone track's; this is the bell that goes with it.)
  onSignal('afford', () => cueAfford());
  // The goal card's tip: a soft cue when one appears (audio.ts lets one through every 20 s), the hand
  // at its Show me button when it has gone stale, and the hand acting it out when Show me is pressed.
  onSignal('tip', (d) => {
    if (d.state === 'shown') cueTip();
    else pointAt(d.state === 'stale' ? d.at : null);
  });
  onSignal('showme', actOut);

  onFrame(() => {
    if (batch.length) handleEvents(batch.splice(0));
    if (sales.length) {
      cueSales(sales);
      sales.length = 0;
    }
    // Credits going down means something was bought (an upgrade, a wire, an expansion): the same thump as placing a node.
    const g = ui.g;
    if (g !== creditsGame) creditsGame = g;
    else if (g.credits < lastCredits - 0.5) cuePlace();
    lastCredits = g.credits;
  });
  onBeat(tickFlow);
  onNewGame(() => {
    // Back to the beginning: nothing waiting, nothing flying, nothing humming, nothing glowing.
    // (No beat runs behind the start screen, so Flow State's hum and glow are put out here.)
    batch.length = 0;
    sales.length = 0;
    takings.clear();
    racers.length = 0;
    cancelCelebrations();
    clearParticles();
    resetAudio();
    inFlow = edgeOn = false;
    edgeLevel = 0;
    shimmer = SHIMMER;
    setMood(0, true);
    if (edge) setClass(edge, 'on', false);
    creditsGame = null;
  });

  // A refusal shows as a red toast, whoever raised it: knock once for each.
  const toasts = document.getElementById('toasts');
  if (toasts && typeof MutationObserver !== 'undefined') {
    new MutationObserver((changes) => {
      for (const ch of changes) {
        for (const n of ch.addedNodes) if (n instanceof HTMLElement && n.classList.contains('toast') && n.classList.contains('bad')) cueError();
      }
    }).observe(toasts, { childList: true });
  }

  // main.ts builds window.flowstate after the modules have started, so the recorder joins it a moment later.
  const attach = () => {
    const hook = (window as unknown as { flowstate?: Record<string, unknown> }).flowstate;
    if (!hook) return false;
    hook.feel ??= {
      log, audioState, hand: handState, celebrating, muted: isMuted, setMuted,
      /** Raise an interface signal as the HUD would: emit('tip', { state: 'stale', at }), emit('showme', { wire: { from, to } }). */
      emit: signal,
      /** Render the loudest pile-up of cues offline and report its peak (see renderPeak in audio.ts). */
      renderPeak,
      /** Where things are on screen, in client px: a node's output port, the middle of a node, the middle of a deposit. */
      where: {
        port: (id: number, i = 0) => {
          const n = nodeById(ui.g, id);
          const p = n && outPorts(ui.g, n)[i];
          return p ? toClient(p) : null;
        },
        node: (id: number) => {
          const n = nodeById(ui.g, id);
          if (!n) return null;
          const { w, h } = nodeSize(n);
          return toClient({ x: n.x + w / 2, y: n.y + h / 2 });
        },
        deposit: (id: number) => {
          const d = ui.g.deposits.find((x) => x.id === id);
          return d ? toClient({ x: d.x + 86, y: d.y + 36 }) : null;
        },
      },
    };
    return true;
  };
  queueMicrotask(() => {
    if (!attach()) setTimeout(attach, 0);
  });
}
